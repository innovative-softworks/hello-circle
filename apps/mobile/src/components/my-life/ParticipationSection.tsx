import type { ParticipationEntry } from '@hello-circle/types';
import { StyleSheet, View } from 'react-native';

import { ParticipationRow } from '@/components/my-life/ParticipationRow';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';

export function ParticipationSection({ title, entries }: { title: string; entries: ParticipationEntry[] }) {
  if (!entries.length) return null;
  return (
    <View style={styles.section}>
      <ThemedText type="subtitle">{title}</ThemedText>
      {entries.map((entry) => (
        <ParticipationRow key={`${entry.kind}-${entry.ref}`} entry={entry} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: Spacing.two,
  },
});
