import { db } from "./db/index.js";
import { irelandTodayIso } from "./irelandTime.js";

// Trust & Retention — who may review what, and on what evidence (rule
// tightened 2026-10-28, batch 1 follow-up; docs/trust-retention/04-*).
//
// A public review is about one occurrence the reviewer personally attended:
// a booking, club registration, programme enrolment, experience booking or a
// place in a Session. It is open only when the occurrence has happened (date
// before today, Ireland time), wasn't cancelled, and an authorised organiser
// has confirmed that *this person* attended:
//
//   Sessions   a place belongs to one signed-in resident, so the host's
//              attendance record for that place (attendance kind 'game') is a
//              person-level confirmation. An accepted correction writes the
//              same record.
//   Everything else — hall bookings, club registrations, programme places,
//              experience bookings. The data can't tie the account holder to
//              who walked in: participant names are free text, registrations
//              are often for a child, a hall booking is an event, group seats
//              are just names. A front-door check-in of the booking therefore
//              confirms the booking, not the reviewer. The reviewer is
//              confirmed only when the organiser accepts their own "I
//              attended" request (attendance_corrections, status 'accepted')
//              for that place — and the place isn't later recorded as a no-show.
//
// Self-declaration alone (self check-in, "Did you attend?") never opens a
// review. Every new review is therefore person-confirmed, and its "Verified
// attendance" label is re-checked live (verifiedSql) so a later correction to
// a no-show removes it. Reviews written before this rule (no occurrence, or an
// older 'booking'/'self_reported' basis) stay visible with no label.
//
// A group booking gets at most one review, by the account that holds it, and
// only once that person's own attendance is confirmed. Other people in the
// group have no record we can tie to them, so they can't review it. Hosts
// can't review themselves or their own Sessions; a partner's staff can't
// review their own organisation's listings.

export const REVIEW_SUBJECTS = ["centre", "club", "game", "host", "experience", "program"] as const;
export type ReviewSubject = (typeof REVIEW_SUBJECTS)[number];
export const isReviewSubject = (v: unknown): v is ReviewSubject => typeof v === "string" && (REVIEW_SUBJECTS as readonly string[]).includes(v);

export type AttendanceBasis = "person";
export type OccurrenceKind = "booking" | "registration" | "enrollment" | "experience" | "game";

export const REVIEW_TAGS = ["welcoming_host", "good_organisation", "accurate_description", "good_value"] as const;
export type ReviewTag = (typeof REVIEW_TAGS)[number];
export const cleanTags = (v: unknown): ReviewTag[] => (Array.isArray(v) ? REVIEW_TAGS.filter((t) => (v as unknown[]).includes(t)) : []);

export interface Occurrence {
  kind: OccurrenceKind;
  ref: string;
  date: string;
  label: string;
  basis: AttendanceBasis;
  /** The unique key's "who": one review per booking for booking kinds
   * (only its holder can be confirmed), one per resident for a Session place. */
  authorKey: string;
}

/** A past place the reviewer holds that isn't person-confirmed yet. */
export interface UnconfirmedPlace {
  kind: OccurrenceKind;
  ref: string;
  date: string;
  label: string;
}

export interface Reviewer {
  clientId: string | null;
  residentId: string | null;
  /** A magic-link-verified email: owns the bookings made under it, the same
   * rule "My bookings" uses (bookings.ts GET /mine). */
  email?: string | null;
  /** Vendor/admin session, if any — used for the "own organisation" check. */
  userId?: string | null;
}

export { reviewClaimKey } from "./reviewClaimKey.js";

export const PRESENT = `('present', 'late')`;
export const NO_SHOW = `('absent', 'no_show')`;

/** SQL: an accepted "I attended" request by this person for attendance (kind, ref) that wasn't later overturned by a no-show. */
function personConfirmedSql(kindSql: string, refSql: string): string {
  return `EXISTS (SELECT 1 FROM attendance_corrections c WHERE c.kind = ${kindSql} AND c.ref = ${refSql} AND c.status = 'accepted'
      AND ((c.resident_id IS NOT NULL AND c.resident_id = ?) OR (c.client_id IS NOT NULL AND c.client_id = ?))
      AND NOT EXISTS (SELECT 1 FROM attendance na WHERE na.kind = c.kind AND na.ref = c.ref AND na.status IN ${NO_SHOW}))`;
}

