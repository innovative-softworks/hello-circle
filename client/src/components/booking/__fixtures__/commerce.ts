// Commercial UX R2 — example server responses for the dev-only booking-kit
// preview and the component tests. Imported only by /dev/booking-kit (lazy,
// DEV builds) and *.test.* files, so none of this ships to production.
//
// Every figure is written out as a server would send it — nothing here is
// computed. commerceFixtures.test.ts checks the columns add up, so the
// preview never shows an impossible receipt.

import type { CheckoutQuote } from "../checkoutLines";
import type { CouponRedemptionsData, PayoutHistoryData, ReceiptDetail } from "../../commerceDisplay";

// --- Checkout quotes ------------------------------------------------------------

/** Venue hire, legacy pricing: VAT and the platform fee added, refundable deposit. */
export const Q_VENUE: CheckoutQuote = { subtotalCents: 8000, discountCents: 0, vatCents: 1840, platformFeeCents: 400, depositCents: 10000, totalCents: 20240, couponCode: null };

/** The same with code SPRING10 (10% off the hire, so VAT and the fee drop too). */
export const Q_VENUE_COUPON: CheckoutQuote = { subtotalCents: 8000, discountCents: 800, vatCents: 1656, platformFeeCents: 360, depositCents: 10000, totalCents: 19216, couponCode: "SPRING10" };

/** Experience, engine pricing: VAT included in the price, no customer fee. 2 × €45. */
export const Q_EXPERIENCE: CheckoutQuote = { subtotalCents: 9000, discountCents: 0, vatCents: 1683, vatIncluded: true, platformFeeCents: 0, totalCents: 9000, couponCode: null };

/** Experience with WELCOME10, no credit. */
export const Q_EXPERIENCE_COUPON: CheckoutQuote = { subtotalCents: 9000, discountCents: 900, couponDiscountCents: 900, creditCents: 0, vatCents: 1515, vatIncluded: true, platformFeeCents: 0, totalCents: 8100, couponCode: "WELCOME10" };

/** Experience with WELCOME10 and €25 of credit (the resident's whole balance).
 * The engine takes credit off before tax: discountCents = coupon + credit, and
 * totalCents is the card amount (VAT included in it). */
export const Q_EXPERIENCE_COUPON_CREDIT: CheckoutQuote = {
  subtotalCents: 9000,
  discountCents: 3400,
  couponDiscountCents: 900,
  creditCents: 2500,
  vatCents: 1047,
  vatIncluded: true,
  platformFeeCents: 0,
  totalCents: 5600,
  couponCode: "WELCOME10",
  creditBalanceAfterCents: 0,
};

/** Credit covers everything: 1 × €30 with a €40 balance → nothing to pay by card. */
export const Q_CREDIT_COVERS_ALL: CheckoutQuote = {
  subtotalCents: 3000,
  discountCents: 3000,
  couponDiscountCents: 0,
  creditCents: 3000,
  vatCents: 0,
  vatIncluded: true,
  platformFeeCents: 0,
  totalCents: 0,
  couponCode: null,
  creditBalanceAfterCents: 1000,
};

/** Insufficient credit: the resident had €25 when they ticked "use credit", but €15 was used elsewhere — now €10 applies. */
export const Q_CREDIT_BALANCE_CHANGED: CheckoutQuote = {
  subtotalCents: 9000,
  discountCents: 1000,
  couponDiscountCents: 0,
  creditCents: 1000,
  vatCents: 1496,
  vatIncluded: true,
  platformFeeCents: 0,
  totalCents: 8000,
  couponCode: null,
  creditBalanceAfterCents: 0,
};

/** Cash venue: nothing charged online. */
export const Q_PAY_AT_VENUE: CheckoutQuote = { subtotalCents: 6000, discountCents: 0, vatCents: 1380, platformFeeCents: 300, totalCents: 7680, couponCode: null, payAtVenue: true };

export const CHECKOUT_FIXTURES: { label: string; quote: CheckoutQuote; subtotalLabel: string; credit?: { availableCents: number; previouslyAppliedCents?: number } }[] = [
  { label: "Venue hire", quote: Q_VENUE, subtotalLabel: "Hall hire · 2 hours" },
  { label: "Code applied", quote: Q_VENUE_COUPON, subtotalLabel: "Hall hire · 2 hours" },
  { label: "Experience, VAT included", quote: Q_EXPERIENCE, subtotalLabel: "2 × €45.00" },
  { label: "Code + HelloCircle credit", quote: Q_EXPERIENCE_COUPON_CREDIT, subtotalLabel: "2 × €45.00", credit: { availableCents: 2500 } },
  { label: "Credit covers it all", quote: Q_CREDIT_COVERS_ALL, subtotalLabel: "1 × €30.00", credit: { availableCents: 4000 } },
  { label: "Insufficient credit (balance changed)", quote: Q_CREDIT_BALANCE_CHANGED, subtotalLabel: "2 × €45.00", credit: { availableCents: 1000, previouslyAppliedCents: 2500 } },
  { label: "Pay at the venue", quote: Q_PAY_AT_VENUE, subtotalLabel: "Room hire · 1 hour" },
];

