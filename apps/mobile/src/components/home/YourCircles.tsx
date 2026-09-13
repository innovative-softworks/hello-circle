import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { ScrollView } from 'react-native';

import { fetchMyCircles } from '@/api/circles';
import { useAuthStore } from '@/auth/store';
import { Card } from '@/components/Card';
import { SectionHeader } from '@/components/home/SectionHeader';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';

// Restyled onto the shared Card shell with real circle photography where it
// exists (redesign spec §27 — "avoid generic alphabet avatars whenever
// imagery exists"). Only shows a "next plan" line when `circle.nextPlan` is
// genuinely present — no invented update counts.
export function YourCircles() {
  const signedIn = useAuthStore((state) => state.status === 'signedIn');
  const { data } = useQuery({
    queryKey: ['my-circles'],
    queryFn: fetchMyCircles,
    enabled: signedIn,
  });

  if (!signedIn || !data?.length) return null;

  return (
    <>
      <SectionHeader title="Your Circles" />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: Spacing.two, paddingHorizontal: Spacing.four }}>
        {data.map((circle) => (
          <Card
            key={circle.id}
            width={180}
            imageHeight={100}
            imageUrl={circle.imageUrl}
            placeholderIcon="people-outline"
            onPress={() => router.push(`/(details)/circle/${circle.id}`)}>
            <ThemedText numberOfLines={1} style={{ fontWeight: '700', fontSize: 14 }}>
              {circle.name}
            </ThemedText>
            <ThemedText themeColor="textSecondary" style={{ fontSize: 12 }}>
              {circle.members} members
            </ThemedText>
            {circle.nextPlan && (
              <ThemedText themeColor="primary" style={{ fontSize: 12 }}>
                Next: {circle.nextPlan.date}
              </ThemedText>
            )}
          </Card>
        ))}
      </ScrollView>
    </>
  );
}
