import type { Request, Response } from "express";
import { createGameFromOpenBooking } from "./bookings.js";
import { applySubscriptionCheckout, applySubscriptionDeleted, applySubscriptionUpdate, recordInvoicePaid } from "../commerce/subscriptions.js";
import { upgradeFavouriteStatus } from "./favourites.js";
import { checkMinParticipantsThreshold } from "./games.js";
import { logEvent } from "../analytics.js";
import { computeCapacity } from "../capacity.js";
import { db } from "../db/index.js";
import { sendMail } from "../email.js";
import { notifyNewBookingOrRegistration, notifyResident } from "../notifications.js";
import { claimWaitlistOffer } from "../waitlist.js";
import { endPendingHold } from "../bookingIntegrity.js";
import { writeAudit } from "../audit.js";
import { CLIENT_URL, STRIPE_CONNECT_WEBHOOK_SECRET, STRIPE_V2_WEBHOOK_SECRET, STRIPE_WEBHOOK_SECRET, stripe } from "../stripe.js";
import { CONNECT_EVENT_TYPES, processConnectEvent, processThinConnectEvent } from "../payments/connect.js";
import { paymentProvider } from "../payments/provider.js";
import { unsignedStripeWebhooksAllowed } from "../stripeWebhookPolicy.js";
import type Stripe from "stripe";
import type { CheckoutType } from "../checkoutService.js";
import { SOURCE_TABLES, syncOrderFromSource } from "../commerce/engine.js";
import { checkCheckoutAgreement } from "../payments/checkoutAgreement.js";
import { HOLDING_TYPES, ORDER_TABLE, ORDER_TOTAL, PARENT_LOCK, isOrderType, listingEligible, orderFits, orderHoldLive, orderStart, type OrderType } from "../payments/orderState.js";
import { autoRefundSwitchOn, handleUnfulfilled, hasOpenReview, openReview, recordRefundsForReview, recordUnmatchedPayment, resolveConfirmed, reviewForSession, type AutoRefund, type PaymentFacts, type ReviewReason } from "../payments/paymentReview.js";
import { orgSuspendedForVendor, orgSuspendedReviewMessage, supplyVendorForOrder } from "../orgStatus.js";
import { NeedsReviewError, recordDispute, recordPaymentConfirmed, recordProviderRefunds } from "../commerce/payments.js";
import { beginEvent, failEvent, finishEvent, type IncomingEvent } from "../payments/webhookEvents.js";

interface BookingForNotify {
  ref: string;
  centre_id: string;
  centre_name: string;
  vendor_id: string | null;
  name: string;
  email: string;
  date: string;
  time: string;
  duration: number;
  guests: number;
  coupon_code: string | null;
  total_cents: number;
}

interface RegistrationForNotify {
  ref: string;
  club_id: string;
  club_name: string;
  vendor_id: string | null;
  g_first: string;
  g_last: string;
  email: string;
  child_first: string;
  child_last: string;
  dob: string;
  team: string;
  trial: number;
  coupon_code: string | null;
  total_cents: number;
}

/** What the provider told us about this payment (event or QA seam). */
export interface PaymentCtx {
  sessionId: string | null;
  paymentIntentId: string | null;
  amountMinor: number | null;
  currency: string | null;
  eventId: string | null;
  agreed: { amountMinor: number; currency: string } | null;
}
const NO_CTX: PaymentCtx = { sessionId: null, paymentIntentId: null, amountMinor: null, currency: null, eventId: null, agreed: null };

/** Phase 8 (HC-QA-041) + D-10 — settle one pending paid row under its
 * parent's row lock. Duplicate/replayed delivery is a no-op (only 'pending'
 * rows settle), so a cancelled or refunded order is never resurrected.
 * Confirmation re-checks, at this moment: the organisation (D-01), the
 * order's own cancellation, the provider's refund/dispute state for a payment
 * that was held for review, the listing's eligibility, the start time and —
 * once its hold has lapsed — capacity. A matching payment that fails any of
 * these is recorded as received but not fulfilled (paid + cancelled) and a
 * payment review is opened; capacity (case 4) and suspension (case 4b) may be
 * refunded automatically (payments/paymentReview.ts). */
type Settle =
  | { kind: "confirmed" }
  | { kind: "noop" }
  | { kind: "org_suspended"; reviewId: number }
  | { kind: "unfulfilled"; reason: ReviewReason; reviewId: number }
  | { kind: "held"; reviewId: number };

