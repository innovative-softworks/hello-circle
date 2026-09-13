import type { Circle } from '@hello-circle/types';
import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

const PREVIEW_LIMIT = 3;

// My Life's compact "Your Circles" preview (spec §37) — real per-circle
// signals only: a scheduled `nextPlan`, else a real `plansThisMonth` count,
// else the circle's own activity label. Never a fabricated "N new updates"
// — this backend has no per-circle notification/update feed.
export function CirclesSection({ circles }: { circles: Circle[] }) {
  const theme = useTheme();

  if (!circles.length) {
    return (
      <View style={styles.section}>
        <ThemedText type="sectionHeading">Your Circles</ThemedText>
        <ThemedText themeColor="textSecondary">You haven&apos;t joined any Circles yet.</ThemedText>
        <Pressable onPress={() => router.push('/circles')}>
          <ThemedText themeColor="primary">Discover Circles →</ThemedText>
        </Pressable>
      </View>
    );
  }

  const preview = circles.slice(0, PREVIEW_LIMIT);

  return (
    <View style={styles.section}>
      <ThemedText type="sectionHeading">Your Circles</ThemedText>
      {preview.map((circle) => (
        <Pressable
          key={circle.id}
          onPress={() => router.push(`/(details)/circle/${circle.id}`)}
          style={[styles.row, { borderColor: theme.border }]}>
          <ThemedText type="cardHeading" numberOfLines={1}>
            {circle.name}
          </ThemedText>
          <ThemedText themeColor="textSecondary">
            {circle.nextPlan
              ? `Next: ${circle.nextPlan.date}`
              : circle.plansThisMonth > 0
                ? `${circle.plansThisMonth} plan${circle.plansThisMonth === 1 ? '' : 's'} this month`
                : circle.activityLabel}
          </ThemedText>
        </Pressable>
      ))}
      {circles.length > PREVIEW_LIMIT && (
        <Pressable onPress={() => router.push('/circles')}>
          <ThemedText themeColor="primary">See all →</ThemedText>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: Spacing.two,
  },
  row: {
    borderWidth: 1,
    borderRadius: Radius.card,
    padding: Spacing.three,
    gap: 2,
  },
});
