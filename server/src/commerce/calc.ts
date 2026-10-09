// Revenue & Connect Stage 2b — calculation engine, formula "pe-2"
// (docs/revenue-connect/07 §Calculation; brief §6–§8).
//
// Pure functions over integer minor units and basis points: no database, no
// clock, no floating point. Every caller (checkout, earnings estimator, admin
// simulator, statements, refunds, reports, tests) gets the same answer from
// the same inputs; the resolver in calcContext.ts supplies the inputs from the
// published, versioned rules.
//
//   fee_base         = service subtotal − partner-funded discount/credit − refunded service
//   platform_fee_net = 0 for a free order, else max(round(fee_base × rate), plan minimum)
//   platform_fee_vat = round(platform_fee_net × VAT)   (0 when exempt or reverse charge)
//   partner_pool     = fee_base − platform_fee_net − platform_fee_vat      (never negative)
//   customer_charge  = fee_base − HelloCircle-funded discount/credit + customer-facing tax
//   contribution     = fee − card estimate − payout estimates − HelloCircle subsidy (− reserves)
//
// Rounding: half-up per component on integer cents. Splits use the
// largest-remainder method; any remaining cent goes to the FIRST recipient
// in the split's declared order (venue before host), so allocations always
// reconcile exactly to the partner pool.

import { allocate, applyBps, BPS, divRoundHalfUp } from "./money.js";

export const CALC_FORMULA_VERSION = "pe-2";

export type DiscountFunder = "vendor" | "host" | "venue" | "helloCircle" | "shared";
export type Recipient = "vendor" | "host" | "venue";

export interface CalcDiscount {
  funder: DiscountFunder;
  amountMinor: number;
  /** shared only: HelloCircle's share in basis points (the partner funds the rest). */
  platformShareBps?: number;
  /** For reporting (coupon code, campaign key). */
  ref?: string;
}

export interface CalcCredit {
  funder: "helloCircle" | "vendor";
  amountMinor: number;
  ref?: string;
}

export type SplitRule =
  | { mode: "single"; recipient: Recipient }
  | { mode: "fixed_venue"; venueMinor: number }
  | { mode: "fixed_host"; hostMinor: number }
  | { mode: "percentage"; venueBps: number }
  | { mode: "custom"; allocations: { recipient: Recipient; amountMinor: number }[] };

export interface CalcInput {
  lines: { unitMinor: number; quantity: number }[];
  discounts?: CalcDiscount[];
  credits?: CalcCredit[];
  refundedServiceMinor?: number;
  /** Customer-facing tax added on top, only where legally configured (default 0). */
  customerTaxMinor?: number;
  plan: { successFeeBps: number; minFeeMinor: number };
  tax: { vatBps: number; vatMode: "standard" | "exempt" | "reverse_charge" };
  costs: { cardBps: number; cardFixedMinor: number; payoutBps: number; payoutFixedMinor: number };
  split: SplitRule;
  reserves?: { refundReserveBps: number; disputeReserveBps: number };
  rewards?: { pointsPerEuro: number; redemptionPoints: number; rewardValueMinor: number };
  marginWarningMinor?: number;
}

export interface CalcAllocation {
  recipient: Recipient;
  amountMinor: number;
  payoutEstimateMinor: number;
}

export interface CalcResult {
  formulaVersion: string;
  ok: boolean;
  /** Why the order can't be taken (e.g. a negative partner payout). */
  blockedReason: string | null;
  serviceSubtotalMinor: number;
  partnerFundedDiscountMinor: number;
  helloCircleFundedDiscountMinor: number;
  helloCircleFundedCreditMinor: number;
  partnerFundedCreditMinor: number;
  refundedServiceMinor: number;
  feeBaseMinor: number;
  percentageFeeMinor: number;
  minimumFeeApplied: boolean;
  platformFeeNetMinor: number;
  platformFeeVatMinor: number;
  partnerPoolMinor: number;
  allocations: CalcAllocation[];
  customerTaxMinor: number;
  customerChargeMinor: number;
  cardEstimateMinor: number;
  payoutEstimateMinor: number;
  rewardReserveMinor: number;
  riskReserveMinor: number;
  contributionBeforeReservesMinor: number;
  contributionMinor: number;
  marginWarning: boolean;
}

