// Community participation upgrade, Release 2 — the shared vocabulary for
// community goals, recurring availability and host-selected participation
// attributes. Hand-synced mirror of client/src/participationVocab.ts (no
// shared package between client and server — see CLAUDE.md); keep the two
// lists identical.

// --- Community goals -------------------------------------------------------
// "What do I want to do?" — distinct from interests ("what do I like?").

export const GOALS = ["Meet people", "Get active", "Learn something", "Explore locally", "Family activities", "Volunteer", "Find a regular group", "Try something new"] as const;
export const MAX_GOALS = 3;

/** The pre-Release-2 vocabulary, mapped to its closest new value. Still
 * accepted on write for one release so an installed native build running
 * the old bundle keeps working (it's converted, never stored as-is). */
export const LEGACY_GOAL_MAP: Record<string, string> = {
  "Become more active": "Get active",
  "Meet new people": "Meet people",
  "Find a hobby": "Learn something",
  "Get outdoors": "Get active",
  "Try something new": "Try something new",
  "Do more with family": "Family activities",
  "Build a routine": "Find a regular group",
  "Explore my area": "Explore locally",
};

const GOAL_SET = new Set<string>(GOALS);

/** New or legacy values in, deduped new values out (order kept), capped at
 * MAX_GOALS. Unknown values are dropped rather than rejected — onboarding
 * never gates anything. */
export function normalizeGoals(values: readonly string[]): string[] {
  const out: string[] = [];
  for (const v of values) {
    const mapped = GOAL_SET.has(v) ? v : LEGACY_GOAL_MAP[v];
    if (mapped && !out.includes(mapped)) out.push(mapped);
  }
  return out.slice(0, MAX_GOALS);
}

// --- Availability ----------------------------------------------------------
// Lightweight recurring preference, not a calendar: a set of "day:slot"
// tokens, e.g. "sat:morning". Stored comma-joined like before.

export const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export const SLOTS = ["morning", "afternoon", "evening"] as const;
const TOKEN_SET = new Set<string>(DAYS.flatMap((d) => SLOTS.map((s) => `${d}:${s}`)));
const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri"];

export const LEGACY_AVAILABILITY_MAP: Record<string, string[]> = {
  "Weekday mornings": WEEKDAYS.map((d) => `${d}:morning`),
  "Weekday afternoons": WEEKDAYS.map((d) => `${d}:afternoon`),
  "Weekday evenings": WEEKDAYS.map((d) => `${d}:evening`),
  Saturday: SLOTS.map((s) => `sat:${s}`),
  Sunday: SLOTS.map((s) => `sun:${s}`),
};

/** New tokens or legacy labels in, deduped tokens out, in calendar order. */
export function normalizeAvailability(values: readonly string[]): string[] {
  const set = new Set<string>();
  for (const v of values) {
    if (TOKEN_SET.has(v)) set.add(v);
    else for (const t of LEGACY_AVAILABILITY_MAP[v] ?? []) set.add(t);
  }
  return [...TOKEN_SET].filter((t) => set.has(t));
}

// --- Participation attributes ----------------------------------------------
// Host-selected, never inferred or auto-applied: these are claims the host
// explicitly makes about their own activity.

export const PARTICIPATION_ATTRIBUTES = [
  "first_timers_welcome",
  "come_alone",
  "beginner_friendly",
  "no_experience",
  "host_introduces",
  "small_group",
  "family_friendly",
  "accessible",
] as const;
export type ParticipationAttribute = (typeof PARTICIPATION_ATTRIBUTES)[number];
const ATTRIBUTE_SET = new Set<string>(PARTICIPATION_ATTRIBUTES);

export function sanitizeAttributes(values: unknown): ParticipationAttribute[] {
  if (!Array.isArray(values)) return [];
  return PARTICIPATION_ATTRIBUTES.filter((a) => values.includes(a));
}

export function isParticipationAttribute(v: string): v is ParticipationAttribute {
  return ATTRIBUTE_SET.has(v);
}