async function settleOrder(type: OrderType, ref: string, ctx: PaymentCtx): Promise<Settle> {
  // A payment held for review is re-proved at the provider before it can confirm.
  let providerBlock: string | null = null;
  const held = ctx.sessionId ? await reviewForSession(ctx.sessionId) : null;
  if (held && held.status === "open") {
    const provider = paymentProvider();
    // Without a provider (local tests) the recorded refunds and disputes are
    // what's checked (below and here); with one, the provider is re-read.
    if (!provider) {
      if (held.paymentIntentId && (await db.prepare(`SELECT id FROM disputes WHERE payment_intent_id = ? LIMIT 1`).get(held.paymentIntentId))) providerBlock = "the payment is disputed";
    } else {
      const snap = await provider.paymentSnapshot(ctx.sessionId!);
      if (!snap.charge || snap.charge.status !== "succeeded") providerBlock = "Stripe doesn't show a settled charge";
      else if (snap.charge.amountRefundedMinor > 0 || snap.refunds.length) providerBlock = "Stripe shows a refund on this payment";
      else if (snap.charge.disputed || snap.disputes.length) providerBlock = "the payment is disputed";
    }
  }
  return db.transaction(async (tx) => {
    await tx.prepare(PARENT_LOCK[type]).get(ref);
    const row = (await tx.prepare(`SELECT * FROM ${ORDER_TABLE[type]} WHERE ref = ? FOR UPDATE`).get(ref)) as Record<string, any> | undefined;
    if (!row || row.payment_status !== "pending") return { kind: "noop" as const };
    const facts: PaymentFacts = {
      sessionId: ctx.sessionId ?? row.stripe_session_id ?? `order:${type}:${ref}`,
      type,
      ref,
      paymentIntentId: ctx.paymentIntentId,
      receivedMinor: ctx.amountMinor ?? Number(row[ORDER_TOTAL[type]] ?? 0),
      receivedCurrency: ctx.currency ?? "EUR",
      eventId: ctx.eventId,
    };
    // D-01: a sale for a suspended organisation is never confirmed. The row
    // stays pending; the review records the received payment (case 4b).
    if (type !== "game" && (await orgSuspendedForVendor(tx, await supplyVendorForOrder(type, ref, tx)))) {
      const { review } = await openReview(tx, facts, "org_suspended", { agreed: ctx.agreed, autoRefund: type === "pass" ? "not_applicable" : (await autoRefundSwitchOn()) ? "pending_check" : "disabled" });
      return { kind: "org_suspended" as const, reviewId: review.id };
    }
    let reason: ReviewReason | null = null;
    let detail: string | null = null;
    if (row.status === "cancelled") reason = "order_cancelled";
    else if (providerBlock) [reason, detail] = ["provider_state", providerBlock];
    else if (await tx.prepare(`SELECT id FROM refunds WHERE source_type = ? AND source_ref = ? LIMIT 1`).get(type, ref)) [reason, detail] = ["provider_state", "a refund is already recorded for this order"];
    else if (!(await listingEligible(tx, type, row))) reason = "listing_unavailable";
    else {
      const start = await orderStart(tx, type, ref);
      if (start.started) reason = "after_start";
      // Joining a programme part-way: allowed for an on-time payment (as
      // before); a late or held one isn't confirmed by itself.
      else if (type === "program" && start.midProgramme && !orderHoldLive(type, row)) reason = "mid_programme";
      else if (HOLDING_TYPES.includes(type) && !orderHoldLive(type, row) && !(await orderFits(tx, type, row))) reason = "capacity_unavailable";
    }
    if (!reason) {
      if (type === "game") await tx.prepare(`UPDATE game_participants SET status = 'joined', payment_status = 'paid', review_hold_until = NULL WHERE ref = ? AND payment_status = 'pending'`).run(ref);
      else if (type === "pass") await tx.prepare(`UPDATE passes SET payment_status = 'paid' WHERE ref = ? AND payment_status = 'pending'`).run(ref);
      else await tx.prepare(`UPDATE ${ORDER_TABLE[type]} SET payment_status = 'paid', review_hold_until = NULL WHERE ref = ? AND payment_status = 'pending'`).run(ref);
      return { kind: "confirmed" as const };
    }
    if (type === "pass") {
      // A pass has no "cancelled" state to record: it stays pending (never active) for finance.
      const { review } = await openReview(tx, facts, reason, { detail, agreed: ctx.agreed });
      return { kind: "held" as const, reviewId: review.id };
    }
    // Received but not fulfilled: paid + cancelled (the existing "refund required" state).
    await tx.prepare(`UPDATE ${ORDER_TABLE[type]} SET payment_status = 'paid', status = 'cancelled', review_hold_until = NULL WHERE ref = ? AND payment_status = 'pending'`).run(ref);
    const auto: AutoRefund = reason === "capacity_unavailable" ? ((await autoRefundSwitchOn()) ? "pending_check" : "disabled") : "not_applicable";
    const { review } = await openReview(tx, facts, reason, { detail, agreed: ctx.agreed, autoRefund: auto });
    return { kind: "unfulfilled" as const, reason, reviewId: review.id };
  });
}

/** D-01 — the paid order can't be fulfilled because its organisation is
 * suspended and it wasn't refunded automatically (D-10 preconditions not met,
 * or automatic refunds switched off): audit it, then park the event for
 * finance review. The order stays pending; the payment review records the
 * received payment. */
async function holdForOrgSuspension(kind: string, ref: string): Promise<never> {
  // Two separate states are kept: the ORDER stays pending (not confirmed, not
  // fulfilled), while the PROVIDER payment is verified as paid — the signed
  // event matched its checkout agreement before we got here. The agreement's
  // facts are recorded with the hold; the parked event keeps the payment
  // intent and amount (webhook_events.summary).
  const agreement = (await db
    .prepare(`SELECT session_id AS sessionId, amount_minor AS amountMinor, currency FROM checkout_agreements WHERE source_type = ? AND source_ref = ? ORDER BY session_id LIMIT 1`)
    .get(kind, ref)) as { sessionId: string; amountMinor: number | string; currency: string } | undefined;
  await writeAudit({
    actorUserId: null,
    action: `${kind}.held_org_suspended`,
    objectType: kind,
    objectId: ref,
    newValue: {
      orderPaymentStatus: "pending",
      providerPayment: "verified_paid",
      checkoutSessionId: agreement?.sessionId ?? null,
      amountMinor: agreement ? Number(agreement.amountMinor) : null,
      currency: agreement?.currency ?? null,
      reason: "organisation_suspended_at_confirmation",
    },
  });
  throw new NeedsReviewError(orgSuspendedReviewMessage(kind, ref));
}

