import { db } from "./index.js";
import { haversineKm, type RadiusFilter } from "../geo.js";
import { irelandWallTimeToUtc } from "../irelandTime.js";
import { DISCOVERABLE_LIFECYCLES_SQL } from "../lifecycle.js";
import type { Centre, Club, Room } from "../types.js";

interface CentreRow {
  id: string;
  name: string;
  area: string;
  county: string;
  capacity: number;
  from_price: number;
  managed_by: string;
  ph: string;
  image_url: string;
  blurb: string;
  status: string;
  vendor_id: string | null;
  opens_at: string;
  closes_at: string;
  payment_method: "online" | "cash";
  is_open: number;
  map_url: string;
  lat: number | null;
  lng: number | null;
  location_source: string;
  phone: string;
  accessibility: string;
  featured: number;
  slug: string | null;
}

interface ClubRow {
  id: string;
  name: string;
  sport: string;
  area: string;
  county: string;
  ages: string;
  price: number;
  unit: string;
  trial: number;
  ph: string;
  image_url: string;
  blurb: string;
  status: string;
  vendor_id: string | null;
  payment_method: "online" | "cash";
  map_url: string;
  capacity: number | null;
  lat: number | null;
  lng: number | null;
  location_source: string;
  phone: string;
  accessibility: string;
  category: string;
  featured: number;
  slug: string | null;
  audience: "kids" | "adults" | "all";
}

const amenitiesStmt = db.prepare(
  `SELECT amenity FROM centre_amenities WHERE centre_id = ? ORDER BY sort_order`
);
// Public reads only ever return active rooms — a deactivated room shouldn't
// appear as a choice in the guest-facing room picker or on the listing page.
const roomsStmt = db.prepare(
  `SELECT id, centre_id as centreId, name, cap, rate, \`desc\`, payment_method as paymentMethod, active
   FROM rooms WHERE centre_id = ? AND active = 1 ORDER BY sort_order`
);
const includesStmt = db.prepare(
  `SELECT item FROM club_includes WHERE club_id = ? ORDER BY sort_order`
);
const centreImagesStmt = db.prepare(
  `SELECT url FROM centre_images WHERE centre_id = ? ORDER BY sort_order`
);
const clubImagesStmt = db.prepare(
  `SELECT url FROM club_images WHERE club_id = ? ORDER BY sort_order`
);
const reviewStatsStmt = db.prepare(
  `SELECT COALESCE(AVG(rating), 0) as avg, COUNT(*) as count FROM reviews WHERE listing_type = ? AND listing_id = ? AND hidden = 0`
);

/** Live rating computed from real submitted reviews — replaces the old
 * seeded static number. Exported (Host & Activity reviews, master-prompt
 * punch list #3) so residents.ts's host-profile route can reuse the exact
 * same aggregation for listing_type='host' instead of hand-rolling one. */
export async function reviewStats(listingType: "centre" | "club" | "game" | "host", listingId: string): Promise<{ rating: number; reviews: number }> {
  const row = (await reviewStatsStmt.get(listingType, listingId)) as { avg: number; count: number };
  return { rating: Math.round(row.avg * 10) / 10, reviews: row.count };
}

// "Participation Confidence" (implementation plan Phase 2) — a "would you
// do this again?" percentage instead of/alongside star ratings, computed
// from the SAME activity_feedback rows the existing post-activity prompt
// (feedback.ts, MyBookings.tsx's FeedbackPrompt) already collects — no new
// collection mechanism, just aggregating what's already there. Joined
// through bookings/registrations by ref since activity_feedback is keyed
// per-transaction, not per-listing. wouldRepeatPercent is null (not 0)
// when there's no feedback yet, so the UI can distinguish "nobody's said
// no" from "nobody's said anything".
const confidenceStmts = {
  centre: db.prepare(
    `SELECT SUM(CASE WHEN af.response = 'yes' THEN 1 ELSE 0 END) as yesCount, COUNT(*) as total
     FROM activity_feedback af JOIN bookings b ON af.kind = 'booking' AND af.ref = b.ref
     WHERE b.centre_id = ?`
  ),
  club: db.prepare(
    `SELECT SUM(CASE WHEN af.response = 'yes' THEN 1 ELSE 0 END) as yesCount, COUNT(*) as total
     FROM activity_feedback af JOIN registrations r ON af.kind = 'registration' AND af.ref = r.ref
     WHERE r.club_id = ?`
  ),
};

async function confidenceStats(listingType: "centre" | "club", listingId: string): Promise<{ wouldRepeatPercent: number | null; wouldRepeatCount: number }> {
  const row = (await confidenceStmts[listingType].get(listingId)) as { yesCount: number | null; total: number };
  if (!row.total) return { wouldRepeatPercent: null, wouldRepeatCount: 0 };
  return { wouldRepeatPercent: Math.round((100 * (row.yesCount ?? 0)) / row.total), wouldRepeatCount: row.total };
}

async function toCentre(row: CentreRow): Promise<Centre> {
  const { rating, reviews } = await reviewStats("centre", row.id);
  const { wouldRepeatPercent, wouldRepeatCount } = await confidenceStats("centre", row.id);
  const images = ((await centreImagesStmt.all(row.id)) as { url: string }[]).map((r) => r.url);
  // Feature flags (implementation backlog #5) — lets BookingFlow.tsx hide
  // the Open Booking checkbox proactively; createBookingInternal() is the
  // real server-side enforcement, this is just so the UI doesn't offer an
  // option that would fail.
  const { open_booking: openBookingEnabled } = await orgFeatureFlags(row.vendor_id);
  return {
    id: row.id,
    name: row.name,
    area: row.area,
    county: row.county,
    rating,
    reviews,
    wouldRepeatPercent,
    wouldRepeatCount,
    capacity: row.capacity,
    from: row.from_price,
    managedBy: row.managed_by,
    ph: row.ph,
    image: row.image_url,
    images: images.length > 0 ? images : row.image_url ? [row.image_url] : [],
    blurb: row.blurb,
    amenities: ((await amenitiesStmt.all(row.id)) as { amenity: string }[]).map((r) => r.amenity),
    rooms: (await roomsStmt.all(row.id)) as Room[],
    opensAt: row.opens_at,
    closesAt: row.closes_at,
    paymentMethod: row.payment_method,
    isOpen: !!row.is_open,
    mapUrl: row.map_url,
    claimed: row.vendor_id !== null,
    /** Provider public profile (IA spec §5) — links to /provider/:id. */
    vendorId: row.vendor_id,
    lat: row.lat !== null ? Number(row.lat) : null,
    lng: row.lng !== null ? Number(row.lng) : null,
    locationSource: (row.location_source as "confirmed" | "approximate" | "unknown") || "unknown",
    phone: row.phone,
    accessibility: row.accessibility ? row.accessibility.split(",").filter(Boolean) : [],
    featured: !!row.featured,
    openBookingEnabled,
    slug: row.slug,
    status: row.status,
  };
}

async function toClub(row: ClubRow): Promise<Club> {
  const { rating, reviews } = await reviewStats("club", row.id);
  const { wouldRepeatPercent, wouldRepeatCount } = await confidenceStats("club", row.id);
  const images = ((await clubImagesStmt.all(row.id)) as { url: string }[]).map((r) => r.url);
  return {
    id: row.id,
    name: row.name,
    sport: row.sport,
    area: row.area,
    county: row.county,
    ages: row.ages,
    price: row.price,
    unit: row.unit,
    trial: !!row.trial,
    ph: row.ph,
    image: row.image_url,
    images: images.length > 0 ? images : row.image_url ? [row.image_url] : [],
    blurb: row.blurb,
    includes: ((await includesStmt.all(row.id)) as { item: string }[]).map((r) => r.item),
    rating,
    reviews,
    wouldRepeatPercent,
    wouldRepeatCount,
    paymentMethod: row.payment_method,
    mapUrl: row.map_url,
    claimed: row.vendor_id !== null,
    vendorId: row.vendor_id,
    capacity: row.capacity,
    lat: row.lat !== null ? Number(row.lat) : null,
    lng: row.lng !== null ? Number(row.lng) : null,
    locationSource: (row.location_source as "confirmed" | "approximate" | "unknown") || "unknown",
    phone: row.phone,
    accessibility: row.accessibility ? row.accessibility.split(",").filter(Boolean) : [],
    category: row.category,
    featured: !!row.featured,
    slug: row.slug,
    audience: row.audience,
    status: row.status,
  };
}

// Public-facing listings: approved only. Internal callers (vendor/admin
// routes) fetch by id directly via getCentre/getClub, which don't filter by
// status, so a vendor can see their own pending/rejected listings.

// Featured listings sort first (IA spec §16) — a bounded promotion signal,
// not a placement/ranking system; everything else stays alphabetical.
/** Discovery-radius filtering (master-prompt punch list #2) — applied
 * app-side, after the normal county/status query, on whatever set of rows
 * already have real lat/lng. A row with no coordinates is dropped rather
 * than kept-by-default, since "within Xkm" can't be evaluated for it.
 * Sorted nearest-first when active; callers with no radius filter keep
 * whatever order they already had (featured/name, or unsorted). */
// A radius filter/sort is a precise distance CLAIM ("within Xkm", ranked
// nearest-first) — unlike ordinary discovery, which can honestly show a
// listing with an approximate/unknown location, a distance claim about that
// same listing can be wrong by the ~6km jitter radius approximateCoords()
// uses. Only 'confirmed' coordinates are trustworthy enough to support that
// claim (Maps cost-control follow-up pass, review point #4) — an
// approximate/unknown-location listing simply doesn't participate in a
// radius filter, the same way it wouldn't appear in "Near me" results with
// a real GPS-based competitor.
function applyRadiusFilter<T extends { lat: number | null; lng: number | null; locationSource: string | null }>(rows: T[], radius: RadiusFilter | undefined): T[] {
  if (!radius) return rows;
  return rows
    .filter((r) => r.lat !== null && r.lng !== null && r.locationSource === "confirmed" && haversineKm(radius.lat, radius.lng, r.lat, r.lng) <= radius.km)
    .sort((a, b) => haversineKm(radius.lat, radius.lng, a.lat!, a.lng!) - haversineKm(radius.lat, radius.lng, b.lat!, b.lng!));
}

