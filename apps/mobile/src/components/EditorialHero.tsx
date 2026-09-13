import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

// The shared shell for Home's cinematic hero and the "This Weekend" module
// (redesign spec §07/§14) — full-bleed image, one display headline, one
// metadata line, one CTA. Deliberately not a full-bleed text-over-image
// treatment (which would need a gradient-overlay dependency this redesign
// doesn't add) — image on top, editorial text below, edge-to-edge.
export function EditorialHero({
  imageUrl,
  eyebrow,
  title,
  metadata,
  ctaLabel,
  onPress,
  imageHeight = 260,
}: {
  imageUrl?: string | null;
  eyebrow?: string;
  title: string;
  metadata?: string;
  ctaLabel?: string;
  onPress?: () => void;
  imageHeight?: number;
}) {
  const theme = useTheme();

  return (
    <Pressable onPress={onPress} disabled={!onPress}>
      {imageUrl ? (
        <Image source={{ uri: imageUrl }} style={{ width: '100%', height: imageHeight }} contentFit="cover" />
      ) : (
        <View style={[styles.placeholder, { width: '100%', height: imageHeight, backgroundColor: theme.backgroundSelected }]}>
          <Ionicons name="calendar-outline" size={36} color={theme.textSecondary} />
        </View>
      )}
      <View style={[styles.body, { paddingHorizontal: Spacing.four }]}>
        {eyebrow && <ThemedText type="eyebrow">{eyebrow}</ThemedText>}
        <ThemedText type="editorial">{title}</ThemedText>
        {metadata && <ThemedText type="metadata">{metadata}</ThemedText>}
        {ctaLabel && onPress && (
          <ThemedText type="smallBold" themeColor="primary" style={{ marginTop: Spacing.one }}>
            {ctaLabel} →
          </ThemedText>
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  placeholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    paddingTop: Spacing.three,
    gap: 4,
  },
});
