import { useQuery } from '@tanstack/react-query';
import { ScrollView } from 'react-native';

import { fetchNextBestParticipation } from '@/api/discovery';
import { useAuthStore } from '@/auth/store';
import { ActivityCard } from '@/components/home/ActivityCard';
import { SectionHeader } from '@/components/home/SectionHeader';
import { Spacing } from '@/constants/theme';

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
      <SectionHeader title="Because you like…" />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: Spacing.two, paddingHorizontal: Spacing.four }}>
        {data.map((item) => (
          <ActivityCard key={item.id} item={item} />
        ))}
      </ScrollView>
    </>
  );
}
