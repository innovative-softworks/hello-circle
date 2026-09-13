import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native';
import MapView, { Marker } from 'react-native-maps';
import { SafeAreaView } from 'react-native-safe-area-context';

import { searchAddress, type AddressSuggestion } from '@/api/geocode';
import { Button } from '@/components/Button';
import { Chip } from '@/components/Chip';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Radius, Spacing } from '@/constants/theme';
import { useLocation } from '@/hooks/useLocation';
import { useTheme } from '@/hooks/use-theme';
import { IRISH_COUNTY_COORDS, nearestCounty } from '@/lib/irishCounties';
import { useOnboardingStore } from '@/onboarding/store';

const COUNTIES = Object.keys(IRISH_COUNTY_COORDS).sort((a, b) => a.localeCompare(b));

export default function OnboardingLocationScreen() {
  const theme = useTheme();
  const { homeCounty, homeLat, homeLng, setHomeLocation, setUseGpsLocation } = useOnboardingStore();
  const { loading, error, requestLocation } = useLocation();
  const [showCounties, setShowCounties] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<AddressSuggestion[]>([]);
  const [searching, setSearching] = useState(false);

  const trimmedQuery = query.trim();

  useEffect(() => {
    if (trimmedQuery.length < 3) return;
    const timeout = setTimeout(() => {
      setSearching(true);
      searchAddress(trimmedQuery)
        .then(setResults)
        .catch(() => setResults([]))
        .finally(() => setSearching(false));
    }, 350);
    return () => clearTimeout(timeout);
  }, [trimmedQuery]);

  const visibleResults = trimmedQuery.length < 3 ? [] : results;

  async function handleUseMyLocation() {
    const coords = await requestLocation();
    if (!coords) return;
    const county = nearestCounty(coords.lat, coords.lng, COUNTIES);
    if (county) {
      setHomeLocation({ county, lat: coords.lat, lng: coords.lng });
      setUseGpsLocation(true);
      setQuery('');
      setResults([]);
    }
  }

  function handleSelectSuggestion(suggestion: AddressSuggestion) {
    const county = COUNTIES.find((c) => c.toLowerCase() === suggestion.county.toLowerCase()) ?? suggestion.county;
    setHomeLocation({ county, lat: suggestion.lat, lng: suggestion.lng });
    setUseGpsLocation(false);
    setQuery(suggestion.label);
    setResults([]);
  }

  function handleSelectCounty(county: string) {
    const coords = IRISH_COUNTY_COORDS[county];
    setHomeLocation({ county, lat: coords?.lat, lng: coords?.lng });
    setUseGpsLocation(false);
    setShowCounties(false);
  }

  function handleNext() {
    router.push(homeLat != null ? '/onboarding/location-permission' : '/onboarding/interests');
  }

  const previewCoords = homeLat != null && homeLng != null ? { lat: homeLat, lng: homeLng } : homeCounty ? IRISH_COUNTY_COORDS[homeCounty] : undefined;

  return (
    <ThemedView style={{ flex: 1 }}>
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
        <ScrollView contentContainerStyle={{ padding: Spacing.four, gap: Spacing.three }}>
          <Pressable onPress={() => router.back()} hitSlop={8} style={{ alignSelf: 'flex-start' }}>
            <Ionicons name="arrow-back" size={24} color={theme.text} />
          </Pressable>

          <View style={{ gap: 4 }}>
            <ThemedText type="pageHeading">Where are you?</ThemedText>
            <ThemedText themeColor="textSecondary">Find what&apos;s happening near you.</ThemedText>
          </View>

          <View style={{ position: 'relative' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: theme.border, borderRadius: Radius.control, paddingHorizontal: Spacing.three }}>
              <Ionicons name="search-outline" size={18} color={theme.textSecondary} />
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder="Search your city or area"
                placeholderTextColor={theme.textSecondary}
                style={{ flex: 1, padding: Spacing.two, color: theme.text }}
              />
            </View>
            {(visibleResults.length > 0 || searching) && (
              <View style={{ borderWidth: 1, borderColor: theme.border, borderRadius: Radius.control, marginTop: Spacing.one, backgroundColor: theme.backgroundElement, overflow: 'hidden' }}>
                {searching && (
                  <ThemedText themeColor="textSecondary" style={{ padding: Spacing.three }}>
                    Searching…
                  </ThemedText>
                )}
                {visibleResults.map((r) => (
                  <Pressable key={r.label} onPress={() => handleSelectSuggestion(r)} style={{ padding: Spacing.three, borderTopWidth: 1, borderTopColor: theme.border }}>
                    <ThemedText numberOfLines={1}>{r.label}</ThemedText>
                  </Pressable>
                ))}
              </View>
            )}
          </View>

          <View style={{ height: 180, borderRadius: Radius.card, overflow: 'hidden' }}>
            {previewCoords ? (
              <MapView
                style={{ flex: 1 }}
                pointerEvents="none"
                initialRegion={{ latitude: previewCoords.lat, longitude: previewCoords.lng, latitudeDelta: 0.5, longitudeDelta: 0.5 }}
                region={{ latitude: previewCoords.lat, longitude: previewCoords.lng, latitudeDelta: 0.5, longitudeDelta: 0.5 }}>
                <Marker coordinate={{ latitude: previewCoords.lat, longitude: previewCoords.lng }} />
              </MapView>
            ) : (
              <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.backgroundSelected }}>
                <Ionicons name="map-outline" size={32} color={theme.textSecondary} />
              </View>
            )}
          </View>

          <Pressable
            onPress={() => setShowCounties((v) => !v)}
            style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.two, padding: Spacing.two }}>
            <Ionicons name="location-outline" size={18} color={theme.primary} />
            <ThemedText type="cardHeading" style={{ flex: 1 }}>
              {homeCounty ?? 'Choose your county'}
            </ThemedText>
            <Ionicons name={showCounties ? 'chevron-up' : 'chevron-down'} size={18} color={theme.textSecondary} />
          </Pressable>

          {showCounties && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: Spacing.two }}>
              {COUNTIES.map((county) => (
                <Chip key={county} label={county} selected={homeCounty === county} onPress={() => handleSelectCounty(county)} />
              ))}
            </ScrollView>
          )}

          {error && <ThemedText themeColor="danger">{error}</ThemedText>}

          <Pressable onPress={handleUseMyLocation} style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.two }}>
            <Ionicons name="navigate-outline" size={18} color={theme.primary} />
            <ThemedText themeColor="primary">{loading ? 'Locating…' : 'Use my current location'}</ThemedText>
          </Pressable>

          <Button label="Continue" onPress={handleNext} disabled={!homeCounty} />
          <Pressable onPress={() => router.push('/onboarding/interests')} style={{ alignSelf: 'center' }}>
            <ThemedText themeColor="textSecondary">Skip for now</ThemedText>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}
