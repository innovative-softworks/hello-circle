import crypto from "node:crypto";
import { writeAudit } from "./audit.js";
import { moveBookingSlot, slotRuleError, type MovableBooking } from "./bookingMove.js";
import { db } from "./db/index.js";
import { orgPoliciesForVendor } from "./db/queries.js";
import { sendMail } from "./email.js";
import { notifyNewBookingOrRegistration, notifyResident } from "./notifications.js";
import { hasOpenReview } from "./payments/paymentReview.js";
import { irelandWallTimeToUtc } from "./irelandTime.js";
import { activeLinkedGames } from "./routes/bookings.js";
import { CLIENT_URL } from "./stripe.js";
import { ConflictError } from "./util.js";

// OG-11 / DEC-17 — a venue (or a HelloCircle admin on its behalf) proposes a
// new time for a hall booking; the booking only moves if the customer
// accepts. Nothing about the payment changes (same booking, same amount).
// Declining leaves the booking exactly as it was; the venue can still cancel
// it through the normal provider cancel, which refunds a paid online booking
// in full — no new refund rule is introduced here.
//
// One open proposal per booking (a new one withdraws the older). A proposal
// expires when its link times out (72 hours) or the original start passes,
// whichever is first. Accepting re-runs the same locked overlap/closure checks
// as any reschedule, so it can't double-book the room.

export class ChangeError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

const hash = (token: string) => crypto.createHash("sha256").update(token).digest("hex");

interface BookingRow extends MovableBooking {
  date: string;
  time: string;
  status: string;
  paymentStatus: string;
  name: string;
  email: string;
  centreName: string;
  vendorId: string | null;
  residentId: string | null;
}

async function bookingForChange(ref: string, vendorIds: string[] | null): Promise<BookingRow> {
  const scope = vendorIds === null ? "" : vendorIds.length ? `AND c.vendor_id IN (${vendorIds.map(() => "?").join(", ")})` : "AND 1 = 0";
  const row = (await db
    .prepare(
      `SELECT b.ref, b.date, b.time, b.duration, b.status, b.payment_status as paymentStatus, b.room_id as roomId, b.name, b.email, b.resident_id as residentId,
              b.centre_id as centreId, c.name as centreName, c.vendor_id as vendorId, c.opens_at as opensAt, c.closes_at as closesAt
       FROM bookings b JOIN centres c ON c.id = b.centre_id WHERE b.ref = ? ${scope}`
    )
    .get(ref, ...(vendorIds ?? []))) as BookingRow | undefined;
  if (!row) throw new ChangeError("Booking not found", 404);
  return row;
}

/** Read-only availability check for the proposed slot (the real check runs again, locked, on accept). */
async function slotFree(row: BookingRow, date: string, time: string): Promise<boolean> {
  try {
    await db.transaction(async (tx) => {
      await moveBookingSlot(tx, row, date, time);
      throw new Rollback();
    });
  } catch (e) {
    if (e instanceof Rollback) return true;
    if (e instanceof ConflictError) return false;
    throw e;
  }
  return true;
}
class Rollback extends Error {}

