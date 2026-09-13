import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

// spec §19's 5-item Create menu, mapped onto what this backend actually
// supports: "Create an Activity" is Make It Happen (propose/gauge interest
// in something not yet scheduled), "Organize a Game" directly schedules a
// session (Phase 5 resident-host tools), "Start a Circle" now has a real
// create flow (circles/new.tsx). "Host an Event" has no distinct backend
// concept from a Game, and "List a Place" is vendor/venue territory — both
// stay disabled rather than duplicating or faking a route.
const ROWS: { label: string; description: string; icon: keyof typeof Ionicons.glyphMap; onPress?: () => void }[] = [
  { label: 'Start a Circle', description: 'Gather people around something you do together', icon: 'people-outline', onPress: () => router.push('/circles/new') },
  { label: 'Create an Activity', description: 'Gauge interest before anything is scheduled', icon: 'flash-outline', onPress: () => router.push('/make-it-happen') },
  { label: 'Host an Event', description: 'Coming soon', icon: 'calendar-outline' },
  { label: 'Organize a Game', description: 'Schedule a session and open it up to join', icon: 'football-outline', onPress: () => router.push('/host/games/new') },
  { label: 'List a Place', description: 'For centres and clubs — managed on the web dashboard', icon: 'business-outline' },
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
        <ThemedText type="editorial" style={{ marginBottom: Spacing.two }}>
          What do you{'\n'}want to create?
        </ThemedText>
        {ROWS.map((row) => (
          <Pressable key={row.label} disabled={!row.onPress} onPress={() => handlePress(row)} style={[styles.row, { borderColor: theme.border }]}>
            <View style={[styles.iconBadge, { backgroundColor: row.onPress ? theme.backgroundSelected : 'transparent' }]}>
              <Ionicons name={row.icon} size={22} color={row.onPress ? theme.primary : theme.textSecondary} />
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <ThemedText type="cardHeading" themeColor={row.onPress ? 'text' : 'textSecondary'}>
                {row.label}
              </ThemedText>
              <ThemedText type="metadata">{row.description}</ThemedText>
            </View>
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
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: Radius.card,
    padding: Spacing.three,
    gap: Spacing.three,
  },
  iconBadge: {
    width: 44,
    height: 44,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  close: {
    marginTop: Spacing.three,
    alignItems: 'center',
    padding: Spacing.three,
  },
});
