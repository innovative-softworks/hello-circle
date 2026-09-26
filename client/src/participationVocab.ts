// Community participation upgrade, Release 2 — community goals, recurring
// availability and host-selected participation attributes, plus the display
// helpers. Hand-synced mirror of server/src/participationVocab.ts: keep the
// value lists identical (no shared package between client and server).

// --- Community goals -------------------------------------------------------

export const GOALS = ["Meet people", "Get active", "Learn something", "Explore locally", "Family activities", "Volunteer", "Find a regular group", "Try something new"] as const;
export const MAX_GOALS = 3;

/** Adds or removes a goal, refusing to go past MAX_GOALS (returns the list unchanged). */
export function toggleGoal(current: readonly string[], goal: string): string[] {
  if (current.includes(goal)) return current.filter((g) => g !== goal);
  if (current.length >= MAX_GOALS) return [...current];
  return [...current, goal];
}

// --- Availability ----------------------------------------------------------
// "day:slot" tokens, e.g. "sat:morning". Not a calendar — just when someone
// is usually free.

export const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export const SLOTS = ["morning", "afternoon", "evening"] as const;
export type Day = (typeof DAYS)[number];
export type Slot = (typeof SLOTS)[number];

export const DAY_LABELS: Record<Day, string> = { mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun" };
const DAY_NAMES: Record<Day, string> = { mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday", fri: "Friday", sat: "Saturday", sun: "Sunday" };
export const SLOT_LABELS: Record<Slot, string> = { morning: "Morning", afternoon: "Afternoon", evening: "Evening" };
const WEEKDAYS: Day[] = ["mon", "tue", "wed", "thu", "fri"];

export const token = (d: Day, s: Slot) => `${d}:${s}`;

/** Quick presets — each is just a set of tokens; the grid shows the result. */
export const AVAILABILITY_PRESETS: { label: string; tokens: string[] }[] = [
  { label: "Weekday mornings", tokens: WEEKDAYS.map((d) => token(d, "morning")) },
  { label: "Weekday afternoons", tokens: WEEKDAYS.map((d) => token(d, "afternoon")) },
  { label: "Weekday evenings", tokens: WEEKDAYS.map((d) => token(d, "evening")) },
  { label: "Friday nights", tokens: [token("fri", "evening")] },
  { label: "Saturday mornings", tokens: [token("sat", "morning")] },
  { label: "Saturday afternoons", tokens: [token("sat", "afternoon")] },
  { label: "Saturday evenings", tokens: [token("sat", "evening")] },
  { label: "Sunday mornings", tokens: [token("sun", "morning")] },
  { label: "Sunday afternoons", tokens: [token("sun", "afternoon")] },
  { label: "Sunday evenings", tokens: [token("sun", "evening")] },
];

/** A preset reads as selected only when every one of its tokens is set. */
export function presetSelected(selected: readonly string[], preset: { tokens: string[] }): boolean {
  return preset.tokens.every((t) => selected.includes(t));
}

/** Tapping a fully-selected preset clears its tokens; otherwise adds them all. */
export function togglePreset(selected: readonly string[], preset: { tokens: string[] }): string[] {
  if (presetSelected(selected, preset)) return selected.filter((t) => !preset.tokens.includes(t));
  return sortTokens([...new Set([...selected, ...preset.tokens])]);
}

export function toggleToken(selected: readonly string[], t: string): string[] {
  return selected.includes(t) ? selected.filter((x) => x !== t) : sortTokens([...selected, t]);
}

function sortTokens(tokens: string[]): string[] {
  const order = DAYS.flatMap((d) => SLOTS.map((s) => token(d, s)));
  return order.filter((t) => tokens.includes(t));
}

const plural = (slot: Slot) => `${slot}s`;

/** Plain-language summary for display, e.g. ["Weekday evenings", "Saturday
 * mornings", "Sunday"]. Groups weekdays when all five share a slot, and a
 * weekend day when all three of its slots are set. */
export function describeAvailability(tokens: readonly string[]): string[] {
  const has = (d: Day, s: Slot) => tokens.includes(token(d, s));
  const out: string[] = [];
  const coveredWeekday = new Set<string>();
  for (const s of SLOTS) {
    if (WEEKDAYS.every((d) => has(d, s))) {
      out.push(`Weekday ${plural(s)}`);
      WEEKDAYS.forEach((d) => coveredWeekday.add(token(d, s)));
    }
  }
  for (const d of DAYS) {
    const slots = SLOTS.filter((s) => has(d, s) && !coveredWeekday.has(token(d, s)));
    if (!slots.length) continue;
    if (slots.length === 3) out.push(DAY_NAMES[d]);
    else if (d === "fri" && slots.length === 1 && slots[0] === "evening") out.push("Friday nights");
    else out.push(...slots.map((s) => `${DAY_NAMES[d]} ${plural(s)}`));
  }
  return out;
}

// --- Participation attributes ----------------------------------------------
// Host-selected claims about their own activity — never inferred. Listed in
// display priority: a detail page shows the first three that are set.

export const PARTICIPATION_ATTRIBUTES = [
  { key: "first_timers_welcome", label: "First-timers welcome", hint: "You'll make newcomers feel at home" },
  { key: "come_alone", label: "Come-alone friendly", hint: "Great for someone who doesn't have a partner or group" },
  { key: "beginner_friendly", label: "Beginner friendly", hint: "The pace and level suit beginners" },
  { key: "no_experience", label: "No experience needed", hint: "Nothing to learn beforehand" },
  { key: "host_introduces", label: "Host introduces everyone", hint: "You'll do a quick round of names at the start" },
  { key: "small_group", label: "Small group", hint: "Kept small on purpose" },
  { key: "family_friendly", label: "Family friendly", hint: "Suitable for children with a parent or guardian" },
  { key: "accessible", label: "Accessible", hint: "Add the details in Accessibility below" },
] as const;

const ATTRIBUTE_LABEL = new Map<string, string>(PARTICIPATION_ATTRIBUTES.map((a) => [a.key, a.label]));

export const MAX_PRIMARY_ATTRIBUTES = 3;

/** Known attributes only, in display priority, split into the up-to-three
 * primary ones and the rest. */
export function splitAttributes(keys: readonly string[] | undefined): { primary: string[]; rest: string[] } {
  const ordered = PARTICIPATION_ATTRIBUTES.map((a) => a.key).filter((k) => keys?.includes(k));
  return { primary: ordered.slice(0, MAX_PRIMARY_ATTRIBUTES), rest: ordered.slice(MAX_PRIMARY_ATTRIBUTES) };
}

export function attributeLabel(key: string): string {
  return ATTRIBUTE_LABEL.get(key) ?? key;
}
