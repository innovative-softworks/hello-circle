import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { fetchDiscover } from '@/api/discovery';
import { fetchMyResidentProfile } from '@/api/residents';
import { useAuthStore } from '@/auth/store';
import { AppHeader } from '@/components/AppHeader';
import { BecauseYouLike } from '@/components/home/BecauseYouLike';
import { HappeningToday } from '@/components/home/HappeningToday';
import { PeopleAreMakingPlans } from '@/components/home/PeopleAreMakingPlans';
import { NinetyMinutesFree } from '@/components/home/NinetyMinutesFree';
import { SpacesAvailableToday } from '@/components/home/SpacesAvailableToday';
import { ThisWeekend } from '@/components/home/ThisWeekend';
import { YourCircles } from '@/components/home/YourCircles';
import { Chip } from '@/components/Chip';
import type { Category } from '@/components/explore/CategoryTabs';
import { EditorialHero } from '@/components/EditorialHero';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useOnboardingStore } from '@/onboarding/store';

// Mirrors Explore's own CategoryTabs taxonomy — the real one this backend
// has data for — rather than inventing spec categories (Activities/Places/
// Sports/Wellbeing) with nothing behind them.
// Home's mood pills (spec's "Today / This Weekend / Near Me") — deep-link
// into Explore with the same mood keys Explore's own mood row already
// drives (tonight's real filter is "date === today", same semantics).
const MOOD_PILLS: { mood: 'tonight' | 'weekend' | 'nearMe'; label: string }[] = [
  { mood: 'tonight', label: 'Today' },
  { mood: 'weekend', label: 'This Weekend' },
  { mood: 'nearMe', label: 'Near Me' },
];

const QUICK_CATEGORIES: { key: Category; label: string }[] = [
  { key: 'games', label: 'Games' },
  { key: 'centres', label: 'Places' },
  { key: 'clubs', label: 'Clubs' },
  { key: 'circles', label: 'Circles' },
  { key: 'adventures', label: 'Adventures' },
  { key: 'experiences', label: 'Experiences' },
];

function timeOfDayGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

// An editorial local-life edition, not a dashboard (redesign spec §07/§14) —
// every section below has a different silhouette on purpose: cinematic
// hero, compact row rail, single-feature story, text-led module, avatar
// cards, closing statement. See the Phase 2 plan for the full section list.
export default function HomeScreen() {
  const theme = useTheme();
  const county = useOnboardingStore((state) => state.homeCounty);
  const signedIn = useAuthStore((state) => state.status === 'signedIn');

  const discoverQuery = useQuery({
    queryKey: ['discover', county],
    queryFn: () => fetchDiscover(county ?? undefined),
  });
  const profileQuery = useQuery({
    queryKey: ['my-resident-profile'],
    queryFn: fetchMyResidentProfile,
    enabled: signedIn,
  });

  const today = discoverQuery.data?.today ?? [];
  const weekend = discoverQuery.data?.weekend ?? [];
  const heroItem = today[0] ?? null;
  const restOfToday = today.slice(1);

  const firstName = profileQuery.data?.resident?.name?.split(' ')[0];
  const greeting = firstName ? `${timeOfDayGreeting()}, ${firstName} 👋` : timeOfDayGreeting();

  return (
    <ThemedView style={{ flex: 1 }}>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <ScrollView contentContainerStyle={{ gap: Spacing.five, paddingBottom: Spacing.five }}>
          <AppHeader greeting={greeting} />

          {heroItem && (
            <EditorialHero
              imageUrl={heroItem.imageUrl}
              eyebrow="Today"
              title={heroItem.title}
              metadata={[heroItem.time, heroItem.centreName ?? heroItem.clubName].filter(Boolean).join(' · ')}
              ctaLabel={heroItem.kind === 'game' ? 'Join them' : undefined}
              onPress={heroItem.kind === 'game' ? () => router.push(`/(details)/game/${heroItem.id}`) : undefined}
            />
          )}

          <View style={{ paddingHorizontal: Spacing.four, gap: Spacing.two }}>
            <Pressable
              onPress={() => router.push('/search')}
              style={{
                borderWidth: 1,
                borderColor: theme.border,
                backgroundColor: theme.backgroundElement,
                borderRadius: 12,
                paddingHorizontal: 14,
                height: 44,
                justifyContent: 'center',
              }}>
              <ThemedText themeColor="textSecondary">What do you want to do?</ThemedText>
            </Pressable>
          </View>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: Spacing.two, paddingHorizontal: Spacing.four }}>
            {MOOD_PILLS.map((pill) => (
              <Chip key={pill.mood} label={pill.label} selected={false} onPress={() => router.push({ pathname: '/explore', params: { mood: pill.mood } })} />
            ))}
          </ScrollView>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: Spacing.two, paddingHorizontal: Spacing.four }}>
            {QUICK_CATEGORIES.map((c) => (
              <Chip key={c.key} label={c.label} selected={false} onPress={() => router.push({ pathname: '/explore', params: { category: c.key } })} />
            ))}
          </ScrollView>

          <HappeningToday items={restOfToday} isLoading={discoverQuery.isLoading} />
          <ThisWeekend item={weekend[0] ?? null} isLoading={discoverQuery.isLoading} />
          <PeopleAreMakingPlans />
          <NinetyMinutesFree county={county} />
          <SpacesAvailableToday county={county} />
          <YourCircles />
          <BecauseYouLike />
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}
