import { db } from "./db/index.js";
import {
  ASSUMED_DURATION_MINUTES,
  computeIsLive,
  nextOccurrence,
  type ClubSessionRow,
  type GameRow,
  type ProgramSessionRow,
  type ScheduledActivity,
} from "./db/queries.js";

// Phase 1 "Connect" — a normalized presentation/discovery contract over
// existing Game/Program-session/Club-session/Experience-session source
// tables. NOT a database table, NOT a new source of truth, NOT a
// replacement for any of those tables' own checkout/capacity/refund/
// attendance logic — every transactional action still routes back to its
// own source route (games.ts join, experiences.ts checkout, etc.). This
// only exists to let discovery/My Life surfaces render four different
// underlying shapes with one shared card, per the V2 architecture plan.
//
// ActivitySummary is a strict superset of db/queries.ts's existing
// ScheduledActivity (game | program_session | club_session, already used by
// discover.ts/search.ts) — kind widens to also include "experience_session",
// and four new fields are added (host, hostVerified, vendorName, circleId),
// all nullable, populated only where cheaply available from each source's
// existing query today. A raw ScheduledActivity value is always a valid
// ActivitySummary; going the other way (adding the new fields) is what the
// adapters below exist to do.
//
// Deliberately NOT wired into db/queries.ts's listScheduledActivities() —
// that function stays exactly as it is (it's already used by discover.ts/
// search.ts and is well-covered by existing behaviour; refactoring its
// internals to call these adapters would touch a working code path for no
// functional gain in this phase). These adapters are new, additive
// infrastructure for new call sites, not a rewrite of an existing one.

// The 5 fields below are all optional (not just nullable) — deliberately,
// so a raw ScheduledActivity value already flowing through discover.ts/
// search.ts's existing, unmodified responses continues to satisfy this
// type without every call site needing to start setting them. The four
// adapters below always populate all five; a consumer that only has an
// unmigrated ScheduledActivity can either leave them undefined or default
// them to null when rendering.
export interface ActivitySummary extends Omit<ScheduledActivity, "kind"> {
  kind: ScheduledActivity["kind"] | "experience_session";
  /** Same value as href, exposed under a name that survives a future
   * sharing feature (Universal Sharing, deferred — see V2 plan §32/§47)
   * without callers needing to know it's currently identical to href. */
  canonicalUrl?: string;
  /** The resident host's display name — Games only; null for every
   * vendor-run source. */
  host?: string | null;
  /** Whichever organiser applies (Resident host or Vendor) is trust-
   * verified — Verified Host badge for a Game, provider-tier-derived
   * verification for a vendor listing. Null where not cheaply available
   * from the source's existing query (see each adapter's own comment). */
  hostVerified?: boolean | null;
  /** The vendor's own display name (businessName-or-name), where this
   * source's existing query already resolves it. Null otherwise — adding
   * it everywhere would mean widening listScheduledActivities()'s own SQL,
   * out of scope for this phase (see file header). */
  vendorName?: string | null;
  /** games.circle_id / a future circle_plans link — null everywhere today;
   * no adapter's current row carries it yet (Circle Plans is Phase 2, not
   * this phase). Field exists now so Phase 2 doesn't need another type
   * change to add it. */
  circleId?: string | null;
}

export function gameToActivitySummary(g: GameRow, now: Date = new Date()): ActivitySummary {
  return {
    kind: "game",
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
    canonicalUrl: `/games/${g.id}`,
    spotsLeft: Math.max(0, g.capacity - g.joined),
    joined: g.joined,
    imageUrl: g.image_url || null,
    isLive: computeIsLive("game", g.date, g.time, 0, now),
    durationMinutes: ASSUMED_DURATION_MINUTES.game,
    lat: g.lat !== null ? Number(g.lat) : null,
    lng: g.lng !== null ? Number(g.lng) : null,
    host: null, // GameRow doesn't currently select host_resident_id/name — see file header
    hostVerified: null,
    vendorName: null,
    circleId: null,
  };
}

export function programSessionToActivitySummary(p: ProgramSessionRow, now: Date = new Date()): ActivitySummary {
  return {
    kind: "program_session",
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
    canonicalUrl: `/programs/${p.id}`,
    spotsLeft: null,
    joined: null,
    imageUrl: p.image_url || null,
    isLive: computeIsLive("program_session", p.date, p.time, p.duration_minutes, now),
    durationMinutes: p.duration_minutes,
    lat: p.lat !== null ? Number(p.lat) : null,
    lng: p.lng !== null ? Number(p.lng) : null,
    host: null,
    hostVerified: null,
    vendorName: null, // ProgramSessionRow resolves the listing's name, not the vendor's own — different field
    circleId: null,
  };
}

