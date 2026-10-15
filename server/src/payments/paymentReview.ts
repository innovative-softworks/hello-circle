import crypto from "node:crypto";
import { db } from "../db/index.js";
import { sendMail } from "../email.js";
import { writeAudit } from "../audit.js";
import { releaseCoupon, releaseRedemption } from "../bookingIntegrity.js";
import { commerceSwitch } from "../commerce/switches.js";
import { syncOrderFromSource } from "../commerce/engine.js";
import { postGroup } from "../commerce/ledger.js";
import { ledgerEnabled, postRefund, recordPaymentConfirmed } from "../commerce/payments.js";
import type { CheckoutType } from "../checkoutService.js";
import { orgSuspendedForVendor, supplyVendorForOrder } from "../orgStatus.js";
import { checkCheckoutAgreement, type AgreementCheck } from "./checkoutAgreement.js";
import { paymentProvider, type PaymentSnapshot } from "./provider.js";
import { HOLDING_TYPES, ORDER_TABLE, ORDER_TOTAL, PARENT_LOCK, isOrderType, listingEligible, orderFits, orderHoldLive, orderStart, type OrderType } from "./orderState.js";

// D-10 / D-11 (approved for local implementation 2026-10-15;
// docs/hellocircle-operating-decisions.md). A paid Checkout session whose
// order can't simply be confirmed becomes a payment REVIEW: the durable record
// that the money was received (provider facts, amounts, references), kept
// separate from
//   - the order's own status (booking / registration / … — never relabelled
//     "unpaid" or "failed" while the money is held),
//   - its capacity (hold_status + the order's review_hold_until deadline),
//   - the review itself (open → resolved, with a resolution).
// Nothing here confirms an order that didn't match its checkout agreement,
// and nothing here moves money except the narrow D-10 automatic refund
// (cases 4 and 4b, every precondition re-proved from the provider). The D-11
// recheck only READS the provider; it has no code path to refund creation.

type Tx = Pick<typeof db, "prepare">;

export type ReviewReason =
  | "amount_mismatch" // case 1
  | "currency_mismatch" // case 1
  | "association_unverified" // case 2
  | "org_suspended" // case 4b
  | "capacity_unavailable" // case 4
  | "listing_unavailable"
  | "after_start"
  | "mid_programme"
  | "order_cancelled"
  | "provider_state"; // refunded / disputed / not succeeded at the provider before confirmation

export type HoldStatus = "none" | "held" | "expired" | "released" | "consumed";
export type Urgency = "none" | "starts_soon" | "within_lead" | "after_start";
export type AutoRefund = "not_applicable" | "pending_check" | "checking" | "disabled" | "ineligible" | "requested" | "provider_pending" | "succeeded" | "failed" | "uncertain";

export interface ReviewRow {
  id: number;
  checkoutSessionId: string;
  sourceType: string | null;
  sourceRef: string | null;
  paymentIntentId: string | null;
  chargeId: string | null;
  receivedMinor: number | null;
  receivedCurrency: string | null;
  agreedMinor: number | null;
  agreedCurrency: string | null;
  providerPayment: string;
  reason: ReviewReason;
  detail: string | null;
  holdStatus: HoldStatus;
  reviewHoldUntil: string | null;
  startAt: string | null;
  urgency: Urgency;
  autoRefund: AutoRefund;
  autoRefundNote: string | null;
  status: "open" | "resolved";
  resolution: string | null;
  resolvedAt: string | null;
  resolvedBy: string | null;
  firstEventId: string | null;
  lastRecheckAt: string | null;
  lastRecheckOutcome: string | null;
  flaggedAt: string;
}

const REVIEW_COLUMNS = `id, checkout_session_id AS checkoutSessionId, source_type AS sourceType, source_ref AS sourceRef, payment_intent_id AS paymentIntentId,
  charge_id AS chargeId, received_minor AS receivedMinor, received_currency AS receivedCurrency, agreed_minor AS agreedMinor, agreed_currency AS agreedCurrency,
  provider_payment AS providerPayment, reason, detail, hold_status AS holdStatus, review_hold_until AS reviewHoldUntil, start_at AS startAt, urgency,
  auto_refund AS autoRefund, auto_refund_note AS autoRefundNote, status, resolution, resolved_at AS resolvedAt, resolved_by AS resolvedBy,
  first_event_id AS firstEventId, last_recheck_at AS lastRecheckAt, last_recheck_outcome AS lastRecheckOutcome, flagged_at AS flaggedAt`;

function normalise(r: Record<string, unknown> | undefined): ReviewRow | null {
  if (!r) return null;
  const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  return { ...(r as unknown as ReviewRow), id: Number(r.id), receivedMinor: n(r.receivedMinor), agreedMinor: n(r.agreedMinor) };
}

export async function getReview(id: number, tx: Tx = db): Promise<ReviewRow | null> {
  return normalise((await tx.prepare(`SELECT ${REVIEW_COLUMNS} FROM payment_reviews WHERE id = ?`).get(id)) as Record<string, unknown> | undefined);
}
export async function reviewForSession(sessionId: string, tx: Tx = db): Promise<ReviewRow | null> {
  return normalise((await tx.prepare(`SELECT ${REVIEW_COLUMNS} FROM payment_reviews WHERE checkout_session_id = ?`).get(sessionId)) as Record<string, unknown> | undefined);
}

// --- settings -------------------------------------------------------------------

/** W — review window in hours (approved default 24). 0 turns review holds off (today's 30-minute behaviour). */
export function reviewWindowHours(): number {
  const v = Number(process.env.PAYMENT_REVIEW_WINDOW_HOURS ?? 24);
  return Number.isFinite(v) && v >= 0 ? v : 24;
}
/** L — lead time before the start, in hours (approved default 2). */
export function reviewLeadHours(): number {
  const v = Number(process.env.PAYMENT_REVIEW_LEAD_HOURS ?? 2);
  return Number.isFinite(v) && v >= 0 ? v : 2;
}
/** Provider refund call timeout; after it the outcome is "uncertain" (never retried blindly). */
function refundTimeoutMs(): number {
  const v = Number(process.env.PAYMENT_REFUND_TIMEOUT_MS ?? 20_000);
  return Number.isFinite(v) && v > 0 ? v : 20_000;
}
export async function autoRefundSwitchOn(): Promise<boolean> {
  return commerceSwitch("commerce.auto_refund_unfulfillable");
}

// --- deadline -------------------------------------------------------------------

/** D = min(parked + W, S − L); no start → parked + W. No hold when D isn't
 * after the park time (starts within L, or already started). Pure. */
export function reviewDeadline(parkedAt: Date, startAt: Date | null, opts: { windowHours?: number; leadHours?: number } = {}): { holdUntil: Date | null; urgency: Urgency } {
  const W = (opts.windowHours ?? reviewWindowHours()) * 3_600_000;
  const L = (opts.leadHours ?? reviewLeadHours()) * 3_600_000;
  const p = parkedAt.getTime();
  if (startAt && p >= startAt.getTime()) return { holdUntil: null, urgency: "after_start" };
  if (startAt && p >= startAt.getTime() - L) return { holdUntil: null, urgency: "within_lead" };
  if (W <= 0) return { holdUntil: null, urgency: "none" };
  if (!startAt) return { holdUntil: new Date(p + W), urgency: "none" };
  const sl = startAt.getTime() - L;
  return sl < p + W ? { holdUntil: new Date(sl), urgency: "starts_soon" } : { holdUntil: new Date(p + W), urgency: "none" };
}

const sqlDate = (d: Date) => d.toISOString().slice(0, 19).replace("T", " ");

// --- review rows ------------------------------------------------------------------

export interface PaymentFacts {
  sessionId: string;
  type: string | null;
  ref: string | null;
  paymentIntentId: string | null;
  chargeId?: string | null;
  receivedMinor: number | null;
  receivedCurrency: string | null;
  eventId?: string | null;
}

