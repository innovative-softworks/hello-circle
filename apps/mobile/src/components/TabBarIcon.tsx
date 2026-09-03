// Plain glyph + label for Phase 1's tab bar — no icon library added yet
// (real iconography is a Phase 2+ polish item, not a blocker for a
// navigation shell).
import { StyleSheet, Text, View } from 'react-native';

import { useTheme } from '@/hooks/use-theme';

export function TabBarIcon({ glyph, label, focused }: { glyph: string; label: string; focused: boolean }) {
  const theme = useTheme();
  const color = focused ? theme.primary : theme.textSecondary;
  return (
    <View style={styles.container}>
      <Text style={[styles.glyph, { color }]}>{glyph}</Text>
      <Text style={[styles.label, { color }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: 'center', justifyContent: 'center', gap: 2, paddingVertical: 6, flex: 1 },
  glyph: { fontSize: 20, lineHeight: 22 },
  label: { fontSize: 11, fontWeight: '600' },
});
