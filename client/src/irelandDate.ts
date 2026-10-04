// HC-QA-077 / HC-QA-100 — the ONE place the client decides what calendar day
// it is, and does calendar arithmetic. HelloCircle serves Ireland, so "today"
// is the Europe/Dublin date (GMT in winter, IST = UTC+1 in summer), matching
// the server's irelandTime.ts — never the UTC date and never the device's own
// timezone.
//
// Dates are "YYYY-MM-DD" strings (the shape the API uses). Arithmetic on them
// is pure calendar maths in UTC, so it gives the same answer on any device:
// don't build `new Date("YYYY-MM-DDT00:00:00")` (local midnight) and read it
// back with toISOString() — east of UTC that lands on the previous day.

export const IRELAND_TIME_ZONE = "Europe/Dublin";

const dateKeyFormat = new Intl.DateTimeFormat("en-CA", { timeZone: IRELAND_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" });

/** The Ireland calendar date ("YYYY-MM-DD") of an instant (default: now). */
export function irelandDateKey(instant: Date | number = Date.now()): string {
  return dateKeyFormat.format(instant);
}

/** Today's date in Ireland, "YYYY-MM-DD". */
export function irelandToday(): string {
  return irelandDateKey();
}

function parts(isoDate: string): [number, number, number] {
  const [y, m, d] = isoDate.split("-").map(Number);
  return [y, m, d];
}

/** Calendar arithmetic: `isoDate` plus `days` (may be negative). */
export function addDays(isoDate: string, days: number): string {
  const [y, m, d] = parts(isoDate);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Calendar arithmetic: `isoDate` plus `months`, with JS Date's overflow rule (31 Jan + 1 month → 3 Mar). */
export function addMonths(isoDate: string, months: number): string {
  const [y, m, d] = parts(isoDate);
  return new Date(Date.UTC(y, m - 1 + months, d)).toISOString().slice(0, 10);
}

/** The Ireland date `days` from today. */
export function irelandDaysFromToday(days: number): string {
  return addDays(irelandToday(), days);
}

/** First day of the current Ireland month, "YYYY-MM-01". */
export function irelandMonthStart(): string {
  return `${irelandToday().slice(0, 7)}-01`;
}

/** Day of week of a calendar date: 0 = Sunday … 6 = Saturday. */
export function weekdayOf(isoDate: string): number {
  const [y, m, d] = parts(isoDate);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** Whole calendar days from `fromIso` to `toIso` (negative if earlier). */
export function daysBetween(fromIso: string, toIso: string): number {
  const [y1, m1, d1] = parts(fromIso);
  const [y2, m2, d2] = parts(toIso);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000);
}

export type Repeat = "none" | "weekly" | "biweekly" | "monthly";

/** The dates of a schedule starting on `startIso` (the picked date is always the first). */
export function occurrenceDates(startIso: string, repeat: Repeat, count: number): string[] {
  const n = repeat === "none" ? 1 : count;
  return Array.from({ length: n }, (_, i) =>
    repeat === "weekly" ? addDays(startIso, 7 * i) : repeat === "biweekly" ? addDays(startIso, 14 * i) : repeat === "monthly" ? addMonths(startIso, i) : startIso,
  );
}
