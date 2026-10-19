import { writeAudit } from "./audit.js";
import { db } from "./db/index.js";
import { notifyCancellation } from "./notifications.js";
import { refundOnProviderCancel, type CancelRefundOutcome } from "./providerCancelRefund.js";
import { activeLinkedGames } from "./routes/bookings.js";
import { cancelGameAndNotify } from "./routes/games.js";
import { promoteNextWaitlistEntry } from "./waitlist.js";
import { syncOrderFromSource } from "./commerce/engine.js";

// A provider-side cancellation of one hall booking: the venue's own staff
// (Bookings → Cancel), a venue closure that cancels the bookings it covers
// (Calendar → Block time), or a HelloCircle admin cancelling on the venue's
// behalf. One implementation so every path does the same things in the same
// order: an atomic status flip (only the request that flips the row runs the
// side effects), the audit row, cancelling any activity held on the booking,
// the customer/vendor notice, and the full automatic refund of a paid online
// order (refund-once; a failed refund leaves the order "refund pending").

export type ProviderCancelResult =
  | { ok: true; refund: CancelRefundOutcome["refund"]; refundError?: string }
  | { ok: false; status: 404 | 409; error: string };

export async function cancelHallBookingAsProvider(input: {
  ref: string;
  actorUserId: string;
  /** The caller's organisation's vendor ids; null for a HelloCircle admin (any venue). */
  vendorIds: string[] | null;
  /** Audit action, e.g. "booking.cancelled_by_vendor". */
  action: string;
  /** Recorded with the audit row (admin cancellations and closures always give one). */
  reason?: string;
}): Promise<ProviderCancelResult> {
  const scope = input.vendorIds === null ? "" : input.vendorIds.length ? `AND c.vendor_id IN (${input.vendorIds.map(() => "?").join(", ")})` : "AND 1 = 0";
  const row = (await db
    .prepare(
      `SELECT b.ref, b.date, b.time, b.duration, b.guests, b.status, b.name, b.email,
              b.centre_id as centreId, c.name as centreName, c.vendor_id as vendorId, b.resident_id as residentId
       FROM bookings b JOIN centres c ON c.id = b.centre_id
       WHERE b.ref = ? ${scope}`
    )
    .get(input.ref, ...(input.vendorIds ?? []))) as
    | { ref: string; date: string; time: string; duration: number; guests: number; status: string; name: string; email: string; centreId: string; centreName: string; vendorId: string | null; residentId: string | null }
    | undefined;
  if (!row) return { ok: false, status: 404, error: "Booking not found" };
  if (row.status === "cancelled") return { ok: false, status: 409, error: "This booking is already cancelled" };

  // HC-QA-046 — atomic transition: only the request that actually flips the row
  // runs the side effects (capacity release, audit, notifications, promotion).
  const flipped = await db.prepare(`UPDATE bookings SET status = 'cancelled' WHERE ref = ? AND status != 'cancelled'`).run(row.ref);
  if (flipped.changes !== 1) return { ok: false, status: 409, error: "This booking is already cancelled" };

  await writeAudit({
    actorUserId: input.actorUserId,
    action: input.action,
    objectType: "booking",
    objectId: row.ref,
    previousValue: { status: row.status },
    newValue: { status: "cancelled" },
    reason: input.reason,
  });

  // Booking UX Phase 5 (audit E1) — an activity held on this booking can't
  // go ahead without it: cancel it too and tell its participants (once).
  for (const g of await activeLinkedGames(row.ref)) {
    if (await cancelGameAndNotify(g.id, { by: "venue", actorId: input.actorUserId })) {
      await writeAudit({ actorUserId: input.actorUserId, action: "game.cancelled_with_venue_booking", objectType: "game", objectId: g.id, newValue: { bookingRef: row.ref } });
    }
  }

  const notifyParams = {
    kind: "booking",
    listingType: "centre",
    listingId: row.centreId,
    listingName: row.centreName,
    vendorId: row.vendorId,
    guestName: row.name,
    guestEmail: row.email,
    ref: row.ref,
    detailsText: `${row.date} at ${row.time} · ${row.duration}h · ${row.guests} guests`,
    residentId: row.residentId,
  } as const;
  notifyCancellation(notifyParams).catch((e) => console.error("[notifications] provider booking cancellation notify failed:", e));

  // Booking UX Phase 6 (B13) — a provider cancellation refunds a paid online order in full.
  const refund = await refundOnProviderCancel({ table: "bookings", ref: row.ref, actorUserId: input.actorUserId, objectType: "booking", notify: notifyParams });
  return { ok: true, refund: refund.refund, ...(refund.refund === "failed" ? { refundError: refund.error } : {}) };
}

