import { describe, expect, it } from "vitest";
import { CHECKOUT_FIXTURES, PAYOUTS_ACTIVE, RECEIPT_FIXTURES } from "./commerce";
import type { CheckoutQuote } from "../checkoutLines";

// The preview must never show an impossible receipt: check the fixtures'
// columns add up the way the server's would. (Arithmetic lives only in this
// test — the components never add anything up.)

function addsUp(q: CheckoutQuote) {
  const vat = q.vatIncluded ? 0 : q.vatCents;
  expect(q.subtotalCents - q.discountCents + vat + q.platformFeeCents + (q.depositCents ?? 0)).toBe(q.totalCents);
  // Engine order: coupon and credit both come off before tax.
  if (q.creditCents) expect((q.couponDiscountCents ?? 0) + q.creditCents).toBe(q.discountCents);
  expect(q.totalCents).toBeGreaterThanOrEqual(0);
}

describe("commerce fixtures are internally consistent", () => {
  it("checkout quotes", () => {
    for (const f of CHECKOUT_FIXTURES) addsUp(f.quote);
  });

  it("receipts: breakdowns add up and net paid = card + credit − everything given back", () => {
    for (const { receipt: r } of RECEIPT_FIXTURES) {
      if (r.breakdown) {
        addsUp(r.breakdown);
        expect(r.breakdown.totalCents, r.ref).toBe(r.totalCents);
      }
      expect(r.refunds.reduce((s, f) => s + f.cardCents, 0), r.ref).toBe(r.refundedCardCents);
      expect(r.refunds.reduce((s, f) => s + f.creditCents, 0), r.ref).toBe(r.restoredCreditCents);
      if (r.netPaidCents !== null) expect(r.totalCents + (r.breakdown?.creditCents ?? 0) - r.refundedCardCents - r.restoredCreditCents, r.ref).toBe(r.netPaidCents);
      if (r.status === "refunded") expect(r.netPaidCents).toBe(0);
      if (r.status === "part_refunded") expect(r.refunds.length).toBeGreaterThan(0);
    }
  });

  it("payouts: each bank payout matches the transfer before it, net of recoveries", () => {
    const byId = Object.fromEntries(PAYOUTS_ACTIVE.items.map((i) => [i.id, i]));
    expect(byId.po_4.amountCents).toBe(byId.tr_4.amountCents);
    expect(byId.po_3.amountCents).toBe(byId.tr_3.amountCents - (byId.tr_3.recoveredCents ?? 0));
  });
});
