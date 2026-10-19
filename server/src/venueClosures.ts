import crypto from "node:crypto";
import { writeAudit } from "./audit.js";
import { db } from "./db/index.js";
import { occupiesCapacitySql, validateFutureDate } from "./bookingIntegrity.js";
import { cancelHallBookingAsProvider } from "./hallBookingCancel.js";
import { TIME_SLOTS } from "./routes/availability.js";
import { ConflictError, bookingEndHour, hoursOverlap } from "./util.js";

// OG-04 — venue closures (Calendar → Block time, centre editor → Blocked
// times) that never silently close a slot someone has already booked.
//
// A closure is either a whole day (one room_blocks row with time NULL, as
// before) or a range of whole hours. A range is stored as one row per hour
// ("14:00", "15:00"), which is exactly what availability, checkout and
// reschedule already read; `group_id` ties those rows together so the range
// is listed and removed as one closure.
//
// Before anything is written, the bookings the closure covers are listed
// (preview). Creating the closure re-reads that list under the same room row
// locks checkout takes, refuses if it changed since the preview, and refuses
// if bookings are affected unless the partner chose what happens to them:
// keep them (the closure only stops new bookings), or cancel them through the
// normal provider-cancel path, which notifies each customer and refunds a
// paid online order in full (the existing rule for any provider cancellation).

type Q = Pick<typeof db, "prepare">;

export interface ClosureInput {
  centreId: string;
  roomId: string | null;
  date: string;
  /** "HH:00" inclusive start, or null for the whole day. */
  startTime: string | null;
  /** "HH:00" exclusive end (up to "21:00"), or null for the whole day. */
  endTime: string | null;
  reason: string;
}

export interface AffectedBooking {
  ref: string;
  roomId: string;
  roomName: string | null;
  time: string;
  duration: number;
  name: string;
  guests: number;
  paymentStatus: string;
  totalCents: number | null;
  /** Paid through Stripe Checkout (a cash or free booking is also "paid"). */
  online: boolean;
}

export type ClosureResolution = "keep" | "cancel_refund";

/** Validates the input; returns an error message or null. */
export function closureInputError(i: ClosureInput): string | null {
  const dateError = validateFutureDate(i.date);
  if (dateError) return dateError;
  if ((i.startTime === null) !== (i.endTime === null)) return "Give both a start and an end time, or neither for the whole day";
  if (i.startTime !== null && i.endTime !== null) {
    if (!TIME_SLOTS.includes(i.startTime)) return "Start time must be on the hour, between 09:00 and 20:00";
    const end = parseInt(i.endTime.slice(0, 2), 10);
    if (!/^\d{2}:00$/.test(i.endTime) || end < 10 || end > 21) return "End time must be on the hour, between 10:00 and 21:00";
    if (end <= parseInt(i.startTime.slice(0, 2), 10)) return "The end time must be after the start time";
  }
  if (i.reason.length > 500) return "Keep the reason under 500 characters";
  return null;
}

function range(i: ClosureInput): { start: number; end: number } | null {
  return i.startTime === null || i.endTime === null ? null : { start: parseInt(i.startTime.slice(0, 2), 10), end: parseInt(i.endTime.slice(0, 2), 10) };
}

/** The live bookings (paid, cash, or a checkout still in progress) this closure would cover. */
export async function affectedBookings(q: Q, i: ClosureInput): Promise<AffectedBooking[]> {
  const raw = (await q
    .prepare(
      `SELECT b.ref, b.room_id as roomId, r.name as roomName, b.time, b.duration, b.name, b.guests, b.payment_status as paymentStatus, b.total_cents as totalCents,
              (b.stripe_session_id IS NOT NULL) as online
       FROM bookings b LEFT JOIN rooms r ON r.centre_id = b.centre_id AND r.id = b.room_id
       WHERE b.centre_id = ? AND b.date = ? ${i.roomId ? "AND b.room_id = ?" : ""} AND ${occupiesCapacitySql("b")}
       ORDER BY b.time, b.ref`
    )
    .all(i.centreId, i.date, ...(i.roomId ? [i.roomId] : []))) as (Omit<AffectedBooking, "online"> & { online: number | string })[];
  const rows = raw.map((b) => ({ ...b, online: Number(b.online) === 1 }));
  const r = range(i);
  if (!r) return rows;
  return rows.filter((b) => {
    const start = parseInt(b.time.slice(0, 2), 10);
    return hoursOverlap(r.start, r.end, start, bookingEndHour(start, b.duration));
  });
}

export async function createClosure(
  i: ClosureInput,
  opts: { actorUserId: string; expectedRefs: string[]; resolution: ClosureResolution | null }
): Promise<{ groupId: string; affected: AffectedBooking[]; cancelled: { ref: string; refund: string; refundError?: string }[] }> {
  const groupId = crypto.randomUUID();
  const affected = await db.transaction(async (tx) => {
    // The same lock checkout and reschedule take on the room row: a booking
    // can't land in the closed slot between this check and the insert. A
    // centre-wide closure locks every room (in id order, so two closures
    // can't deadlock each other).
    if (i.roomId) {
      const room = await tx.prepare(`SELECT id FROM rooms WHERE id = ? AND centre_id = ? FOR UPDATE`).get(i.roomId, i.centreId);
      if (!room) throw new ConflictError("That room doesn't belong to this centre");
    } else {
      await tx.prepare(`SELECT id FROM rooms WHERE centre_id = ? ORDER BY id FOR UPDATE`).all(i.centreId);
    }
    const now = await affectedBookings(tx, i);
    const seen = [...opts.expectedRefs].sort().join(",");
    if (now.map((b) => b.ref).sort().join(",") !== seen) {
      throw new ConflictError("The bookings on this date changed while you were reviewing them — check the list again");
    }
    if (now.length && !opts.resolution) throw new ConflictError("Choose what happens to the bookings this closure covers");
    const r = range(i);
    const hours = r ? Array.from({ length: r.end - r.start }, (_, k) => `${String(r.start + k).padStart(2, "0")}:00`) : [null];
    for (const time of hours) {
      await tx
        .prepare(`INSERT INTO room_blocks (centre_id, room_id, date, time, reason, group_id) VALUES (?, ?, ?, ?, ?, ?)`)
        .run(i.centreId, i.roomId, i.date, time, i.reason, groupId);
    }
    return now;
  });

  await writeAudit({
    actorUserId: opts.actorUserId,
    action: "centre.closure_created",
    objectType: "centre",
    objectId: i.centreId,
    newValue: { groupId, roomId: i.roomId, date: i.date, startTime: i.startTime, endTime: i.endTime, affected: affected.map((b) => b.ref), resolution: affected.length ? opts.resolution : null },
    reason: i.reason || undefined,
  });

  const cancelled: { ref: string; refund: string; refundError?: string }[] = [];
  if (affected.length && opts.resolution === "cancel_refund") {
    for (const b of affected) {
      const result = await cancelHallBookingAsProvider({
        ref: b.ref,
        actorUserId: opts.actorUserId,
        vendorIds: null,
        action: "booking.cancelled_by_closure",
        reason: i.reason || "Venue closed",
      });
      if (result.ok) cancelled.push({ ref: b.ref, refund: result.refund, ...(result.refundError ? { refundError: result.refundError } : {}) });
    }
  }
  return { groupId, affected, cancelled };
}
