import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';

import { useTheme } from '@/hooks/use-theme';

export function TabBarIcon({
  name,
  focusedName,
  label,
  focused,
}: {
  name: keyof typeof Ionicons.glyphMap;
  focusedName: keyof typeof Ionicons.glyphMap;
  label: string;
  focused: boolean;
}) {
  const theme = useTheme();
  const color = focused ? theme.primary : theme.textSecondary;
  return (
    <View style={styles.container}>
      <Ionicons name={focused ? focusedName : name} size={24} color={color} />
      <Text style={[styles.label, { color }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: 'center', justifyContent: 'center', gap: 2, paddingVertical: 4, flex: 1 },
  label: { fontSize: 11, fontWeight: '600' },
});
