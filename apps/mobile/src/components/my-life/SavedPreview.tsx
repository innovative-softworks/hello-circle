import type { Favourite } from '@hello-circle/types';
import { router } from 'expo-router';
import { Pressable, ScrollView, View } from 'react-native';

import { Card } from '@/components/Card';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { detailRouteFor } from '@/lib/favouriteRoutes';

const PREVIEW_LIMIT = 8;

// My Life's "Saved for later" preview (spec §38) — a horizontal rail of
// real favourites (Favourite.imageUrl is real listing photography, not a
// placeholder), linking into the full saved.tsx list.
export function SavedPreview({ favourites }: { favourites: Favourite[] }) {
  if (!favourites.length) {
    return (
      <View style={{ gap: Spacing.two }}>
        <ThemedText type="sectionHeading">Saved for later</ThemedText>
        <ThemedText themeColor="textSecondary">Nothing saved yet — tap the heart on anything you like.</ThemedText>
      </View>
    );
  }

  const preview = favourites.slice(0, PREVIEW_LIMIT);

  return (
    <View style={{ gap: Spacing.two }}>
      <ThemedText type="sectionHeading">Saved for later</ThemedText>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: Spacing.two }}>
        {preview.map((f) => {
          const destination = detailRouteFor(f.listingType, f.listingId);
          return (
            <Card
              key={`${f.listingType}:${f.listingId}`}
              width={160}
              imageHeight={90}
              imageUrl={f.imageUrl}
              onPress={destination ? () => router.push(destination as never) : undefined}>
              <ThemedText numberOfLines={1} style={{ fontWeight: '700', fontSize: 14 }}>
                {f.name ?? 'Removed listing'}
              </ThemedText>
              {f.subtitle && (
                <ThemedText themeColor="textSecondary" numberOfLines={1} style={{ fontSize: 12 }}>
                  {f.subtitle}
                </ThemedText>
              )}
            </Card>
          );
        })}
      </ScrollView>
      {favourites.length > PREVIEW_LIMIT && (
        <Pressable onPress={() => router.push('/saved')}>
          <ThemedText themeColor="primary">See all →</ThemedText>
        </Pressable>
      )}
    </View>
  );
}
