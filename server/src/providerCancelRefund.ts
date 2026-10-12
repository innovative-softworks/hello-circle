import { writeAudit } from "./audit.js";
import { refundPaidOnce, type RefundTable } from "./checkoutService.js";
import { db } from "./db/index.js";
import { notifyRefund } from "./notifications.js";

// Booking UX Phase 6 (audit B13, scenario 18) — when the provider (venue,
// club, organiser) cancels a paid online order, the customer gets their money
// back without anyone having to remember a second step. Uses the same
// refund-once path as the finance refund buttons (refundPaidOnce: row lock,
// provider idempotency key, refunded at most once, "refund the rest" after a
// partial refund), so a double click or a later manual refund can't pay out
// twice. A cash or free order has nothing to refund. If the provider call
// fails, the cancellation stands and the order stays "refund pending" for the
// finance team — the failure is audited, never hidden.

export type CancelRefundOutcome = { refund: "none" } | { refund: "refunded"; amountCents: number } | { refund: "failed"; error: string };

export async function refundOnProviderCancel(input: {
  table: RefundTable;
  ref: string;
  actorUserId: string;
  objectType: string;
  /** The same details the cancellation notice used. */
  notify: Omit<Parameters<typeof notifyRefund>[0], "refundedCents">;
}): Promise<CancelRefundOutcome> {
  const row = (await db.prepare(`SELECT payment_status as paymentStatus, stripe_session_id as sessionId, total_cents as totalCents FROM ${input.table} WHERE ref = ?`).get(input.ref)) as
    | { paymentStatus: string; sessionId: string | null; totalCents: number | null }
    | undefined;
  if (!row || row.paymentStatus !== "paid" || !row.sessionId || !(Number(row.totalCents) > 0)) return { refund: "none" };

  const result = await refundPaidOnce(input.table, "ref = ?", [input.ref], row.sessionId, "This order has already been refunded", {
    actorUserId: input.actorUserId,
    objectType: input.objectType,
    objectId: input.ref,
  });
  if (!result.ok) {
    console.error(`[refunds] automatic refund on cancel failed for ${input.objectType} ${input.ref}: ${result.error}`);
    await writeAudit({ actorUserId: input.actorUserId, action: `${input.objectType}.refund_on_cancel_failed`, objectType: input.objectType, objectId: input.ref, newValue: { error: result.error } });
    return { refund: "failed", error: result.error };
  }
  await writeAudit({
    actorUserId: input.actorUserId,
    action: `${input.objectType}.refunded_on_vendor_cancel`,
    objectType: input.objectType,
    objectId: input.ref,
    previousValue: { paymentStatus: "paid" },
    newValue: { paymentStatus: "refunded", amountCents: result.amountCents, source: result.reconciled ? "stripe_external" : "hellocircle" },
  });
  notifyRefund({ ...input.notify, refundedCents: result.amountCents }).catch((e) => console.error("[notifications] refund-on-cancel notify failed:", e));
  return { refund: "refunded", amountCents: result.amountCents };
}