async function refundRequired(kind: string, ref: string, reason: ReviewReason) {
  await writeAudit({ actorUserId: null, action: `${kind}.refund_required`, objectType: kind, objectId: ref, newValue: { status: "cancelled", paymentStatus: "paid", reason: reason === "capacity_unavailable" ? "capacity_unavailable_at_confirmation" : `${reason}_at_confirmation` } });
  console.error(`[payments] ${kind} ${ref}: paid but not fulfilled (${reason}) — marked cancelled/paid for refund`);
}

/** After settling: record the payment when the order is now paid, then deal
 * with a review (automatic refund for cases 4/4b, finance otherwise). */
async function afterSettle(type: OrderType, ref: string, settled: Settle, ctx: PaymentCtx, provider: "stripe" | "stub") {
  await afterPaid({ type, ref }, { checkoutSessionId: ctx.sessionId, paymentIntentId: ctx.paymentIntentId, amountMinor: ctx.amountMinor, currency: ctx.currency ?? "eur", provider });
  if (settled.kind === "confirmed") return resolveConfirmed(ctx.sessionId, type, ref);
  if (settled.kind === "unfulfilled") {
    await refundRequired(type, ref, settled.reason);
    await handleUnfulfilled(settled.reviewId);
    return;
  }
  if (settled.kind === "org_suspended") {
    await handleUnfulfilled(settled.reviewId);
    const row = (await db.prepare(`SELECT payment_status AS ps FROM ${ORDER_TABLE[type]} WHERE ref = ?`).get(ref)) as { ps: string } | undefined;
    if (row?.ps === "pending") await holdForOrgSuspension(type, ref);
    return;
  }
  if (settled.kind === "held") throw new NeedsReviewError(`Payment held for review — ${type} ${ref} wasn't confirmed (payment review #${settled.reviewId})`);
  // noop: a redelivery after a crash between settling and the automatic-refund check resumes it.
  const review = ctx.sessionId ? await reviewForSession(ctx.sessionId) : null;
  if (review && review.status === "open" && review.autoRefund === "pending_check") await handleUnfulfilled(review.id);
}

export async function confirmBooking(ref: string, ctx: PaymentCtx = NO_CTX): Promise<Settle> {
  const settled = await settleOrder("booking", ref, ctx);
  if (settled.kind !== "confirmed") return settled;
  void logEvent("booking_completed", { metadata: { type: "booking", ref, via: "stripe" } });

  const row = (await db
    .prepare(
      `SELECT b.ref, b.centre_id, c.name as centre_name, c.vendor_id,
              b.name, b.email, b.date, b.time, b.duration, b.guests, b.coupon_code, b.total_cents, b.resident_id
       FROM bookings b JOIN centres c ON c.id = b.centre_id
       WHERE b.ref = ?`
    )
    .get(ref)) as (BookingForNotify & { resident_id: string | null }) | undefined;
  if (!row) return settled;

  // Coupon use was reserved with the hold at checkout (HC-QA-050) — never consumed again here.
  notifyNewBookingOrRegistration({
    kind: "booking",
    listingType: "centre",
    listingId: row.centre_id,
    listingName: row.centre_name,
    vendorId: row.vendor_id,
    guestName: row.name,
    guestEmail: row.email,
    ref: row.ref,
    detailsText: `${row.date} at ${row.time} · ${row.duration}h · ${row.guests} guests · €${(row.total_cents / 100).toFixed(2)} total`,
    residentId: row.resident_id,
  }).catch((e) => console.error("[notifications] booking notify failed:", e));

  if (row.resident_id) await upgradeFavouriteStatus(row.resident_id, "centre", row.centre_id);
  await createGameFromOpenBooking(row.ref);
  return settled;
}

export async function confirmRegistration(ref: string, ctx: PaymentCtx = NO_CTX): Promise<Settle> {
  const settled = await settleOrder("registration", ref, ctx);
  if (settled.kind !== "confirmed") return settled;
  void logEvent("booking_completed", { metadata: { type: "registration", ref, via: "stripe" } });

  const row = (await db
    .prepare(
      `SELECT r.ref, r.club_id, c.name as club_name, c.vendor_id, r.g_first, r.g_last, r.email,
              r.child_first, r.child_last, r.dob, r.team, r.trial, r.coupon_code, r.total_cents, r.resident_id, r.client_id
       FROM registrations r JOIN clubs c ON c.id = r.club_id WHERE r.ref = ?`
    )
    .get(ref)) as (RegistrationForNotify & { resident_id: string | null; client_id: string }) | undefined;
  if (!row) return settled;

  // Coupon use was reserved with the hold at checkout (HC-QA-050) — never consumed again here.
  await claimWaitlistOffer("club", row.club_id, row.client_id, row.resident_id);
  notifyNewBookingOrRegistration({
    kind: "registration",
    listingType: "club",
    listingId: row.club_id,
    listingName: row.club_name,
    vendorId: row.vendor_id,
    guestName: `${row.g_first} ${row.g_last}`,
    guestEmail: row.email,
    ref: row.ref,
    detailsText: `${row.dob ? `${row.child_first} ${row.child_last} (DOB ${row.dob}) · ${row.team}` : `${row.child_first} ${row.child_last}`}${row.trial ? " · Trial session" : ""} · €${(row.total_cents / 100).toFixed(2)} total`,
    residentId: row.resident_id,
  }).catch((e) => console.error("[notifications] registration notify failed:", e));

  if (row.resident_id) await upgradeFavouriteStatus(row.resident_id, "club", row.club_id);
  return settled;
}

