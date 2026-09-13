import { useQuery } from '@tanstack/react-query';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { fetchClub } from '@/api/clubs';
import { fetchFavourites } from '@/api/favourites';
import { fetchPrograms } from '@/api/programs';
import { DetailMap } from '@/components/detail/DetailMap';
import { FavouriteHeart } from '@/components/detail/FavouriteHeart';
import { HeroIconButton, ImmersiveHero } from '@/components/detail/ImmersiveHero';
import { ProgramsList } from '@/components/detail/ProgramsList';
import { Reviews } from '@/components/detail/Reviews';
import { StickyPriceRail } from '@/components/detail/StickyPriceRail';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Radius, Spacing } from '@/constants/theme';
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

  // Non-null assertion (not `club` directly) — narrowing from the
  // `if (!club) return` guard above doesn't cross into this closure, same
  // convention as circle/[id].tsx's handleToggleStatus.
  function handleShare() {
    router.push({
      pathname: '/(modals)/share',
      params: {
        title: 'Share this club',
        text: `${club!.name} in ${club!.area}, ${club!.county}, via HelloCircle: https://hellocircle.ie/clubs/${club!.id}`,
        link: `https://hellocircle.ie/clubs/${club!.id}`,
      },
    });
  }

  return (
    <ThemedView style={{ flex: 1 }}>
      <Stack.Screen options={{ headerShown: false }} />
      <SafeAreaView style={{ flex: 1 }} edges={['bottom']}>
        <ScrollView>
          <ImmersiveHero
            imageUrl={club.image}
            placeholderIcon="people-outline"
            onBack={() => router.back()}
            actions={
              <>
                <View style={{ borderRadius: Radius.pill, overflow: 'hidden', backgroundColor: 'rgba(0,0,0,0.35)' }}>
                  <FavouriteHeart listingType="club" listingId={club.id} initialSaved={isFavourite} screenPath={screenPath} />
                </View>
                <HeroIconButton onPress={handleShare} icon="share-outline" label="Share" />
              </>
            }
          />
          <View style={{ padding: Spacing.four, gap: Spacing.three }}>
            <View style={{ gap: 4 }}>
              <ThemedText type="editorial">{club.name}</ThemedText>
              <ThemedText themeColor="textSecondary">
                {club.sport} · {club.area}, {club.county} · ★ {club.rating.toFixed(1)} ({club.reviews})
                {club.wouldRepeatPercent !== null ? ` · ${club.wouldRepeatPercent}% would repeat` : ''}
              </ThemedText>
            </View>

            <ThemedText>{club.blurb}</ThemedText>

            {club.includes.length > 0 && (
              <View>
                <ThemedText type="sectionHeading">Includes</ThemedText>
                <ThemedText themeColor="textSecondary">{club.includes.join(' · ')}</ThemedText>
              </View>
            )}
            {club.accessibility.length > 0 && (
              <View>
                <ThemedText type="sectionHeading">Accessibility</ThemedText>
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
      </SafeAreaView>
    </ThemedView>
  );
}
