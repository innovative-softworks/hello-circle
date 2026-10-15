import type { APIRequestContext, Browser } from "@playwright/test";
import { expect, env } from "../fixtures";
import { evidence } from "../authorization-fixture";
import { test, withActors, rows } from "../lifecycle-fixture";
import { bookingBody, irelandDate } from "../booking-fixture";
import { deliver, payOnHostedCheckout, sessionFor, stripe, stripeProfile, stripeUiActor, expectCheckoutCreated } from "../stripe-fixture";
import { guests, sleep } from "../stripe-models";
import { seedCentre, syntheticOrg } from "../org-fixture";
import type { Scope } from "../stage-b-fixture";

// D-01 + D-10 / D-11 — Stripe TEST mode. Real test-mode Checkout sessions are
// paid on Stripe-hosted Checkout with test cards; the real signed
// checkout.session.completed is delivered to the real webhook route; refunds
// "made in the Stripe Dashboard" are made through the test-mode API. Each test
// uses a synthetic organisation and listing (the shared QA vendor is
// untouched). Assertions read both the local database and Stripe itself.

const SWITCH = "commerce.auto_refund_unfulfillable";

async function payHosted(browser: Browser, url: string, sessionId: string, card = "4242424242424242") {
  const ui = await stripeUiActor(browser, null, "desktop");
  try {
    await ui.page.goto(url);
    await payOnHostedCheckout(ui.page, card);
    await ui.page.waitForURL((u) => u.origin === env.E2E_BASE_URL, { timeout: 60_000 });
    let session = await sessionFor(sessionId);
    for (let i = 0; i < 20 && session.payment_status !== "paid"; i++) {
      await sleep(500);
      session = await sessionFor(sessionId);
    }
    return session;
  } finally {
    await ui.close();
  }
}

/** A real test-mode checkout for a synthetic organisation's centre; tracks what the review flow writes. */
async function openCheckout(f: Scope, ctx: APIRequestContext, email: string, centre: { id: string; room: string }, day: number, time = "12:00") {
  const created = await ctx.post("/api/bookings/checkout", { data: bookingBody(centre, email, { date: irelandDate(day), time, duration: 1 }) });
  await expectCheckoutCreated(created, "checkout");
  const { ref, url } = (await created.json()) as { ref: string; url: string };
  // Payment records, refunds, payment reviews and agreements are kept, like every Stripe test's: the
  // SANDBOX-RECONCILE batch compares them with Stripe to the cent.
  for (const [t, c] of [["bookings", "ref"], ["audit_log", "object_id"], ["notifications", "ref"]]) f.track(t, c, ref);
  const sid = (await rows(f, "SELECT stripe_session_id FROM bookings WHERE ref = ?", [ref]))[0].stripe_session_id as string;
  f.track("webhook_events", "object_id", sid);
  return { ref, url, sid };
}
async function trackReview(f: Scope, ref: string) {
  const [r] = await rows(f, "SELECT id FROM payment_reviews WHERE source_ref = ?", [ref]);
  for (const [t, c] of [["payment_review_alerts", "review_id"], ["notifications", "listing_id"]]) f.track(t, c, String(r.id));
  f.track("audit_log", "object_id", `review-${r.id}`);
  return Number(r.id);
}
const piOf = (s: { payment_intent: unknown }) => (typeof s.payment_intent === "string" ? s.payment_intent : (s.payment_intent as { id?: string } | null)?.id) as string;
const stripeRefunds = async (pi: string) => (await stripe.refunds.list({ payment_intent: pi, limit: 100 })).data;
const setAutoRefund = async (admin: APIRequestContext, enabled: boolean) =>
  expect((await admin.put(`/api/admin/commerce/switches/${SWITCH}`, { data: { enabled, reason: `QA Stripe D-10 test sets automatic refunds ${enabled ? "on" : "off"}` } })).status()).toBe(200);

