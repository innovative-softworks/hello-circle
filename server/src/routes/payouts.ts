import { Router, type Request, type Response } from "express";
import { requirePlatformRole, requireVendor } from "../auth.js";
import { ConnectError, dashboardLink, payoutsOverview, refreshAccount, startOnboarding, type Party } from "../payments/connect.js";
import { requireResident } from "../residents.js";
import { db } from "../db/index.js";

// Revenue & Connect Stage 5a — a partner's own payout account (Stripe
// Express, hosted onboarding). Vendors: owner or finance staff of the
// organisation. Hosts: the resident themself.

function handle(res: Response, e: unknown) {
  if (e instanceof ConnectError) return res.status(e.status).json({ error: e.message });
  throw e;
}

/** Returns a refusal message when this caller may not start payout
 * onboarding, or null when they may. */
type OnboardingCheck = (req: Request) => Promise<string | null>;

function mount(router: Router, partyOf: (req: Request) => Party, emailOf: (req: Request) => string, returnPath: string, canOnboard?: OnboardingCheck) {
  router.get("/", async (req, res) => res.json(await payoutsOverview(partyOf(req))));
  router.post("/onboarding", async (req, res) => {
    const refusal = canOnboard ? await canOnboard(req) : null;
    if (refusal) return res.status(403).json({ error: refusal });
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
// Sitemap audit P2-17 — payout onboarding (a Stripe Express account) only for
// residents who can actually earn: a verified host, or anyone who has hosted
// a priced activity (Host verification is a badge, not a requirement to host,
// so an unverified host with paid joins must still be able to get paid).
// Viewing the overview stays open — it's the resident's own, usually empty, data.
export const HOST_PAYOUTS_NOT_ELIGIBLE = "Payouts are for hosts who charge for activities. Become a verified host, or host a paid activity, to set them up.";
async function hostCanOnboard(req: Request): Promise<string | null> {
  const row = (await db
    .prepare(
      `SELECT (SELECT host_status FROM residents WHERE id = ?) AS hostStatus,
              EXISTS(SELECT 1 FROM games WHERE host_resident_id = ? AND price_cents > 0) AS hasPaid`
    )
    .get(req.resident!.id, req.resident!.id)) as { hostStatus: string | null; hasPaid: number | string } | undefined;
  if (row?.hostStatus === "verified" || Number(row?.hasPaid) > 0) return null;
  return HOST_PAYOUTS_NOT_ELIGIBLE;
}
mount(hostPayoutsRouter, (req) => ({ partyType: "host", partyId: req.resident!.id }), (req) => req.resident!.email, "/manage?tab=earnings", hostCanOnboard);
