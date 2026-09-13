import { useQuery } from '@tanstack/react-query';
import { ScrollView, View } from 'react-native';

import { fetchNextBestParticipation } from '@/api/discovery';
import { useAuthStore } from '@/auth/store';
import { ActivityCard } from '@/components/home/ActivityCard';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';

// The closing editorial moment (redesign spec §07/§14) — real personalized
// recommendations, styled as a statement rather than another plain rail
// heading, since it's the last thing a resident sees before the feed ends.
// Signed-in only — server derives the resident from the bearer token.
// `enabled` stops the query from firing at all for a signed-out visitor,
// rather than firing it and discarding a 401.
export function BecauseYouLike() {
  const signedIn = useAuthStore((state) => state.status === 'signedIn');
  const { data } = useQuery({
    queryKey: ['next-best'],
    queryFn: fetchNextBestParticipation,
    enabled: signedIn,
  });

  if (!signedIn || !data?.length) return null;

  return (
    <>
      <View style={{ paddingHorizontal: Spacing.four, marginBottom: Spacing.two }}>
        <ThemedText type="editorial">Because you like…</ThemedText>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: Spacing.two, paddingHorizontal: Spacing.four }}>
        {data.map((item) => (
          <ActivityCard key={item.id} item={item} />
        ))}
      </ScrollView>
    </>
  );
}
