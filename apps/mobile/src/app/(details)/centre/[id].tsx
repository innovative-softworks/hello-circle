import { useQuery } from '@tanstack/react-query';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { fetchCentre } from '@/api/centres';
import { fetchFavourites } from '@/api/favourites';
import { fetchMyFollows } from '@/api/follow';
import { fetchGames } from '@/api/games';
import { fetchPrograms } from '@/api/programs';
import { DetailMap } from '@/components/detail/DetailMap';
import { FavouriteHeart } from '@/components/detail/FavouriteHeart';
import { FollowButton } from '@/components/detail/FollowButton';
import { Gallery } from '@/components/detail/Gallery';
import { ProgramsList } from '@/components/detail/ProgramsList';
import { Reviews } from '@/components/detail/Reviews';
import { StickyPriceRail } from '@/components/detail/StickyPriceRail';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useAuthStore } from '@/auth/store';
import { formatPrice } from '@/lib/format';

export default function CentreDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const signedIn = useAuthStore((state) => state.status === 'signedIn');

  const centreQuery = useQuery({ queryKey: ['centre', id], queryFn: () => fetchCentre(id) });
  const programsQuery = useQuery({ queryKey: ['programs', 'centre', id], queryFn: () => fetchPrograms('centre', id) });
  const gamesQuery = useQuery({ queryKey: ['games'], queryFn: () => fetchGames() });
  const favouritesQuery = useQuery({ queryKey: ['favourites'], queryFn: fetchFavourites, enabled: signedIn });
  const followsQuery = useQuery({ queryKey: ['my-follows'], queryFn: fetchMyFollows, enabled: signedIn });

  const centre = centreQuery.data;
  if (!centre) {
    return (
      <ThemedView style={{ flex: 1 }}>
        <SafeAreaView style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ThemedText themeColor="textSecondary">Loading…</ThemedText>
        </SafeAreaView>
      </ThemedView>
    );
  }

  const openGames = (gamesQuery.data ?? []).filter((game) => game.centreId === centre.id);
  const isFavourite = favouritesQuery.data?.some((favourite) => favourite.listingType === 'centre' && favourite.listingId === centre.id) ?? false;
  const isFollowing = followsQuery.data?.some((follow) => follow.followedType === 'centre' && follow.followedId === centre.id) ?? false;
  const screenPath = `/(details)/centre/${centre.id}`;

  return (
    <ThemedView style={{ flex: 1 }}>
      <Stack.Screen options={{ title: centre.name }} />
      <ScrollView>
        <Gallery images={centre.images} />
        <View style={{ padding: Spacing.four, gap: Spacing.three }}>
          <View style={styles.headerRow}>
            <ThemedText type="title">{centre.name}</ThemedText>
            <FavouriteHeart listingType="centre" listingId={centre.id} initialSaved={isFavourite} screenPath={screenPath} />
          </View>
          <View style={styles.headerRow}>
            <ThemedText themeColor="textSecondary">
              {centre.area}, {centre.county} · ★ {centre.rating.toFixed(1)} ({centre.reviews})
              {centre.wouldRepeatPercent !== null ? ` · ${centre.wouldRepeatPercent}% would repeat` : ''}
            </ThemedText>
            <FollowButton centreId={centre.id} initialFollowing={isFollowing} screenPath={screenPath} />
          </View>

          <ThemedText>{centre.blurb}</ThemedText>

          {centre.amenities.length > 0 && (
            <View>
              <ThemedText type="subtitle">Facilities</ThemedText>
              <ThemedText themeColor="textSecondary">{centre.amenities.join(' · ')}</ThemedText>
            </View>
          )}
          {centre.accessibility.length > 0 && (
            <View>
              <ThemedText type="subtitle">Accessibility</ThemedText>
              <ThemedText themeColor="textSecondary">{centre.accessibility.join(' · ')}</ThemedText>
            </View>
          )}

          {centre.lat !== null && centre.lng !== null && <DetailMap lat={centre.lat} lng={centre.lng} title={centre.name} />}

          {openGames.length > 0 && (
            <View>
              <ThemedText type="subtitle">Open games here</ThemedText>
              {openGames.map((game) => (
                <ThemedText key={game.id} themeColor="textSecondary">
                  {game.activityLabel} · {game.date} {game.time}
                </ThemedText>
              ))}
            </View>
          )}

          <ProgramsList programs={programsQuery.data ?? []} />
          <Reviews listingType="centre" listingId={centre.id} />
        </View>
      </ScrollView>
      <StickyPriceRail
        priceLabel={`Hire from ${formatPrice(centre.from)}/hr`}
        ctaLabel="Check availability"
        onPress={() => router.push({ pathname: '/booking/[centreId]/room', params: { centreId: centre.id } })}
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
