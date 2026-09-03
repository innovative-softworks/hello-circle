import type { Centre, Club } from '@hello-circle/types';
import { radius } from '@hello-circle/design-tokens';
import { Image } from 'expo-image';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatPrice } from '@/lib/format';

type Place = ({ listingType: 'centre' } & Centre) | ({ listingType: 'club' } & Club);

export function PlaceCard({ place, onPress }: { place: Place; onPress: () => void }) {
  const theme = useTheme();
  const price = place.listingType === 'centre' ? `From ${formatPrice(place.from)}/hr` : `${formatPrice(place.price)}/${place.unit}`;

  return (
    <Pressable onPress={onPress} style={[styles.card, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
      {place.image ? (
        <Image source={{ uri: place.image }} style={styles.image} contentFit="cover" />
      ) : (
        <View style={[styles.image, { backgroundColor: theme.primary, opacity: 0.15 }]} />
      )}
      <View style={styles.body}>
        <ThemedText numberOfLines={1} style={styles.title}>
          {place.name}
        </ThemedText>
        <ThemedText themeColor="textSecondary" numberOfLines={1} style={styles.small}>
          {place.area}, {place.county}
        </ThemedText>
        <ThemedText themeColor="primary" style={styles.small}>
          {price}
        </ThemedText>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    width: 180,
    borderRadius: radius.card,
    borderWidth: 1,
    overflow: 'hidden',
  },
  image: {
    width: '100%',
    height: 100,
  },
  body: {
    padding: Spacing.two,
    gap: 2,
  },
  title: {
    fontWeight: '700',
    fontSize: 14,
  },
  small: {
    fontSize: 12,
  },
});
