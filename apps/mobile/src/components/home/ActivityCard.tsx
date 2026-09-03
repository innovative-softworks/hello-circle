import type { DiscoverItem } from '@hello-circle/types';
import { radius } from '@hello-circle/design-tokens';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatPriceCents } from '@/lib/format';

// Only `kind === 'game'` is tappable, now that a game detail screen exists
// (Phase 3). `program_session`/`club_session` remain non-tappable — no
// session detail screen exists yet, a real remaining gap, not an oversight.
export function ActivityCard({ item }: { item: DiscoverItem }) {
  const theme = useTheme();
  const subtitle = [item.centreName ?? item.clubName, item.area].filter(Boolean).join(' · ');
  const Container = item.kind === 'game' ? Pressable : View;

  return (
    <Container
      onPress={item.kind === 'game' ? () => router.push(`/(details)/game/${item.id}`) : undefined}
      style={[styles.card, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
      {item.imageUrl ? (
        <Image source={{ uri: item.imageUrl }} style={styles.image} contentFit="cover" />
      ) : (
        <View style={[styles.image, { backgroundColor: theme.primary, opacity: 0.15 }]} />
      )}
      <View style={styles.body}>
        {item.isLive && (
          <ThemedText themeColor="danger" style={styles.badge}>
            LIVE
          </ThemedText>
        )}
        <ThemedText numberOfLines={2} style={styles.title}>
          {item.title}
        </ThemedText>
        {subtitle.length > 0 && (
          <ThemedText themeColor="textSecondary" numberOfLines={1} style={styles.small}>
            {subtitle}
          </ThemedText>
        )}
        <ThemedText themeColor="primary" style={styles.small}>
          {formatPriceCents(item.priceCents)}
          {item.spotsLeft !== null ? ` · ${item.spotsLeft} spots left` : ''}
        </ThemedText>
      </View>
    </Container>
  );
}

const styles = StyleSheet.create({
  card: {
    width: 220,
    borderRadius: radius.card,
    borderWidth: 1,
    overflow: 'hidden',
  },
  image: {
    width: '100%',
    height: 120,
  },
  body: {
    padding: Spacing.two,
    gap: 2,
  },
  title: {
    fontWeight: '700',
    fontSize: 15,
  },
  small: {
    fontSize: 12,
  },
  badge: {
    fontSize: 10,
    fontWeight: '800',
  },
});
