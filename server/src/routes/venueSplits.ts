import { Router, type Response } from "express";
import { requirePlatformRole, requireVendor } from "../auth.js";
import { agreementsForGame, agreementsForVenue, decideSplit, proposeSplit, splitEnabled, type SplitMode } from "../commerce/allocations.js";
import { RuleError } from "../commerce/rules.js";
import { requireResident } from "../residents.js";

// Revenue & Connect Stage 5e — venue/host split agreements (flow C). The host
// proposes how the partner share of their paid game is divided; the venue's
// organisation (owner or finance staff) accepts or declines. The accepted
// version is frozen into each booking when it is paid.

function handle(res: Response, e: unknown) {
  if (e instanceof RuleError) return res.status(e.status).json({ error: e.message });
  throw e;
}

const int = (v: unknown) => (v === undefined || v === null || v === "" ? null : Number(v));

export const hostSplitsRouter = Router();
hostSplitsRouter.use(requireResident);
/** Whether venue/host splits are switched on (the host card is hidden when not). */
hostSplitsRouter.get("/-/status", async (_req, res) => res.json({ enabled: await splitEnabled() }));
hostSplitsRouter.get("/:gameId", async (req, res) => {
  const all = await agreementsForGame(req.params.gameId);
  res.json(all.filter((a) => a.hostResidentId === req.resident!.id));
});
hostSplitsRouter.post("/:gameId", async (req, res) => {
  try {
    const b = req.body as Record<string, unknown>;
    const a = await proposeSplit({
      gameId: req.params.gameId,
      hostResidentId: req.resident!.id,
      terms: { mode: String(b.mode) as SplitMode, venueBps: int(b.venueBps), venueFixedMinor: int(b.venueFixedMinor), hostFixedMinor: int(b.hostFixedMinor) },
    });
    res.status(201).json(a);
  } catch (e) {
    handle(res, e);
  }
});

export const vendorSplitsRouter = Router();
vendorSplitsRouter.use(requireVendor, requirePlatformRole("finance"));
const venueOf = (req: { user?: { id: string; orgId?: string | null } }) => (req.user!.orgId ? { partyType: "org", partyId: req.user!.orgId } : { partyType: "vendor", partyId: req.user!.id });
vendorSplitsRouter.get("/", async (req, res) => res.json(await agreementsForVenue(venueOf(req))));
vendorSplitsRouter.post("/:id/decision", async (req, res) => {
  try {
    const b = req.body as { accept?: unknown; reason?: unknown };
    if (typeof b.accept !== "boolean") return res.status(400).json({ error: "accept must be true or false" });
    res.json(await decideSplit({ agreementId: Number(req.params.id), venue: venueOf(req), accept: b.accept, actorId: req.user!.id, reason: typeof b.reason === "string" ? b.reason : undefined }));
  } catch (e) {
    handle(res, e);
  }
});
