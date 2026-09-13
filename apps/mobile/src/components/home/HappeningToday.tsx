import { Ionicons } from '@expo/vector-icons';
import type { DiscoverItem } from '@hello-circle/types';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { SectionHeader } from '@/components/home/SectionHeader';
import { SkeletonRail } from '@/components/SkeletonLoader';
import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatPriceCents } from '@/lib/format';

// Everything after the day's soonest item (which the hero above already
// shows) — deliberately a left-image/right-text row rail rather than another
// stacked image card, so two consecutive Home sections don't read as the
// same carousel repeated (spec §14/§51 rule 2). `items` is the tail of
// `data.today` and `isLoading` mirrors the parent's ['discover', county]
// query — this component no longer owns its own fetch.
export function HappeningToday({ items, isLoading }: { items: DiscoverItem[]; isLoading: boolean }) {
  if (isLoading) {
    return (
      <>
        <SectionHeader title="Also today" />
        <SkeletonRail />
      </>
    );
  }

  if (!items.length) return null;

  return (
    <>
      <SectionHeader title="Also today" />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: Spacing.three, paddingHorizontal: Spacing.four }}>
        {items.map((item) => (
          <TodayRow key={item.id} item={item} />
        ))}
      </ScrollView>
    </>
  );
}

function TodayRow({ item }: { item: DiscoverItem }) {
  const theme = useTheme();
  const Container = item.kind === 'game' ? Pressable : View;
  const subtitle = [item.time, item.centreName ?? item.clubName].filter(Boolean).join(' · ');

  return (
    <Container onPress={item.kind === 'game' ? () => router.push(`/(details)/game/${item.id}`) : undefined} style={styles.row}>
      {item.imageUrl ? (
        <Image source={{ uri: item.imageUrl }} style={[styles.thumb, { borderRadius: Radius.subtle }]} contentFit="cover" />
      ) : (
        <View style={[styles.thumb, styles.placeholder, { borderRadius: Radius.subtle, backgroundColor: theme.backgroundSelected }]}>
          <Ionicons name="calendar-outline" size={20} color={theme.textSecondary} />
        </View>
      )}
      <View style={styles.body}>
        <ThemedText numberOfLines={2} style={{ fontWeight: '700', fontSize: 14 }}>
          {item.title}
        </ThemedText>
        <ThemedText themeColor="textSecondary" numberOfLines={1} style={{ fontSize: 12 }}>
          {subtitle}
        </ThemedText>
        <ThemedText themeColor="primary" style={{ fontSize: 12 }}>
          {formatPriceCents(item.priceCents)}
        </ThemedText>
      </View>
    </Container>
  );
}

const styles = StyleSheet.create({
  row: {
    width: 250,
    flexDirection: 'row',
    gap: Spacing.two,
  },
  thumb: {
    width: 72,
    height: 72,
  },
  placeholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    flex: 1,
    justifyContent: 'center',
    gap: 2,
  },
});
