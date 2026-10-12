import { describe, expect, it } from "vitest";
import { computePricing } from "../pricing.js";
import { RULE_KEYS, TARGET_MODEL_DRAFT } from "./catalog.js";
import { allocate, applyBps, divRoundHalfUp, priceBreakdown, type PriceBreakdown, type PricingValues } from "./money.js";

// Commerce Engine Phase 1 — pure money maths. No database.

const v1 = RULE_KEYS.pricing.v1 as unknown as PricingValues;
const target = TARGET_MODEL_DRAFT.payload as unknown as PricingValues;

function invariantHolds(b: PriceBreakdown) {
  return b.customerPaidMinor === b.partnerPayoutMinor + b.successFeeMinor + b.partnerPaymentCostMinor + b.customerFeeMinor + b.vatMinor + b.depositMinor;
}

describe("rounding", () => {
  it("divRoundHalfUp rounds halves up", () => {
    expect(divRoundHalfUp(5, 10)).toBe(1);
    expect(divRoundHalfUp(4, 10)).toBe(0);
    expect(divRoundHalfUp(15, 10)).toBe(2);
    expect(divRoundHalfUp(0, 7)).toBe(0);
  });
  it("applyBps matches legacy float rounding for every amount up to €2,000", () => {
    for (let t = 0; t <= 200_000; t++) {
      expect(applyBps(t, 2300)).toBe(Math.round(t * 0.23));
      expect(applyBps(t, 500)).toBe(Math.round(t * 0.05));
    }
  });
  it("rejects negative, fractional or unsafe inputs instead of guessing", () => {
    expect(() => applyBps(-1, 500)).toThrow(RangeError);
    expect(() => applyBps(10.5, 500)).toThrow(RangeError);
    expect(() => applyBps(100, -5)).toThrow(RangeError);
    expect(() => priceBreakdown({ listMinor: 100, discountMinor: -1, depositMinor: 0 }, v1)).toThrow(RangeError);
  });
});

describe("rule v1 reproduces live pricing exactly (golden)", () => {
  const lists = [0, 1, 99, 100, 250, 999, 1_000, 1_234, 2_500, 4_999, 5_000, 12_345, 25_000, 99_999, 250_000];
  const discounts = [0, 1, 100, 500, 1_000, 1_000_000];
  const deposits = [0, 10_000];
  it("customer total, VAT and fee equal computePricing() for a grid of inputs", () => {
    for (const list of lists)
      for (const discount of discounts)
        for (const deposit of deposits) {
          const legacy = computePricing(list, deposit, Math.min(discount, list), null);
          const next = priceBreakdown({ listMinor: list, discountMinor: Math.min(discount, list), depositMinor: deposit }, v1);
          expect(next.customerPaidMinor).toBe(legacy.totalCents);
          expect(next.vatMinor).toBe(legacy.vatCents);
          expect(next.customerFeeMinor).toBe(legacy.platformFeeCents);
          expect(next.discountedMinor).toBe(legacy.taxableCents);
        }
  });
  it("under v1 the partner receives the full discounted list price (no success fee)", () => {
    const b = priceBreakdown({ listMinor: 5_000, discountMinor: 500, depositMinor: 0 }, v1);
    expect(b.partnerPayoutMinor).toBe(4_500);
    expect(b.successFeeMinor).toBe(0);
  });
});

describe("allocation invariant (prompt §21)", () => {
  it("holds for v1 and the target model across amounts, discounts and deposits", () => {
    for (const values of [v1, target, { ...target, paymentCostBearer: "partner" as const }, { ...target, successFeeBase: "customer_goods" as const }])
      for (let list = 0; list <= 30_000; list += 137)
        for (const discount of [0, 250, 40_000])
          for (const deposit of [0, 10_000]) {
            const b = priceBreakdown({ listMinor: list, discountMinor: discount, depositMinor: deposit }, values);
            expect(invariantHolds(b)).toBe(true);
          }
  });
  it("a discount can never exceed the list price", () => {
    const b = priceBreakdown({ listMinor: 1_000, discountMinor: 5_000, depositMinor: 0 }, v1);
    expect(b.discountMinor).toBe(1_000);
    expect(b.customerPaidMinor).toBe(0);
  });
  it("free orders carry no processing cost", () => {
    const b = priceBreakdown({ listMinor: 0, discountMinor: 0, depositMinor: 0 }, target);
    expect(b.paymentCostMinor).toBe(0);
    expect(b.customerPaidMinor).toBe(0);
  });
});

describe("target model (draft v2) behaviour", () => {
  it("customer pays one VAT-inclusive price with a €0 HelloCircle fee", () => {
    const b = priceBreakdown({ listMinor: 12_300, discountMinor: 0, depositMinor: 0 }, target);
    expect(b.customerFeeMinor).toBe(0);
    expect(b.customerPaidMinor).toBe(12_300);
    expect(b.vatMinor).toBe(2_300); // 12300 × 23/123
    expect(b.partnerGrossMinor).toBe(10_000);
    expect(b.successFeeMinor).toBe(700); // 7% of the net
    expect(b.partnerPayoutMinor).toBe(9_300);
    expect(b.platformRevenueMinor).toBe(700);
  });
  it("payment cost is absorbed by the platform by default", () => {
    const b = priceBreakdown({ listMinor: 10_000, discountMinor: 0, depositMinor: 0 }, target);
    expect(b.partnerPaymentCostMinor).toBe(0);
    expect(b.platformContributionMinor).toBe(b.platformRevenueMinor - b.paymentCostMinor);
  });
});

describe("allocate", () => {
  it("parts always sum exactly to the total", () => {
    for (const total of [0, 1, 2, 99, 100, 101, 12_345])
      for (const weights of [[1, 1], [1, 2], [50, 50], [1, 1, 1], [7, 0, 3]]) {
        const parts = allocate(total, weights);
        expect(parts.reduce((a, b) => a + b, 0)).toBe(total);
      }
  });
  it("splits a 50/50 odd cent deterministically to the first share", () => {
    expect(allocate(101, [50, 50])).toEqual([51, 50]);
  });
  it("rejects all-zero weights", () => {
    expect(() => allocate(100, [0, 0])).toThrow(RangeError);
  });
});
