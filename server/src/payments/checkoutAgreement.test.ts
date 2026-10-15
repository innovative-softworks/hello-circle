import crypto from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../db/index.js";
import { NeedsReviewError } from "../commerce/payments.js";
import { processStripeEvent } from "../routes/stripeWebhook.js";
import { paymentUnderReview, recordCheckoutAgreement } from "./checkoutAgreement.js";
import { beginEvent, failEvent, finishEvent, reopenForReplay } from "./webhookEvents.js";

// Webhook reconciliation (UI completion 2026-10-14): a signed "paid" Checkout
// event only confirms an order when it matches what the session was created
// to charge. Real isolated DB; the event objects are what Stripe sends.

const resident = `test-res-agree-${crypto.randomUUID()}`;
const refs: string[] = [];

async function pendingPass(sessionId: string | null, cents = 5000) {
  const ref = `test-pass-agree-${crypto.randomUUID()}`;
  refs.push(ref);
  await db
    .prepare(`INSERT INTO passes (ref, resident_id, listing_type, listing_id, credits_total, purchased_cents, payment_status, stripe_session_id) VALUES (?, ?, 'club', 'test-listing', 5, ?, 'pending', ?)`)
    .run(ref, resident, cents, sessionId);
  return ref;
}
const status = async (ref: string) => ((await db.prepare(`SELECT payment_status AS s FROM passes WHERE ref = ?`).get(ref)) as { s: string }).s;
const paidEvent = (session: { id: string; amount: number; currency?: string; type?: string; ref: string }) => ({
  id: `evt_test_${crypto.randomUUID()}`,
  type: "checkout.session.completed",
  created: Math.floor(Date.now() / 1000),
  livemode: false,
  account: null,
  data: { object: { id: session.id, object: "checkout.session", payment_status: "paid", amount_total: session.amount, currency: session.currency ?? "eur", payment_intent: `pi_test_${crypto.randomUUID()}`, metadata: { type: session.type ?? "pass", ref: session.ref } } },
});

beforeAll(async () => {
  await db.prepare(`INSERT INTO residents (id, email, name) VALUES (?, ?, ?)`).run(resident, `${resident}@example.test`, "Agreement Test");
});
afterAll(async () => {
  for (const ref of refs) {
    await db.prepare(`DELETE FROM payment_records WHERE source_ref = ?`).run(ref);
    await db.prepare(`DELETE FROM webhook_events WHERE JSON_UNQUOTE(JSON_EXTRACT(summary, '$.metadata.ref')) = ?`).run(ref);
    await db.prepare(`DELETE FROM checkout_agreements WHERE source_ref = ?`).run(ref);
    await db.prepare(`DELETE FROM passes WHERE ref = ?`).run(ref);
  }
  await db.prepare(`DELETE FROM residents WHERE id = ?`).run(resident);
});

describe("checkout agreement reconciliation", () => {
  it("confirms a matching session once; a replayed event is a no-op", async () => {
    const sid = `cs_test_${crypto.randomUUID()}`;
    const ref = await pendingPass(sid);
    await recordCheckoutAgreement({ sessionId: sid, type: "pass", ref, amountMinor: 5000, currency: "EUR" });
    const event = paidEvent({ id: sid, amount: 5000, ref });
    expect(await processStripeEvent(event as never)).toBe("processed");
    expect(await status(ref)).toBe("paid");
    await processStripeEvent(event as never);
    const n = (await db.prepare(`SELECT COUNT(*) AS n FROM payment_records WHERE source_ref = ?`).get(ref)) as { n: number };
    expect(Number(n.n)).toBeLessThanOrEqual(1);
    expect(await status(ref)).toBe("paid");
  });

  it.each([
    ["a different amount", { amount: 4000 }],
    ["a different currency", { currency: "gbp" }],
  ])("parks the event and leaves the order pending on %s", async (_label, change) => {
    const sid = `cs_test_${crypto.randomUUID()}`;
    const ref = await pendingPass(sid);
    await recordCheckoutAgreement({ sessionId: sid, type: "pass", ref, amountMinor: 5000, currency: "EUR" });
    await expect(processStripeEvent(paidEvent({ id: sid, amount: 5000, ref, ...change }) as never)).rejects.toBeInstanceOf(NeedsReviewError);
    expect(await status(ref)).toBe("pending");
  });

  it("refuses a session that was created for a different order", async () => {
    const sidA = `cs_test_${crypto.randomUUID()}`;
    const refA = await pendingPass(sidA);
    const refB = await pendingPass(null);
    await recordCheckoutAgreement({ sessionId: sidA, type: "pass", ref: refA, amountMinor: 5000, currency: "EUR" });
    await expect(processStripeEvent(paidEvent({ id: sidA, amount: 5000, ref: refB }) as never)).rejects.toBeInstanceOf(NeedsReviewError);
    expect([await status(refA), await status(refB)]).toEqual(["pending", "pending"]);
  });

  it("refuses an unknown session for an order that recorded a different one (orders from before agreements existed)", async () => {
    const ref = await pendingPass(`cs_test_recorded_${crypto.randomUUID()}`);
    await expect(processStripeEvent(paidEvent({ id: `cs_test_other_${crypto.randomUUID()}`, amount: 5000, ref }) as never)).rejects.toBeInstanceOf(NeedsReviewError);
    expect(await status(ref)).toBe("pending");
  });

  it("still confirms an order from before agreements existed when the session matches the one it recorded", async () => {
    const sid = `cs_test_${crypto.randomUUID()}`;
    const ref = await pendingPass(sid);
    expect(await processStripeEvent(paidEvent({ id: sid, amount: 5000, ref }) as never)).toBe("processed");
    expect(await status(ref)).toBe("paid");
  });
});

