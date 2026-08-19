import { db } from "./index.js";
import { irelandWallTimeToUtc } from "../irelandTime.js";
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
}

interface GameRow {
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
}

interface ProgramSessionRow {
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
}

interface ClubSessionRow {
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
}

/** The next date (today or later) this weekday falls on, YYYY-MM-DD. */
function nextOccurrence(dayOfWeek: number, today: Date): string {
  const diff = (dayOfWeek - today.getUTCDay() + 7) % 7;
  const d = new Date(today);
  d.setUTCDate(today.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}

// Neither games nor club_sessions store a duration — these are reasonable,
// documented assumptions (a pickup game runs ~2h, a club training session
// ~90m), not real data. Program sessions have a real duration_minutes and
// use that instead.
const ASSUMED_DURATION_MINUTES: Record<ScheduledActivity["kind"], number> = {
  game: 120,
  club_session: 90,
  program_session: 0, // unused — program sessions always pass their own real duration
};

function computeIsLive(kind: ScheduledActivity["kind"], date: string, time: string, durationMinutes: number, now: Date): boolean {
  const [hour, minute] = time.split(":").map(Number);
  const start = irelandWallTimeToUtc(date, hour, minute);
  const end = new Date(start.getTime() + (kind === "program_session" ? durationMinutes : ASSUMED_DURATION_MINUTES[kind]) * 60000);
  return now >= start && now <= end;
}

/** Every open game, published-program session, and active club session in
 * `[from, to]` (club sessions are recurring, so `to` only bounds how many
 * weekly occurrences roll forward — see nextOccurrence), optionally scoped
 * to one county. Callers apply their own ranking/keyword/filter logic on
 * top — this only owns the "is it real and currently offered" contract. */
export async function listScheduledActivities(opts: { county?: string; from: Date; to: Date }): Promise<ScheduledActivity[]> {
  const { county, from, to } = opts;
  const fromIso = from.toISOString().slice(0, 10);
  const toIso = to.toISOString().slice(0, 10);

  const games = (
    county
      ? await db
          .prepare(
            `SELECT g.id, g.activity_label, g.date, g.time, g.price_cents, g.capacity, g.image_url, c.name as centre_name, c.area, c.county,
                    (SELECT COUNT(*) FROM game_participants gp WHERE gp.game_id = g.id AND gp.status = 'joined') as joined
             FROM games g LEFT JOIN centres c ON c.id = g.centre_id
             WHERE g.status = 'open' AND g.date >= ? AND g.date <= ? AND c.county = ?`
          )
          .all(fromIso, toIso, county)
      : await db
          .prepare(
            `SELECT g.id, g.activity_label, g.date, g.time, g.price_cents, g.capacity, g.image_url, c.name as centre_name, c.area, c.county,
                    (SELECT COUNT(*) FROM game_participants gp WHERE gp.game_id = g.id AND gp.status = 'joined') as joined
             FROM games g LEFT JOIN centres c ON c.id = g.centre_id
             WHERE g.status = 'open' AND g.date >= ? AND g.date <= ?`
          )
          .all(fromIso, toIso)
  ) as GameRow[];

  const programSessions = (await db
    .prepare(
      `SELECT ps.id, ps.date, ps.time, ps.duration_minutes, p.title, p.price_cents, p.listing_type, p.image_url,
              COALESCE(c.name, cl.name) as listing_name, COALESCE(c.area, cl.area) as area, COALESCE(c.county, cl.county) as county
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
      `SELECT cs.id, cs.day_of_week, cs.time, cs.label, cs.image_url, cl.id as club_id, cl.name as club_name, cl.area, cl.county, cl.price
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
      };
    }),
  ];

  return items;
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