function assertMinor(n: number, name: string) {
  if (!Number.isSafeInteger(n) || n < 0) throw new RangeError(`${name} must be a non-negative integer (minor units), got ${n}`);
}

function assertBps(n: number, name: string, max = BPS) {
  if (!Number.isSafeInteger(n) || n < 0 || n > max) throw new RangeError(`${name} must be an integer from 0 to ${max} bps, got ${n}`);
}

/** Splits the partner pool; returns null + reason when the rule can't be met. */
export function splitPool(poolMinor: number, rule: SplitRule): { allocations: { recipient: Recipient; amountMinor: number }[]; error: string | null } {
  switch (rule.mode) {
    case "single":
      return { allocations: [{ recipient: rule.recipient, amountMinor: poolMinor }], error: null };
    case "fixed_venue": {
      assertMinor(rule.venueMinor, "venueMinor");
      if (rule.venueMinor > poolMinor) return { allocations: [], error: "The venue's fixed amount is more than the partner payout available" };
      return { allocations: [{ recipient: "venue", amountMinor: rule.venueMinor }, { recipient: "host", amountMinor: poolMinor - rule.venueMinor }], error: null };
    }
    case "fixed_host": {
      assertMinor(rule.hostMinor, "hostMinor");
      if (rule.hostMinor > poolMinor) return { allocations: [], error: "The host's fixed amount is more than the partner payout available" };
      return { allocations: [{ recipient: "venue", amountMinor: poolMinor - rule.hostMinor }, { recipient: "host", amountMinor: rule.hostMinor }], error: null };
    }
    case "percentage": {
      assertBps(rule.venueBps, "venueBps");
      if (poolMinor === 0) return { allocations: [{ recipient: "venue", amountMinor: 0 }, { recipient: "host", amountMinor: 0 }], error: null };
      const [venue, host] = allocate(poolMinor, [rule.venueBps, BPS - rule.venueBps]);
      return { allocations: [{ recipient: "venue", amountMinor: venue }, { recipient: "host", amountMinor: host }], error: null };
    }
    case "custom": {
      const total = rule.allocations.reduce((a, x) => {
        assertMinor(x.amountMinor, "allocation");
        return a + x.amountMinor;
      }, 0);
      if (total !== poolMinor) return { allocations: [], error: `Custom allocations (${total}) must add up exactly to the partner payout (${poolMinor})` };
      return { allocations: rule.allocations.map((x) => ({ ...x })), error: null };
    }
  }
}

