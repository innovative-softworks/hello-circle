import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

// Honest empty states per master-prompt §26 — never seed fake results. `cta`
// is optional so an empty state can carry personality + a next action
// ("Nothing planned yet. Your Saturday is wide open. Explore something →")
// instead of being purely descriptive — redesign spec §17/§44. `icon` is
// optional too — a tinted circular badge for a touch of warmth, never a
// fabricated illustration/photo.
export function EmptyState({
  title,
  description,
  cta,
  icon,
}: {
  title: string;
  description?: string;
  cta?: { label: string; onPress: () => void };
  icon?: keyof typeof Ionicons.glyphMap;
}) {
  const theme = useTheme();
  return (
    <View style={styles.container}>
      {icon && (
        <View style={[styles.iconBadge, { backgroundColor: theme.backgroundSelected }]}>
          <Ionicons name={icon} size={26} color={theme.textSecondary} />
        </View>
      )}
      <ThemedText type="sectionHeading" style={{ textAlign: 'center' }}>
        {title}
      </ThemedText>
      {description && (
        <ThemedText themeColor="textSecondary" style={{ textAlign: 'center' }}>
          {description}
        </ThemedText>
      )}
      {cta && (
        <Pressable onPress={cta.onPress} style={{ marginTop: Spacing.one }}>
          <ThemedText type="smallBold" themeColor="primary">
            {cta.label} →
          </ThemedText>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: Spacing.four,
    alignItems: 'center',
    gap: Spacing.two,
  },
  iconBadge: {
    width: 56,
    height: 56,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.one,
  },
});
