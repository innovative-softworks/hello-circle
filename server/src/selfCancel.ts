// Phase 11B — the ONE place that decides whether a resident may self-cancel
// an experience booking / programme enrolment, and what refund state to
// report. Used by both the cancel routes (authoritative) and the /mine
// lists (so My Life shows "Cancel booking" only when the server would accept
// it). No new refund rule: under Refund Policy A a cancelled, online-paid
// booking stays payment_status='paid' until the provider issues the refund
// through HelloCircle, so its refund state is "pending" until then.
import { irelandWallTimeToUtc } from "./irelandTime.js";

export type RefundState = "none" | "pending" | "refunded";

export interface SelfCancelRow {
  status: string;
  paymentStatus: string;
  totalCents: number | null;
  /** true when the payment went through Stripe (never the session id itself). */
  paidOnline: boolean | number;
}

export function refundStateOf(row: SelfCancelRow): RefundState {
  if (row.paymentStatus === "refunded") return "refunded";
  if (row.status === "cancelled" && row.paymentStatus === "paid" && !!row.paidOnline && (row.totalCents ?? 0) > 0) return "pending";
  return "none";
}

export type CancelBlock = { status: 409; error: string } | null;

/** Programme enrolments: no cut-off (one enrolment covers every session). */
export function programmeCancelBlock(row: Pick<SelfCancelRow, "status" | "paymentStatus">): CancelBlock {
  if (row.status === "cancelled") return { status: 409, error: "This enrollment is already cancelled" };
  if (row.paymentStatus !== "paid") return { status: 409, error: "This enrollment can't be cancelled" };
  return null;
}

/** Experience bookings: the organisation's cancellation cut-off applies. */
export function experienceCancelBlock(row: Pick<SelfCancelRow, "status" | "paymentStatus"> & { date: string; time: string }, cancellationHours: number, now = Date.now()): CancelBlock {
  if (row.status === "cancelled") return { status: 409, error: "This booking is already cancelled" };
  if (row.paymentStatus !== "paid") return { status: 409, error: "This booking can't be cancelled" };
  const sessionStart = irelandWallTimeToUtc(row.date, parseInt(row.time.slice(0, 2), 10));
  if (sessionStart.getTime() - now < cancellationHours * 60 * 60 * 1000) {
    return { status: 409, error: `This booking is within ${cancellationHours} hours and can no longer be cancelled online — please contact the host directly` };
  }
  return null;
}

/** Booking audit 2026-10-11 (B3) — the latest instant a dated booking can
 * still be cancelled or rescheduled online, as an ISO string. */
export function cancelDeadlineIso(date: string, time: string, cancellationHours: number): string {
  const start = irelandWallTimeToUtc(date, parseInt(time.slice(0, 2), 10));
  return new Date(start.getTime() - cancellationHours * 60 * 60 * 1000).toISOString();
}

/** Venue (hall/room) bookings — B3. The venue organisation's cut-off applies
 * to cancelling and rescheduling alike; the wording matches what
 * routes/bookings.ts returned before these rules moved here. */
export function bookingChangeBlock(
  row: Pick<SelfCancelRow, "status" | "paymentStatus"> & { date: string; time: string },
  action: "cancel" | "reschedule",
  cancellationHours: number,
  now = Date.now()
): CancelBlock {
  if (row.status === "cancelled") return { status: 409, error: "This booking is already cancelled" };
  if (row.paymentStatus !== "paid") return { status: 409, error: `This booking can't be ${action === "cancel" ? "cancelled" : "rescheduled"}` };
  const start = irelandWallTimeToUtc(row.date, parseInt(row.time.slice(0, 2), 10));
  if (start.getTime() - now < cancellationHours * 60 * 60 * 1000) {
    return {
      status: 409,
      error: `This booking is within ${cancellationHours} hours and can no longer be ${action === "cancel" ? "cancelled" : "rescheduled"} online — please contact the venue directly`,
    };
  }
  return null;
}

/** Club registrations — B3. No cut-off: a registration isn't one dated slot. */
export function registrationCancelBlock(row: Pick<SelfCancelRow, "status" | "paymentStatus">): CancelBlock {
  if (row.status === "cancelled") return { status: 409, error: "This registration is already cancelled" };
  if (row.paymentStatus !== "paid") return { status: 409, error: "This registration can't be cancelled" };
  return null;
}