export async function proposeBookingChange(input: { ref: string; vendorIds: string[] | null; actorUserId: string; date: string; time: string; message: string }) {
  const row = await bookingForChange(input.ref, input.vendorIds);
  if (row.status === "cancelled") throw new ChangeError("This booking is cancelled", 409);
  if (row.paymentStatus !== "paid") throw new ChangeError("Only a confirmed booking can be moved", 409);
  if (input.date === row.date && input.time === row.time) throw new ChangeError("That's the time it's already booked for");
  if (await hasOpenReview("booking", row.ref)) throw new ChangeError("This booking's payment is still being checked, so it can't be moved yet", 409);
  const linked = await activeLinkedGames(row.ref);
  if (linked.length) throw new ChangeError(`"${linked[0].activityLabel}" is being held on this booking — its host moves both together from their workspace`, 409);
  const { bookingWindowDays } = await orgPoliciesForVendor(row.vendorId);
  const rule = slotRuleError(row, input.date, input.time, bookingWindowDays);
  if (rule) throw new ChangeError(rule);
  if (!(await slotFree(row, input.date, input.time))) throw new ChangeError("That time isn't free — pick another", 409);

  const token = crypto.randomBytes(32).toString("hex");
  const message = input.message.trim().slice(0, 1000);
  const id = await db.transaction(async (tx) => {
    await tx.prepare(`UPDATE booking_change_proposals SET status = 'withdrawn', responded_at = NOW() WHERE booking_ref = ? AND status = 'proposed'`).run(row.ref);
    // The link lasts 72 hours, never past the booking's original start.
    const info = await tx
      .prepare(
        `INSERT INTO booking_change_proposals (booking_ref, token_hash, old_date, old_time, proposed_date, proposed_time, message, proposed_by, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, LEAST(DATE_ADD(NOW(), INTERVAL 72 HOUR), ?))`
      )
      .run(row.ref, hash(token), row.date, row.time, input.date, input.time, message, input.actorUserId, irelandWallTimeToUtc(row.date, parseInt(row.time.slice(0, 2), 10)));
    return Number(info.lastInsertRowid);
  });
  await writeAudit({ actorUserId: input.actorUserId, action: "booking.change_proposed", objectType: "booking", objectId: row.ref, previousValue: { date: row.date, time: row.time }, newValue: { date: input.date, time: input.time, proposalId: id }, reason: message || undefined });

  const url = `${CLIENT_URL}/booking-change?token=${token}`;
  const text = `Hi ${row.name || "there"},\n\n${row.centreName} would like to move your booking ${row.ref} from ${row.date} at ${row.time} to ${input.date} at ${input.time}.${message ? `\n\nTheir message: ${message}` : ""}\n\nAccept or decline here:\n${url}\n\nIf you decline, your booking stays as it is. The link works for 72 hours (or until your original start time).`;
  await sendMail({ to: row.email, subject: `${row.centreName} asks to move your booking`, text, cta: { label: "Review the new time", url } });
  if (row.residentId) {
    await notifyResident({
      residentId: row.residentId,
      kind: "booking",
      title: `${row.centreName} asks to move your booking`,
      body: `From ${row.date} ${row.time} to ${input.date} ${input.time}. Check your email for the link to accept or decline.`,
      listingType: "centre",
      listingId: row.centreId,
      ref: row.ref,
    });
  }
  return { id };
}

interface ProposalRow {
  id: number;
  bookingRef: string;
  oldDate: string;
  oldTime: string;
  proposedDate: string;
  proposedTime: string;
  message: string;
  status: string;
  expired: number;
}

async function liveProposal(token: string, lock = false, q: Pick<typeof db, "prepare"> = db): Promise<ProposalRow> {
  if (!/^[a-f0-9]{64}$/.test(token)) throw new ChangeError("This link isn't valid", 404);
  const p = (await q
    .prepare(
      `SELECT id, booking_ref as bookingRef, old_date as oldDate, old_time as oldTime, proposed_date as proposedDate, proposed_time as proposedTime, message, status, expires_at <= NOW() as expired
       FROM booking_change_proposals WHERE token_hash = ?${lock ? " FOR UPDATE" : ""}`
    )
    .get(hash(token))) as ProposalRow | undefined;
  if (!p) throw new ChangeError("This link isn't valid", 404);
  return p;
}

/** What the customer's page shows (no personal data beyond what the link holder already knows). */
export async function describeProposal(token: string) {
  const p = await liveProposal(token);
  const b = (await db.prepare(`SELECT c.name as venue, b.status FROM bookings b JOIN centres c ON c.id = b.centre_id WHERE b.ref = ?`).get(p.bookingRef)) as { venue: string; status: string } | undefined;
  const status = p.status === "proposed" && Number(p.expired) ? "expired" : p.status;
  return { ref: p.bookingRef, venue: b?.venue ?? "", from: { date: p.oldDate, time: p.oldTime }, to: { date: p.proposedDate, time: p.proposedTime }, message: p.message, status, bookingCancelled: b?.status === "cancelled" };
}

