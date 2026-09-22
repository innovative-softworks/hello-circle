import { Router } from "express";
import { db } from "../db/index.js";
import { getProviderAmenities, getProviderParticipantCount, getProviderReviewsSummary, getProviderUpcoming, getProviderWentAheadPercent, orgPoliciesForVendor } from "../db/queries.js";

export const providersRouter = Router();

// Provider public profile (IA spec §5) — a dedicated page distinct from
// any one listing's own detail page, showing the vendor account behind
// possibly several listings: verified status, description, every approved
// listing they own, policies, and a contact/support pathway. Deliberately
// never exposes email/mobile/landline/password_hash — this is a public
// route, no auth required.
//
// v2 (Provider Profile redesign) adds `upcoming` (real bookable sessions —
// see getProviderUpcoming's own comment for why centres are excluded),
// `trust` (only stats with real data behind them — no repeat-participation
// or went-ahead-as-planned, per the audit that found no honest way to
// compute either yet), and `reviewsSummary` (a cross-listing rollup that
// didn't exist before — reviews are stored per-listing, never per-vendor).
providersRouter.get("/:id", async (req, res) => {
  const vendorId = req.params.id;
  const vendor = (await db
    .prepare(`SELECT id, name, business_name as businessName, description, provider_tier as providerTier, county, status, logo, website, socials FROM users WHERE id = ? AND role = 'vendor'`)
    .get(vendorId)) as
    | { id: string; name: string; businessName: string; description: string; providerTier: string; county: string; status: string; logo: string | null; website: string | null; socials: string | null }
    | undefined;
  if (!vendor || vendor.status !== "approved") return res.status(404).json({ error: "Provider not found" });

  const centres = (await db
    .prepare(`SELECT id, name, area, county, image_url as image, blurb, slug, lat, lng FROM centres WHERE vendor_id = ? AND status = 'approved' ORDER BY name`)
    .all(vendorId)) as { id: string; name: string; area: string; county: string; image: string; blurb: string; slug: string | null; lat: number | string | null; lng: number | string | null }[];
  const clubs = (await db
    .prepare(`SELECT id, name, sport, area, county, image_url as image, blurb, slug, lat, lng FROM clubs WHERE vendor_id = ? AND status = 'approved' ORDER BY name`)
    .all(vendorId)) as { id: string; name: string; sport: string; area: string; county: string; image: string; blurb: string; slug: string | null; lat: number | string | null; lng: number | string | null }[];
  const experiences = (await db
    .prepare(`SELECT id, kind, title, area, county, image_url as image, blurb, slug FROM experiences WHERE vendor_id = ? AND status = 'approved' ORDER BY title`)
    .all(vendorId)) as { id: string; kind: string; title: string; area: string; county: string; image: string; blurb: string; slug: string | null }[];

  const [policies, upcoming, participantCount, wentAheadPercent, amenities, reviewsSummary, followerCountRow, isFollowingRow] = await Promise.all([
    orgPoliciesForVendor(vendorId),
    getProviderUpcoming(vendorId),
    getProviderParticipantCount(vendorId),
    getProviderWentAheadPercent(vendorId),
    getProviderAmenities(
      centres.map((c) => c.id),
      clubs.map((c) => c.id)
    ),
    getProviderReviewsSummary(
      vendorId,
      centres.map((c) => c.id),
      clubs.map((c) => c.id),
      experiences.map((e) => e.id)
    ),
    db.prepare(`SELECT COUNT(*) as n FROM follows WHERE followed_type = 'vendor' AND followed_id = ?`).get(vendorId) as Promise<{ n: number }>,
    // Every route already runs attachResident globally (see CLAUDE.md), so
    // req.resident is populated here whenever the visitor happens to be
    // signed in — no auth is required to view this page itself.
    req.resident
      ? (db
          .prepare(`SELECT id, notification_level as notificationLevel FROM follows WHERE resident_id = ? AND followed_type = 'vendor' AND followed_id = ?`)
          .get(req.resident.id, vendorId) as Promise<{ id: number; notificationLevel: "highlights" | "everything" } | undefined>)
      : Promise.resolve(undefined),
  ]);

  const totalListings = centres.length + clubs.length + experiences.length;

  // First listing with real coordinates — used for the map section (v3
  // redesign). Deliberately not averaged/centred across listings; a vendor
  // with venues in different towns showing one arbitrary pin location
  // (rather than a misleading centroid between them) is the more honest
  // choice, and matches the common case of a vendor with one main venue.
  const withCoords = [...centres, ...clubs].find((l) => l.lat !== null && l.lng !== null);
  const mapLocation = withCoords ? { lat: Number(withCoords.lat), lng: Number(withCoords.lng), label: withCoords.name } : null;

  // Resolves each recent review's listing name from the arrays already
  // fetched above — see getProviderReviewsSummary's own comment for why
  // this avoids a 4th DB round-trip.
  const listingNameById = new Map<string, string>([
    ...centres.map((c) => [c.id, c.name] as const),
    ...clubs.map((c) => [c.id, c.name] as const),
    ...experiences.map((e) => [e.id, e.title] as const),
  ]);
  const reviewsWithNames = {
    ...reviewsSummary,
    recent: reviewsSummary.recent.map((r) => ({ ...r, listingName: listingNameById.get(r.listingId) ?? null })),
  };

  // A handful of other approved providers in the same county — "similar
  // providers," per the redesign brief's §43. Excludes the vendor itself;
  // no ranking sophistication (category/activity-type matching) attempted
  // yet, just real, same-county providers rather than a fabricated
  // "relevance" score.
  const similarCandidates = (await db
    .prepare(`SELECT id, business_name as businessName, name FROM users WHERE role = 'vendor' AND status = 'approved' AND id != ? AND county = ? LIMIT 6`)
    .all(vendorId, vendor.county)) as { id: string; businessName: string; name: string }[];
  const similar = (
    await Promise.all(
      similarCandidates.map(async (c) => {
        const [cCentres, cClubs, cExperiences] = await Promise.all([
          db.prepare(`SELECT COUNT(*) as n, MIN(image_url) as image, MIN(area) as area FROM centres WHERE vendor_id = ? AND status = 'approved'`).get(c.id) as Promise<{ n: number; image: string | null; area: string | null }>,
          db.prepare(`SELECT COUNT(*) as n, MIN(image_url) as image, MIN(area) as area FROM clubs WHERE vendor_id = ? AND status = 'approved'`).get(c.id) as Promise<{ n: number; image: string | null; area: string | null }>,
          db.prepare(`SELECT COUNT(*) as n, MIN(image_url) as image, MIN(area) as area FROM experiences WHERE vendor_id = ? AND status = 'approved'`).get(c.id) as Promise<{ n: number; image: string | null; area: string | null }>,
        ]);
        const n = Number(cCentres.n) + Number(cClubs.n) + Number(cExperiences.n);
        if (n === 0) return null;
        const type: "place" | "experience" | "open-plan" = Number(cExperiences.n) > 0 && Number(cCentres.n) === 0 && Number(cClubs.n) === 0 ? "experience" : Number(cClubs.n) > 0 && Number(cCentres.n) === 0 ? "open-plan" : "place";
        return {
          id: c.id,
          name: c.businessName || c.name,
          area: cCentres.area || cClubs.area || cExperiences.area || null,
          image: cCentres.image || cClubs.image || cExperiences.image || null,
          listingCount: n,
          type,
        };
      })
    )
  ).filter((v): v is NonNullable<typeof v> => v !== null).slice(0, 4);

  res.json({
    id: vendor.id,
    name: vendor.businessName || vendor.name,
    description: vendor.description,
    verified: vendor.providerTier !== "standard",
    providerTier: vendor.providerTier,
    county: vendor.county,
    logo: vendor.logo || null,
    website: vendor.website || null,
    socials: vendor.socials ? JSON.parse(vendor.socials) : null,
    centres,
    clubs,
    experiences,
    policies,
    upcoming,
    trust: { totalListings, participantCount, wentAheadPercent },
    amenities,
    mapLocation,
    reviewsSummary: reviewsWithNames,
    similar,
    followerCount: Number(followerCountRow.n),
    isFollowing: !!isFollowingRow,
    followNotificationLevel: isFollowingRow?.notificationLevel ?? "highlights",
  });
});
