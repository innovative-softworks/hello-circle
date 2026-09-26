import type { MyProgramEnrollment } from "./types";

// Resident Experience Polish — extracted out of MyBookings.tsx's Next Up
// merge logic so the "does this program enrollment belong in Next Up"
// predicate is independently testable. A program enrollment only counts as
// an upcoming dated plan when it has a real, non-cancelled, future-or-today
// next session — never fabricated when program_sessions has nothing left.
export function isUpcomingProgramEnrollment(enrollment: Pick<MyProgramEnrollment, "status" | "nextSessionDate">, today: string): boolean {
  return enrollment.status !== "cancelled" && enrollment.nextSessionDate !== null && enrollment.nextSessionDate >= today;
}

// Feedback gating (community participation upgrade, Release 1) — a program
// enrollment only gets the "how was it?" prompt once a session has
// happened, and not when the vendor's register shows every recorded session
// as missed. No register at all (both counts 0) is "unknown", which keeps
// the prompt: vendors don't always take one, and hiding feedback from people
// who did attend would be the worse failure.
export function shouldPromptProgramFeedback(
  enrollment: Pick<MyProgramEnrollment, "status" | "hasPastSession" | "sessionsAttended" | "sessionsMissed">
): boolean {
  if (enrollment.status === "cancelled" || !enrollment.hasPastSession) return false;
  const attended = enrollment.sessionsAttended ?? 0;
  const missed = enrollment.sessionsMissed ?? 0;
  return !(missed > 0 && attended === 0);
}

// Attendance state (Release 3) — client mirror of server/src/attendanceState.ts.
// One vocabulary across bookings/registrations/experiences/programs/games.
export type AttendanceState = "registered" | "attended" | "no_show" | "cancelled";

export function attendanceStateOf(opts: { cancelled: boolean; attendance?: string | null; selfReportedAttended?: boolean | null }): AttendanceState {
  if (opts.cancelled) return "cancelled";
  if (opts.attendance === "present" || opts.attendance === "late") return "attended";
  if (opts.attendance === "absent" || opts.attendance === "no_show") return "no_show";
  if (opts.selfReportedAttended === true) return "attended";
  if (opts.selfReportedAttended === false) return "no_show";
  return "registered";
}

/** "How was it?" appears once the activity has happened, for anyone who
 * attended or whose attendance simply wasn't recorded — never for a
 * cancellation or a host-recorded no-show. */
export function shouldPromptFeedback(state: AttendanceState, hasHappened: boolean): boolean {
  return hasHappened && (state === "attended" || state === "registered");
}
