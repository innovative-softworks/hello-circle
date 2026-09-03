import type { DiscoverItem } from '@hello-circle/types';

import { dedupeItems, filterNeedsPeople, filterByWhen, needsPeopleGame, sortActivities } from './exploreFilters';

function makeItem(overrides: Partial<DiscoverItem>): DiscoverItem {
  return {
    kind: 'game',
    id: '1',
    title: 'Test',
    date: '2026-09-05',
    time: '18:00',
    centreName: null,
    clubName: null,
    area: null,
    county: null,
    priceCents: 0,
    href: '/games/1',
    spotsLeft: null,
    joined: null,
    imageUrl: null,
    isLive: false,
    durationMinutes: 60,
    lat: null,
    lng: null,
    matchReasons: [],
    ...overrides,
  };
}

describe('needsPeopleGame', () => {
  it('is true for a game with 1-3 spots left', () => {
    expect(needsPeopleGame(makeItem({ kind: 'game', spotsLeft: 2 }))).toBe(true);
  });
  it('is false for a non-game item', () => {
    expect(needsPeopleGame(makeItem({ kind: 'program_session', spotsLeft: 2 }))).toBe(false);
  });
  it('is false when spotsLeft is above the threshold', () => {
    expect(needsPeopleGame(makeItem({ kind: 'game', spotsLeft: 4 }))).toBe(false);
  });
  it('is false when spotsLeft is 0 or null', () => {
    expect(needsPeopleGame(makeItem({ kind: 'game', spotsLeft: 0 }))).toBe(false);
    expect(needsPeopleGame(makeItem({ kind: 'game', spotsLeft: null }))).toBe(false);
  });
});

describe('dedupeItems', () => {
  it('removes items with the same kind+id', () => {
    const items = [makeItem({ kind: 'game', id: 'a' }), makeItem({ kind: 'game', id: 'a' }), makeItem({ kind: 'game', id: 'b' })];
    expect(dedupeItems(items)).toHaveLength(2);
  });
});

describe('filterByWhen', () => {
  it('filters to today only', () => {
    const todayIso = new Date().toISOString().slice(0, 10);
    const items = [makeItem({ date: todayIso }), makeItem({ date: '2020-01-01' })];
    expect(filterByWhen(items, 'today')).toHaveLength(1);
  });
  it('passes through unfiltered when when is empty', () => {
    const items = [makeItem({}), makeItem({})];
    expect(filterByWhen(items, '')).toHaveLength(2);
  });
});

describe('filterNeedsPeople', () => {
  it('filters to only needs-people games when enabled', () => {
    const items = [makeItem({ kind: 'game', spotsLeft: 2 }), makeItem({ kind: 'game', spotsLeft: 10 })];
    expect(filterNeedsPeople(items, true)).toHaveLength(1);
  });
  it('passes through unfiltered when disabled', () => {
    const items = [makeItem({}), makeItem({})];
    expect(filterNeedsPeople(items, false)).toHaveLength(2);
  });
});

describe('sortActivities', () => {
  it('sorts by soonest date/time', () => {
    const items = [makeItem({ id: 'a', date: '2026-09-10', time: '10:00' }), makeItem({ id: 'b', date: '2026-09-05', time: '10:00' })];
    expect(sortActivities(items, 'soonest').map((i) => i.id)).toEqual(['b', 'a']);
  });
  it('sorts by price ascending', () => {
    const items = [makeItem({ id: 'a', priceCents: 500 }), makeItem({ id: 'b', priceCents: 100 })];
    expect(sortActivities(items, 'price-asc').map((i) => i.id)).toEqual(['b', 'a']);
  });
  it('leaves order unchanged for recommended', () => {
    const items = [makeItem({ id: 'a' }), makeItem({ id: 'b' })];
    expect(sortActivities(items, 'recommended').map((i) => i.id)).toEqual(['a', 'b']);
  });
});
