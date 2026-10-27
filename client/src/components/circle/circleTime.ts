import { addDays, irelandToday as irelandTodayIso } from "../../irelandDate";
import { DAYS, SLOTS, type Day, type Slot } from "../../participationVocab";

// Circle Experience 2.0 — labels for Ireland weeks (keyed by their Monday,
// YYYY-MM-DD, from the server) and day:slot tokens. Pure date-string maths,
// so a reader's own timezone never shifts a day.

const DAY_NAMES: Record<Day, string> = { mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday", fri: "Friday", sat: "Saturday", sun: "Sunday" };
const SLOT_WORDS: Record<Slot, string> = { morning: "morning", afternoon: "afternoon", evening: "evening" };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function short(iso: string): string {
  const [, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]}`;
}

/** "This week" / "Next week", by position in the server's [this, next] pair. */
export function weekName(weekStart: string, weeks: readonly string[]): string {
  return weekStart === weeks[0] ? "This week" : weekStart === weeks[1] ? "Next week" : `Week of ${short(weekStart)}`;
}

/** "26 Oct – 1 Nov" */
export function weekRange(weekStart: string): string {
  return `${short(weekStart)} – ${short(addDays(weekStart, 6))}`;
}

/** "sat:morning" → "Saturday morning" */
export function slotLabel(token: string): string {
  const [day, slot] = token.split(":") as [Day, Slot];
  return DAY_NAMES[day] && SLOT_WORDS[slot] ? `${DAY_NAMES[day]} ${SLOT_WORDS[slot]}` : token;
}

/** The calendar date of a day inside a week ("sat" in 2026-10-26 → 2026-10-31). */
export function dateInWeek(weekStart: string, day: Day): string {
  return addDays(weekStart, DAYS.indexOf(day));
}

/** Days of `weekStart` that haven't ended yet, given Ireland's today. */
export function remainingDays(weekStart: string, todayIso: string): Day[] {
  return DAYS.filter((d) => dateInWeek(weekStart, d) >= todayIso);
}

/** Today in Ireland, YYYY-MM-DD (irelandDate.ts owns date maths). */
export function irelandToday(): string {
  return irelandTodayIso();
}

export const ALL_SLOTS = SLOTS;

const ORDER = DAYS.flatMap((d) => SLOTS.map((s) => `${d}:${s}`));
/** day:slot tokens in calendar order (the order the server returns). */
export function orderSlots(tokens: string[]): string[] {
  return [...tokens].sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b));
}

/** "6 members" / "1 member" */
export function people(n: number, noun = "member"): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}
