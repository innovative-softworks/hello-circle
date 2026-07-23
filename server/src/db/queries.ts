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
}

const amenitiesStmt = db.prepare(
  `SELECT amenity FROM centre_amenities WHERE centre_id = ? ORDER BY sort_order`
);
const roomsStmt = db.prepare(
  `SELECT id, centre_id as centreId, name, cap, rate, desc FROM rooms WHERE centre_id = ? ORDER BY sort_order`
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
function reviewStats(listingType: "centre" | "club", listingId: string): { rating: number; reviews: number } {
  const row = reviewStatsStmt.get(listingType, listingId) as { avg: number; count: number };
  return { rating: Math.round(row.avg * 10) / 10, reviews: row.count };
}

function toCentre(row: CentreRow): Centre {
  const { rating, reviews } = reviewStats("centre", row.id);
  const images = (centreImagesStmt.all(row.id) as { url: string }[]).map((r) => r.url);
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
    amenities: (amenitiesStmt.all(row.id) as { amenity: string }[]).map((r) => r.amenity),
    rooms: roomsStmt.all(row.id) as Room[],
    opensAt: row.opens_at,
    closesAt: row.closes_at,
  };
}

function toClub(row: ClubRow): Club {
  const { rating, reviews } = reviewStats("club", row.id);
  const images = (clubImagesStmt.all(row.id) as { url: string }[]).map((r) => r.url);
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
    includes: (includesStmt.all(row.id) as { item: string }[]).map((r) => r.item),
    rating,
    reviews,
  };
}

// Public-facing listings: approved only. Internal callers (vendor/admin
// routes) fetch by id directly via getCentre/getClub, which don't filter by
// status, so a vendor can see their own pending/rejected listings.

export function listCentres(county?: string): Centre[] {
  const rows = (
    county && county !== "All"
      ? db.prepare(`SELECT * FROM centres WHERE status = 'approved' AND county = ? ORDER BY name`).all(county)
      : db.prepare(`SELECT * FROM centres WHERE status = 'approved' ORDER BY name`).all()
  ) as CentreRow[];
  return rows.map(toCentre);
}

export function getCentre(id: string): Centre | null {
  const row = db.prepare(`SELECT * FROM centres WHERE id = ?`).get(id) as CentreRow | undefined;
  return row ? toCentre(row) : null;
}

const bumpCentreViews = db.prepare(`UPDATE centres SET views = views + 1 WHERE id = ?`);

export function getApprovedCentre(id: string): Centre | null {
  const row = db.prepare(`SELECT * FROM centres WHERE id = ? AND status = 'approved'`).get(id) as
    | CentreRow
    | undefined;
  if (!row) return null;
  bumpCentreViews.run(id);
  return toCentre(row);
}

export function listClubs(county?: string, sport?: string): Club[] {
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
  const rows = db
    .prepare(`SELECT * FROM clubs WHERE ${clauses.join(" AND ")} ORDER BY name`)
    .all(...params) as ClubRow[];
  return rows.map(toClub);
}

export function getClub(id: string): Club | null {
  const row = db.prepare(`SELECT * FROM clubs WHERE id = ?`).get(id) as ClubRow | undefined;
  return row ? toClub(row) : null;
}

const bumpClubViews = db.prepare(`UPDATE clubs SET views = views + 1 WHERE id = ?`);

export function getApprovedClub(id: string): Club | null {
  const row = db.prepare(`SELECT * FROM clubs WHERE id = ? AND status = 'approved'`).get(id) as ClubRow | undefined;
  if (!row) return null;
  bumpClubViews.run(id);
  return toClub(row);
}