export async function respondToProposal(token: string, accept: boolean, note: string) {
  const outcome = await db.transaction(async (tx) => {
    const p = await liveProposal(token, true, tx);
    if (p.status !== "proposed") throw new ChangeError(p.status === "accepted" ? "You've already accepted this change" : "This change is no longer open", 409);
    if (Number(p.expired)) throw new ChangeError("This change has expired. Your booking stays as it was.", 410);
    const row = (await tx
      .prepare(
        `SELECT b.ref, b.date, b.time, b.duration, b.status, b.room_id as roomId, b.centre_id as centreId, c.opens_at as opensAt, c.closes_at as closesAt, c.name as centreName, c.vendor_id as vendorId,
                b.name, b.email, b.resident_id as residentId
         FROM bookings b JOIN centres c ON c.id = b.centre_id WHERE b.ref = ?`
      )
      .get(p.bookingRef)) as (MovableBooking & { date: string; time: string; status: string; centreName: string; vendorId: string | null; name: string; email: string; residentId: string | null }) | undefined;
    if (!row || row.status === "cancelled") throw new ChangeError("This booking has been cancelled", 409);
    if (row.date !== p.oldDate || row.time !== p.oldTime) throw new ChangeError("This booking has already been moved", 409);
    if (accept) {
      try {
        await moveBookingSlot(tx, row, p.proposedDate, p.proposedTime);
      } catch (e) {
        if (e instanceof ConflictError) throw new ChangeError("That new time has just been taken. Your booking stays as it was; the venue has been told.", 409);
        throw e;
      }
    }
    await tx
      .prepare(`UPDATE booking_change_proposals SET status = ?, responded_at = NOW(), response_note = ? WHERE id = ? AND status = 'proposed'`)
      .run(accept ? "accepted" : "declined", note.trim().slice(0, 500) || null, p.id);
    return { p, row };
  });
  const { p, row } = outcome;
  await writeAudit({
    actorUserId: null,
    actorKind: "resident",
    action: accept ? "booking.change_accepted" : "booking.change_declined",
    objectType: "booking",
    objectId: row.ref,
    previousValue: { date: p.oldDate, time: p.oldTime },
    newValue: accept ? { date: p.proposedDate, time: p.proposedTime } : { declined: true },
    reason: note.trim() || undefined,
  });
  // Tell the venue either way (the vendor notification feed + email).
  notifyNewBookingOrRegistration({
    kind: "booking",
    listingType: "centre",
    listingId: row.centreId,
    listingName: row.centreName,
    vendorId: row.vendorId,
    guestName: row.name,
    guestEmail: row.email,
    ref: row.ref,
    detailsText: accept ? `Customer accepted the new time: ${p.proposedDate} at ${p.proposedTime} (was ${p.oldDate} at ${p.oldTime})` : `Customer declined the new time; the booking stays on ${p.oldDate} at ${p.oldTime}${note.trim() ? ` — "${note.trim().slice(0, 200)}"` : ""}`,
    residentId: row.residentId,
  }).catch((e) => console.error("[notifications] booking change notify failed:", e));
  return { status: accept ? "accepted" : "declined", date: accept ? p.proposedDate : p.oldDate, time: accept ? p.proposedTime : p.oldTime };
}

export async function proposalsForBooking(ref: string) {
  return (await db
    .prepare(
      `SELECT id, old_date as oldDate, old_time as oldTime, proposed_date as proposedDate, proposed_time as proposedTime, message,
              CASE WHEN status = 'proposed' AND expires_at <= NOW() THEN 'expired' ELSE status END as status, created_at as createdAt, responded_at as respondedAt, response_note as responseNote
       FROM booking_change_proposals WHERE booking_ref = ? ORDER BY id DESC LIMIT 20`
    )
    .all(ref)) as Record<string, unknown>[];
}

export async function withdrawProposal(ref: string, id: number, actorUserId: string) {
  const r = await db.prepare(`UPDATE booking_change_proposals SET status = 'withdrawn', responded_at = NOW() WHERE id = ? AND booking_ref = ? AND status = 'proposed'`).run(id, ref);
  if (r.changes !== 1) throw new ChangeError("This proposal is no longer open", 409);
  await writeAudit({ actorUserId, action: "booking.change_withdrawn", objectType: "booking", objectId: ref, newValue: { proposalId: id } });
}

export { bookingForChange };