test("STRIPE-D10-4B: paid after the organisation was suspended → refunded automatically once at Stripe; duplicate and post-reinstatement deliveries can't resurrect it", async ({ playwright, browser }) => {
  test.skip(!stripeProfile, "qa:stripe only");
  test.setTimeout(240_000);
  await withActors(playwright, ["QA_ADMIN"], async (f) => {
    const opened: APIRequestContext[] = [];
    try {
      f.track("audit_log", "object_id", SWITCH);
      await setAutoRefund(f.actors.QA_ADMIN, true);
      const org = await syntheticOrg(playwright, f, opened, ["centre_manager"], []);
      const centre = await seedCentre(f, org.staff[0].id, { payment: "online", rate: 20 });
      const [g] = await guests(playwright, opened, 1);
      const o = await openCheckout(f, g.ctx, g.email, centre, 16);
      const session = await payHosted(browser, o.url, o.sid);
      expect(session.payment_status).toBe("paid");
      const pi = piOf(session);

      expect((await f.actors.QA_ADMIN.put(`/api/admin/organisations/${org.id}/status`, { data: { status: "suspended", reasonCategory: "payment_risk", explanation: "Payment risk review for this organisation's recent sales." } })).status()).toBe(200);
      const first = await deliver(g.ctx, "checkout.session.completed", session);
      f.track("webhook_events", "event_id", first.eventId);
      expect(first.status).toBe(200);
      const reviewId = await trackReview(f, o.ref);
      expect((await rows(f, "SELECT status, payment_status AS ps FROM bookings WHERE ref = ?", [o.ref]))[0]).toEqual({ status: "cancelled", ps: "refunded" });
      const local = await rows(f, "SELECT origin, status, amount_minor AS a, provider_refund_id AS pid FROM refunds WHERE source_ref = ?", [o.ref]);
      expect(local).toHaveLength(1);
      expect(local[0]).toMatchObject({ origin: "auto", status: "succeeded", a: session.amount_total });
      const atStripe = await stripeRefunds(pi);
      expect(atStripe.map((r) => ({ id: r.id, amount: r.amount, status: r.status }))).toEqual([{ id: local[0].pid, amount: session.amount_total, status: "succeeded" }]);
      expect((await rows(f, "SELECT COUNT(*) AS c FROM payment_records WHERE source_ref = ?", [o.ref]))[0].c, "the received payment is recorded once").toBe(1);
      expect((await rows(f, "SELECT reason, status, resolution, auto_refund AS a FROM payment_reviews WHERE id = ?", [reviewId]))[0]).toEqual({ reason: "org_suspended", status: "resolved", resolution: "auto_refunded", a: "succeeded" });
      expect((await (await g.ctx.get(`/api/bookings/status/${o.ref}`)).json()).paymentCase).toMatchObject({ state: "refunded", reason: "org_suspended" });

      // The same event again: acknowledged as a duplicate. After reinstatement, a new delivery changes nothing.
      expect((await deliver(g.ctx, "checkout.session.completed", session, "valid", first.eventId)).status).toBe(200);
      expect((await f.actors.QA_ADMIN.put(`/api/admin/organisations/${org.id}/status`, { data: { status: "active" } })).status()).toBe(200);
      const later = await deliver(g.ctx, "checkout.session.completed", session);
      f.track("webhook_events", "event_id", later.eventId);
      await sleep(500);
      expect((await rows(f, "SELECT status, payment_status AS ps FROM bookings WHERE ref = ?", [o.ref]))[0]).toEqual({ status: "cancelled", ps: "refunded" });
      expect(await stripeRefunds(pi), "still exactly one refund at Stripe").toHaveLength(1);
      expect(await rows(f, "SELECT id FROM refunds WHERE source_ref = ?", [o.ref])).toHaveLength(1);
      await evidence("stripe-d10-4b", { livemode: false, autoRefund: "once", stripeRefunds: 1, resurrected: false });
    } finally {
      for (const x of opened) await x.dispose();
    }
  });
});