export function calculate(input: CalcInput): CalcResult {
  assertBps(input.plan.successFeeBps, "successFeeBps");
  assertMinor(input.plan.minFeeMinor, "minFeeMinor");
  assertBps(input.tax.vatBps, "vatBps");
  for (const l of input.lines) {
    assertMinor(l.unitMinor, "unitMinor");
    if (!Number.isSafeInteger(l.quantity) || l.quantity < 0) throw new RangeError("quantity must be a non-negative integer");
  }
  const serviceSubtotalMinor = input.lines.reduce((a, l) => a + l.unitMinor * l.quantity, 0);
  assertMinor(serviceSubtotalMinor, "service subtotal");

  // Discount funding (brief §6 rules: partner-funded reduces the fee base;
  // HelloCircle-funded reduces only what the customer pays).
  let partnerFundedDiscountMinor = 0;
  let helloCircleFundedDiscountMinor = 0;
  for (const d of input.discounts ?? []) {
    assertMinor(d.amountMinor, "discount");
    if (d.funder === "helloCircle") helloCircleFundedDiscountMinor += d.amountMinor;
    else if (d.funder === "shared") {
      const share = d.platformShareBps ?? 0;
      assertBps(share, "platformShareBps");
      const [platform, partner] = allocate(d.amountMinor, [share, BPS - share]);
      helloCircleFundedDiscountMinor += platform;
      partnerFundedDiscountMinor += partner;
    } else partnerFundedDiscountMinor += d.amountMinor;
  }
  let helloCircleFundedCreditMinor = 0;
  let partnerFundedCreditMinor = 0;
  for (const c of input.credits ?? []) {
    assertMinor(c.amountMinor, "credit");
    if (c.funder === "helloCircle") helloCircleFundedCreditMinor += c.amountMinor;
    else partnerFundedCreditMinor += c.amountMinor;
  }
  const refundedServiceMinor = input.refundedServiceMinor ?? 0;
  assertMinor(refundedServiceMinor, "refundedServiceMinor");

  const blocked = (reason: string): CalcResult => ({ ...empty(serviceSubtotalMinor), blockedReason: reason });

  const feeBaseRaw = serviceSubtotalMinor - partnerFundedDiscountMinor - partnerFundedCreditMinor - refundedServiceMinor;
  if (feeBaseRaw < 0) return blocked("Partner-funded discounts are larger than the price");
  const feeBaseMinor = feeBaseRaw;

  const percentageFeeMinor = applyBps(feeBaseMinor, input.plan.successFeeBps);
  // Free order (nothing to charge): no platform fee (brief: free events carry no commission).
  const minimumFeeApplied = feeBaseMinor > 0 && percentageFeeMinor < input.plan.minFeeMinor;
  const platformFeeNetMinor = feeBaseMinor === 0 ? 0 : Math.max(percentageFeeMinor, input.plan.minFeeMinor);
  const platformFeeVatMinor = input.tax.vatMode === "standard" ? applyBps(platformFeeNetMinor, input.tax.vatBps) : 0;
  const partnerPoolMinor = feeBaseMinor - platformFeeNetMinor - platformFeeVatMinor;
  if (partnerPoolMinor < 0) return blocked("The price is too low to cover HelloCircle's minimum fee — the partner payout would be negative");

  const hcSubsidy = helloCircleFundedDiscountMinor + helloCircleFundedCreditMinor;
  if (hcSubsidy > feeBaseMinor) return blocked("HelloCircle-funded discounts and credits are larger than the price");
  const customerTaxMinor = input.customerTaxMinor ?? 0;
  assertMinor(customerTaxMinor, "customerTaxMinor");
  const customerChargeMinor = feeBaseMinor - hcSubsidy + customerTaxMinor;

  const split = splitPool(partnerPoolMinor, input.split);
  if (split.error) return blocked(split.error);

  const payoutEstimate = (amount: number) => (amount > 0 ? applyBps(amount, input.costs.payoutBps) + input.costs.payoutFixedMinor : 0);
  const allocations: CalcAllocation[] = split.allocations.map((a) => ({ ...a, payoutEstimateMinor: payoutEstimate(a.amountMinor) }));
  const payoutEstimateMinor = allocations.reduce((a, x) => a + x.payoutEstimateMinor, 0);
  const cardEstimateMinor = customerChargeMinor > 0 ? applyBps(customerChargeMinor, input.costs.cardBps) + input.costs.cardFixedMinor : 0;

  // Reward reserve: points earned on this order valued at the reward
  // (1 point per €1 → 10,000 points = one €29 month ≈ 0.29% of GMV).
  const r = input.rewards;
  const rewardReserveMinor = r && r.redemptionPoints > 0 ? divRoundHalfUp(feeBaseMinor * r.pointsPerEuro * r.rewardValueMinor, 100 * r.redemptionPoints) : 0;
  const riskReserveMinor = input.reserves ? applyBps(feeBaseMinor, input.reserves.refundReserveBps + input.reserves.disputeReserveBps) : 0;

  const contributionBeforeReservesMinor = platformFeeNetMinor - cardEstimateMinor - payoutEstimateMinor - hcSubsidy;
  const contributionMinor = contributionBeforeReservesMinor - rewardReserveMinor - riskReserveMinor;

  return {
    formulaVersion: CALC_FORMULA_VERSION,
    ok: true,
    blockedReason: null,
    serviceSubtotalMinor,
    partnerFundedDiscountMinor,
    helloCircleFundedDiscountMinor,
    helloCircleFundedCreditMinor,
    partnerFundedCreditMinor,
    refundedServiceMinor,
    feeBaseMinor,
    percentageFeeMinor,
    minimumFeeApplied,
    platformFeeNetMinor,
    platformFeeVatMinor,
    partnerPoolMinor,
    allocations,
    customerTaxMinor,
    customerChargeMinor,
    cardEstimateMinor,
    payoutEstimateMinor,
    rewardReserveMinor,
    riskReserveMinor,
    contributionBeforeReservesMinor,
    contributionMinor,
    marginWarning: contributionBeforeReservesMinor < (input.marginWarningMinor ?? 0),
  };
}

