import { useEffect, useMemo } from 'react';
import { Animated, StyleSheet, View, type DimensionValue } from 'react-native';

import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

// Skeleton layouts matching actual content shape, per spec §28 — used in
// place of a centered spinner. A subtle opacity pulse via the classic
// react-native Animated API (not react-native-reanimated — this codebase
// doesn't otherwise use it, and its shared-value mutation pattern trips the
// project's react-hooks/immutability lint rule). The Animated.Value is
// created via useMemo rather than useRef().current — the project's
// react-hooks/refs rule flags reading ref.current during render, which
// useMemo's plain return value sidesteps.
function Pulse({ width, height, radius = 8 }: { width: DimensionValue; height: number; radius?: number }) {
  const theme = useTheme();
  const opacity = useMemo(() => new Animated.Value(0.4), []);

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.9, duration: 700, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.4, duration: 700, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);

  return <Animated.View style={{ width, height, borderRadius: radius, backgroundColor: theme.backgroundSelected, opacity }} />;
}

// Mirrors ActivityCard/PlaceCard's shape — used while a Home rail's query
// is loading, in place of the rail rendering nothing until data arrives.
export function ActivityCardSkeleton() {
  return (
    <View style={{ width: 220, gap: Spacing.two }}>
      <Pulse width="100%" height={120} radius={16} />
      <Pulse width="70%" height={14} />
      <Pulse width="50%" height={12} />
    </View>
  );
}

export function SkeletonRail({ count = 3 }: { count?: number }) {
  return (
    <View style={styles.rail}>
      {Array.from({ length: count }).map((_, i) => (
        <ActivityCardSkeleton key={i} />
      ))}
    </View>
  );
}

// Mirrors CompactActivityRow's shape — used in Explore's results list and
// the Circles tab while loading.
export function CompactRowSkeleton() {
  return (
    <View style={styles.row}>
      <Pulse width={100} height={90} radius={12} />
      <View style={{ flex: 1, gap: 6, justifyContent: 'center' }}>
        <Pulse width="40%" height={10} />
        <Pulse width="80%" height={16} />
        <Pulse width="60%" height={12} />
      </View>
    </View>
  );
}

export function SkeletonList({ count = 4 }: { count?: number }) {
  return (
    <View>
      {Array.from({ length: count }).map((_, i) => (
        <CompactRowSkeleton key={i} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  rail: {
    flexDirection: 'row',
    gap: Spacing.two,
    paddingHorizontal: Spacing.four,
  },
  row: {
    flexDirection: 'row',
    gap: Spacing.three,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
  },
});
