import type { ParticipationEntry } from '@hello-circle/types';

import { splitUpcomingHistory } from './participationSplit';

function makeEntry(overrides: Partial<ParticipationEntry>): ParticipationEntry {
  return {
    kind: 'booking',
    ref: 'HB-1',
    title: 'Test',
    subtitle: '',
    date: '2026-09-05',
    status: 'confirmed',
    href: '/bookings/HB-1',
    ...overrides,
  };
}

describe('splitUpcomingHistory', () => {
  const today = '2026-09-05';

  it('puts future-dated entries in upcoming', () => {
    const { upcoming, history } = splitUpcomingHistory([makeEntry({ date: '2026-09-10' })], today);
    expect(upcoming).toHaveLength(1);
    expect(history).toHaveLength(0);
  });

  it('puts past-dated entries in history', () => {
    const { upcoming, history } = splitUpcomingHistory([makeEntry({ date: '2026-01-01' })], today);
    expect(upcoming).toHaveLength(0);
    expect(history).toHaveLength(1);
  });

  it('puts today-dated entries in upcoming', () => {
    const { upcoming } = splitUpcomingHistory([makeEntry({ date: today })], today);
    expect(upcoming).toHaveLength(1);
  });

  it('always puts circle entries in upcoming regardless of date', () => {
    const { upcoming, history } = splitUpcomingHistory([makeEntry({ kind: 'circle', date: '2020-01-01' })], today);
    expect(upcoming).toHaveLength(1);
    expect(history).toHaveLength(0);
  });
});
