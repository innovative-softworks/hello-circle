import type { APIRequestContext, Browser } from "@playwright/test";
import { expect, env } from "../fixtures";
import { evidence } from "../authorization-fixture";
import { test, withActors, rows } from "../lifecycle-fixture";
import { synthCoupon } from "../booking-fixture";
import { deliver, payOnHostedCheckout, sessionFor, stripe, stripeProfile, stripeUiActor, expectCheckoutCreated } from "../stripe-fixture";
import { checkout, guests, localRow, MODELS, paidResource, sleep, TABLE, type Model } from "../stripe-models";

// Phase 9 §12-§15/§17/§19/§28 — real TEST-mode payments on Stripe-hosted
// Checkout (test card numbers only), then the signed provider event.

/** Pay a hosted Checkout URL in a real browser and wait for the provider to report it paid. */
async function payHosted(browser: Browser, url: string, sessionId: string, card = "4242424242424242") {
  const ui = await stripeUiActor(browser, null, "desktop");
  try {
    await ui.page.goto(url);
    await payOnHostedCheckout(ui.page, card);
    if (card !== "4242424242424242") return { declined: true, returned: false, session: await sessionFor(sessionId) };
    await ui.page.waitForURL(u => u.origin === env.E2E_BASE_URL, { timeout: 60_000 });
    let session = await sessionFor(sessionId);
    for (let i = 0; i < 20 && session.payment_status !== "paid"; i++) { await sleep(500); session = await sessionFor(sessionId); }
    return { declined: false, returned: true, session };
  } finally { await ui.close(); }
}
const count = async (f: any, sql: string, values: unknown[]) => (await rows(f, sql, values)).length;
const isConfirmed = (model: Model, row: any) => model === "activity" ? row.status === "joined" && row.payment_status === "paid" : row.payment_status === "paid" && row.status !== "cancelled";

for (const model of MODELS) {
  test(`STRIPE-PAY-${model.toUpperCase()}: hosted test payment → signed success → confirmed once (replays and out-of-order expiry are no-ops)`, async ({ playwright, browser }) => {
    test.skip(!stripeProfile, "qa:stripe only");
    test.setTimeout(240_000);
    await withActors(playwright, model === "activity" ? ["QA_HOST", "QA_USER"] : ["QA_VENDOR"], async f => {
      const opened: APIRequestContext[] = [];
      try {
        const [g] = await guests(playwright, opened, 1);
        const actor = model === "activity" ? f.actors.QA_USER : g.ctx;
        const { listing } = await paidResource(f, model);
        const coupon = await synthCoupon(f, { kind: "percent", amount: 10, maxUses: 1 });
        const res = await checkout(model, listing, actor, g.email, { couponCode: coupon });
        await expectCheckoutCreated(res, `${model} paid checkout`);
        const { ref, url, totalEuro } = await res.json();
        f.track("audit_log", "object_id", ref);
        const pending = await localRow(f, model, ref);
        const paid = await payHosted(browser, url, pending!.stripe_session_id);
        expect(paid.session.payment_status, "provider: paid").toBe("paid");
        expect(paid.session.amount_total, "charged = server total").toBe(Math.round(totalEuro * 100));
        expect((await localRow(f, model, ref))![model === "activity" ? "status" : "payment_status"], "browser return alone does not confirm").toBe(model === "activity" ? "pending_payment" : "pending");
        const first = await deliver(actor, "checkout.session.completed", paid.session);
        await sleep(1500);
        const notesAfterFirst = await count(f, "SELECT id FROM notifications WHERE ref = ?", [ref]);
        const replaySame = await deliver(actor, "checkout.session.completed", paid.session, "valid", first.eventId);
        const replayNew = await deliver(actor, "checkout.session.completed", paid.session);
        const lateExpire = await deliver(actor, "checkout.session.expired", { ...paid.session, status: "expired" });
        expect([first.status, replaySame.status, replayNew.status, lateExpire.status]).toEqual([200, 200, 200, 200]);
        await sleep(1500);
        const row = await localRow(f, model, ref);
        expect(isConfirmed(model, row), `${model} confirmed and stays confirmed`).toBe(true);
        expect(await count(f, "SELECT id FROM notifications WHERE ref = ?", [ref]), "one notification set").toBe(notesAfterFirst);
        expect((await rows(f, "SELECT used_count FROM coupons WHERE code = ?", [coupon]))[0].used_count, "coupon consumed exactly once").toBe(1);
        expect(await count(f, `SELECT id FROM ${TABLE[model].table} WHERE ref = ?`, [ref]), "capacity consumed once (single row)").toBe(1);
        // Capacity 1 is now genuinely taken.
        const [h] = await guests(playwright, opened, 1);
        if (model !== "activity") expect((await checkout(model, listing, h.ctx, h.email)).status(), "paid place is not resold").toBe(409);
        await evidence(`stripe-pay-${model}`, { charged: paid.session.amount_total ?? 0, currency: String(paid.session.currency), deliveries: 4, notifications: notesAfterFirst, couponUses: 1 });
      } finally { for (const x of opened) await x.dispose(); }
    });
  });
}