/** Opens the review for this session once (unique per session). Returns the
 * row and whether it was created now. A later delivery for the same session
 * finds the existing row: the deadline is never recomputed. */
export async function openReview(tx: Tx, facts: PaymentFacts, reason: ReviewReason, extra: { detail?: string | null; agreed?: { amountMinor: number; currency: string } | null; autoRefund?: AutoRefund } = {}): Promise<{ review: ReviewRow; created: boolean }> {
  const info = await tx
    .prepare(
      `INSERT IGNORE INTO payment_reviews (checkout_session_id, source_type, source_ref, payment_intent_id, charge_id, received_minor, received_currency, agreed_minor, agreed_currency, reason, detail, auto_refund, first_event_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      facts.sessionId,
      facts.type,
      facts.ref,
      facts.paymentIntentId,
      facts.chargeId ?? null,
      facts.receivedMinor,
      facts.receivedCurrency ? facts.receivedCurrency.toUpperCase() : null,
      extra.agreed?.amountMinor ?? null,
      extra.agreed?.currency ?? null,
      reason,
      extra.detail ? extra.detail.slice(0, 500) : null,
      extra.autoRefund ?? "not_applicable",
      facts.eventId ?? null
    );
  const review = (await reviewForSession(facts.sessionId, tx))!;
  // A reopened case (e.g. org suspended first, then the place was gone): keep
  // the existing row, but record the current reason while it's still open.
  if (!info.changes && review.status === "open" && review.reason !== reason && reason !== "association_unverified") {
    await tx.prepare(`UPDATE payment_reviews SET reason = ?, detail = COALESCE(?, detail), auto_refund = IF(auto_refund IN ('not_applicable', 'disabled', 'ineligible'), ?, auto_refund), payment_intent_id = COALESCE(payment_intent_id, ?) WHERE id = ? AND status = 'open'`)
      .run(reason, extra.detail ?? null, extra.autoRefund ?? "not_applicable", facts.paymentIntentId, review.id);
    return { review: (await getReview(review.id, tx))!, created: false };
  }
  if (!info.changes && facts.paymentIntentId && !review.paymentIntentId) await tx.prepare(`UPDATE payment_reviews SET payment_intent_id = ? WHERE id = ?`).run(facts.paymentIntentId, review.id);
  return { review, created: info.changes === 1 };
}

// --- alerts -----------------------------------------------------------------------

const ALERT_TEXT: Record<string, (r: ReviewRow) => { title: string; body: string }> = {
  parked: (r) => ({ title: "Payment under review", body: `${orderLabel(r)}: ${REASON_TEXT[r.reason]}. ${r.reviewHoldUntil ? `Place held until ${irishTime(r.reviewHoldUntil)}.` : "No place is held."}` }),
  urgent: (r) => ({ title: "URGENT: payment under review, starts soon", body: `${orderLabel(r)}: ${REASON_TEXT[r.reason]}. ${r.urgency === "after_start" ? "It has already started" : "It starts within the lead time"}, so no place is held and it can't be confirmed. Contact the customer.` }),
  halfway: (r) => ({ title: "Payment review: halfway to its deadline", body: `${orderLabel(r)}: the place is held until ${irishTime(r.reviewHoldUntil)}.` }),
  expired: (r) => ({ title: "Payment review deadline passed — place released", body: `${orderLabel(r)}: the hold ended and the place was released. The payment (${money(r.receivedMinor, r.receivedCurrency)}) is still under review; nothing was refunded.` }),
  shortened: (r) => ({ title: "URGENT: payment review hold ended early", body: `${orderLabel(r)}: the session moved, so the hold ended now and the place was released. The payment is still under review.` }),
  unfulfilled: (r) => ({ title: "Paid order couldn't be fulfilled", body: `${orderLabel(r)}: ${REASON_TEXT[r.reason]}. The payment (${money(r.receivedMinor, r.receivedCurrency)}) needs a finance decision.` }),
  auto_refund_ineligible: (r) => ({ title: "Automatic refund not made — finance review", body: `${orderLabel(r)}: ${r.autoRefundNote ?? "a precondition didn't hold"}.` }),
  refund_failed: (r) => ({ title: "Automatic refund failed", body: `${orderLabel(r)}: the provider refused the refund. Nothing was refunded; it won't be retried automatically.` }),
  refund_uncertain: (r) => ({ title: "Automatic refund outcome unknown", body: `${orderLabel(r)}: the provider's answer wasn't received. Run "Recheck with Stripe" before doing anything else — don't refund again.` }),
};

export const REASON_TEXT: Record<ReviewReason, string> = {
  amount_mismatch: "the amount charged differs from the agreed amount",
  currency_mismatch: "the currency charged differs from the agreed currency",
  association_unverified: "the payment couldn't be tied to an order",
  org_suspended: "the organisation is suspended",
  capacity_unavailable: "the place was no longer available",
  listing_unavailable: "the listing or session can no longer be sold",
  after_start: "it had already started when the payment arrived",
  mid_programme: "the programme had already started; joining part-way needs a decision",
  order_cancelled: "the order had been cancelled before the payment arrived",
  provider_state: "Stripe shows a refund, dispute or unsettled charge on it",
};

const orderLabel = (r: ReviewRow) => (r.sourceType && r.sourceRef ? `${r.sourceType} ${r.sourceRef}` : `session ${r.checkoutSessionId}`);
const money = (minor: number | null, cur: string | null) => (minor === null ? "amount unknown" : `${(cur ?? "EUR").toUpperCase() === "EUR" ? "€" : `${cur} `}${(minor / 100).toFixed(2)}`);
const irishTime = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-IE", { timeZone: "Europe/Dublin", dateStyle: "medium", timeStyle: "short" }) : "—");

/** Sends one alert of this kind for this review, at most once ever (the
 * alert row is the claim). In-app notifications for finance and super admins
 * are written in the same transaction as the claim; emails follow and are
 * best-effort (logged, never blocking). */
export async function raiseAlert(reviewId: number, kind: keyof typeof ALERT_TEXT): Promise<boolean> {
  const sent = await db.transaction(async (tx) => {
    const claim = await tx.prepare(`INSERT IGNORE INTO payment_review_alerts (review_id, kind) VALUES (?, ?)`).run(reviewId, kind);
    if (claim.changes !== 1) return null;
    const review = (await getReview(reviewId, tx))!;
    const text = ALERT_TEXT[kind](review);
    const admins = (await tx.prepare(`SELECT id, email FROM users WHERE role = 'admin' AND status = 'approved' AND admin_role IN ('finance', 'super')`).all()) as { id: string; email: string }[];
    for (const a of admins) {
      await tx
        .prepare(`INSERT INTO notifications (recipient_id, kind, title, body, listing_type, listing_id, ref) VALUES (?, 'payment_review', ?, ?, 'payment_review', ?, ?)`)
        .run(a.id, text.title.slice(0, 255), text.body, String(reviewId), review.sourceRef ?? review.checkoutSessionId);
    }
    return { admins, text };
  });
  if (!sent) return false;
  for (const a of sent.admins) {
    await sendMail({ to: a.email, subject: `[Hello Circle finance] ${sent.text.title}`, text: `${sent.text.body}\n\nOpen Finance → Payment reviews → review #${reviewId}.` }).catch((e) => console.error("[payments] review alert email failed:", e));
  }
  return true;
}

// --- case 1 / case 2: a paid event that didn't match its agreement -------------------

/** Records a verified payment that can't be confirmed because it doesn't match
 * its checkout agreement. Case 1 (amount or currency differs, order verified):
 * the place is held until the stored deadline when one is possible and the
 * place is still free. Case 2 (association unverified): recorded, never holds.
 * The caller then parks the event (NeedsReviewError). */
export async function recordUnmatchedPayment(facts: PaymentFacts, check: Extract<AgreementCheck, { ok: false }>): Promise<ReviewRow> {
  if (check.kind === "association" || !isOrderType(facts.type) || !facts.ref) {
    const { review, created } = await db.transaction((tx) => openReview(tx, facts, "association_unverified", { detail: check.reason }));
    if (created) {
      await audit("payment.review_opened", review, { reason: review.reason, detail: check.reason, hold: "none" });
      await raiseAlert(review.id, "parked");
    }
    return review;
  }
  const type = facts.type;
  const ref = facts.ref;
  const reason: ReviewReason = check.kind === "currency" ? "currency_mismatch" : "amount_mismatch";
  const outcome = await db.transaction(async (tx) => {
    // Same lock order as checkout: parent row, then the order row.
    await tx.prepare(PARENT_LOCK[type]).get(ref);
    const row = (await tx.prepare(`SELECT * FROM ${ORDER_TABLE[type]} WHERE ref = ? FOR UPDATE`).get(ref)) as Record<string, any> | undefined;
    const { review, created } = await openReview(tx, facts, reason, { detail: check.reason, agreed: check.agreed });
    if (!created) return { review, created };
    const start = await orderStart(tx, type, ref);
    const now = new Date();
    let { holdUntil, urgency } = reviewDeadline(now, start.startAt);
    if (start.started) urgency = "after_start";
    let note: string | null = start.midProgramme ? "The programme has already started; joining part-way needs a decision." : null;
    const pending = row && row.payment_status === "pending" && row.status !== "cancelled";
    if (holdUntil && pending && HOLDING_TYPES.includes(type)) {
      // Never let a review take back a place that was already released and
      // re-sold: the hold is only created while the order still fits.
      const fits = orderHoldLive(type, row!) || ((await listingEligible(tx, type, row!)) && (await orderFits(tx, type, row!)));
      if (fits) {
        await tx.prepare(`UPDATE ${ORDER_TABLE[type]} SET review_hold_until = ? WHERE ref = ?`).run(sqlDate(holdUntil), ref);
        await tx.prepare(`UPDATE payment_reviews SET hold_status = 'held', review_hold_until = ?, start_at = ?, urgency = ?, detail = CONCAT_WS(' ', detail, ?) WHERE id = ?`).run(sqlDate(holdUntil), start.startAt ? sqlDate(start.startAt) : null, urgency, note, review.id);
        return { review: (await getReview(review.id, tx))!, created };
      }
      note = [note, "The place had already been released and taken, so no place is held."].filter(Boolean).join(" ");
    }
    await tx.prepare(`UPDATE payment_reviews SET hold_status = 'none', start_at = ?, urgency = ?, detail = CONCAT_WS(' ', detail, ?) WHERE id = ?`).run(start.startAt ? sqlDate(start.startAt) : null, urgency, note, review.id);
    return { review: (await getReview(review.id, tx))!, created };
  });
  if (outcome.created) {
    const r = outcome.review;
    await audit("payment.review_opened", r, { reason: r.reason, hold: r.holdStatus, reviewHoldUntil: r.reviewHoldUntil, urgency: r.urgency, receivedMinor: r.receivedMinor, agreedMinor: r.agreedMinor });
    await raiseAlert(r.id, r.urgency === "within_lead" || r.urgency === "after_start" ? "urgent" : "parked");
  }
  return outcome.review;
}

// --- unfulfilled matching payments (cases 4 / 4b and the other "can't confirm" reasons) ---

/** Called after confirmation found a correctly-matched payment it couldn't
 * confirm. Opens/refreshes the review, alerts finance and, for cases 4 and 4b
 * only, attempts the D-10 automatic refund. Re-entrant: a redelivery or a
 * crash recovery re-runs the same steps without repeating any. Returns true
 * when an automatic refund was requested or made (the order is then settled
 * as paid + cancelled + refund). */
export async function handleUnfulfilled(reviewId: number): Promise<ReviewRow> {
  const review = (await getReview(reviewId))!;
  if (review.autoRefund === "pending_check") await attemptAutoRefund(review.id);
  const after = (await getReview(reviewId))!;
  // Finance hears about it unless the automatic refund settled it.
  // (Ineligible, failed and uncertain refunds already raised their own alert.)
  if (after.status === "open" && !["requested", "provider_pending", "succeeded", "failed", "uncertain", "ineligible"].includes(after.autoRefund)) {
    await raiseAlert(after.id, after.reason === "org_suspended" ? "parked" : "unfulfilled");
  }
  return after;
}

/** Closes an open review because a later delivery confirmed the order (e.g.
 * after reinstatement). Releases any hold bookkeeping; resolves parked events
 * for the same session. */
export async function resolveConfirmed(sessionId: string | null, type: string, ref: string): Promise<void> {
  const review = sessionId ? await reviewForSession(sessionId) : null;
  if (!review || review.status !== "open") return;
  const closed = await db.prepare(`UPDATE payment_reviews SET status = 'resolved', resolution = 'confirmed', resolved_at = NOW(), hold_status = IF(hold_status = 'held', 'consumed', hold_status) WHERE id = ? AND status = 'open'`).run(review.id);
  if (closed.changes !== 1) return;
  await resolveParkedEvents(review, "confirmed by a later verified delivery");
  await audit("payment.review_resolved", review, { resolution: "confirmed", type, ref });
}

/** Marks the review's parked webhook events resolved (Finance's event queue). */
async function resolveParkedEvents(review: ReviewRow, resolution: string, tx: Tx = db) {
  await tx
    .prepare(
      `UPDATE webhook_events SET status = 'resolved', resolved_at = NOW(), resolution = ?
       WHERE status IN ('manual_review', 'failed') AND (object_id = ? OR (? IS NOT NULL AND JSON_UNQUOTE(JSON_EXTRACT(summary, '$.payment_intent')) = ?))`
    )
    .run(`${resolution} (payment review #${review.id})`.slice(0, 255), review.checkoutSessionId, review.paymentIntentId, review.paymentIntentId);
}

// --- automatic refund (D-10, cases 4 and 4b only) ---------------------------------------

const REFUNDABLE_REASONS: ReviewReason[] = ["capacity_unavailable", "org_suspended"];

/** The D-10 automatic refund. Every precondition is re-proved from the
 * provider and the database at this moment; any doubt goes to finance. The
 * refund row (unique key auto-refund:<charge>) is committed BEFORE the
 * provider call, the provider call runs outside any transaction with the same
 * idempotency key, and an unanswered call is recorded as "unknown" — it is
 * never retried with a new key. */
export async function attemptAutoRefund(reviewId: number): Promise<AutoRefund> {
  const claim = await db.prepare(`UPDATE payment_reviews SET auto_refund = 'checking' WHERE id = ? AND auto_refund = 'pending_check' AND status = 'open'`).run(reviewId);
  if (claim.changes !== 1) return ((await getReview(reviewId))?.autoRefund ?? "not_applicable") as AutoRefund;
  const review = (await getReview(reviewId))!;
  const stop = async (state: AutoRefund, note: string, alert: keyof typeof ALERT_TEXT | null = "auto_refund_ineligible") => {
    await db.prepare(`UPDATE payment_reviews SET auto_refund = ?, auto_refund_note = ? WHERE id = ?`).run(state, note.slice(0, 255), reviewId);
    await audit("payment.auto_refund_not_made", review, { state, note });
    if (alert) await raiseAlert(reviewId, alert);
    return state;
  };
  if (!REFUNDABLE_REASONS.includes(review.reason) || !isOrderType(review.sourceType) || !review.sourceRef) return stop("not_applicable", "Not an automatic-refund case", null);
  const type = review.sourceType;
  const ref = review.sourceRef;
  if (type === "pass") return stop("ineligible", "Pass refunds aren't supported automatically");
  if (!(await autoRefundSwitchOn())) return stop("disabled", "Automatic refunds are switched off", null);
  const provider = paymentProvider();
  if (!provider) return stop("ineligible", "Payments aren't configured on this server");

  // 1. Verified event state, re-fetched from the provider (never the stored payload).
  let snap: PaymentSnapshot;
  try {
    snap = await provider.paymentSnapshot(review.checkoutSessionId);
  } catch (e) {
    return stop("ineligible", `Couldn't read the payment from the provider (${errorText(e)})`);
  }
  // 2. Verified association.
  const check = await checkCheckoutAgreement({ id: snap.session.id, amount_total: snap.session.amountTotal, currency: snap.session.currency, metadata: snap.session.metadata });
  if (!check.ok) return stop("ineligible", `Association or amount not verified: ${check.reason}`);
  if (snap.session.metadata.type !== type || snap.session.metadata.ref !== ref) return stop("ineligible", "Session metadata doesn't match this order");
  // 3. Expected provider state.
  const charge = snap.charge;
  if (!charge) return stop("ineligible", "The provider shows no charge for this payment");
  const total = (await db.prepare(`SELECT ${ORDER_TOTAL[type]} AS total FROM ${ORDER_TABLE[type]} WHERE ref = ?`).get(ref)) as { total: number | string } | undefined;
  const agreedMinor = check.agreed?.amountMinor ?? Number(total?.total ?? -1);
  const agreedCurrency = (check.agreed?.currency ?? "EUR").toUpperCase();
  if (charge.status !== "succeeded") return stop("ineligible", `Charge status is ${charge.status}`);
  if (charge.currency.toUpperCase() !== agreedCurrency) return stop("ineligible", `Charge currency ${charge.currency.toUpperCase()} ≠ agreed ${agreedCurrency}`);
  if (charge.amountMinor !== agreedMinor) return stop("ineligible", `Charge amount ${charge.amountMinor} ≠ agreed ${agreedMinor}`);
  if (charge.disputed || snap.disputes.length) return stop("ineligible", "The payment is disputed");
  if (charge.amountRefundedMinor !== 0 || snap.refunds.length) return stop("ineligible", "The provider already shows a refund on this charge");
  // 4. Recorded state agrees (no refund row of any status; no separate open review for this order).
  if (await db.prepare(`SELECT id FROM refunds WHERE (source_type = ? AND source_ref = ?) OR idempotency_key = ? LIMIT 1`).get(type, ref, `auto-refund:${charge.id}`)) return stop("ineligible", "A refund is already recorded for this order");
  const other = await db.prepare(`SELECT id FROM payment_reviews WHERE source_type = ? AND source_ref = ? AND status = 'open' AND checkout_session_id != ? LIMIT 1`).get(type, ref, review.checkoutSessionId);
  if (other) return stop("ineligible", "Another open payment review exists for this order");

  // 5. Can't be fulfilled — re-proved under the order lock, and the refund row is claimed in the same transaction.
  const key = `auto-refund:${charge.id}`;
  const claimed = await db
    .transaction(async (tx) => {
      await tx.prepare(PARENT_LOCK[type]).get(ref);
      const row = (await tx.prepare(`SELECT * FROM ${ORDER_TABLE[type]} WHERE ref = ? FOR UPDATE`).get(ref)) as Record<string, any> | undefined;
      if (!row) return "Order no longer exists";
      if (review.reason === "org_suspended") {
        if (row.payment_status !== "pending") return "The order is no longer pending";
        if (!(await orgSuspendedForVendor(tx, await supplyVendorForOrder(type, ref, tx)))) return "The organisation is no longer suspended";
        await tx.prepare(`UPDATE ${ORDER_TABLE[type]} SET payment_status = 'paid', status = 'cancelled', review_hold_until = NULL WHERE ref = ? AND payment_status = 'pending'`).run(ref);
      } else if (!(row.payment_status === "paid" && row.status === "cancelled")) return "The order isn't in the paid-but-not-fulfilled state";
      if (await tx.prepare(`SELECT id FROM refunds WHERE source_type = ? AND source_ref = ? LIMIT 1`).get(type, ref)) return "A refund is already recorded for this order";
      await tx
        .prepare(
          `INSERT INTO refunds (source_type, source_ref, payment_record_id, idempotency_key, amount_minor, currency, kind, origin, responsible, reason, status)
           VALUES (?, ?, (SELECT id FROM payment_records WHERE source_type = ? AND source_ref = ?), ?, ?, ?, 'full', 'auto', 'platform', ?, 'pending')`
        )
        .run(type, ref, type, ref, key, charge.amountMinor, agreedCurrency, review.reason === "org_suspended" ? "Automatic refund: the organisation is suspended (D-10 case 4b)" : "Automatic refund: the place was no longer available (D-10 case 4)");
      await tx.prepare(`UPDATE payment_reviews SET auto_refund = 'requested', charge_id = ?, payment_intent_id = COALESCE(payment_intent_id, ?), hold_status = IF(hold_status = 'held', 'released', hold_status) WHERE id = ?`).run(charge.id, snap.paymentIntentId, reviewId);
      return null;
    })
    .catch((e: unknown) => ((e as { code?: string })?.code === "ER_DUP_ENTRY" ? "A refund is already recorded for this order" : Promise.reject(e)));
  if (claimed) return stop("ineligible", claimed);
  if (review.reason === "org_suspended") {
    // The money was received: record it (payment record + ledger) before it goes back.
    await recordPaymentConfirmed({ type: type as CheckoutType, ref, checkoutSessionId: review.checkoutSessionId, paymentIntentId: snap.paymentIntentId, amountMinor: charge.amountMinor, currency: agreedCurrency, provider: provider.name === "stub" ? "stub" : "stripe" });
    await db.prepare(`UPDATE refunds SET payment_record_id = (SELECT id FROM payment_records WHERE source_type = ? AND source_ref = ?) WHERE idempotency_key = ?`).run(type, ref, key);
  }
  await audit("payment.auto_refund_requested", review, { chargeId: charge.id, amountMinor: charge.amountMinor, currency: agreedCurrency, idempotencyKey: key });

  // Provider call — outside any transaction, same idempotency key, bounded wait.
  let result: { id: string | null; status?: string | null };
  try {
    result = await withTimeout(provider.createRefund({ paymentIntentId: snap.paymentIntentId!, idempotencyKey: key, metadata: { hc_refund_key: key, hc_type: type, hc_ref: ref, hc_checkout_session: review.checkoutSessionId } }), refundTimeoutMs());
  } catch (e) {
    const uncertain = isUncertainProviderError(e);
    await db.prepare(`UPDATE refunds SET status = ?, last_error = ? WHERE idempotency_key = ? AND status = 'pending'`).run(uncertain ? "unknown" : "failed", errorText(e).slice(0, 500), key);
    await db.prepare(`UPDATE payment_reviews SET auto_refund = ?, auto_refund_note = ? WHERE id = ?`).run(uncertain ? "uncertain" : "failed", (uncertain ? "No answer from the provider — recheck before doing anything" : `Provider refused: ${errorText(e)}`).slice(0, 255), reviewId);
    await audit(uncertain ? "payment.auto_refund_uncertain" : "payment.auto_refund_failed", review, { idempotencyKey: key, error: errorText(e) });
    await raiseAlert(reviewId, uncertain ? "refund_uncertain" : "refund_failed");
    await syncOrderFromSource(type as CheckoutType, ref).catch(() => undefined);
    return uncertain ? "uncertain" : "failed";
  }
  const state = await applyAutoRefundResult(reviewId, key, result.id, result.status ?? "succeeded");
  await syncOrderFromSource(type as CheckoutType, ref).catch(() => undefined);
  if (state === "succeeded") await notifyCustomerRefund(type, ref, charge.amountMinor, review.reason).catch((e) => console.error("[payments] refund email failed:", e));
  return state;
}

/** Records the provider's answer to our refund call (or one found later). */
async function applyAutoRefundResult(reviewId: number, key: string, providerRefundId: string | null, providerStatus: string): Promise<AutoRefund> {
  const status = providerStatus === "succeeded" ? "succeeded" : providerStatus === "failed" || providerStatus === "canceled" ? "failed" : "pending";
  return db.transaction(async (tx) => {
    const refund = (await tx.prepare(`SELECT id, source_type AS type, source_ref AS ref, amount_minor AS amount, status FROM refunds WHERE idempotency_key = ? FOR UPDATE`).get(key)) as { id: number; type: OrderType; ref: string; amount: number | string; status: string } | undefined;
    if (!refund) return "failed" as AutoRefund;
    const wasSucceeded = refund.status === "succeeded";
    await tx.prepare(`UPDATE refunds SET status = ?, provider_refund_id = COALESCE(provider_refund_id, ?), last_error = NULL WHERE id = ?`).run(status, providerRefundId, refund.id);
    if (status === "succeeded" && !wasSucceeded) {
      const total = (await tx.prepare(`SELECT ${ORDER_TOTAL[refund.type]} AS t FROM ${ORDER_TABLE[refund.type]} WHERE ref = ? FOR UPDATE`).get(refund.ref)) as { t: number | string };
      await tx.prepare(`UPDATE ${ORDER_TABLE[refund.type]} SET payment_status = 'refunded' WHERE ref = ? AND payment_status = 'paid'`).run(refund.ref);
      await postRefund(tx, refund.type, refund.ref, refund.id, Number(refund.amount), Number(total.t) || Number(refund.amount), null);
      await tx.prepare(`UPDATE payment_reviews SET auto_refund = 'succeeded', status = 'resolved', resolution = 'auto_refunded', resolved_at = NOW() WHERE id = ? AND status = 'open'`).run(reviewId);
      const review = (await getReview(reviewId, tx))!;
      await resolveParkedEvents(review, "refunded automatically", tx);
      return "succeeded" as AutoRefund;
    }
    if (status === "failed") {
      await tx.prepare(`UPDATE payment_reviews SET auto_refund = 'failed', auto_refund_note = 'The provider reports the refund failed' WHERE id = ?`).run(reviewId);
      return "failed" as AutoRefund;
    }
    await tx.prepare(`UPDATE payment_reviews SET auto_refund = 'provider_pending' WHERE id = ? AND auto_refund IN ('requested', 'uncertain')`).run(reviewId);
    return "provider_pending" as AutoRefund;
  });
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(Object.assign(new Error(`No answer from the provider within ${ms} ms`), { type: "HcTimeout" })), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      }
    );
  });
}

