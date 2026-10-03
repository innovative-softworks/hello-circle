import type { APIRequestContext } from "@playwright/test";
import { expect } from "../fixtures";
import { evidence } from "../authorization-fixture";
import { test, withActors, rows, createActivity } from "../lifecycle-fixture";
import { bookableClub, registrationBody, synthCoupon, expectedTotal } from "../booking-fixture";
import { deliver, sessionFor, stripe, stripeProfile } from "../stripe-fixture";
import { checkout, guests, localRow, MODELS, paidResource, providerSessionsSince, sleep, TABLE, type Model } from "../stripe-models";

// Phase 9 §9/§10/§11/§16/§18/§30 — real TEST-mode Checkout Session creation:
// authoritative amounts in integer cents, EUR end to end, hold/expiry
// alignment, real provider expiry, paid concurrency and provider errors.

const quoteFor = async (actor: APIRequestContext, model: Model, listing: any, coupon: string) => {
  if (model === "experience") return (await (await actor.post(`/api/experiences/${listing.id}/sessions/${listing.session}/quote`, { data: { partySize: 1, couponCode: coupon } })).json()).totalCents as number;
  if (model === "programme") return (await (await actor.get(`/api/programs/${listing.id}/quote?couponCode=${coupon}`)).json()).totalCents as number;
  if (model === "activity") return (await (await actor.get(`/api/games/${listing.id}/quote?couponCode=${coupon}`)).json()).totalCents as number;
  return null; // hall / club: breakdown computed in the booking flow UI (Phase 8 verified); no server quote route
};

