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
}

const amenitiesStmt = db.prepare(
  `SELECT amenity FROM centre_amenities WHERE centre_id = ? ORDER BY sort_order`
);
const roomsStmt = db.prepare(
  `SELECT id, centre_id as centreId, name, cap, rate, \`desc\`, payment_method as paymentMethod FROM rooms WHERE centre_id = ? ORDER BY sort_order`
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