interface GameJoinForNotify {
  game_id: string;
  total_cents: number | null;
  host_resident_id: string;
  activity_label: string;
  date: string;
  time: string;
  capacity: number;
  price_cents: number | null;
  location_text: string;
  centre_name: string | null;
  resident_id: string;
  resident_name: string;
  resident_email: string;
  coupon_code: string | null;
}

/** Paid Join-a-Game confirmation (NEXT). Same idempotent
 * only-flip-if-still-pending pattern as confirmBooking/confirmRegistration
 * above — a retried webhook delivery is a safe no-op. */
export async function confirmGameJoin(ref: string, ctx: PaymentCtx = NO_CTX): Promise<Settle> {
  // HC-QA-041 (cross-model) + D-10 — settled under the game's row lock by the
  // shared rules (settleOrder). Replays are no-ops.
  const settled = await settleOrder("game", ref, ctx);
  if (settled.kind !== "confirmed") return settled;
  void logEvent("booking_completed", { metadata: { type: "game", ref, via: "stripe" } });

  const row = (await db
    .prepare(
      `SELECT gp.game_id, gp.resident_id, gp.coupon_code, gp.total_cents, g.host_resident_id, g.activity_label, g.date, g.time, g.capacity, g.price_cents, g.location_text, c.name as centre_name,
              r.name as resident_name, r.email as resident_email
       FROM game_participants gp
       JOIN games g ON g.id = gp.game_id
       JOIN residents r ON r.id = gp.resident_id
       LEFT JOIN centres c ON c.id = g.centre_id
       WHERE gp.ref = ?`
    )
    .get(ref)) as GameJoinForNotify | undefined;
  if (!row) return settled;

  // Coupon use was reserved with the hold at checkout (HC-QA-050) — never consumed again here.
  await claimWaitlistOffer("game", row.game_id, null, row.resident_id);

  // Platform Pre-Launch Polish — Changeset 3. Paid Game joins previously had
  // zero payer-facing confirmation — this function's only notify call was
  // the host-full one below. Fires exactly once per successful payment: the
  // idempotency guard above (info.changes === 0) already returns early on a
  // replayed webhook, so this can never double-send.
  const venue = row.centre_name ?? (row.location_text || "the venue");
  // HC-QA-049: state what was charged (VAT + fee − coupon), not the list price.
  const chargedCents = row.total_cents ?? row.price_cents;
  const amount = chargedCents ? `€${(chargedCents / 100).toFixed(2)} paid` : "Free";
  const manageUrl = `${CLIENT_URL}/games/${row.game_id}`;
  await notifyResident({
    residentId: row.resident_id,
    kind: "game",
    title: `You're in: ${row.activity_label}`,
    body: `${row.date} at ${row.time} · ${venue} · ${amount}`,
    listingType: "game",
    listingId: row.game_id,
    ref: row.game_id,
  }).catch((e) => console.error("[notifications] game join resident notify failed:", e));
  await sendMail({
    to: row.resident_email,
    subject: `You're confirmed — ${row.activity_label} (${ref})`,
    text: `Hi ${row.resident_name},\n\nYou're confirmed for ${row.activity_label}.\nReference: ${ref}\n\n${row.date} at ${row.time}\n${venue}\n${amount}\n\nView your session any time: ${manageUrl}\n\nThanks for using Hello Circle.`,
  }).catch((e) => console.error("[email] game join confirmation failed:", e));

  const { n: joined } = (await db.prepare(`SELECT COUNT(*) as n FROM game_participants WHERE game_id = ? AND status = 'joined'`).get(row.game_id)) as {
    n: number;
  };
  if (computeCapacity(row.capacity, joined).isFull) {
    await notifyResident({
      residentId: row.host_resident_id,
      kind: "game",
      title: `Your game is full: ${row.activity_label}`,
      body: `${row.date} at ${row.time} — all ${row.capacity} spots are taken.`,
      listingType: "game",
      listingId: row.game_id,
      ref: row.game_id,
    }).catch((e) => console.error("[notifications] game notify failed:", e));
  }

  await checkMinParticipantsThreshold(row.game_id);
  await upgradeFavouriteStatus(row.resident_id, "game", row.game_id);
  void logEvent("game_joined", { residentId: row.resident_id, metadata: { gameId: row.game_id, activityLabel: row.activity_label, paid: true } });
  return settled;
}

