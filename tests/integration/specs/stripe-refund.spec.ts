import type { APIRequestContext, Browser } from "@playwright/test";
import { expect, env } from "../fixtures";
import { evidence } from "../authorization-fixture";
import { test, withActors, rows } from "../lifecycle-fixture";
import { deliver, payOnHostedCheckout, sessionFor, stripe, stripeProfile, stripeUiActor } from "../stripe-fixture";
import { checkout, guests, localRow, paidResource, sleep } from "../stripe-models";

// Phase 9 §22-§27 — cancellation before/after payment and the EXISTING vendor
// refund workflow against Stripe TEST mode (no live money; partial refunds and
// refund webhooks are not implemented → N/A).

async function payAndConfirm(browser: Browser, actor: APIRequestContext, url: string, sessionId: string) {
  const ui = await stripeUiActor(browser, null, "desktop");
  try { await ui.page.goto(url); await payOnHostedCheckout(ui.page); await ui.page.waitForURL(u => u.origin === env.E2E_BASE_URL, { timeout: 60_000 }); } finally { await ui.close(); }
  let s = await sessionFor(sessionId);
  for (let i = 0; i < 20 && s.payment_status !== "paid"; i++) { await sleep(500); s = await sessionFor(sessionId); }
  expect((await deliver(actor, "checkout.session.completed", s)).status).toBe(200);
  await sleep(800);
  return s;
}
const refundsFor = async (session: { payment_intent: unknown }) => (await stripe.refunds.list({ payment_intent: String(typeof session.payment_intent === "string" ? session.payment_intent : (session.payment_intent as any).id), limit: 10 })).data;

test("STRIPE-REFUND-HALL: paid → guest cancel (refund-required) → one vendor refund (test mode) → replay refused", async ({ playwright, browser }) => {
  test.skip(!stripeProfile, "qa:stripe only");
  test.setTimeout(240_000);
  await withActors(playwright, ["QA_VENDOR"], async f => {
    const opened: APIRequestContext[] = [];
    try {
      const [g, h] = await guests(playwright, opened, 2);
      const { listing } = await paidResource(f, "hall");
      const { ref, url, totalEuro } = await (await checkout("hall", listing, g.ctx, g.email)).json();
      f.track("audit_log", "object_id", ref);
      const s = await payAndConfirm(browser, g.ctx, url, (await localRow(f, "hall", ref))!.stripe_session_id);
      expect((await localRow(f, "hall", ref))!.payment_status).toBe("paid");
      const notesBefore = (await rows(f, "SELECT id FROM notifications WHERE ref = ?", [ref])).length;
      // Cancellation after payment: state first, no money moved yet.
      expect((await g.ctx.post(`/api/bookings/${ref}/cancel`, { data: {} })).status()).toBe(200);
      expect(await localRow(f, "hall", ref)).toMatchObject({ status: "cancelled", payment_status: "paid" });
      expect((await refundsFor(s)).length, "cancel alone moves no money").toBe(0);
      const rebook = await checkout("hall", listing, h.ctx, h.email);
      expect(rebook.status(), "slot released once").toBe(201);
      f.track("audit_log", "object_id", (await rebook.json()).ref);
      // Refund via the existing vendor workflow.
      const first = await f.actors.QA_VENDOR.post(`/api/vendor/bookings/${ref}/refund`, { data: {} });
      expect(first.status()).toBe(200);
      const second = await f.actors.QA_VENDOR.post(`/api/vendor/bookings/${ref}/refund`, { data: {} });
      expect(second.status(), "replay refused").toBe(409);
      const refunds = await refundsFor(s);
      expect(refunds.length, "exactly one provider refund").toBe(1);
      expect(refunds[0].amount).toBe(Math.round(totalEuro * 100));
      expect(refunds[0].currency).toBe("eur");
      expect(["succeeded", "pending"]).toContain(refunds[0].status);
      expect((await localRow(f, "hall", ref))!.payment_status).toBe("refunded");
      expect((await rows(f, "SELECT id FROM audit_log WHERE action = 'booking.refunded_by_vendor' AND object_id = ?", [ref])).length).toBe(1);
      const notesAfter = (await rows(f, "SELECT id FROM notifications WHERE ref = ?", [ref])).length;
      await evidence("stripe-refund-hall", { refundStatus: String(refunds[0].status), amount: refunds[0].amount, currency: refunds[0].currency, replay: second.status(), notificationsAdded: notesAfter - notesBefore });
    } finally { for (const x of opened) await x.dispose(); }
  });
});

