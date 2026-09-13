import { BottomSheetModal, BottomSheetView } from '@gorhom/bottom-sheet';
import { forwardRef, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import { Chip } from '@/components/Chip';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { IRISH_COUNTY_COORDS } from '@/lib/irishCounties';
import { useOnboardingStore } from '@/onboarding/store';

const COUNTIES = Object.keys(IRISH_COUNTY_COORDS).sort((a, b) => a.localeCompare(b));

// Shared by AppHeader's location selector and Settings > Location — a
// lightweight re-pick, distinct from onboarding/location.tsx which ends in
// a "Continue" that advances the onboarding flow (wrong action once already
// past onboarding).
export const CountyPickerSheet = forwardRef<BottomSheetModal>(function CountyPickerSheet(_props, ref) {
  const theme = useTheme();
  const county = useOnboardingStore((state) => state.homeCounty);
  const setHomeCounty = useOnboardingStore((state) => state.setHomeCounty);
  const snapPoints = useMemo(() => ['50%'], []);

  return (
    <BottomSheetModal ref={ref} snapPoints={snapPoints} backgroundStyle={{ backgroundColor: theme.background }}>
      <BottomSheetView style={styles.content}>
        <ThemedText type="cardHeading">Where are you based?</ThemedText>
        <View style={styles.grid}>
          {COUNTIES.map((c) => (
            <Chip
              key={c}
              label={c}
              selected={county === c}
              onPress={() => {
                setHomeCounty(c);
                if (ref && 'current' in ref) ref.current?.dismiss();
              }}
            />
          ))}
        </View>
      </BottomSheetView>
    </BottomSheetModal>
  );
});

const styles = StyleSheet.create({
  content: {
    padding: Spacing.four,
    gap: Spacing.three,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
});