export async function listCentres(county?: string, radius?: RadiusFilter): Promise<Centre[]> {
  const rows = (
    county && county !== "All"
      ? await db.prepare(`SELECT * FROM centres WHERE status = 'approved' AND county = ? ORDER BY featured DESC, name`).all(county)
      : await db.prepare(`SELECT * FROM centres WHERE status = 'approved' ORDER BY featured DESC, name`).all()
  ) as CentreRow[];
  const centres = await Promise.all(rows.map(toCentre));
  return applyRadiusFilter(centres, radius);
}

export async function getCentre(id: string): Promise<Centre | null> {
  const row = (await db.prepare(`SELECT * FROM centres WHERE id = ?`).get(id)) as CentreRow | undefined;
  return row ? toCentre(row) : null;
}

const bumpCentreViews = db.prepare(`UPDATE centres SET views = views + 1 WHERE id = ?`);

// Slugs (master-prompt punch list #1) — resolves by slug first, falls back
// to the raw id (idOrSlug used for both so a plain UUID still matches the
// `slug = ?` half harmlessly). Old bookmarked/shared UUID links keep
// working forever; getCentre() above stays id-only for internal callers
// (bookings.ts, admin routes) that always already hold the real id.
export async function getApprovedCentre(idOrSlug: string): Promise<Centre | null> {
  const row = (await db.prepare(`SELECT * FROM centres WHERE (slug = ? OR id = ?) AND status = 'approved'`).get(idOrSlug, idOrSlug)) as
    | CentreRow
    | undefined;
  if (!row) return null;
  await bumpCentreViews.run(row.id);
  return toCentre(row);
}

export async function listClubs(county?: string, sport?: string, radius?: RadiusFilter): Promise<Club[]> {
  const clauses: string[] = ["status = 'approved'"];
  const params: string[] = [];
  if (county && county !== "All") {
    clauses.push("county = ?");
    params.push(county);
  }
  if (sport && sport !== "All") {
    clauses.push("sport = ?");
    params.push(sport);
  }
  const rows = (await db
    .prepare(`SELECT * FROM clubs WHERE ${clauses.join(" AND ")} ORDER BY featured DESC, name`)
    .all(...params)) as ClubRow[];
  const clubs = await Promise.all(rows.map(toClub));
  return applyRadiusFilter(clubs, radius);
}

export async function getClub(id: string): Promise<Club | null> {
  const row = (await db.prepare(`SELECT * FROM clubs WHERE id = ?`).get(id)) as ClubRow | undefined;
  return row ? toClub(row) : null;
}

const bumpClubViews = db.prepare(`UPDATE clubs SET views = views + 1 WHERE id = ?`);

// Slugs (master-prompt punch list #1) — see getApprovedCentre's own
// comment; same slug-or-id resolution, same "old UUID link still works"
// guarantee.
export async function getApprovedClub(idOrSlug: string): Promise<Club | null> {
  const row = (await db.prepare(`SELECT * FROM clubs WHERE (slug = ? OR id = ?) AND status = 'approved'`).get(idOrSlug, idOrSlug)) as ClubRow | undefined;
  if (!row) return null;
  await bumpClubViews.run(row.id);
  return toClub(row);
}

// Map discovery (Maps & Geographic Discovery, Phase E) — a minimal marker
// payload for the bounds-scoped `/api/discover/map` endpoint. Deliberately
// its own small query rather than reusing listCentres/listClubs/experiences'
// full row shape: a viewport can hold hundreds of pins, so this returns only
// what a map preview needs (routes/discover.ts's own comment has the full
// rationale). Centres/clubs/experiences only — Games/Programs/Circles are
// out of scope for this pass (Games are frequently freestanding with no
// coordinates; Circles need their own privacy-safe approximate-area policy,
// not exact coordinates; Programs already surface via their parent
// centre/club pin).
export type MapMarkerType = "centre" | "club" | "experience";

/** `locationSource` lets the client visually distinguish an approximate pin
 * from a confirmed one (spec: "clearly separate approximate results" rather
 * than presenting a fabricated county-centroid jitter as a precise venue
 * location) — see CentreDetail.tsx/ClubDetail.tsx for the same distinction
 * on a listing's own detail page. */
export type MapMarker =
  | { id: string; type: "centre"; lat: number; lng: number; title: string; area: string; county: string; image: string | null; href: string; from: number; locationSource: string }
  | { id: string; type: "club"; lat: number; lng: number; title: string; area: string; county: string; image: string | null; href: string; price: number; unit: string; locationSource: string }
  | { id: string; type: "experience"; lat: number; lng: number; title: string; area: string; county: string; image: string | null; href: string; priceCents: number; locationSource: string };

export interface MapBounds {
  north: number;
  south: number;
  east: number;
  west: number;
}

// A sane per-type cap — "do not load the entire database into the browser"
// (spec §28-29). A dense viewport still clusters client-side (DiscoveryMap.tsx),
// but the server itself must never hand back thousands of rows for one pan.
const MAP_MARKER_LIMIT_PER_TYPE = 500;

/** "Search this area" filter consistency (Maps cost-control follow-up pass,
 * review point #2) — the same text/price filters a browse page's list panel
 * already applies client-side, now also enforced server-side for map
 * results, so a "free activities" filter can't suddenly surface paid
 * results just because the user panned the map. `q` matches
 * name/title case-insensitively (MySQL's default collation); price is
 * normalized to cents at the call site (centres/clubs store euros).
 * Amenity/accessibility filtering is NOT included here — the minimal
 * marker payload deliberately omits those fields (spec §32, "do not send
 * full entity records for thousands of markers"), so it's a real, disclosed
 * gap, not silently dropped: ExperienceKindBrowse.tsx has no amenity/
 * accessibility filter to begin with, and Browse.tsx's do not yet pass
 * through to Search-this-area. */
export interface MapMarkerFilters {
  q?: string;
  minPriceCents?: number;
  maxPriceCents?: number;
}

export async function listMapMarkers(bounds: MapBounds, types: ReadonlySet<MapMarkerType>, filters: MapMarkerFilters = {}): Promise<MapMarker[]> {
  const { north, south, east, west } = bounds;
  const { q, minPriceCents, maxPriceCents } = filters;
  const markers: MapMarker[] = [];

  if (types.has("centre")) {
    const clauses = ["status = 'approved'", "lat IS NOT NULL", "lng IS NOT NULL", "lat BETWEEN ? AND ?", "lng BETWEEN ? AND ?"];
    const params: (string | number)[] = [south, north, west, east];
    if (q) {
      clauses.push("name LIKE ?");
      params.push(`%${q}%`);
    }
    if (minPriceCents !== undefined) {
      clauses.push("from_price * 100 >= ?");
      params.push(minPriceCents);
    }
    if (maxPriceCents !== undefined) {
      clauses.push("from_price * 100 <= ?");
      params.push(maxPriceCents);
    }
    params.push(MAP_MARKER_LIMIT_PER_TYPE);
    const rows = (await db
      .prepare(`SELECT id, slug, name, area, county, image_url, from_price, lat, lng, location_source FROM centres WHERE ${clauses.join(" AND ")} ORDER BY featured DESC LIMIT ?`)
      .all(...params)) as {
      id: string;
      slug: string | null;
      name: string;
      area: string;
      county: string;
      image_url: string | null;
      from_price: number;
      lat: number;
      lng: number;
      location_source: string;
    }[];
    markers.push(
      ...rows.map((r) => ({
        id: r.id,
        type: "centre" as const,
        lat: Number(r.lat),
        lng: Number(r.lng),
        title: r.name,
        area: r.area,
        county: r.county,
        image: r.image_url,
        href: `/centres/${r.slug ?? r.id}`,
        from: r.from_price,
        locationSource: r.location_source,
      }))
    );
  }

  if (types.has("club")) {
    const clubClauses = ["status = 'approved'", "lat IS NOT NULL", "lng IS NOT NULL", "lat BETWEEN ? AND ?", "lng BETWEEN ? AND ?"];
    const clubParams: (string | number)[] = [south, north, west, east];
    if (q) {
      clubClauses.push("name LIKE ?");
      clubParams.push(`%${q}%`);
    }
    if (minPriceCents !== undefined) {
      clubClauses.push("price * 100 >= ?");
      clubParams.push(minPriceCents);
    }
    if (maxPriceCents !== undefined) {
      clubClauses.push("price * 100 <= ?");
      clubParams.push(maxPriceCents);
    }
    clubParams.push(MAP_MARKER_LIMIT_PER_TYPE);
    const rows = (await db
      .prepare(`SELECT id, slug, name, area, county, image_url, price, unit, lat, lng, location_source FROM clubs WHERE ${clubClauses.join(" AND ")} ORDER BY featured DESC LIMIT ?`)
      .all(...clubParams)) as {
      id: string;
      slug: string | null;
      name: string;
      area: string;
      county: string;
      image_url: string | null;
      price: number;
      unit: string;
      lat: number;
      lng: number;
      location_source: string;
    }[];
    markers.push(
      ...rows.map((r) => ({
        id: r.id,
        type: "club" as const,
        lat: Number(r.lat),
        lng: Number(r.lng),
        title: r.name,
        area: r.area,
        county: r.county,
        image: r.image_url,
        href: `/clubs/${r.slug ?? r.id}`,
        price: r.price,
        unit: r.unit,
        locationSource: r.location_source,
      }))
    );
  }

  if (types.has("experience")) {
    const expClauses = ["status = 'approved'", "lat IS NOT NULL", "lng IS NOT NULL", "lat BETWEEN ? AND ?", "lng BETWEEN ? AND ?"];
    const expParams: (string | number)[] = [south, north, west, east];
    if (q) {
      expClauses.push("title LIKE ?");
      expParams.push(`%${q}%`);
    }
    if (minPriceCents !== undefined) {
      expClauses.push("price_cents >= ?");
      expParams.push(minPriceCents);
    }
    if (maxPriceCents !== undefined) {
      expClauses.push("price_cents <= ?");
      expParams.push(maxPriceCents);
    }
    expParams.push(MAP_MARKER_LIMIT_PER_TYPE);
    const rows = (await db
      .prepare(`SELECT id, slug, kind, title, area, county, image_url, price_cents, lat, lng, location_source FROM experiences WHERE ${expClauses.join(" AND ")} ORDER BY featured DESC LIMIT ?`)
      .all(...expParams)) as {
      id: string;
      slug: string | null;
      kind: "adventure" | "experience";
      title: string;
      area: string;
      county: string;
      location_source: string;
      image_url: string | null;
      price_cents: number;
      lat: number;
      lng: number;
    }[];
    markers.push(
      ...rows.map((r) => ({
        id: r.id,
        type: "experience" as const,
        lat: Number(r.lat),
        lng: Number(r.lng),
        title: r.title,
        area: r.area,
        county: r.county,
        image: r.image_url,
        href: `/${r.kind === "adventure" ? "adventures" : "experiences"}/${r.slug ?? r.id}`,
        priceCents: r.price_cents,
        locationSource: r.location_source,
      }))
    );
  }

  return markers;
}