test("STRIPE-D01-HELD: automatic refunds off → parked, not confirmed, payment recorded on the review; after reinstatement a new delivery re-checks Stripe and confirms once", async ({ playwright, browser }) => {
  test.skip(!stripeProfile, "qa:stripe only");
  test.setTimeout(240_000);
  await withActors(playwright, ["QA_ADMIN"], async (f) => {
    const opened: APIRequestContext[] = [];
    f.track("audit_log", "object_id", SWITCH);
    await setAutoRefund(f.actors.QA_ADMIN, false);
    try {
      const org = await syntheticOrg(playwright, f, opened, ["centre_manager"], []);
      const centre = await seedCentre(f, org.staff[0].id, { payment: "online", rate: 20 });
      const [g] = await guests(playwright, opened, 1);
      const o = await openCheckout(f, g.ctx, g.email, centre, 17);
      const session = await payHosted(browser, o.url, o.sid);
      const pi = piOf(session);
      expect((await f.actors.QA_ADMIN.put(`/api/admin/organisations/${org.id}/status`, { data: { status: "suspended", reasonCategory: "payment_risk", explanation: "Payment risk review for this organisation's recent sales." } })).status()).toBe(200);

      const first = await deliver(g.ctx, "checkout.session.completed", session);
      f.track("webhook_events", "event_id", first.eventId);
      expect(first.status).toBe(200);
      const event = (await rows(f, "SELECT status, summary, attempts FROM webhook_events WHERE event_id = ?", [first.eventId]))[0];
      expect(event.status).toBe("manual_review");
      expect(JSON.parse(event.summary)).toMatchObject({ id: o.sid, payment_status: "paid", amount: session.amount_total, currency: "eur", payment_intent: pi });
      expect((await rows(f, "SELECT payment_status AS ps FROM bookings WHERE ref = ?", [o.ref]))[0].ps, "not confirmed, not labelled unpaid").toBe("pending");
      expect(await rows(f, "SELECT id FROM payment_records WHERE source_ref = ?", [o.ref]), "not applied to the order").toHaveLength(0);
      const reviewId = await trackReview(f, o.ref);
      // The money received is recorded on the review (Finance finds it without the raw event log).
      expect((await rows(f, "SELECT reason, status, auto_refund AS a, received_minor AS m, received_currency AS c, payment_intent_id AS pi FROM payment_reviews WHERE id = ?", [reviewId]))[0]).toEqual({ reason: "org_suspended", status: "open", a: "disabled", m: session.amount_total, c: "EUR", pi });
      const listed = (await (await f.actors.QA_ADMIN.get("/api/admin/finance/payment-reviews")).json()) as { id: number }[];
      expect(listed.some((r) => r.id === reviewId)).toBe(true);
      expect(await rows(f, "SELECT id FROM audit_log WHERE object_id = ? AND action = 'booking.held_org_suspended'", [o.ref])).toHaveLength(1);
      expect((await (await g.ctx.get(`/api/bookings/status/${o.ref}`)).json()).paymentCase).toMatchObject({ state: "review", reason: "org_suspended", receivedMinor: session.amount_total });

      // Duplicate: acknowledged, not processed again.
      expect((await deliver(g.ctx, "checkout.session.completed", session, "valid", first.eventId)).status).toBe(200);
      expect((await rows(f, "SELECT attempts FROM webhook_events WHERE event_id = ?", [first.eventId]))[0].attempts).toBe(event.attempts);
      expect(await rows(f, "SELECT id FROM audit_log WHERE object_id = ? AND action = 'booking.held_org_suspended'", [o.ref])).toHaveLength(1);

      // Reinstated: a new delivery re-reads Stripe (no refund, no dispute) and confirms exactly once.
      expect((await f.actors.QA_ADMIN.put(`/api/admin/organisations/${org.id}/status`, { data: { status: "active" } })).status()).toBe(200);
      const later = await deliver(g.ctx, "checkout.session.completed", session);
      f.track("webhook_events", "event_id", later.eventId);
      await sleep(800);
      expect((await rows(f, "SELECT payment_status AS ps, status FROM bookings WHERE ref = ?", [o.ref]))[0]).toEqual({ ps: "paid", status: "confirmed" });
      expect(await rows(f, "SELECT id FROM payment_records WHERE source_ref = ?", [o.ref]), "one payment record").toHaveLength(1);
      expect((await rows(f, "SELECT status, resolution FROM payment_reviews WHERE id = ?", [reviewId]))[0]).toEqual({ status: "resolved", resolution: "confirmed" });
      expect((await rows(f, "SELECT status FROM webhook_events WHERE event_id = ?", [first.eventId]))[0].status, "the parked event is resolved").toBe("resolved");
      expect(await stripeRefunds(pi)).toHaveLength(0);
      await evidence("stripe-d01-held", { parked: true, reviewRecorded: true, duplicateIgnored: true, confirmedAfterReinstatement: true });
    } finally {
      await setAutoRefund(f.actors.QA_ADMIN, true);
      for (const x of opened) await x.dispose();
    }
  });
});