export function clubSessionToActivitySummary(cs: ClubSessionRow, now: Date = new Date()): ActivitySummary {
  const date = nextOccurrence(cs.day_of_week, now);
  return {
    kind: "club_session",
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
    canonicalUrl: `/clubs/${cs.club_id}`,
    spotsLeft: null,
    joined: null,
    imageUrl: cs.image_url || null,
    isLive: computeIsLive("club_session", date, cs.time, 0, now),
    durationMinutes: ASSUMED_DURATION_MINUTES.club_session,
    lat: cs.lat !== null ? Number(cs.lat) : null,
    lng: cs.lng !== null ? Number(cs.lng) : null,
    host: null,
    hostVerified: null,
    vendorName: null,
    circleId: null,
  };
}

export interface ExperienceSessionRow {
  id: string;
  date: string;
  time: string;
  capacity: number | null;
  experience_id: string;
  title: string;
  price_cents: number;
  image_url: string;
  area: string;
  county: string;
  lat: number | string | null;
  lng: number | string | null;
  booked: number;
  vendor_business_name: string;
  vendor_name: string;
  vendor_provider_tier: string;
}

/** Every scheduled, still-open Experience/Adventure session in [from, to],
 * optionally scoped to one county — same shape of query as
 * listScheduledActivities()'s three branches, but standalone: this is new
 * (Experiences were never part of ScheduledActivity), and per this file's
 * header isn't unioned into that function's live feed this phase. */
export async function listUpcomingExperienceSessionRows(opts: { county?: string; from: Date; to: Date }): Promise<ExperienceSessionRow[]> {
  const fromIso = opts.from.toISOString().slice(0, 10);
  const toIso = opts.to.toISOString().slice(0, 10);
  const rows = (await db
    .prepare(
      `SELECT es.id, es.date, es.time, es.capacity, e.id as experience_id, e.title, e.price_cents, e.image_url, e.area, e.county, e.lat, e.lng,
              e.capacity as experience_capacity,
              (SELECT COALESCE(SUM(party_size), 0) FROM experience_bookings eb WHERE eb.session_id = es.id AND eb.payment_status = 'paid' AND eb.status != 'cancelled') as booked,
              u.business_name as vendor_business_name, u.name as vendor_name, u.provider_tier as vendor_provider_tier
       FROM experience_sessions es
       JOIN experiences e ON e.id = es.experience_id
       JOIN users u ON u.id = e.vendor_id
       WHERE es.status = 'scheduled' AND e.status = 'approved' AND es.date >= ? AND es.date <= ?
       ${opts.county ? "AND e.county = ?" : ""}`
    )
    .all(...(opts.county ? [fromIso, toIso, opts.county] : [fromIso, toIso]))) as (ExperienceSessionRow & { experience_capacity: number })[];
  return rows;
}

export function experienceToActivitySummary(row: ExperienceSessionRow & { experience_capacity?: number }, now: Date = new Date()): ActivitySummary {
  const capacity = row.capacity ?? row.experience_capacity ?? null;
  return {
    kind: "experience_session",
    id: row.id,
    title: row.title,
    date: row.date,
    time: row.time,
    centreName: null,
    clubName: null,
    area: row.area,
    county: row.county,
    priceCents: row.price_cents,
    href: `/experiences/${row.experience_id}`,
    canonicalUrl: `/experiences/${row.experience_id}`,
    spotsLeft: capacity !== null ? Math.max(0, capacity - Number(row.booked)) : null,
    joined: null,
    imageUrl: row.image_url || null,
    // computeIsLive only honors its own explicit durationMinutes argument
    // for kind==="program_session" — every other kind ignores it in favour
    // of ASSUMED_DURATION_MINUTES (see queries.ts). Experiences have no
    // entry in that map (it's typed to ScheduledActivity's 3 kinds), so
    // this deliberately passes "program_session" to take the
    // real-duration branch rather than extend that map for a kind it
    // doesn't know about — a documented reuse of the existing contract,
    // not a bug. 120 matches the same "half-day outing" assumption
    // experiences.ts uses elsewhere for sessions with no stored duration.
    isLive: computeIsLive("program_session", row.date, row.time, 120, now),
    durationMinutes: 120,
    lat: row.lat !== null ? Number(row.lat) : null,
    lng: row.lng !== null ? Number(row.lng) : null,
    host: null,
    // Experiences are vendor-run, not host-organised — reuses the same
    // trust-badge concept as Games' Verified Host, derived from
    // provider_tier the same way experiences.ts's own toExperienceJson does.
    hostVerified: row.vendor_provider_tier !== "standard",
    vendorName: row.vendor_business_name || row.vendor_name,
    circleId: null,
  };
}
