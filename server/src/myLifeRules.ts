// My Life 3.0 — pure rules, no database (docs/my-life-3/). Kept apart from
// myLife.ts so they can be unit tested on their own.

export interface RoutineLike {
  id: string;
  activityLabel: string;
  /** 1 = Sunday … 7 = Saturday (the routines table's convention). */
  dayOfWeek: number;
  /** "HH:MM", or "" when the resident didn't give one. */
  time: string;
}

export interface SessionLike {
  id: string;
  title: string;
  date: string;
  time: string;
  href: string;
}

/** 1 = Sunday … 7 = Saturday for a YYYY-MM-DD date. */
export function dayOfWeekOf(iso: string): number {
  return new Date(`${iso}T12:00:00Z`).getUTCDay() + 1;
}

const minutes = (hhmm: string) => {
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

/** Same activity in either direction ("Badminton" ~ "Badminton Doubles"),
 * case-insensitive, ignoring very short labels that would match anything. */
export function sameActivity(routineLabel: string, sessionTitle: string): boolean {
  const a = routineLabel.trim().toLowerCase();
  const b = sessionTitle.trim().toLowerCase();
  if (a.length < 3 || b.length < 3) return false;
  return b.includes(a) || a.includes(b);
}

/** Sessions that fit a routine: same activity, same weekday, and within two
 * hours of the routine's time when it has one. Never books anything. */
export function routineMatches<T extends SessionLike>(routine: RoutineLike, sessions: T[], fromIso: string, toIso: string, limit = 3): T[] {
  const want = minutes(routine.time);
  return sessions
    .filter((s) => s.date >= fromIso && s.date <= toIso)
    .filter((s) => dayOfWeekOf(s.date) === routine.dayOfWeek && sameActivity(routine.activityLabel, s.title))
    .filter((s) => {
      if (want === null) return true;
      const got = minutes(s.time);
      return got === null || Math.abs(got - want) <= 120;
    })
    .sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`))
    .slice(0, limit);
}

/** Dismissal keys come from the client; keep them short and plain. */
export function validDismissKey(key: unknown): key is string {
  return typeof key === "string" && /^[a-z0-9_:.\-]{1,180}$/i.test(key);
}

/** New alert keys: present now and not seen before. */
export function unseen(keys: string[], seen: Set<string>): string[] {
  return [...new Set(keys)].filter((k) => !seen.has(k));
}
