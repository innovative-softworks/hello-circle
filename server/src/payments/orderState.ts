import { db } from "../db/index.js";
import { computeCapacity } from "../capacity.js";
import { gameSeatSql, holdIsLive, occupiesCapacitySql } from "../bookingIntegrity.js";
import { irelandWallTimeToUtc } from "../irelandTime.js";
import { bookingEndHour, hoursOverlap } from "../util.js";

// D-10 (2026-10-15) — the facts a paid order is checked against before it can
// be confirmed or keep a place under review: its start time, whether its
// listing can still be sold, and whether its place is still free. Shared by
// the webhook confirmation (routes/stripeWebhook.ts) and the review hold
// (payments/paymentReview.ts). Each takes the caller's transaction so it runs
// under the same parent-row lock as checkout.

type Tx = Pick<typeof db, "prepare">;

export type OrderType = "booking" | "registration" | "game" | "program" | "experience" | "pass";

export const ORDER_TABLE: Record<OrderType, string> = {
  booking: "bookings",
  registration: "registrations",
  game: "game_participants",
  program: "program_enrollments",
  experience: "experience_bookings",
  pass: "passes",
};
export const ORDER_TOTAL: Record<OrderType, string> = {
  booking: "total_cents",
  registration: "total_cents",
  game: "total_cents",
  program: "total_cents",
  experience: "total_cents",
  pass: "purchased_cents",
};
/** Tables whose rows can hold a place (and so carry review_hold_until). */
export const HOLDING_TYPES: OrderType[] = ["booking", "registration", "game", "program", "experience"];

/** The parent row checkout locks before it counts capacity (same lock order). */
export const PARENT_LOCK: Record<OrderType, string> = {
  booking: `SELECT r.id FROM rooms r JOIN bookings b ON b.room_id = r.id AND b.centre_id = r.centre_id WHERE b.ref = ? FOR UPDATE`,
  registration: `SELECT c.id FROM clubs c JOIN registrations r ON r.club_id = c.id WHERE r.ref = ? FOR UPDATE`,
  program: `SELECT p.id FROM programs p JOIN program_enrollments e ON e.program_id = p.id WHERE e.ref = ? FOR UPDATE`,
  experience: `SELECT s.id FROM experience_sessions s JOIN experience_bookings b ON b.session_id = s.id WHERE b.ref = ? FOR UPDATE`,
  game: `SELECT g.id FROM games g JOIN game_participants gp ON gp.game_id = g.id WHERE gp.ref = ? FOR UPDATE`,
  pass: `SELECT p.id FROM passes p WHERE p.ref = ? FOR UPDATE`,
};

export function isOrderType(t: unknown): t is OrderType {
  return typeof t === "string" && t in ORDER_TABLE;
}

const utc = (date: string, time: string) => {
  const [h, m] = String(time).split(":").map(Number);
  const d = irelandWallTimeToUtc(String(date).slice(0, 10), h || 0, m || 0);
  return Number.isNaN(d.getTime()) ? null : d;
};
const dateText = (d: unknown) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d ?? "").slice(0, 10));

export interface OrderStart {
  /** The applicable start S (UTC), or null when the offering has no single start. */
  startAt: Date | null;
  /** True when the order's start (for a programme: every session) has passed. */
  started: boolean;
  /** Programme only: some of its sessions have already happened, others haven't. */
  midProgramme: boolean;
  basis: "slot" | "session" | "first_future_session" | "none";
}

/** S for one order. Venue bookings, experience seats and activities have one
 * start; a programme enrolment covers every session of its programme, so S is
 * the earliest session not yet started; club registrations and passes have no
 * single start. Ireland wall-clock times → UTC via irelandTime. */