test("STRIPE-DECLINE: a declined test card never confirms; expiry then releases the hold", async ({ playwright, browser }) => {
  test.skip(!stripeProfile, "qa:stripe only");
  test.setTimeout(180_000);
  await withActors(playwright, ["QA_VENDOR"], async f => {
    const opened: APIRequestContext[] = [];
    try {
      const [a, b] = await guests(playwright, opened, 2);
      const { listing } = await paidResource(f, "experience");
      const { ref, url } = await (await checkout("experience", listing, a.ctx, a.email)).json();
      f.track("audit_log", "object_id", ref);
      const sid = (await localRow(f, "experience", ref))!.stripe_session_id;
      const declined = await payHosted(browser, url, sid, "4000000000000002");
      expect(declined.session.payment_status).toBe("unpaid");
      expect((await localRow(f, "experience", ref))!.payment_status, "no phantom confirmation").toBe("pending");
      expect((await checkout("experience", listing, b.ctx, b.email)).status(), "hold still live during the checkout window").toBe(409);
      await stripe.checkout.sessions.expire(sid);
      expect((await deliver(a.ctx, "checkout.session.expired", await sessionFor(sid))).status).toBe(200);
      await sleep(500);
      expect(await localRow(f, "experience", ref), "pending experience hold removed").toBeUndefined();
      const rb = await checkout("experience", listing, b.ctx, b.email);
      await expectCheckoutCreated(rb, "capacity released");
      f.track("audit_log", "object_id", (await rb.json()).ref);
      await evidence("stripe-decline", { providerPaymentStatus: declined.session.payment_status, local: "pending→removed", released: true });
    } finally { for (const x of opened) await x.dispose(); }
  });
});

test("STRIPE-LATE-SUCCESS: payment completing after the hold lapsed and the place was taken → refund-required + audit, no overbooking", async ({ playwright, browser }) => {
  test.skip(!stripeProfile, "qa:stripe only");
  test.setTimeout(180_000);
  await withActors(playwright, ["QA_VENDOR"], async f => {
    const opened: APIRequestContext[] = [];
    try {
      const [a, b] = await guests(playwright, opened, 2);
      const { listing } = await paidResource(f, "programme");
      const { ref, url } = await (await checkout("programme", listing, a.ctx, a.email)).json();
      f.track("audit_log", "object_id", ref);
      const paid = await payHosted(browser, url, (await localRow(f, "programme", ref))!.stripe_session_id);
      expect(paid.session.payment_status).toBe("paid");
      // Safe control: age THIS row past the 30-minute hold (equivalent of a webhook delivered late).
      await f.connection.execute("UPDATE program_enrollments SET created_at = NOW() - INTERVAL 31 MINUTE WHERE ref = ?", [ref]);
      const rb = await checkout("programme", listing, b.ctx, b.email);
      await expectCheckoutCreated(rb, "lapsed hold no longer blocks");
      const refB = (await rb.json()).ref;
      f.track("audit_log", "object_id", refB);
      expect((await deliver(a.ctx, "checkout.session.completed", paid.session)).status).toBe(200);
      await sleep(800);
      expect(await localRow(f, "programme", ref)).toMatchObject({ status: "cancelled", payment_status: "paid" });
      expect((await rows(f, "SELECT id FROM audit_log WHERE action = 'program.refund_required' AND object_id = ?", [ref])).length).toBe(1);
      expect((await rows(f, "SELECT id FROM program_enrollments WHERE program_id = ? AND payment_status = 'paid' AND status != 'cancelled'", [(listing as any).id])).length, "no paid overbooking").toBe(0);
      await evidence("stripe-late-success", { local: "cancelled+paid", audit: "program.refund_required", overbooking: false });
    } finally { for (const x of opened) await x.dispose(); }
  });
});

