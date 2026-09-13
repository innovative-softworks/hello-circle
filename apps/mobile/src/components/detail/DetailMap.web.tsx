import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';

// Platform-specific stand-in for DetailMap.tsx — react-native-maps has no
// web implementation (its native-binding modules call codegenNativeComponent
// at import time, which react-native-web doesn't provide, crashing the
// entire web bundle since expo-router eagerly validates every route's
// exports at startup). Metro resolves this .web.tsx file instead of
// DetailMap.tsx for web builds, so react-native-maps is never imported on
// web at all. Same props signature as the native version — an honest
// fallback, not a fake map (matches EmptyState's "never fabricate" convention).
export function DetailMap({ lat, lng, title }: { lat: number; lng: number; title: string }) {
  const theme = useTheme();
  return (
    <View style={[styles.map, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
      <ThemedText themeColor="textSecondary">Map view isn&apos;t available on web — see this in the mobile app.</ThemedText>
      <ThemedText themeColor="textSecondary" style={styles.coords}>
        {title} · {lat.toFixed(4)}, {lng.toFixed(4)}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  map: {
    width: '100%',
    minHeight: 160,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    gap: 4,
  },
  coords: {
    fontSize: 12,
  },
});
