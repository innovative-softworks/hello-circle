// Free vs Pro for a month of GMV (brief §5), shared by the admin simulator,
// the public pricing page and (Stage 3) the partner plan screen. Neutral by
// design: it reports the cheaper plan and the break-even point — no urgency.

import { monthlyPlanCost } from "./calc.js";
import { proBreakEvenMinor } from "./plans.js";
import { resolveRule } from "./rules.js";

export async function comparePlans(monthlyGmvMinor: number, orders: number, at: Date = new Date()) {
  const [free, pro, tax] = await Promise.all([resolveRule("plan_free", {}, at), resolveRule("plan_pro", {}, at), resolveRule("tax_vat", {}, at)]);
  const n = (r: { values: Record<string, number | string> }, k: string) => Number(r.values[k]);
  const taxTerms = { vatBps: n(tax, "vatBps"), vatMode: tax.values.vatMode as "standard" | "exempt" | "reverse_charge" };
  const plan = (r: typeof free) => ({ successFeeBps: n(r, "successFeeBps"), minFeeMinor: n(r, "minFeeMinor"), subscriptionMonthlyMinor: n(r, "subscriptionMonthlyMinor") });
  const freeCost = monthlyPlanCost(monthlyGmvMinor, orders, plan(free), taxTerms);
  const proCost = monthlyPlanCost(monthlyGmvMinor, orders, plan(pro), taxTerms);
  const breakEven = proBreakEvenMinor(n(free, "successFeeBps"), n(pro, "successFeeBps"), n(pro, "subscriptionMonthlyMinor"));
  // Compare before VAT: VAT-registered partners usually reclaim it.
  const freeNet = freeCost.feesMinor + freeCost.subscriptionMinor;
  const proNet = proCost.feesMinor + proCost.subscriptionMinor;
  return {
    monthlyGmvMinor,
    orders,
    free: freeCost,
    pro: proCost,
    proMonthlySavingMinor: freeNet - proNet,
    proBreakEvenMonthlyGmvMinor: breakEven,
    cheaperPlan: proNet < freeNet ? "pro" : "free",
    ruleHashes: { free: free.hash, pro: pro.hash, tax: tax.hash },
  };
}
