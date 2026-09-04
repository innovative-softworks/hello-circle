import { router } from 'expo-router';
import { Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

// "Create a plan" is real as of Phase 4 (Make It Happen). The rest remain
// placeholder rows — each is real future-phase work (joining a game exists
// elsewhere in the app already; starting a Circle, hosting, and listing a
// place are Phase 5 host/vendor territory).
const ROWS: { label: string; onPress?: () => void }[] = [
  { label: 'Find something to do' },
  { label: 'Create a plan', onPress: () => router.push('/make-it-happen') },
  { label: 'Start a Circle' },
  { label: 'Host an activity' },
  { label: 'List a place' },
  { label: 'Invite people' },
];

export default function StartSheetScreen() {
  const theme = useTheme();

  function handlePress(row: (typeof ROWS)[number]) {
    if (!row.onPress) return;
    router.back();
    row.onPress();
  }

  return (
    <ThemedView style={{ flex: 1 }}>
      <SafeAreaView style={{ flex: 1, padding: Spacing.four, gap: Spacing.two }}>
        <ThemedText type="subtitle" style={{ marginBottom: Spacing.two }}>
          Start something
        </ThemedText>
        {ROWS.map((row) => (
          <Pressable key={row.label} disabled={!row.onPress} onPress={() => handlePress(row)} style={[styles.row, { borderColor: theme.border }]}>
            <ThemedText themeColor={row.onPress ? 'text' : 'textSecondary'}>{row.label}</ThemedText>
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
