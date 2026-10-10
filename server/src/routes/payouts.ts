import { Router, type Request, type Response } from "express";
import { requirePlatformRole, requireVendor } from "../auth.js";
import { ConnectError, dashboardLink, payoutsOverview, refreshAccount, startOnboarding, type Party } from "../payments/connect.js";
import { requireResident } from "../residents.js";

// Revenue & Connect Stage 5a — a partner's own payout account (Stripe
// Express, hosted onboarding). Vendors: owner or finance staff of the
// organisation. Hosts: the resident themself.

function handle(res: Response, e: unknown) {
  if (e instanceof ConnectError) return res.status(e.status).json({ error: e.message });
  throw e;
}

function mount(router: Router, partyOf: (req: Request) => Party, emailOf: (req: Request) => string, returnPath: string) {
  router.get("/", async (req, res) => res.json(await payoutsOverview(partyOf(req))));
  router.post("/onboarding", async (req, res) => {
    try {
      const country = typeof req.body?.country === "string" ? req.body.country : "IE";
      res.json(await startOnboarding(partyOf(req), { email: emailOf(req), country, returnPath, actorId: req.user?.id ?? req.resident!.id }));
    } catch (e) {
      handle(res, e);
    }
  });
  router.post("/refresh", async (req, res) => {
    try {
      await refreshAccount(partyOf(req), req.body?.source === "return" ? "return" : "api");
      res.json(await payoutsOverview(partyOf(req)));
    } catch (e) {
      handle(res, e);
    }
  });
  router.post("/dashboard", async (req, res) => {
    try {
      res.json(await dashboardLink(partyOf(req)));
    } catch (e) {
      handle(res, e);
    }
  });
}

export const vendorPayoutsRouter = Router();
vendorPayoutsRouter.use(requireVendor, requirePlatformRole("finance"));
mount(
  vendorPayoutsRouter,
  (req) => (req.user!.orgId ? { partyType: "org", partyId: req.user!.orgId } : { partyType: "vendor", partyId: req.user!.id }),
  (req) => req.user!.email,
  "/vendor?tab=earnings"
);

export const hostPayoutsRouter = Router();
hostPayoutsRouter.use(requireResident);
mount(hostPayoutsRouter, (req) => ({ partyType: "host", partyId: req.resident!.id }), (req) => req.resident!.email, "/manage?tab=earnings");
