import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { fetchFreeTimeOptions } from '@/api/discovery';
import { CompactActivityRow } from '@/components/explore/CompactActivityRow';
import { EmptyState } from '@/components/EmptyState';
import { SkeletonList } from '@/components/SkeletonLoader';
import { formatPriceCents } from '@/lib/format';

// Backs Explore's "90 Minutes Free" and "Near Me" mood contexts (redesign
// spec §15) via fetchFreeTimeOptions() — a real, separate result mode from
// the category-based ResultsList, since free-time results aren't scoped to
// one listing type. `locationError` surfaces a genuine permission denial
// rather than silently showing an empty list.
export function FreeTimeResults({
  county,
  maxMinutes,
  mood,
  coords,
  locationError,
}: {
  county: string | null;
  maxMinutes?: number;
  mood?: string;
  coords?: { lat: number; lng: number } | null;
  locationError?: string | null;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ['free-time', coords ? 'near-me' : county, maxMinutes, mood, coords?.lat, coords?.lng],
    queryFn: () =>
      fetchFreeTimeOptions({
        county: coords ? undefined : (county ?? undefined),
        maxMinutes,
        mood,
        lat: coords?.lat,
        lng: coords?.lng,
      }),
    enabled: !locationError,
  });

  if (locationError) {
    return <EmptyState icon="location-outline" title="Couldn't get your location" description={locationError} />;
  }

  if (isLoading) return <SkeletonList />;

  if (!data?.length) {
    return <EmptyState icon="time-outline" title="Nothing free right now" description="Try a different mood, or check back later." />;
  }

  return (
    <View style={styles.list}>
      {data.map((item) => (
        <CompactActivityRow
          key={item.id}
          imageUrl={item.imageUrl}
          category={item.isLive ? 'Live now' : 'Nearby'}
          title={item.title}
          metadata={[item.time, item.centreName ?? item.clubName, item.area].filter(Boolean).join(' · ')}
          price={`${formatPriceCents(item.priceCents)}${item.spotsLeft !== null ? ` · ${item.spotsLeft} spots left` : ''}`}
          onPress={item.kind === 'game' ? () => router.push(`/(details)/game/${item.id}`) : undefined}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: {
    paddingHorizontal: 0,
  },
});