test("STRIPE-CHECKOUT-AMOUNTS: every paid model — quote = server = database = Stripe, EUR, 30-minute expiry, server metadata", async ({ playwright }) => {
  test.skip(!stripeProfile, "qa:stripe only");
  test.setTimeout(180_000);
  await withActors(playwright, ["QA_VENDOR", "QA_HOST", "QA_USER"], async f => {
    const opened: APIRequestContext[] = [];
    try {
      const table: Record<string, unknown> = {};
      for (const model of MODELS) {
        const [g] = await guests(playwright, opened, 1);
        const actor = model === "activity" ? f.actors.QA_USER : g.ctx;
        const { listing } = await paidResource(f, model);
        const coupon = await synthCoupon(f, { kind: "percent", amount: 10, maxUses: 5 });
        const quoted = await quoteFor(actor, model, listing, coupon);
        const res = await checkout(model, listing, actor, g.email, { couponCode: coupon });
        const body = await res.json();
        if (res.status() !== 201) await evidence("stripe-checkout-error", { model, status: res.status(), error: String(body.error ?? "").slice(0, 120) });
        expect(res.status(), `${model} checkout`).toBe(201);
        expect(body.url, `${model} gets a hosted Checkout URL`).toMatch(/^https:\/\/checkout\.stripe\.com\//);
        const row = await localRow(f, model, body.ref);
        f.track("audit_log", "object_id", body.ref);
        expect(row, `${model} pending row`).toBeTruthy();
        expect(model === "activity" ? row!.status : row!.payment_status).toBe(model === "activity" ? "pending_payment" : "pending");
        const s = await sessionFor(row!.stripe_session_id);
        const serverCents = Math.round(body.totalEuro * 100);
        const dbCents = Number(row!.total_cents); // activities too since HC-QA-049
        const lineSum = (s.line_items?.data ?? []).reduce((n, li) => n + (li.amount_total ?? 0), 0);
        expect(s.amount_total, `${model}: Stripe = server`).toBe(serverCents);
        if (dbCents !== null) expect(s.amount_total, `${model}: Stripe = database`).toBe(dbCents);
        if (quoted !== null) expect(s.amount_total, `${model}: Stripe = quote`).toBe(quoted);
        expect(lineSum, `${model}: line items sum`).toBe(s.amount_total);
        expect(s.currency).toBe("eur");
        expect(s.mode).toBe("payment");
        expect(s.metadata).toEqual({ type: TABLE[model].type, ref: body.ref });
        expect(s.expires_at! - s.created, `${model}: provider session lives exactly the hold window`).toBeGreaterThanOrEqual(29 * 60);
        expect(s.expires_at! - s.created).toBeLessThanOrEqual(30 * 60 + 5);
        expect(s.success_url).toContain(`/payment/success?ref=${body.ref}`);
        expect((await rows(f, "SELECT used_count FROM coupons WHERE code = ?", [coupon]))[0].used_count, `${model}: coupon use reserved with the hold (HC-QA-050)`).toBe(1);
        table[model] = { quote: quoted, server: serverCents, database: dbCents, stripe: s.amount_total, currency: s.currency, lineItems: s.line_items?.data.length };
      }
      // Integer-cent arithmetic reference for one model (club €30, 10% off): 2700 + VAT + fee.
      expect((table.club as any).stripe).toBe(expectedTotal(2700));
      await evidence("stripe-checkout-amounts", Object.fromEntries(Object.entries(table).map(([k, v]) => [k, JSON.stringify(v)])));
    } finally { for (const x of opened) await x.dispose(); }
  });
});

test("STRIPE-EXPIRY: real provider expiry → signed expired event → hold released; replay is a no-op", async ({ playwright }) => {
  test.skip(!stripeProfile, "qa:stripe only");
  test.setTimeout(120_000);
  await withActors(playwright, ["QA_VENDOR"], async f => {
    const opened: APIRequestContext[] = [];
    try {
      const [a, b] = await guests(playwright, opened, 2);
      const club = await bookableClub(f, { price: 30, capacity: 1, payment: "online" });
      const coupon = await synthCoupon(f, { kind: "percent", amount: 10, maxUses: 1 });
      const ra = await (await a.ctx.post("/api/registrations/checkout", { data: registrationBody(club, a.email, { couponCode: coupon }) })).json();
      f.track("audit_log", "object_id", ra.ref);
      expect((await b.ctx.post("/api/registrations/checkout", { data: registrationBody(club, b.email) })).status(), "live hold blocks").toBe(409);
      const row = await localRow(f, "club", ra.ref);
      await stripe.checkout.sessions.expire(row!.stripe_session_id);
      const expired = await sessionFor(row!.stripe_session_id);
      expect(expired.status).toBe("expired");
      const first = await deliver(a.ctx, "checkout.session.expired", expired);
      const replay = await deliver(a.ctx, "checkout.session.expired", expired, "valid", first.eventId);
      expect([first.status, replay.status]).toEqual([200, 200]);
      await sleep(400);
      expect((await localRow(f, "club", ra.ref))!.payment_status).toBe("failed");
      expect((await rows(f, "SELECT used_count FROM coupons WHERE code = ?", [coupon]))[0].used_count, "coupon untouched by expiry").toBe(0);
      const rb = await b.ctx.post("/api/registrations/checkout", { data: registrationBody(club, b.email) });
      expect(rb.status(), "capacity released by provider expiry").toBe(201);
      f.track("audit_log", "object_id", (await rb.json()).ref);
      await evidence("stripe-expiry", { providerStatus: String(expired.status), local: "failed", released: true, replay: "noop" });
    } finally { for (const x of opened) await x.dispose(); }
  });
});

test("STRIPE-CONCURRENCY: capacity 1, six simultaneous paid checkouts → one hold and one provider session (each model)", async ({ playwright }) => {
  test.skip(!stripeProfile, "qa:stripe only");
  test.setTimeout(240_000);
  await withActors(playwright, ["QA_VENDOR"], async f => {
    const opened: APIRequestContext[] = [];
    try {
      const out: Record<string, unknown> = {};
      for (const model of ["hall", "club", "programme", "experience"] as Model[]) {
        const { listing } = await paidResource(f, model);
        const gs = await guests(playwright, opened, 6);
        const since = Math.floor(Date.now() / 1000) - 2;
        const results = await Promise.all(gs.map(g => checkout(model, listing, g.ctx, g.email)));
        const statuses = results.map(r => r.status()).sort();
        expect(statuses.filter(s => s === 201).length, `${model}: exactly one paid hold`).toBe(1);
        expect(statuses.every(s => s === 201 || s === 409), `${model}: losers are refused cleanly (${statuses})`).toBe(true);
        for (const r of results) if (r.status() === 201) f.track("audit_log", "object_id", (await r.json()).ref);
        await sleep(1500);
        const sessions = (await providerSessionsSince(since)).filter(s => s.metadata?.type === TABLE[model].type);
        expect(sessions.length, `${model}: one provider session`).toBe(1);
        out[model] = { statuses: statuses.join(","), providerSessions: sessions.length };
      }
      await evidence("stripe-concurrency", Object.fromEntries(Object.entries(out).map(([k, v]) => [k, JSON.stringify(v)])));
    } finally { for (const x of opened) await x.dispose(); }
  });
});

test("STRIPE-CONCURRENCY-ACTIVITY: capacity 1, two residents race a paid join → one hold, one provider session", async ({ playwright }) => {
  test.skip(!stripeProfile, "qa:stripe only");
  test.setTimeout(90_000);
  await withActors(playwright, ["QA_HOST", "QA_USER", "QA_USER_B"], async f => {
    const game = await createActivity(f, "QA_HOST", { capacity: 2, priceCents: 800 }); // host + one bookable place
    const since = Math.floor(Date.now() / 1000) - 2;
    const results = await Promise.all([f.actors.QA_USER, f.actors.QA_USER_B].map(a => a.post(`/api/games/${game.id}/join`, { data: {} })));
    const statuses = results.map(r => r.status()).sort();
    expect(statuses).toEqual([201, 409]);
    await sleep(1500);
    expect((await providerSessionsSince(since)).filter(s => s.metadata?.type === "game").length).toBe(1);
    await evidence("stripe-concurrency-activity", { statuses: statuses.join(",") });
  });
});

test("STRIPE-PROVIDER-ERROR: a provider-rejected Checkout (below Stripe's minimum) leaves no hold, no coupon use, no capacity leak", async ({ playwright }) => {
  test.skip(!stripeProfile, "qa:stripe only");
  test.setTimeout(90_000);
  await withActors(playwright, ["QA_VENDOR"], async f => {
    const opened: APIRequestContext[] = [];
    try {
      const [a, b] = await guests(playwright, opened, 2);
      const club = await bookableClub(f, { price: 1, capacity: 1, payment: "online" });
      const coupon = await synthCoupon(f, { kind: "fixed", amount: 90, maxUses: 1 }); // €1 − €0.90 → ≈€0.13 total < Stripe's €0.50 minimum
      const ra = await a.ctx.post("/api/registrations/checkout", { data: registrationBody(club, a.email, { couponCode: coupon }) });
      await evidence("stripe-provider-error-status", { status: ra.status() });
      expect(ra.status(), "provider failure surfaces as a controlled error").toBe(400);
      expect((await rows(f, "SELECT id FROM registrations WHERE club_id = ?", [club])).length, "no partial booking").toBe(0);
      expect((await rows(f, "SELECT used_count FROM coupons WHERE code = ?", [coupon]))[0].used_count).toBe(0);
      const prices = await rows(f, "SELECT price FROM clubs WHERE id = ?", [club]);
      await f.connection.execute("UPDATE clubs SET price = 30 WHERE id = ?", [club]);
      const rb = await b.ctx.post("/api/registrations/checkout", { data: registrationBody(club, b.email) });
      expect(rb.status(), "capacity not leaked").toBe(201);
      f.track("audit_log", "object_id", (await rb.json()).ref);
      await evidence("stripe-provider-error", { status: ra.status(), originalPrice: prices[0].price, partialRows: 0, couponUse: 0, capacityLeak: false });
    } finally { for (const x of opened) await x.dispose(); }
  });
});
