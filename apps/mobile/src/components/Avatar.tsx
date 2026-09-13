import { Image } from 'expo-image';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';

// A person, not a listing — spec §04/§27: circles for people, never the
// same card shape used for places/activities. Falls back to initials when
// no photo exists (never a generic silhouette icon, per the "no excessive
// iconography" rule) rather than skipping the person entirely.
export function Avatar({ imageUrl, name, size = 32 }: { imageUrl?: string | null; name: string; size?: number }) {
  const theme = useTheme();
  const initials = name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
  const dimension = { width: size, height: size, borderRadius: size / 2 };

  if (imageUrl) {
    return <Image source={{ uri: imageUrl }} style={[dimension, styles.image, { borderColor: theme.background }]} contentFit="cover" />;
  }

  return (
    <View style={[dimension, styles.fallback, { backgroundColor: theme.backgroundSelected, borderColor: theme.background }]}>
      <ThemedText themeColor="textSecondary" style={{ fontSize: size * 0.4, fontWeight: '700' }}>
        {initials || '?'}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  image: {
    borderWidth: 2,
  },
  fallback: {
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
