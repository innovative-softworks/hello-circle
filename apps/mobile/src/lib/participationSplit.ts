import type { ParticipationEntry } from '@hello-circle/types';

// Same derivation shape as Phase 2's Home Today/Weekend split — circle
// entries always count as Upcoming (a standing membership has no "past"
// concept the way a one-off booking/registration/game does); everything
// else splits on date.
export function splitUpcomingHistory(
  entries: ParticipationEntry[],
  todayIso: string
): { upcoming: ParticipationEntry[]; history: ParticipationEntry[] } {
  const upcoming: ParticipationEntry[] = [];
  const history: ParticipationEntry[] = [];
  for (const entry of entries) {
    if (entry.kind === 'circle' || entry.date >= todayIso) {
      upcoming.push(entry);
    } else {
      history.push(entry);
    }
  }
  return { upcoming, history };
}