/** A code expired between review and pay: the server re-priced without it (409 at checkout). */
export const EXPIRED_COUPON_NOTICE = {
  code: "SPRING10",
  quote: Q_VENUE,
  problem: "SPRING10 expired before you paid, so it no longer applies.",
  notice: "Your total changed to €202.40 because code SPRING10 expired. Check the new total, then pay.",
};

/** Codes the preview's coupon field answers to, mirroring the server's rejection reasons. */
export const PREVIEW_COUPON_REASONS: Record<string, "expired" | "not_yet_active" | "limit" | "min_spend" | "not_applicable"> = {
  OLDCODE: "expired",
  SOON: "not_yet_active",
  USEDUP: "limit",
  BIGSPEND: "min_spend",
  OTHERVENUE: "not_applicable",
};

// --- Receipts (same shapes and figures the server tests assert) ----------------

const NO_EXTRAS = { couponDiscountCents: 0, couponCode: null, creditCents: 0, vatIncluded: false, vatLabel: "VAT", depositCents: 0 };

export const RECEIPT_PAID: ReceiptDetail = {
  ref: "HB-482913",
  kind: "booking",
  label: "Rathmines Community Centre · Main Hall",
  createdAt: "2026-10-04T14:12:00.000Z",
  status: "paid",
  breakdownSource: "stored",
  breakdown: { ...NO_EXTRAS, subtotalCents: 8000, discountCents: 800, couponDiscountCents: 800, couponCode: "SPRING10", vatCents: 1656, platformFeeCents: 360, depositCents: 10000, totalCents: 19216 },
  totalCents: 19216,
  subtotalLabel: "Venue hire",
  refunds: [],
  refundedCardCents: 0,
  restoredCreditCents: 0,
  netPaidCents: 19216,
  paidOnline: true,
  isTaxInvoice: false,
};

/** Engine order: 2 × €45, WELCOME10 −€9 and €25 credit off before tax; card €56. One place refunded: €28 card + €12.50 credit (plan D1). */
export const RECEIPT_PART_REFUNDED: ReceiptDetail = {
  ref: "EX-20931",
  kind: "experience",
  label: "Sea kayaking at Dún Laoghaire",
  createdAt: "2026-10-02T09:40:00.000Z",
  status: "part_refunded",
  breakdownSource: "snapshot",
  breakdown: { subtotalCents: 9000, discountCents: 3400, couponDiscountCents: 900, couponCode: "WELCOME10", creditCents: 2500, vatCents: 1047, vatIncluded: true, vatLabel: "VAT (23%)", platformFeeCents: 0, depositCents: 0, totalCents: 5600 },
  totalCents: 5600,
  subtotalLabel: "2 places",
  refunds: [
    { id: "card-1", at: "2026-10-06T11:05:00.000Z", cardCents: 2800, creditCents: 0, status: "done", reason: "One place cancelled" },
    { id: "credit-1", at: "2026-10-06T11:05:00.000Z", cardCents: 0, creditCents: 1250, status: "done", reason: null },
  ],
  refundedCardCents: 2800,
  restoredCreditCents: 1250,
  netPaidCents: 4050,
  paidOnline: true,
  isTaxInvoice: false,
};

/** Host cancelled the game: everything back to the card. Games record only their total. */
export const RECEIPT_REFUNDED: ReceiptDetail = {
  ref: "GM-7731",
  kind: "game",
  label: "Five-a-side · Tuesday night",
  createdAt: "2026-09-28T18:00:00.000Z",
  status: "refunded",
  breakdownSource: "total_only",
  breakdown: null,
  totalCents: 1024,
  subtotalLabel: "Your place",
  refunds: [{ id: "card-2", at: "2026-09-29T08:30:00.000Z", cardCents: 1024, creditCents: 0, status: "done", reason: "The host cancelled this activity" }],
  refundedCardCents: 1024,
  restoredCreditCents: 0,
  netPaidCents: 0,
  paidOnline: true,
  isTaxInvoice: false,
};

export const RECEIPT_PENDING: ReceiptDetail = {
  ref: "CR-11804",
  kind: "registration",
  label: "Clontarf Juniors GAA · U10 hurling",
  createdAt: "2026-10-11T10:02:00.000Z",
  status: "pending",
  breakdownSource: "stored",
  breakdown: { ...NO_EXTRAS, subtotalCents: 4500, discountCents: 0, vatCents: 1035, platformFeeCents: 225, totalCents: 5760 },
  totalCents: 5760,
  subtotalLabel: "Registration",
  refunds: [],
  refundedCardCents: 0,
  restoredCreditCents: 0,
  netPaidCents: null,
  paidOnline: true,
  isTaxInvoice: false,
};

