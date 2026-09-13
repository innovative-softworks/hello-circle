import type { Game } from '@hello-circle/types';
import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

const PREVIEW_LIMIT = 3;

export function HostingSection({ games }: { games: Game[] }) {
  const theme = useTheme();
  if (!games.length) return null;

  const preview = games.slice(0, PREVIEW_LIMIT);

  return (
    <View style={styles.section}>
      <ThemedText type="sectionHeading">Hosting</ThemedText>
      {preview.map((game) => (
        <Pressable
          key={game.id}
          onPress={() => router.push({ pathname: '/host/games/[id]/manage', params: { id: game.id } })}
          style={[styles.row, { borderColor: theme.border }]}>
          <ThemedText type="cardHeading" numberOfLines={1}>
            {game.activityLabel}
          </ThemedText>
          <ThemedText themeColor="textSecondary" numberOfLines={1}>
            {game.date} at {game.time} · {game.joined}/{game.capacity} joined
          </ThemedText>
        </Pressable>
      ))}
      {games.length > PREVIEW_LIMIT && (
        <Pressable onPress={() => router.push('/host/games')}>
          <ThemedText themeColor="primary">View all</ThemedText>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: Spacing.two,
  },
  row: {
    borderWidth: 1,
    borderRadius: Radius.card,
    padding: Spacing.three,
    gap: 2,
  },
});
