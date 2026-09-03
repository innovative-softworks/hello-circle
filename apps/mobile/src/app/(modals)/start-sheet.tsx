import { router } from 'expo-router';
import { Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

// Placeholder rows only — none of these actually navigate anywhere yet
// (each is real Phase 2+ work: booking, joining a game, starting a Circle,
// hosting). This screen exists to prove the "Start tab always opens this
// modal" wiring works end to end.
const ROWS = [
  'Find something to do',
  'Create a plan',
  'Start a Circle',
  'Host an activity',
  'List a place',
  'Invite people',
];

export default function StartSheetScreen() {
  const theme = useTheme();
  return (
    <ThemedView style={{ flex: 1 }}>
      <SafeAreaView style={{ flex: 1, padding: Spacing.four, gap: Spacing.two }}>
        <ThemedText type="subtitle" style={{ marginBottom: Spacing.two }}>
          Start something
        </ThemedText>
        {ROWS.map((row) => (
          <Pressable key={row} disabled style={[styles.row, { borderColor: theme.border }]}>
            <ThemedText themeColor="textSecondary">{row}</ThemedText>
          </Pressable>
        ))}
        <Pressable onPress={() => router.back()} style={styles.close}>
          <ThemedText themeColor="primary">Close</ThemedText>
        </Pressable>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  row: {
    borderWidth: 1,
    borderRadius: 12,
    padding: Spacing.three,
  },
  close: {
    marginTop: Spacing.three,
    alignItems: 'center',
    padding: Spacing.three,
  },
});
