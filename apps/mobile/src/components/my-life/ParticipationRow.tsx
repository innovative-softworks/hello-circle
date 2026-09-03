import type { ParticipationEntry } from '@hello-circle/types';
import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

// A receipt/ticket view only makes sense for a paid/ticketed entry — game
// and circle entries already have their own live-status detail screens, so
// routing them to a static ticket view would show stale state. Deliberate
// distinction, not an oversight.
export function ParticipationRow({ entry }: { entry: ParticipationEntry }) {
  const theme = useTheme();

  function handlePress() {
    if (entry.kind === 'game') {
      router.push(`/(details)/game/${entry.ref}`);
    } else if (entry.kind === 'circle') {
      router.push(`/(details)/circle/${entry.ref}`);
    } else {
      router.push({ pathname: '/(details)/receipt/[ref]', params: { ref: entry.ref, kind: entry.kind } });
    }
  }

  return (
    <Pressable onPress={handlePress} style={[styles.row, { borderColor: theme.border }]}>
      <View style={{ flex: 1 }}>
        <ThemedText style={styles.title} numberOfLines={1}>
          {entry.title}
        </ThemedText>
        <ThemedText themeColor="textSecondary" numberOfLines={1}>
          {entry.subtitle} · {entry.date}
        </ThemedText>
      </View>
      <ThemedText themeColor={entry.status === 'cancelled' ? 'danger' : 'primary'} style={styles.status}>
        {entry.status}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderWidth: 1,
    borderRadius: 12,
    padding: Spacing.three,
  },
  title: {
    fontWeight: '700',
  },
  status: {
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'capitalize',
  },
});
