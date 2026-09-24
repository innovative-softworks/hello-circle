import type { MyProgramEnrollment } from "./types";

// Resident Experience Polish — extracted out of MyBookings.tsx's Next Up
// merge logic so the "does this program enrollment belong in Next Up"
// predicate is independently testable. A program enrollment only counts as
// an upcoming dated plan when it has a real, non-cancelled, future-or-today
// next session — never fabricated when program_sessions has nothing left.
export function isUpcomingProgramEnrollment(enrollment: Pick<MyProgramEnrollment, "status" | "nextSessionDate">, today: string): boolean {
  return enrollment.status !== "cancelled" && enrollment.nextSessionDate !== null && enrollment.nextSessionDate >= today;
}