const DEFAULT_ORG_POLICIES = { cancellationHours: 48, bookingWindowDays: 90 };

/** Resolves the cancellation/booking-window policy that applies to a given
 * listing's vendor — via users.org_id → org_policies — falling back to the
 * platform defaults (same 48h/90d values org_policies.* itself defaults to)
 * when the vendor has no org_id (shouldn't happen post-backfill, but a
 * deleted/null vendor_id is possible) or the org never set its own row. */
export async function orgPoliciesForVendor(vendorId: string | null): Promise<{ cancellationHours: number; bookingWindowDays: number }> {
  if (!vendorId) return DEFAULT_ORG_POLICIES;
  const row = (await db
    .prepare(
      `SELECT p.cancellation_hours as cancellationHours, p.booking_window_days as bookingWindowDays
       FROM users u JOIN org_policies p ON p.org_id = u.org_id
       WHERE u.id = ?`
    )
    .get(vendorId)) as { cancellationHours: number; bookingWindowDays: number } | undefined;
  return row ?? DEFAULT_ORG_POLICIES;
}

// --- feature flags (implementation backlog #5) ---------------------------
// The `feature_flags` table existed as pure dead scaffolding before this —
// zero routes, zero queries, zero UI reference. Wired up here as real
// per-org capability toggles (admin-controlled, never vendor-self-serve —
// see routes/admin.ts's GET/PUT and routes/org.ts's read-only GET), gating
// 3 real, already-built features rather than inventing generic config.
// Enabled-by-default (opt-out): a missing row means "on," matching the
// table's own `enabled TINYINT NOT NULL DEFAULT 1` — an admin only ever
// creates a row to turn something OFF for one org.
export const FEATURE_FLAG_KEYS = ["open_booking", "programs", "experiences"] as const;
export type FeatureFlagKey = (typeof FEATURE_FLAG_KEYS)[number];
export type FeatureFlags = Record<FeatureFlagKey, boolean>;

const DEFAULT_FEATURE_FLAGS: FeatureFlags = { open_booking: true, programs: true, experiences: true };

export async function orgFeatureFlags(vendorId: string | null): Promise<FeatureFlags> {
  if (!vendorId) return { ...DEFAULT_FEATURE_FLAGS };
  const rows = (await db
    .prepare(
      `SELECT f.flag_key as flagKey, f.enabled FROM users u JOIN feature_flags f ON f.org_id = u.org_id WHERE u.id = ?`
    )
    .all(vendorId)) as { flagKey: string; enabled: number }[];
  const flags = { ...DEFAULT_FEATURE_FLAGS };
  for (const r of rows) {
    if ((FEATURE_FLAG_KEYS as readonly string[]).includes(r.flagKey)) flags[r.flagKey as FeatureFlagKey] = !!r.enabled;
  }
  return flags;
}

export async function orgFeatureFlagsById(orgId: string | null): Promise<FeatureFlags> {
  if (!orgId) return { ...DEFAULT_FEATURE_FLAGS };
  const rows = (await db.prepare(`SELECT flag_key as flagKey, enabled FROM feature_flags WHERE org_id = ?`).all(orgId)) as {
    flagKey: string;
    enabled: number;
  }[];
  const flags = { ...DEFAULT_FEATURE_FLAGS };
  for (const r of rows) {
    if ((FEATURE_FLAG_KEYS as readonly string[]).includes(r.flagKey)) flags[r.flagKey as FeatureFlagKey] = !!r.enabled;
  }
  return flags;
}

export interface DemandSignal {
  queryText: string;
  county: string;
  count: number;
  recentCount: number;
  lastSeenAt: string;
}

/** Aggregated read of search.ts's logged zero-result searches
 * (search_misses). Shared by routes/vendor.ts (scoped to the vendor's own
 * listing type/county) and routes/admin.ts (platform-wide — both opts
 * omitted). `recentCount` is the same rows within the last 7 days, so a
 * caller can show a lightweight trend without a full time-series query. */
