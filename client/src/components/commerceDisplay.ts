// Commercial UX R2 — display contracts and status vocabulary for the receipt
// drawer, payout history and coupon redemptions. These types are the target
// response shapes R3 will add endpoints for; in R2 only fixtures fill them.
// Labels map server states to words — no state is inferred on the client.

import type { PayoutAccountState } from "../api";
import type { CheckoutQuote } from "./booking/checkoutLines";
import type { OrderLine } from "../types";

export type StatusTone = "ok" | "wait" | "stop" | "neutral";

// --- Receipts (C7) — GET /api/residents/me/receipts/:ref (server/src/receipts.ts) ---

export type ReceiptStatus = "paid" | "free" | "pay_at_venue" | "pending" | "failed" | "refunded" | "part_refunded";
export type ReceiptKind = "booking" | "registration" | "game" | "pass" | "program_enrollment" | "experience";

/** The price recorded at purchase (frozen snapshot or the row's stored columns). */
export interface ReceiptBreakdown {
  subtotalCents: number;
  /** Coupon + HelloCircle credit, both taken off before tax. */
  discountCents: number;
  couponDiscountCents: number;
  couponCode: string | null;
  creditCents: number;
  vatCents: number;
  vatIncluded: boolean;
  vatLabel: string;
  platformFeeCents: number;
  depositCents: number;
  totalCents: number;
}

export interface ReceiptRefund {
  id: string;
  at: string;
  /** Returned to the card. */
  cardCents: number;
  /** Returned as HelloCircle credit (the credit share of the order, plan D1). */
  creditCents: number;
  status: "processing" | "done";
  reason: string | null;
}

export interface ReceiptDetail {
  ref: string;
  kind: ReceiptKind;
  label: string;
  createdAt: string;
  status: ReceiptStatus;
  /** "total_only" = only the total was recorded; there's no line-by-line breakdown to show. */
  breakdownSource: "snapshot" | "stored" | "total_only";
  breakdown: ReceiptBreakdown | null;
  totalCents: number;
  subtotalLabel: string;
  refunds: ReceiptRefund[];
  refundedCardCents: number;
  restoredCreditCents: number;
  /** Card + credit paid, less everything given back (server). Null until settled. */
  netPaidCents: number | null;
  paidOnline: boolean;
  /** Always false until the VAT model is confirmed — never labelled an invoice. */
  isTaxInvoice: false;
  /** Participation Phase 1 — what was bought, frozen at purchase ([] when not itemised). */
  lines?: OrderLine[];
}

export const RECEIPT_KIND_LABELS: Record<ReceiptKind, string> = {
  booking: "Venue booking",
  registration: "Club registration",
  game: "Activity",
  pass: "Session pass",
  program_enrollment: "Programme",
  experience: "Experience",
};

export const RECEIPT_STATUS: Record<ReceiptStatus, { label: string; tone: StatusTone }> = {
  paid: { label: "Paid", tone: "ok" },
  free: { label: "Free", tone: "ok" },
  pay_at_venue: { label: "Pay at the venue", tone: "neutral" },
  pending: { label: "Payment pending", tone: "wait" },
  failed: { label: "Payment failed", tone: "stop" },
  refunded: { label: "Refunded", tone: "neutral" },
  part_refunded: { label: "Part-refunded", tone: "wait" },
};

/** What the last line of a receipt is called, by status. */
export function receiptTotalLabel(status: ReceiptStatus, paidWithCredit: boolean): string {
  switch (status) {
    case "pay_at_venue":
      return "Due at the venue";
    case "pending":
      return "Total (payment pending)";
    case "failed":
      return "Total (not charged)";
    case "free":
      return "Total · nothing to pay";
    default:
      return paidWithCredit ? "Paid by card" : "Total paid";
  }
}

/** Receipts list rows: GET /api/residents/me/receipts paymentStatus → a word. */
export function receiptListStatus(paymentStatus: string): { label: string; tone: StatusTone } {
  if (paymentStatus === "paid") return { label: "Paid", tone: "ok" };
  if (paymentStatus === "refunded") return RECEIPT_STATUS.refunded;
  if (paymentStatus === "failed") return RECEIPT_STATUS.failed;
  return RECEIPT_STATUS.pending;
}

// --- Payout history (P2) ------------------------------------------------------

export type PayoutItemType = "transfer" | "bank_payout";
export type PayoutItemStatus = "sent" | "in_transit" | "paid" | "failed" | "reversed" | "partly_reversed";

export interface PayoutHistoryItem {
  id: string;
  type: PayoutItemType;
  /** Transfer: when sent. Bank payout: expected/actual arrival (null until Stripe gives one). */
  date: string | null;
  amountCents: number;
  status: PayoutItemStatus;
  settlementRef?: string | null;
  bookings?: number | null;
  recoveredCents?: number | null;
  failureMessage?: string | null;
}

export interface PayoutHistoryData {
  accountState: PayoutAccountState;
  /** From the settlement rule (weekly minimum); null if the rule isn't readable. */
  minimumPayoutCents: number | null;
  items: PayoutHistoryItem[];
}

export const PAYOUT_TYPE_LABELS: Record<PayoutItemType, string> = {
  transfer: "Transfer to your Stripe account",
  bank_payout: "Bank payout by Stripe",
};

export const PAYOUT_STATUS: Record<PayoutItemStatus, { label: string; tone: StatusTone }> = {
  sent: { label: "Sent", tone: "ok" },
  in_transit: { label: "On its way", tone: "wait" },
  paid: { label: "Paid to your bank", tone: "ok" },
  failed: { label: "Failed", tone: "stop" },
  reversed: { label: "Recovered", tone: "stop" },
  partly_reversed: { label: "Partly recovered", tone: "wait" },
};

/** Account states where money can't currently reach the partner (see PayoutAccountCard's STATE_TONE). */
export function payoutsRestricted(state: PayoutAccountState): boolean {
  return state === "transfers_unavailable" || state === "payouts_unavailable" || state === "more_information_required";
}

// --- Coupon redemptions (P3) --------------------------------------------------

export type RedemptionState = "reserved" | "confirmed" | "released" | "reversed";

export interface CouponRedemption {
  id: string;
  at: string;
  bookingRef: string;
  listingName: string;
  discountCents: number;
  state: RedemptionState;
}

export interface CouponRedemptionsData {
  code: string;
  rows: CouponRedemption[];
}

export const REDEMPTION_STATE: Record<RedemptionState, { label: string; tone: StatusTone; help: string }> = {
  reserved: { label: "Held", tone: "wait", help: "Checkout is open; returned if it isn't paid." },
  confirmed: { label: "Used", tone: "ok", help: "Paid booking." },
  released: { label: "Returned", tone: "neutral", help: "Checkout wasn't paid." },
  reversed: { label: "Returned", tone: "neutral", help: "Booking was refunded." },
};

/** Remote data for a fixture-driven or fetched panel. */
export type Remote<T> = { status: "loading" } | { status: "error"; error: string } | { status: "ready"; data: T };