// --- the other provider-cancellable orders (OG-10) -------------------------------
// Same contract as above for a club registration, a programme enrolment and an
// experience booking. Each partner route checks ownership and staff role
// first and passes its organisation's vendor ids; a HelloCircle admin passes
// null. Moved here unchanged from routes/vendorOperations.ts,
// vendorPrograms.ts and vendorExperiences.ts.

type Scope = string[] | null;
const scoped = (col: string, ids: Scope) => (ids === null ? "" : ids.length ? `AND ${col} IN (${ids.map(() => "?").join(", ")})` : "AND 1 = 0");

async function flipToCancelled(table: string, ref: string): Promise<boolean> {
  const flipped = await db.prepare(`UPDATE ${table} SET status = 'cancelled' WHERE ref = ? AND status != 'cancelled'`).run(ref);
  return flipped.changes === 1;
}

export async function cancelRegistrationAsProvider(input: { ref: string; actorUserId: string; vendorIds: Scope; action: string; reason?: string }): Promise<ProviderCancelResult> {
  const row = (await db
    .prepare(
      `SELECT r.ref, r.child_first as childFirst, r.child_last as childLast, r.team, r.status, r.g_first as gFirst, r.g_last as gLast, r.email,
              r.club_id as clubId, c.name as clubName, c.vendor_id as vendorId, r.resident_id as residentId
       FROM registrations r JOIN clubs c ON c.id = r.club_id WHERE r.ref = ? ${scoped("c.vendor_id", input.vendorIds)}`
    )
    .get(input.ref, ...(input.vendorIds ?? []))) as
    | { ref: string; childFirst: string; childLast: string; team: string | null; status: string; gFirst: string; gLast: string; email: string; clubId: string; clubName: string; vendorId: string | null; residentId: string | null }
    | undefined;
  if (!row) return { ok: false, status: 404, error: "Registration not found" };
  if (row.status === "cancelled" || !(await flipToCancelled("registrations", row.ref))) return { ok: false, status: 409, error: "This registration is already cancelled" };
  await writeAudit({ actorUserId: input.actorUserId, action: input.action, objectType: "registration", objectId: row.ref, previousValue: { status: row.status }, newValue: { status: "cancelled" }, reason: input.reason });
  const notifyParams = {
    kind: "registration",
    listingType: "club",
    listingId: row.clubId,
    listingName: row.clubName,
    vendorId: row.vendorId,
    guestName: `${row.gFirst} ${row.gLast}`,
    guestEmail: row.email,
    ref: row.ref,
    detailsText: `${row.childFirst} ${row.childLast}${row.team ? ` · ${row.team}` : ""}`,
    residentId: row.residentId,
  } as const;
  notifyCancellation(notifyParams).catch((e) => console.error("[notifications] provider registration cancellation notify failed:", e));
  promoteNextWaitlistEntry("club", row.clubId, row.clubName);
  const refund = await refundOnProviderCancel({ table: "registrations", ref: row.ref, actorUserId: input.actorUserId, objectType: "registration", notify: notifyParams });
  return { ok: true, refund: refund.refund, ...(refund.refund === "failed" ? { refundError: refund.error } : {}) };
}

