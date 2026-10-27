import { DAYS, SLOTS } from "./participationVocab.js";
import { endOfIrelandDay, irelandTodayIso } from "./irelandTime.js";

// Circle Experience 2.0 — the pure, deterministic part of Circle Pulse, Free
// Time Match and Make It Happen. No DB access here, so every rule is unit
// tested in circlePlanning.test.ts. Weeks are Ireland weeks (Monday–Sunday,
// Europe/Dublin wall clock), keyed by their Monday as YYYY-MM-DD.

/** Others only see a Pulse interest once this many members share it, so a
 * single person's wish in a small Circle can't be traced back to them. */
export const PULSE_MIN_VISIBLE = 2;
/** A Free Time Match is only claimed when at least this many members line up. */
export const MATCH_MIN_GROUP = 3;
/** A plan idea with no target counts as "ready for review" at this many. */
export const DEFAULT_PLAN_TARGET = 3;
export const MAX_PLAN_TARGET = 100;
/** An unconfirmed plan idea with no date stops gathering interest after this. */
export const PLAN_IDEA_DEFAULT_DAYS = 21;

export const INTEREST_MAX_LENGTH = 60;
export const PULSE_NOTE_MAX_LENGTH = 280;

const SLOT_SET = new Set<string>(DAYS.flatMap((d) => SLOTS.map((s) => `${d}:${s}`)));

function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return t.toISOString().slice(0, 10);
}

/** Monday of the Ireland week containing `dateIso`. Pure calendar maths on
 * the date string, so DST never shifts it. */
export function weekStartOf(dateIso: string): string {
  const [y, m, d] = dateIso.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday
  return addDaysIso(dateIso, dow === 0 ? -6 : 1 - dow);
}

/** This week and next week — the only weeks a member can choose. */
export function selectableWeeks(todayIso: string = irelandTodayIso()): [string, string] {
  const thisWeek = weekStartOf(todayIso);
  return [thisWeek, addDaysIso(thisWeek, 7)];
}

export function isSelectableWeek(weekStart: string, todayIso: string = irelandTodayIso()): boolean {
  return selectableWeeks(todayIso).includes(weekStart);
}

/** The last instant of that week's Sunday, Ireland time, as a UTC Date. */
export function weekExpiry(weekStart: string): Date {
  return endOfIrelandDay(addDaysIso(weekStart, 6));
}

/** The calendar date of a day token inside a given week ("sat" → 2026-10-31). */
export function dateOfDay(weekStart: string, day: string): string {
  const i = (DAYS as readonly string[]).indexOf(day);
  return addDaysIso(weekStart, i < 0 ? 0 : i);
}

/** Valid day:slot tokens, deduped, in calendar order. Unknown values are
 * dropped. Slots on days already over this week are dropped too. */
export function cleanSlots(values: unknown, weekStart?: string, todayIso: string = irelandTodayIso()): string[] {
  const list = Array.isArray(values) ? values : typeof values === "string" ? values.split(",") : [];
  const set = new Set(list.filter((v): v is string => typeof v === "string").map((v) => v.trim()));
  return [...SLOT_SET].filter((t) => set.has(t) && (!weekStart || dateOfDay(weekStart, t.split(":")[0]) >= todayIso));
}

export function parseSlots(csv: string | null | undefined): string[] {
  return csv ? csv.split(",").filter((t) => SLOT_SET.has(t)) : [];
}

/** "  Sea  swimming " → "sea swimming". The label people see keeps its case. */
export function normaliseInterest(label: string): string {
  return label.trim().replace(/\s+/g, " ").toLowerCase().slice(0, INTEREST_MAX_LENGTH);
}

export function cleanInterestLabel(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const label = raw.trim().replace(/\s+/g, " ");
  if (label.length < 2 || label.length > INTEREST_MAX_LENGTH) return null;
  return label;
}

// --- Circle Pulse aggregation ---------------------------------------------

export interface PulseRow {
  residentId: string;
  interest: string;
  interestKey: string;
  weekStart: string;
  slots: string[];
}

export interface PulseGroup {
  interestKey: string;
  /** The most common spelling members used. */
  interest: string;
  weekStart: string;
  /** null when below the visibility threshold for this viewer. */
  count: number | null;
  mine: boolean;
  /** The day:slot most of them picked, once the group is visible; null otherwise. */
  topSlot: string | null;
  /** How many of them picked topSlot (null when hidden). */
  topSlotCount: number | null;
}

/** Groups Pulse rows by (week, interest) for one viewer. A group the viewer
 * isn't in and that has fewer than PULSE_MIN_VISIBLE members is left out
 * entirely; a group the viewer IS in but is alone in comes back with
 * count null ("only you so far"). Never returns who. */
