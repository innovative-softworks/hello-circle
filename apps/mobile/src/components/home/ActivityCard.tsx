import type { DiscoverItem } from '@hello-circle/types';
import { router } from 'expo-router';

import { Card } from '@/components/Card';
import { ThemedText } from '@/components/themed-text';
import { formatPriceCents } from '@/lib/format';

// Only `kind === 'game'` is tappable, now that a game detail screen exists
// (Phase 3). `program_session`/`club_session` remain non-tappable — no
// session detail screen exists yet, a real remaining gap, not an oversight.
export function ActivityCard({ item }: { item: DiscoverItem }) {
  const subtitle = [item.centreName ?? item.clubName, item.area].filter(Boolean).join(' · ');

  return (
    <Card
      width={220}
      imageHeight={120}
      imageUrl={item.imageUrl}
      placeholderIcon="calendar-outline"
      onPress={item.kind === 'game' ? () => router.push(`/(details)/game/${item.id}`) : undefined}>
      {item.isLive && (
        <ThemedText themeColor="danger" style={{ fontSize: 10, fontWeight: '800' }}>
          LIVE
        </ThemedText>
      )}
      <ThemedText numberOfLines={2} style={{ fontWeight: '700', fontSize: 15 }}>
        {item.title}
      </ThemedText>
      {subtitle.length > 0 && (
        <ThemedText themeColor="textSecondary" numberOfLines={1} style={{ fontSize: 12 }}>
          {subtitle}
        </ThemedText>
      )}
      <ThemedText themeColor="primary" style={{ fontSize: 12 }}>
        {formatPriceCents(item.priceCents)}
        {item.spotsLeft !== null ? ` · ${item.spotsLeft} spots left` : ''}
      </ThemedText>
    </Card>
  );
}