test("STRIPE-D11-RECHECK: an amount mismatch is held; partial then full refunds made at Stripe are reconciled by Recheck, which never creates a refund; the review closes only when fully refunded", async ({ playwright, browser }) => {
  test.skip(!stripeProfile, "qa:stripe only");
  test.setTimeout(240_000);
  await withActors(playwright, ["QA_ADMIN"], async (f) => {
    const opened: APIRequestContext[] = [];
    try {
      const org = await syntheticOrg(playwright, f, opened, [], []);
      const centre = await seedCentre(f, org.owner.id, { payment: "online", rate: 20 });
      const [g] = await guests(playwright, opened, 1);
      const o = await openCheckout(f, g.ctx, g.email, centre, 18);
      // Safe control (disposable database): the agreement records a different amount than Stripe will charge.
      await f.connection.execute("UPDATE checkout_agreements SET amount_minor = amount_minor + 100 WHERE session_id = ?", [o.sid]);
      const session = await payHosted(browser, o.url, o.sid);
      const pi = piOf(session);
      const first = await deliver(g.ctx, "checkout.session.completed", session);
      f.track("webhook_events", "event_id", first.eventId);
      const reviewId = await trackReview(f, o.ref);
      expect((await rows(f, "SELECT reason, hold_status AS h, status FROM payment_reviews WHERE id = ?", [reviewId]))[0]).toEqual({ reason: "amount_mismatch", h: "held", status: "open" });
      expect((await rows(f, "SELECT payment_status AS ps FROM bookings WHERE ref = ?", [o.ref]))[0].ps).toBe("pending");

      const recheck = async (reason: string) => {
        const before = (await stripeRefunds(pi)).length;
        const res = await f.actors.QA_ADMIN.post(`/api/admin/finance/payment-reviews/${reviewId}/recheck`, { data: { reason } });
        expect(res.status()).toBe(200);
        expect((await stripeRefunds(pi)).length, "the recheck never creates a refund at Stripe").toBe(before);
        return res.json();
      };
      expect(await recheck("Nothing refunded yet")).toMatchObject({ outcome: "open", succeededMinor: 0 });
      const part = await stripe.refunds.create({ payment_intent: pi, amount: 500, metadata: { qa: "dashboard-partial" } });
      expect(await recheck("Partial refund made in the Dashboard")).toMatchObject({ outcome: "open", succeededMinor: 500, recordedRefunds: 1 });
      expect((await rows(f, "SELECT payment_status AS ps FROM bookings WHERE ref = ?", [o.ref]))[0].ps, "partly refunded is still open").toBe("pending");
      const rest = await stripe.refunds.create({ payment_intent: pi, metadata: { qa: "dashboard-rest" } });
      const closed = await recheck("Rest refunded in the Dashboard");
      expect(closed).toMatchObject({ outcome: "closed", succeededMinor: session.amount_total, recordedRefunds: 1 });
      expect((await rows(f, "SELECT status, payment_status AS ps, review_hold_until AS h FROM bookings WHERE ref = ?", [o.ref]))[0]).toEqual({ status: "cancelled", ps: "refunded", h: null });
      const local = await rows(f, "SELECT provider_refund_id AS pid, amount_minor AS a, status FROM refunds WHERE source_ref = ? ORDER BY id", [o.ref]);
      expect(local).toEqual([{ pid: part.id, a: 500, status: "succeeded" }, { pid: rest.id, a: rest.amount, status: "succeeded" }]);
      expect((await rows(f, "SELECT status, resolution, hold_status AS h FROM payment_reviews WHERE id = ?", [reviewId]))[0]).toEqual({ status: "resolved", resolution: "refunded", h: "released" });
      expect(await recheck("Third look, nothing new")).toMatchObject({ recordedRefunds: 0, updatedRefunds: 0 });
      expect(await rows(f, "SELECT id FROM refunds WHERE source_ref = ?", [o.ref])).toHaveLength(2);
      expect((await (await g.ctx.get(`/api/bookings/status/${o.ref}`)).json()).paymentCase).toMatchObject({ state: "refunded", refundedMinor: session.amount_total });
      await evidence("stripe-d11-recheck", { partialOpen: true, closedWhenFull: true, refundsCreatedByRecheck: 0 });
    } finally {
      for (const x of opened) await x.dispose();
    }
  });
});

