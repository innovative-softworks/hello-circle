import type { db } from "./db/index.js";
import { irelandWallTimeToUtc } from "./irelandTime.js";
import { TIME_SLOTS } from "./routes/availability.js";
import { occupiesCapacitySql, startIsInFuture, validateFutureDate } from "./bookingIntegrity.js";
import { ConflictError, bookingEndHour, hoursOverlap } from "./util.js";

type Tx = Pick<typeof db, "prepare">;

// Moving a hall booking to another slot (same ref, same payment). One shared
// implementation for the guest's own reschedule (bookings.ts), a customer
// accepting a partner's proposed change (bookingChanges.ts) and a host moving
// an activity together with its venue booking (games.ts): the same grid,
// opening-hours, booking-window, overlap and closure rules, under the same
// room row lock checkout takes, so a move can never double-book a room.

export interface MovableBooking {
  ref: string;
  centreId: string;
  roomId: string;
  duration: number;
  opensAt: string;
  closesAt: string;
}

/** Validation that needs no lock. Returns an error message, or null when the slot is acceptable. */
export function slotRuleError(row: MovableBooking, date: string, time: string, bookingWindowDays: number): string | null {
  if (!TIME_SLOTS.includes(time)) return "Invalid time slot";
  const dateError = validateFutureDate(date);
  if (dateError) return dateError;
  if (!startIsInFuture(date, time)) return "That time has already passed";
  const startHour = parseInt(time.slice(0, 2), 10);
  const reqEnd = bookingEndHour(startHour, row.duration);
  if (startHour < parseInt(row.opensAt.slice(0, 2), 10) || reqEnd > parseInt(row.closesAt.slice(0, 2), 10)) return "That time is outside the venue's opening hours";
  if (irelandWallTimeToUtc(date, startHour).getTime() - Date.now() > bookingWindowDays * 24 * 60 * 60 * 1000) {
    return `This venue only takes bookings up to ${bookingWindowDays} days in advance`;
  }
  return null;
}

/** Locks the room, re-checks overlap and closures for the new slot, and moves
 * the booking. Throws ConflictError when the slot is taken or closed. Must run
 * inside the caller's transaction. */
export async function moveBookingSlot(tx: Tx, row: MovableBooking, date: string, time: string): Promise<void> {
  const startHour = parseInt(time.slice(0, 2), 10);
  const reqEnd = bookingEndHour(startHour, row.duration);
  // rooms.id is only unique per centre — scope the lock and checks by centre.
  await tx.prepare(`SELECT id FROM rooms WHERE id = ? AND centre_id = ? FOR UPDATE`).get(row.roomId, row.centreId);
  const overlapping = (await tx
    .prepare(`SELECT ref, time, duration FROM bookings WHERE room_id = ? AND centre_id = ? AND date = ? AND ref != ? AND ${occupiesCapacitySql()}`)
    .all(row.roomId, row.centreId, date, row.ref)) as { ref: string; time: string; duration: number }[];
  const clashes = overlapping.some((b) => {
    const bStart = parseInt(b.time.slice(0, 2), 10);
    return hoursOverlap(startHour, reqEnd, bStart, bookingEndHour(bStart, b.duration));
  });
  if (clashes) throw new ConflictError("That new time is no longer available");
  const blocks = (await tx
    .prepare(`SELECT time FROM room_blocks WHERE centre_id = ? AND date = ? AND (room_id = ? OR room_id IS NULL)`)
    .all(row.centreId, date, row.roomId)) as { time: string | null }[];
  const blocked = blocks.some((b) => (b.time === null ? true : parseInt(b.time.slice(0, 2), 10) >= startHour && parseInt(b.time.slice(0, 2), 10) < reqEnd));
  if (blocked) throw new ConflictError("The vendor has closed that date/time");
  const moved = await tx.prepare(`UPDATE bookings SET date = ?, time = ? WHERE ref = ? AND status != 'cancelled'`).run(date, time, row.ref);
  if (moved.changes !== 1) throw new ConflictError("This booking can no longer be moved");
}
