import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { ScrollView } from 'react-native';

import { fetchCentres } from '@/api/centres';
import { fetchClubs } from '@/api/clubs';
import { PlaceCard } from '@/components/home/PlaceCard';
import { SectionHeader } from '@/components/home/SectionHeader';
import { Spacing } from '@/constants/theme';

export function NearYou({ county }: { county: string | null }) {
  const centresQuery = useQuery({ queryKey: ['centres', county], queryFn: () => fetchCentres(county ?? undefined) });
  const clubsQuery = useQuery({ queryKey: ['clubs', county], queryFn: () => fetchClubs(county ?? undefined) });

  const places = [
    ...(centresQuery.data ?? []).map((centre) => ({ listingType: 'centre' as const, ...centre })),
    ...(clubsQuery.data ?? []).map((club) => ({ listingType: 'club' as const, ...club })),
  ].slice(0, 5);

  if (!places.length) return null;

  return (
    <>
      <SectionHeader title="Near you" />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: Spacing.two, paddingHorizontal: Spacing.four }}>
        {places.map((place) => (
          <PlaceCard
            key={`${place.listingType}-${place.id}`}
            place={place}
            onPress={() => router.push(`/(details)/${place.listingType}/${place.id}`)}
          />
        ))}
      </ScrollView>
    </>
  );
}