type Row = { ref: string; date: string; label: string; confirmed: number | string };

/**
 * The reviewer's past, uncancelled places for `subject`: those confirmed for
 * them personally (reviewable) and those not (they can ask the organiser).
 */
export async function reviewablePlaces(subject: ReviewSubject, listingId: string, who: Reviewer): Promise<{ confirmed: Occurrence[]; unconfirmed: UnconfirmedPlace[]; guardianPlaces?: number }> {
  const today = irelandTodayIso();
  const meParams = [who.residentId ?? "", who.clientId ?? ""];
  const owner = (col: string) => {
    const parts: string[] = [];
    const params: string[] = [];
    if (who.clientId) (parts.push(`${col}.client_id = ?`), params.push(who.clientId));
    if (who.residentId) (parts.push(`${col}.resident_id = ?`), params.push(who.residentId));
    if (who.email) (parts.push(`LOWER(${col}.email) = LOWER(?)`), params.push(who.email));
    return { sql: parts.length ? `(${parts.join(" OR ")})` : "1 = 0", params };
  };
  const split = (kind: OccurrenceKind, rows: Row[], authorKey: (r: Row) => string) => ({
    confirmed: rows
      .filter((r) => Number(r.confirmed) === 1)
      .map((r) => ({ kind, ref: r.ref, date: String(r.date).slice(0, 10), label: r.label, basis: "person" as const, authorKey: authorKey(r) })),
    unconfirmed: rows.filter((r) => Number(r.confirmed) !== 1).map((r) => ({ kind, ref: r.ref, date: String(r.date).slice(0, 10), label: r.label })),
  });

  if (subject === "centre") {
    const o = owner("b");
    const rows = (await db
      .prepare(
        `SELECT b.ref, b.date, CONCAT('Booking on ', b.date) as label, ${personConfirmedSql("'booking'", "b.ref")} as confirmed
         FROM bookings b WHERE b.centre_id = ? AND ${o.sql} AND b.payment_status = 'paid' AND b.status != 'cancelled' AND b.date < ?
         ORDER BY b.date DESC LIMIT 50`
      )
      .all(...meParams, listingId, ...o.params, today)) as Row[];
    return split("booking", rows, () => "booking");
  }
  if (subject === "club") {
    // An ongoing registration: dated by when the club confirmed the person.
    const o = owner("r");
    const rows = (await db
      .prepare(
        `SELECT r.ref, COALESCE((SELECT DATE_FORMAT(MAX(c.decided_at), '%Y-%m-%d') FROM attendance_corrections c WHERE c.kind = 'registration' AND c.ref = r.ref AND c.status = 'accepted'), DATE_FORMAT(r.created_at, '%Y-%m-%d')) as date,
                'Club registration' as label, ${personConfirmedSql("'registration'", "r.ref")} as confirmed
         FROM registrations r WHERE r.club_id = ? AND ${o.sql} AND r.payment_status = 'paid' AND r.status != 'cancelled'
           AND r.registrant_type = 'adult'
         ORDER BY r.created_at DESC LIMIT 50`
      )
      .all(...meParams, listingId, ...o.params)) as Row[];
    // A child's registration (registrant_type 'child', the default) is held by
    // a parent or guardian who didn't take part themselves: it never opens a
    // personal review, whatever the club records about the child. Guardian
    // feedback on a club is a separate policy that doesn't exist yet.
    const guardian = (await db
      .prepare(`SELECT COUNT(*) as n FROM registrations r WHERE r.club_id = ? AND ${o.sql} AND r.payment_status = 'paid' AND r.status != 'cancelled' AND r.registrant_type != 'adult'`)
      .get(listingId, ...o.params)) as { n: number };
    return { ...split("registration", rows, () => "booking"), guardianPlaces: Number(guardian.n) };
  }
  if (subject === "program") {
    // Confirmed when the organiser accepted the person's request for at least
    // one past, uncancelled session of this enrolment.
    const o = owner("pe");
    const rows = (await db
      .prepare(
        `SELECT pe.ref, COALESCE(MAX(CASE WHEN ${personConfirmedSql("'program_session'", "CONCAT(ps.id, ':', pe.id)")} THEN ps.date END), MAX(ps.date)) as date,
                'Programme place' as label,
                MAX(${personConfirmedSql("'program_session'", "CONCAT(ps.id, ':', pe.id)")}) as confirmed
         FROM program_enrollments pe
         JOIN program_sessions ps ON ps.program_id = pe.program_id AND ps.status != 'cancelled' AND ps.date < ?
         WHERE pe.program_id = ? AND ${o.sql} AND pe.payment_status = 'paid' AND pe.status != 'cancelled'
         GROUP BY pe.ref ORDER BY date DESC LIMIT 50`
      )
      .all(...meParams, ...meParams, today, listingId, ...o.params)) as Row[];
    return split("enrollment", rows, () => "booking");
  }
  if (subject === "experience") {
    const o = owner("eb");
    const rows = (await db
      .prepare(
        `SELECT eb.ref, es.date, CONCAT('Booking on ', es.date) as label, ${personConfirmedSql("'experience'", "eb.ref")} as confirmed
         FROM experience_bookings eb JOIN experience_sessions es ON es.id = eb.session_id
         WHERE eb.experience_id = ? AND ${o.sql} AND eb.payment_status = 'paid' AND COALESCE(eb.status, '') != 'cancelled' AND es.status != 'cancelled' AND es.date < ?
         ORDER BY es.date DESC LIMIT 50`
      )
      .all(...meParams, listingId, ...o.params, today)) as Row[];
    return split("experience", rows, () => "booking");
  }
  // game / host — the host's record of this resident's own place.
  if (!who.residentId) return { confirmed: [], unconfirmed: [] };
  const where = subject === "game" ? "g.id = ?" : "g.host_resident_id = ?";
  const rows = (await db
    .prepare(
      `SELECT g.id as ref, g.date, CONCAT(g.activity_label, ' on ', g.date) as label,
              EXISTS (SELECT 1 FROM attendance a WHERE a.kind = 'game' AND a.ref = CONCAT(g.id, ':', gp.resident_id) AND a.status IN ${PRESENT}) as confirmed
       FROM game_participants gp JOIN games g ON g.id = gp.game_id
       WHERE ${where} AND gp.resident_id = ? AND gp.status = 'joined' AND g.host_resident_id != gp.resident_id
         AND g.status != 'cancelled' AND g.date < ?
         AND NOT EXISTS (SELECT 1 FROM attendance x WHERE x.kind = 'game' AND x.ref = CONCAT(g.id, ':', gp.resident_id) AND x.status IN ${NO_SHOW})
       ORDER BY g.date DESC LIMIT 50`
    )
    .all(listingId, who.residentId, today)) as Row[];
  return split("game", rows, () => who.residentId!);
}

