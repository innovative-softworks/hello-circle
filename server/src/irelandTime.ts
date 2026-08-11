const DUBLIN_TZ = "Europe/Dublin";

/** Minutes Europe/Dublin is ahead of UTC at the given instant — 0 in winter
 * (GMT), 60 in summer (IST/BST, roughly late March–late October). Computed
 * via Intl so the DST transition dates are handled correctly without a
 * timezone-database dependency. */
function dublinOffsetMinutes(atUtc: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: DUBLIN_TZ,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(atUtc);
  const get = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  const asIfUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"), get("second"));
  return Math.round((asIfUtc - atUtc.getTime()) / 60000);
}

/** Converts a wall-clock date + time *as experienced in Ireland* into the
 * absolute UTC instant it represents — e.g. "2026-08-15" 14:00 is 13:00 UTC
 * in summer (BST) but 14:00 UTC in winter (GMT). Two-pass: guess as if the
 * wall time were already UTC, then correct by the real Dublin offset at
 * that guess (accurate outside the ~1hr DST-transition window itself). */
export function irelandWallTimeToUtc(dateStr: string, hour = 0, minute = 0, second = 0): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  const guess = new Date(Date.UTC(y, m - 1, d, hour, minute, second));
  const offsetMin = dublinOffsetMinutes(guess);
  return new Date(guess.getTime() - offsetMin * 60000);
}

/** The last instant (23:59:59.999) of a given calendar date, as experienced
 * in Ireland — "expires on this date" should mean valid through the end of
 * that day in Ireland, not midnight UTC. */
export function endOfIrelandDay(dateStr: string): Date {
  return new Date(irelandWallTimeToUtc(dateStr, 23, 59, 59).getTime() + 999);
}
