import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { fetchFavourites } from '@/api/favourites';
import { EmptyState } from '@/components/EmptyState';
import { ScreenHeader } from '@/components/ScreenHeader';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { detailRouteFor } from '@/lib/favouriteRoutes';

// Reachable from Profile's stats row and My Life's "Saved" row (spec §20/§23)
// — one shared screen rather than two copies.
export default function SavedScreen() {
  const theme = useTheme();
  const { data, isLoading } = useQuery({ queryKey: ['favourites'], queryFn: fetchFavourites });
  const favourites = data ?? [];

  return (
    <ThemedView style={{ flex: 1 }}>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <ScreenHeader title="Saved" />
        {!isLoading && favourites.length === 0 ? (
          <EmptyState icon="heart-outline" title="Nothing saved yet." description="Tap the heart on anything you like to keep it here." />
        ) : (
          <ScrollView contentContainerStyle={{ paddingTop: Spacing.three, paddingBottom: Spacing.four }}>
            {favourites.map((f) => {
              const destination = detailRouteFor(f.listingType, f.listingId);
              const Container = destination ? Pressable : View;
              return (
                <Container
                  key={`${f.listingType}:${f.listingId}`}
                  onPress={destination ? () => router.push(destination as never) : undefined}
                  style={[styles.row, { borderColor: theme.border }]}>
                  {f.imageUrl ? (
                    <Image source={{ uri: f.imageUrl }} style={styles.image} contentFit="cover" />
                  ) : (
                    <View style={[styles.image, styles.placeholder, { backgroundColor: theme.backgroundSelected }]}>
                      <Ionicons name="image-outline" size={22} color={theme.textSecondary} />
                    </View>
                  )}
                  <View style={{ flex: 1, gap: 2 }}>
                    <ThemedText type="cardHeading" numberOfLines={1}>
                      {f.name ?? 'Removed listing'}
                    </ThemedText>
                    {f.subtitle && <ThemedText type="metadata">{f.subtitle}</ThemedText>}
                  </View>
                </Container>
              );
            })}
          </ScrollView>
        )}
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: Spacing.three,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  image: {
    width: 64,
    height: 64,
    borderRadius: Radius.card,
  },
  placeholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