// The review state end to end, through the same steps the webhook route takes
// (store → claim → process → park), so retries, duplicates and replays are
// exercised against the real event store.
async function deliver(event: ReturnType<typeof paidEvent>) {
  const begin = await beginEvent("stripe", event as never, JSON.stringify(event));
  if (begin.action !== "process") return begin.action === "duplicate" ? `duplicate:${begin.status}` : begin.action;
  try {
    await finishEvent(begin.rowId, await processStripeEvent(event as never));
    return "processed";
  } catch (e) {
    const retry = await failEvent(begin.rowId, e, { needsReview: e instanceof NeedsReviewError });
    return retry ? "retry" : "parked";
  }
}
const eventRow = async (eventId: string) => (await db.prepare(`SELECT id, status, attempts, last_error AS err FROM webhook_events WHERE provider = 'stripe' AND event_id = ?`).get(eventId)) as { id: number; status: string; attempts: number; err: string };
const paymentRows = async (ref: string) => Number(((await db.prepare(`SELECT COUNT(*) AS n FROM payment_records WHERE source_ref = ?`).get(ref)) as { n: number }).n);

describe("mismatched payment review state", () => {
  it("parks a mismatch (acknowledged, not retried), never marks paid, and is visible to the customer", async () => {
    const sid = `cs_test_${crypto.randomUUID()}`;
    const ref = await pendingPass(sid);
    await recordCheckoutAgreement({ sessionId: sid, type: "pass", ref, amountMinor: 5000, currency: "EUR" });
    expect(await paymentUnderReview("pass", ref)).toBe(false);

    const ev = paidEvent({ id: sid, amount: 4000, ref });
    expect(await deliver(ev)).toBe("parked"); // the route answers 200 {parked:true}, so Stripe stops retrying
    const row = await eventRow(ev.id);
    expect(row.status).toBe("manual_review");
    expect(row.err).toMatch(/^Checkout reconciliation failed — not marked paid: amount 4000 ≠ agreed 5000/);
    expect(await status(ref)).toBe("pending");
    expect(await paymentRows(ref)).toBe(0);
    expect(await paymentUnderReview("pass", ref)).toBe(true);
  });

  it("is safe under redelivery, a second event for the same session, and an admin replay", async () => {
    const sid = `cs_test_${crypto.randomUUID()}`;
    const ref = await pendingPass(sid);
    await recordCheckoutAgreement({ sessionId: sid, type: "pass", ref, amountMinor: 5000, currency: "EUR" });
    const ev = paidEvent({ id: sid, amount: 5000, currency: "gbp", ref });
    expect(await deliver(ev)).toBe("parked");
    // Stripe redelivers the same event: stored once, not processed again.
    expect(await deliver(ev)).toBe("duplicate:manual_review");
    expect((await eventRow(ev.id)).attempts).toBe(1);
    // A different event for the same session (e.g. async_payment_succeeded) parks too.
    const ev2 = { ...paidEvent({ id: sid, amount: 5000, currency: "gbp", ref }), type: "checkout.session.async_payment_succeeded" };
    expect(await deliver(ev2)).toBe("parked");
    // An admin replay re-checks against the same agreement and parks again — no override.
    const reopened = await reopenForReplay((await eventRow(ev.id)).id);
    expect(reopened).not.toBeNull();
    await db.prepare(`UPDATE webhook_events SET status = 'processing', attempts = attempts + 1 WHERE id = ? AND status = 'failed'`).run((await eventRow(ev.id)).id);
    await expect(processStripeEvent(ev as never)).rejects.toBeInstanceOf(NeedsReviewError);
    await failEvent((await eventRow(ev.id)).id, new NeedsReviewError("replayed mismatch"), { needsReview: true });
    expect((await eventRow(ev.id)).status).toBe("manual_review");
    expect(await status(ref)).toBe("pending");
    expect(await paymentRows(ref)).toBe(0);
  });

  it("does not flag a matching payment as under review", async () => {
    const sid = `cs_test_${crypto.randomUUID()}`;
    const ref = await pendingPass(sid);
    await recordCheckoutAgreement({ sessionId: sid, type: "pass", ref, amountMinor: 5000, currency: "EUR" });
    expect(await deliver(paidEvent({ id: sid, amount: 5000, ref }))).toBe("processed");
    expect(await status(ref)).toBe("paid");
    expect(await paymentUnderReview("pass", ref)).toBe(false);
  });
});