/** Credit-pack pass confirmation (NEXT) — same idempotent pattern. */
export async function confirmPass(ref: string, ctx: PaymentCtx = NO_CTX): Promise<Settle> {
  const settled = await settleOrder("pass", ref, ctx);
  if (settled.kind !== "confirmed") return settled;
  void logEvent("booking_completed", { metadata: { type: "pass", ref, via: "stripe" } });

  // Platform Pre-Launch Polish — Changeset 3. This function previously had
  // zero notification code at all — a Pass purchase confirmed with no
  // payer-facing signal of any kind. Passes are always listing_type='club'
  // today (the only pass-purchase flow that exists, per passes.ts's own
  // GET /status/:ref precedent) — same LEFT JOIN pattern reused here.
  const row = (await db
    .prepare(
      `SELECT p.resident_id as residentId, p.listing_id as clubId, c.name as clubName, p.credits_total as creditsTotal, p.purchased_cents as purchasedCents,
              r.name as residentName, r.email as residentEmail
       FROM passes p
       LEFT JOIN clubs c ON p.listing_type = 'club' AND c.id = p.listing_id
       JOIN residents r ON r.id = p.resident_id
       WHERE p.ref = ?`
    )
    .get(ref)) as
    | { residentId: string; clubId: string; clubName: string | null; creditsTotal: number; purchasedCents: number; residentName: string; residentEmail: string }
    | undefined;
  if (!row) return settled;

  const clubName = row.clubName ?? "your club";
  const amount = `€${(row.purchasedCents / 100).toFixed(2)}`;
  const manageUrl = `${CLIENT_URL}/clubs/${row.clubId}`;
  await notifyResident({
    residentId: row.residentId,
    kind: "registration",
    title: `Pass purchased: ${clubName}`,
    body: `${row.creditsTotal} sessions · ${amount} paid`,
    listingType: "club",
    listingId: row.clubId,
    ref,
  }).catch((e) => console.error("[notifications] pass resident notify failed:", e));
  await sendMail({
    to: row.residentEmail,
    subject: `Your pass is confirmed — ${clubName} (${ref})`,
    text: `Hi ${row.residentName},\n\nYour pass for ${clubName} is confirmed.\nReference: ${ref}\n\n${row.creditsTotal} sessions · ${amount} paid\n\nView it any time: ${manageUrl}\n\nThanks for using Hello Circle.`,
  }).catch((e) => console.error("[email] pass confirmation failed:", e));
  return settled;
}

/** Program enrollment confirmation (Phase B) — same idempotent pattern. */
export async function confirmProgramEnrollment(ref: string, ctx: PaymentCtx = NO_CTX): Promise<Settle> {
  const settled = await settleOrder("program", ref, ctx);
  if (settled.kind !== "confirmed") return settled;
  void logEvent("booking_completed", { metadata: { type: "program", ref, via: "stripe" } });
  const row = (await db
    .prepare(
      `SELECT pe.participant_name as participantName, pe.email, p.title, p.vendor_id as vendorId, p.listing_type as listingType, p.listing_id as listingId, pe.total_cents as totalCents, pe.resident_id as residentId, pe.coupon_code as couponCode
       FROM program_enrollments pe JOIN programs p ON p.id = pe.program_id WHERE pe.ref = ?`
    )
    .get(ref)) as
    | { participantName: string; email: string; title: string; vendorId: string; listingType: "centre" | "club"; listingId: string; totalCents: number; residentId: string | null; couponCode: string | null }
    | undefined;
  if (!row) return settled;
  // Coupon use was reserved with the hold at checkout (HC-QA-050) — never consumed again here.
  notifyNewBookingOrRegistration({
    kind: "registration",
    listingType: row.listingType,
    listingId: row.listingId,
    listingName: row.title,
    vendorId: row.vendorId,
    guestName: row.participantName,
    guestEmail: row.email,
    ref,
    detailsText: `${row.participantName} enrolled in ${row.title} · €${(row.totalCents / 100).toFixed(2)} total`,
    residentId: row.residentId,
  }).catch((e) => console.error("[notifications] program enrollment notify failed:", e));
  return settled;
}

/** Adventure/Experience session booking confirmation — same idempotent
 * pattern as confirmBooking/confirmRegistration above. */
export async function confirmExperienceBooking(ref: string, ctx: PaymentCtx = NO_CTX): Promise<Settle> {
  const settled = await settleOrder("experience", ref, ctx);
  if (settled.kind !== "confirmed") return settled;
  void logEvent("booking_completed", { metadata: { type: "experience", ref, via: "stripe" } });

  const row = (await db
    .prepare(
      `SELECT eb.ref, eb.participant_name as participantName, eb.email, eb.party_size as partySize, eb.total_cents as totalCents, eb.coupon_code as couponCode,
              eb.resident_id as residentId, e.id as experienceId, e.title, e.vendor_id as vendorId, es.date, es.time
       FROM experience_bookings eb
       JOIN experiences e ON e.id = eb.experience_id
       JOIN experience_sessions es ON es.id = eb.session_id
       WHERE eb.ref = ?`
    )
    .get(ref)) as
    | { ref: string; participantName: string; email: string; partySize: number; totalCents: number; couponCode: string | null; residentId: string | null; experienceId: string; title: string; vendorId: string; date: string; time: string }
    | undefined;
  if (!row) return settled;
  // Coupon use was reserved with the hold at checkout (HC-QA-050) — never consumed again here.

  notifyNewBookingOrRegistration({
    kind: "booking",
    listingType: "experience",
    listingId: row.experienceId,
    listingName: row.title,
    vendorId: row.vendorId,
    guestName: row.participantName,
    guestEmail: row.email,
    ref: row.ref,
    detailsText: `${row.date} at ${row.time} · party of ${row.partySize} · €${(row.totalCents / 100).toFixed(2)} total`,
    residentId: row.residentId,
  }).catch((e) => console.error("[notifications] experience booking notify failed:", e));

  if (row.residentId) await upgradeFavouriteStatus(row.residentId, "experience", row.experienceId);
  return settled;
}