export async function orderStart(tx: Tx, type: OrderType, ref: string, now: Date = new Date()): Promise<OrderStart> {
  const single = (d: Date | null, basis: OrderStart["basis"]): OrderStart => ({ startAt: d, started: !!d && d.getTime() <= now.getTime(), midProgramme: false, basis });
  if (type === "booking") {
    const r = (await tx.prepare(`SELECT date, time FROM bookings WHERE ref = ?`).get(ref)) as { date: unknown; time: string } | undefined;
    return r ? single(utc(dateText(r.date), r.time), "slot") : single(null, "none");
  }
  if (type === "experience") {
    const r = (await tx.prepare(`SELECT s.date, s.time FROM experience_bookings b JOIN experience_sessions s ON s.id = b.session_id WHERE b.ref = ?`).get(ref)) as { date: unknown; time: string } | undefined;
    return r ? single(utc(dateText(r.date), r.time), "session") : single(null, "none");
  }
  if (type === "game") {
    const r = (await tx.prepare(`SELECT g.date, g.time FROM game_participants gp JOIN games g ON g.id = gp.game_id WHERE gp.ref = ?`).get(ref)) as { date: unknown; time: string } | undefined;
    return r ? single(utc(dateText(r.date), r.time), "session") : single(null, "none");
  }
  if (type === "program") {
    const sessions = (await tx
      .prepare(`SELECT s.date, s.time FROM program_sessions s JOIN program_enrollments e ON e.program_id = s.program_id WHERE e.ref = ? AND s.status != 'cancelled'`)
      .all(ref)) as { date: unknown; time: string }[];
    const starts = sessions.map((s) => utc(dateText(s.date), s.time)).filter((d): d is Date => !!d).sort((a, b) => a.getTime() - b.getTime());
    if (!starts.length) return single(null, "none");
    const future = starts.filter((d) => d.getTime() > now.getTime());
    if (!future.length) return { startAt: starts[starts.length - 1], started: true, midProgramme: false, basis: "first_future_session" };
    return { startAt: future[0], started: false, midProgramme: future.length < starts.length, basis: "first_future_session" };
  }
  return single(null, "none");
}

/** Can this listing still be sold? (Its own publication status — the
 * organisation rule is checked separately by orgSuspendedForVendor.) Passes
 * keep their existing checks only. */
export async function listingEligible(tx: Tx, type: OrderType, row: Record<string, any>): Promise<boolean> {
  if (type === "booking") {
    const r = (await tx.prepare(`SELECT c.status, r.active FROM centres c LEFT JOIN rooms r ON r.id = ? AND r.centre_id = c.id WHERE c.id = ?`).get(row.room_id, row.centre_id)) as { status: string; active: number | null } | undefined;
    return !r || (r.status === "approved" && (row.room_id == null || Number(r.active ?? 1) === 1));
  }
  if (type === "registration") {
    const c = (await tx.prepare(`SELECT status FROM clubs WHERE id = ?`).get(row.club_id)) as { status: string } | undefined;
    if (c && c.status !== "approved") return false;
    if (row.session_id) {
      const s = (await tx.prepare(`SELECT active FROM club_sessions WHERE id = ?`).get(row.session_id)) as { active: number } | undefined;
      if (!s || !Number(s.active)) return false;
    }
    return true;
  }
  if (type === "program") {
    const p = (await tx.prepare(`SELECT status FROM programs WHERE id = ?`).get(row.program_id)) as { status: string } | undefined;
    return !p || p.status === "published";
  }
  if (type === "experience") {
    const s = (await tx.prepare(`SELECT s.status, e.status AS expStatus FROM experience_sessions s JOIN experiences e ON e.id = s.experience_id WHERE s.id = ?`).get(row.session_id)) as { status: string; expStatus: string } | undefined;
    return !s || (s.status === "scheduled" && s.expStatus === "approved");
  }
  if (type === "game") {
    const g = (await tx.prepare(`SELECT status FROM games WHERE id = ?`).get(row.game_id)) as { status: string } | undefined;
    return !g || g.status !== "cancelled";
  }
  return true;
}

