import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { fetchCircleMembers, fetchMyCircles } from '@/api/circles';
import { useAuthStore } from '@/auth/store';
import { AvatarGroup } from '@/components/AvatarGroup';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';

// Redesign spec §07 ("People are making plans") — real participation, never
// a fabricated headcount. Reuses the ['my-circles'] query YourCircles below
// also fetches (TanStack dedupes), then picks whichever joined circle has
// the nearest real upcoming plan (`Circle.nextPlan`, computed server-side —
// see packages/types's own comment on it) and shows its real member names.
export function PeopleAreMakingPlans() {
  const signedIn = useAuthStore((state) => state.status === 'signedIn');
  const { data: circles } = useQuery({ queryKey: ['my-circles'], queryFn: fetchMyCircles, enabled: signedIn });

  const withPlan = (circles ?? []).filter((c) => c.nextPlan);
  const featured = withPlan.sort((a, b) => (b.nextPlan?.joined ?? 0) - (a.nextPlan?.joined ?? 0))[0];

  const { data: members } = useQuery({
    queryKey: ['circle-members', featured?.id],
    queryFn: () => fetchCircleMembers(featured!.id),
    enabled: !!featured,
  });

  if (!signedIn || !featured?.nextPlan) return null;

  return (
    <View style={{ paddingHorizontal: Spacing.four, gap: Spacing.two }}>
      <ThemedText type="eyebrow">People are making plans</ThemedText>
      <AvatarGroup
        people={(members?.members ?? []).map((m) => ({ name: m.name }))}
        total={featured.nextPlan.joined}
      />
      <ThemedText type="editorial">
        {featured.nextPlan.joined} people from{'\n'}
        {featured.name} have a plan.
      </ThemedText>
      <ThemedText type="metadata">
        {featured.nextPlan.date} at {featured.nextPlan.time} · {featured.nextPlan.spotsLeft} spots left
      </ThemedText>
      <Pressable onPress={() => router.push(`/(details)/circle/${featured.id}`)} style={styles.cta}>
        <ThemedText type="smallBold" themeColor="primary">
          Join them →
        </ThemedText>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  cta: {
    marginTop: Spacing.one,
  },
});
