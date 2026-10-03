import type { APIRequestContext } from "@playwright/test";
import { expect, personas } from "../fixtures";
import { evidence } from "../authorization-fixture";
import { test, withActors, rows, createActivity } from "../lifecycle-fixture";
import { bookableCentre, bookableClub, bookableExperience, bookableProgram, bookingBody, experienceBody, registrationBody, synthCoupon } from "../booking-fixture";
import { stripe, stripeProfile } from "../stripe-fixture";
import { guests, providerSessionsSince } from "../stripe-models";

// Phase 9 §1/§3/§8/§20/§21 — test mode proven, and genuinely free / cash /
// zero-total bookings never reach the provider.

test("STRIPE-PREFLIGHT: TEST mode verified; free, cash and zero-total bookings bypass the provider", async ({ playwright }) => {
  test.skip(!stripeProfile, "qa:stripe only");
  test.setTimeout(120_000);
  await withActors(playwright, ["QA_VENDOR", "QA_HOST", "QA_USER"], async f => {
    const opened: APIRequestContext[] = [];
    try {
      const out = await (await f.actors.QA_VENDOR.get("/api/__qa/outbound")).json();
      expect(out).toMatchObject({ blockedOutboundAttempts: 0, paymentProviderConfigured: true, providerMode: "test" });
      expect((await stripe.balance.retrieve()).livemode, "provider confirms TEST mode").toBe(false);
      const since = Math.floor(Date.now() / 1000) - 5;
      const [a, b, c, d, e] = await guests(playwright, opened, 5);
      // Free (price 0) — every model.
      const hallFree = await bookableCentre(f, { rate: 0, payment: "online" });
      const r1 = await a.ctx.post("/api/bookings/checkout", { data: bookingBody(hallFree, a.email) });
      const clubFree = await bookableClub(f, { price: 0, payment: "online" });
      const r2 = await b.ctx.post("/api/registrations/checkout", { data: registrationBody(clubFree, b.email) });
      const progFree = await bookableProgram(f, { price: 0 });
      const r3 = await c.ctx.post(`/api/programs/${progFree.id}/enroll`, { data: { participantName: "QA free", email: c.email } });
      const expFree = await bookableExperience(f, { price: 0, payment: "online" });
      const r4 = await d.ctx.post(`/api/experiences/${expFree.id}/sessions/${expFree.session}/checkout`, { data: experienceBody(d.email) });
      const gameFree = await createActivity(f, "QA_HOST", { capacity: 4 });
      const r5 = await f.actors.QA_USER.post(`/api/games/${gameFree.id}/join`, { data: {} });
      // Cash (paid but offline) and zero-total (100% coupon on an ONLINE paid experience).
      const hallCash = await bookableCentre(f, { rate: 20, payment: "cash" });
      const r6 = await e.ctx.post("/api/bookings/checkout", { data: bookingBody(hallCash, e.email) });
      const expPaid = await bookableExperience(f, { price: 1500, payment: "online" });
      const full = await synthCoupon(f, { kind: "percent", amount: 100, maxUses: 1 });
      const r7 = await a.ctx.post(`/api/experiences/${expPaid.id}/sessions/${expPaid.session}/checkout`, { data: experienceBody(a.email, { couponCode: full }) });
      const statuses = [r1, r2, r3, r4, r5, r6, r7].map(r => r.status());
      await evidence("stripe-preflight-statuses", { statuses: statuses.join(","), errors: (await Promise.all([r1, r2, r3, r4, r5, r6, r7].map(async r => r.status() >= 300 ? String((await r.json().catch(() => ({}))).error ?? "").slice(0, 80) : ""))).join("|") });
      expect(statuses.every(s => s === 200 || s === 201), `statuses ${statuses}`).toBe(true);
      const bodies = await Promise.all([r1, r2, r3, r4, r6, r7].map(r => r.json()));
      // Halls: an ONLINE room always charges the refundable deposit (by design),
      // so a €0-rate online hall is not free — it must charge exactly the deposit.
      expect(bodies[0].url, "€0-rate online hall charges its deposit").toMatch(/^https:\/\/checkout\.stripe\.com\//);
      for (const body of bodies.slice(1)) expect(body.url ?? null, "no provider redirect").toBeNull();
      const [hallRow] = await rows(f, "SELECT ref, total_cents, stripe_session_id FROM bookings WHERE centre_id = ?", [hallFree.id]);
      f.track("audit_log", "object_id", hallRow.ref);
      const depositSession = await stripe.checkout.sessions.retrieve(hallRow.stripe_session_id);
      expect(depositSession.amount_total, "deposit-only charge = local total").toBe(hallRow.total_cents);
      expect(depositSession.amount_total).toBeGreaterThan(0);
      await stripe.checkout.sessions.expire(hallRow.stripe_session_id); // test-mode tidy-up
      const stripeIds = await rows(f, `SELECT stripe_session_id s FROM bookings WHERE centre_id IN (?, ?) UNION ALL SELECT stripe_session_id FROM registrations WHERE club_id = ? UNION ALL SELECT stripe_session_id FROM program_enrollments WHERE program_id = ? UNION ALL SELECT stripe_session_id FROM experience_bookings WHERE experience_id IN (?, ?) UNION ALL SELECT stripe_session_id FROM game_participants WHERE game_id = ? AND resident_id = ?`,
        [hallFree.id, hallCash.id, clubFree, progFree.id, expFree.id, expPaid.id, gameFree.id, personas.QA_USER.id]);
      expect(stripeIds.length).toBe(7);
      expect(stripeIds.filter(r => r.s !== null).length, "only the deposit-charging hall has a provider reference").toBe(1);
      expect((await rows(f, "SELECT used_count FROM coupons WHERE code = ?", [full]))[0].used_count, "zero-total consumes its coupon once").toBe(1);
      expect((await providerSessionsSince(since)).length, "only the hall deposit session was created").toBe(1);
      await evidence("stripe-preflight", { mode: "TEST MODE VERIFIED", freeModels: 4, hallOnlineZeroRate: "deposit charged", depositCents: depositSession.amount_total ?? 0, cash: true, zeroTotal: true, providerSessions: 1 });
    } finally { for (const x of opened) await x.dispose(); }
  });
});
