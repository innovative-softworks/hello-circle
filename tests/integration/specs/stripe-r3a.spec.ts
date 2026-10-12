import type { APIRequestContext } from "@playwright/test";
import { expect } from "../fixtures";
import { evidence } from "../authorization-fixture";
import { test, withActors, rows } from "../lifecycle-fixture";
import { synthCoupon } from "../booking-fixture";
import { sessionFor, stripeProfile } from "../stripe-fixture";
import { checkout, guests, localRow, paidResource } from "../stripe-models";

// Commercial UX R3A — what the customer is shown before paying is exactly what
// Stripe (TEST mode) is asked to charge, on the paths R3A changed:
//   programme + coupon  (quote → enrolment → Checkout Session)
//   club session pass   (new server quote → pass checkout → Checkout Session)
//   experience quote    (new couponDiscountCents/creditCents fields; same total)
// Sessions are created, never paid: no money moves, test keys only.

const amountOf = async (sessionId: string) => (await sessionFor(sessionId)).amount_total;

test("STRIPE-R3A-PROGRAMME-COUPON: quote with a code = enrolment total = Stripe amount; an expired code is refused with its reason", async ({ playwright }) => {
  test.skip(!stripeProfile, "qa:stripe only");
  test.setTimeout(120_000);
  await withActors(playwright, ["QA_VENDOR"], async f => {
    const opened: APIRequestContext[] = [];
    try {
      const [g] = await guests(playwright, opened, 1);
      const listing = (await paidResource(f, "programme")).listing as { id: string };
      const code = await synthCoupon(f, { kind: "percent", amount: 10, maxUses: 1 });
      const quoteRes = await g.ctx.get(`/api/programs/${listing.id}/quote?couponCode=${code}`);
      expect(quoteRes.status()).toBe(200);
      const quote = await quoteRes.json();
      expect(quote.discountCents, "code applied in the quote").toBeGreaterThan(0);

      const res = await checkout("programme", listing, g.ctx, g.email, { couponCode: code, acceptedTerms: true });
      expect(res.status(), await res.text()).toBe(201);
      const { ref, totalEuro } = await res.json();
      f.track("program_enrollments", "ref", ref);
      f.track("audit_log", "object_id", ref);
      expect(Math.round(totalEuro * 100), "enrolment total = quote").toBe(quote.totalCents);
      const row = await localRow(f, "programme", ref);
      expect(Number(row!.total_cents), "stored total = quote").toBe(quote.totalCents);
      const charged = await amountOf(row!.stripe_session_id);
      expect(charged, "Stripe amount = quote").toBe(quote.totalCents);

      // An expired code: the listing-aware quote and the enrolment both give the reason…
      const expired = await synthCoupon(f, { kind: "percent", amount: 10, expires: "2020-01-01 00:00:00" });
      const eq = await g.ctx.get(`/api/programs/${listing.id}/quote?couponCode=${expired}`);
      expect([eq.status(), (await eq.json()).code]).toEqual([400, "coupon_expired"]);
      // …while the standalone validator keeps one uniform answer (no code-existence oracle, R5).
      const v = await g.ctx.post("/api/coupons/validate", { data: { code: expired, subtotalCents: 2500 } });
      const unknown = await g.ctx.post("/api/coupons/validate", { data: { code: "QANOSUCHCODE", subtotalCents: 2500 } });
      expect(await v.json()).toEqual(await unknown.json());
      await evidence("stripe-r3a-programme-coupon", { quoteCents: quote.totalCents, stripeCents: charged ?? -1 });
    } finally { for (const x of opened) await x.dispose(); }
  });
});

test("STRIPE-R3A-PASS: the pass button's server quote = stored price = Stripe amount", async ({ playwright }) => {
  test.skip(!stripeProfile, "qa:stripe only");
  test.setTimeout(120_000);
  await withActors(playwright, ["QA_VENDOR", "QA_USER"], async f => {
    const clubId = (await paidResource(f, "club")).listing as string;
    const quoteRes = await f.actors.QA_USER.get(`/api/passes/quote?listingId=${clubId}&creditsTotal=10`);
    expect(quoteRes.status()).toBe(200);
    const quote = await quoteRes.json();
    const res = await f.actors.QA_USER.post("/api/passes/checkout", { data: { listingType: "club", listingId: clubId, creditsTotal: 10 } });
    expect(res.status(), await res.text()).toBe(201);
    const { ref, totalEuro } = await res.json();
    f.track("passes", "ref", ref);
    expect(Math.round(totalEuro * 100), "checkout total = quote").toBe(quote.totalCents);
    const [row] = await rows(f, "SELECT purchased_cents, stripe_session_id FROM passes WHERE ref = ?", [ref]);
    expect(Number(row.purchased_cents), "stored = quote").toBe(quote.totalCents);
    const charged = await amountOf(row.stripe_session_id);
    expect(charged, "Stripe amount = quote").toBe(quote.totalCents);
    await evidence("stripe-r3a-pass", { quoteCents: quote.totalCents, stripeCents: charged ?? -1 });
  });
});

test("STRIPE-R3A-EXPERIENCE-QUOTE: the split coupon/credit fields don't change the total Stripe charges", async ({ playwright }) => {
  test.skip(!stripeProfile, "qa:stripe only");
  test.setTimeout(120_000);
  await withActors(playwright, ["QA_VENDOR"], async f => {
    const opened: APIRequestContext[] = [];
    try {
      const [g] = await guests(playwright, opened, 1);
      const listing = (await paidResource(f, "experience")).listing as { id: string; session: string };
      const code = await synthCoupon(f, { kind: "fixed", amount: 300, maxUses: 1 });
      const quoteRes = await g.ctx.post(`/api/experiences/${listing.id}/sessions/${listing.session}/quote`, { data: { partySize: 1, couponCode: code } });
      expect(quoteRes.status()).toBe(200);
      const quote = await quoteRes.json();
      // No credit for a guest: the whole discount is the coupon, as the server says.
      expect(quote.creditCents ?? 0).toBe(0);
      expect(quote.couponDiscountCents).toBe(quote.discountCents);
      const res = await checkout("experience", listing, g.ctx, g.email, { couponCode: code });
      expect(res.status(), await res.text()).toBe(201);
      const { ref, totalEuro } = await res.json();
      f.track("experience_bookings", "ref", ref);
      f.track("audit_log", "object_id", ref);
      expect(Math.round(totalEuro * 100)).toBe(quote.totalCents);
      const row = await localRow(f, "experience", ref);
      const charged = await amountOf(row!.stripe_session_id);
      expect(charged, "Stripe amount = quote").toBe(quote.totalCents);
      await evidence("stripe-r3a-experience", { quoteCents: quote.totalCents, stripeCents: charged ?? -1 });
    } finally { for (const x of opened) await x.dispose(); }
  });
});
