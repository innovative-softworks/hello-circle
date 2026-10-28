import { Router, type Request } from "express";
import { experienceHref } from "./participation/eventsVisibility.js";
import { db } from "./db/index.js";
import { gameSeatSql, occupiesCapacitySql } from "./bookingIntegrity.js";
import { canViewGame, getEffectiveGameLifecycle, type GameVisibilityRow } from "./gameVisibility.js";
import { irelandTodayIso } from "./irelandTime.js";
import { arrangePlans, planPhase, planTiming, STATUS_LABEL, type PlanPhase, type PlanStatus, type PlanTiming } from "./myLifePlanRules.js";
import { notifyResident, residentAllows } from "./notifications.js";
import { orgActiveSql } from "./orgSql.js";
import { reviewClaimKey, reviewablePlaces, type ReviewSubject } from "./reviewEligibility.js";
import { clientIdFrom } from "./util.js";

// Trust & Retention — My Life "Your next plan" journey (docs/trust-retention/06-*):
// next plan → prepare → attend → attendance confirmed → review → go again /
// follow. Everything is read from the person's own authorised records
// (bookings, experience bookings, programme places, joined Sessions, waitlists,
// join requests, Circle-plan interest); nothing is inferred. Review invitations
// are one in-app notification per confirmed occurrence, sent only after it
// ends, re-checked when sent, gated by the resident's "reviewInvites"
// preference, and never re-sent.

type Who = { residentId: string | null; clientId: string | null; email: string | null };

function who(req: Request): Who {
  let clientId: string | null = null;
  try {
    clientId = clientIdFrom(req);
  } catch {
    clientId = null;
  }
  return { residentId: req.resident?.id ?? null, clientId, email: req.guestEmail ?? null };
}

function owns(alias: string, w: Who) {
  const parts: string[] = [];
  const params: string[] = [];
  if (w.clientId) (parts.push(`${alias}.client_id = ?`), params.push(w.clientId));
  if (w.residentId) (parts.push(`${alias}.resident_id = ?`), params.push(w.residentId));
  if (w.email) (parts.push(`LOWER(${alias}.email) = LOWER(?)`), params.push(w.email));
  return { sql: parts.length ? `(${parts.join(" OR ")})` : "1 = 0", params };
}

export type PlaceKind = "booking" | "experience" | "program" | "game" | "interest";

export interface Plan {
  key: string;
  placeKind: PlaceKind;
  ref: string;
  title: string;
  date: string;
  time: string | null;
  durationMinutes: number | null;
  status: PlanStatus;
  statusLabel: string;
  location: string | null;
  organiser: string | null;
  /** Where the full booking/participation details live. */
  href: string;
  listingHref: string | null;
  circleName: string | null;
  /** The activity's own photo (or its venue's / Circle's); null → the client shows the activity icon. */
  imageUrl: string | null;
  /** For the icon when there's no photo. */
  activityLabel: string;
  prep: { meeting: string | null; arrival: string | null; welcome: string | null; bring: string | null };
  /** Where to ask a question — never a phone number or email. */
  contact: { label: string; href: string } | null;
  timing: PlanTiming;
  /** Internal: what the follow-ups need. */
  listing: { type: ReviewSubject; id: string };
  followTarget: { type: "host" | "vendor" | "centre"; id: string; name: string | null } | null;
  seriesId?: string | null;
  experienceId?: string;
}

const pendingFresh = "created_at > NOW() - INTERVAL 30 MINUTE";