export function aggregatePulse(rows: PulseRow[], viewerId: string | null): PulseGroup[] {
  const groups = new Map<string, PulseRow[]>();
  for (const r of rows) {
    const k = `${r.weekStart}|${r.interestKey}`;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  const out: PulseGroup[] = [];
  for (const members of groups.values()) {
    const people = new Set(members.map((m) => m.residentId));
    const mine = !!viewerId && people.has(viewerId);
    const visible = people.size >= PULSE_MIN_VISIBLE;
    if (!visible && !mine) continue;
    const spellings = new Map<string, number>();
    for (const m of members) spellings.set(m.interest, (spellings.get(m.interest) ?? 0) + 1);
    // Most used spelling; on a tie a capitalised one (reads as a label),
    // then whoever said it first (rows arrive in creation order).
    const capital = (v: string) => Number(/^\p{Lu}/u.test(v));
    const interest = [...spellings.entries()].sort((a, b) => b[1] - a[1] || capital(b[0]) - capital(a[0]))[0][0];
    let topSlot: string | null = null;
    let topSlotCount: number | null = null;
    if (visible) {
      const slotCounts = new Map<string, number>();
      for (const m of members) for (const s of new Set(m.slots)) slotCounts.set(s, (slotCounts.get(s) ?? 0) + 1);
      const best = [...slotCounts.entries()].sort((a, b) => b[1] - a[1] || slotOrder(a[0]) - slotOrder(b[0]))[0];
      if (best && best[1] >= PULSE_MIN_VISIBLE) [topSlot, topSlotCount] = best;
    }
    out.push({ interestKey: members[0].interestKey, interest, weekStart: members[0].weekStart, count: visible ? people.size : null, mine, topSlot, topSlotCount });
  }
  return out.sort((a, b) => a.weekStart.localeCompare(b.weekStart) || (b.count ?? 0) - (a.count ?? 0) || a.interest.localeCompare(b.interest));
}

const SLOT_LIST = [...SLOT_SET];
function slotOrder(token: string): number {
  return SLOT_LIST.indexOf(token);
}

// --- Free Time Match -------------------------------------------------------

export interface AvailabilityRow {
  residentId: string;
  weekStart: string;
  slots: string[];
}

export interface FreeTimeMatch {
  weekStart: string;
  slot: string;
  /** Members free in this slot who also want to do `interest` (null = just free). */
  interest: string | null;
  interestKey: string | null;
  count: number;
  includesMe: boolean;
}

/**
 * Deterministic overlap, per week:
 *  - interest matches: members with a Pulse for an interest who are free in a
 *    slot — free means the slot is in their shared availability, or in the
 *    slots they picked on the Pulse itself;
 *  - plain free-time matches: members whose shared availability overlaps.
 * Only groups of MATCH_MIN_GROUP or more are returned, best first, so the
 * feature never claims a match the data doesn't support.
 */
export function matchFreeTime(pulses: PulseRow[], availability: AvailabilityRow[], viewerId: string | null, limit = 6): FreeTimeMatch[] {
  const freeBy = new Map<string, Set<string>>(); // week|slot -> residents
  const addFree = (week: string, slot: string, who: string) => {
    const k = `${week}|${slot}`;
    if (!freeBy.has(k)) freeBy.set(k, new Set());
    freeBy.get(k)!.add(who);
  };
  for (const a of availability) for (const s of a.slots) addFree(a.weekStart, s, a.residentId);

  const results: FreeTimeMatch[] = [];

  const interestGroups = new Map<string, PulseRow[]>();
  for (const p of pulses) {
    const k = `${p.weekStart}|${p.interestKey}`;
    interestGroups.set(k, [...(interestGroups.get(k) ?? []), p]);
  }
  for (const rows of interestGroups.values()) {
    const { weekStart, interestKey } = rows[0];
    const label = aggregatePulse(rows, null)[0]?.interest ?? rows[0].interest;
    const bySlot = new Map<string, Set<string>>();
    for (const r of rows) {
      const own = new Set(r.slots);
      for (const slot of SLOT_LIST) {
        if (own.has(slot) || freeBy.get(`${weekStart}|${slot}`)?.has(r.residentId)) {
          if (!bySlot.has(slot)) bySlot.set(slot, new Set());
          bySlot.get(slot)!.add(r.residentId);
        }
      }
    }
    for (const [slot, who] of bySlot) {
      if (who.size >= MATCH_MIN_GROUP) results.push({ weekStart, slot, interest: label, interestKey, count: who.size, includesMe: !!viewerId && who.has(viewerId) });
    }
  }

  for (const [k, who] of freeBy) {
    if (who.size < MATCH_MIN_GROUP) continue;
    const [weekStart, slot] = k.split("|");
    results.push({ weekStart, slot, interest: null, interestKey: null, count: who.size, includesMe: !!viewerId && who.has(viewerId) });
  }

  // Best first: interest matches before plain free time, bigger groups,
  // earlier week, earlier slot. Keep only the best slot per interest so one
  // popular interest doesn't fill the list with every slot it touches.
  results.sort(
    (a, b) =>
      Number(b.interest !== null) - Number(a.interest !== null) ||
      b.count - a.count ||
      a.weekStart.localeCompare(b.weekStart) ||
      slotOrder(a.slot) - slotOrder(b.slot)
  );
  const seen = new Set<string>();
  const out: FreeTimeMatch[] = [];
  for (const r of results) {
    const key = r.interestKey ? `${r.weekStart}|i:${r.interestKey}` : `${r.weekStart}|s:${r.slot}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
    if (out.length >= limit) break;
  }
  return out;
}

// --- Make It Happen: plan stage --------------------------------------------

export type PlanStage = "gathering" | "ready" | "confirmed" | "activity_created" | "completed" | "cancelled" | "expired";

/** What a plan idea is doing right now. Stored status stays the source of
 * truth for idea/confirmed/activity_created/cancelled; gathering/ready/
 * expired are derived from interest and dates, never stored. */
export function planStage(input: { status: string; interestCount: number; targetSize: number | null; expiresAt: string | Date | null; now?: Date }): PlanStage {
  const { status } = input;
  if (status === "completed" || status === "activity_created" || status === "cancelled" || status === "confirmed") return status as PlanStage;
  const now = input.now ?? new Date();
  if (input.expiresAt && new Date(input.expiresAt).getTime() < now.getTime()) return "expired";
  return input.interestCount >= (input.targetSize ?? DEFAULT_PLAN_TARGET) ? "ready" : "gathering";
}

/** An unconfirmed idea gathers interest until the end of its proposed day,
 * or for PLAN_IDEA_DEFAULT_DAYS when it has no date. */
export function planIdeaExpiry(proposedDate: string | null | undefined, now: Date = new Date()): Date {
  if (proposedDate && /^\d{4}-\d{2}-\d{2}$/.test(proposedDate)) return endOfIrelandDay(proposedDate);
  return new Date(now.getTime() + PLAN_IDEA_DEFAULT_DAYS * 86400000);
}

export function cleanTargetSize(raw: unknown): number | null | { error: string } {
  if (raw === undefined || raw === null || raw === "") return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 2 || n > MAX_PLAN_TARGET) return { error: `Group size must be a whole number between 2 and ${MAX_PLAN_TARGET}` };
  return n;
}

export interface FreeDay {
  /** YYYY-MM-DD, Ireland calendar date. */
  date: string;
  /** Members free that day — null when fewer than MATCH_MIN_GROUP (or the day is past). */
  free: number | null;
  past: boolean;
  /** The day (or tied days) with the most people free; never a past day. */
  best: boolean;
}

/** "Who's free" from today to the end of next week — the span wishes and
 * shared free time can cover (Circle Home planner, owner 2026-10-24):
 * distinct members free on each date, counting both shared free time and the
 * times on their wishes. Totals only, from MATCH_MIN_GROUP up, exactly like
 * Free Time Match. 8 to 14 days depending on the weekday. */
export function freeDays(availability: AvailabilityRow[], pulses: PulseRow[], todayIso: string = irelandTodayIso()): FreeDay[] {
  const [thisWeek] = selectableWeeks(todayIso);
  const who = new Map<string, Set<string>>();
  const add = (weekStart: string, slots: string[], residentId: string) => {
    for (const s of slots) {
      const i = (DAYS as readonly string[]).indexOf(s.split(":")[0]);
      if (i < 0) continue;
      const date = addDaysIso(weekStart, i);
      if (!who.has(date)) who.set(date, new Set());
      who.get(date)!.add(residentId);
    }
  };
  for (const a of availability) add(a.weekStart, a.slots, a.residentId);
  for (const p of pulses) add(p.weekStart, p.slots, p.residentId);
  const days = Array.from({ length: 14 }, (_, i) => addDaysIso(thisWeek, i))
    .filter((date) => date >= todayIso)
    .map((date) => {
    const past = date < todayIso;
    const n = who.get(date)?.size ?? 0;
      return { date, past, free: !past && n >= MATCH_MIN_GROUP ? n : null, best: false };
    });
  const top = Math.max(0, ...days.map((d) => d.free ?? 0));
  if (top > 0) for (const d of days) d.best = d.free === top;
  return days;
}
