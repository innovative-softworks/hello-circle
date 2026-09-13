import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { fetchMyFollows } from '@/api/follow';
import { EmptyState } from '@/components/EmptyState';
import { ScreenHeader } from '@/components/ScreenHeader';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

// Reachable from Profile's stats row and My Life's "Following" row (spec
// §20/§23) — one shared screen rather than two copies.
export default function FollowingScreen() {
  const theme = useTheme();
  const { data, isLoading } = useQuery({ queryKey: ['my-follows'], queryFn: fetchMyFollows });
  const follows = data ?? [];

  return (
    <ThemedView style={{ flex: 1 }}>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <ScreenHeader title="Following" />
        {!isLoading && follows.length === 0 ? (
          <EmptyState icon="person-add-outline" title="Not following anyone yet." description="Follow a host, club, or venue to see their updates here." />
        ) : (
          <ScrollView contentContainerStyle={{ paddingTop: Spacing.three, paddingBottom: Spacing.four }}>
            {follows.map((f) => (
              <Pressable
                key={`${f.followedType}:${f.followedId}`}
                onPress={() => router.push(f.href as never)}
                style={[styles.row, { borderColor: theme.border }]}>
                {f.imageUrl ? (
                  <Image source={{ uri: f.imageUrl }} style={styles.image} contentFit="cover" />
                ) : (
                  <View style={[styles.image, styles.placeholder, { backgroundColor: theme.backgroundSelected }]}>
                    <Ionicons name="person-outline" size={20} color={theme.textSecondary} />
                  </View>
                )}
                <View style={{ flex: 1, gap: 2 }}>
                  <ThemedText type="cardHeading" numberOfLines={1}>
                    {f.name ?? 'Unknown'}
                  </ThemedText>
                  <ThemedText type="metadata">{f.followedType}</ThemedText>
                </View>
              </Pressable>
            ))}
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
    width: 48,
    height: 48,
    borderRadius: Radius.pill,
  },
  placeholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
