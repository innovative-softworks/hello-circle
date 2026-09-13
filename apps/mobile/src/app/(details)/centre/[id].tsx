import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { fetchCentre } from '@/api/centres';
import { fetchFavourites } from '@/api/favourites';
import { fetchMyFollows } from '@/api/follow';
import { fetchGames } from '@/api/games';
import { fetchPrograms } from '@/api/programs';
import { useBookingDraftStore } from '@/booking/store';
import { DetailMap } from '@/components/detail/DetailMap';
import { FavouriteHeart } from '@/components/detail/FavouriteHeart';
import { FollowButton } from '@/components/detail/FollowButton';
import { HeroIconButton, ImmersiveHero } from '@/components/detail/ImmersiveHero';
import { ProgramsList } from '@/components/detail/ProgramsList';
import { Reviews } from '@/components/detail/Reviews';
import { StickyPriceRail } from '@/components/detail/StickyPriceRail';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuthStore } from '@/auth/store';
import { formatPrice } from '@/lib/format';

export default function CentreDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const theme = useTheme();
  const signedIn = useAuthStore((state) => state.status === 'signedIn');
  const setBookingField = useBookingDraftStore((state) => state.setField);

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
  const activeRooms = centre.rooms.filter((room) => room.active);

  // Non-null assertions here (not `centre` directly) — narrowing from the
  // `if (!centre) return` guard above doesn't cross into a nested function
  // body, same convention as circle/[id].tsx's handleToggleStatus.
  function handleShare() {
    router.push({
      pathname: '/(modals)/share',
      params: {
        title: 'Share this place',
        text: `${centre!.name} in ${centre!.area}, ${centre!.county}, via HelloCircle: https://hellocircle.ie/centres/${centre!.id}`,
        link: `https://hellocircle.ie/centres/${centre!.id}`,
      },
    });
  }

  function handleBookRoom(roomId: string) {
    setBookingField('roomId', roomId);
    router.push({ pathname: '/booking/[centreId]/date-time', params: { centreId: centre!.id } });
  }

  return (
    <ThemedView style={{ flex: 1 }}>
      <Stack.Screen options={{ headerShown: false }} />
      <SafeAreaView style={{ flex: 1 }} edges={['bottom']}>
        <ScrollView>
          <ImmersiveHero
            imageUrl={centre.image}
            placeholderIcon="business-outline"
            onBack={() => router.back()}
            actions={
              <>
                <View style={{ borderRadius: Radius.pill, overflow: 'hidden', backgroundColor: 'rgba(0,0,0,0.35)' }}>
                  <FavouriteHeart listingType="centre" listingId={centre.id} initialSaved={isFavourite} screenPath={screenPath} />
                </View>
                <HeroIconButton onPress={handleShare} icon="share-outline" label="Share" />
              </>
            }
          />
          <View style={{ padding: Spacing.four, gap: Spacing.three }}>
            <View style={{ gap: 4 }}>
              <ThemedText type="editorial">{centre.name}</ThemedText>
              <ThemedText themeColor="textSecondary">
                {centre.area}, {centre.county} · ★ {centre.rating.toFixed(1)} ({centre.reviews})
                {centre.wouldRepeatPercent !== null ? ` · ${centre.wouldRepeatPercent}% would repeat` : ''}
              </ThemedText>
              <ThemedText themeColor={centre.isOpen ? 'primary' : 'textSecondary'} type="smallBold">
                {centre.isOpen ? 'Open now' : 'Closed now'}
              </ThemedText>
            </View>

            <FollowButton followedType="centre" followedId={centre.id} initialFollowing={isFollowing} screenPath={screenPath} />

            <ThemedText>{centre.blurb}</ThemedText>

            {centre.amenities.length > 0 && (
              <View>
                <ThemedText type="sectionHeading">Facilities</ThemedText>
                <ThemedText themeColor="textSecondary">{centre.amenities.join(' · ')}</ThemedText>
              </View>
            )}
            {centre.accessibility.length > 0 && (
              <View>
                <ThemedText type="sectionHeading">Accessibility</ThemedText>
                <ThemedText themeColor="textSecondary">{centre.accessibility.join(' · ')}</ThemedText>
              </View>
            )}

            {activeRooms.length > 0 && (
              <View style={{ gap: Spacing.two }}>
                <ThemedText type="sectionHeading">Available spaces</ThemedText>
                {activeRooms.map((room) => (
                  <Pressable
                    key={room.id}
                    onPress={() => handleBookRoom(room.id)}
                    style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: Spacing.three, borderWidth: 1, borderColor: theme.border, borderRadius: Radius.card }}>
                    <View style={{ flex: 1, gap: 2 }}>
                      <ThemedText type="cardHeading">{room.name}</ThemedText>
                      <ThemedText themeColor="textSecondary" style={{ fontSize: 12 }}>
                        Capacity {room.cap}
                      </ThemedText>
                    </View>
                    <ThemedText themeColor="primary" style={{ fontWeight: '700' }}>
                      {formatPrice(room.rate)}/hr
                    </ThemedText>
                    <Ionicons name="chevron-forward" size={20} color={theme.textSecondary} style={{ marginLeft: Spacing.two }} />
                  </Pressable>
                ))}
              </View>
            )}

            {centre.lat !== null && centre.lng !== null && <DetailMap lat={centre.lat} lng={centre.lng} title={centre.name} />}

            {openGames.length > 0 && (
              <View>
                <ThemedText type="sectionHeading">Open games here</ThemedText>
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
      </SafeAreaView>
    </ThemedView>
  );
}
