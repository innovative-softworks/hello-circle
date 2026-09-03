import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/Button';
import { Chip } from '@/components/Chip';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useLocation } from '@/hooks/useLocation';
import { IRISH_COUNTY_COORDS, nearestCounty } from '@/lib/irishCounties';
import { useOnboardingStore } from '@/onboarding/store';

// Uses the full county list as candidates rather than web's "only counties
// with real listings" refinement — a reasonable Phase 2 simplification for
// a lightweight onboarding step, not a data-model change.
const COUNTIES = Object.keys(IRISH_COUNTY_COORDS).sort((a, b) => a.localeCompare(b));

export default function OnboardingLocationScreen() {
  const { homeCounty, setHomeCounty, setUseGpsLocation } = useOnboardingStore();
  const { loading, error, requestLocation } = useLocation();
  const [selected, setSelected] = useState(homeCounty);

  async function handleUseMyLocation() {
    const coords = await requestLocation();
    if (!coords) return;
    const county = nearestCounty(coords.lat, coords.lng, COUNTIES);
    if (county) {
      setSelected(county);
      setHomeCounty(county);
      setUseGpsLocation(true);
    }
  }

  function handleSelect(county: string) {
    setSelected(county);
    setHomeCounty(county);
    setUseGpsLocation(false);
  }

  function handleNext() {
    router.push('/onboarding/interests');
  }

  return (
    <ThemedView style={{ flex: 1 }}>
      <SafeAreaView style={{ flex: 1, padding: Spacing.four, gap: Spacing.three }}>
        <ThemedText type="title">Where are you based?</ThemedText>
        <ThemedText themeColor="textSecondary">We&apos;ll show you what&apos;s happening nearby.</ThemedText>

        <Button label={loading ? 'Locating…' : 'Use my location'} onPress={handleUseMyLocation} loading={loading} />
        {error && <ThemedText themeColor="danger">{error}</ThemedText>}

        <ScrollView contentContainerStyle={{ flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two, paddingVertical: Spacing.three }}>
          {COUNTIES.map((county) => (
            <Chip key={county} label={county} selected={selected === county} onPress={() => handleSelect(county)} />
          ))}
        </ScrollView>

        <Button label="Continue" onPress={handleNext} disabled={!selected} />
        <Pressable onPress={handleNext} style={{ alignSelf: 'center' }}>
          <ThemedText themeColor="textSecondary">Skip for now</ThemedText>
        </Pressable>
      </SafeAreaView>
    </ThemedView>
  );
}
