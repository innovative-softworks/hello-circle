import type { ScheduledActivity } from "./db/queries.js";

// Experience 3.0 — the deterministic rules behind "Find something for me",
// "Going solo", "Surprise me" and Explore collections. Pure functions over
// already-eligible listings (listScheduledActivities only returns real,
// published, discoverable, sellable things), so every rule is unit tested
// in discoveryMatch.test.ts. Nothing here invents a duration, a suitability
// label or a confidence score: every reason is a fact the listing states.

export type PartOfDay = "morning" | "afternoon" | "evening";
export const PARTS_OF_DAY: PartOfDay[] = ["morning", "afternoon", "evening"];

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** Same boundaries as Free Time Match and For You's "when you're free". */
export function partOfDay(time: string): PartOfDay {
  const hour = Number(time.split(":")[0]);
  return hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening";
}

function dayOfWeek(dateIso: string): number {
  return new Date(`${dateIso}T12:00:00Z`).getUTCDay();
}

function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

export type When = "today" | "tomorrow" | "weekend" | string;

/** The dates a "when" choice covers, from Ireland's today. "weekend" is the
 * coming Saturday and Sunday (today and tomorrow if it's already Saturday;
 * just today on a Sunday). A YYYY-MM-DD is that single day. */
export function datesFor(when: When, todayIso: string): string[] | null {
  if (when === "today") return [todayIso];
  if (when === "tomorrow") return [addDays(todayIso, 1)];
  if (when === "weekend") {
    const dow = dayOfWeek(todayIso);
    if (dow === 0) return [todayIso];
    const sat = addDays(todayIso, 6 - dow);
    return [sat, addDays(sat, 1)];
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(when) && when >= todayIso) return [when];
  return null;
}

/** Host-set attributes that honestly support "you can come on your own". */
export const SOLO_ATTRIBUTES = ["come_alone", "first_timers_welcome", "host_introduces"] as const;
export const BEGINNER_ATTRIBUTES = ["beginner_friendly", "no_experience", "first_timers_welcome"] as const;

export interface MatchInput {
  dates?: string[] | null;
  partsOfDay?: PartOfDay[];
  maxPriceCents?: number | null;
  solo?: boolean;
  maxMinutes?: number | null;
}

export interface MatchResult<T> {
  item: T;
  reasons: string[];
}

/** Keeps only listings that satisfy every input, and says why each fits.
 * A listing with no stated length is never claimed to fit a time window. */
export function matchListings<T extends ScheduledActivity>(items: T[], input: MatchInput, attributesOf: (item: T) => readonly string[]): MatchResult<T>[] {
  const out: MatchResult<T>[] = [];
  for (const item of items) {
    const reasons: string[] = [];
    if (input.dates && input.dates.length) {
      if (!input.dates.includes(item.date)) continue;
    }
    const pod = partOfDay(item.time);
    if (input.partsOfDay && input.partsOfDay.length) {
      if (!input.partsOfDay.includes(pod)) continue;
    }
    if ((input.dates && input.dates.length) || (input.partsOfDay && input.partsOfDay.length)) reasons.push(`On ${DAY_NAMES[dayOfWeek(item.date)]} ${pod}`);
    if (input.maxMinutes != null) {
      if (!item.durationKnown || item.durationMinutes > input.maxMinutes) continue;
      reasons.push(`Takes about ${formatMinutes(item.durationMinutes)}`);
    }
    if (input.maxPriceCents != null) {
      const price = item.priceCents ?? 0;
      if (price > input.maxPriceCents) continue;
      reasons.push(price === 0 ? "Free" : `Within your €${Math.round(input.maxPriceCents / 100)} budget`);
    }
    if (input.solo) {
      const attrs = attributesOf(item);
      const hit = SOLO_ATTRIBUTES.find((a) => attrs.includes(a));
      if (!hit) continue;
      reasons.push(hit === "come_alone" ? "Host says people often come on their own" : hit === "first_timers_welcome" ? "Host says first-timers are welcome" : "Host introduces people at the start");
    }
    out.push({ item, reasons });
  }
  return out;
}

export function formatMinutes(min: number): string {
  if (min < 60) return `${min} min`;
  const h = min / 60;
  return Number.isInteger(h) ? `${h} hour${h === 1 ? "" : "s"}` : `${Math.round(h * 2) / 2} hours`;
}

/** "Surprise me": one suggestion from the best-ranked eligible pool, never
 * one already shown in this session. `random` is injectable for tests. */
export function pickSurprise<T extends { id: string }>(ranked: T[], exclude: ReadonlySet<string>, random: () => number = Math.random, poolSize = 10): T | null {
  const pool = ranked.filter((r) => !exclude.has(r.id)).slice(0, poolSize);
  if (pool.length === 0) return null;
  return pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))];
}

// --- Collections and occasions ----------------------------------------------

export interface Collection<T> {
  key: string;
  title: string;
  description: string;
  items: T[];
}

/** Explore collections. Each is defined by a fact the listing states (price,
 * a host-set attribute, its kind, its date) and is dropped when empty. No
 * "local favourites" or "date night": nothing in the data supports them. */
export function buildCollections<T extends ScheduledActivity>(items: T[], attributesOf: (item: T) => readonly string[], todayIso: string, limit = 8): Collection<T>[] {
  const weekend = new Set(datesFor("weekend", todayIso) ?? []);
  const has = (i: T, list: readonly string[]) => attributesOf(i).some((a) => list.includes(a));
  const defs: Collection<T>[] = [
    { key: "this_weekend", title: "This weekend", description: "Happening on the coming Saturday and Sunday.", items: items.filter((i) => weekend.has(i.date)) },
    { key: "free", title: "Free", description: "No charge to take part.", items: items.filter((i) => !i.priceCents) },
    { key: "under_20", title: "Under €20", description: "Paid, and €20 or less per person.", items: items.filter((i) => !!i.priceCents && i.priceCents <= 2000) },
    { key: "beginner", title: "Beginner-friendly", description: "The host says no experience is needed or beginners are welcome.", items: items.filter((i) => has(i, BEGINNER_ATTRIBUTES)) },
    { key: "family_day", title: "Family day", description: "The host says it suits families.", items: items.filter((i) => has(i, ["family_friendly"])) },
    { key: "outdoors", title: "Outdoors", description: "Guided adventures.", items: items.filter((i) => i.experienceKind === "adventure") },
    { key: "solo", title: "Good on your own", description: "The host says people come on their own or first-timers are welcome.", items: items.filter((i) => has(i, SOLO_ATTRIBUTES)) },
  ];
  return defs.map((d) => ({ ...d, items: d.items.slice(0, limit) })).filter((d) => d.items.length > 0);
}