async function markFailed(metadata: Stripe.Metadata | null | undefined) {
  if (!metadata?.ref) return;
  // HC-QA-050 — each end-of-hold transition happens once and hands back the
  // coupon use reserved at checkout. Same per-model row conventions as before
  // (bookings/registrations kept as 'failed'; the rest removed).
  if (metadata.type === "booking") await endPendingHold("bookings", metadata.ref, "fail");
  else if (metadata.type === "registration") await endPendingHold("registrations", metadata.ref, "fail");
  else if (metadata.type === "game") await endPendingHold("game_participants", metadata.ref, "delete");
  else if (metadata.type === "pass" && !(await hasOpenReview("pass", metadata.ref))) await db.prepare(`DELETE FROM passes WHERE ref = ? AND payment_status = 'pending'`).run(metadata.ref);
  else if (metadata.type === "program") await endPendingHold("program_enrollments", metadata.ref, "delete");
  else if (metadata.type === "experience") await endPendingHold("experience_bookings", metadata.ref, "delete");
  await syncOrder(metadata);
}

/** Commerce Engine Phase 2 — mirror the participation row onto its commerce
 * order (if the engine priced it). A no-op for every legacy-priced row. */
async function syncOrder(metadata: Stripe.Metadata | null | undefined) {
  const { type, ref } = metadata ?? {};
  if (ref && type && type in SOURCE_TABLES) await syncOrderFromSource(type as CheckoutType, ref);
}

/** Registered with express.raw() (not express.json()) — Stripe's signature
 * check needs the exact raw request body bytes. This is the only place a
 * booking/registration is ever marked 'paid' — never on the client's say-so. */
export async function stripeWebhookHandler(req: Request, res: Response) {
  if (!stripe) return res.status(503).send("Payments not configured");
  // Stage 5e — a v2 event notification (e.g. forwarded by the Stripe CLI to
  // this one URL) goes to the v2 handler, which verifies it with its own secret.
  if (Buffer.isBuffer(req.body) && req.body.length < 65_536 && /"object"\s*:\s*"v2\.core\.event"/.test(req.body.toString("utf8"))) return stripeThinWebhookHandler(req, res);

  let event: Stripe.Event;
  const signature = req.headers["stripe-signature"];
  // HC-QA-048 — once a signing secret is configured, every event must carry a
  // valid signature. A missing header used to fall through to the unverified
  // dev branch below, so outside production a forged "paid" event confirmed a
  // booking with no payment.
  if (STRIPE_WEBHOOK_SECRET && !signature) {
    console.error("[stripe] webhook rejected: missing Stripe-Signature header");
    return res.status(400).send("Missing signature");
  }
  if (STRIPE_WEBHOOK_SECRET && signature) {
    try {
      event = stripe.webhooks.constructEvent(req.body, signature, STRIPE_WEBHOOK_SECRET);
    } catch (e) {
      // Stage 5a — events from connected accounts are signed with the Connect endpoint's own secret.
      let connectEvent: Stripe.Event | null = null;
      if (STRIPE_CONNECT_WEBHOOK_SECRET) {
        try {
          connectEvent = stripe.webhooks.constructEvent(req.body, signature, STRIPE_CONNECT_WEBHOOK_SECRET);
        } catch {
          connectEvent = null;
        }
      }
      if (!connectEvent) {
        console.error("[stripe] webhook signature verification failed:", e instanceof Error ? e.message : e);
        return res.status(400).send("Invalid signature");
      }
      event = connectEvent;
    }
  } else if (!unsignedStripeWebhooksAllowed()) {
    // Without signature verification, anyone who finds this URL could POST a
    // forged checkout.session.completed and get a booking marked paid for
    // free. Fail-safe default (Phase 12): refused unless explicitly opted in
    // for local development (never production/staging).
    console.error("[stripe] webhook refused: STRIPE_WEBHOOK_SECRET is not set and unsigned events are not allowed");
    return res.status(503).send("Webhook not configured");
  } else {
    // Explicit local-development opt-in (ALLOW_UNSIGNED_STRIPE_WEBHOOKS=true).
    console.warn("[stripe] accepting UNSIGNED webhook (ALLOW_UNSIGNED_STRIPE_WEBHOOKS=true, local development only)");
    event = JSON.parse(req.body.toString("utf8"));
  }

  // Revenue & Connect Stage 2c — store once, claim, process, record outcome.
  const begin = await beginEvent("stripe", event as unknown as IncomingEvent, req.body);
  if (begin.action === "duplicate") return res.json({ received: true, duplicate: true });
  if (begin.action === "busy") return res.status(409).send("Event is already being processed");
  try {
    const outcome = await processStripeEvent(event as unknown as IncomingEvent);
    await finishEvent(begin.rowId, outcome);
    res.json({ received: true });
  } catch (e) {
    const retry = await failEvent(begin.rowId, e, { needsReview: e instanceof NeedsReviewError });
    console.error(`[stripe] webhook ${event.id} (${event.type}) failed${retry ? " — will retry" : " — parked for manual review"}:`, e instanceof Error ? e.message : e);
    // 500 asks the provider to retry; once parked, acknowledge so it stops.
    if (retry) return res.status(500).send("Processing failed");
    res.json({ received: true, parked: true });
  }
}

