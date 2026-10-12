import { Router } from "express";
import { estimate, parseEstimateBody } from "../commerce/calcContext.js";
import { comparePlans } from "../commerce/planCompare.js";
import { proBreakEvenMinor } from "../commerce/plans.js";
import { RuleError, RuleResolutionError, resolveRule } from "../commerce/rules.js";
import { simpleRateLimit } from "../rateLimit.js";
import { partnerFeeModelApproved } from "../commerce/releaseGates.js";

// Revenue & Connect Stage 2b — public pricing endpoints behind the pricing
// page and partner calculators (Stage 3). Partner-agnostic (no partner ids
// accepted) and rate-limited. Internal margin warnings are admin-only (brief
// §19B), so they are stripped here.
export const pricingPublicRouter = Router();
const limiter = simpleRateLimit({ windowMs: 15 * 60 * 1000, max: 300 });

// Commercial claims safety audit (R3B F1) — these figures come from the
// proposed plan model, not from what checkout charges. Every response says so
// in-band (additive fields; existing fields and figures unchanged, so any
// existing consumer keeps working) and in a header.
export const FEE_MODEL_NOTICE =
  "Proposed partner pricing — not in force. HelloCircle doesn't charge these fees today; paid-booking pricing is being finalised.";
function modelStatus() {
  const approved = partnerFeeModelApproved();
  return { status: approved ? ("in_force" as const) : ("proposed" as const), inForce: approved, notice: approved ? null : FEE_MODEL_NOTICE };
}
pricingPublicRouter.use((_req, res, next) => {
  res.setHeader("X-HelloCircle-Fee-Model", partnerFeeModelApproved() ? "in_force" : "proposed");
  next();
});

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
      ...modelStatus(),
    });
  } catch (e) {
    fail(res, e);
  }
});

pricingPublicRouter.post("/estimate", limiter, async (req, res) => {
  try {
    const { result, planKey } = await estimate(parseEstimateBody(req.body ?? {}, { allowPartner: false }));
    const { marginWarning: _hidden, ...visible } = result;
    res.json({ planKey, ...visible, ...modelStatus() });
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
    res.json({ ...visible, ...modelStatus() });
  } catch (e) {
    fail(res, e);
  }
});