export async function getDemandSignals(opts: { listingType?: "centre" | "club"; county?: string; limit: number }): Promise<DemandSignal[]> {
  const clauses: string[] = [];
  const params: string[] = [];
  if (opts.listingType) {
    clauses.push("(listing_type = ? OR listing_type = '')");
    params.push(opts.listingType);
  }
  if (opts.county) {
    clauses.push("(county = ? OR county = '')");
    params.push(opts.county);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const limit = Math.max(1, Math.min(200, Math.floor(opts.limit)));
  return (await db
    .prepare(
      `SELECT query_text as queryText, county, COUNT(*) as count, MAX(created_at) as lastSeenAt,
              CAST(SUM(CASE WHEN created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY) THEN 1 ELSE 0 END) AS UNSIGNED) as recentCount
       FROM search_misses ${where} GROUP BY query_text, county ORDER BY count DESC LIMIT ${limit}`
    )
    .all(...params)) as DemandSignal[];
}

export interface LocalMomentumSignal {
  label: string;
  county: string;
  recentSpots: number;
  priorSpots: number;
  growth: number;
}

/** The inverse of getDemandSignals() above — that tracks unmet demand
 * (searches that found nothing); this tracks growing supply: new game
 * capacity created in the last 7 days vs the 7 days before that, grouped
 * by activity + county ("Badminton: +14 spaces this week"). Scoped to
 * games only, not program/club sessions — those are set up once by a
 * vendor and recur on a fixed schedule, so "created this week" isn't a
 * meaningful growth signal for them the way a fresh ad-hoc game is.
 * Resident-facing (routes/discover.ts) — unlike getDemandSignals, which
 * has only ever been vendor/admin-only. Only games attached to a centre
 * (and so a real county) count; free-location games have nowhere to
 * attribute the growth to. */
export async function getLocalMomentum(opts: { county?: string; limit: number }): Promise<LocalMomentumSignal[]> {
  const params: string[] = [];
  let countyClause = "";
  if (opts.county) {
    countyClause = "AND c.county = ?";
    params.push(opts.county);
  }
  const limit = Math.max(1, Math.min(50, Math.floor(opts.limit)));
  const rows = (await db
    .prepare(
      `SELECT g.activity_label as label, c.county as county,
              CAST(SUM(CASE WHEN g.created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY) THEN g.capacity ELSE 0 END) AS SIGNED) as recentSpots,
              CAST(SUM(CASE WHEN g.created_at >= DATE_SUB(NOW(), INTERVAL 14 DAY) AND g.created_at < DATE_SUB(NOW(), INTERVAL 7 DAY) THEN g.capacity ELSE 0 END) AS SIGNED) as priorSpots
       FROM games g JOIN centres c ON c.id = g.centre_id
       WHERE g.status != 'cancelled' ${countyClause}
       GROUP BY g.activity_label, c.county
       HAVING recentSpots > priorSpots
       ORDER BY (recentSpots - priorSpots) DESC
       LIMIT ${limit}`
    )
    .all(...params)) as { label: string; county: string; recentSpots: number; priorSpots: number }[];
  return rows.map((r) => ({ ...r, growth: r.recentSpots - r.priorSpots }));
}

export interface IntentCluster {
  activityLabel: string;
  county: string;
  count: number;
  residentCount: number;
  sampleNames: string[];
  latestAt: string;
}

/** Explicit unmet-demand clusters from participation_intents (see
 * routes/participationIntents.ts) — unlike getDemandSignals() above, these
 * are resident-linkable, actionable rows (can be notified), not anonymous
 * query-text logging. Only active, non-expired intents count; there's no
 * background sweep that flips expired rows, so every read filters
 * expires_at directly. */
export async function getIntentClusters(opts: { county?: string; minCount?: number }): Promise<IntentCluster[]> {
  const params: string[] = [];
  let countyClause = "";
  if (opts.county) {
    countyClause = "AND county = ?";
    params.push(opts.county);
  }
  const minCount = Math.max(1, Math.floor(opts.minCount ?? 1));
  const rows = (await db
    .prepare(
      `SELECT activity_label as activityLabel, county, COUNT(*) as count,
              CAST(SUM(CASE WHEN resident_id IS NOT NULL THEN 1 ELSE 0 END) AS UNSIGNED) as residentCount,
              MAX(created_at) as latestAt,
              SUBSTRING_INDEX(GROUP_CONCAT(NULLIF(name, '') ORDER BY created_at DESC), ',', 5) as sampleNamesRaw
       FROM participation_intents
       WHERE status = 'active' AND (expires_at IS NULL OR expires_at > NOW()) ${countyClause}
       GROUP BY activity_label, county
       HAVING count >= ${minCount}
       ORDER BY count DESC`
    )
    .all(...params)) as (Omit<IntentCluster, "sampleNames"> & { sampleNamesRaw: string | null })[];
  return rows.map(({ sampleNamesRaw, ...r }) => ({ ...r, sampleNames: sampleNamesRaw ? sampleNamesRaw.split(",") : [] }));
}

// Marketplace health / liquidity (participation-intent plan Phase 2) — admin-
// only aggregates. Kept in this file alongside the other demand/supply
// signals above rather than a separate module, since every function here
// follows the exact same "one grouped SQL read, exported as a named
// function" shape as getDemandSignals/getLocalMomentum/getIntentClusters.

export interface SupplyOverview {
  upcomingGames: number;
  openSpots: number;
  activeCircles: number;
  activeHosts: number;
}

/** Upcoming = not yet happened (date >= today) and not cancelled. openSpots
 * sums capacity - joined across those games (never negative per game).
 * activeHosts = distinct hosts of a game created in the last 30 days —
 * mirrors getLocalMomentum's own "created recently" growth window. */
export async function getSupplyOverview(): Promise<SupplyOverview> {
  const { n: upcomingGames } = (await db
    .prepare(`SELECT COUNT(*) as n FROM games WHERE status IN ('open','pending_participants') AND date >= CURDATE()`)
    .get()) as { n: number };
  const { n: openSpots } = (await db
    .prepare(
      `SELECT CAST(COALESCE(SUM(GREATEST(g.capacity - COALESCE(jc.joined, 0), 0)), 0) AS SIGNED) as n
       FROM games g
       LEFT JOIN (SELECT game_id, COUNT(*) as joined FROM game_participants WHERE status = 'joined' GROUP BY game_id) jc ON jc.game_id = g.id
       WHERE g.status IN ('open','pending_participants') AND g.date >= CURDATE()`
    )
    .get()) as { n: number };
  const { n: activeCircles } = (await db.prepare(`SELECT COUNT(*) as n FROM circles WHERE status = 'active'`).get()) as { n: number };
  const { n: activeHosts } = (await db
    .prepare(`SELECT COUNT(DISTINCT host_resident_id) as n FROM games WHERE created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)`)
    .get()) as { n: number };
  return { upcomingGames, openSpots, activeCircles, activeHosts };
}

export interface ParticipationStats {
  joined: number;
  attended: number;
  noShow: number;
  totalResidents: number;
  repeatResidents: number;
  repeatRate: number;
}

/** Scoped to games whose date has already passed within the trailing
 * `windowDays` (default 90) — attended/no-show is only a meaningful signal
 * once the activity has actually happened. `game_participants.attended` is
 * the only real signal in this app (no dedicated no_show value) — a joined
 * row with `attended` 0 or still NULL after the date has passed counts as a
 * no-show-equivalent. repeatRate = residents who joined more than one
 * distinct game date in the window, over every resident who joined at least
 * one — a coarse, cheap repeat-participation proxy, not a true cohort
 * retention curve. */
export async function getParticipationStats(windowDays = 90): Promise<ParticipationStats> {
  const row = (await db
    .prepare(
      `SELECT COUNT(*) as joined,
              CAST(COALESCE(SUM(CASE WHEN gp.attended = 1 THEN 1 ELSE 0 END), 0) AS UNSIGNED) as attended,
              CAST(COALESCE(SUM(CASE WHEN gp.attended IS NULL OR gp.attended = 0 THEN 1 ELSE 0 END), 0) AS UNSIGNED) as noShow
       FROM game_participants gp
       JOIN games g ON g.id = gp.game_id
       WHERE gp.status = 'joined' AND g.date < CURDATE() AND g.date >= DATE_SUB(CURDATE(), INTERVAL ${windowDays} DAY)`
    )
    .get()) as { joined: number; attended: number; noShow: number };

  const repeatRow = (await db
    .prepare(
      `SELECT COUNT(*) as totalResidents, CAST(COALESCE(SUM(CASE WHEN cnt > 1 THEN 1 ELSE 0 END), 0) AS UNSIGNED) as repeatResidents FROM (
         SELECT gp.resident_id, COUNT(DISTINCT g.date) as cnt
         FROM game_participants gp JOIN games g ON g.id = gp.game_id
         WHERE gp.status = 'joined' AND g.date <= CURDATE() AND g.date >= DATE_SUB(CURDATE(), INTERVAL ${windowDays} DAY)
         GROUP BY gp.resident_id
       ) t`
    )
    .get()) as { totalResidents: number; repeatResidents: number };

  return {
    ...row,
    totalResidents: repeatRow.totalResidents,
    repeatResidents: repeatRow.repeatResidents,
    repeatRate: repeatRow.totalResidents > 0 ? repeatRow.repeatResidents / repeatRow.totalResidents : 0,
  };
}

export type LiquidityLabel = "LOW" | "DEVELOPING" | "HEALTHY" | "HIGH";

export interface LiquidityScore {
  activityLabel: string;
  county: string;
  demandCount: number;
  matchRate: number;
  openSpots: number;
  upcomingPlans: number;
  label: LiquidityLabel;
}

/** Deterministic, hand-tunable v1 scoring — deliberately kept in one small
 * pure function rather than scattered across the query/route, per the
 * source doc's own "keep ranking logic in a dedicated service" instruction.
 * Admin-only terminology (LOW/DEVELOPING/HEALTHY/HIGH) — never shown to a
 * resident. Weights are a starting point, not a tuned model. */
export function computeLiquidityLabel(m: { demandCount: number; openSpots: number; upcomingPlans: number; matchRate: number }): LiquidityLabel {
  const score = m.demandCount * 2 + m.upcomingPlans * 3 + m.openSpots * 1 + m.matchRate * 10;
  if (score >= 30) return "HIGH";
  if (score >= 15) return "HEALTHY";
  if (score >= 5) return "DEVELOPING";
  return "LOW";
}

/** Merges two independent aggregates (unmet demand from participation_intents,
 * upcoming supply from games) in JS rather than one large multi-join SQL
 * query — keeps each half debuggable on its own and avoids a fragile UNION
 * across two differently-shaped tables. */
export async function getLiquidityScores(county?: string): Promise<LiquidityScore[]> {
  const countyClause = county ? "AND county = ?" : "";
  const countyParams = county ? [county] : [];

  const demandRows = (await db
    .prepare(
      `SELECT activity_label as activityLabel, county, COUNT(*) as demandCount,
              CAST(COALESCE(SUM(CASE WHEN status = 'converted' THEN 1 ELSE 0 END), 0) AS UNSIGNED) as convertedCount
       FROM participation_intents
       WHERE status IN ('active','converted') ${countyClause}
       GROUP BY activity_label, county`
    )
    .all(...countyParams)) as { activityLabel: string; county: string; demandCount: number; convertedCount: number }[];

  const supplyCountyClause = county ? "AND c.county = ?" : "";
  const supplyRows = (await db
    .prepare(
      `SELECT g.activity_label as activityLabel, c.county as county,
              COUNT(DISTINCT g.id) as upcomingPlans,
              CAST(COALESCE(SUM(GREATEST(g.capacity - COALESCE(jc.joined, 0), 0)), 0) AS SIGNED) as openSpots
       FROM games g
       JOIN centres c ON c.id = g.centre_id
       LEFT JOIN (SELECT game_id, COUNT(*) as joined FROM game_participants WHERE status = 'joined' GROUP BY game_id) jc ON jc.game_id = g.id
       WHERE g.status IN ('open','pending_participants') AND g.date >= CURDATE() ${supplyCountyClause}
       GROUP BY g.activity_label, c.county`
    )
    .all(...countyParams)) as { activityLabel: string; county: string; upcomingPlans: number; openSpots: number }[];

  const key = (activityLabel: string, county: string) => `${activityLabel}::${county}`;
  const merged = new Map<string, LiquidityScore>();
  for (const d of demandRows) {
    merged.set(key(d.activityLabel, d.county), {
      activityLabel: d.activityLabel,
      county: d.county,
      demandCount: d.demandCount,
      matchRate: d.demandCount > 0 ? d.convertedCount / d.demandCount : 0,
      openSpots: 0,
      upcomingPlans: 0,
      label: "LOW",
    });
  }
  for (const s of supplyRows) {
    const k = key(s.activityLabel, s.county);
    const existing = merged.get(k);
    if (existing) {
      existing.openSpots = s.openSpots;
      existing.upcomingPlans = s.upcomingPlans;
    } else {
      merged.set(k, { activityLabel: s.activityLabel, county: s.county, demandCount: 0, matchRate: 0, openSpots: s.openSpots, upcomingPlans: s.upcomingPlans, label: "LOW" });
    }
  }

  const results = Array.from(merged.values());
  for (const r of results) r.label = computeLiquidityLabel(r);
  results.sort((a, b) => b.demandCount + b.upcomingPlans - (a.demandCount + a.upcomingPlans));
  return results;
}

// --- market/category launch config (participation-intent plan Phase 4) ---
// Same enabled-by-default/missing-row-means-on shape as feature_flags above,
// scoped by county. Same category list as client/src/types.ts's
// INTEREST_OPTIONS — kept in sync by hand (same convention as
// irishCounties.ts's own kept-in-sync-by-hand county list comment), since
// the server can't import client code.
export const MARKET_CATEGORIES = ["Badminton", "Football", "Swimming", "Fitness", "Yoga", "Walking", "Kids activities", "Arts", "Learning", "Community events", "Outdoor", "Wellbeing"] as const;
export type MarketCategory = (typeof MARKET_CATEGORIES)[number];
export type MarketCategoryFlags = Record<MarketCategory, boolean>;

function defaultMarketCategories(): MarketCategoryFlags {
  return Object.fromEntries(MARKET_CATEGORIES.map((c) => [c, true])) as MarketCategoryFlags;
}

export async function getMarketCategories(county: string): Promise<MarketCategoryFlags> {
  const rows = (await db.prepare(`SELECT category, enabled FROM market_categories WHERE county = ?`).all(county)) as { category: string; enabled: number }[];
  const flags = defaultMarketCategories();
  for (const r of rows) {
    if ((MARKET_CATEGORIES as readonly string[]).includes(r.category)) flags[r.category as MarketCategory] = !!r.enabled;
  }
  return flags;
}

export interface ReferralAttributionRow {
  referrerClientId: string;
  source: string;
  landedAt: string;
  visitorClientId: string;
  converted: boolean;
  convertedKind: "booking" | "registration" | "game" | null;
}

/** Best-effort, read-side referral attribution (participation-intent plan
 * Phase 3, tightened in the post-audit hardening pass) — joins each 'land'
 * event to a real booking/registration/game-join within `windowDays` after
 * the landing. Deliberately NOT a hard link (no foreign key, nothing written
 * back onto the booking/registration/game_participants row) — this is an
 * estimate for the admin dashboard, not a conversion-tracking system
 * threaded through checkout.
 *
 * Matches on EITHER `visitor_client_id` (the original, anonymous-capable
 * path) OR `visitor_resident_id` (captured on land only when the visitor
 * happened to already be signed in) — note this is the *visitor's* own
 * resident id, not `referrer_resident_id` (which identifies the person who
 * *shared* the link; joining on that would incorrectly attribute the
 * sharer's own bookings instead of the visitor's). The resident-id path is
 * also what makes game_participants attributable at all: that table has no
 * client_id column (resident-only), so an anonymous visitor's game join
 * still can't be traced this way, but a signed-in visitor's now can. */
export async function getReferralAttribution(windowDays = 7, limit = 100): Promise<ReferralAttributionRow[]> {
  const days = Math.max(1, Math.min(365, Math.floor(windowDays)));
  const rowLimit = Math.max(1, Math.min(500, Math.floor(limit)));
  const rows = (await db
    .prepare(
      `SELECT r.referrer_client_id as referrerClientId, r.source, r.created_at as landedAt, r.visitor_client_id as visitorClientId,
              b.ref as bookingRef, reg.ref as registrationRef, gp.id as gameParticipantId
       FROM referrals r
       LEFT JOIN bookings b ON (b.client_id = r.visitor_client_id OR (r.visitor_resident_id IS NOT NULL AND b.resident_id = r.visitor_resident_id))
         AND b.created_at BETWEEN r.created_at AND DATE_ADD(r.created_at, INTERVAL ? DAY)
       LEFT JOIN registrations reg ON (reg.client_id = r.visitor_client_id OR (r.visitor_resident_id IS NOT NULL AND reg.resident_id = r.visitor_resident_id))
         AND reg.created_at BETWEEN r.created_at AND DATE_ADD(r.created_at, INTERVAL ? DAY)
       LEFT JOIN game_participants gp ON r.visitor_resident_id IS NOT NULL AND gp.resident_id = r.visitor_resident_id
         AND gp.joined_at BETWEEN r.created_at AND DATE_ADD(r.created_at, INTERVAL ? DAY)
       WHERE r.event = 'land'
       ORDER BY r.created_at DESC
       LIMIT ?`
    )
    .all(days, days, days, rowLimit)) as {
    referrerClientId: string;
    source: string;
    landedAt: string;
    visitorClientId: string;
    bookingRef: string | null;
    registrationRef: string | null;
    gameParticipantId: number | null;
  }[];

  return rows.map((r) => ({
    referrerClientId: r.referrerClientId,
    source: r.source,
    landedAt: r.landedAt,
    visitorClientId: r.visitorClientId,
    converted: !!(r.bookingRef || r.registrationRef || r.gameParticipantId),
    convertedKind: r.bookingRef ? "booking" : r.registrationRef ? "registration" : r.gameParticipantId ? "game" : null,
  }));
}

export interface AnalyticsFunnelRow {
  eventType: string;
  count: number;
}

/** Minimal admin rollup over analytics_events (post-audit hardening pass) —
 * a single GROUP BY count per funnel stage over a recent window, not a
 * dashboard/analytics product. See analytics.ts's logEvent() for the event
 * vocabulary this counts. */
export async function getAnalyticsFunnel(windowDays = 30): Promise<AnalyticsFunnelRow[]> {
  const days = Math.max(1, Math.min(365, Math.floor(windowDays)));
  const rows = (await db
    .prepare(
      `SELECT event_type as eventType, COUNT(*) as count
       FROM analytics_events
       WHERE created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
       GROUP BY event_type
       ORDER BY count DESC`
    )
    .all(days)) as { eventType: string; count: number }[];
  return rows.map((r) => ({ eventType: r.eventType, count: Number(r.count) }));
}

// Familiarity & Circles-from-repetition (implementation plan Phase 8).
// Scoped to games only — game_participants is the one participation table
// with clean per-session multi-resident membership, real dates, and a real
// activity label, i.e. exactly "same activity + same date/session + >1
// resident." Registrations/program enrollments/bookings don't give a clean
// "who else was there with me" signal the same way.

/** "N people you've played with before are joining" — counts OTHER
 * residents currently joined to `gameId` who have previously shared a
 * *different* joined game with `residentId`. Deliberately count-only, never
 * names — shown inside one game's own context (GameDetail.tsx), never a
 * browsable "people near you" list. */
export async function countFamiliarCoParticipants(residentId: string, gameId: string): Promise<number> {
  const { n } = (await db
    .prepare(
      `SELECT COUNT(DISTINCT gp_now.resident_id) as n
       FROM game_participants gp_now
       JOIN residents r ON r.id = gp_now.resident_id
       WHERE gp_now.game_id = ? AND gp_now.status = 'joined' AND gp_now.resident_id != ? AND r.hide_from_familiar_count = 0 AND r.deactivated_at IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM blocked_residents br
           WHERE (br.blocker_resident_id = ? AND br.blocked_resident_id = gp_now.resident_id)
              OR (br.blocker_resident_id = gp_now.resident_id AND br.blocked_resident_id = ?)
         )
         AND EXISTS (
           SELECT 1 FROM game_participants gp_before
           WHERE gp_before.resident_id = gp_now.resident_id AND gp_before.status = 'joined' AND gp_before.game_id != ?
             AND EXISTS (SELECT 1 FROM game_participants gp_me WHERE gp_me.game_id = gp_before.game_id AND gp_me.resident_id = ? AND gp_me.status = 'joined')
         )`
    )
    .get(gameId, residentId, residentId, residentId, gameId, residentId)) as { n: number };
  return n;
}

export interface CircleSuggestion {
  activityLabel: string;
  familiarCount: number;
}

/** Repetition-detection → "Make this a Circle?" — matches the differentiator's
 * own stated example: a resident who's shared 3+ distinct games with the
 * same other person, for the same activity, has a "familiar" co-player for
 * that activity; once 2+ such people exist for one activity, suggest
 * forming a Circle around it. Excludes activities the resident is already
 * circled on, so a suggestion doesn't linger after they've acted on it. */
export async function getCircleSuggestions(residentId: string): Promise<CircleSuggestion[]> {
  const rows = (await db
    .prepare(
      `SELECT activityLabel, COUNT(*) as familiarCount FROM (
         SELECT g.activity_label as activityLabel, gp2.resident_id as otherResidentId, COUNT(DISTINCT gp1.game_id) as sharedCount
         FROM game_participants gp1
         JOIN game_participants gp2 ON gp2.game_id = gp1.game_id AND gp2.resident_id != gp1.resident_id AND gp2.status = 'joined'
         JOIN games g ON g.id = gp1.game_id
         WHERE gp1.resident_id = ? AND gp1.status = 'joined' AND g.activity_label != ''
         GROUP BY g.activity_label, gp2.resident_id
         HAVING sharedCount >= 3
       ) pairs
       GROUP BY activityLabel
       HAVING familiarCount >= 2
       ORDER BY familiarCount DESC`
    )
    .all(residentId)) as CircleSuggestion[];

  const existing = (await db
    .prepare(
      `SELECT DISTINCT c.activity_label as activityLabel FROM circles c
       JOIN circle_members cm ON cm.circle_id = c.id
       WHERE cm.resident_id = ?`
    )
    .all(residentId)) as { activityLabel: string }[];
  const existingLabels = new Set(existing.map((e) => e.activityLabel));
  return rows.filter((r) => !existingLabels.has(r.activityLabel));
}

export interface RoutineSuggestion {
  activityLabel: string;
  dayOfWeek: number;
  time: string;
  centreId: string | null;
  sessionCount: number;
}

/** Routines-as-an-object (IA spec §9) — the personal counterpart to
 * getCircleSuggestions() above: repeated attendance on the same weekday,
 * regardless of who else was there (a Circle needs shared people; a
 * routine doesn't). MySQL's DAYOFWEEK() is 1=Sunday..7=Saturday; kept as-is
 * rather than remapped, since routines.day_of_week just needs to be
 * internally consistent, not match any particular JS/display convention
 * (the client remaps for display). Excludes activities already turned into
 * an active routine. */
export async function getRoutineSuggestions(residentId: string): Promise<RoutineSuggestion[]> {
  const rows = (await db
    .prepare(
      `SELECT g.activity_label as activityLabel, DAYOFWEEK(g.date) as dayOfWeek, COUNT(*) as sessionCount,
              MAX(g.time) as time, MAX(g.centre_id) as centreId
       FROM game_participants gp
       JOIN games g ON g.id = gp.game_id
       WHERE gp.resident_id = ? AND gp.status = 'joined' AND g.activity_label != '' AND g.date >= DATE_SUB(CURDATE(), INTERVAL 8 WEEK)
       GROUP BY g.activity_label, DAYOFWEEK(g.date)
       HAVING sessionCount >= 3
       ORDER BY sessionCount DESC`
    )
    .all(residentId)) as RoutineSuggestion[];

  const existing = (await db
    .prepare(`SELECT activity_label as activityLabel, day_of_week as dayOfWeek FROM routines WHERE resident_id = ? AND status != 'cancelled'`)
    .all(residentId)) as { activityLabel: string; dayOfWeek: number }[];
  const existingKeys = new Set(existing.map((e) => `${e.activityLabel}::${e.dayOfWeek}`));
  return rows.filter((r) => !existingKeys.has(`${r.activityLabel}::${r.dayOfWeek}`));
}

// Games/program_sessions/club_sessions: the three scheduled-activity
// sources, each with its own status/active concept ('open', 'published' +
// session status != 'cancelled', active=1). Centralized here so
// routes/discover.ts (Phase 5 "what's on" feeds) and routes/search.ts
// (Phase 6 search) share one definition of "what counts as a live,
// bookable activity" instead of reimplementing the same joins/filters
// twice — the exact duplication CLAUDE.md flags for this table set.

export interface ScheduledActivity {
  kind: "game" | "program_session" | "club_session";
  id: string;
  title: string;
  date: string;
  time: string;
  centreName: string | null;
  clubName: string | null;
  area: string | null;
  county: string | null;
  priceCents: number | null;
  href: string;
  /** Games only — null for program/club sessions, neither of which has a
   * single-tap join unit (see discover.ts's DiscoverItem for the full
   * rationale, mirrored here). */
  spotsLeft: number | null;
  /** Games only, and only real data. */
  joined: number | null;
  imageUrl: string | null;
  isLive: boolean;
  /** Real for program sessions (their own duration_minutes); a documented
   * assumption for games/club_sessions, same ASSUMED_DURATION_MINUTES used
   * internally for isLive — see there. Powers Free Time Mode's "fits in my
   * window" filter (implementation plan Phase 9). */
  durationMinutes: number;
  /** From the hosting centre/club — null if that listing has no
   * coordinates set. Powers Free Time Mode's distance filter. */
  lat: number | null;
  lng: number | null;
  /** Coordinate provenance of the hosting centre/club (see Centre.
   * locationSource) — a distance-based filter/claim must only trust
   * 'confirmed' coordinates (applyRadiusFilter enforces this); ordinary
   * non-distance discovery is unaffected and still shows every activity
   * regardless of this value. */
  locationSource: string | null;
}

export interface GameRow {
  id: string;
  activity_label: string;
  date: string;
  time: string;
  price_cents: number | null;
  capacity: number;
  image_url: string;
  centre_name: string | null;
  area: string | null;
  county: string | null;
  joined: number;
  lat: number | string | null;
  lng: number | string | null;
  location_source: string | null;
}

export interface ProgramSessionRow {
  id: string;
  date: string;
  time: string;
  title: string;
  price_cents: number;
  listing_type: "centre" | "club";
  image_url: string;
  listing_name: string;
  area: string | null;
  county: string | null;
  duration_minutes: number;
  lat: number | string | null;
  lng: number | string | null;
  location_source: string | null;
}

export interface ClubSessionRow {
  id: string;
  day_of_week: number;
  time: string;
  label: string;
  image_url: string;
  club_id: string;
  club_name: string;
  area: string;
  county: string;
  price: number;
  lat: number | string | null;
  lng: number | string | null;
  location_source: string | null;
}

/** The next date (today or later) this weekday falls on, YYYY-MM-DD. */
export function nextOccurrence(dayOfWeek: number, today: Date): string {
  const diff = (dayOfWeek - today.getUTCDay() + 7) % 7;
  const d = new Date(today);
  d.setUTCDate(today.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}

// Neither games nor club_sessions store a duration — these are reasonable,
// documented assumptions (a pickup game runs ~2h, a club training session
// ~90m), not real data. Program sessions have a real duration_minutes and
// use that instead.
export const ASSUMED_DURATION_MINUTES: Record<ScheduledActivity["kind"], number> = {
  game: 120,
  club_session: 90,
  program_session: 0, // unused — program sessions always pass their own real duration
};

export function computeIsLive(kind: ScheduledActivity["kind"], date: string, time: string, durationMinutes: number, now: Date): boolean {
  const [hour, minute] = time.split(":").map(Number);
  const start = irelandWallTimeToUtc(date, hour, minute);
  const end = new Date(start.getTime() + (kind === "program_session" ? durationMinutes : ASSUMED_DURATION_MINUTES[kind]) * 60000);
  return now >= start && now <= end;
}

/** Every open game, published-program session, and active club session in
 * `[from, to]` (club sessions are recurring, so `to` only bounds how many
 * weekly occurrences roll forward — see nextOccurrence), optionally scoped
 * to one county. Callers apply their own ranking/keyword/filter logic on
 * top — this only owns the "is it real and currently offered" contract.
 *
 * Lifecycle-audit privacy fix — the games branch is the one shared query
 * behind Home/Explore/Search/Free-Time (`discover.ts`, `search.ts`), and
 * until now it filtered only `status = 'open'`, never `visibility` — a
 * circle-only or invite-only game (see games.ts's `visibility` column)
 * would surface in general discovery feeds to anyone. `sharing.ts`'s
 * `getShareData`/`ogMeta.ts` already correctly gate on visibility for the
 * share-card/OG-meta paths; this closes the same gap for real discovery. */
export async function listScheduledActivities(opts: { county?: string; from: Date; to: Date; radius?: RadiusFilter }): Promise<ScheduledActivity[]> {
  const { county, from, to } = opts;
  const fromIso = from.toISOString().slice(0, 10);
  const toIso = to.toISOString().slice(0, 10);

  const games = (
    county
      ? await db
          .prepare(
            `SELECT g.id, g.activity_label, g.date, g.time, g.price_cents, g.capacity, g.image_url, c.name as centre_name, c.area, c.county, c.lat, c.lng, c.location_source,
                    (SELECT COUNT(*) FROM game_participants gp WHERE gp.game_id = g.id AND gp.status = 'joined') as joined
             FROM games g LEFT JOIN centres c ON c.id = g.centre_id
             WHERE g.status = 'open' AND g.visibility = 'public' AND g.lifecycle IN ${DISCOVERABLE_LIFECYCLES_SQL} AND g.date >= ? AND g.date <= ? AND c.county = ?`
          )
          .all(fromIso, toIso, county)
      : await db
          .prepare(
            `SELECT g.id, g.activity_label, g.date, g.time, g.price_cents, g.capacity, g.image_url, c.name as centre_name, c.area, c.county, c.lat, c.lng, c.location_source,
                    (SELECT COUNT(*) FROM game_participants gp WHERE gp.game_id = g.id AND gp.status = 'joined') as joined
             FROM games g LEFT JOIN centres c ON c.id = g.centre_id
             WHERE g.status = 'open' AND g.visibility = 'public' AND g.lifecycle IN ${DISCOVERABLE_LIFECYCLES_SQL} AND g.date >= ? AND g.date <= ?`
          )
          .all(fromIso, toIso)
  ) as GameRow[];

  const programSessions = (await db
    .prepare(
      `SELECT ps.id, ps.date, ps.time, ps.duration_minutes, p.title, p.price_cents, p.listing_type, p.image_url,
              COALESCE(c.name, cl.name) as listing_name, COALESCE(c.area, cl.area) as area, COALESCE(c.county, cl.county) as county,
              COALESCE(c.lat, cl.lat) as lat, COALESCE(c.lng, cl.lng) as lng, COALESCE(c.location_source, cl.location_source) as location_source
       FROM program_sessions ps
       JOIN programs p ON p.id = ps.program_id
       LEFT JOIN centres c ON p.listing_type = 'centre' AND c.id = p.listing_id
       LEFT JOIN clubs cl ON p.listing_type = 'club' AND cl.id = p.listing_id
       WHERE p.status = 'published' AND ps.status != 'cancelled' AND ps.date >= ? AND ps.date <= ?
       ${county ? "AND COALESCE(c.county, cl.county) = ?" : ""}`
    )
    .all(...(county ? [fromIso, toIso, county] : [fromIso, toIso]))) as ProgramSessionRow[];

  const clubSessions = (await db
    .prepare(
      `SELECT cs.id, cs.day_of_week, cs.time, cs.label, cs.image_url, cl.id as club_id, cl.name as club_name, cl.area, cl.county, cl.price, cl.lat, cl.lng, cl.location_source
       FROM club_sessions cs JOIN clubs cl ON cl.id = cs.club_id
       WHERE cs.active = 1 ${county ? "AND cl.county = ?" : ""}`
    )
    .all(...(county ? [county] : []))) as ClubSessionRow[];

  const now = new Date();
  const items: ScheduledActivity[] = [
    ...games.map((g) => ({
      kind: "game" as const,
      id: g.id,
      title: g.activity_label,
      date: g.date,
      time: g.time,
      centreName: g.centre_name,
      clubName: null,
      area: g.area,
      county: g.county,
      priceCents: g.price_cents,
      href: `/games/${g.id}`,
      spotsLeft: Math.max(0, g.capacity - g.joined),
      joined: g.joined,
      imageUrl: g.image_url || null,
      isLive: computeIsLive("game", g.date, g.time, 0, now),
      durationMinutes: ASSUMED_DURATION_MINUTES.game,
      lat: g.lat !== null ? Number(g.lat) : null,
      lng: g.lng !== null ? Number(g.lng) : null,
      locationSource: g.location_source,
    })),
    ...programSessions.map((p) => ({
      kind: "program_session" as const,
      id: p.id,
      title: p.title,
      date: p.date,
      time: p.time,
      centreName: p.listing_type === "centre" ? p.listing_name : null,
      clubName: p.listing_type === "club" ? p.listing_name : null,
      area: p.area,
      county: p.county,
      priceCents: p.price_cents,
      href: `/programs/${p.id}`,
      spotsLeft: null,
      joined: null,
      imageUrl: p.image_url || null,
      isLive: computeIsLive("program_session", p.date, p.time, p.duration_minutes, now),
      durationMinutes: p.duration_minutes,
      lat: p.lat !== null ? Number(p.lat) : null,
      lng: p.lng !== null ? Number(p.lng) : null,
      locationSource: p.location_source,
    })),
    ...clubSessions.map((cs) => {
      const date = nextOccurrence(cs.day_of_week, now);
      return {
        kind: "club_session" as const,
        id: cs.id,
        title: cs.label || cs.club_name,
        date,
        time: cs.time,
        centreName: null,
        clubName: cs.club_name,
        area: cs.area,
        county: cs.county,
        priceCents: cs.price ? Math.round(cs.price * 100) : null,
        href: `/clubs/${cs.club_id}`,
        spotsLeft: null,
        joined: null,
        imageUrl: cs.image_url || null,
        isLive: computeIsLive("club_session", date, cs.time, 0, now),
        durationMinutes: ASSUMED_DURATION_MINUTES.club_session,
        lat: cs.lat !== null ? Number(cs.lat) : null,
        lng: cs.lng !== null ? Number(cs.lng) : null,
        locationSource: cs.location_source,
      };
    }),
  ];

  return applyRadiusFilter(items, opts.radius);
}

// listResidentParticipation: the shared foundation for "everything this
// person has done or is doing" — Phase 0 already surfaced games/circles/
// programs in MyBookings.tsx via 3 separate endpoints; this is the
// unified version those and future consumers (My Life, Participation
// Passport, My Places — see the implementation plan) can share instead of
// each re-deriving the same 5-table union. Deliberately application-level
// normalization over 5 independent SELECTs, not one hand-rolled giant
// UNION query duplicating each table's own ownership/payment predicates —
// those predicates (paid-only, client_id-or-email ownership) already live
// correctly in bookings.ts/registrations.ts/programs.ts/games.ts/
// circles.ts; re-deriving them here as raw SQL would risk silently
// drifting from the real behavior over time.

export interface ParticipationEntry {
  kind: "booking" | "registration" | "program_enrollment" | "game" | "circle";
  ref: string;
  title: string;
  subtitle: string;
  /** YYYY-MM-DD — the booking/game's own event date where one exists,
   * otherwise the row's created_at/joined_at date (registrations/program
   * enrollments/circle membership don't have a single "event date"). */
  date: string;
  status: string;
  href: string;
}

/** `clientId` is always required (every device has one); `guestEmail` and
 * `residentId` are both optional and independent, matching the app's own
 * three-identity-signal reality (see CLAUDE.md) — bookings/registrations/
 * program enrollments match by client_id-or-email (guest-friendly, same
 * as their own "mine" endpoints); games/circles require a resident_id
 * (always did, both need requireResident to join) and are simply omitted
 * when residentId is null. */
export async function listResidentParticipation(clientId: string, guestEmail: string | null, residentId: string | null): Promise<ParticipationEntry[]> {
  const email = guestEmail ?? "";

  const bookings = (await db
    .prepare(
      `SELECT b.ref as ref, CONCAT(c.name, IF(r.name IS NOT NULL, CONCAT(' — ', r.name), '')) as title,
              CONCAT(b.date, ' ', b.time) as subtitle, b.date as date, b.status as status
       FROM bookings b JOIN centres c ON c.id = b.centre_id LEFT JOIN rooms r ON r.id = b.room_id AND r.centre_id = b.centre_id
       WHERE (b.client_id = ? OR LOWER(b.email) = LOWER(?)) AND b.payment_status = 'paid'`
    )
    .all(clientId, email)) as { ref: string; title: string; subtitle: string; date: string; status: string }[];

  const registrations = (await db
    .prepare(
      `SELECT r.ref as ref, CONCAT(r.child_first, ' ', r.child_last, ' — ', c.name) as title,
              r.team as subtitle, DATE_FORMAT(r.created_at, '%Y-%m-%d') as date, r.status as status
       FROM registrations r JOIN clubs c ON c.id = r.club_id
       WHERE (r.client_id = ? OR LOWER(r.email) = LOWER(?)) AND r.payment_status = 'paid'`
    )
    .all(clientId, email)) as { ref: string; title: string; subtitle: string; date: string; status: string }[];

  const programEnrollments = (await db
    .prepare(
      `SELECT pe.ref as ref, CONCAT(p.title, ' — ', pe.participant_name) as title,
              COALESCE(c.name, cl.name) as subtitle, DATE_FORMAT(pe.created_at, '%Y-%m-%d') as date,
              pe.status as status, pe.program_id as programId
       FROM program_enrollments pe JOIN programs p ON p.id = pe.program_id
       LEFT JOIN centres c ON p.listing_type = 'centre' AND c.id = p.listing_id
       LEFT JOIN clubs cl ON p.listing_type = 'club' AND cl.id = p.listing_id
       WHERE (pe.client_id = ? OR LOWER(pe.email) = LOWER(?)) AND pe.payment_status = 'paid'`
    )
    .all(clientId, email)) as { ref: string; title: string; subtitle: string; date: string; status: string; programId: string }[];

  const games = residentId
    ? ((await db
        .prepare(
          `SELECT g.id as ref, g.activity_label as title, CONCAT(g.date, ' ', g.time) as subtitle, g.date as date, g.status as status
           FROM games g JOIN game_participants gp ON gp.game_id = g.id
           WHERE gp.resident_id = ? AND gp.status = 'joined'`
        )
        .all(residentId)) as { ref: string; title: string; subtitle: string; date: string; status: string }[])
    : [];

  const circles = residentId
    ? ((await db
        .prepare(
          `SELECT c.id as ref, c.name as title, c.area as subtitle, DATE_FORMAT(cm.joined_at, '%Y-%m-%d') as date
           FROM circles c JOIN circle_members cm ON cm.circle_id = c.id
           WHERE cm.resident_id = ?`
        )
        .all(residentId)) as { ref: string; title: string; subtitle: string; date: string }[])
    : [];

  const items: ParticipationEntry[] = [
    ...bookings.map((b) => ({ kind: "booking" as const, ref: b.ref, title: b.title, subtitle: b.subtitle, date: b.date, status: b.status, href: `/bookings?ref=${b.ref}` })),
    ...registrations.map((r) => ({ kind: "registration" as const, ref: r.ref, title: r.title, subtitle: r.subtitle, date: r.date, status: r.status, href: `/bookings?ref=${r.ref}` })),
    ...programEnrollments.map((p) => ({ kind: "program_enrollment" as const, ref: p.ref, title: p.title, subtitle: p.subtitle, date: p.date, status: p.status, href: `/programs/${p.programId}` })),
    ...games.map((g) => ({ kind: "game" as const, ref: g.ref, title: g.title, subtitle: g.subtitle, date: g.date, status: g.status, href: `/games/${g.ref}` })),
    ...circles.map((c) => ({ kind: "circle" as const, ref: c.ref, title: c.title, subtitle: c.subtitle, date: c.date, status: "member", href: `/circles/${c.ref}` })),
  ];

  items.sort((a, b) => b.date.localeCompare(a.date));
  return items;
}

// --- Provider Profile (public) ---------------------------------------------
// Three fresh, vendor-scoped rollups added for the Provider Profile rebuild.
// Written as small, targeted per-source queries summed/merged in application
// code — the same convention listResidentParticipation's own comment above
// documents (each table's real ownership/payment predicates already live
// correctly in its own route; re-deriving them as one giant hand-rolled UNION
// risks silently drifting from that). None of these fabricate a stat: every
// number here is a real count against real rows.

export interface ProviderUpcomingItem {
  kind: "experience" | "program_session" | "club_session";
  id: string;
  title: string;
  /** YYYY-MM-DD — real for experience/program sessions; a computed next
   * weekday occurrence for club sessions (same projection
   * listScheduledActivities already uses), never a stored fake date. */
  date: string;
  time: string;
  href: string;
  imageUrl: string | null;
  priceCents: number | null;
  capacity: number | null;
  /** Real only for experiences (single-session capacity tracking). null for
   * program/club sessions, same convention as ScheduledActivity. */
  spotsLeft: number | null;
}

/** Everything a resident can actually book/join with this vendor in the near
 * future — centres are deliberately excluded (on-demand room booking has no
 * "next session" concept; represented by a "Check availability" CTA
 * instead, not a fake dated row here). Capped and ordered soonest-first. */
export async function getProviderUpcoming(vendorId: string, limit = 6): Promise<ProviderUpcomingItem[]> {
  const experienceSessions = (await db
    .prepare(
      `SELECT es.id, es.date, es.time, es.capacity as session_capacity, e.id as experience_id, e.title, e.image_url, e.price_cents, e.capacity as experience_capacity, e.slug,
              (SELECT COALESCE(SUM(eb.party_size), 0) FROM experience_bookings eb WHERE eb.session_id = es.id AND eb.payment_status = 'paid' AND eb.status != 'cancelled') as booked
       FROM experience_sessions es JOIN experiences e ON e.id = es.experience_id
       WHERE e.vendor_id = ? AND e.status = 'approved' AND es.status = 'scheduled' AND es.date >= CURDATE()
       ORDER BY es.date, es.time LIMIT ?`
    )
    .all(vendorId, limit)) as {
    id: string; date: string; time: string; session_capacity: number | null; experience_id: string; title: string; image_url: string; price_cents: number; experience_capacity: number; slug: string | null; booked: number;
  }[];

  const programSessions = (await db
    .prepare(
      `SELECT ps.id, ps.date, ps.time, p.id as program_id, p.title, p.image_url, p.price_cents, p.capacity
       FROM program_sessions ps JOIN programs p ON p.id = ps.program_id
       WHERE p.vendor_id = ? AND p.status = 'published' AND ps.status != 'cancelled' AND ps.date >= CURDATE()
       ORDER BY ps.date, ps.time LIMIT ?`
    )
    .all(vendorId, limit)) as { id: string; date: string; time: string; program_id: string; title: string; image_url: string; price_cents: number; capacity: number | null }[];

  const clubSessionRows = (await db
    .prepare(
      `SELECT cs.id, cs.day_of_week, cs.time, cs.label, cs.capacity, cl.id as club_id, cl.name as club_name, cl.image_url, cl.price
       FROM club_sessions cs JOIN clubs cl ON cl.id = cs.club_id
       WHERE cl.vendor_id = ? AND cs.active = 1
       LIMIT ?`
    )
    .all(vendorId, limit)) as { id: string; day_of_week: number; time: string; label: string; capacity: number | null; club_id: string; club_name: string; image_url: string; price: number }[];

  const now = new Date();
  const items: ProviderUpcomingItem[] = [
    ...experienceSessions.map((s) => ({
      kind: "experience" as const,
      id: s.id,
      title: s.title,
      date: s.date,
      time: s.time,
      href: `/experiences/${s.slug ?? s.experience_id}`,
      imageUrl: s.image_url || null,
      priceCents: s.price_cents,
      capacity: s.session_capacity ?? s.experience_capacity,
      spotsLeft: Math.max(0, (s.session_capacity ?? s.experience_capacity) - Number(s.booked)),
    })),
    ...programSessions.map((p) => ({
      kind: "program_session" as const,
      id: p.id,
      title: p.title,
      date: p.date,
      time: p.time,
      href: `/programs/${p.program_id}`,
      imageUrl: p.image_url || null,
      priceCents: p.price_cents,
      capacity: p.capacity,
      spotsLeft: null,
    })),
    ...clubSessionRows.map((cs) => ({
      kind: "club_session" as const,
      id: cs.id,
      title: cs.label || cs.club_name,
      date: nextOccurrence(cs.day_of_week, now),
      time: cs.time,
      href: `/clubs/${cs.club_id}`,
      imageUrl: cs.image_url || null,
      priceCents: cs.price ? Math.round(cs.price * 100) : null,
      capacity: cs.capacity,
      spotsLeft: null,
    })),
  ];

  items.sort((a, b) => (a.date === b.date ? a.time.localeCompare(b.time) : a.date.localeCompare(b.date)));
  return items.slice(0, limit);
}

/** Real people who have paid to take part in something this vendor runs —
 * summed across the four listing types a vendor can actually own (games and
 * Circles belong to residents/Hosts, not vendor accounts, so are correctly
 * excluded). "People," not "bookings": a booking/experience-booking's own
 * party size is counted, not just 1 per row. */
export async function getProviderParticipantCount(vendorId: string): Promise<number> {
  const [bookings, registrations, enrollments, experienceBookings] = await Promise.all([
    db
      .prepare(
        `SELECT COALESCE(SUM(b.guests), 0) as n FROM bookings b JOIN centres c ON c.id = b.centre_id
         WHERE c.vendor_id = ? AND b.payment_status = 'paid'`
      )
      .get(vendorId) as Promise<{ n: number }>,
    db
      .prepare(
        `SELECT COUNT(*) as n FROM registrations r JOIN clubs c ON c.id = r.club_id
         WHERE c.vendor_id = ? AND r.payment_status = 'paid'`
      )
      .get(vendorId) as Promise<{ n: number }>,
    db.prepare(`SELECT COUNT(*) as n FROM program_enrollments pe JOIN programs p ON p.id = pe.program_id WHERE p.vendor_id = ? AND pe.payment_status = 'paid'`).get(vendorId) as Promise<{ n: number }>,
    db
      .prepare(
        `SELECT COALESCE(SUM(eb.party_size), 0) as n FROM experience_bookings eb JOIN experiences e ON e.id = eb.experience_id
         WHERE e.vendor_id = ? AND eb.payment_status = 'paid' AND eb.status != 'cancelled'`
      )
      .get(vendorId) as Promise<{ n: number }>,
  ]);
  return Number(bookings.n) + Number(registrations.n) + Number(enrollments.n) + Number(experienceBookings.n);
}

/** Of everything paid for at this vendor, what share actually went ahead
 * (wasn't cancelled) — an honest outcome stat, not a fault/blame one (see
 * ProviderProfile v3's own plan comment: this is deliberately different
 * from "went ahead as planned"/reliability framing, which would need a
 * cancelled_by column this app doesn't have). null when there's no paid
 * activity yet, so the caller can omit the stat rather than show a
 * meaningless 100%/0%. */
export async function getProviderWentAheadPercent(vendorId: string): Promise<number | null> {
  const [bookings, registrations, enrollments, experienceBookings] = await Promise.all([
    db
      .prepare(`SELECT COUNT(*) as total, SUM(b.status != 'cancelled') as ok FROM bookings b JOIN centres c ON c.id = b.centre_id WHERE c.vendor_id = ? AND b.payment_status = 'paid'`)
      .get(vendorId) as Promise<{ total: number; ok: number | null }>,
    db
      .prepare(`SELECT COUNT(*) as total, SUM(r.status != 'cancelled') as ok FROM registrations r JOIN clubs c ON c.id = r.club_id WHERE c.vendor_id = ? AND r.payment_status = 'paid'`)
      .get(vendorId) as Promise<{ total: number; ok: number | null }>,
    db
      .prepare(`SELECT COUNT(*) as total, SUM(pe.status != 'cancelled') as ok FROM program_enrollments pe JOIN programs p ON p.id = pe.program_id WHERE p.vendor_id = ? AND pe.payment_status = 'paid'`)
      .get(vendorId) as Promise<{ total: number; ok: number | null }>,
    db
      .prepare(`SELECT COUNT(*) as total, SUM(eb.status != 'cancelled') as ok FROM experience_bookings eb JOIN experiences e ON e.id = eb.experience_id WHERE e.vendor_id = ? AND eb.payment_status = 'paid'`)
      .get(vendorId) as Promise<{ total: number; ok: number | null }>,
  ]);
  const total = Number(bookings.total) + Number(registrations.total) + Number(enrollments.total) + Number(experienceBookings.total);
  if (total === 0) return null;
  const ok = Number(bookings.ok ?? 0) + Number(registrations.ok ?? 0) + Number(enrollments.ok ?? 0) + Number(experienceBookings.ok ?? 0);
  return Math.round((ok / total) * 100);
}

export interface ProviderAmenities {
  items: string[];
  accessibility: string | null;
}

/** Dedup amenities/accessibility text across every listing a vendor owns —
 * centre_amenities and club_includes are the two real, already-populated
 * sources (see db/index.ts); experiences have neither, so aren't queried
 * here. Returns an empty items array (not fabricated placeholder text) when
 * no listing has any recorded. */
export async function getProviderAmenities(centreIds: string[], clubIds: string[]): Promise<ProviderAmenities> {
  const [centreAmenities, clubItems, centreAccess, clubAccess] = await Promise.all([
    centreIds.length ? ((await db.prepare(`SELECT DISTINCT amenity FROM centre_amenities WHERE centre_id IN (${centreIds.map(() => "?").join(",")})`).all(...centreIds)) as { amenity: string }[]) : [],
    clubIds.length ? ((await db.prepare(`SELECT DISTINCT item FROM club_includes WHERE club_id IN (${clubIds.map(() => "?").join(",")})`).all(...clubIds)) as { item: string }[]) : [],
    centreIds.length ? ((await db.prepare(`SELECT accessibility FROM centres WHERE id IN (${centreIds.map(() => "?").join(",")}) AND accessibility IS NOT NULL AND accessibility != ''`).all(...centreIds)) as { accessibility: string }[]) : [],
    clubIds.length ? ((await db.prepare(`SELECT accessibility FROM clubs WHERE id IN (${clubIds.map(() => "?").join(",")}) AND accessibility IS NOT NULL AND accessibility != ''`).all(...clubIds)) as { accessibility: string }[]) : [],
  ]);
  const items = Array.from(new Set([...centreAmenities.map((a) => a.amenity), ...clubItems.map((c) => c.item)])).filter(Boolean);
  const accessibilitySet = Array.from(new Set([...centreAccess, ...clubAccess].flatMap((r) => r.accessibility.split(",").map((s) => s.trim())).filter(Boolean)));
  return { items, accessibility: accessibilitySet.length ? accessibilitySet.join(", ") : null };
}

export interface ProviderReviewsSummary {
  average: number | null;
  count: number;
  recent: { name: string; rating: number; comment: string; listingType: string; listingId: string; createdAt: string }[];
}

/** Reviews are stored per-listing (listing_type/listing_id — see CLAUDE.md),
 * never per-vendor, so this rolls up across every listing a vendor owns.
 * Real data only — no cross-listing rating rollup existed before this.
 * `listingId` is returned (not resolved to a name here) so the caller
 * — providers.ts, which already has the vendor's full centres/clubs/
 * experiences arrays loaded for this same request — can resolve the
 * listing's name in memory rather than this needing a 4th round-trip. */
export async function getProviderReviewsSummary(vendorId: string, centreIds: string[], clubIds: string[], experienceIds: string[]): Promise<ProviderReviewsSummary> {
  const pairs: { type: string; id: string }[] = [
    ...centreIds.map((id) => ({ type: "centre", id })),
    ...clubIds.map((id) => ({ type: "club", id })),
    ...experienceIds.map((id) => ({ type: "experience", id })),
  ];
  if (pairs.length === 0) return { average: null, count: 0, recent: [] };

  const whereClause = pairs.map(() => `(listing_type = ? AND listing_id = ?)`).join(" OR ");
  const params = pairs.flatMap((p) => [p.type, p.id]);

  const { avg, n } = (await db.prepare(`SELECT AVG(rating) as avg, COUNT(*) as n FROM reviews WHERE hidden = 0 AND (${whereClause})`).get(...params)) as { avg: string | null; n: number };
  const recent = (await db
    .prepare(`SELECT name, rating, comment, listing_type as listingType, listing_id as listingId, created_at as createdAt FROM reviews WHERE hidden = 0 AND (${whereClause}) ORDER BY created_at DESC LIMIT 3`)
    .all(...params)) as { name: string; rating: number; comment: string; listingType: string; listingId: string; createdAt: string }[];

  return { average: avg !== null ? Number(avg) : null, count: Number(n), recent };
}
