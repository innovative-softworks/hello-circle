import { Ionicons } from '@expo/vector-icons';
import type { Favourite } from '@hello-circle/types';
import { useEffect, useMemo, useRef } from 'react';
import { Animated, Pressable, StyleSheet } from 'react-native';

import { useFavourite } from '@/hooks/useFavourite';
import { useTheme } from '@/hooks/use-theme';
import { hapticLight } from '@/lib/haptics';

const AnimatedIonicons = Animated.createAnimatedComponent(Ionicons);

// Save: heart smoothly fills (spec §31) — a quick scale pop on state change,
// on top of the outline→filled swap the underlying useFavourite hook
// already drives. Uses the classic react-native Animated API, not react-
// native-reanimated — this codebase doesn't otherwise use it, and its
// shared-value mutation pattern trips the project's react-hooks/immutability
// lint rule. The Animated.Value itself is created via useMemo rather than
// useRef().current — the project's react-hooks/refs rule flags reading
// ref.current during render, which useMemo's plain return value sidesteps.
//
// Always rendered on ImmersiveHero's dark photo-overlay scrim (every current
// call site) — the unsaved color is a fixed light tone rather than
// `theme.textSecondary`, which is too dark to read against that scrim.
export function FavouriteHeart({
  listingType,
  listingId,
  initialSaved,
  screenPath,
}: {
  listingType: Favourite['listingType'];
  listingId: string;
  initialSaved: boolean;
  screenPath: string;
}) {
  const theme = useTheme();
  const { saved, pending, toggle } = useFavourite(listingType, listingId, initialSaved, screenPath);
  const scale = useMemo(() => new Animated.Value(1), []);
  const mounted = useRef(false);

  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    Animated.sequence([
      Animated.timing(scale, { toValue: 1.35, duration: 120, useNativeDriver: true }),
      Animated.timing(scale, { toValue: 1, duration: 160, useNativeDriver: true }),
    ]).start();
  }, [saved, scale]);

  function handlePress() {
    hapticLight();
    toggle();
  }

  return (
    <Pressable onPress={handlePress} disabled={pending} style={styles.button}>
      <AnimatedIonicons
        name={saved ? 'heart' : 'heart-outline'}
        size={22}
        color={saved ? theme.danger : '#fff'}
        style={{ transform: [{ scale }] }}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
