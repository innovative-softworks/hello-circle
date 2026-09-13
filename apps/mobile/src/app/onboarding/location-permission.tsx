import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/Button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { nearestCounty, IRISH_COUNTY_COORDS } from '@/lib/irishCounties';
import { useLocation } from '@/hooks/useLocation';
import { useOnboardingStore } from '@/onboarding/store';

const REASONS: { icon: keyof typeof Ionicons.glyphMap; label: string }[] = [
  { icon: 'calendar-outline', label: 'Local activities and events' },
  { icon: 'business-outline', label: 'Nearby community spaces' },
  { icon: 'people-outline', label: 'People and circles around you' },
];

// Primes the real OS location permission prompt with an explanation first
// (a real UX pattern — asking cold gets rejected more often) — only reached
// from location.tsx once a home county is already picked, so "enable
// location" here is purely upgrading a fixed county to a precise point.
export default function LocationPermissionScreen() {
  const theme = useTheme();
  const { requestLocation } = useLocation();
  const setHomeLocation = useOnboardingStore((state) => state.setHomeLocation);
  const setUseGpsLocation = useOnboardingStore((state) => state.setUseGpsLocation);

  async function handleEnable() {
    const coords = await requestLocation();
    if (coords) {
      const county = nearestCounty(coords.lat, coords.lng, Object.keys(IRISH_COUNTY_COORDS));
      if (county) {
        setHomeLocation({ county, lat: coords.lat, lng: coords.lng });
        setUseGpsLocation(true);
      }
      router.push('/onboarding/location-success');
      return;
    }
    router.push('/onboarding/interests');
  }

  return (
    <ThemedView style={{ flex: 1 }}>
      <SafeAreaView style={{ flex: 1, padding: Spacing.four, justifyContent: 'center', gap: Spacing.four }}>
        <View style={{ alignSelf: 'center', width: 96, height: 96, borderRadius: Radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.backgroundSelected }}>
          <Ionicons name="navigate" size={36} color={theme.primary} />
        </View>

        <View style={{ gap: 4, alignItems: 'center' }}>
          <ThemedText type="pageHeading" style={{ textAlign: 'center' }}>
            Enable location?
          </ThemedText>
          <ThemedText themeColor="textSecondary" style={{ textAlign: 'center' }}>
            See what&apos;s happening near you and get better recommendations.
          </ThemedText>
        </View>

        <View style={{ gap: Spacing.two }}>
          {REASONS.map((reason) => (
            <View key={reason.label} style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.three }}>
              <Ionicons name={reason.icon} size={20} color={theme.primary} />
              <ThemedText>{reason.label}</ThemedText>
            </View>
          ))}
        </View>

        <View style={{ gap: Spacing.two }}>
          <Button label="Enable Location" onPress={handleEnable} />
          <Button label="Maybe later" variant="secondary" onPress={() => router.push('/onboarding/interests')} />
        </View>
      </SafeAreaView>
    </ThemedView>
  );
}
