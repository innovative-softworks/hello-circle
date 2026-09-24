import type { VendorScheduleItem } from "./types";

// Vendor Experience Polish — small shared helpers over VendorScheduleItem[]
// (GET /vendor/schedule-items), used by both the Overview "Next Up"/summary
// and, later, the full Schedule tab — kept here rather than duplicated in
// each component.

export const SOURCE_TYPE_LABELS: Record<VendorScheduleItem["sourceType"], string> = {
  centre: "Centre",
  club: "Club",
  program: "Program",
  experience: "Experience",
};

// The Vendor top-level tab keys a schedule item's "Manage" action can land
// on — shared by Overview's Next Up/Coming up and the Calendar tab's own
// list, so both send a vendor to the same place for the same item type.
// A superset of VendorAttention.tsx's own AttentionTargetTab; passing this
// callback into that narrower-typed component works fine (it only ever
// calls it with its own subset of values).
export type VendorScheduleNavTarget = "listings" | "messages" | "demand" | "bookings" | "schedule" | "programs" | "experiences";

export function manageTargetFor(item: VendorScheduleItem): VendorScheduleNavTarget {
  if (item.sourceType === "centre") return "bookings";
  if (item.sourceType === "club") return "schedule";
  if (item.sourceType === "program") return "programs";
  return "experiences";
}

const DUBLIN_TZ = "Europe/Dublin";

function dublinDateKey(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: DUBLIN_TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

/** Ireland-wall-clock YYYY-MM-DD for a schedule item's ISO startDateTime —
 * for grouping into Today/Upcoming and feeding MonthCalendar, which both
 * need a date key, not a full instant. */
export function scheduleItemDateKey(item: VendorScheduleItem): string {
  return dublinDateKey(new Date(item.startDateTime));
}

/** Today's Ireland-wall-clock YYYY-MM-DD, for comparing against
 * scheduleItemDateKey() above without constructing a fake item. */
export function todayDateKey(): string {
  return dublinDateKey(new Date());
}

/** "Today · 18:00" / "Tomorrow · 10:00" / "Sat 26 Sep · 19:00" — Ireland
 * wall-clock display for a schedule item's ISO startDateTime. */
export function formatScheduleWhen(iso: string): string {
  const d = new Date(iso);
  const dayKey = dublinDateKey(d);
  const todayKey = dublinDateKey(new Date());
  const tomorrowKey = dublinDateKey(new Date(Date.now() + 24 * 60 * 60 * 1000));
  const time = d.toLocaleTimeString("en-IE", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: DUBLIN_TZ });
  const dayLabel =
    dayKey === todayKey
      ? "Today"
      : dayKey === tomorrowKey
        ? "Tomorrow"
        : d.toLocaleDateString("en-IE", { weekday: "short", day: "numeric", month: "short", timeZone: DUBLIN_TZ });
  return `${dayLabel} · ${time}`;
}

/** "18 guests" / "24 enrolled" / "12 booked" — the one count each source
 * type genuinely supports (see GET /vendor/schedule-items's own comment on
 * why club sessions have neither); null when there's nothing honest to show. */
export function formatScheduleCount(item: VendorScheduleItem): string | null {
  if (item.sourceType === "centre" && item.participantCount !== null) return `${item.participantCount} guest${item.participantCount === 1 ? "" : "s"}`;
  if (item.sourceType === "program" && item.participantCount !== null) return `${item.participantCount} enrolled`;
  if (item.sourceType === "experience" && item.bookingCount !== null) return `${item.bookingCount} booked`;
  return null;
}

/** "You have 6 bookings and 3 activities coming up this week." — deliberately
 * doesn't assume every vendor owns a venue: a centre booking is called out
 * as a "booking", everything else (club/program/experience sessions) as an
 * "activity", and either clause is dropped entirely if that vendor has none
 * of that kind. */
export function summarizeUpcomingWeek(items: VendorScheduleItem[]): string {
  const weekAheadIso = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const withinWeek = items.filter((i) => i.startDateTime <= weekAheadIso);
  const bookings = withinWeek.filter((i) => i.sourceType === "centre").length;
  const activities = withinWeek.filter((i) => i.sourceType !== "centre").length;

  const parts: string[] = [];
  if (bookings > 0) parts.push(`${bookings} booking${bookings === 1 ? "" : "s"}`);
  if (activities > 0) parts.push(`${activities} activit${activities === 1 ? "y" : "ies"}`);
  if (parts.length === 0) return "Nothing scheduled yet.";
  return `You have ${parts.join(" and ")} coming up this week.`;
}
