import { BottomSheetModal, BottomSheetView } from '@gorhom/bottom-sheet';
import { forwardRef, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import { Chip } from '@/components/Chip';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import type { SortKey, When } from '@/lib/exploreFilters';
import { useTheme } from '@/hooks/use-theme';

export interface ExploreFilters {
  when: When;
  needsPeopleOnly: boolean;
  sort: SortKey;
  // null = no cap ("Any"). A real client-side filter over DiscoverItem's
  // real priceCents field — no server-side price-range param exists, so
  // this is applied the same way filterByWhen/filterNeedsPeople already are.
  priceMaxCents: number | null;
}

const WHEN_OPTIONS: { key: When; label: string }[] = [
  { key: '', label: 'Anytime' },
  { key: 'today', label: 'Today' },
  { key: 'tonight', label: 'Tonight' },
  { key: 'weekend', label: 'This weekend' },
  { key: 'next-week', label: 'Next week' },
];

const PRICE_OPTIONS: { key: string; label: string; maxCents: number | null }[] = [
  { key: 'any', label: 'Any', maxCents: null },
  { key: 'under20', label: 'Under €20', maxCents: 2000 },
  { key: 'under50', label: 'Under €50', maxCents: 5000 },
];

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: 'recommended', label: 'Recommended' },
  { key: 'soonest', label: 'Soonest' },
  { key: 'needs-people', label: 'Needs people' },
  { key: 'price-asc', label: 'Price: low to high' },
];

export const FilterSheet = forwardRef<BottomSheetModal, { filters: ExploreFilters; onChange: (filters: ExploreFilters) => void }>(
  function FilterSheet({ filters, onChange }, ref) {
    const theme = useTheme();
    const snapPoints = useMemo(() => ['75%'], []);

    return (
      <BottomSheetModal ref={ref} snapPoints={snapPoints} backgroundStyle={{ backgroundColor: theme.background }}>
        <BottomSheetView style={styles.content}>
          <ThemedText type="sectionHeading">When</ThemedText>
          <View style={styles.row}>
            {WHEN_OPTIONS.map((option) => (
              <Chip key={option.key} label={option.label} selected={filters.when === option.key} onPress={() => onChange({ ...filters, when: option.key })} />
            ))}
          </View>

          <ThemedText type="sectionHeading">Price</ThemedText>
          <View style={styles.row}>
            {PRICE_OPTIONS.map((option) => (
              <Chip
                key={option.key}
                label={option.label}
                selected={filters.priceMaxCents === option.maxCents}
                onPress={() => onChange({ ...filters, priceMaxCents: option.maxCents })}
              />
            ))}
          </View>

          <ThemedText type="sectionHeading">Sort by</ThemedText>
          <View style={styles.row}>
            {SORT_OPTIONS.map((option) => (
              <Chip key={option.key} label={option.label} selected={filters.sort === option.key} onPress={() => onChange({ ...filters, sort: option.key })} />
            ))}
          </View>

          <Chip
            label="Needs people only"
            selected={filters.needsPeopleOnly}
            onPress={() => onChange({ ...filters, needsPeopleOnly: !filters.needsPeopleOnly })}
          />
        </BottomSheetView>
      </BottomSheetModal>
    );
  }
);

const styles = StyleSheet.create({
  content: {
    padding: Spacing.four,
    gap: Spacing.three,
  },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
});
