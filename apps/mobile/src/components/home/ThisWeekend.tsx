import { useQuery } from '@tanstack/react-query';
import { ScrollView } from 'react-native';

import { fetchDiscover } from '@/api/discovery';
import { ActivityCard } from '@/components/home/ActivityCard';
import { SectionHeader } from '@/components/home/SectionHeader';
import { Spacing } from '@/constants/theme';

export function ThisWeekend({ county }: { county: string | null }) {
  const { data } = useQuery({
    queryKey: ['discover', county],
    queryFn: () => fetchDiscover(county ?? undefined),
  });

  if (!data?.weekend.length) return null;

  return (
    <>
      <SectionHeader title="This weekend" />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: Spacing.two, paddingHorizontal: Spacing.four }}>
        {data.weekend.map((item) => (
          <ActivityCard key={item.id} item={item} />
        ))}
      </ScrollView>
    </>
  );
}
