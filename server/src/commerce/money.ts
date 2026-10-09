// Commerce Engine — integer money maths (Phase 1).
//
// Every amount is an integer in minor units (cents); every rate is an integer
// in basis points (700 = 7.00%). No floating point touches money here.
// Rounding is half-up on non-negative values, which is provably identical to
// legacy pricing.ts's Math.round(taxable * 0.23) / (taxable * 0.05) for every
// amount from €0 to €50,000 (checked exhaustively during the Phase 0.5 audit,
// and pinned by the golden tests in money.test.ts) — so shadow comparisons
// against the legacy engine show real differences only.

export const BPS = 10_000;

/** The pricing-engine version written into every snapshot. Bump it whenever
 * the formula below changes, so historical snapshots stay explainable. */
export const PRICING_ENGINE_VERSION = "pe-1";

function assertMinor(n: number, name: string) {
  if (!Number.isSafeInteger(n) || n < 0) throw new RangeError(`${name} must be a non-negative integer (minor units), got ${n}`);
}

/** round(numerator / denominator), half-up, for non-negative integers. */
export function divRoundHalfUp(numerator: number, denominator: number): number {
  if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator) || numerator < 0 || denominator <= 0) {
    throw new RangeError(`divRoundHalfUp needs non-negative safe integers, got ${numerator}/${denominator}`);
  }
  return Math.floor((2 * numerator + denominator) / (2 * denominator));
}

/** amount × rate (bps), rounded half-up. */
export function applyBps(amountMinor: number, rateBps: number): number {
  assertMinor(amountMinor, "amount");
  if (!Number.isSafeInteger(rateBps) || rateBps < 0) throw new RangeError(`rate must be a non-negative integer (bps), got ${rateBps}`);
  return divRoundHalfUp(amountMinor * rateBps, BPS);
}

/** Splits `totalMinor` across `weights` so the parts always sum exactly to
 * the total (largest-remainder method; ties go to the earlier weight). Used
 * for coupon funding shares and payout splits in later phases. */
export function allocate(totalMinor: number, weights: number[]): number[] {
  assertMinor(totalMinor, "total");
  if (!weights.length || weights.some((w) => !Number.isSafeInteger(w) || w < 0)) throw new RangeError("weights must be non-negative integers");
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum === 0) throw new RangeError("weights must not all be zero");
  const base = weights.map((w) => Math.floor((totalMinor * w) / sum));
  let left = totalMinor - base.reduce((a, b) => a + b, 0);
  const order = weights
    .map((w, i) => ({ i, rem: (totalMinor * w) % sum }))
    .sort((a, b) => b.rem - a.rem || a.i - b.i);
  for (const { i } of order) {
    if (left <= 0) break;
    base[i]++;
    left--;
  }
  return base;
}

/** The commercial values a price calculation needs — resolved from the
 * `pricing` rule (see catalog.ts), never hardcoded at a call site. */
export interface PricingValues {
  customerFeeBps: number;
  successFeeBps: number;
  successFeeBase: "partner_net" | "customer_goods";
  vatBps: number;
  vatMode: "added_on_top" | "included_in_price";
  paymentCostBearer: "platform" | "partner";
  paymentCostBps: number;
  paymentCostFixedMinor: number;
}

export interface PriceInput {
  /** List price of the goods (quantity already applied), minor units. */
  listMinor: number;
  /** Coupon discount already validated and capped by the caller. */
  discountMinor: number;
  /** Refundable deposit — not a supply, so no VAT/fees on it. */
  depositMinor: number;
}

export interface PriceBreakdown {
  listMinor: number;
  discountMinor: number;
  /** list − discount: the taxable/discounted goods amount as entered. */
  discountedMinor: number;
  /** Goods amount the customer pays, VAT included. */
  goodsGrossMinor: number;
  vatMinor: number;
  customerFeeMinor: number;
  depositMinor: number;
  customerPaidMinor: number;
  /** Goods amount net of VAT — the partner's gross earning. */
  partnerGrossMinor: number;
  successFeeMinor: number;
  /** Estimated processor cost (assumption from the rule, not a Stripe fact). */
  paymentCostMinor: number;
  partnerPaymentCostMinor: number;
  partnerPayoutMinor: number;
  platformRevenueMinor: number;
  platformContributionMinor: number;
  engineVersion: string;
}

/**
 * One customer price, every allocation derived from it. Invariant (tested):
 *   customerPaid = partnerPayout + successFee + partnerPaymentCost
 *                + customerFee + vat + deposit
 * With today's rule v1 (customer fee 5%, VAT 23% added on top, success fee
 * 0) customerPaid equals legacy computePricing().totalCents exactly.
 */
export function priceBreakdown(input: PriceInput, v: PricingValues): PriceBreakdown {
  assertMinor(input.listMinor, "listMinor");
  assertMinor(input.discountMinor, "discountMinor");
  assertMinor(input.depositMinor, "depositMinor");
  const discountedMinor = Math.max(0, input.listMinor - input.discountMinor);
  const discountMinor = input.listMinor - discountedMinor; // never more than the list price

  let vatMinor: number;
  let goodsGrossMinor: number;
  if (v.vatMode === "added_on_top") {
    vatMinor = applyBps(discountedMinor, v.vatBps);
    goodsGrossMinor = discountedMinor + vatMinor;
  } else {
    goodsGrossMinor = discountedMinor;
    vatMinor = divRoundHalfUp(discountedMinor * v.vatBps, BPS + v.vatBps);
  }
  const partnerGrossMinor = goodsGrossMinor - vatMinor;
  const customerFeeMinor = applyBps(discountedMinor, v.customerFeeBps);
  const customerPaidMinor = goodsGrossMinor + customerFeeMinor + input.depositMinor;

  const successFeeMinor = applyBps(v.successFeeBase === "partner_net" ? partnerGrossMinor : goodsGrossMinor, v.successFeeBps);
  const chargeable = customerPaidMinor > 0;
  const paymentCostMinor = chargeable ? applyBps(customerPaidMinor, v.paymentCostBps) + v.paymentCostFixedMinor : 0;
  const partnerPaymentCostMinor = v.paymentCostBearer === "partner" ? paymentCostMinor : 0;
  const partnerPayoutMinor = partnerGrossMinor - successFeeMinor - partnerPaymentCostMinor;
  const platformRevenueMinor = customerFeeMinor + successFeeMinor;
  const platformContributionMinor = platformRevenueMinor - (v.paymentCostBearer === "platform" ? paymentCostMinor : 0);

  return {
    listMinor: input.listMinor,
    discountMinor,
    discountedMinor,
    goodsGrossMinor,
    vatMinor,
    customerFeeMinor,
    depositMinor: input.depositMinor,
    customerPaidMinor,
    partnerGrossMinor,
    successFeeMinor,
    paymentCostMinor,
    partnerPaymentCostMinor,
    partnerPayoutMinor,
    platformRevenueMinor,
    platformContributionMinor,
    engineVersion: PRICING_ENGINE_VERSION,
  };
}