/**
 * Stage 5e — Accounts v2 ("thin") events from the event destination
 * (POST /api/stripe/webhook/v2). The notification carries only an id: after
 * the signature check it is stored once (duplicates refused), then the event
 * and the account it names are re-fetched from Stripe — never trusted as sent.
 */
export async function stripeThinWebhookHandler(req: Request, res: Response) {
  const provider = paymentProvider();
  if (!provider) return res.status(503).send("Payments not configured");
  const secret = process.env.STRIPE_V2_WEBHOOK_SECRET ?? STRIPE_V2_WEBHOOK_SECRET;
  if (!secret) return res.status(503).send("Webhook not configured");
  const signature = req.headers["stripe-signature"];
  if (typeof signature !== "string" || !signature) return res.status(400).send("Missing signature");
  let note: { id: string; type: string; relatedObjectId: string | null; created: string };
  try {
    note = provider.parseThinEvent(req.body, signature, secret);
  } catch {
    return res.status(400).send("Invalid signature");
  }
  const incoming: IncomingEvent = { id: note.id, type: note.type, created: Math.floor(new Date(note.created).getTime() / 1000) || 0, livemode: false, account: note.relatedObjectId, data: { object: { id: note.relatedObjectId } } };
  const begin = await beginEvent("stripe_v2", incoming, req.body);
  if (begin.action === "duplicate") return res.json({ received: true, duplicate: true });
  if (begin.action === "busy") return res.status(409).send("Event is already being processed");
  try {
    await finishEvent(begin.rowId, await processThinConnectEvent(note.id));
    res.json({ received: true });
  } catch (e) {
    const retry = await failEvent(begin.rowId, e, { needsReview: e instanceof NeedsReviewError });
    if (retry) return res.status(500).send("Processing failed");
    res.json({ received: true, parked: true });
  }
}

/** Applies one verified provider event. Shared by the live webhook, admin
 * replay and tests. Returns "ignored" for events HelloCircle doesn't act on
 * (still stored, so the history is complete). */
export async function processStripeEvent(event: IncomingEvent): Promise<"processed" | "ignored"> {
  const o = event.data.object;
  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded":
    case "checkout.session.async_payment_failed": {
      // Stage 5b — a Pro subscription checkout, not a booking.
      if (o.metadata?.type === "subscription") return event.type === "checkout.session.async_payment_failed" ? "ignored" : applySubscriptionCheckout(o as never);
      // A delayed payment method (SEPA/Bacs Direct Debit) fires `completed`
      // with payment_status "unpaid" before the debit settles — confirming
      // then would mark the booking paid before money moved. Only
      // `async_payment_succeeded` (or a `completed` already "paid") confirms;
      // `async_payment_failed` mirrors `expired`.
      if (event.type === "checkout.session.async_payment_failed") {
        await markFailed(o.metadata);
        return "processed";
      }
      if (o.payment_status !== "paid") return "ignored";
      // Reconcile against what the session was created to charge before
      // anything is marked paid. A mismatch is recorded as a payment review
      // (D-10 case 1, with a bounded place hold; case 2 never holds) and the
      // event is parked — it can never confirm the order.
      const paid = { id: o.id ?? null, amount_total: typeof o.amount_total === "number" ? o.amount_total : null, currency: o.currency ?? null, metadata: o.metadata ?? null };
      const ctx: PaymentCtx = {
        sessionId: o.id ?? null,
        paymentIntentId: typeof o.payment_intent === "string" ? o.payment_intent : o.payment_intent?.id ?? null,
        amountMinor: paid.amount_total,
        currency: o.currency ?? "eur",
        eventId: event.id,
        agreed: null,
      };
      const check = await checkCheckoutAgreement(paid);
      if (!check.ok) {
        if (o.id) await recordUnmatchedPayment({ sessionId: o.id, type: o.metadata?.type ?? null, ref: o.metadata?.ref ?? null, paymentIntentId: ctx.paymentIntentId, receivedMinor: ctx.amountMinor, receivedCurrency: ctx.currency, eventId: event.id }, check);
        throw new NeedsReviewError(`Checkout reconciliation failed — not marked paid: ${check.reason}`);
      }
      await confirmByType(o.metadata, { ...ctx, agreed: check.agreed }, "stripe");
      return "processed";
    }
    case "checkout.session.expired":
      if (o.metadata?.type === "subscription") {
        await db.prepare(`UPDATE partner_subscriptions SET status = 'abandoned' WHERE checkout_session_id = ? AND status = 'checkout'`).run(o.id);
        return "processed";
      }
      await markFailed(o.metadata);
      return "processed";
    // Stage 5b — HelloCircle Pro (Stripe Billing).
    case "customer.subscription.updated":
      return applySubscriptionUpdate(o as never);
    case "customer.subscription.deleted":
      return applySubscriptionDeleted(o as never);
    case "invoice.paid":
      return recordInvoicePaid(o as never);
    case "invoice.payment_failed": {
      const subId = typeof o.subscription === "string" ? o.subscription : o.subscription?.id ?? o.parent?.subscription_details?.subscription ?? null;
      return subId ? applySubscriptionUpdate({ id: subId, status: "past_due" }) : "ignored";
    }
    case "charge.refunded": {
      const pi = typeof o.payment_intent === "string" ? o.payment_intent : o.payment_intent?.id;
      if (!pi) throw new NeedsReviewError(`Refunded charge ${o.id} has no payment intent`);
      // D-11 — a payment held for review has no payment record: record the
      // provider's refunds against its review (closing it is finance's recheck).
      if (!(await db.prepare(`SELECT id FROM payment_records WHERE payment_intent_id = ?`).get(pi)) && (await recordRefundsForReview(pi))) return "processed";
      // Stage 5d — the charge's refunds (by id) from the provider, so each is recorded under its own id.
      const providerRefunds = await paymentProvider()?.chargeRefunds(o.id).catch(() => []) ?? [];
      await recordProviderRefunds({ paymentIntentId: pi, chargeId: o.id, amountRefundedMinor: Number(o.amount_refunded ?? 0), amountMinor: Number(o.amount ?? 0), currency: o.currency ?? "eur", providerRefunds });
      return "processed";
    }
    case "charge.dispute.created":
    case "charge.dispute.updated":
    case "charge.dispute.closed":
      await recordDispute({
        disputeId: o.id,
        paymentIntentId: typeof o.payment_intent === "string" ? o.payment_intent : o.payment_intent?.id ?? null,
        amountMinor: Number(o.amount ?? 0),
        currency: o.currency ?? "eur",
        reason: String(o.reason ?? "unknown"),
        status: String(o.status ?? "needs_response"),
        evidenceDueBy: o.evidence_details?.due_by ? new Date(o.evidence_details.due_by * 1000) : null,
        // Stage 5d — Stripe's dispute fee (it is not returned when a dispute is won).
        feeMinor: (o.balance_transactions ?? []).reduce((a: number, b: { fee?: number }) => a + Number(b.fee ?? 0), 0),
      });
      return "processed";
    default:
      // Stage 5a — connected-account status, payouts and reversals.
      if (CONNECT_EVENT_TYPES.has(event.type)) return processConnectEvent(event);
      // payment_intent.* and everything else: Checkout events are the
      // authoritative confirmation; these are stored for the record only.
      return "ignored";
  }
}

