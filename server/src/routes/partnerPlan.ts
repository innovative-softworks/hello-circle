import { Router, type Request, type Response } from "express";
import { requirePlatformRole, requireVendor } from "../auth.js";
import { RewardError, redeemForProMonth, rewardBalance } from "../commerce/rewards.js";
import { SubscriptionError, cancelPro, resumePro, startProCheckout, subscriptionOverview } from "../commerce/subscriptions.js";
import { commerceSwitch } from "../commerce/switches.js";
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

function mount(router: Router, partnerOf: (req: Request) => PartnerKey, emailOf: (req: Request) => string, returnPath: string) {
  router.get("/", async (req, res) => {
    const partner = partnerOf(req);
    const [subscription, rewards, rewardsOn] = await Promise.all([subscriptionOverview(partner), rewardBalance(partner), commerceSwitch("commerce.circle_credits")]);
    res.json({ ...subscription, rewards: { enabled: rewardsOn, ...rewards } });
  });
  router.post("/pro/checkout", async (req, res) => {
    try {
      res.json(await startProCheckout(partnerOf(req), { email: emailOf(req), actorId: req.user?.id ?? req.resident!.id, returnPath }));
    } catch (e) {
      handle(res, e);
    }
  });
  router.post("/pro/cancel", async (req, res) => {
    try {
      await cancelPro(partnerOf(req), req.user?.id ?? req.resident!.id);
      res.json({ ok: true });
    } catch (e) {
      handle(res, e);
    }
  });
  router.post("/pro/resume", async (req, res) => {
    try {
      await resumePro(partnerOf(req), req.user?.id ?? req.resident!.id);
      res.json({ ok: true });
    } catch (e) {
      handle(res, e);
    }
  });
  router.post("/rewards/redeem", async (req, res) => {
    try {
      res.json(await redeemForProMonth(partnerOf(req), req.user?.id ?? req.resident!.id));
    } catch (e) {
      handle(res, e);
    }
  });
}

export const vendorPlanRouter = Router();
vendorPlanRouter.use(requireVendor, requirePlatformRole("finance"));
mount(vendorPlanRouter, (req) => (req.user!.orgId ? { kind: "org", id: req.user!.orgId } : { kind: "vendor", id: req.user!.id }), (req) => req.user!.email, "/vendor?tab=earnings");

export const hostPlanRouter = Router();
hostPlanRouter.use(requireResident);
mount(hostPlanRouter, (req) => ({ kind: "host", id: req.resident!.id }), (req) => req.resident!.email, "/manage?tab=earnings");

export const residentCreditsRouter = Router();
residentCreditsRouter.get("/me", requireResident, async (req, res) => {
  if (!(await creditsEnabled())) return res.json({ enabled: false, balanceMinor: 0, lots: [] });
  res.json(await residentCredits(req.resident!.id));
});
