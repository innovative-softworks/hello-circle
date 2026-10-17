// Short relative-time labels shared by admin queues ("Waiting 3 days",
// "4 h left", "Overdue by 2 h").

export function time(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? null : t;
}

function span(ms: number): string {
  const m = Math.round(ms / 60000);
  if (m < 60) return `${Math.max(m, 1)} min`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h`;
  const d = Math.round(h / 24);
  return `${d} days`;
}

/** "Waiting 3 days" from a start time. */
export function waitingLabel(since: string | null, now = Date.now()): string | null {
  const t = time(since);
  return t === null ? null : `Waiting ${span(Math.max(now - t, 0))}`;
}

/** "4 h left" / "Overdue by 2 h" for a deadline. */
export function dueLabel(due: string | null | undefined, now = Date.now()): string | null {
  const t = time(due);
  if (t === null) return null;
  return t >= now ? `${span(t - now)} left` : `Overdue by ${span(now - t)}`;
}


/** "3 h ago" / "2 days ago" for a past moment. */
export function agoLabel(iso: string | null | undefined, now = Date.now()): string | null {
  const t = time(iso);
  return t === null ? null : `${span(Math.max(now - t, 0))} ago`;
}