/** Records the confirmed payment (payment_records + ledger) when the row is
 * now paid. Missing provider details are read back from the row (QA seam). */
async function afterPaid(
  metadata: { type?: string; ref?: string } | null | undefined,
  details: { checkoutSessionId: string | null; paymentIntentId: string | null; amountMinor: number | null; currency: string; provider: "stripe" | "stub" }
) {
  const { type, ref } = metadata ?? {};
  if (!type || !ref || !(type in SOURCE_TABLES)) return;
  const table = SOURCE_TABLES[type as CheckoutType];
  const totalCol = type === "pass" ? "purchased_cents" : "total_cents";
  const row = (await db.prepare(`SELECT payment_status as ps, stripe_session_id as sid, ${totalCol} as total FROM ${table} WHERE ref = ?`).get(ref)) as
    | { ps: string; sid: string | null; total: number | null }
    | undefined;
  if (!row || row.ps !== "paid") return;
  const sessionId = details.checkoutSessionId ?? row.sid;
  await recordPaymentConfirmed({
    type: type as CheckoutType,
    ref,
    checkoutSessionId: sessionId,
    paymentIntentId: details.paymentIntentId ?? (details.provider === "stub" && sessionId ? `pi_stub_${sessionId}` : null),
    amountMinor: details.amountMinor ?? Number(row.total ?? 0),
    currency: details.currency,
    provider: details.provider,
  });
}

/** Provider-independent outcome entry point (Phase 8). The webhook handler
 * maps provider events onto these; the QA provider seam calls it directly.
 * success → confirm (idempotent); failure/expired → release the hold. */
export async function processProviderOutcome(type: string, ref: string, outcome: "success" | "failure" | "expired") {
  if (outcome === "success") {
    const row = isOrderType(type) ? ((await db.prepare(`SELECT stripe_session_id AS sid FROM ${ORDER_TABLE[type]} WHERE ref = ?`).get(ref)) as { sid: string | null } | undefined) : undefined;
    await confirmByType({ type, ref }, { ...NO_CTX, sessionId: row?.sid ?? null }, "stub");
  } else await markFailed({ type, ref });
}

/** Settles the order, records the payment if it's now paid, and handles a
 * review (D-10). Throws NeedsReviewError when the event must be parked. */
async function confirmByType(metadata: Stripe.Metadata | null | undefined, ctx: PaymentCtx = NO_CTX, provider: "stripe" | "stub" = "stripe") {
  const { type, ref } = metadata ?? {};
  if (!ref || !isOrderType(type)) return;
  const confirm = { booking: confirmBooking, registration: confirmRegistration, game: confirmGameJoin, pass: confirmPass, program: confirmProgramEnrollment, experience: confirmExperienceBooking }[type];
  const settled = await confirm(ref, ctx);
  await syncOrder(metadata);
  await afterSettle(type, ref, settled, ctx, provider);
  await syncOrder(metadata);
}