export const RECEIPT_FAILED: ReceiptDetail = {
  ref: "PS-3302",
  kind: "pass",
  label: "Clontarf Juniors GAA",
  createdAt: "2026-10-09T19:21:00.000Z",
  status: "failed",
  breakdownSource: "total_only",
  breakdown: null,
  totalCents: 15360,
  subtotalLabel: "10-session pass",
  refunds: [],
  refundedCardCents: 0,
  restoredCreditCents: 0,
  netPaidCents: null,
  paidOnline: false,
  isTaxInvoice: false,
};

/** Cash booking: recorded, nothing charged online. */
export const RECEIPT_PAY_AT_VENUE: ReceiptDetail = {
  ref: "HB-483300",
  kind: "booking",
  label: "Athlone Midlands Hub · Studio",
  createdAt: "2026-10-10T08:00:00.000Z",
  status: "pay_at_venue",
  breakdownSource: "stored",
  breakdown: { ...NO_EXTRAS, subtotalCents: 6000, discountCents: 0, vatCents: 1380, platformFeeCents: 300, totalCents: 7680 },
  totalCents: 7680,
  subtotalLabel: "Venue hire",
  refunds: [],
  refundedCardCents: 0,
  restoredCreditCents: 0,
  netPaidCents: null,
  paidOnline: false,
  isTaxInvoice: false,
};

export const RECEIPT_FIXTURES: { label: string; receipt: ReceiptDetail }[] = [
  { label: "Paid, with a code", receipt: RECEIPT_PAID },
  { label: "Partial refund (card + credit)", receipt: RECEIPT_PART_REFUNDED },
  { label: "Refunded in full", receipt: RECEIPT_REFUNDED },
  { label: "Payment pending", receipt: RECEIPT_PENDING },
  { label: "Payment failed", receipt: RECEIPT_FAILED },
  { label: "Pay at the venue", receipt: RECEIPT_PAY_AT_VENUE },
];

// --- Payout history -------------------------------------------------------------

export const PAYOUTS_ACTIVE: PayoutHistoryData = {
  accountState: "enabled",
  minimumPayoutCents: 2500,
  items: [
    { id: "po_4", type: "bank_payout", date: "2026-10-13T00:00:00.000Z", amountCents: 21240, status: "in_transit" },
    { id: "tr_4", type: "transfer", date: "2026-10-09T09:00:00.000Z", amountCents: 21240, status: "sent", settlementRef: "2026-W41", bookings: 5 },
    { id: "po_3", type: "bank_payout", date: "2026-10-06T00:00:00.000Z", amountCents: 8610, status: "paid" },
    { id: "tr_3", type: "transfer", date: "2026-10-02T09:00:00.000Z", amountCents: 9810, status: "partly_reversed", settlementRef: "2026-W40", bookings: 3, recoveredCents: 1200 },
    { id: "po_2", type: "bank_payout", date: "2026-09-29T00:00:00.000Z", amountCents: 4400, status: "failed", failureMessage: "Your bank rejected the payout: the account is closed." },
  ],
};

export const PAYOUTS_EMPTY: PayoutHistoryData = { accountState: "enabled", minimumPayoutCents: 2500, items: [] };

export const PAYOUTS_RESTRICTED: PayoutHistoryData = {
  accountState: "transfers_unavailable",
  minimumPayoutCents: 2500,
  items: [{ id: "tr_9", type: "transfer", date: "2026-09-25T09:00:00.000Z", amountCents: 6120, status: "sent", settlementRef: "2026-W39", bookings: 2 }],
};

// --- Coupon redemptions ---------------------------------------------------------

export const REDEMPTIONS: CouponRedemptionsData = {
  code: "AUTUMN15",
  rows: [
    { id: "cr_5", at: "2026-10-11T09:14:00.000Z", bookingRef: "HB-483120", listingName: "Main Hall", discountCents: 1200, state: "reserved" },
    { id: "cr_4", at: "2026-10-10T17:30:00.000Z", bookingRef: "HB-483077", listingName: "Main Hall", discountCents: 1200, state: "confirmed" },
    { id: "cr_3", at: "2026-10-08T12:02:00.000Z", bookingRef: "HB-482990", listingName: "Studio 2", discountCents: 450, state: "reversed" },
    { id: "cr_2", at: "2026-10-07T20:41:00.000Z", bookingRef: "HB-482951", listingName: "Studio 2", discountCents: 450, state: "released" },
    { id: "cr_1", at: "2026-10-05T10:15:00.000Z", bookingRef: "HB-482900", listingName: "Main Hall", discountCents: 1200, state: "confirmed" },
  ],
};

export const REDEMPTIONS_EMPTY: CouponRedemptionsData = { code: "AUTUMN15", rows: [] };
