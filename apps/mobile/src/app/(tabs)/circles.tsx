import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { fetchCircles, fetchMyCircles } from '@/api/circles';
import { useAuthStore } from '@/auth/store';
import { Card } from '@/components/Card';
import { Chip } from '@/components/Chip';
import { EmptyState } from '@/components/EmptyState';
import { SkeletonList } from '@/components/SkeletonLoader';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useOnboardingStore } from '@/onboarding/store';

type CirclesTab = 'mine' | 'discover' | 'nearby';

const TABS: { key: CirclesTab; label: string }[] = [
  { key: 'mine', label: 'Your Circles' },
  { key: 'discover', label: 'Discover' },
  { key: 'nearby', label: 'Nearby' },
];

// "Nearby" reuses the same public browse list as "Discover" (fetchCircles) —
// there's no separate geo-sorted endpoint yet. A real distance sort is a
// later-phase server change, not part of this foundation pass.
export default function CirclesScreen() {
  const county = useOnboardingStore((state) => state.homeCounty);
  const signedIn = useAuthStore((state) => state.status === 'signedIn');
  const [tab, setTab] = useState<CirclesTab>(signedIn ? 'mine' : 'discover');
  const [activity, setActivity] = useState<string | null>(null);

  const mineQuery = useQuery({ queryKey: ['my-circles'], queryFn: fetchMyCircles, enabled: signedIn && tab === 'mine' });
  const browseQuery = useQuery({
    queryKey: ['circles-browse', county],
    queryFn: () => fetchCircles(county ?? undefined),
    enabled: tab === 'discover' || tab === 'nearby',
  });

  const unfiltered = tab === 'mine' ? mineQuery.data : browseQuery.data;
  const loading = tab === 'mine' ? mineQuery.isLoading : browseQuery.isLoading;
  // Real interest categories, not a fabricated taxonomy — Circle has no
  // structured category field (CLAUDE.md's known gap on unstructured
  // preferences), so this derives distinct activityLabel values straight
  // from the browse list itself, same as the game/circle detail chips.
  const activities = tab !== 'mine' ? Array.from(new Set((unfiltered ?? []).map((c) => c.activityLabel).filter(Boolean))).sort() : [];
  const circles = activity ? unfiltered?.filter((c) => c.activityLabel === activity) : unfiltered;

  return (
    <ThemedView style={{ flex: 1 }}>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <View style={{ paddingHorizontal: Spacing.four, gap: Spacing.half }}>
          <ThemedText type="pageHeading">Circles</ThemedText>
          <ThemedText themeColor="textSecondary">Find your people.</ThemedText>
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: Spacing.two, paddingHorizontal: Spacing.four, paddingVertical: Spacing.three }}>
          {TABS.map((t) => (
            <Chip
              key={t.key}
              label={t.label}
              selected={tab === t.key}
              onPress={() => {
                setTab(t.key);
                setActivity(null);
              }}
            />
          ))}
        </ScrollView>

        {activities.length > 0 && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: Spacing.two, paddingHorizontal: Spacing.four, paddingBottom: Spacing.three }}>
            <Chip label="All" selected={!activity} onPress={() => setActivity(null)} />
            {activities.map((label) => (
              <Chip key={label} label={label} selected={activity === label} onPress={() => setActivity(activity === label ? null : label)} />
            ))}
          </ScrollView>
        )}

        {tab === 'mine' && !signedIn ? (
          <EmptyState icon="people-circle-outline" title="Your people are out there." description="Sign in to see the Circles you've joined." />
        ) : loading ? (
          <SkeletonList />
        ) : !circles?.length ? (
          <EmptyState
            icon="people-circle-outline"
            title={tab === 'mine' ? "You haven't joined any Circles yet." : 'No Circles found nearby.'}
            description={tab === 'mine' ? 'Discover communities around the things you enjoy.' : undefined}
          />
        ) : (
          <ScrollView contentContainerStyle={{ padding: Spacing.four, gap: Spacing.three }}>
            {circles.map((circle) => (
              <Card key={circle.id} imageUrl={circle.imageUrl} imageHeight={140} placeholderIcon="people-outline" onPress={() => router.push(`/(details)/circle/${circle.id}`)}>
                <ThemedText type="cardHeading" numberOfLines={1}>
                  {circle.name}
                </ThemedText>
                <ThemedText type="metadata">
                  {circle.members} members · {circle.area}
                </ThemedText>
                {circle.nextPlan ? (
                  <ThemedText type="metadata" themeColor="primary">
                    Next: {circle.nextPlan.date}
                  </ThemedText>
                ) : (
                  <ThemedText type="metadata">{circle.activityLabel}</ThemedText>
                )}
              </Card>
            ))}
          </ScrollView>
        )}
      </SafeAreaView>
    </ThemedView>
  );
}
