import { addDays, weekdayOf } from "./irelandDate";

/** What a listing's price really says. Only a stated 0 is free: a missing
 * price is unknown for every kind (owner, 2026-10-28) — e.g. a game whose
 * host left the optional price blank, or a club session (0 arrives as null). */
export function priceState(item: { kind?: string; priceCents: number | null | undefined }): "free" | "paid" | "unknown" {
  if (item.priceCents === null || item.priceCents === undefined) return "unknown";
  return item.priceCents > 0 ? "paid" : "free";
}

// Explore's When filter — pure, so it can be tested on fixed dates.

/** Whether an activity dated `date` at `time` (Ireland wall clock) falls in
 * the chosen When window. `today` is Ireland's today. Unknown values match. */
export function matchesWhen(item: { date: string; time: string }, when: string, today: string): boolean {
  const weekend = () => {
    const dow = weekdayOf(item.date);
    return dow === 0 || dow === 6;
  };
  switch (when) {
    case "today":
      return item.date === today;
    case "tonight":
      return item.date === today && item.time >= "17:00";
    case "tomorrow":
      return item.date === addDays(today, 1);
    case "weekend":
      return weekend() && item.date >= today && item.date <= addDays(today, 7);
    case "week":
      return item.date >= today && item.date <= addDays(today, 6);
    default:
      return true;
  }
}
