import { Ionicons } from '@expo/vector-icons';
import { BottomSheetModal } from '@gorhom/bottom-sheet';
import { router, useLocalSearchParams } from 'expo-router';
import { useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CategoryTabs, type Category } from '@/components/explore/CategoryTabs';
import { Chip } from '@/components/Chip';
import { CuratedWeekend } from '@/components/explore/CuratedWeekend';
import { FilterSheet, type ExploreFilters } from '@/components/explore/FilterSheet';
import { FreeTimeResults } from '@/components/explore/FreeTimeResults';
import { PopularRightNow } from '@/components/explore/PopularRightNow';
import { ResultsList } from '@/components/explore/ResultsList';
import { ResultsMap } from '@/components/explore/ResultsMap';
import { SearchBar } from '@/components/explore/SearchBar';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useLocation } from '@/hooks/useLocation';
import { useTheme } from '@/hooks/use-theme';
import { useOnboardingStore } from '@/onboarding/store';

type ViewMode = 'list' | 'map';
// Mood/context row (redesign spec §15) — the four that map to real data:
// Tonight/This Weekend reuse the existing games `when` filter, Near Me and
// 90 Minutes Free both run through fetchFreeTimeOptions() via
// FreeTimeResults. Free/Under €20/Outdoors/Family have no backing filter
// today — deliberately left out rather than wired up as a no-op.
type MoodContext = 'tonight' | 'weekend' | 'nearMe' | 'freeTime';
const MOODS: { key: MoodContext; label: string }[] = [
  { key: 'tonight', label: 'Tonight' },
  { key: 'weekend', label: 'This weekend' },
  { key: 'nearMe', label: 'Near me' },
  { key: 'freeTime', label: '90 minutes free' },
];

const DEFAULT_FILTERS: ExploreFilters = { when: '', needsPeopleOnly: false, sort: 'recommended', priceMaxCents: null };
const VALID_CATEGORIES: Category[] = ['games', 'centres', 'clubs', 'adventures', 'experiences', 'circles'];

export default function ExploreScreen() {
  const theme = useTheme();
  const county = useOnboardingStore((state) => state.homeCounty);
  const params = useLocalSearchParams<{ category?: string; mood?: string; maxMinutes?: string }>();
  const [q, setQ] = useState('');
  const [category, setCategory] = useState<Category>('centres');
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [filters, setFilters] = useState<ExploreFilters>(DEFAULT_FILTERS);
  const [mood, setMood] = useState<MoodContext | null>(null);
  const filterSheetRef = useRef<BottomSheetModal>(null);
  const { coords, error: locationError, loading: locationLoading, requestLocation } = useLocation();

  // Home's quick-discovery chips (spec §10) deep-link here with a preset
  // category rather than owning their own results list. Adjusting state
  // during render (rather than in a useEffect) per React's own guidance for
  // "state that changes when a prop changes" — avoids an extra render pass.
  const [prevCategoryParam, setPrevCategoryParam] = useState(params.category);
  if (params.category !== prevCategoryParam) {
    setPrevCategoryParam(params.category);
    if (params.category && VALID_CATEGORIES.includes(params.category as Category)) {
      setCategory(params.category as Category);
    }
  }
  // Home's "90 minutes free?" section (spec §07) deep-links here with
  // mood/maxMinutes params — same render-time sync pattern as above.
  const [prevMoodParam, setPrevMoodParam] = useState(params.maxMinutes);
  if (params.maxMinutes !== prevMoodParam) {
    setPrevMoodParam(params.maxMinutes);
    if (params.maxMinutes) setMood('freeTime');
  }
  // Home's mood pills (Today/This Weekend/Near Me) deep-link with a direct
  // mood key instead — same MoodContext values Explore's own row uses.
  const [prevDirectMoodParam, setPrevDirectMoodParam] = useState(params.mood);
  if (params.mood !== prevDirectMoodParam) {
    setPrevDirectMoodParam(params.mood);
    if (params.mood === 'tonight' || params.mood === 'weekend' || params.mood === 'nearMe') {
      selectMood(params.mood);
    }
  }

  function selectMood(next: MoodContext) {
    if (mood === next) {
      setMood(null);
      return;
    }
    setMood(next);
    if (next === 'tonight') {
      setCategory('games');
      setFilters({ ...filters, when: 'tonight' });
    } else if (next === 'weekend') {
      setCategory('games');
      setFilters({ ...filters, when: 'weekend' });
    } else if (next === 'nearMe') {
      requestLocation();
    }
  }

  const showFreeTime = mood === 'nearMe' || mood === 'freeTime';

  return (
    <ThemedView style={{ flex: 1 }}>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <View style={{ paddingHorizontal: Spacing.four, gap: Spacing.three }}>
          <ThemedText type="pageHeading">What are you in{'\n'}the mood for today?</ThemedText>
          <SearchBar value={q} onChangeText={setQ} />
          <Pressable onPress={() => router.push('/ask')} style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.one }}>
            <Ionicons name="sparkles-outline" size={16} color={theme.primary} />
            <ThemedText type="smallBold" themeColor="primary">
              Or ask HelloCircle in plain English →
            </ThemedText>
          </Pressable>
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: Spacing.two, paddingHorizontal: Spacing.four, paddingVertical: Spacing.three }}>
          {MOODS.map((m) => (
            <Chip key={m.key} label={m.label} selected={mood === m.key} onPress={() => selectMood(m.key)} />
          ))}
        </ScrollView>

        {showFreeTime ? (
          <ScrollView contentContainerStyle={{ paddingBottom: Spacing.four }}>
            <FreeTimeResults
              county={county}
              maxMinutes={mood === 'freeTime' ? 90 : undefined}
              mood={mood === 'freeTime' ? params.mood : undefined}
              coords={mood === 'nearMe' ? coords : undefined}
              locationError={mood === 'nearMe' && !locationLoading ? locationError : undefined}
            />
          </ScrollView>
        ) : (
          <>
            <View style={{ paddingHorizontal: Spacing.four, gap: Spacing.three }}>
              <View style={styles.toolbar}>
                <Pressable onPress={() => filterSheetRef.current?.present()}>
                  <ThemedText themeColor="primary">Filters</ThemedText>
                </Pressable>
                <View style={styles.toggle}>
                  <Pressable onPress={() => setViewMode('list')}>
                    <ThemedText themeColor={viewMode === 'list' ? 'primary' : 'textSecondary'}>List</ThemedText>
                  </Pressable>
                  <Pressable onPress={() => setViewMode('map')}>
                    <ThemedText themeColor={viewMode === 'map' ? 'primary' : 'textSecondary'}>Map</ThemedText>
                  </Pressable>
                </View>
              </View>
            </View>

            <View style={{ paddingVertical: Spacing.three }}>
              <CategoryTabs value={category} onChange={setCategory} />
            </View>

            {viewMode === 'list' ? (
              <ScrollView contentContainerStyle={{ paddingBottom: Spacing.four, gap: Spacing.four }}>
                {!q.trim() && <CuratedWeekend county={county} />}
                {!q.trim() && <PopularRightNow county={county} />}
                <ResultsList category={category} q={q} county={county} filters={filters} />
              </ScrollView>
            ) : (
              <ResultsMap category={category} county={county} />
            )}
          </>
        )}

        <FilterSheet ref={filterSheetRef} filters={filters} onChange={setFilters} />
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  toolbar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  toggle: {
    flexDirection: 'row',
    gap: Spacing.three,
  },
});
