// Commercial UX R2 (C2), aligned with the server in R3A — the unified checkout
// summary's rows. Display only: every figure is a field the server sent.
// Nothing is added, subtracted, rated or rounded here (plan §5).
//
// Order = the server's own calculation order:
//   price → −coupon → −HelloCircle credit → VAT / fee / deposit → what's charged
// Legacy pricing applies a coupon to the subtotal before VAT and the fee; the
// commerce engine also takes customer credit off before tax (it is a
// HelloCircle-funded discount — commerce/engine priceWithRules), so both come
// before the tax rows and `totalCents` is always what the card is charged.

import type { KitQuote } from "./quoteLines";
import { formatCents } from "./quoteLines";

export interface CheckoutQuote extends KitQuote {
  /** The coupon's part of discountCents (server). Without it a credit can't be shown separately. */
  couponDiscountCents?: number;
  /** HelloCircle credit applied — part of discountCents (server-decided, ≤ what's eligible). */
  creditCents?: number;
  /** The resident's credit left after this order, as the server computed it. */
  creditBalanceAfterCents?: number | null;
  /** Label for the VAT row (a receipt passes the rate recorded at purchase). */
  vatLabel?: string;
}

export type CheckoutRowKey = "subtotal" | "coupon" | "credit" | "discount" | "vat" | "fee" | "deposit" | "total";

export interface CheckoutRow {
  key: CheckoutRowKey;
  label: string;
  cents: number;
  negative?: boolean;
  emphasis?: "muted" | "total";
}

export function hasCredit(q: CheckoutQuote): boolean {
  return (q.creditCents ?? 0) > 0;
}

/** The amount the primary action charges: always the server's total. */
export function chargeCents(q: CheckoutQuote): number {
  return q.totalCents;
}

export function checkoutRows(q: CheckoutQuote, subtotalLabel: string): CheckoutRow[] {
  const rows: CheckoutRow[] = [{ key: "subtotal", label: subtotalLabel, cents: q.subtotalCents }];
  const codeLabel = q.couponCode ? `Code ${q.couponCode}` : "Discount";
  if (hasCredit(q)) {
    if (typeof q.couponDiscountCents === "number") {
      if (q.couponDiscountCents > 0) rows.push({ key: "coupon", label: codeLabel, cents: q.couponDiscountCents, negative: true });
      rows.push({ key: "credit", label: "HelloCircle credit", cents: q.creditCents!, negative: true });
    } else {
      // The server didn't say how the discount splits: show its one figure, never a derived one.
      rows.push({ key: "discount", label: q.couponCode ? `Code ${q.couponCode} and HelloCircle credit` : "Discount and HelloCircle credit", cents: q.discountCents, negative: true });
    }
  } else if (q.discountCents > 0) {
    rows.push({ key: "coupon", label: codeLabel, cents: q.discountCents, negative: true });
  }
  if (!q.vatIncluded && q.vatCents > 0) rows.push({ key: "vat", label: q.vatLabel ?? "VAT (23%)", cents: q.vatCents, emphasis: "muted" });
  if (q.platformFeeCents > 0) rows.push({ key: "fee", label: "Platform fee", cents: q.platformFeeCents, emphasis: "muted" });
  if (q.depositCents && q.depositCents > 0) rows.push({ key: "deposit", label: "Refundable deposit", cents: q.depositCents, emphasis: "muted" });
  const label =
    q.totalCents === 0 ? (hasCredit(q) ? "Card payment · nothing to pay" : "Total · nothing to pay") : q.payAtVenue ? "Pay at the venue" : hasCredit(q) ? "Card payment due" : "Total today";
  rows.push({ key: "total", label, cents: q.totalCents, emphasis: "total" });
  return rows;
}

/** Primary button wording. €0 to pay (or pay at venue) confirms without a card. */
export function checkoutActionLabel(q: CheckoutQuote, confirmLabel = "Confirm booking"): string {
  if (q.totalCents === 0 || q.payAtVenue) return confirmLabel;
  return `Pay ${formatCents(q.totalCents)}`;
}

/** The one-line collapsed summary for the phone total bar. */
export function collapsedTotal(q: CheckoutQuote): string {
  if (q.totalCents === 0) return "Nothing to pay";
  return `${hasCredit(q) ? "Card payment" : q.payAtVenue ? "Pay at the venue" : "Total"} ${formatCents(q.totalCents)}`;
}

/** Server quote errors carry `code: "coupon_<reason>"`; anything else isn't a coupon problem. */
export function couponReasonFromCode(code: unknown): CouponRejection | null {
  if (typeof code !== "string" || !code.startsWith("coupon_")) return null;
  const reason = code.slice("coupon_".length);
  return (["invalid", "not_yet_active", "expired", "min_spend", "limit", "not_applicable"] as const).find((r) => r === reason) ?? "invalid";
}

// --- Coupons -----------------------------------------------------------------

/** The server's machine-readable rejection (server/src/pricing.ts CouponRejection). */
export type CouponRejection = "invalid" | "not_yet_active" | "expired" | "min_spend" | "limit" | "not_applicable";

/**
 * Customer copy for a rejected code. The standalone preview endpoint returns
 * one uniform message on purpose (commerce audit R5 — no code-existence
 * oracle), so a missing reason must fall back to the generic line.
 */
export function couponErrorCopy(reason: CouponRejection | null | undefined, minSpendCents?: number | null): string {
  switch (reason) {
    case "expired":
      return "That code has expired.";
    case "not_yet_active":
      return "That code isn't active yet.";
    case "limit":
      return "That code has already been fully used.";
    case "min_spend":
      return typeof minSpendCents === "number" ? `That code needs a minimum spend of ${formatCents(minSpendCents)}.` : "Your booking is below that code's minimum spend.";
    case "not_applicable":
      return "That code can't be used for this booking.";
    default:
      return "That code isn't valid.";
  }
}

/** Thrown by a CouponField `onApply` when the server rejected the code with a reason. */
export class CouponRejectedError extends Error {
  constructor(
    public reason: CouponRejection | null,
    public minSpendCents?: number | null,
  ) {
    super(couponErrorCopy(reason, minSpendCents));
    this.name = "CouponRejectedError";
  }
}

// --- Credit ------------------------------------------------------------------

/**
 * What the credit control says, from server values only:
 * - `unavailable`: no credit, or the switch is off → render nothing
 * - `ineligible`: credit exists but this booking can't use it
 * - `off`: available, not applied
 * - `applied`: the server applied all or part of it
 * - `balance_changed`: the resident asked for credit but the server applied
 *   less than it showed before (used elsewhere / expired) — the quote has
 *   already been recalculated, so this only explains why the total moved.
 */
export type CreditControlState = "unavailable" | "ineligible" | "off" | "applied" | "balance_changed";

export function creditControlState(input: { availableCents: number; eligible: boolean; requested: boolean; appliedCents: number | null; previouslyAppliedCents?: number | null }): CreditControlState {
  if (input.availableCents <= 0) return "unavailable";
  if (!input.eligible) return "ineligible";
  if (!input.requested) return "off";
  if (input.previouslyAppliedCents != null && input.appliedCents != null && input.appliedCents < input.previouslyAppliedCents) return "balance_changed";
  return "applied";
}
