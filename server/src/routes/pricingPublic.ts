import { Router } from "express";
import { estimate, parseEstimateBody } from "../commerce/calcContext.js";
import { comparePlans } from "../commerce/planCompare.js";
import { proBreakEvenMinor } from "../commerce/plans.js";
import { RuleError, RuleResolutionError, resolveRule } from "../commerce/rules.js";
import { simpleRateLimit } from "../rateLimit.js";

// Revenue & Connect Stage 2b — public pricing endpoints behind the pricing
// page and partner calculators (Stage 3). Partner-agnostic (no partner ids
// accepted) and rate-limited. Internal margin warnings are admin-only (brief
// §19B), so they are stripped here.
export const pricingPublicRouter = Router();
const limiter = simpleRateLimit({ windowMs: 15 * 60 * 1000, max: 300 });

function fail(res: import("express").Response, e: unknown) {
  if (e instanceof RuleError) return res.status(e.status).json({ error: e.message });
  if (e instanceof RuleResolutionError) return res.status(503).json({ error: "Pricing isn't available right now" });
  throw e;
}

pricingPublicRouter.get("/plans", async (_req, res) => {
  try {
    const [free, pro, tax] = await Promise.all([resolveRule("plan_free"), resolveRule("plan_pro"), resolveRule("tax_vat")]);
    const pick = (r: typeof free) => ({ successFeeBps: Number(r.values.successFeeBps), minFeeMinor: Number(r.values.minFeeMinor), subscriptionMonthlyMinor: Number(r.values.subscriptionMonthlyMinor) });
    res.json({
      currency: "EUR",
      vatBps: Number(tax.values.vatBps),
      feesExclusiveOfVat: tax.values.feeDisplay === "exclusive_of_vat",
      free: pick(free),
      pro: pick(pro),
      proBreakEvenMonthlyGmvMinor: proBreakEvenMinor(Number(free.values.successFeeBps), Number(pro.values.successFeeBps), Number(pro.values.subscriptionMonthlyMinor)),
    });
  } catch (e) {
    fail(res, e);
  }
});

pricingPublicRouter.post("/estimate", limiter, async (req, res) => {
  try {
    const { result, planKey } = await estimate(parseEstimateBody(req.body ?? {}, { allowPartner: false }));
    const { marginWarning: _hidden, ...visible } = result;
    res.json({ planKey, ...visible });
  } catch (e) {
    fail(res, e);
  }
});

pricingPublicRouter.post("/compare", limiter, async (req, res) => {
  try {
    const gmv = Number(req.body?.monthlyGmvMinor);
    const orders = Number(req.body?.orders);
    if (!Number.isInteger(gmv) || gmv < 0 || gmv > 1_000_000_000 || !Number.isInteger(orders) || orders < 0 || orders > 100_000) {
      return res.status(400).json({ error: "monthlyGmvMinor and orders must be whole numbers" });
    }
    const { ruleHashes: _h, ...visible } = await comparePlans(gmv, orders);
    res.json(visible);
  } catch (e) {
    fail(res, e);
  }
});