/** Back-compat: the reviewable (person-confirmed) occurrences only. */
export async function reviewableOccurrences(subject: ReviewSubject, listingId: string, who: Reviewer): Promise<Occurrence[]> {
  return (await reviewablePlaces(subject, listingId, who)).confirmed;
}

/**
 * SQL boolean for a stored review (alias `r`): its occurrence is still
 * confirmed for its author right now. Older reviews (no occurrence) → 0.
 * Used for the public label and to decide whether the author may edit.
 */
export function verifiedSql(r = "r"): string {
  const me = `((c.resident_id IS NOT NULL AND c.resident_id = ${r}.resident_id) OR (c.client_id IS NOT NULL AND c.client_id = ${r}.client_id))`;
  // Revoked (a later no-show) or disputed (an open request about the same
  // place) attendance removes the label until it's settled.
  const notOverturned = `NOT EXISTS (SELECT 1 FROM attendance na WHERE na.kind = c.kind AND na.ref = c.ref AND na.status IN ${NO_SHOW})
      AND NOT EXISTS (SELECT 1 FROM attendance_corrections oc WHERE oc.kind = c.kind AND oc.ref = c.ref AND oc.status = 'open')`;
  return `(CASE
    WHEN ${r}.occurrence_kind = 'game' THEN EXISTS (SELECT 1 FROM attendance a WHERE a.kind = 'game' AND a.ref = CONCAT(${r}.occurrence_ref, ':', ${r}.resident_id) AND a.status IN ${PRESENT}
         AND NOT EXISTS (SELECT 1 FROM attendance_corrections oc WHERE oc.kind = 'game' AND oc.ref = a.ref AND oc.status = 'open'))
    WHEN ${r}.occurrence_kind = 'enrollment' THEN EXISTS (SELECT 1 FROM program_enrollments pe JOIN attendance_corrections c ON c.kind = 'program_session' AND SUBSTRING_INDEX(c.ref, ':', -1) = CAST(pe.id AS CHAR) AND c.status = 'accepted'
         WHERE pe.ref = ${r}.occurrence_ref AND ${me} AND ${notOverturned})
    WHEN ${r}.occurrence_kind = 'registration' AND NOT EXISTS (SELECT 1 FROM registrations rg WHERE rg.ref = ${r}.occurrence_ref AND rg.registrant_type = 'adult') THEN 0
    WHEN ${r}.occurrence_kind IN ('booking', 'registration', 'experience') THEN EXISTS (SELECT 1 FROM attendance_corrections c WHERE c.kind = ${r}.occurrence_kind AND c.ref = ${r}.occurrence_ref AND c.status = 'accepted' AND ${me} AND ${notOverturned})
    ELSE 0 END)`;
}

