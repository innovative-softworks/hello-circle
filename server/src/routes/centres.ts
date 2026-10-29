import { publicForm } from "../participation/formAnswers.js";
import { taxonomyFields } from "../taxonomy.js";
import { unavailableListing } from "../orgStatus.js";
import { Router } from "express";
import { logView } from "../analytics.js";
import { db } from "../db/index.js";
import { getApprovedCentre, listCentres, orgPoliciesForVendor } from "../db/queries.js";
import { resolveRadiusFilter } from "../geo.js";

export const centresRouter = Router();

// Discovery-radius filtering (master-prompt punch list #2) — strictly
// opt-in via ?radiusKm=; see resolveRadiusFilter's own comment for the
// lat/lng-vs-county-centroid fallback order.
centresRouter.get("/", async (req, res) => {
  const county = typeof req.query.county === "string" ? req.query.county : undefined;
  const radius = resolveRadiusFilter(req.query, req.resident?.homeCounty ?? null);
  res.json(await listCentres(county, radius));
});

centresRouter.get("/:id", async (req, res) => {
  const centre = await getApprovedCentre(req.params.id);
  if (!centre) {
    // D-01: a live listing of a suspended organisation shows an unavailable state.
    const unavailable = await unavailableListing("centre", req.params.id);
    if (unavailable) return res.json(unavailable);
    return res.status(404).json({ error: "Centre not found" });
  }
  logView("place_viewed", req, { kind: "centre", id: centre.id });

  // Venue-level Follow (Follow feature) — kept out of getApprovedCentre
  // itself (a shared query with non-resident-scoped callers); attached
  // here the same way providers.ts attaches its own follow state.
  const [followerCountRow, isFollowingRow] = await Promise.all([
    db.prepare(`SELECT COUNT(*) as n FROM follows WHERE followed_type = 'centre' AND followed_id = ?`).get(centre.id) as Promise<{ n: number }>,
    req.resident
      ? (db
          .prepare(`SELECT notification_level as notificationLevel FROM follows WHERE resident_id = ? AND followed_type = 'centre' AND followed_id = ?`)
          .get(req.resident.id, centre.id) as Promise<{ notificationLevel: "highlights" | "everything" } | undefined>)
      : Promise.resolve(undefined),
  ]);

  // DP-07 — the venue's real cancellation window (org policy), so the page
  // never promises a different one than booking cancellation enforces.
  const { cancellationHours } = await orgPoliciesForVendor(centre.vendorId ?? null);
  res.json({
    ...centre,
    cancellationHours,
    followerCount: Number(followerCountRow.n),
    isFollowing: !!isFollowingRow,
    followNotificationLevel: isFollowingRow?.notificationLevel ?? "highlights",
    ...(await taxonomyFields("centre", centre.id)),
    // Phase H — the hall's booking form (empty unless published and switched on).
    registrationForm: await publicForm("centre", centre.id, centre.vendorId),
  });
});
