import { db } from "../db/index.js";
import { readAttendeesFor } from "./attendees.js";

// Pilot remediation (docs/participation-expansion/final-validation/14) — event
// attendance for reports, counted two ways and never guessed:
//
// Bookings (one row per paid, active booking of a past, not-cancelled session):
//   attended  — at least one person on it was checked in at the door, or the
//               organiser marked the booking present;
//   no-show   — the organiser marked the booking "didn't come" and nobody on it
//               was checked in;
//   not recorded — neither.
// People (the booking's active attendees; removed people are left out; a
// booking without attendee rows counts its party size, as everywhere else):
//   attended  — that person has a door check-in (per-person evidence only);
//   no-show   — the booking was marked "didn't come" and that person wasn't
//               checked in (the organiser's record covers the whole booking);
//   not recorded — everyone else: the rest of a partly checked-in group, and
//               people on a booking marked present without per-person check-ins.
// A door check-in outranks a "didn't come" mark on the same booking.

export interface AttendanceCounts { expected: number; attended: number; noShow: number; notRecorded: number }
export interface EventAttendance { bookings: AttendanceCounts; people: AttendanceCounts & { markedPresentNotRecorded: number } }
export type BookingAttendanceState = "attended" | "no_show" | "not_recorded";
export interface EventBookingInput { ref: string; partySize: number; participantName: string }

/** Pure rule for one booking: its active attendee numbers, who was checked in, and the booking-level mark. */
export function classifyEventBooking(activeAttendees: number[], checkedIn: ReadonlySet<number>, mark: string | null) {
  const attended = activeAttendees.filter((n) => checkedIn.has(n)).length;
  const expected = activeAttendees.length;
  let state: BookingAttendanceState;
  let noShow = 0;
  let markedPresentNotRecorded = 0;
  if (attended > 0) state = "attended";
  else if (mark === "no_show") {
    state = "no_show";
    noShow = expected;
  } else if (mark === "present") {
    state = "attended";
    markedPresentNotRecorded = expected;
  } else state = "not_recorded";
  return { state, people: { expected, attended, noShow, notRecorded: expected - attended - noShow, markedPresentNotRecorded } };
}

export const emptyAttendance = (): EventAttendance => ({
  bookings: { expected: 0, attended: 0, noShow: 0, notRecorded: 0 },
  people: { expected: 0, attended: 0, noShow: 0, notRecorded: 0, markedPresentNotRecorded: 0 },
});

/** Loads attendees, door check-ins and booking marks for these bookings and applies the rule. */
export async function eventAttendanceFor(bookings: EventBookingInput[]): Promise<{ total: EventAttendance; byRef: Map<string, ReturnType<typeof classifyEventBooking>> }> {
  const total = emptyAttendance();
  const byRef = new Map<string, ReturnType<typeof classifyEventBooking>>();
  for (let i = 0; i < bookings.length; i += 500) {
    const chunk = bookings.slice(i, i + 500);
    const refs = chunk.map((b) => b.ref);
    const q = refs.map(() => "?").join(", ");
    const people = await readAttendeesFor("experience", chunk);
    const checks = new Map<string, Set<number>>();
    for (const r of (await db.prepare(`SELECT source_ref AS ref, attendee_no AS n FROM attendee_checkins WHERE source_type = 'experience' AND source_ref IN (${q})`).all(...refs)) as { ref: string; n: number }[]) {
      const s = checks.get(r.ref) ?? new Set<number>();
      s.add(Number(r.n));
      checks.set(r.ref, s);
    }
    const marks = new Map<string, string>();
    for (const r of (await db.prepare(`SELECT ref, status FROM attendance WHERE kind = 'experience' AND ref IN (${q})`).all(...refs)) as { ref: string; status: string }[]) marks.set(r.ref, r.status);
    for (const b of chunk) {
      const active = (people.get(b.ref) ?? []).filter((p) => p.status === "active").map((p) => p.attendeeNo);
      if (!active.length) continue; // everyone on it was removed: nothing to expect
      const c = classifyEventBooking(active, checks.get(b.ref) ?? new Set(), marks.get(b.ref) ?? null);
      byRef.set(b.ref, c);
      total.bookings.expected++;
      if (c.state === "attended") total.bookings.attended++;
      else if (c.state === "no_show") total.bookings.noShow++;
      else total.bookings.notRecorded++;
      total.people.expected += c.people.expected;
      total.people.attended += c.people.attended;
      total.people.noShow += c.people.noShow;
      total.people.notRecorded += c.people.notRecorded;
      total.people.markedPresentNotRecorded += c.people.markedPresentNotRecorded;
    }
  }
  return { total, byRef };
}
