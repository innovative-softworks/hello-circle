// One vocabulary for "did this person actually take part?" across the five
// participation tables (Release 3) — registered / attended / no_show /
// cancelled — without merging the tables themselves (see CLAUDE.md's
// "five participant-tracking tables" note). Each table keeps its own raw
// signal; this only interprets it consistently.

export type AttendanceState = "registered" | "attended" | "no_show" | "cancelled";

/** attendance.status values: present/late come from the front-door check-in
 * and program registers; absent/no_show from a host marking someone missing. */
export function fromAttendanceStatus(status: string | null | undefined): AttendanceState | null {
  if (status === "present" || status === "late") return "attended";
  if (status === "absent" || status === "no_show") return "no_show";
  if (status === "cancelled") return "cancelled";
  return null;
}

export function deriveAttendanceState(opts: { cancelled: boolean; attendanceStatus?: string | null; selfReportedAttended?: boolean | null }): AttendanceState {
  if (opts.cancelled) return "cancelled";
  const recorded = fromAttendanceStatus(opts.attendanceStatus);
  if (recorded) return recorded;
  if (opts.selfReportedAttended === true) return "attended";
  if (opts.selfReportedAttended === false) return "no_show";
  return "registered";
}

export const HOST_ATTENDANCE_STATUSES = ["present", "no_show"] as const;
