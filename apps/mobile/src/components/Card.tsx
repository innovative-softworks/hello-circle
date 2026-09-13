import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

// Base card shell for real objects (an activity, a place, a circle) — spec
// §05/§06: cards only where they represent an actual thing, minimal/no
// shadow, generous internal spacing, image-led. This owns only the
// image + outer shape; callers supply their own text stack as `children` so
// each feature's card (ActivityCard, PlaceCard, ...) keeps its own field
// layout instead of forcing one rigid content shape onto every card.
export function Card({
  imageUrl,
  imageHeight = 120,
  placeholderIcon = 'image-outline',
  width,
  onPress,
  children,
  style,
}: {
  imageUrl?: string | null;
  imageHeight?: number;
  // A tinted icon shown when there's no real photo — never a fabricated
  // stock image, just a contextual glyph (e.g. "people-outline" for a
  // Circle) so the placeholder reads as intentional rather than a blank
  // color swatch.
  placeholderIcon?: keyof typeof Ionicons.glyphMap;
  width?: number;
  onPress?: () => void;
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  const Container = onPress ? Pressable : View;

  return (
    <Container
      onPress={onPress}
      style={[styles.card, { backgroundColor: theme.backgroundElement, borderColor: theme.border }, width ? { width } : null, style]}>
      {imageUrl ? (
        <Image source={{ uri: imageUrl }} style={[styles.image, { height: imageHeight }]} contentFit="cover" />
      ) : (
        <View style={[styles.image, styles.placeholder, { height: imageHeight, backgroundColor: theme.backgroundSelected }]}>
          <Ionicons name={placeholderIcon} size={28} color={theme.textSecondary} />
        </View>
      )}
      <View style={styles.body}>{children}</View>
    </Container>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: Radius.card,
    borderWidth: 1,
    overflow: 'hidden',
  },
  image: {
    width: '100%',
  },
  placeholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    padding: Spacing.two,
    gap: 2,
  },
});