/** A connection problem, timeout, rate limit or provider-side 5xx: the refund
 * may or may not exist. Anything else is a definite refusal. */
export function isUncertainProviderError(e: unknown): boolean {
  const err = e as { type?: string; statusCode?: number; code?: string };
  if (!err || typeof err !== "object") return true;
  if (["HcTimeout", "StripeConnectionError", "StripeAPIError", "StripeRateLimitError", "StripeIdempotencyError"].includes(String(err.type))) return true;
  if (typeof err.statusCode === "number" && err.statusCode >= 500) return true;
  return !["StripeInvalidRequestError", "StripeCardError", "StripePermissionError", "StripeAuthenticationError"].includes(String(err.type));
}
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

const REFUND_EMAIL_WHY: Partial<Record<ReviewReason, string>> = {
  org_suspended: "this provider isn't taking bookings right now",
  capacity_unavailable: "the place was no longer available when your payment came through",
  amount_mismatch: "the amount charged didn't match what was agreed at checkout",
  currency_mismatch: "the currency charged didn't match what was agreed at checkout",
  listing_unavailable: "the listing or session is no longer available",
  after_start: "it had already started when your payment came through",
  mid_programme: "the programme had already started when your payment came through",
  order_cancelled: "it had already been cancelled when your payment came through",
};