/** True while the order's own checkout hold (30 minutes) or D-10 review hold is live. */
export function orderHoldLive(type: OrderType, row: Record<string, any>): boolean {
  const start = type === "game" ? row.joined_at : row.created_at;
  if (start && holdIsLive(start)) return true;
  return !!row.review_hold_until && new Date(row.review_hold_until).getTime() > Date.now();
}

/** Re-proves capacity for an order whose hold has lapsed, excluding the row
 * itself (moved unchanged from stripeWebhook.ts; games added). */
export async function orderFits(tx: Tx, type: OrderType, row: Record<string, any>): Promise<boolean> {
  const occ = occupiesCapacitySql();
  if (type === "booking") {
    const others = (await tx.prepare(`SELECT time, duration FROM bookings WHERE room_id = ? AND centre_id = ? AND date = ? AND ref != ? AND ${occ}`).all(row.room_id, row.centre_id, row.date, row.ref)) as { time: string; duration: number }[];
    const start = parseInt(String(row.time).slice(0, 2), 10);
    const end = bookingEndHour(start, row.duration);
    return !others.some((b) => {
      const bs = parseInt(b.time.slice(0, 2), 10);
      return hoursOverlap(start, end, bs, bookingEndHour(bs, b.duration));
    });
  }
  if (type === "registration") {
    const club = (await tx.prepare(`SELECT capacity FROM clubs WHERE id = ?`).get(row.club_id)) as { capacity: number | null } | undefined;
    const { n } = (await tx.prepare(`SELECT COUNT(*) as n FROM registrations WHERE club_id = ? AND ref != ? AND ${occ}`).get(row.club_id, row.ref)) as { n: number };
    if (computeCapacity(club?.capacity ?? null, Number(n)).isFull) return false;
    if (row.session_id) {
      const session = (await tx.prepare(`SELECT capacity, active FROM club_sessions WHERE id = ?`).get(row.session_id)) as { capacity: number | null; active: number } | undefined;
      if (!session || !session.active) return false;
      const { n: sn } = (await tx.prepare(`SELECT COUNT(*) as n FROM registrations WHERE session_id = ? AND ref != ? AND ${occ}`).get(row.session_id, row.ref)) as { n: number };
      if (computeCapacity(session.capacity, Number(sn)).isFull) return false;
    }
    return true;
  }
  if (type === "program") {
    const program = (await tx.prepare(`SELECT capacity, status FROM programs WHERE id = ?`).get(row.program_id)) as { capacity: number | null; status: string };
    if (program.status !== "published") return false;
    if (program.capacity === null) return true;
    const { n } = (await tx.prepare(`SELECT COUNT(*) as n FROM program_enrollments WHERE program_id = ? AND ref != ? AND ${occ}`).get(row.program_id, row.ref)) as { n: number };
    return Number(n) < program.capacity;
  }
  if (type === "experience") {
    const session = (await tx.prepare(`SELECT s.capacity, s.status, e.capacity as expCapacity FROM experience_sessions s JOIN experiences e ON e.id = s.experience_id WHERE s.id = ?`).get(row.session_id)) as { capacity: number | null; status: string; expCapacity: number };
    if (session.status !== "scheduled") return false;
    const { n } = (await tx.prepare(`SELECT COALESCE(SUM(party_size), 0) as n FROM experience_bookings WHERE session_id = ? AND ref != ? AND ${occ}`).get(row.session_id, row.ref)) as { n: number };
    return Number(n) + row.party_size <= (session.capacity ?? session.expCapacity);
  }
  if (type === "game") {
    const g = (await tx.prepare(`SELECT capacity, status FROM games WHERE id = ?`).get(row.game_id)) as { capacity: number; status: string };
    const { n } = (await tx.prepare(`SELECT COUNT(*) as n FROM game_participants WHERE game_id = ? AND ref != ? AND ${gameSeatSql()}`).get(row.game_id, row.ref)) as { n: number };
    return g.status !== "cancelled" && Number(n) < g.capacity;
  }
  return true;
}
