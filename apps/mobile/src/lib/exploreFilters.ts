// Ported from client/src/pages/Explore.tsx's client-side post-filter logic
// (when/needsPeople/sort) — these are applied to an already-fetched
// DiscoverItem[] list, not sent as server params (server params are county/
// radiusKm/lat/lng/mood/q, handled by src/api/discovery.ts instead).
import type { DiscoverItem } from '@hello-circle/types';

export type When = '' | 'today' | 'tonight' | 'weekend';
export type SortKey = 'recommended' | 'soonest' | 'needs-people' | 'price-asc';

/** A game close to happening ("1 player needed" / "2 spots left") — same
 * <=3 threshold as web's Home.tsx/Explore.tsx. */
export function needsPeopleGame(item: DiscoverItem): boolean {
  return item.kind === 'game' && item.spotsLeft !== null && item.spotsLeft > 0 && item.spotsLeft <= 3;
}

export function isWeekendDate(dateIso: string): boolean {
  const dow = new Date(`${dateIso}T12:00:00Z`).getUTCDay();
  return dow === 0 || dow === 6;
}

/** feed.today and feed.weekend aren't mutually exclusive (an activity today
 * that's also a Saturday/Sunday appears in both) — dedupe before rendering
 * a merged list, or two cards can share a key. */
export function dedupeItems(items: DiscoverItem[]): DiscoverItem[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${item.kind}-${item.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function filterByWhen(items: DiscoverItem[], when: When): DiscoverItem[] {
  if (when === 'today' || when === 'tonight') {
    const todayIso = new Date().toISOString().slice(0, 10);
    return items.filter((item) => item.date === todayIso);
  }
  if (when === 'weekend') return items.filter((item) => isWeekendDate(item.date));
  return items;
}

export function filterNeedsPeople(items: DiscoverItem[], needsPeopleOnly: boolean): DiscoverItem[] {
  return needsPeopleOnly ? items.filter(needsPeopleGame) : items;
}

export function sortActivities(items: DiscoverItem[], sort: SortKey): DiscoverItem[] {
  const sorted = [...items];
  if (sort === 'soonest') {
    sorted.sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
  } else if (sort === 'needs-people') {
    sorted.sort((a, b) => {
      const an = needsPeopleGame(a) ? 0 : 1;
      const bn = needsPeopleGame(b) ? 0 : 1;
      if (an !== bn) return an - bn;
      const aLeft = a.spotsLeft ?? Infinity;
      const bLeft = b.spotsLeft ?? Infinity;
      return aLeft - bLeft;
    });
  } else if (sort === 'price-asc') {
    sorted.sort((a, b) => (a.priceCents ?? 0) - (b.priceCents ?? 0));
  }
  // "recommended" — leave server order (already ranked).
  return sorted;
}
