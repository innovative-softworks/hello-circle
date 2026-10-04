import type { HostOpportunity } from "./types";
import { addDays, irelandDateKey, weekdayOf } from "./irelandDate";

// Create-from-demand prefill (community participation upgrade, Release 6) —
// turns an aggregate demand cluster into the query string each existing
// editor already reads. Only the obvious fields; the host fills the rest.

const DAY_INDEX: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6, weekend: 6 };
const SLOT_TIME: Record<string, string> = { morning: "10:00", afternoon: "14:00", evening: "19:00" };
const DAY_NAMES: Record<string, string> = { mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday", fri: "Friday", sat: "Saturday", sun: "Sunday", weekend: "Weekend", weekday: "Weekday" };

/** Next date (at least tomorrow) falling on the most-wanted day, or "". */
export function suggestedDate(o: Pick<HostOpportunity, "preferredDays">, today = new Date()): string {
  const day = o.preferredDays.find((d) => d in DAY_INDEX);
  if (!day) return "";
  const target = DAY_INDEX[day];
  let iso = addDays(irelandDateKey(today), 1);
  while (weekdayOf(iso) !== target) iso = addDays(iso, 1);
  return iso;
}

export function suggestedTime(o: Pick<HostOpportunity, "preferredTime">): string {
  return (o.preferredTime && SLOT_TIME[o.preferredTime]) || "";
}

/** "Sunday mornings", "Weekend", "" … */
export function describeWhen(o: Pick<HostOpportunity, "preferredDays" | "preferredTime">): string {
  const days = o.preferredDays.map((d) => DAY_NAMES[d]).filter(Boolean);
  const day = days.join(" or ");
  if (day && o.preferredTime) return `${day} ${o.preferredTime}s`;
  return day || (o.preferredTime ? `${o.preferredTime[0].toUpperCase()}${o.preferredTime.slice(1)}s` : "");
}

export function gameHref(o: HostOpportunity, today?: Date): string {
  const p = new URLSearchParams({ activity: o.label, fromDemand: o.clusterKey });
  const date = suggestedDate(o, today);
  const time = suggestedTime(o);
  if (date) p.set("date", date);
  if (time) p.set("time", time);
  return `/games/host?${p}`;
}

export function programHref(o: HostOpportunity): string {
  const p = new URLSearchParams({ title: o.label, fromDemand: o.clusterKey });
  if (o.category) p.set("category", o.category);
  return `/vendor/programs/new?${p}`;
}

export function experienceHref(o: HostOpportunity): string {
  return `/vendor/experiences/new?${new URLSearchParams({ title: o.label, county: o.county, fromDemand: o.clusterKey })}`;
}
