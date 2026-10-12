import { describe, expect, it } from "vitest";
import { RULE_KEYS } from "./catalog.js";
import { calculate, monthlyPlanCost, type CalcInput, type SplitRule } from "./calc.js";

// Revenue & Connect Stage 2b — the brief's required test vectors (§7), to
// the cent, using the seeded v1 rule values (never literal rates), plus
// reconciliation properties (§21) and the blocking rules (§6).

const free = RULE_KEYS.plan_free.v1 as { successFeeBps: number; minFeeMinor: number; subscriptionMonthlyMinor: number };
const pro = RULE_KEYS.plan_pro.v1 as { successFeeBps: number; minFeeMinor: number; subscriptionMonthlyMinor: number };
const tax = RULE_KEYS.tax_vat.v1 as { vatBps: number; vatMode: "standard" };
const costs = RULE_KEYS.payment_costs.v1 as { cardBps: number; cardFixedMinor: number; payoutBps: number; payoutFixedMinor: number };
const one: SplitRule = { mode: "single", recipient: "vendor" };

const order = (priceMinor: number, plan = free, extra: Partial<CalcInput> = {}): CalcInput => ({
  lines: [{ unitMinor: priceMinor, quantity: 1 }],
  plan: { successFeeBps: plan.successFeeBps, minFeeMinor: plan.minFeeMinor },
  tax,
  costs,
  split: one,
  ...extra,
});

describe("brief §7 test vectors", () => {
  it("TEST 1 — Free plan, €100", () => {
    const r = calculate(order(10_000));
    expect(r).toMatchObject({ customerChargeMinor: 10_000, platformFeeNetMinor: 900, platformFeeVatMinor: 207, partnerPoolMinor: 8_893, cardEstimateMinor: 175, payoutEstimateMinor: 32, contributionBeforeReservesMinor: 693 });
  });

  it("TEST 2 — Pro plan, €100", () => {
    const r = calculate(order(10_000, pro));
    expect(r).toMatchObject({ customerChargeMinor: 10_000, platformFeeNetMinor: 700, platformFeeVatMinor: 161, partnerPoolMinor: 9_139, cardEstimateMinor: 175, payoutEstimateMinor: 33, contributionBeforeReservesMinor: 492 });
  });

  it("TEST 3 — Free plan, €10", () => {
    const r = calculate(order(1_000));
    expect(r).toMatchObject({ platformFeeNetMinor: 90, platformFeeVatMinor: 21, partnerPoolMinor: 889, cardEstimateMinor: 40, payoutEstimateMinor: 12, contributionBeforeReservesMinor: 38 });
  });

  it("TEST 4 — Free plan minimum fee, €5", () => {
    const r = calculate(order(500));
    expect(r.percentageFeeMinor).toBe(45);
    expect(r).toMatchObject({ minimumFeeApplied: true, platformFeeNetMinor: 75, platformFeeVatMinor: 17, partnerPoolMinor: 408 });
  });

  it("TEST 5 — venue and host split: one commission, two recipients, exact reconciliation", () => {
    const r = calculate(order(10_000, free, { split: { mode: "fixed_venue", venueMinor: 3_500 } }));
    expect(r).toMatchObject({ platformFeeNetMinor: 900, platformFeeVatMinor: 207, partnerPoolMinor: 8_893 });
    expect(r.allocations.map((a) => [a.recipient, a.amountMinor])).toEqual([["venue", 3_500], ["host", 5_393]]);
    expect(r.allocations.reduce((a, x) => a + x.amountMinor, 0)).toBe(8_893);
  });

  it("TEST 6 — vendor-funded coupon: the vendor bears the discount", () => {
    const r = calculate(order(10_000, free, { discounts: [{ funder: "vendor", amountMinor: 1_000 }] }));
    expect(r).toMatchObject({ feeBaseMinor: 9_000, customerChargeMinor: 9_000, platformFeeNetMinor: 810, platformFeeVatMinor: 186, partnerPoolMinor: 8_004 });
  });

  it("TEST 7 — HelloCircle-funded coupon: partner untouched, subsidy recorded, margin warning", () => {
    const r = calculate(order(10_000, free, { discounts: [{ funder: "helloCircle", amountMinor: 1_000 }] }));
    expect(r).toMatchObject({ customerChargeMinor: 9_000, feeBaseMinor: 10_000, platformFeeNetMinor: 900, partnerPoolMinor: 8_893, helloCircleFundedDiscountMinor: 1_000 });
    expect(r.contributionBeforeReservesMinor).toBeLessThan(0);
    expect(r.marginWarning).toBe(true);
  });
});

