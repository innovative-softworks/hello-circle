import { db } from "./db/index.js";
import { experienceHref } from "./participation/eventsVisibility.js";
import { gameSeatSql, occupiesCapacitySql } from "./bookingIntegrity.js";
import { canViewGame } from "./gameVisibility.js";
import { orgActiveSql } from "./orgSql.js";
import { irelandTodayIso } from "./irelandTime.js";
import { venuePagesPublic } from "./venueLaunch.js";

// Circles 3.0 — a Circle plan can point at a real HelloCircle listing
// (docs/circles-3.0/02-unified-circle-plans-architecture.md). The plan only
// *references* it: no copy of the listing, no price, no capacity, no booking.
// The listing's own page and booking flow stay the only place anyone books;
// everything here is read live, through the same visibility rules the
// listing's public page uses, so a cancelled, unpublished or suspended
// listing reads as unavailable the moment it changes.

export const PLAN_LISTING_TYPES = ["game", "experience", "program", "centre", "club"] as const;
export type PlanListingType = (typeof PLAN_LISTING_TYPES)[number];
export const isPlanListingType = (v: unknown): v is PlanListingType => typeof v === "string" && (PLAN_LISTING_TYPES as readonly string[]).includes(v);

/** What a member sees for the listing behind a plan. */
export interface PlanListing {
  type: PlanListingType;
  /** activity | adventure | experience | volunteer | programme | venue | club */
  kind: string;
  id: string;
  sessionId: string | null;
  title: string;
  imageUrl: string | null;
  date: string | null;
  time: string | null;
  where: string | null;
  priceCents: number | null;
  /** Null when the page can't be opened (venue pages still "Coming soon"). */
  href: string | null;
  /** no_dates: still listed, but nothing scheduled yet (not the same as gone). */
  availability: "available" | "full" | "past" | "cancelled" | "unavailable" | "no_dates";
  /** Places left right now (the listing page is the authority). */
  spotsLeft: number | null;
  /** The viewer's own booking state on this listing, read from the booking tables. */
  myState: "booked" | "waitlisted" | null;
  /** Programmes are enrolled as a whole, even when the plan is for one session. */
  bookingNote: string | null;
  /** True when the listing can only be seen by some people (a private activity). */
  restricted: boolean;
}

export interface PlanListingRef {
  type: PlanListingType;
  id: string;
  sessionId?: string | null;
}

const unavailable = (ref: PlanListingRef, kind: string): PlanListing => ({
  type: ref.type,
  kind,
  id: ref.id,
  sessionId: ref.sessionId ?? null,
  title: "",
  imageUrl: null,
  date: null,
  time: null,
  where: null,
  priceCents: null,
  href: null,
  availability: "unavailable",
  spotsLeft: null,
  myState: null,
  bookingNote: null,
  restricted: false,
});

const KIND_FOR_TYPE: Record<PlanListingType, string> = { game: "activity", experience: "experience", program: "programme", centre: "venue", club: "club" };

/** Resolves a listing reference for `viewerId`. Never throws for a missing
 * or hidden listing: it reads as "unavailable" with no details, so a plan
 * can't be used to discover anything about a listing its viewer can't see. */
