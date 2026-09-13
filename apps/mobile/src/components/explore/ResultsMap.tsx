import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import MapView, { Marker } from 'react-native-maps';

import { fetchCentres } from '@/api/centres';
import { fetchClubs } from '@/api/clubs';
import type { Category } from '@/components/explore/CategoryTabs';
import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatPrice } from '@/lib/format';

type MapPin =
  | { kind: 'centre'; id: string; lat: number; lng: number; name: string; area: string; county: string; image: string | null; price: string }
  | { kind: 'club'; id: string; lat: number; lng: number; name: string; area: string; county: string; image: string | null; price: string };

// Ported from client/src/components/DiscoveryMap.tsx's data shape/filtering
// (non-null lat/lng only) — react-native-maps Marker in place of react-
// leaflet's Marker. Only centres/clubs have coordinates (confirmed: Circles
// have none); other categories fall back to an empty map. Marker tap opens
// a floating bottom preview card (spec §12) rather than a native Callout
// bubble — tap it again to open the full detail screen.
export function ResultsMap({ category, county }: { category: Category; county: string | null }) {
  const theme = useTheme();
  const [selected, setSelected] = useState<MapPin | null>(null);
  const [query, setQuery] = useState('');
  const centresQuery = useQuery({ queryKey: ['centres', county], queryFn: () => fetchCentres(county ?? undefined), enabled: category === 'centres' });
  const clubsQuery = useQuery({ queryKey: ['clubs', county], queryFn: () => fetchClubs(county ?? undefined), enabled: category === 'clubs' });

  const centres = (category === 'centres' ? centresQuery.data : undefined)?.filter((c) => c.lat !== null && c.lng !== null) ?? [];
  const clubs = (category === 'clubs' ? clubsQuery.data : undefined)?.filter((c) => c.lat !== null && c.lng !== null) ?? [];

  const allPins: MapPin[] = [
    ...centres.map((c) => ({ kind: 'centre' as const, id: c.id, lat: c.lat!, lng: c.lng!, name: c.name, area: c.area, county: c.county, image: c.image, price: `From ${formatPrice(c.from)}/hr` })),
    ...clubs.map((c) => ({ kind: 'club' as const, id: c.id, lat: c.lat!, lng: c.lng!, name: c.name, area: c.area, county: c.county, image: c.image, price: `${formatPrice(c.price)}/${c.unit}` })),
  ];
  // Real, honest "search this area" — filters the already-fetched pins by
  // name match rather than a fabricated geo-bounded re-query (no such API
  // exists server-side for centres/clubs).
  const trimmedQuery = query.trim().toLowerCase();
  const pins = trimmedQuery ? allPins.filter((p) => p.name.toLowerCase().includes(trimmedQuery)) : allPins;

  const first = pins[0] ?? allPins[0];
  const initialRegion = first
    ? { latitude: first.lat, longitude: first.lng, latitudeDelta: 0.5, longitudeDelta: 0.5 }
    : { latitude: 53.3498, longitude: -6.2603, latitudeDelta: 4, longitudeDelta: 4 }; // Dublin fallback

  return (
    <View style={{ flex: 1 }}>
      <View style={[styles.searchBar, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
        <Ionicons name="search-outline" size={18} color={theme.textSecondary} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search this area"
          placeholderTextColor={theme.textSecondary}
          style={{ flex: 1, marginLeft: Spacing.two, color: theme.text }}
        />
      </View>
      <MapView style={styles.map} initialRegion={initialRegion} onPress={() => setSelected(null)}>
        {pins.map((pin) => (
          <Marker
            key={`${pin.kind}:${pin.id}`}
            coordinate={{ latitude: pin.lat, longitude: pin.lng }}
            onPress={() => setSelected(pin)}
            pinColor={selected?.id === pin.id ? theme.primary : undefined}
          />
        ))}
      </MapView>

      {selected && (
        <Pressable
          onPress={() => router.push(selected.kind === 'centre' ? `/(details)/centre/${selected.id}` : `/(details)/club/${selected.id}`)}
          style={[styles.preview, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
          {selected.image ? (
            <Image source={{ uri: selected.image }} style={styles.previewImage} contentFit="cover" />
          ) : (
            <View style={[styles.previewImage, styles.placeholder, { backgroundColor: theme.backgroundSelected }]}>
              <Ionicons name={selected.kind === 'centre' ? 'business-outline' : 'people-outline'} size={22} color={theme.textSecondary} />
            </View>
          )}
          <View style={{ flex: 1, gap: 2 }}>
            <ThemedText type="eyebrow">{selected.kind === 'centre' ? 'Place' : 'Club'}</ThemedText>
            <ThemedText type="cardHeading" numberOfLines={1}>
              {selected.name}
            </ThemedText>
            <ThemedText type="metadata">
              {selected.area}, {selected.county}
            </ThemedText>
            <ThemedText type="metadata" themeColor="primary">
              {selected.price}
            </ThemedText>
          </View>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  map: {
    flex: 1,
  },
  searchBar: {
    position: 'absolute',
    left: Spacing.four,
    right: Spacing.four,
    top: Spacing.three,
    zIndex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: Radius.control,
    paddingHorizontal: Spacing.three,
    height: 44,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 3,
  },
  preview: {
    position: 'absolute',
    left: Spacing.four,
    right: Spacing.four,
    bottom: Spacing.four,
    borderRadius: Radius.sheet,
    borderWidth: 1,
    padding: Spacing.three,
    flexDirection: 'row',
    gap: Spacing.three,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 4,
  },
  previewImage: {
    width: 72,
    height: 72,
    borderRadius: Radius.card,
  },
  placeholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
