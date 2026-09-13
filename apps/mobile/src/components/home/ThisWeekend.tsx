import type { DiscoverItem } from '@hello-circle/types';
import { router } from 'expo-router';

import { EditorialHero } from '@/components/EditorialHero';
import { SectionHeader } from '@/components/home/SectionHeader';
import { SkeletonRail } from '@/components/SkeletonLoader';

// A single dominant feature, not a carousel — the spec's own worked example
// ("Go somewhere you haven't been.") is one story, not a rail of six. Only
// the soonest weekend item is shown; if the resident wants more they can
// tap through to Explore's "This Weekend" mood context (Phase 2b).
export function ThisWeekend({ item, isLoading }: { item: DiscoverItem | null; isLoading: boolean }) {
  if (isLoading) {
    return (
      <>
        <SectionHeader title="This weekend" />
        <SkeletonRail />
      </>
    );
  }

  if (!item) return null;

  return (
    <EditorialHero
      imageUrl={item.imageUrl}
      eyebrow="This weekend"
      title={"Go somewhere\nyou haven't been."}
      metadata={[item.title, item.time, item.centreName ?? item.clubName].filter(Boolean).join(' · ')}
      ctaLabel="Explore"
      onPress={item.kind === 'game' ? () => router.push(`/(details)/game/${item.id}`) : () => router.push('/explore')}
    />
  );
}
