import type { Program } from '@hello-circle/types';
import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatPriceCents } from '@/lib/format';

export function ProgramsList({ programs }: { programs: Program[] }) {
  if (!programs.length) return null;
  return (
    <View style={{ gap: Spacing.two }}>
      <ThemedText type="sectionHeading">Programs</ThemedText>
      {programs.map((program) => (
        <ProgramRow key={program.id} program={program} />
      ))}
    </View>
  );
}

function ProgramRow({ program }: { program: Program }) {
  const theme = useTheme();
  return (
    <Pressable onPress={() => router.push(`/(details)/program/${program.id}`)} style={[styles.row, { borderColor: theme.border }]}>
      <ThemedText style={styles.title}>{program.title}</ThemedText>
      <ThemedText themeColor="textSecondary">{program.ageRange}</ThemedText>
      <ThemedText themeColor="primary">
        {formatPriceCents(program.priceCents)}
        {program.spotsLeft !== null ? ` · ${program.spotsLeft} spots left` : ''}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    borderWidth: 1,
    borderRadius: Radius.card,
    padding: Spacing.three,
    gap: 2,
  },
  title: {
    fontWeight: '700',
  },
});