/** True when the reviewer runs the thing being reviewed (no self-reviews). */
export async function reviewsOwnSubject(subject: ReviewSubject, listingId: string, who: Reviewer): Promise<boolean> {
  if (subject === "host") return !!who.residentId && who.residentId === listingId;
  if (subject === "game") {
    if (!who.residentId) return false;
    return !!(await db.prepare(`SELECT 1 FROM games WHERE id = ? AND host_resident_id = ?`).get(listingId, who.residentId));
  }
  const table = subject === "centre" ? "centres" : subject === "club" ? "clubs" : subject === "experience" ? "experiences" : "programs";
  const row = (await db.prepare(`SELECT vendor_id as vendorId FROM ${table} WHERE id = ?`).get(listingId)) as { vendorId: string | null } | undefined;
  if (!row?.vendorId) return false;
  // Every account in the owning organisation, and any resident linked to one.
  const team = (await db
    .prepare(`SELECT u.id, u.resident_id as residentId FROM users u WHERE u.id = ? OR (u.org_id IS NOT NULL AND u.org_id = (SELECT org_id FROM users WHERE id = ?))`)
    .all(row.vendorId, row.vendorId)) as { id: string; residentId: string | null }[];
  return team.some((m) => (who.userId && m.id === who.userId) || (who.residentId && m.residentId === who.residentId));
}

export interface ReviewSummary {
  average: number | null;
  count: number;
  /** Index 0 = 1 star … index 4 = 5 stars. */
  distribution: [number, number, number, number, number];
}

/** Live from visible reviews only, so edits, deletions and moderation show at once. */
export async function reviewSummary(subject: string, listingId: string): Promise<ReviewSummary> {
  const rows = (await db
    .prepare(`SELECT rating, COUNT(*) as n FROM reviews WHERE listing_type = ? AND listing_id = ? AND hidden = 0 GROUP BY rating`)
    .all(subject, listingId)) as { rating: number; n: number }[];
  const distribution: [number, number, number, number, number] = [0, 0, 0, 0, 0];
  let count = 0;
  let total = 0;
  for (const r of rows) {
    const stars = Number(r.rating);
    const n = Number(r.n);
    if (stars >= 1 && stars <= 5) {
      distribution[stars - 1] += n;
      count += n;
      total += stars * n;
    }
  }
  return { average: count ? Math.round((total / count) * 10) / 10 : null, count, distribution };
}