async function loadPlans(w: Who, from: string, to: string): Promise<Plan[]> {
  const out: Plan[] = [];
  const blank = { meeting: null, arrival: null, welcome: null, bring: null };

  // Hall bookings (paid, or a live checkout hold).
  {
    const o = owns("b", w);
    const rows = (await db
      .prepare(
        `SELECT b.ref, b.date, b.time, b.duration, b.status, b.payment_status as paymentStatus, (b.${pendingFresh}) as fresh,
                c.id as centreId, c.name, c.area, c.newcomer_welcome as welcome, c.image_url as imageUrl
         FROM bookings b JOIN centres c ON c.id = b.centre_id
         WHERE ${o.sql} AND b.date >= ? AND b.date <= ? AND (b.payment_status IN ('paid', 'refunded') OR b.payment_status = 'pending')`
      )
      .all(...o.params, from, to)) as any[];
    for (const r of rows) {
      const status: PlanStatus | null =
        r.status === "cancelled" ? "cancelled" : r.paymentStatus === "paid" ? "confirmed" : r.paymentStatus === "pending" && Number(r.fresh) === 1 ? "pending_payment" : null;
      if (!status) continue;
      out.push({
        key: `booking:${r.ref}`, placeKind: "booking", ref: r.ref, title: r.name, date: String(r.date).slice(0, 10), time: r.time, durationMinutes: r.duration ? Number(r.duration) * 60 : null,
        status, statusLabel: STATUS_LABEL[status], location: [r.name, r.area].filter(Boolean).join(", "), organiser: r.name,
        href: `/bookings/booking/${r.ref}`, listingHref: `/centres/${r.centreId}`, circleName: null, imageUrl: r.imageUrl || null, activityLabel: r.name,
        prep: { ...blank, welcome: r.welcome ?? null }, contact: { label: "Contact the venue from your booking", href: `/bookings/booking/${r.ref}` },
        timing: planTiming(String(r.date), r.time, r.duration ? Number(r.duration) * 60 : null), listing: { type: "centre", id: r.centreId },
        followTarget: { type: "centre", id: r.centreId, name: r.name },
      });
    }
  }

  // Experience bookings.
  {
    const o = owns("eb", w);
    const rows = (await db
      .prepare(
        `SELECT eb.ref, eb.status, eb.payment_status as paymentStatus, (eb.${pendingFresh}) as fresh, es.date, es.time, es.status as sessionStatus,
                e.id as experienceId, e.title, e.kind, e.area, e.meeting_point as meeting, e.equipment_required as bring, e.duration_minutes as duration,
                e.newcomer_welcome as welcome, e.vendor_id as vendorId, e.image_url as imageUrl, COALESCE(NULLIF(u.business_name, ''), u.name) as vendorName
         FROM experience_bookings eb JOIN experience_sessions es ON es.id = eb.session_id JOIN experiences e ON e.id = eb.experience_id LEFT JOIN users u ON u.id = e.vendor_id
         WHERE ${o.sql} AND es.date >= ? AND es.date <= ? AND eb.payment_status IN ('paid', 'refunded', 'pending')`
      )
      .all(...o.params, from, to)) as any[];
    for (const r of rows) {
      const cancelled = r.status === "cancelled" || r.sessionStatus === "cancelled";
      const status: PlanStatus | null = cancelled ? "cancelled" : r.paymentStatus === "paid" ? "confirmed" : r.paymentStatus === "pending" && Number(r.fresh) === 1 ? "pending_payment" : null;
      if (!status) continue;
      const base = r.kind === "adventure" ? "adventures" : r.kind === "event" ? "events" : "experiences";
      out.push({
        key: `experience:${r.ref}`, placeKind: "experience", ref: r.ref, title: r.title, date: String(r.date).slice(0, 10), time: r.time, durationMinutes: r.duration ? Number(r.duration) : null,
        status, statusLabel: STATUS_LABEL[status], location: r.meeting || r.area || null, organiser: r.vendorName ?? null,
        href: `/bookings/experience/${r.ref}`, listingHref: `/${base}/${r.experienceId}`, circleName: null, imageUrl: r.imageUrl || null, activityLabel: r.title,
        prep: { meeting: r.meeting ?? null, arrival: null, welcome: r.welcome ?? null, bring: r.bring ?? null },
        contact: { label: "Message the organiser from the listing", href: `/${base}/${r.experienceId}` },
        timing: planTiming(String(r.date), r.time, r.duration ? Number(r.duration) : null), listing: { type: "experience", id: r.experienceId },
        followTarget: r.vendorId ? { type: "vendor", id: r.vendorId, name: r.vendorName ?? null } : null, experienceId: r.experienceId,
      });
    }
  }

  // Programme places: one plan per session in the window.
  {
    const o = owns("pe", w);
    const rows = (await db
      .prepare(
        `SELECT pe.ref, pe.status, pe.payment_status as paymentStatus, ps.id as sessionId, ps.date, ps.time, ps.duration_minutes as duration, ps.status as sessionStatus,
                p.id as programId, p.title, p.image_url as imageUrl, p.arrival_instructions as arrival, p.newcomer_welcome as welcome, p.equipment, p.vendor_id as vendorId,
                COALESCE(NULLIF(u.business_name, ''), u.name) as vendorName
         FROM program_enrollments pe JOIN programs p ON p.id = pe.program_id JOIN program_sessions ps ON ps.program_id = p.id LEFT JOIN users u ON u.id = p.vendor_id
         WHERE ${o.sql} AND ps.date >= ? AND ps.date <= ? AND pe.payment_status IN ('paid', 'refunded')`
      )
      .all(...o.params, from, to)) as any[];
    for (const r of rows) {
      const status: PlanStatus = r.status === "cancelled" || r.sessionStatus === "cancelled" ? "cancelled" : "confirmed";
      let bring: string | null = null;
      try {
        const list = r.equipment ? (JSON.parse(r.equipment) as string[]) : [];
        bring = Array.isArray(list) && list.length ? list.join(", ") : null;
      } catch {
        bring = typeof r.equipment === "string" && r.equipment.trim() ? r.equipment : null;
      }
      out.push({
        key: `program:${r.ref}:${r.sessionId}`, placeKind: "program", ref: r.ref, title: r.title, date: String(r.date).slice(0, 10), time: r.time, durationMinutes: r.duration ? Number(r.duration) : null,
        status, statusLabel: STATUS_LABEL[status], location: null, organiser: r.vendorName ?? null,
        href: `/bookings/program/${r.ref}`, listingHref: `/programs/${r.programId}`, circleName: null, imageUrl: r.imageUrl || null, activityLabel: r.title,
        prep: { meeting: null, arrival: r.arrival ?? null, welcome: r.welcome ?? null, bring },
        contact: { label: "Ask the organiser from the programme page", href: `/programs/${r.programId}` },
        timing: planTiming(String(r.date), r.time, r.duration ? Number(r.duration) : null), listing: { type: "program", id: r.programId },
        followTarget: r.vendorId ? { type: "vendor", id: r.vendorId, name: r.vendorName ?? null } : null,
      });
    }
  }

  if (w.residentId) {
    // Sessions you've joined (or are holding / asked to join / waiting for).
    const rows = (await db
      .prepare(
        `SELECT g.id, g.activity_label as title, g.date, g.time, g.duration_minutes as duration, g.status as gameStatus, g.price_cents as priceCents, g.series_id as seriesId,
                g.meeting_instructions as meeting, g.equipment_needed as bring, g.newcomer_welcome as welcome, g.location_text as locationText, g.host_resident_id as hostId,
                c.name as centreName, r.name as hostName, ci.name as circleName,
                COALESCE(NULLIF(g.image_url, ''), NULLIF(ci.image_url, ''), NULLIF(c.image_url, '')) as imageUrl,
                gp.status as joinStatus, (${gameSeatSql("gp")}) as seat
         FROM game_participants gp JOIN games g ON g.id = gp.game_id LEFT JOIN centres c ON c.id = g.centre_id
         LEFT JOIN residents r ON r.id = g.host_resident_id LEFT JOIN circles ci ON ci.id = g.circle_id
         WHERE gp.resident_id = ? AND g.date >= ? AND g.date <= ? AND gp.status IN ('joined', 'pending_payment')`
      )
      .all(w.residentId, from, to)) as any[];
    const game = (r: any, status: PlanStatus): Plan => ({
      key: `game:${r.id}`, placeKind: "game", ref: r.id, title: r.title, date: String(r.date).slice(0, 10), time: r.time, durationMinutes: r.duration ? Number(r.duration) : null,
      status, statusLabel: STATUS_LABEL[status], location: r.centreName ?? (r.locationText || null), organiser: r.hostName ?? null,
      href: `/bookings/game/${r.id}`, listingHref: `/games/${r.id}`, circleName: r.circleName ?? null, imageUrl: r.imageUrl || null, activityLabel: r.title,
      // Meeting instructions are only shown to joined participants (games.ts); a waitlist/request doesn't see them.
      prep: { meeting: status === "confirmed" || status === "rsvp" ? r.meeting ?? null : null, arrival: null, welcome: r.welcome ?? null, bring: r.bring ?? null },
      contact: status === "confirmed" || status === "rsvp" ? { label: "Message the host in the activity chat", href: `/games/${r.id}` } : null,
      timing: planTiming(String(r.date), r.time, r.duration ? Number(r.duration) : null), listing: { type: "game", id: r.id },
      followTarget: r.hostId && r.hostId !== w.residentId ? { type: "host", id: r.hostId, name: r.hostName ?? null } : null, seriesId: r.seriesId ?? null,
    });
    for (const r of rows) {
      if (r.hostId === w.residentId) continue; // your own hosting lives in the host workspace
      const status: PlanStatus | null =
        r.gameStatus === "cancelled" ? "cancelled" : r.joinStatus === "joined" ? (r.circleName && !Number(r.priceCents) ? "rsvp" : "confirmed") : Number(r.seat) === 1 ? "pending_payment" : null;
      if (status) out.push(game(r, status));
    }
    const waiting = (await db
      .prepare(
        `SELECT g.id, g.activity_label as title, g.date, g.time, g.duration_minutes as duration, g.status as gameStatus, g.price_cents as priceCents, g.series_id as seriesId,
                g.meeting_instructions as meeting, g.equipment_needed as bring, g.newcomer_welcome as welcome, g.location_text as locationText, g.host_resident_id as hostId,
                c.name as centreName, r.name as hostName, ci.name as circleName, x.kind,
                COALESCE(NULLIF(g.image_url, ''), NULLIF(ci.image_url, ''), NULLIF(c.image_url, '')) as imageUrl
         FROM (SELECT listing_id as gameId, 'waitlist' as kind FROM waitlist_entries WHERE listing_type = 'game' AND resident_id = ? AND status IN ('waiting', 'offered')
               UNION ALL SELECT game_id, 'request' FROM game_join_requests WHERE resident_id = ? AND status = 'pending') x
         JOIN games g ON g.id = x.gameId LEFT JOIN centres c ON c.id = g.centre_id LEFT JOIN residents r ON r.id = g.host_resident_id LEFT JOIN circles ci ON ci.id = g.circle_id
         WHERE g.date >= ? AND g.date <= ? AND g.status != 'cancelled'`
      )
      .all(w.residentId, w.residentId, from, to)) as any[];
    for (const r of waiting) if (!out.some((p) => p.key === `game:${r.id}`)) out.push(game(r, r.kind === "waitlist" ? "waitlist" : "pending_approval"));

    // Circle plans you're interested in — members only, never a place.
    const interests = (await db
      .prepare(
        `SELECT cp.id, cp.title, cp.proposed_date as date, cp.proposed_time as time, cp.location_text as locationText, c.id as circleId, c.name as circleName, c.slug,
                NULLIF(c.image_url, '') as imageUrl, c.activity_label as activityLabel
         FROM circle_plan_interest i JOIN circle_plans cp ON cp.id = i.plan_id JOIN circles c ON c.id = cp.circle_id
         JOIN circle_members m ON m.circle_id = c.id AND m.resident_id = i.resident_id
         WHERE i.resident_id = ? AND cp.status = 'open' AND c.status = 'active' AND cp.proposed_date IS NOT NULL AND cp.proposed_date >= ? AND cp.proposed_date <= ?`
      )
      .all(w.residentId, from, to)) as any[];
    for (const r of interests) {
      out.push({
        key: `interest:${r.id}`, placeKind: "interest", ref: r.id, title: r.title, date: String(r.date).slice(0, 10), time: r.time || null, durationMinutes: null,
        status: "interest", statusLabel: STATUS_LABEL.interest, location: r.locationText || null, organiser: null,
        href: `/circles/${r.slug ?? r.circleId}`, listingHref: `/circles/${r.slug ?? r.circleId}`, circleName: r.circleName, imageUrl: r.imageUrl || null, activityLabel: r.activityLabel || r.title,
        prep: { meeting: null, arrival: null, welcome: null, bring: null }, contact: null,
        timing: planTiming(String(r.date), r.time || null, null), listing: { type: "game", id: r.id }, followTarget: null,
      });
    }
  }
  return out;
}