async function notifyCustomerRefund(type: OrderType, ref: string, amountMinor: number, reason: ReviewReason) {
  const contact: Record<OrderType, string> = {
    booking: `SELECT email, name FROM bookings WHERE ref = ?`,
    registration: `SELECT email, CONCAT(g_first, ' ', g_last) AS name FROM registrations WHERE ref = ?`,
    program: `SELECT email, participant_name AS name FROM program_enrollments WHERE ref = ?`,
    experience: `SELECT email, participant_name AS name FROM experience_bookings WHERE ref = ?`,
    game: `SELECT r.email, r.name FROM game_participants gp JOIN residents r ON r.id = gp.resident_id WHERE gp.ref = ?`,
    pass: `SELECT r.email, r.name FROM passes p JOIN residents r ON r.id = p.resident_id WHERE p.ref = ?`,
  };
  const who = (await db.prepare(contact[type]).get(ref)) as { email: string; name: string } | undefined;
  if (!who?.email) return;
  const amount = `€${(amountMinor / 100).toFixed(2)}`;
  const why = REFUND_EMAIL_WHY[reason] ?? "it couldn't be confirmed";
  await sendMail({
    to: who.email,
    subject: `Your booking wasn't confirmed — ${amount} refunded (${ref})`,
    text: `Hi ${who.name || "there"},\n\nWe couldn't confirm your booking ${ref} because ${why}. We've refunded ${amount}. It can take a few business days to show up, depending on your bank.\n\nSorry about this.\n\nHello Circle`,
  });
}

