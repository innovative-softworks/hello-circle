import { db } from "./index.js";
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
  phone: string;
  accessibility: string;
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
  phone: string;
  accessibility: string;
  category: string;
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

/** Live rating computed from real submitted reviews — replaces the old seeded static number. */
async function reviewStats(listingType: "centre" | "club", listingId: string): Promise<{ rating: number; reviews: number }> {
  const row = (await reviewStatsStmt.get(listingType, listingId)) as { avg: number; count: number };
  return { rating: Math.round(row.avg * 10) / 10, reviews: row.count };
}

async function toCentre(row: CentreRow): Promise<Centre> {
  const { rating, reviews } = await reviewStats("centre", row.id);
  const images = ((await centreImagesStmt.all(row.id)) as { url: string }[]).map((r) => r.url);
  return {
    id: row.id,
    name: row.name,
    area: row.area,
    county: row.county,
    rating,
    reviews,
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
    lat: row.lat !== null ? Number(row.lat) : null,
    lng: row.lng !== null ? Number(row.lng) : null,
    phone: row.phone,
    accessibility: row.accessibility ? row.accessibility.split(",").filter(Boolean) : [],
  };
}

async function toClub(row: ClubRow): Promise<Club> {
  const { rating, reviews } = await reviewStats("club", row.id);
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
    paymentMethod: row.payment_method,
    mapUrl: row.map_url,
    claimed: row.vendor_id !== null,
    capacity: row.capacity,
    lat: row.lat !== null ? Number(row.lat) : null,
    lng: row.lng !== null ? Number(row.lng) : null,
    phone: row.phone,
    accessibility: row.accessibility ? row.accessibility.split(",").filter(Boolean) : [],
    category: row.category,
  };
}

// Public-facing listings: approved only. Internal callers (vendor/admin
// routes) fetch by id directly via getCentre/getClub, which don't filter by
// status, so a vendor can see their own pending/rejected listings.

export async function listCentres(county?: string): Promise<Centre[]> {
  const rows = (
    county && county !== "All"
      ? await db.prepare(`SELECT * FROM centres WHERE status = 'approved' AND county = ? ORDER BY name`).all(county)
      : await db.prepare(`SELECT * FROM centres WHERE status = 'approved' ORDER BY name`).all()
  ) as CentreRow[];
  return Promise.all(rows.map(toCentre));
}

export async function getCentre(id: string): Promise<Centre | null> {
  const row = (await db.prepare(`SELECT * FROM centres WHERE id = ?`).get(id)) as CentreRow | undefined;
  return row ? toCentre(row) : null;
}

const bumpCentreViews = db.prepare(`UPDATE centres SET views = views + 1 WHERE id = ?`);

export async function getApprovedCentre(id: string): Promise<Centre | null> {
  const row = (await db.prepare(`SELECT * FROM centres WHERE id = ? AND status = 'approved'`).get(id)) as
    | CentreRow
    | undefined;
  if (!row) return null;
  await bumpCentreViews.run(id);
  return toCentre(row);
}

export async function listClubs(county?: string, sport?: string): Promise<Club[]> {
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
    .prepare(`SELECT * FROM clubs WHERE ${clauses.join(" AND ")} ORDER BY name`)
    .all(...params)) as ClubRow[];
  return Promise.all(rows.map(toClub));
}

export async function getClub(id: string): Promise<Club | null> {
  const row = (await db.prepare(`SELECT * FROM clubs WHERE id = ?`).get(id)) as ClubRow | undefined;
  return row ? toClub(row) : null;
}

const bumpClubViews = db.prepare(`UPDATE clubs SET views = views + 1 WHERE id = ?`);

export async function getApprovedClub(id: string): Promise<Club | null> {
  const row = (await db.prepare(`SELECT * FROM clubs WHERE id = ? AND status = 'approved'`).get(id)) as ClubRow | undefined;
  if (!row) return null;
  await bumpClubViews.run(id);
  return toClub(row);
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
