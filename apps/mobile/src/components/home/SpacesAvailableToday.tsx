import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { ScrollView, View } from 'react-native';

import { fetchCentres } from '@/api/centres';
import { fetchClubs } from '@/api/clubs';
import { Chip } from '@/components/Chip';
import { SkeletonRail } from '@/components/SkeletonLoader';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';

// Text-led module, not a card carousel (redesign spec §07/§22) — "Spaces
// available today". Real centre/club names as chips rather than the spec's
// placeholder labels ("Tennis Court", "Studio") — this app has no room-type
// taxonomy on the discovery feed, only named venues.
export function SpacesAvailableToday({ county }: { county: string | null }) {
  const centresQuery = useQuery({ queryKey: ['centres', county], queryFn: () => fetchCentres(county ?? undefined) });
  const clubsQuery = useQuery({ queryKey: ['clubs', county], queryFn: () => fetchClubs(county ?? undefined) });

  if (centresQuery.isLoading || clubsQuery.isLoading) {
    return (
      <View style={{ paddingHorizontal: Spacing.four }}>
        <SkeletonRail />
      </View>
    );
  }

  const places = [
    ...(centresQuery.data ?? []).map((centre) => ({ listingType: 'centre' as const, ...centre })),
    ...(clubsQuery.data ?? []).map((club) => ({ listingType: 'club' as const, ...club })),
  ].slice(0, 6);

  if (!places.length) return null;

  return (
    <View style={{ paddingHorizontal: Spacing.four, gap: Spacing.three }}>
      <ThemedText type="editorial">Need somewhere{'\n'}for your plan?</ThemedText>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: Spacing.two }}>
        {places.map((place) => (
          <Chip
            key={`${place.listingType}-${place.id}`}
            label={place.name}
            selected={false}
            onPress={() => router.push(`/(details)/${place.listingType}/${place.id}`)}
          />
        ))}
      </ScrollView>
    </View>
  );
}