// --- after the visit -----------------------------------------------------------

export type VisitState = "review_submitted" | "review_available" | "request_pending" | "declined" | "missed" | "not_confirmed";

async function visitState(p: Plan, w: Who): Promise<VisitState> {
  const me = [w.residentId ?? "", w.clientId ?? ""];
  if (p.placeKind === "game") {
    if (!w.residentId) return "not_confirmed";
    const reviewed = await db.prepare(`SELECT 1 FROM reviews WHERE occurrence_kind = 'game' AND occurrence_ref = ? AND resident_id = ? LIMIT 1`).get(p.ref, w.residentId);
    if (reviewed) return "review_submitted";
    const a = (await db.prepare(`SELECT status FROM attendance WHERE kind = 'game' AND ref = ?`).get(`${p.ref}:${w.residentId}`)) as { status: string } | undefined;
    const req = (await db.prepare(`SELECT status FROM attendance_corrections WHERE kind = 'game' AND ref = ? ORDER BY id DESC LIMIT 1`).get(`${p.ref}:${w.residentId}`)) as { status: string } | undefined;
    if (req?.status === "open") return "request_pending";
    if (a?.status === "present" || a?.status === "late") return "review_available";
    if (a?.status === "no_show" || a?.status === "absent") return "missed";
    return req?.status === "declined" ? "declined" : "not_confirmed";
  }
  const kind = p.placeKind === "program" ? "enrollment" : p.placeKind;
  const reviewed = await db.prepare(`SELECT 1 FROM reviews WHERE occurrence_kind = ? AND occurrence_ref = ? LIMIT 1`).get(kind, p.ref);
  if (reviewed) return "review_submitted";
  const eligible = await reviewablePlaces(p.listing.type, p.listing.id, { residentId: w.residentId, clientId: w.clientId, email: w.email });
  if (eligible.confirmed.some((o) => o.ref === p.ref)) return "review_available";
  const attKind = p.placeKind === "program" ? "program_session" : p.placeKind;
  const refSql = p.placeKind === "program" ? "ref LIKE CONCAT('%:', (SELECT id FROM program_enrollments WHERE ref = ?))" : "ref = ?";
  const req = (await db
    .prepare(`SELECT status FROM attendance_corrections WHERE kind = ? AND ${refSql} AND ((resident_id IS NOT NULL AND resident_id = ?) OR (client_id IS NOT NULL AND client_id = ?)) ORDER BY id DESC LIMIT 1`)
    .get(attKind, p.ref, ...me)) as { status: string } | undefined;
  if (req?.status === "open") return "request_pending";
  if (req?.status === "declined" || req?.status === "withdrawn") return "declined";
  if (p.placeKind !== "program") {
    const a = (await db.prepare(`SELECT status FROM attendance WHERE kind = ? AND ref = ?`).get(attKind, p.ref)) as { status: string } | undefined;
    if (a?.status === "no_show" || a?.status === "absent") return "missed";
  }
  return "not_confirmed";
}

