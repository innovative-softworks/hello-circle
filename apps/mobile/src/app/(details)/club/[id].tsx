import { useQuery } from '@tanstack/react-query';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { fetchClub } from '@/api/clubs';
import { fetchFavourites } from '@/api/favourites';
import { fetchPrograms } from '@/api/programs';
import { DetailMap } from '@/components/detail/DetailMap';
import { FavouriteHeart } from '@/components/detail/FavouriteHeart';
import { Gallery } from '@/components/detail/Gallery';
import { ProgramsList } from '@/components/detail/ProgramsList';
import { Reviews } from '@/components/detail/Reviews';
import { StickyPriceRail } from '@/components/detail/StickyPriceRail';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useAuthStore } from '@/auth/store';
import { formatPrice } from '@/lib/format';

export default function ClubDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const signedIn = useAuthStore((state) => state.status === 'signedIn');

  const clubQuery = useQuery({ queryKey: ['club', id], queryFn: () => fetchClub(id) });
  const programsQuery = useQuery({ queryKey: ['programs', 'club', id], queryFn: () => fetchPrograms('club', id) });
  const favouritesQuery = useQuery({ queryKey: ['favourites'], queryFn: fetchFavourites, enabled: signedIn });

  const club = clubQuery.data;
  if (!club) {
    return (
      <ThemedView style={{ flex: 1 }}>
        <SafeAreaView style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ThemedText themeColor="textSecondary">Loading…</ThemedText>
        </SafeAreaView>
      </ThemedView>
    );
  }

  const isFavourite = favouritesQuery.data?.some((favourite) => favourite.listingType === 'club' && favourite.listingId === club.id) ?? false;
  const screenPath = `/(details)/club/${club.id}`;

  return (
    <ThemedView style={{ flex: 1 }}>
      <Stack.Screen options={{ title: club.name }} />
      <ScrollView>
        <Gallery images={club.images} />
        <View style={{ padding: Spacing.four, gap: Spacing.three }}>
          <View style={styles.headerRow}>
            <ThemedText type="title">{club.name}</ThemedText>
            <FavouriteHeart listingType="club" listingId={club.id} initialSaved={isFavourite} screenPath={screenPath} />
          </View>
          <ThemedText themeColor="textSecondary">
            {club.sport} · {club.area}, {club.county} · ★ {club.rating.toFixed(1)} ({club.reviews})
            {club.wouldRepeatPercent !== null ? ` · ${club.wouldRepeatPercent}% would repeat` : ''}
          </ThemedText>

          <ThemedText>{club.blurb}</ThemedText>

          {club.includes.length > 0 && (
            <View>
              <ThemedText type="subtitle">Includes</ThemedText>
              <ThemedText themeColor="textSecondary">{club.includes.join(' · ')}</ThemedText>
            </View>
          )}
          {club.accessibility.length > 0 && (
            <View>
              <ThemedText type="subtitle">Accessibility</ThemedText>
              <ThemedText themeColor="textSecondary">{club.accessibility.join(' · ')}</ThemedText>
            </View>
          )}

          {club.lat !== null && club.lng !== null && <DetailMap lat={club.lat} lng={club.lng} title={club.name} />}

          <ProgramsList programs={programsQuery.data ?? []} />
          <Reviews listingType="club" listingId={club.id} />
        </View>
      </ScrollView>
      <StickyPriceRail
        priceLabel={`${formatPrice(club.price)}/${club.unit}`}
        ctaLabel="Register"
        onPress={() => router.push({ pathname: '/registration/[clubId]/details', params: { clubId: club.id } })}
      />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
});
