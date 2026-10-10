import { Router, type Request, type Response } from "express";
import { requirePlatformRole, requireVendor } from "../auth.js";
import { RewardError, redeemForProMonth, rewardHistory, rewardSummary } from "../commerce/rewards.js";
import { SubscriptionError, billingPortalLink, cancelPro, resumePro, startProCheckout, subscriptionOverview } from "../commerce/subscriptions.js";
import { creditsEnabled, residentCredits } from "../commerce/credits.js";
import type { PartnerKey } from "../commerce/plans.js";
import { requireResident } from "../residents.js";

// Revenue & Connect Stage 5b — a partner's plan: Pro on Stripe Billing and
// reward points. Vendors: owner or finance staff. Hosts: the resident.
// Plus the resident's own customer-credit balance.

function handle(res: Response, e: unknown) {
  if (e instanceof SubscriptionError || e instanceof RewardError) return res.status(e.status).json({ error: e.message });
  throw e;
}

export type RedemptionState = "available" | "not_enough" | "debt" | "paid_active" | "cancelling_active" | "disabled";

function mount(router: Router, partnerOf: (req: Request) => PartnerKey, emailOf: (req: Request) => string, returnPath: string, canManage: (req: Request) => boolean) {
  // Stage 5f — plan changes are the owner's (decision D2); the server enforces it.
  const owner = (req: Request, res: Response, next: () => void) => {
    if (canManage(req)) return next();
    res.status(403).json({ error: "Only the organisation owner can change the plan" });
  };
  const actor = (req: Request) => req.user?.id ?? req.resident!.id;

  router.get("/", async (req, res) => {
    const partner = partnerOf(req);
    const [subscription, rewards] = await Promise.all([subscriptionOverview(partner), rewardSummary(partner)]);
    const rs = subscription.state;
    const redemption: RedemptionState = !subscription.rewardsEnabled
      ? "disabled"
      : rewards.debtPoints > 0
        ? "debt"
        : rs === "paid_active" || rs === "payment_failed" || rs === "processing"
          ? "paid_active"
          : rs === "cancelling"
            ? "cancelling_active"
            : rewards.points < rewards.redemptionPoints
              ? "not_enough"
              : "available";
    res.json({ ...subscription, canManage: canManage(req), rewards: { enabled: subscription.rewardsEnabled, ...rewards, redemption } });
  });
  router.get("/checkout-status", async (req, res) => {
    const o = await subscriptionOverview(partnerOf(req));
    res.json({ state: o.state, pendingCheckout: o.pendingCheckout });
  });
  router.get("/rewards/history", async (req, res) => {
    res.json(await rewardHistory(partnerOf(req), { limit: Number(req.query.limit) || 50, before: typeof req.query.before === "string" ? req.query.before : null, beforeId: typeof req.query.beforeId === "string" ? req.query.beforeId : null }));
  });
  router.post("/pro/checkout", owner, async (req, res) => {
    try {
      res.json(await startProCheckout(partnerOf(req), { email: emailOf(req), actorId: actor(req), returnPath, termsAccepted: req.body?.termsAccepted === true }));
    } catch (e) {
      handle(res, e);
    }
  });
  router.post("/pro/cancel", owner, async (req, res) => {
    try {
      await cancelPro(partnerOf(req), actor(req));
      res.json({ ok: true });
    } catch (e) {
      handle(res, e);
    }
  });
  router.post("/pro/resume", owner, async (req, res) => {
    try {
      await resumePro(partnerOf(req), actor(req));
      res.json({ ok: true });
    } catch (e) {
      handle(res, e);
    }
  });
  router.post("/billing-portal", owner, async (req, res) => {
    try {
      res.json(await billingPortalLink(partnerOf(req), returnPath, actor(req)));
    } catch (e) {
      handle(res, e);
    }
  });
  router.post("/rewards/redeem", owner, async (req, res) => {
    try {
      res.json(await redeemForProMonth(partnerOf(req), actor(req)));
    } catch (e) {
      handle(res, e);
    }
  });
}

export const vendorPlanRouter = Router();
vendorPlanRouter.use(requireVendor, requirePlatformRole("finance"));
mount(
  vendorPlanRouter,
  (req) => (req.user!.orgId ? { kind: "org", id: req.user!.orgId } : { kind: "vendor", id: req.user!.id }),
  (req) => req.user!.email,
  "/vendor?tab=earnings",
  (req) => req.user!.role === "vendor" && !req.user!.invitedStaff
);

export const hostPlanRouter = Router();
hostPlanRouter.use(requireResident);
mount(hostPlanRouter, (req) => ({ kind: "host", id: req.resident!.id }), (req) => req.resident!.email, "/manage?tab=earnings", () => true);

export const residentCreditsRouter = Router();
residentCreditsRouter.get("/me", requireResident, async (req, res) => {
  if (!(await creditsEnabled())) return res.json({ enabled: false, balanceMinor: 0, lots: [] });
  res.json(await residentCredits(req.resident!.id));
});