function empty(serviceSubtotalMinor: number): CalcResult {
  return {
    formulaVersion: CALC_FORMULA_VERSION,
    ok: false,
    blockedReason: null,
    serviceSubtotalMinor,
    partnerFundedDiscountMinor: 0,
    helloCircleFundedDiscountMinor: 0,
    helloCircleFundedCreditMinor: 0,
    partnerFundedCreditMinor: 0,
    refundedServiceMinor: 0,
    feeBaseMinor: 0,
    percentageFeeMinor: 0,
    minimumFeeApplied: false,
    platformFeeNetMinor: 0,
    platformFeeVatMinor: 0,
    partnerPoolMinor: 0,
    allocations: [],
    customerTaxMinor: 0,
    customerChargeMinor: 0,
    cardEstimateMinor: 0,
    payoutEstimateMinor: 0,
    rewardReserveMinor: 0,
    riskReserveMinor: 0,
    contributionBeforeReservesMinor: 0,
    contributionMinor: 0,
    marginWarning: false,
  };
}

/** Free vs Pro for a month of GMV (brief §5): what each plan would cost the
 * partner (fees + fee VAT + subscription) — used by the comparison UI. */
export function monthlyPlanCost(
  monthlyGmvMinor: number,
  orders: number,
  plan: { successFeeBps: number; minFeeMinor: number; subscriptionMonthlyMinor: number },
  tax: { vatBps: number; vatMode: "standard" | "exempt" | "reverse_charge" }
): { feesMinor: number; feeVatMinor: number; subscriptionMinor: number; subscriptionVatMinor: number; totalMinor: number } {
  assertMinor(monthlyGmvMinor, "monthlyGmvMinor");
  if (!Number.isSafeInteger(orders) || orders < 0) throw new RangeError("orders must be a non-negative integer");
  // Assumes the month's GMV is spread evenly over `orders` (the minimum fee
  // applies per order); any remainder cents go one each to the first orders.
  const feeFor = (orderMinor: number) => (orderMinor === 0 ? 0 : Math.max(applyBps(orderMinor, plan.successFeeBps), plan.minFeeMinor));
  let feesMinor = 0;
  if (orders > 0) {
    const each = Math.floor(monthlyGmvMinor / orders);
    const rem = monthlyGmvMinor - each * orders;
    feesMinor = rem * feeFor(each + 1) + (orders - rem) * feeFor(each);
  }
  const vat = (n: number) => (tax.vatMode === "standard" ? applyBps(n, tax.vatBps) : 0);
  const feeVatMinor = vat(feesMinor);
  const subscriptionVatMinor = vat(plan.subscriptionMonthlyMinor);
  return { feesMinor, feeVatMinor, subscriptionMinor: plan.subscriptionMonthlyMinor, subscriptionVatMinor, totalMinor: feesMinor + feeVatMinor + plan.subscriptionMonthlyMinor + subscriptionVatMinor };
}
