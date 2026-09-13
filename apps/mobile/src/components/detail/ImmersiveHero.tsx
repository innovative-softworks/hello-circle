import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Radius } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

// Full-bleed image with a floating back/action-button row overlaid on top
// (Experience Detail redesign spec §20) — the shared hero shell for
// immersive detail screens (games today; centre/club detail can adopt the
// same shell in a later phase). Title/metadata deliberately render BELOW
// the image, not overlaid on it — same choice EditorialHero already made,
// to avoid needing a gradient-overlay dependency for text legibility.
//
// Overlay buttons use a fixed translucent dark scrim regardless of the
// app's light/dark theme, since they sit on top of a photo whose own
// brightness varies — a theme-following background would sometimes vanish
// against the image.
export function ImmersiveHero({
  imageUrl,
  height = 320,
  placeholderIcon = 'image-outline',
  onBack,
  actions,
}: {
  imageUrl?: string | null;
  height?: number;
  placeholderIcon?: keyof typeof Ionicons.glyphMap;
  onBack: () => void;
  actions?: ReactNode;
}) {
  const theme = useTheme();

  return (
    <View style={{ height }}>
      {imageUrl ? (
        <Image source={{ uri: imageUrl }} style={StyleSheet.absoluteFill} contentFit="cover" />
      ) : (
        <View style={[StyleSheet.absoluteFill, styles.placeholder, { backgroundColor: theme.backgroundSelected }]}>
          <Ionicons name={placeholderIcon} size={40} color={theme.textSecondary} />
        </View>
      )}
      <View style={styles.row}>
        <HeroIconButton onPress={onBack} icon="arrow-back" label="Back" />
        <View style={styles.actions}>{actions}</View>
      </View>
    </View>
  );
}

export function HeroIconButton({ onPress, icon, label }: { onPress: () => void; icon: keyof typeof Ionicons.glyphMap; label: string }) {
  return (
    <Pressable onPress={onPress} accessibilityLabel={label} style={styles.iconButton}>
      <Ionicons name={icon} size={22} color="#fff" />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  placeholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  row: {
    position: 'absolute',
    left: 16,
    right: 16,
    top: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  actions: {
    flexDirection: 'row',
    gap: 8,
  },
  iconButton: {
    width: 44,
    height: 44,
    borderRadius: Radius.pill,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
