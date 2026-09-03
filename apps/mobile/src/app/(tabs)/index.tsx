import { ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BecauseYouLike } from '@/components/home/BecauseYouLike';
import { HappeningToday } from '@/components/home/HappeningToday';
import { NearYou } from '@/components/home/NearYou';
import { ThisWeekend } from '@/components/home/ThisWeekend';
import { YourCircles } from '@/components/home/YourCircles';
import { Spacing } from '@/constants/theme';
import { ThemedView } from '@/components/themed-view';
import { useOnboardingStore } from '@/onboarding/store';

// Representative subset of web's Home.tsx (1608 lines, many more sections)
// — deliberately not full parity. Deferred: local momentum widget,
// market-categories grid, "Make It Happen" search box, household/routines,
// follow-feed digest. See the Phase 2 plan for the full list.
export default function HomeScreen() {
  const county = useOnboardingStore((state) => state.homeCounty);

  return (
    <ThemedView style={{ flex: 1 }}>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <ScrollView contentContainerStyle={{ gap: Spacing.four, paddingVertical: Spacing.four }}>
          <HappeningToday county={county} />
          <ThisWeekend county={county} />
          <NearYou county={county} />
          <YourCircles />
          <BecauseYouLike />
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}
