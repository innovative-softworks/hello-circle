import { useQuery } from '@tanstack/react-query';
import { ScrollView, View } from 'react-native';

import { fetchDiscover } from '@/api/discovery';
import { ActivityCard } from '@/components/home/ActivityCard';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';

// "Curated for you" (spec's Explore curated rail) — real weekend discover
// data, the same ['discover', county] query Home's ThisWeekend section
// already fetches (TanStack dedupes, no extra network call). Not a
// fabricated editorial collection — just this county's real upcoming
// weekend activities, framed as a curated pick.
export function CuratedWeekend({ county }: { county: string | null }) {
  const { data } = useQuery({ queryKey: ['discover', county], queryFn: () => fetchDiscover(county ?? undefined) });
  const weekend = data?.weekend ?? [];

  if (!weekend.length) return null;

  return (
    <View style={{ gap: Spacing.two }}>
      <View style={{ paddingHorizontal: Spacing.four }}>
        <ThemedText type="sectionHeading">Curated for you</ThemedText>
        <ThemedText type="metadata">Weekend in {county ?? 'your area'}</ThemedText>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: Spacing.two, paddingHorizontal: Spacing.four }}>
        {weekend.slice(0, 6).map((item) => (
          <ActivityCard key={item.id} item={item} />
        ))}
      </ScrollView>
    </View>
  );
}