export interface GoAgain {
  kind: "occurrence" | "venue";
  title: string;
  date: string | null;
  time: string | null;
  href: string;
  priceCents: number | null;
  spotsLeft: number | null;
}

/** The next open, visible, bookable occurrence of the *same* series or listing — never guessed from names. */
async function goAgain(p: Plan, w: Who): Promise<GoAgain | null> {
  const today = irelandTodayIso();
  if (p.placeKind === "game" && p.seriesId) {
    const rows = (await db
      .prepare(
        `SELECT g.*, (SELECT COUNT(*) FROM game_participants gp WHERE gp.game_id = g.id AND ${gameSeatSql("gp")}) as taken
         FROM games g WHERE g.series_id = ? AND g.id != ? AND g.date >= ? AND g.status IN ('open', 'pending_participants') ORDER BY g.date, g.time LIMIT 10`
      )
      .all(p.seriesId, p.ref, today)) as (GameVisibilityRow & { activity_label: string; time: string; capacity: number; price_cents: number | null; taken: number })[];
    for (const g of rows) {
      if (getEffectiveGameLifecycle(g) !== "active") continue; // not published, not open for booking, or closed
      if (!(await canViewGame(g, w.residentId))) continue;
      const spotsLeft = Math.max(0, Number(g.capacity) - Number(g.taken));
      if (spotsLeft <= 0) continue;
      return { kind: "occurrence", title: g.activity_label, date: g.date, time: g.time, href: `/games/${g.id}`, priceCents: g.price_cents ?? null, spotsLeft };
    }
    return null;
  }
  if (p.placeKind === "experience" && p.experienceId) {
    const s = (await db
      .prepare(
        `SELECT es.id, es.date, es.time, COALESCE(es.capacity, e.capacity) as cap, e.title, e.price_cents as priceCents, e.kind,
                (SELECT COALESCE(SUM(eb.party_size), 0) FROM experience_bookings eb WHERE eb.session_id = es.id AND ${occupiesCapacitySql("eb")}) as booked
         FROM experience_sessions es JOIN experiences e ON e.id = es.experience_id
         WHERE es.experience_id = ? AND es.status = 'scheduled' AND es.date > ? AND (es.sales_close_at IS NULL OR es.sales_close_at > NOW())
           AND e.status = 'approved' AND ${orgActiveSql("e.vendor_id")}
         ORDER BY es.date, es.time LIMIT 10`
      )
      .all(p.experienceId, today)) as { id: string; date: string; time: string; cap: number | null; title: string; priceCents: number; kind: string; booked: number }[];
    for (const r of s) {
      const left = r.cap == null ? null : Math.max(0, Number(r.cap) - Number(r.booked));
      if (left === 0) continue;
      return { kind: "occurrence", title: r.title, date: r.date, time: r.time, href: experienceHref(r.kind, p.experienceId), priceCents: Number(r.priceCents), spotsLeft: left };
    }
    return null;
  }
  if (p.placeKind === "booking") {
    const c = (await db.prepare(`SELECT id, name FROM centres WHERE id = ? AND status = 'approved' AND ${orgActiveSql("vendor_id")}`).get(p.listing.id)) as { id: string; name: string } | undefined;
    // A hall has no "next date" of its own: book a new time through the normal flow.
    return c ? { kind: "venue", title: c.name, date: null, time: null, href: `/book/${c.id}`, priceCents: null, spotsLeft: null } : null;
  }
  return null;
}