// --- sweep (restart-safe) ---------------------------------------------------------------

/** Every 5 minutes and at startup. Each step is a conditional state change,
 * so repeated sweeps, retries, restarts or two processes never repeat an
 * alert or an expiry. Expiry releases the place only; it never creates a
 * refund row or calls the provider. */
export async function sweepPaymentReviews(): Promise<{ halfway: number; expired: number; uncertain: number; resumed: number }> {
  const out = { halfway: 0, expired: 0, uncertain: 0, resumed: 0 };
  const half = (await db
    .prepare(
      `SELECT id FROM payment_reviews WHERE status = 'open' AND hold_status = 'held' AND review_hold_until > NOW()
         AND NOW() >= flagged_at + INTERVAL FLOOR(TIMESTAMPDIFF(SECOND, flagged_at, review_hold_until) / 2) SECOND`
    )
    .all()) as { id: number }[];
  for (const r of half) if (await raiseAlert(Number(r.id), "halfway")) out.halfway++;

  const due = (await db.prepare(`SELECT id FROM payment_reviews WHERE hold_status = 'held' AND review_hold_until <= NOW()`).all()) as { id: number }[];
  for (const r of due) {
    const changed = await db.prepare(`UPDATE payment_reviews SET hold_status = 'expired' WHERE id = ? AND hold_status = 'held' AND review_hold_until <= NOW()`).run(Number(r.id));
    if (changed.changes !== 1) continue;
    const review = (await getReview(Number(r.id)))!;
    await audit("payment.review_hold_expired", review, { reviewHoldUntil: review.reviewHoldUntil, refund: "none" });
    if (review.status === "open") await raiseAlert(review.id, "expired");
    out.expired++;
  }

  // A process that stopped between claiming a refund and recording the
  // provider's answer leaves it "pending" with no provider id: mark it
  // unknown for finance (recheck), never re-send it.
  const stale = (await db
    .prepare(`SELECT id, idempotency_key AS k, source_type AS t, source_ref AS r FROM refunds WHERE origin = 'auto' AND status = 'pending' AND provider_refund_id IS NULL AND created_at < NOW() - INTERVAL 10 MINUTE`)
    .all()) as { id: number; k: string; t: string; r: string }[];
  for (const s of stale) {
    const changed = await db.prepare(`UPDATE refunds SET status = 'unknown', last_error = 'No provider answer was recorded (the process may have stopped) — recheck with Stripe' WHERE id = ? AND status = 'pending' AND provider_refund_id IS NULL`).run(s.id);
    if (changed.changes !== 1) continue;
    const review = normalise((await db.prepare(`SELECT ${REVIEW_COLUMNS} FROM payment_reviews WHERE source_type = ? AND source_ref = ? AND auto_refund IN ('requested', 'checking') ORDER BY id DESC LIMIT 1`).get(s.t, s.r)) as Record<string, unknown> | undefined);
    if (review) {
      await db.prepare(`UPDATE payment_reviews SET auto_refund = 'uncertain', auto_refund_note = 'No provider answer was recorded — recheck before doing anything' WHERE id = ?`).run(review.id);
      await raiseAlert(review.id, "refund_uncertain");
    }
    out.uncertain++;
  }

  // A process that stopped mid-check (claimed, nothing written): check again.
  // Safe: the refund-row precondition stops a second refund.
  const stuck = (await db.prepare(`SELECT id FROM payment_reviews WHERE auto_refund = 'checking' AND updated_at < NOW() - INTERVAL 10 MINUTE`).all()) as { id: number }[];
  for (const r of stuck) {
    const changed = await db.prepare(`UPDATE payment_reviews SET auto_refund = 'pending_check' WHERE id = ? AND auto_refund = 'checking'`).run(Number(r.id));
    if (changed.changes === 1) {
      await attemptAutoRefund(Number(r.id));
      out.resumed++;
    }
  }
  return out;
}