test("STRIPE-REFUND-CONCURRENT: four simultaneous vendor refunds → one provider refund, one transition, no 5xx", async ({ playwright, browser }) => {
  test.skip(!stripeProfile, "qa:stripe only");
  test.setTimeout(240_000);
  await withActors(playwright, ["QA_VENDOR"], async f => {
    const opened: APIRequestContext[] = [];
    try {
      const [g] = await guests(playwright, opened, 1);
      const { listing } = await paidResource(f, "club");
      const { ref, url } = await (await checkout("club", listing, g.ctx, g.email)).json();
      f.track("audit_log", "object_id", ref);
      const s = await payAndConfirm(browser, g.ctx, url, (await localRow(f, "club", ref))!.stripe_session_id);
      const results = await Promise.all([1, 2, 3, 4].map(() => f.actors.QA_VENDOR.post(`/api/vendor/registrations/${ref}/refund`, { data: {} })));
      const statuses = results.map(r => r.status()).sort();
      await sleep(1500);
      const refunds = await refundsFor(s);
      const audits = (await rows(f, "SELECT id FROM audit_log WHERE action = 'registration.refunded_by_vendor' AND object_id = ?", [ref])).length;
      await evidence("stripe-refund-concurrent", { statuses: statuses.join(","), providerRefunds: refunds.length, audits });
      expect(refunds.length, "never a double refund").toBe(1);
      expect(audits).toBe(1);
      expect((await localRow(f, "club", ref))!.payment_status).toBe("refunded");
      expect(statuses, "one winner, the rest refused cleanly").toEqual([200, 409, 409, 409]);
    } finally { for (const x of opened) await x.dispose(); }
  });
});

for (const model of ["hall", "experience"] as const) {
  test(`STRIPE-CANCEL-BEFORE-PAYMENT-${model.toUpperCase()}: cancelling a pending checkout is refused or releases the hold; a later provider success never yields a contradictory state`, async ({ playwright, browser }) => {
    test.skip(!stripeProfile, "qa:stripe only");
    test.setTimeout(240_000);
    await withActors(playwright, ["QA_VENDOR"], async f => {
      const opened: APIRequestContext[] = [];
      try {
        const [g, h] = await guests(playwright, opened, 2);
        const { listing } = await paidResource(f, model);
        const { ref, url } = await (await checkout(model, listing, g.ctx, g.email)).json();
        f.track("audit_log", "object_id", ref);
        const sid = (await localRow(f, model, ref))!.stripe_session_id;
        const cancel = await g.ctx.post(model === "hall" ? `/api/bookings/${ref}/cancel` : `/api/experiences/bookings/${ref}/cancel`, { data: {} });
        const afterCancel = await localRow(f, model, ref);
        const rebook = await checkout(model, listing, h.ctx, h.email);
        if (rebook.status() === 201) f.track("audit_log", "object_id", (await rebook.json()).ref);
        const provider = await sessionFor(sid);
        let late = "not-attempted";
        if (provider.status === "open") late = String((await payAndConfirm(browser, g.ctx, url, sid)).payment_status);
        const final = await localRow(f, model, ref);
        const audits = (await rows(f, `SELECT id FROM audit_log WHERE action = ? AND object_id = ?`, [`${model === "hall" ? "booking" : "experience"}.refund_required`, ref])).length;
        const activePaid = (await rows(f, model === "hall" ? "SELECT ref FROM bookings WHERE centre_id = ? AND payment_status = 'paid' AND status != 'cancelled'" : "SELECT ref FROM experience_bookings WHERE session_id = ? AND payment_status = 'paid' AND status != 'cancelled'", [model === "hall" ? (listing as any).id : (listing as any).session])).length;
        await evidence(`stripe-cancel-before-payment-${model}`, { cancel: cancel.status(), afterCancel: `${afterCancel!.status}/${afterCancel!.payment_status}`, rebook: rebook.status(), latePayment: late, final: `${final!.status}/${final!.payment_status}`, refundRequiredAudit: audits, activePaid });
        if (cancel.status() === 409) {
          // Policy: a pending checkout is abandoned via the provider (expiry), not cancelled.
          expect(afterCancel!.payment_status).toBe("pending");
          expect(rebook.status(), "hold stays until provider expiry").toBe(409);
          expect(final, "paid → confirmed exactly once").toMatchObject({ payment_status: "paid" });
          expect(final!.status).not.toBe("cancelled");
        } else {
          expect(cancel.status()).toBe(200);
          expect(afterCancel!.status).toBe("cancelled");
          expect(rebook.status(), "hold released by cancel").toBe(201);
          expect(final!.status, "never resurrected").toBe("cancelled");
          if (late === "paid") expect(audits, "money for a cancelled booking is flagged refund-required").toBe(1);
        }
        expect(activePaid, "never overbooked").toBeLessThanOrEqual(1);
      } finally { for (const x of opened) await x.dispose(); }
    });
  });
}
