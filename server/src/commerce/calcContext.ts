// Revenue & Connect Stage 2b — builds a pe-2 calculation from the published,
// versioned rules for one partner at one instant, and returns the exact rule
// versions used (for the order snapshot). The calculation itself is pure
// (calc.ts); this module is the only place it meets the database.

import { calculate, type CalcCredit, type CalcDiscount, type CalcResult, type SplitRule } from "./calc.js";
import { planTermsFor, type PartnerKey, type PlanKey } from "./plans.js";
import { resolveRule, RuleError, type ResolvedRule } from "./rules.js";

export interface EstimateRequest {
  /** Omit for a partner-agnostic estimate (public calculator); then `planKey` decides. */
  partner?: PartnerKey | null;
  planKey?: PlanKey;
  lines: { unitMinor: number; quantity: number }[];
  discounts?: CalcDiscount[];
  credits?: CalcCredit[];
  refundedServiceMinor?: number;
  customerTaxMinor?: number;
  split?: SplitRule;
  at?: Date;
}

export interface RuleUse {
  key: string;
  hash: string;
  sources: ResolvedRule["sources"];
}

export interface Estimate {
  result: CalcResult;
  planKey: PlanKey;
  feePlanKey: PlanKey;
  rules: RuleUse[];
  resolvedAt: string;
}

const use = (r: ResolvedRule): RuleUse => ({ key: r.key, hash: r.hash, sources: r.sources });

export async function estimate(req: EstimateRequest): Promise<Estimate> {
  const at = req.at ?? new Date();
  const partner = req.partner ?? null;
  const ctx = { orgId: partner?.kind === "org" ? partner.id : null, hostResidentId: partner?.kind === "host" ? partner.id : null };

  let planKey: PlanKey;
  let feePlanKey: PlanKey;
  let fees: ResolvedRule;
  if (partner) {
    const terms = await planTermsFor(partner, at);
    planKey = terms.assignment.planKey;
    feePlanKey = terms.assignment.feePlanKey;
    fees = terms.fees;
  } else {
    planKey = feePlanKey = req.planKey ?? "free";
    if (planKey === "enterprise") throw new RuleError("The Enterprise plan isn't available yet", 409);
    fees = await resolveRule(`plan_${planKey}`, {}, at);
  }
  const [tax, costs, settlement, rewards, pro] = await Promise.all([
    resolveRule("tax_vat", ctx, at),
    resolveRule("payment_costs", {}, at),
    resolveRule("settlement", ctx, at),
    resolveRule("rewards", {}, at),
    resolveRule("plan_pro", {}, at),
  ]);
  const n = (r: ResolvedRule, k: string) => Number(r.values[k]);
  const result = calculate({
    lines: req.lines,
    discounts: req.discounts,
    credits: req.credits,
    refundedServiceMinor: req.refundedServiceMinor,
    customerTaxMinor: req.customerTaxMinor,
    plan: { successFeeBps: n(fees, "successFeeBps"), minFeeMinor: n(fees, "minFeeMinor") },
    tax: { vatBps: n(tax, "vatBps"), vatMode: tax.values.vatMode as "standard" | "exempt" | "reverse_charge" },
    costs: { cardBps: n(costs, "cardBps"), cardFixedMinor: n(costs, "cardFixedMinor"), payoutBps: n(costs, "payoutBps"), payoutFixedMinor: n(costs, "payoutFixedMinor") },
    split: req.split ?? { mode: "single", recipient: partner?.kind === "host" ? "host" : "vendor" },
    reserves: { refundReserveBps: n(settlement, "refundReserveBps"), disputeReserveBps: n(settlement, "disputeReserveBps") },
    rewards: { pointsPerEuro: n(rewards, "pointsPerEuro"), redemptionPoints: n(rewards, "redemptionPoints"), rewardValueMinor: n(pro, "subscriptionMonthlyMinor") },
    marginWarningMinor: n(settlement, "marginWarningMinor"),
  });
  return { result, planKey, feePlanKey, rules: [fees, tax, costs, settlement, rewards, pro].map(use), resolvedAt: at.toISOString() };
}

/** Parses an untrusted estimate body (admin simulator / public calculator). */
export function parseEstimateBody(b: Record<string, unknown>, opts: { allowPartner: boolean }): EstimateRequest {
  const int = (v: unknown, label: string, min = 0, max = 100_000_000) => {
    if (typeof v !== "number" || !Number.isInteger(v) || v < min || v > max) throw new RuleError(`${label} must be a whole number from ${min} to ${max}`);
    return v;
  };
  const priceMinor = int(b.priceMinor, "Price (cents)");
  const quantity = b.quantity === undefined ? 1 : int(b.quantity, "Quantity", 1, 10_000);
  const discounts: CalcDiscount[] = [];
  if (Array.isArray(b.discounts)) {
    for (const d of b.discounts.slice(0, 10) as Record<string, unknown>[]) {
      const funder = String(d.funder);
      if (!["vendor", "host", "venue", "helloCircle", "shared"].includes(funder)) throw new RuleError("Unknown discount funder");
      discounts.push({ funder: funder as CalcDiscount["funder"], amountMinor: int(d.amountMinor, "Discount"), platformShareBps: d.platformShareBps === undefined ? undefined : int(d.platformShareBps, "HelloCircle share", 0, 10_000) });
    }
  }
  const credits: CalcCredit[] = [];
  if (Array.isArray(b.credits)) {
    for (const c of b.credits.slice(0, 10) as Record<string, unknown>[]) {
      if (c.funder !== "helloCircle" && c.funder !== "vendor") throw new RuleError("Unknown credit funder");
      credits.push({ funder: c.funder, amountMinor: int(c.amountMinor, "Credit") });
    }
  }
  let split: SplitRule | undefined;
  const s = b.split as Record<string, unknown> | undefined;
  if (s) {
    if (s.mode === "single") split = { mode: "single", recipient: (["vendor", "host", "venue"].includes(String(s.recipient)) ? s.recipient : "vendor") as "vendor" };
    else if (s.mode === "fixed_venue") split = { mode: "fixed_venue", venueMinor: int(s.venueMinor, "Venue amount") };
    else if (s.mode === "fixed_host") split = { mode: "fixed_host", hostMinor: int(s.hostMinor, "Host amount") };
    else if (s.mode === "percentage") split = { mode: "percentage", venueBps: int(s.venueBps, "Venue share", 0, 10_000) };
    else throw new RuleError("Split must be single, fixed_venue, fixed_host or percentage");
  }
  const planKey = b.planKey === undefined ? undefined : (["free", "pro"].includes(String(b.planKey)) ? (b.planKey as PlanKey) : (() => { throw new RuleError("Plan must be free or pro"); })());
  let partner: PartnerKey | null = null;
  if (opts.allowPartner && b.partnerKind && b.partnerId) {
    if (!["org", "vendor", "host"].includes(String(b.partnerKind))) throw new RuleError("Partner kind must be org, vendor or host");
    partner = { kind: b.partnerKind as PartnerKey["kind"], id: String(b.partnerId) };
  }
  return {
    partner,
    planKey,
    lines: [{ unitMinor: priceMinor, quantity }],
    discounts,
    credits,
    refundedServiceMinor: b.refundedServiceMinor === undefined ? undefined : int(b.refundedServiceMinor, "Refunded amount"),
    customerTaxMinor: b.customerTaxMinor === undefined ? undefined : int(b.customerTaxMinor, "Customer tax"),
    split,
  };
}
