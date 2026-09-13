import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

// Category is a free-form display label ("Place", "Club", "Live now", …) —
// this maps the ones this app actually produces to a contextual placeholder
// icon; anything else falls back to a generic image icon rather than
// guessing.
function iconForCategory(category: string): keyof typeof Ionicons.glyphMap {
  const key = category.toLowerCase();
  if (key.includes('place')) return 'business-outline';
  if (key.includes('club') || key.includes('circle')) return 'people-outline';
  if (key.includes('game') || key.includes('live')) return 'calendar-outline';
  if (key.includes('experience')) return 'sparkles-outline';
  return 'image-outline';
}

// Editorial list row (spec §11) — image ~100x90, category/title/metadata/
// price — the default Explore result shape, replacing a grid-of-cards for
// list view. `PlaceCard`/`ActivityCard` remain the horizontal-rail card
// treatment used on Home, which is a deliberately different composition
// (spec §37 "mixed layout rhythm": rail vs. list vs. feature vs. grid).
export function CompactActivityRow({
  imageUrl,
  category,
  title,
  metadata,
  price,
  onPress,
}: {
  imageUrl: string | null | undefined;
  category: string;
  title: string;
  metadata: string;
  price?: string | null;
  onPress?: () => void;
}) {
  const theme = useTheme();
  const Container = onPress ? Pressable : View;

  return (
    <Container onPress={onPress} style={styles.row}>
      {imageUrl ? (
        <Image source={{ uri: imageUrl }} style={[styles.image, { backgroundColor: theme.backgroundSelected }]} contentFit="cover" />
      ) : (
        <View style={[styles.image, styles.placeholder, { backgroundColor: theme.backgroundSelected }]}>
          <Ionicons name={iconForCategory(category)} size={24} color={theme.textSecondary} />
        </View>
      )}
      <View style={styles.body}>
        <ThemedText type="eyebrow">{category}</ThemedText>
        <ThemedText type="cardHeading" numberOfLines={2}>
          {title}
        </ThemedText>
        <ThemedText type="metadata" numberOfLines={1}>
          {metadata}
        </ThemedText>
        {price != null && (
          <ThemedText type="metadata" themeColor="primary">
            {price}
          </ThemedText>
        )}
      </View>
    </Container>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: Spacing.three,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
  },
  image: {
    width: 100,
    height: 90,
    borderRadius: Radius.card,
  },
  placeholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    flex: 1,
    gap: 2,
    justifyContent: 'center',
  },
});