test("STRIPE-D11-DISPUTE: a disputed payment under review stays open on Recheck (the dispute flow takes over)", async ({ playwright, browser }) => {
  test.skip(!stripeProfile, "qa:stripe only");
  test.setTimeout(240_000);
  await withActors(playwright, ["QA_ADMIN"], async (f) => {
    const opened: APIRequestContext[] = [];
    try {
      const org = await syntheticOrg(playwright, f, opened, [], []);
      const centre = await seedCentre(f, org.owner.id, { payment: "online", rate: 20 });
      const [g] = await guests(playwright, opened, 1);
      const o = await openCheckout(f, g.ctx, g.email, centre, 19);
      await f.connection.execute("UPDATE checkout_agreements SET amount_minor = amount_minor + 100 WHERE session_id = ?", [o.sid]);
      // Stripe's test card that always produces a dispute shortly after the charge.
      const session = await payHosted(browser, o.url, o.sid, "4000000000000259");
      const pi = piOf(session);
      for (let i = 0; i < 40 && !(await stripe.disputes.list({ payment_intent: pi, limit: 1 })).data.length; i++) await sleep(1000);
      expect((await stripe.disputes.list({ payment_intent: pi, limit: 1 })).data.length, "Stripe opened the test dispute").toBe(1);
      const first = await deliver(g.ctx, "checkout.session.completed", session);
      f.track("webhook_events", "event_id", first.eventId);
      const reviewId = await trackReview(f, o.ref);
      const res = await f.actors.QA_ADMIN.post(`/api/admin/finance/payment-reviews/${reviewId}/recheck`, { data: { reason: "Check the disputed payment" } });
      expect(res.status()).toBe(200);
      expect(await res.json()).toMatchObject({ outcome: "open", disputed: true });
      expect((await rows(f, "SELECT status FROM payment_reviews WHERE id = ?", [reviewId]))[0].status).toBe("open");
      expect(await stripeRefunds(pi)).toHaveLength(0);
      await evidence("stripe-d11-dispute", { disputed: true, closed: false, refunds: 0 });
    } finally {
      for (const x of opened) await x.dispose();
    }
  });
});
