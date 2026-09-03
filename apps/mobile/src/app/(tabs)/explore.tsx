import { BottomSheetModal } from '@gorhom/bottom-sheet';
import { useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CategoryTabs, type Category } from '@/components/explore/CategoryTabs';
import { FilterSheet, type ExploreFilters } from '@/components/explore/FilterSheet';
import { ResultsList } from '@/components/explore/ResultsList';
import { ResultsMap } from '@/components/explore/ResultsMap';
import { SearchBar } from '@/components/explore/SearchBar';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useOnboardingStore } from '@/onboarding/store';

type ViewMode = 'list' | 'map';

const DEFAULT_FILTERS: ExploreFilters = { when: '', needsPeopleOnly: false, sort: 'recommended' };

export default function ExploreScreen() {
  const county = useOnboardingStore((state) => state.homeCounty);
  const [q, setQ] = useState('');
  const [category, setCategory] = useState<Category>('centres');
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [filters, setFilters] = useState<ExploreFilters>(DEFAULT_FILTERS);
  const filterSheetRef = useRef<BottomSheetModal>(null);

  return (
    <ThemedView style={{ flex: 1 }}>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <View style={{ paddingHorizontal: Spacing.four, gap: Spacing.three }}>
          <SearchBar value={q} onChangeText={setQ} />
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
          <ScrollView contentContainerStyle={{ paddingBottom: Spacing.four }}>
            <ResultsList category={category} q={q} county={county} filters={filters} />
          </ScrollView>
        ) : (
          <ResultsMap category={category} county={county} />
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
