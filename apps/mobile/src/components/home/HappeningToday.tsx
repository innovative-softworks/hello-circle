import { useQuery } from '@tanstack/react-query';
import { ScrollView } from 'react-native';

import { fetchDiscover } from '@/api/discovery';
import { ActivityCard } from '@/components/home/ActivityCard';
import { SectionHeader } from '@/components/home/SectionHeader';
import { Spacing } from '@/constants/theme';

// Two sections (this one + ThisWeekend) both query ['discover', county] —
// TanStack Query dedupes identical keys, so this is one network call, not
// two, even though each section "owns" its own useQuery per the plan.
export function HappeningToday({ county }: { county: string | null }) {
  const { data } = useQuery({
    queryKey: ['discover', county],
    queryFn: () => fetchDiscover(county ?? undefined),
  });

  if (!data?.today.length) return null;

  return (
    <>
      <SectionHeader title="Happening today" />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: Spacing.two, paddingHorizontal: Spacing.four }}>
        {data.today.map((item) => (
          <ActivityCard key={item.id} item={item} />
        ))}
      </ScrollView>
    </>
  );
}