// --- rescheduling: a hold can only get shorter ---------------------------------------------

/** After a session/slot moves, re-derive S for every held order on it and
 * apply D = min(stored D, new S − L). A hold whose new deadline has passed
 * ends now (urgent alert). Never moves a deadline later. */
export async function shortenReviewHolds(type: OrderType, refs: string[]): Promise<number> {
  let ended = 0;
  for (const ref of refs) {
    const review = normalise((await db.prepare(`SELECT ${REVIEW_COLUMNS} FROM payment_reviews WHERE source_type = ? AND source_ref = ? AND hold_status = 'held' ORDER BY id DESC LIMIT 1`).get(type, ref)) as Record<string, unknown> | undefined);
    if (!review || !review.reviewHoldUntil) continue;
    const res = await db.transaction(async (tx) => {
      const start = await orderStart(tx, type, ref);
      if (!start.startAt) return null;
      const stored = new Date(review.reviewHoldUntil!).getTime();
      const latest = start.startAt.getTime() - reviewLeadHours() * 3_600_000;
      const next = Math.min(stored, latest);
      if (next === stored) return null;
      const now = Date.now();
      if (next <= now) {
        await tx.prepare(`UPDATE ${ORDER_TABLE[type]} SET review_hold_until = NULL WHERE ref = ?`).run(ref);
        await tx.prepare(`UPDATE payment_reviews SET hold_status = 'released', review_hold_until = ?, start_at = ?, urgency = ? WHERE id = ? AND hold_status = 'held'`).run(sqlDate(new Date(now)), sqlDate(start.startAt), start.startAt.getTime() <= now ? "after_start" : "within_lead", review.id);
        return "ended" as const;
      }
      await tx.prepare(`UPDATE ${ORDER_TABLE[type]} SET review_hold_until = ? WHERE ref = ? AND review_hold_until > ?`).run(sqlDate(new Date(next)), ref, sqlDate(new Date(next)));
      await tx.prepare(`UPDATE payment_reviews SET review_hold_until = ?, start_at = ?, urgency = 'starts_soon' WHERE id = ? AND hold_status = 'held'`).run(sqlDate(new Date(next)), sqlDate(start.startAt), review.id);
      return "shortened" as const;
    });
    if (!res) continue;
    await audit("payment.review_hold_shortened", review, { previousDeadline: review.reviewHoldUntil, outcome: res });
    if (res === "ended") {
      await raiseAlert(review.id, "shortened");
      ended++;
    }
  }
  return ended;
}

/** Order refs on a moved game / programme with a held review. */
export async function heldRefsFor(type: "game" | "program", parentId: string): Promise<string[]> {
  const sql = type === "game" ? `SELECT ref FROM game_participants WHERE game_id = ? AND review_hold_until IS NOT NULL` : `SELECT ref FROM program_enrollments WHERE program_id = ? AND review_hold_until IS NOT NULL`;
  return ((await db.prepare(sql).all(parentId)) as { ref: string }[]).map((r) => r.ref);
}

/** True while this order has an open payment review (customer reschedule guard). */
export async function hasOpenReview(type: string, ref: string): Promise<boolean> {
  return !!(await db.prepare(`SELECT id FROM payment_reviews WHERE source_type = ? AND source_ref = ? AND status = 'open' AND reason != 'association_unverified' LIMIT 1`).get(type, ref));
}

// --- D-11: Recheck with Stripe (reads only) --------------------------------------------------

export class RecheckError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export interface RecheckResult {
  outcome: "closed" | "open";
  reason: string;
  association: boolean;
  chargedMinor: number | null;
  succeededMinor: number;
  pendingMinor: number;
  failedMinor: number;
  disputed: boolean;
  recordedRefunds: number;
  updatedRefunds: number;
}

const REFUND_STATUS: Record<string, string> = { succeeded: "succeeded", pending: "pending", requires_action: "pending", failed: "failed", canceled: "canceled" };

/** Records the provider's refunds for this payment: inserts the ones not yet
 * known (keyed by provider refund id), attaches provider ids to our own
 * refund rows by their key, and updates statuses. Never creates a refund the
 * provider doesn't show; refunds in another currency than the charge are not
 * recorded (reported instead). Must run inside the caller's transaction,
 * which holds the order row lock. */
async function reconcileRefunds(tx: Tx, review: ReviewRow, snap: PaymentSnapshot): Promise<{ inserted: number; updated: number; currencyMismatch: boolean }> {
  let inserted = 0;
  let updated = 0;
  let currencyMismatch = false;
  if (!snap.charge || !isOrderType(review.sourceType) || !review.sourceRef) return { inserted, updated, currencyMismatch };
  const type = review.sourceType;
  const ref = review.sourceRef;
  const payment = (await tx.prepare(`SELECT id, amount_minor AS amount FROM payment_records WHERE source_type = ? AND source_ref = ?`).get(type, ref)) as { id: number; amount: number | string } | undefined;
  const total = (await tx.prepare(`SELECT ${ORDER_TOTAL[type]} AS t FROM ${ORDER_TABLE[type]} WHERE ref = ?`).get(ref)) as { t: number | string } | undefined;
  const paidMinor = Number(payment?.amount ?? total?.t ?? snap.charge.amountMinor);
  for (const r of snap.refunds) {
    if (r.currency.toUpperCase() !== snap.charge.currency.toUpperCase()) {
      currencyMismatch = true;
      continue;
    }
    const status = REFUND_STATUS[r.status] ?? "pending";
    type RefundRowLite = { id: number; status: string; amount: number | string };
    let row = (await tx.prepare(`SELECT id, status, amount_minor AS amount FROM refunds WHERE provider_refund_id = ? FOR UPDATE`).get(r.id)) as RefundRowLite | undefined;
    if (!row && r.key) {
      row = (await tx.prepare(`SELECT id, status, amount_minor AS amount FROM refunds WHERE idempotency_key = ? AND provider_refund_id IS NULL FOR UPDATE`).get(r.key)) as RefundRowLite | undefined;
      if (row) await tx.prepare(`UPDATE refunds SET provider_refund_id = ? WHERE id = ?`).run(r.id, row.id);
    }
    if (row) {
      const was = row.status;
      const mapped = was === "reconciled" && status === "succeeded" ? "reconciled" : status;
      if (mapped !== was) {
        await tx.prepare(`UPDATE refunds SET status = ?, last_error = NULL WHERE id = ?`).run(mapped, row.id);
        updated++;
        if ((mapped === "succeeded" || mapped === "reconciled") && was !== "succeeded" && was !== "reconciled") await postReviewRefund(tx, review, payment ? null : snap, row.id, Number(row.amount), paidMinor);
      }
      continue;
    }
    const info = await tx
      .prepare(
        `INSERT INTO refunds (source_type, source_ref, payment_record_id, provider_refund_id, idempotency_key, amount_minor, currency, kind, origin, responsible, reason, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'provider', 'platform', 'Refunded at the payment provider (found by recheck)', ?)`
      )
      .run(type, ref, payment?.id ?? null, r.id, `provider-refund:${r.id}`, r.amountMinor, r.currency.toUpperCase(), r.amountMinor >= snap.charge.amountMinor ? "full" : "partial", status);
    inserted++;
    if (status === "succeeded") await postReviewRefund(tx, review, payment ? null : snap, Number(info.lastInsertRowid), r.amountMinor, paidMinor);
  }
  return { inserted, updated, currencyMismatch };
}