describe("funding, credits and splits", () => {
  it("a shared coupon allocates the funding explicitly and exactly", () => {
    const r = calculate(order(10_000, free, { discounts: [{ funder: "shared", amountMinor: 1_001, platformShareBps: 5_000 }] }));
    expect(r.helloCircleFundedDiscountMinor + r.partnerFundedDiscountMinor).toBe(1_001);
    expect(r.helloCircleFundedDiscountMinor).toBe(501); // remainder cent to the first share (HelloCircle)
    expect(r.feeBaseMinor).toBe(10_000 - 500);
  });

  it("host- and venue-funded discounts reduce the fee base like vendor-funded ones", () => {
    for (const funder of ["host", "venue"] as const) expect(calculate(order(10_000, free, { discounts: [{ funder, amountMinor: 1_000 }] })).feeBaseMinor).toBe(9_000);
  });

  it("HelloCircle credit lowers the customer charge only; vendor credit lowers the fee base", () => {
    const hc = calculate(order(10_000, free, { credits: [{ funder: "helloCircle", amountMinor: 2_000 }] }));
    expect(hc).toMatchObject({ customerChargeMinor: 8_000, partnerPoolMinor: 8_893 });
    const vendor = calculate(order(10_000, free, { credits: [{ funder: "vendor", amountMinor: 2_000 }] }));
    expect(vendor).toMatchObject({ feeBaseMinor: 8_000, customerChargeMinor: 8_000 });
  });

  it("percentage and fixed-host splits reconcile, with the documented remainder rule", () => {
    const pct = calculate(order(10_001, free, { split: { mode: "percentage", venueBps: 3_333 } }));
    expect(pct.allocations.reduce((a, x) => a + x.amountMinor, 0)).toBe(pct.partnerPoolMinor);
    const host = calculate(order(10_000, free, { split: { mode: "fixed_host", hostMinor: 4_000 } }));
    expect(host.allocations.map((a) => a.amountMinor)).toEqual([4_893, 4_000]);
  });

  it("refunded service amounts reduce the fee base", () => {
    expect(calculate(order(10_000, free, { refundedServiceMinor: 4_000 })).feeBaseMinor).toBe(6_000);
  });

  it("free orders carry no platform fee and no card cost", () => {
    const r = calculate(order(0));
    expect(r).toMatchObject({ ok: true, platformFeeNetMinor: 0, platformFeeVatMinor: 0, partnerPoolMinor: 0, cardEstimateMinor: 0, customerChargeMinor: 0 });
  });

  it("reverse-charge or exempt partners get no fee VAT", () => {
    for (const vatMode of ["reverse_charge", "exempt"] as const) {
      const r = calculate(order(10_000, free, { tax: { vatBps: 2_300, vatMode } }));
      expect(r).toMatchObject({ platformFeeVatMinor: 0, partnerPoolMinor: 9_100 });
    }
  });

  it("reward reserve ≈ 0.29% of GMV (1 point/€, 10,000 points = €29)", () => {
    const rw = RULE_KEYS.rewards.v1 as { pointsPerEuro: number; redemptionPoints: number };
    const r = calculate(order(10_000, free, { rewards: { ...rw, rewardValueMinor: pro.subscriptionMonthlyMinor } }));
    expect(r.rewardReserveMinor).toBe(29);
    expect(r.contributionMinor).toBe(r.contributionBeforeReservesMinor - 29);
  });
});

describe("blocking rules (no negative partner payout, no over-allocation)", () => {
  it("a price below the minimum fee is blocked, not charged", () => {
    const r = calculate(order(50));
    expect(r.ok).toBe(false);
    expect(r.blockedReason).toMatch(/negative/);
  });
  it("a fixed venue amount larger than the pool is blocked", () => {
    expect(calculate(order(1_000, free, { split: { mode: "fixed_venue", venueMinor: 5_000 } })).ok).toBe(false);
  });
  it("custom allocations must add up exactly", () => {
    expect(calculate(order(10_000, free, { split: { mode: "custom", allocations: [{ recipient: "venue", amountMinor: 1 }] } })).ok).toBe(false);
    const ok = calculate(order(10_000, free, { split: { mode: "custom", allocations: [{ recipient: "venue", amountMinor: 3_000 }, { recipient: "host", amountMinor: 5_893 }] } }));
    expect(ok.ok).toBe(true);
  });
  it("HelloCircle subsidy can't exceed the price; partner discounts can't exceed the price", () => {
    expect(calculate(order(1_000, free, { discounts: [{ funder: "helloCircle", amountMinor: 2_000 }] })).ok).toBe(false);
    expect(calculate(order(1_000, free, { discounts: [{ funder: "vendor", amountMinor: 2_000 }] })).ok).toBe(false);
  });
  it("rejects non-integer or negative money instead of guessing", () => {
    expect(() => calculate(order(10.5))).toThrow(RangeError);
    expect(() => calculate(order(-1))).toThrow(RangeError);
  });
});

describe("reconciliation properties (§21)", () => {
  it("customer charge + HelloCircle subsidy = partner pool + fee + fee VAT, and allocations sum to the pool", () => {
    for (let price = 75; price <= 50_000; price += 97)
      for (const plan of [free, pro])
        for (const split of [one, { mode: "fixed_venue", venueMinor: 0 } as SplitRule, { mode: "percentage", venueBps: 4_000 } as SplitRule])
          for (const hc of [0, 50]) {
            const r = calculate(order(price, plan, { split, discounts: hc ? [{ funder: "helloCircle", amountMinor: Math.min(hc, price) }] : [] }));
            if (!r.ok) continue;
            expect(r.customerChargeMinor + r.helloCircleFundedDiscountMinor + r.helloCircleFundedCreditMinor).toBe(r.partnerPoolMinor + r.platformFeeNetMinor + r.platformFeeVatMinor + r.customerTaxMinor);
            expect(r.allocations.reduce((a, x) => a + x.amountMinor, 0)).toBe(r.partnerPoolMinor);
            expect(r.partnerPoolMinor).toBeGreaterThanOrEqual(0);
          }
  });
});

describe("Free vs Pro monthly comparison (§5)", () => {
  it("at €1,450 GMV Pro costs the same in fees + subscription (before VAT)", () => {
    const f = monthlyPlanCost(145_000, 145, free, tax);
    const p = monthlyPlanCost(145_000, 145, pro, tax);
    expect(f.feesMinor).toBe(13_050);
    expect(p.feesMinor + p.subscriptionMinor).toBe(10_150 + 2_900);
    expect(f.feesMinor).toBe(p.feesMinor + p.subscriptionMinor);
  });
  it("applies the minimum fee per order", () => {
    expect(monthlyPlanCost(1_000, 4, free, tax).feesMinor).toBe(4 * 75); // €2.50 orders: 9% = 23c < 75c minimum
  });
});