export async function resolvePlanListing(ref: PlanListingRef, viewerId: string | null): Promise<PlanListing> {
  const today = irelandTodayIso();

  if (ref.type === "game") {
    const g = (await db
      .prepare(
        `SELECT g.id, g.activity_label as title, g.date, g.time, g.status, g.capacity, g.price_cents as priceCents, g.image_url as imageUrl,
                g.location_text as locationText, g.visibility, g.circle_id, g.host_resident_id, g.lifecycle, g.publish_at, g.booking_open_at, g.booking_close_at,
                c.name as centreName,
                (SELECT COUNT(*) FROM game_participants gp WHERE gp.game_id = g.id AND ${gameSeatSql("gp")}) as taken
         FROM games g LEFT JOIN centres c ON c.id = g.centre_id WHERE g.id = ?`
      )
      .get(ref.id)) as
      | { id: string; title: string; date: string; time: string; status: string; capacity: number; priceCents: number | null; imageUrl: string | null; locationText: string; visibility: string; circle_id: string | null; host_resident_id: string; lifecycle: string; publish_at: string | null; booking_open_at: string | null; booking_close_at: string | null; centreName: string | null; taken: number }
      | undefined;
    if (!g || !(await canViewGame(g as never, viewerId))) return unavailable(ref, "activity");
    const spotsLeft = Math.max(0, g.capacity - Number(g.taken));
    let myState: PlanListing["myState"] = null;
    if (viewerId) {
      const joined = await db.prepare(`SELECT 1 FROM game_participants gp WHERE gp.game_id = ? AND gp.resident_id = ? AND ${gameSeatSql("gp")}`).get(g.id, viewerId);
      const waiting = joined ? null : await db.prepare(`SELECT 1 FROM waitlist_entries WHERE listing_type = 'game' AND listing_id = ? AND resident_id = ? AND status IN ('waiting', 'offered')`).get(g.id, viewerId);
      myState = joined ? "booked" : waiting ? "waitlisted" : null;
    }
    return {
      type: "game",
      kind: "activity",
      id: g.id,
      sessionId: null,
      title: g.title,
      imageUrl: g.imageUrl || null,
      date: g.date,
      time: g.time,
      where: g.centreName ?? (g.locationText || null),
      priceCents: g.priceCents,
      href: `/games/${g.id}`,
      availability: g.status === "cancelled" ? "cancelled" : g.date < today ? "past" : spotsLeft === 0 ? "full" : "available",
      spotsLeft,
      myState,
      bookingNote: null,
      restricted: g.visibility !== "public",
    };
  }

  if (ref.type === "experience") {
    const e = (await db
      .prepare(
        `SELECT id, slug, kind, title, image_url as imageUrl, price_cents as priceCents, capacity, meeting_point as meetingPoint, area, county
         FROM experiences WHERE id = ? AND status = 'approved' AND ${orgActiveSql("vendor_id")}`
      )
      .get(ref.id)) as { id: string; slug: string | null; kind: string; title: string; imageUrl: string | null; priceCents: number | null; capacity: number; meetingPoint: string; area: string; county: string } | undefined;
    if (!e) return unavailable(ref, "experience");
    const base = experienceHref(e.kind, e.slug ?? e.id);
    const where = e.meetingPoint || [e.area, e.county].filter(Boolean).join(", ") || null;
    let date: string | null = null;
    let time: string | null = null;
    let availability: PlanListing["availability"] = "available";
    let spotsLeft: number | null = null;
    if (ref.sessionId) {
      const s = (await db
        .prepare(`SELECT id, date, time, capacity, status FROM experience_sessions WHERE id = ? AND experience_id = ?`)
        .get(ref.sessionId, e.id)) as { id: string; date: string; time: string; capacity: number | null; status: string } | undefined;
      if (!s) return unavailable(ref, e.kind);
      const { n } = (await db.prepare(`SELECT COALESCE(SUM(party_size), 0) as n FROM experience_bookings eb WHERE eb.session_id = ? AND ${occupiesCapacitySql("eb")}`).get(s.id)) as { n: number };
      spotsLeft = Math.max(0, (s.capacity ?? e.capacity) - Number(n));
      date = s.date;
      time = s.time;
      availability = s.status === "cancelled" ? "cancelled" : s.date < today ? "past" : s.status !== "scheduled" ? "unavailable" : spotsLeft === 0 ? "full" : "available";
    } else {
      const next = (await db.prepare(`SELECT 1 FROM experience_sessions WHERE experience_id = ? AND status = 'scheduled' AND date >= ? LIMIT 1`).get(e.id, today)) as unknown;
      if (!next) availability = "no_dates";
    }
    let myState: PlanListing["myState"] = null;
    if (viewerId) {
      const mine = await db
        .prepare(`SELECT 1 FROM experience_bookings eb WHERE eb.resident_id = ? AND eb.experience_id = ? AND eb.status != 'cancelled' AND eb.payment_status = 'paid'${ref.sessionId ? " AND eb.session_id = ?" : ""}`)
        .get(...(ref.sessionId ? [viewerId, e.id, ref.sessionId] : [viewerId, e.id]));
      myState = mine ? "booked" : null;
    }
    return { type: "experience", kind: e.kind, id: e.id, sessionId: ref.sessionId ?? null, title: e.title, imageUrl: e.imageUrl || null, date, time, where, priceCents: e.priceCents, href: base, availability, spotsLeft, myState, bookingNote: null, restricted: false };
  }

  if (ref.type === "program") {
    const p = (await db
      .prepare(
        `SELECT p.id, p.title, p.image_url as imageUrl, p.price_cents as priceCents, p.capacity, p.listing_type as listingType, p.listing_id as listingId,
                (SELECT COUNT(*) FROM program_enrollments pe WHERE pe.program_id = p.id AND ${occupiesCapacitySql("pe")}) as enrolled
         FROM programs p WHERE p.id = ? AND p.status = 'published' AND ${orgActiveSql("p.vendor_id")}`
      )
      .get(ref.id)) as { id: string; title: string; imageUrl: string | null; priceCents: number | null; capacity: number | null; listingType: string; listingId: string; enrolled: number } | undefined;
    if (!p) return unavailable(ref, "programme");
    const venue = (await db.prepare(`SELECT name FROM ${p.listingType === "centre" ? "centres" : "clubs"} WHERE id = ?`).get(p.listingId)) as { name: string } | undefined;
    const spotsLeft = p.capacity !== null ? Math.max(0, p.capacity - Number(p.enrolled)) : null;
    let date: string | null = null;
    let time: string | null = null;
    let availability: PlanListing["availability"] = spotsLeft === 0 ? "full" : "available";
    if (ref.sessionId) {
      const s = (await db.prepare(`SELECT date, time, status FROM program_sessions WHERE id = ? AND program_id = ?`).get(ref.sessionId, p.id)) as { date: string; time: string; status: string } | undefined;
      if (!s) return unavailable(ref, "programme");
      date = s.date;
      time = s.time;
      if (s.status === "cancelled") availability = "cancelled";
      else if (s.date < today) availability = "past";
    } else {
      const first = (await db.prepare(`SELECT date, time FROM program_sessions WHERE program_id = ? AND status != 'cancelled' AND date >= ? ORDER BY date, time LIMIT 1`).get(p.id, today)) as { date: string; time: string } | undefined;
      if (!first) availability = "no_dates";
      else {
        date = first.date;
        time = first.time;
      }
    }
    let myState: PlanListing["myState"] = null;
    if (viewerId) {
      const mine = await db.prepare(`SELECT 1 FROM program_enrollments pe WHERE pe.program_id = ? AND pe.resident_id = ? AND pe.status != 'cancelled' AND pe.payment_status = 'paid'`).get(p.id, viewerId);
      myState = mine ? "booked" : null;
    }
    return {
      type: "program",
      kind: "programme",
      id: p.id,
      sessionId: ref.sessionId ?? null,
      title: p.title,
      imageUrl: p.imageUrl || null,
      date,
      time,
      where: venue?.name ?? null,
      priceCents: p.priceCents,
      href: `/programs/${p.id}`,
      availability,
      spotsLeft,
      myState,
      bookingNote: ref.sessionId ? "Enrolment is for the whole programme, not one session." : null,
      restricted: false,
    };
  }

  // centre / club — a place to meet. Never claims availability or a booking:
  // the plan names the venue; booking a room stays a separate step.
  const table = ref.type === "centre" ? "centres" : "clubs";
  const v = (await db.prepare(`SELECT id, slug, name, image_url as imageUrl, area, county FROM ${table} WHERE (id = ? OR slug = ?) AND status = 'approved' AND ${orgActiveSql("vendor_id")}`).get(ref.id, ref.id)) as
    | { id: string; slug: string | null; name: string; imageUrl: string | null; area: string; county: string }
    | undefined;
  if (!v) return unavailable(ref, KIND_FOR_TYPE[ref.type]);
  return {
    type: ref.type,
    kind: KIND_FOR_TYPE[ref.type],
    id: v.id,
    sessionId: null,
    title: v.name,
    imageUrl: v.imageUrl || null,
    date: null,
    time: null,
    where: [v.area, v.county].filter(Boolean).join(", ") || null,
    priceCents: null,
    // Venue pages are still "Coming soon" unless launched: no link to a gated page.
    href: venuePagesPublic() ? `/${table}/${v.slug ?? v.id}` : null,
    availability: "available",
    spotsLeft: null,
    myState: null,
    bookingNote: "Meeting here doesn't book a room. The organiser books separately if one is needed.",
    restricted: false,
  };
}

/** Validates a reference sent by a client: shape only (the resolver decides visibility). */
export function cleanListingRef(raw: unknown): PlanListingRef | { error: string } | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "object") return { error: "listing must be an object" };
  const r = raw as { type?: unknown; id?: unknown; sessionId?: unknown };
  if (!isPlanListingType(r.type)) return { error: `listing.type must be one of ${PLAN_LISTING_TYPES.join(", ")}` };
  if (typeof r.id !== "string" || !r.id || r.id.length > 191) return { error: "listing.id is required" };
  if (r.sessionId !== undefined && r.sessionId !== null && (typeof r.sessionId !== "string" || r.sessionId.length > 191)) return { error: "listing.sessionId is invalid" };
  if (r.sessionId && r.type !== "experience" && r.type !== "program") return { error: "Only experiences and programmes have sessions" };
  return { type: r.type, id: r.id, sessionId: (r.sessionId as string | undefined) || null };
}