async function isFollowing(w: Who, t: Plan["followTarget"]): Promise<boolean> {
  if (!t || !w.residentId) return false;
  return !!(await db.prepare(`SELECT 1 FROM follows WHERE resident_id = ? AND followed_type = ? AND followed_id = ?`).get(w.residentId, t.type, t.id));
}

function publicPlan(p: Plan, now: Date) {
  const { timing, listing: _l, seriesId: _s, experienceId: _e, ...rest } = p;
  return { ...rest, startsAt: timing.start.toISOString(), endsAt: timing.end.toISOString(), durationKnown: timing.durationKnown, phase: planPhase(p.date, timing, now) as PlanPhase };
}

export const myLifePlansRouter = Router();

/** GET /api/my-life/plans — the next commitment, everything else upcoming, and recent visits. */
myLifePlansRouter.get("/plans", async (req, res) => {
  const w = who(req);
  if (!w.residentId && !w.clientId) return res.status(400).json({ error: "Missing X-Client-Id header" });
  const now = new Date();
  const from = new Date(now.getTime() - 15 * 86400000).toISOString().slice(0, 10);
  const to = new Date(now.getTime() + 120 * 86400000).toISOString().slice(0, 10);
  const all = await loadPlans(w, from, to);
  const { next, upcoming, recent } = arrangePlans(all, now);
  const recentOut = [];
  // A programme place appears once (its latest past session), not per session.
  const seen = new Set<string>();
  const recentUnique = recent.filter((p) => {
    const k = `${p.placeKind}:${p.ref}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  for (const p of recentUnique.slice(0, 5)) {
    recentOut.push({
      ...publicPlan(p, now),
      visit: await visitState(p, w),
      goAgain: await goAgain(p, w),
      following: await isFollowing(w, p.followTarget),
    });
  }
  res.setHeader("Cache-Control", "private, no-store");
  res.json({
    next: next ? { ...publicPlan(next, now), following: await isFollowing(w, next.followTarget) } : null,
    upcoming: upcoming.slice(0, 12).map((p) => publicPlan(p, now)),
    recent: recentOut,
  });
});

// --- review invitations ----------------------------------------------------------

interface InvitationTarget {
  residentId: string;
  listingType: ReviewSubject;
  listingId: string;
  occurrenceKind: string;
  occurrenceRef: string;
  endsAt: Date;
  /** Booking-page path the invitation opens (live state shown there). */
  path: string;
  label: string;
}

/** What a person-level confirmation (attendance kind, ref) is about, for a signed-in resident — or null. */
export async function invitationTarget(kind: string, ref: string): Promise<InvitationTarget | null> {
  if (kind === "booking") {
    const r = (await db.prepare(`SELECT b.resident_id as rid, b.date, b.time, b.duration, c.id as cid, c.name FROM bookings b JOIN centres c ON c.id = b.centre_id WHERE b.ref = ?`).get(ref)) as any;
    if (!r?.rid) return null;
    return { residentId: r.rid, listingType: "centre", listingId: r.cid, occurrenceKind: "booking", occurrenceRef: ref, endsAt: planTiming(String(r.date), r.time, r.duration ? Number(r.duration) * 60 : null).end, path: `booking/${ref}`, label: r.name };
  }
  if (kind === "experience") {
    const r = (await db
      .prepare(`SELECT eb.resident_id as rid, es.date, es.time, e.duration_minutes as dur, e.id as eid, e.title FROM experience_bookings eb JOIN experience_sessions es ON es.id = eb.session_id JOIN experiences e ON e.id = eb.experience_id WHERE eb.ref = ?`)
      .get(ref)) as any;
    if (!r?.rid) return null;
    return { residentId: r.rid, listingType: "experience", listingId: r.eid, occurrenceKind: "experience", occurrenceRef: ref, endsAt: planTiming(String(r.date), r.time, r.dur ? Number(r.dur) : null).end, path: `experience/${ref}`, label: r.title };
  }
  if (kind === "registration") {
    const r = (await db.prepare(`SELECT r.resident_id as rid, r.registrant_type as t, c.id as cid, c.name FROM registrations r JOIN clubs c ON c.id = r.club_id WHERE r.ref = ?`).get(ref)) as any;
    if (!r?.rid || r.t !== "adult") return null; // a child's registration never invites the account holder
    return { residentId: r.rid, listingType: "club", listingId: r.cid, occurrenceKind: "registration", occurrenceRef: ref, endsAt: new Date(), path: `registration/${ref}`, label: r.name };
  }
  if (kind === "program_session") {
    const [sid, eid] = ref.split(":");
    const r = (await db
      .prepare(`SELECT pe.resident_id as rid, pe.ref as pref, ps.date, ps.time, ps.duration_minutes as dur, p.id as pid, p.title FROM program_sessions ps JOIN program_enrollments pe ON pe.id = ? JOIN programs p ON p.id = ps.program_id WHERE ps.id = ?`)
      .get(eid ?? "", sid ?? "")) as any;
    if (!r?.rid) return null;
    return { residentId: r.rid, listingType: "program", listingId: r.pid, occurrenceKind: "enrollment", occurrenceRef: r.pref, endsAt: planTiming(String(r.date), r.time, r.dur ? Number(r.dur) : null).end, path: `program/${r.pref}`, label: r.title };
  }
  if (kind === "game") {
    const [gid, rid] = ref.split(":");
    const r = (await db.prepare(`SELECT date, time, duration_minutes as dur, activity_label as title, host_resident_id as host FROM games WHERE id = ?`).get(gid ?? "")) as any;
    if (!r || !rid || r.host === rid) return null;
    return { residentId: rid, listingType: "game", listingId: gid, occurrenceKind: "game", occurrenceRef: gid, endsAt: planTiming(String(r.date), r.time, r.dur ? Number(r.dur) : null).end, path: `game/${gid}`, label: r.title };
  }
  return null;
}

/**
 * Records that this confirmed occurrence should get one invitation, sent once
 * it has ended. Idempotent: the unique key means repeated or concurrent calls,
 * and a confirmation withdrawn then restored, never make a second invitation.
 */
export async function scheduleReviewInvitation(kind: string, ref: string): Promise<void> {
  try {
    const t = await invitationTarget(kind, ref);
    if (!t) return;
    const sendAfter = t.endsAt.toISOString().slice(0, 19).replace("T", " ");
    await db
      .prepare(
        `INSERT IGNORE INTO review_invitations (resident_id, listing_type, listing_id, occurrence_kind, occurrence_ref, send_after, path, label)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(t.residentId, t.listingType, t.listingId, t.occurrenceKind, t.occurrenceRef, sendAfter, t.path, t.label.slice(0, 255));
    if (t.endsAt.getTime() <= Date.now()) await sweepReviewInvitations(t.residentId);
  } catch (e) {
    console.error("[review-invitations] schedule failed:", e instanceof Error ? e.message : e);
  }
}

/** Sends due invitations, re-checking eligibility and the preference at send time. Each row is claimed once. */
export async function sweepReviewInvitations(onlyResidentId?: string): Promise<number> {
  const due = (await db
    .prepare(
      `SELECT id, resident_id as residentId, listing_type as listingType, listing_id as listingId, occurrence_kind as kind, occurrence_ref as ref, path, label
       FROM review_invitations WHERE status = 'scheduled' AND send_after <= UTC_TIMESTAMP() ${onlyResidentId ? "AND resident_id = ?" : ""} ORDER BY id LIMIT 200`
    )
    .all(...(onlyResidentId ? [onlyResidentId] : []))) as { id: number; residentId: string; listingType: ReviewSubject; listingId: string; kind: string; ref: string; path: string; label: string }[];
  let sent = 0;
  for (const inv of due) {
    const claim = await db.prepare(`UPDATE review_invitations SET status = 'sending' WHERE id = ? AND status = 'scheduled'`).run(inv.id);
    if (claim.changes !== 1) continue;
    const finish = (status: string, reason: string | null, notificationId: number | null = null) =>
      db.prepare(`UPDATE review_invitations SET status = ?, reason = ?, notification_id = ?, sent_at = IF(? = 'sent', NOW(), NULL) WHERE id = ?`).run(status, reason, notificationId, status, inv.id);
    if (!(await residentAllows(inv.residentId, "reviewInvites"))) {
      await finish("skipped", "preference_off");
      continue;
    }
    const places = await reviewablePlaces(inv.listingType, inv.listingId, { residentId: inv.residentId, clientId: null, email: null });
    const occ = places.confirmed.find((o) => o.kind === inv.kind && o.ref === inv.ref);
    if (!occ) {
      await finish("skipped", "not_eligible");
      continue;
    }
    const reviewed = await db
      .prepare(`SELECT 1 FROM review_claims WHERE claim_key = ?`)
      .get(reviewClaimKey(inv.listingType, inv.kind, inv.ref, occ.authorKey));
    if (reviewed) {
      await finish("skipped", "already_reviewed");
      continue;
    }
    await notifyResident({
      residentId: inv.residentId,
      kind: "review_invite",
      title: `How was ${inv.label}?`,
      body: "The organiser confirmed you attended. You can leave a review from your booking.",
      listingType: "account",
      listingId: inv.residentId,
      ref: inv.path,
    });
    const n = (await db
      .prepare(`SELECT id FROM notifications WHERE resident_id = ? AND kind = 'review_invite' AND ref = ? ORDER BY id DESC LIMIT 1`)
      .get(inv.residentId, inv.path)) as { id: number } | undefined;
    await finish("sent", null, n?.id ?? null);
    sent++;
  }
  return sent;
}

/**
 * Attendance behind a sent invitation was revoked or disputed: the in-app
 * notification stops inviting (it now points to the booking's live state) and
 * the invitation is never re-sent, even if attendance is restored later.
 */
export async function voidReviewInvitations(attendanceKind: string, attendanceRef: string): Promise<void> {
  const t = await invitationTarget(attendanceKind, attendanceRef).catch(() => null);
  if (!t) return;
  const rows = (await db
    .prepare(`SELECT id, notification_id as notificationId FROM review_invitations WHERE resident_id = ? AND occurrence_kind = ? AND occurrence_ref = ? AND status IN ('scheduled', 'sent')`)
    .all(t.residentId, t.occurrenceKind, t.occurrenceRef)) as { id: number; notificationId: number | null }[];
  for (const r of rows) {
    await db.prepare(`UPDATE review_invitations SET status = 'void', reason = 'attendance_changed' WHERE id = ?`).run(r.id);
    if (r.notificationId) {
      await db
        .prepare(`UPDATE notifications SET title = ?, body = ? WHERE id = ? AND resident_id = ?`)
        .run(`Update about ${t.label}`, "Your attendance record changed after this message. Open your booking to see where it stands.", r.notificationId, t.residentId);
    }
  }
}