/** Ledger for a refund found on a reviewed payment. With a payment record the
 * normal proportional reversal applies; a held receipt that was never applied
 * to an order is posted as received (unapplied) and then returned. */
async function postReviewRefund(tx: Tx, review: ReviewRow, heldSnap: PaymentSnapshot | null, refundId: number, amountMinor: number, paidMinor: number) {
  if (!heldSnap) return postRefund(tx, review.sourceType!, review.sourceRef!, refundId, amountMinor, paidMinor, null);
  if (!(await ledgerEnabled()) || !heldSnap.charge) return;
  const currency = heldSnap.charge.currency.toUpperCase();
  await postGroup(tx, {
    idempotencyKey: `held-receipt:${review.checkoutSessionId}`,
    sourceType: "payment_review",
    sourceId: String(review.id),
    description: `Payment received under review (${review.sourceType ?? "?"} ${review.sourceRef ?? review.checkoutSessionId})`,
    basis: "actual",
    currency,
    lines: [
      { account: "stripe_clearing", amountMinor: heldSnap.charge.amountMinor, memo: "payment received, not applied" },
      { account: "unapplied_receipts", amountMinor: -heldSnap.charge.amountMinor, memo: "held for review" },
    ],
  });
  await postGroup(tx, {
    idempotencyKey: `held-refund:${refundId}`,
    sourceType: "refund",
    sourceId: String(refundId),
    description: `Refund of a payment under review (review #${review.id})`,
    basis: "actual",
    currency,
    lines: [
      { account: "unapplied_receipts", amountMinor, memo: "returned to the customer" },
      { account: "stripe_clearing", amountMinor: -amountMinor, memo: "refund" },
    ],
  });
}

/** D-11 — finance re-reads the payment from the provider and reconciles.
 * Claimed atomically (a second concurrent recheck gets 409); a provider error
 * writes nothing; closes the review only when association is verified, the
 * provider's succeeded refunds equal the charge, nothing is pending and there
 * is no dispute. Never refunds, never marks anything paid, never restores a
 * booking. */
export async function recheckReview(reviewId: number, actorId: string, reason: string): Promise<RecheckResult> {
  const token = crypto.randomUUID();
  const claim = await db
    .prepare(`UPDATE payment_reviews SET recheck_claim = ?, recheck_claimed_at = NOW() WHERE id = ? AND (recheck_claim IS NULL OR recheck_claimed_at < NOW() - INTERVAL 5 MINUTE)`)
    .run(token, reviewId);
  if (claim.changes !== 1) {
    if (!(await getReview(reviewId))) throw new RecheckError("No payment review has this number", 404);
    throw new RecheckError("Someone is already rechecking this payment — try again in a moment", 409);
  }
  const release = () => db.prepare(`UPDATE payment_reviews SET recheck_claim = NULL, recheck_claimed_at = NULL WHERE id = ? AND recheck_claim = ?`).run(reviewId, token);
  try {
    const review = (await getReview(reviewId))!;
    const provider = paymentProvider();
    if (!provider) throw new RecheckError("Payments aren't configured on this server", 503);
    let snap: PaymentSnapshot;
    try {
      snap = await provider.paymentSnapshot(review.checkoutSessionId);
    } catch (e) {
      throw new RecheckError(`Couldn't read the payment from Stripe — nothing was changed (${errorText(e)})`, 502);
    }
    const association = await verifyAssociation(review, snap);
    const charge = snap.charge;
    const sum = (st: string) => snap.refunds.filter((r) => (REFUND_STATUS[r.status] ?? "pending") === st && charge && r.currency.toUpperCase() === charge.currency.toUpperCase()).reduce((a, r) => a + r.amountMinor, 0);
    const succeeded = sum("succeeded");
    const pending = sum("pending");
    const failed = sum("failed") + sum("canceled");
    const disputed = !!charge?.disputed || snap.disputes.length > 0;
    const result: RecheckResult = { outcome: "open", reason: "", association: association.ok, chargedMinor: charge?.amountMinor ?? null, succeededMinor: succeeded, pendingMinor: pending, failedMinor: failed, disputed, recordedRefunds: 0, updatedRefunds: 0 };

    const closedNow = await db.transaction(async (tx) => {
      if (association.ok && isOrderType(review.sourceType) && review.sourceRef) {
        await tx.prepare(`SELECT ref FROM ${ORDER_TABLE[review.sourceType]} WHERE ref = ? FOR UPDATE`).get(review.sourceRef);
        const rec = await reconcileRefunds(tx, review, snap);
        result.recordedRefunds = rec.inserted;
        result.updatedRefunds = rec.updated;
        if (rec.currencyMismatch) result.reason = "A refund at the provider is in a different currency from the charge — not recorded.";
        // Our own automatic refund, now settled at the provider.
        const auto = (await tx.prepare(`SELECT idempotency_key AS k, status FROM refunds WHERE source_type = ? AND source_ref = ? AND origin = 'auto' FOR UPDATE`).get(review.sourceType, review.sourceRef)) as { k: string; status: string } | undefined;
        if (auto && auto.status === "succeeded" && ["requested", "uncertain", "provider_pending", "failed"].includes(review.autoRefund)) {
          await tx.prepare(`UPDATE payment_reviews SET auto_refund = 'succeeded' WHERE id = ?`).run(review.id);
        }
      }
      const fully = !!charge && succeeded >= charge.amountMinor && charge.amountMinor > 0;
      const why = !association.ok
        ? `Association unverified: ${association.reason}`
        : !charge
          ? "Stripe shows no charge for this session"
          : disputed
            ? "The payment is disputed — the dispute flow takes over"
            : pending > 0
              ? `A refund of ${money(pending, charge.currency)} is still pending at Stripe`
              : !fully
                ? succeeded > 0
                  ? `Partly refunded (${money(succeeded, charge.currency)} of ${money(charge.amountMinor, charge.currency)}) — the rest is unresolved`
                  : "No refund at Stripe — finance must refund in the Stripe Dashboard or escalate"
                : null;
      const canClose = !why && !result.reason;
      if (!canClose) {
        result.reason = result.reason || why!;
        await tx.prepare(`UPDATE payment_reviews SET last_recheck_at = NOW(), last_recheck_outcome = ? WHERE id = ?`).run(`open: ${result.reason}`.slice(0, 500), review.id);
        return false;
      }
      if (review.status !== "open") {
        result.outcome = "closed";
        result.reason = "Already closed — nothing new recorded";
        await tx.prepare(`UPDATE payment_reviews SET last_recheck_at = NOW(), last_recheck_outcome = ? WHERE id = ?`).run("closed: already resolved", review.id);
        return false;
      }
      const type = review.sourceType as OrderType;
      const ref = review.sourceRef!;
      // Close: the order is refunded (never "failed"/unpaid — the money was
      // received and returned), not restored; any place is released.
      const row = (await tx.prepare(`SELECT payment_status AS ps, coupon_code AS coupon FROM ${ORDER_TABLE[type]} WHERE ref = ? FOR UPDATE`).get(ref)) as { ps: string; coupon: string | null } | undefined;
      if (row) {
        if (type === "pass") await tx.prepare(`UPDATE passes SET payment_status = 'refunded' WHERE ref = ? AND payment_status IN ('pending', 'paid')`).run(ref);
        else {
          await tx.prepare(`UPDATE ${ORDER_TABLE[type]} SET payment_status = 'refunded', status = 'cancelled', review_hold_until = NULL WHERE ref = ? AND payment_status IN ('pending', 'paid')`).run(ref);
          if (row.ps === "pending" && type !== "game") {
            await releaseCoupon(tx, row.coupon);
            await releaseRedemption(tx, ORDER_TABLE[type], ref);
          }
        }
      }
      const closed = await tx
        .prepare(`UPDATE payment_reviews SET status = 'resolved', resolution = 'refunded', resolved_at = NOW(), resolved_by = ?, hold_status = IF(hold_status IN ('held', 'expired'), 'released', hold_status), last_recheck_at = NOW(), last_recheck_outcome = 'closed: fully refunded at Stripe' WHERE id = ? AND status = 'open'`)
        .run(actorId, review.id);
      if (closed.changes !== 1) return false;
      await resolveParkedEvents(review, "closed by Recheck with Stripe — refunded at the provider", tx);
      result.outcome = "closed";
      result.reason = "Fully refunded at Stripe, nothing pending, no dispute";
      return true;
    });

    await writeAudit({
      actorUserId: actorId,
      actorKind: "user",
      action: "payment.review_rechecked",
      objectType: "payment_review",
      objectId: reviewAuditId(reviewId),
      reason,
      newValue: { ...result, checkoutSessionId: review.checkoutSessionId, paymentIntentId: snap.paymentIntentId, chargeId: charge?.id ?? null, providerRefunds: snap.refunds.map((r) => ({ id: r.id, amountMinor: r.amountMinor, status: r.status })), disputes: snap.disputes.map((d) => d.id) },
    });
    if (closedNow) {
      await audit("payment.review_resolved", review, { resolution: "refunded", by: actorId });
      // The customer's refund notification — once, because closing happens once.
      if (isOrderType(review.sourceType) && review.sourceRef) await notifyCustomerRefund(review.sourceType, review.sourceRef, succeeded, review.reason).catch((e) => console.error("[payments] refund email failed:", e));
      if (isOrderType(review.sourceType) && review.sourceType !== "pass") await syncOrderFromSource(review.sourceType as CheckoutType, review.sourceRef!).catch(() => undefined);
    }
    return result;
  } finally {
    await release();
  }
}