test("STRIPE-ISOLATION: a valid paid event for booking A never mutates booking B", async ({ playwright, browser }) => {
  test.skip(!stripeProfile, "qa:stripe only");
  test.setTimeout(180_000);
  await withActors(playwright, ["QA_VENDOR"], async f => {
    const opened: APIRequestContext[] = [];
    try {
      const [a, b] = await guests(playwright, opened, 2);
      const { listing: la } = await paidResource(f, "hall");
      const { listing: lb } = await paidResource(f, "hall");
      const A = await (await checkout("hall", la, a.ctx, a.email)).json();
      const B = await (await checkout("hall", lb, b.ctx, b.email)).json();
      f.track("audit_log", "object_id", A.ref); f.track("audit_log", "object_id", B.ref);
      const paid = await payHosted(browser, A.url, (await localRow(f, "hall", A.ref))!.stripe_session_id);
      const beforeB = JSON.stringify(await localRow(f, "hall", B.ref));
      expect((await deliver(a.ctx, "checkout.session.completed", paid.session)).status).toBe(200);
      await sleep(800);
      expect((await localRow(f, "hall", A.ref))!.payment_status).toBe("paid");
      expect(JSON.stringify(await localRow(f, "hall", B.ref)), "B untouched").toBe(beforeB);
      expect(paid.session.metadata).toEqual({ type: "booking", ref: A.ref });
      await evidence("stripe-isolation", { a: "paid", b: "unchanged" });
    } finally { for (const x of opened) await x.dispose(); }
  });
});

test("HC-QA-050-LIVE STRIPE-COUPON-SINGLE-USE: two customers checking out with one single-use coupon → at most one discounted payment", async ({ playwright, browser }) => {
  test.skip(!stripeProfile, "qa:stripe only");
  test.setTimeout(240_000);
  await withActors(playwright, ["QA_VENDOR"], async f => {
    const opened: APIRequestContext[] = [];
    try {
      const [a, b] = await guests(playwright, opened, 2);
      const { listing: l1 } = await paidResource(f, "experience");
      const { listing: l2 } = await paidResource(f, "experience");
      const coupon = await synthCoupon(f, { kind: "percent", amount: 50, maxUses: 1 });
      const ra = await checkout("experience", l1, a.ctx, a.email, { couponCode: coupon });
      const rb = await checkout("experience", l2, b.ctx, b.email, { couponCode: coupon });
      const created = [ra, rb].filter(r => r.status() === 201);
      const discounted: number[] = [];
      for (const r of created) {
        const { ref, url } = await r.json();
        f.track("audit_log", "object_id", ref);
        const paid = await payHosted(browser, url, (await rows(f, "SELECT stripe_session_id s FROM experience_bookings WHERE ref = ?", [ref]))[0].s);
        await deliver(a.ctx, "checkout.session.completed", paid.session);
        if ((paid.session.total_details?.amount_discount ?? 0) > 0 || (paid.session.amount_total ?? 0) < 1500 * 1.28) discounted.push(paid.session.amount_total ?? 0);
      }
      await sleep(800);
      const used = (await rows(f, "SELECT used_count FROM coupons WHERE code = ?", [coupon]))[0].used_count;
      await evidence("stripe-coupon-single-use", { statuses: [ra.status(), rb.status()].join(","), discountedPayments: discounted.length, usedCount: used });
      expect(used).toBeLessThanOrEqual(1);
      expect(discounted.length, "a single-use coupon discounts at most one real payment").toBeLessThanOrEqual(1);
    } finally { for (const x of opened) await x.dispose(); }
  });
});