export async function cancelProgramEnrollmentAsProvider(input: { ref: string; actorUserId: string; vendorIds: Scope; action: string; reason?: string }): Promise<ProviderCancelResult> {
  const row = (await db
    .prepare(
      `SELECT pe.ref, pe.status, pe.participant_name as participantName, pe.email, pe.resident_id as residentId,
              p.title, p.listing_type as listingType, p.listing_id as listingId, p.vendor_id as vendorId
       FROM program_enrollments pe JOIN programs p ON p.id = pe.program_id WHERE pe.ref = ? ${scoped("p.vendor_id", input.vendorIds)}`
    )
    .get(input.ref, ...(input.vendorIds ?? []))) as
    | { ref: string; status: string; participantName: string; email: string; residentId: string | null; title: string; listingType: "centre" | "club"; listingId: string; vendorId: string }
    | undefined;
  if (!row) return { ok: false, status: 404, error: "Enrollment not found" };
  if (row.status === "cancelled" || !(await flipToCancelled("program_enrollments", row.ref))) return { ok: false, status: 409, error: "This enrollment is already cancelled" };
  await writeAudit({ actorUserId: input.actorUserId, action: input.action, objectType: "program_enrollment", objectId: row.ref, previousValue: { status: row.status }, newValue: { status: "cancelled" }, reason: input.reason });
  const notifyParams = {
    kind: "program",
    listingType: row.listingType,
    listingId: row.listingId,
    listingName: row.title,
    vendorId: row.vendorId,
    guestName: row.participantName,
    guestEmail: row.email,
    ref: row.ref,
    detailsText: row.title,
    residentId: row.residentId,
  } as const;
  notifyCancellation(notifyParams).catch((e) => console.error("[notifications] provider program enrollment cancellation notify failed:", e));
  const refund = await refundOnProviderCancel({ table: "program_enrollments", ref: row.ref, actorUserId: input.actorUserId, objectType: "program_enrollment", notify: notifyParams });
  return { ok: true, refund: refund.refund, ...(refund.refund === "failed" ? { refundError: refund.error } : {}) };
}

export async function cancelExperienceBookingAsProvider(input: { ref: string; actorUserId: string; vendorIds: Scope; action: string; reason?: string }): Promise<ProviderCancelResult> {
  const row = (await db
    .prepare(
      `SELECT eb.ref, eb.status, eb.participant_name as participantName, eb.email, eb.resident_id as residentId, es.date, es.time,
              e.id as experienceId, e.title, e.vendor_id as vendorId
       FROM experience_bookings eb JOIN experience_sessions es ON es.id = eb.session_id JOIN experiences e ON e.id = eb.experience_id
       WHERE eb.ref = ? ${scoped("e.vendor_id", input.vendorIds)}`
    )
    .get(input.ref, ...(input.vendorIds ?? []))) as
    | { ref: string; status: string; participantName: string; email: string; residentId: string | null; date: string; time: string; experienceId: string; title: string; vendorId: string }
    | undefined;
  if (!row) return { ok: false, status: 404, error: "Booking not found" };
  if (row.status === "cancelled" || !(await flipToCancelled("experience_bookings", row.ref))) return { ok: false, status: 409, error: "This booking is already cancelled" };
  await syncOrderFromSource("experience", row.ref);
  await writeAudit({ actorUserId: input.actorUserId, action: input.action, objectType: "experience_booking", objectId: row.ref, previousValue: { status: row.status }, newValue: { status: "cancelled" }, reason: input.reason });
  const notifyParams = {
    kind: "experience",
    listingType: "experience",
    listingId: row.experienceId,
    listingName: row.title,
    vendorId: row.vendorId,
    guestName: row.participantName,
    guestEmail: row.email,
    ref: row.ref,
    detailsText: `${row.date} at ${row.time} · ${row.title}`,
    residentId: row.residentId,
  } as const;
  notifyCancellation(notifyParams).catch((e) => console.error("[notifications] provider experience booking cancellation notify failed:", e));
  const refund = await refundOnProviderCancel({ table: "experience_bookings", ref: row.ref, actorUserId: input.actorUserId, objectType: "experience_booking", notify: notifyParams });
  return { ok: true, refund: refund.refund, ...(refund.refund === "failed" ? { refundError: refund.error } : {}) };
}

export type CancellableOrderKind = "booking" | "registration" | "program" | "experience";

/** OG-10 — a HelloCircle admin cancels an order on the provider's behalf. */
export function cancelOrderOnBehalf(kind: CancellableOrderKind, ref: string, actorUserId: string, reason: string): Promise<ProviderCancelResult> {
  const input = { ref, actorUserId, vendorIds: null, reason };
  if (kind === "booking") return cancelHallBookingAsProvider({ ...input, action: "booking.cancelled_by_admin" });
  if (kind === "registration") return cancelRegistrationAsProvider({ ...input, action: "registration.cancelled_by_admin" });
  if (kind === "program") return cancelProgramEnrollmentAsProvider({ ...input, action: "program_enrollment.cancelled_by_admin" });
  return cancelExperienceBookingAsProvider({ ...input, action: "experience_booking.cancelled_by_admin" });
}