async function verifyAssociation(review: ReviewRow, snap: PaymentSnapshot): Promise<{ ok: boolean; reason: string }> {
  if (snap.session.id !== review.checkoutSessionId) return { ok: false, reason: "Stripe returned a different session" };
  if (!isOrderType(review.sourceType) || !review.sourceRef) return { ok: false, reason: "the payment isn't tied to an order" };
  if (snap.session.metadata.type !== review.sourceType || snap.session.metadata.ref !== review.sourceRef) return { ok: false, reason: "session metadata doesn't name this order" };
  const agreement = (await db.prepare(`SELECT source_type AS t, source_ref AS r FROM checkout_agreements WHERE session_id = ?`).get(review.checkoutSessionId)) as { t: string; r: string } | undefined;
  if (agreement) return agreement.t === review.sourceType && agreement.r === review.sourceRef ? { ok: true, reason: "" } : { ok: false, reason: "the checkout agreement names another order" };
  const row = (await db.prepare(`SELECT stripe_session_id AS sid FROM ${ORDER_TABLE[review.sourceType]} WHERE ref = ?`).get(review.sourceRef)) as { sid: string | null } | undefined;
  return row?.sid === review.checkoutSessionId ? { ok: true, reason: "" } : { ok: false, reason: "no checkout agreement and the order doesn't store this session" };
}

/** charge.refunded for a payment that has a review but no payment record:
 * record the provider's refunds (no closure — that's the D-11 recheck). */
export async function recordRefundsForReview(paymentIntentId: string): Promise<boolean> {
  const review = normalise((await db.prepare(`SELECT ${REVIEW_COLUMNS} FROM payment_reviews WHERE payment_intent_id = ? ORDER BY id DESC LIMIT 1`).get(paymentIntentId)) as Record<string, unknown> | undefined);
  if (!review || !isOrderType(review.sourceType) || !review.sourceRef || review.reason === "association_unverified") return false;
  const provider = paymentProvider();
  if (!provider) return false;
  const snap = await provider.paymentSnapshot(review.checkoutSessionId);
  if (!(await verifyAssociation(review, snap)).ok) return false;
  await db.transaction(async (tx) => {
    await tx.prepare(`SELECT ref FROM ${ORDER_TABLE[review.sourceType as OrderType]} WHERE ref = ? FOR UPDATE`).get(review.sourceRef);
    await reconcileRefunds(tx, review, snap);
  });
  return true;
}

// --- what the customer is told ----------------------------------------------------------------

export interface CustomerPaymentCase {
  state: "review" | "review_urgent" | "review_expired" | "refund_pending" | "refunded" | "not_fulfilled";
  reason: ReviewReason;
  receivedMinor: number | null;
  currency: string;
  refundedMinor: number;
  refundedAt: string | null;
}

/** The customer-facing state of a paid order that has (or had) a review.
 * Null when there's no review (the normal confirmation path applies). */
export async function customerPaymentCase(type: string, ref: string): Promise<CustomerPaymentCase | null> {
  if (!isOrderType(type)) return null;
  const review = normalise((await db.prepare(`SELECT ${REVIEW_COLUMNS} FROM payment_reviews WHERE source_type = ? AND source_ref = ? AND reason != 'association_unverified' ORDER BY id DESC LIMIT 1`).get(type, ref)) as Record<string, unknown> | undefined);
  if (!review) return null;
  const order = (await db.prepare(`SELECT payment_status AS ps FROM ${ORDER_TABLE[type]} WHERE ref = ?`).get(ref)) as { ps: string } | undefined;
  if (review.resolution === "confirmed" || (order?.ps === "paid" && review.status === "resolved" && review.resolution === "confirmed")) return null;
  const refunds = (await db.prepare(`SELECT amount_minor AS a, status, updated_at AS at FROM refunds WHERE source_type = ? AND source_ref = ? AND status IN ('pending', 'succeeded', 'reconciled', 'unknown')`).all(type, ref)) as { a: number | string; status: string; at: string }[];
  const done = refunds.filter((r) => r.status === "succeeded" || r.status === "reconciled");
  const refundedMinor = done.reduce((s, r) => s + Number(r.a), 0);
  const refundedAt = done.map((r) => r.at).sort().pop() ?? null;
  const base = { reason: review.reason, receivedMinor: review.receivedMinor, currency: review.receivedCurrency ?? "EUR", refundedMinor, refundedAt };
  if (order?.ps === "refunded") return { state: "refunded", ...base };
  if (refunds.some((r) => r.status === "pending" || r.status === "unknown") || ["requested", "provider_pending", "uncertain"].includes(review.autoRefund)) return { state: "refund_pending", ...base };
  if (order?.ps === "paid") return { state: "not_fulfilled", ...base };
  if (review.status !== "open") return null;
  if (review.urgency === "within_lead" || review.urgency === "after_start" || review.holdStatus === "released") return { state: "review_urgent", ...base };
  if (review.holdStatus === "expired") return { state: "review_expired", ...base };
  return { state: "review", ...base };
}

/** Audit object id for a review — distinct from other objects' numeric ids. */
export const reviewAuditId = (id: number) => `review-${id}`;

async function audit(action: string, review: ReviewRow, newValue: Record<string, unknown>) {
  await writeAudit({ actorUserId: null, action, objectType: "payment_review", objectId: reviewAuditId(review.id), newValue: { sourceType: review.sourceType, sourceRef: review.sourceRef, checkoutSessionId: review.checkoutSessionId, ...newValue } });
}
