import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { ScrollView, View } from 'react-native';

import { fetchCentres } from '@/api/centres';
import { PlaceCard } from '@/components/home/PlaceCard';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';

// "Popular right now" (spec's Explore curated rail) — real centres, sorted
// by their real rating (not a fabricated popularity score). Reuses the
// same ['centres', county] query the centres category tab already fetches,
// so this doesn't add a second network call once that tab has been opened.
export function PopularRightNow({ county }: { county: string | null }) {
  const { data } = useQuery({ queryKey: ['centres', county], queryFn: () => fetchCentres(county ?? undefined) });
  const popular = [...(data ?? [])].sort((a, b) => b.rating - a.rating).slice(0, 6);

  if (!popular.length) return null;

  return (
    <View style={{ gap: Spacing.two }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: Spacing.four }}>
        <ThemedText type="sectionHeading">Popular right now</ThemedText>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: Spacing.two, paddingHorizontal: Spacing.four }}>
        {popular.map((centre) => (
          <PlaceCard
            key={centre.id}
            place={{ listingType: 'centre', ...centre }}
            onPress={() => router.push(`/(details)/centre/${centre.id}`)}
          />
        ))}
      </ScrollView>
    </View>
  );
}
