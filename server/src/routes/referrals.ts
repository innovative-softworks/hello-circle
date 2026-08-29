import { Router } from "express";
import { db } from "../db/index.js";
import { lookupLimiter } from "../rateLimit.js";
import { clientIdFrom } from "../util.js";

export const referralsRouter = Router();

// Referral attribution (participation-intent plan Phase 3) — logs 'share'
// (InviteButton.tsx) and 'land' (App.tsx's landing-capture hook) events.
// Deliberately read-side only — no checkout code touched, no attempt to
// credit/attribute a transaction in real time. See admin.ts's
// GET /admin/referrals for the best-effort join that does that at read time.

interface ShareBody {
  source?: string;
  listingType?: string;
  listingId?: string;
}

referralsRouter.post("/share", lookupLimiter, async (req, res) => {
  let clientId: string;
  try {
    clientId = clientIdFrom(req);
  } catch (e) {
    return res.status(400).json({ error: (e as Error).message });
  }
  const b = req.body as ShareBody;

  await db
    .prepare(
      `INSERT INTO referrals (event, source, referrer_resident_id, referrer_client_id, listing_type, listing_id)
       VALUES ('share', @source, @residentId, @clientId, @listingType, @listingId)`
    )
    .run({
      source: b.source ?? "",
      residentId: req.resident?.id ?? null,
      clientId,
      listingType: b.listingType ?? "",
      listingId: b.listingId ?? "",
    });
  res.status(201).json({ ok: true });
});

interface LandBody {
  ref?: string;
  source?: string;
}

referralsRouter.post("/land", lookupLimiter, async (req, res) => {
  let visitorClientId: string;
  try {
    visitorClientId = clientIdFrom(req);
  } catch (e) {
    return res.status(400).json({ error: (e as Error).message });
  }
  const b = req.body as LandBody;
  if (!b.ref) return res.status(400).json({ error: "ref is required" });

  await db
    .prepare(
      `INSERT INTO referrals (event, source, referrer_client_id, visitor_client_id, visitor_resident_id) VALUES ('land', @source, @ref, @visitorClientId, @visitorResidentId)`
    )
    .run({ source: b.source ?? "", ref: b.ref, visitorClientId, visitorResidentId: req.resident?.id ?? null });
  res.status(201).json({ ok: true });
});
