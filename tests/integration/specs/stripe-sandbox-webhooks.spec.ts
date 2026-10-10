import type { APIRequestContext } from "@playwright/test";
import type Stripe from "stripe";
import { expect } from "../fixtures";
import { rows, test, withActors } from "../lifecycle-fixture";
import { deliver, stripe, stripeProfile } from "../stripe-fixture";
import { deliverReal, ledgerBalanced, paidExperienceBooking, realEvents, record, setSwitch, sleep, tagged } from "../stripe-sandbox-fixture";

// Revenue & Connect Stage 5d — G: webhook resilience with REAL Stripe TEST
// events (their real ids/types/objects), signed with the run's local secret
// (or its separate Connect secret), against the real handler + event store.

const reason = "Stage 5d sandbox validation";

async function storeRow(f: any, eventId: string) {
  const [r] = await rows(f, "SELECT id, status, attempts FROM webhook_events WHERE event_id = ?", [eventId]);
  return r as { id: number; status: string; attempts: number } | undefined;
}

test("SANDBOX-WEBHOOKS-G: signatures, duplicates, out-of-order, delayed, unknown, failure → replay; no duplicate ledger rows", async ({ playwright, browser }) => {
  test.skip(!stripeProfile, "qa:stripe only");
  test.setTimeout(420_000);
  await withActors(playwright, ["QA_ADMIN"], async (f) => {
    const opened: APIRequestContext[] = [];
    const restore = await setSwitch(f, { "commerce.settlement_ledger": true, "commerce.engine_v2": true, "commerce.engine_v2_experience": true });
    const results: Record<string, unknown> = {};
    try {
      const since = Math.floor(Date.now() / 1000);
      // A real tagged object whose own events we can use: a test customer.
      const customer = await stripe.customers.create({ email: "qa.webhooks@example.test", metadata: tagged() });
      const [custCreated] = await realEvents(customer.id, ["customer.created"], since);
      expect(custCreated, "Stripe emitted customer.created").toBeTruthy();
      const actor = f.actors.QA_ADMIN;

      // Valid signature (account secret), unknown-to-us event type → stored, 200, ignored.
      const valid = await deliverReal(actor, custCreated);
      expect(valid.status).toBe(200);
      expect((await storeRow(f, custCreated.id))?.status, "unknown event type stored and ignored").toBe("ignored");
      // Duplicate: same real event id again.
      const dup = await deliverReal(actor, custCreated);
      expect([dup.status, dup.body.duplicate]).toEqual([200, true]);
      // The separate Connect secret is also accepted.
      const custUpdated = await stripe.customers.update(customer.id, { metadata: tagged({ step: "2" }) });
      const [updEvent] = await realEvents(custUpdated.id, ["customer.updated"], since);
      expect((await deliverReal(actor, updEvent, { connect: true })).status, "Connect-endpoint secret accepted").toBe(200);
      // Invalid and missing signatures are refused and never stored.
      const [upd2] = await realEvents(custUpdated.id, ["customer.updated"], since);
      const bad = await deliverReal(actor, { ...upd2, id: `${upd2.id}_bad` } as Stripe.Event, { invalid: true });
      expect(bad.status).toBe(400);
      const missing = await actor.post("/api/stripe/webhook", { headers: { "Content-Type": "application/json" }, data: Buffer.from(JSON.stringify(upd2)) });
      expect(missing.status()).toBe(400);
      expect(await storeRow(f, `${upd2.id}_bad`)).toBeUndefined();
      results.signatures = { valid: valid.status, invalid: bad.status, missing: missing.status(), connectSecret: 200, unknownType: "ignored", duplicate: true, customerId: customer.id };

      // Handler failure → parked → fixed → replayed (re-fetched from Stripe by real id) → processed once.
      const pay = await paidExperienceBooking(playwright, browser, f, opened, { priceCents: 2000 });
      const refund = await stripe.refunds.create({ payment_intent: pay.paymentIntentId, amount: 500, metadata: tagged({ purpose: "webhook-replay" }) });
      const charge = await stripe.charges.retrieve(refund.charge as string);
      const [refundedEvent] = await realEvents(charge.id, ["charge.refunded"], since);
      expect(refundedEvent, "Stripe emitted charge.refunded").toBeTruthy();
      // Delivered BEFORE the payment is known locally (out of order) → needs a person.
      const early = await deliverReal(pay.guest.ctx, refundedEvent);
      expect(early.status, "parked events are acknowledged so Stripe stops retrying").toBe(200);
      const parked = await storeRow(f, refundedEvent.id);
      expect(parked?.status).toBe("manual_review");
      // The payment confirmation arrives (late), then an admin replays the parked event.
      await deliver(pay.guest.ctx, "checkout.session.completed", pay.session);
      await sleep(1200);
      const replay = await actor.post(`/api/admin/finance/webhooks/${parked!.id}/replay`, { data: { reason } });
      expect(replay.status()).toBe(200);
      const after = await storeRow(f, refundedEvent.id);
      expect(after?.status, "processed on replay").toBe("processed");
      const refunds = await rows(f, "SELECT amount_minor AS a, provider_refund_id AS id FROM refunds WHERE source_ref = ?", [pay.ref]);
      expect(refunds.map((r: any) => [Number(r.a), r.id]), "the Dashboard-style refund recorded once").toEqual([[500, refund.id]]);
      // Replaying / redelivering again changes nothing.
      await actor.post(`/api/admin/finance/webhooks/${parked!.id}/replay`, { data: { reason } });
      await deliverReal(pay.guest.ctx, refundedEvent);
      expect((await rows(f, "SELECT COUNT(*) AS n FROM refunds WHERE source_ref = ?", [pay.ref]))[0].n).toBe(1);
      const groups = await rows(f, "SELECT idempotency_key AS k, COUNT(*) AS n FROM ledger_entry_groups WHERE idempotency_key LIKE ? OR idempotency_key LIKE ? GROUP BY idempotency_key", [`payment:experience:${pay.ref}`, `refund:%`]);
      expect(groups.every((g: any) => Number(g.n) === 1), "no duplicate ledger groups").toBe(true);
      // Delayed: the original checkout completion event, delivered again much later, is a no-op.
      const [completed] = await realEvents(pay.sessionId, ["checkout.session.completed"], since);
      if (completed) {
        const late = await deliverReal(pay.guest.ctx, completed);
        expect(late.status).toBe(200);
        expect((await rows(f, "SELECT COUNT(*) AS n FROM payment_records WHERE source_ref = ?", [pay.ref]))[0].n, "payment recorded once").toBe(1);
      }
      await ledgerBalanced(f);
      results.replay = { paymentIntentId: pay.paymentIntentId, refundId: refund.id, chargeRefundedEvent: refundedEvent.id, firstStatus: parked?.status, afterReplay: after?.status, attempts: after?.attempts };
      await record("webhooks-g", results);
    } finally {
      for (const x of opened) await x.dispose();
      await restore();
    }
  });
});
