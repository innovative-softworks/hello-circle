import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { fetchMyGames } from '@/api/games';
import { EmptyState } from '@/components/EmptyState';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export default function HostedGamesScreen() {
  const theme = useTheme();
  const { data } = useQuery({ queryKey: ['my-games-hosted'], queryFn: () => fetchMyGames({ hostedOnly: true }) });
  const games = data ?? [];

  return (
    <ThemedView style={{ flex: 1 }}>
      <SafeAreaView style={{ flex: 1 }} edges={['bottom']}>
        <ScrollView contentContainerStyle={{ padding: Spacing.four, gap: Spacing.two }}>
          {games.length === 0 && <EmptyState icon="football-outline" title="No hosted games yet" description="Games you create will show up here." />}
          {games.map((game) => (
            <Pressable
              key={game.id}
              onPress={() => router.push({ pathname: '/host/games/[id]/manage', params: { id: game.id } })}
              style={[styles.row, { borderColor: theme.border }]}>
              <ThemedText style={styles.title}>{game.activityLabel}</ThemedText>
              <ThemedText themeColor="textSecondary">
                {game.date} at {game.time} · {game.joined}/{game.capacity} joined
              </ThemedText>
            </Pressable>
          ))}
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  row: {
    borderWidth: 1,
    borderRadius: 12,
    padding: Spacing.three,
    gap: 2,
  },
  title: {
    fontWeight: '700',
  },
});
