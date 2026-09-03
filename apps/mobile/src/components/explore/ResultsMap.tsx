import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { StyleSheet } from 'react-native';
import MapView, { Callout, Marker } from 'react-native-maps';

import { fetchCentres } from '@/api/centres';
import { fetchClubs } from '@/api/clubs';
import type { Category } from '@/components/explore/CategoryTabs';
import { ThemedText } from '@/components/themed-text';
import { formatPrice } from '@/lib/format';

// Ported from client/src/components/DiscoveryMap.tsx's data shape/
// filtering (non-null lat/lng only) — react-native-maps Marker/Callout in
// place of react-leaflet's Marker/Popup. Only centres/clubs have
// coordinates (confirmed: Circles have none); other categories fall back
// to an empty map.
export function ResultsMap({ category, county }: { category: Category; county: string | null }) {
  const centresQuery = useQuery({ queryKey: ['centres', county], queryFn: () => fetchCentres(county ?? undefined), enabled: category === 'centres' });
  const clubsQuery = useQuery({ queryKey: ['clubs', county], queryFn: () => fetchClubs(county ?? undefined), enabled: category === 'clubs' });

  const centres = (category === 'centres' ? centresQuery.data : undefined)?.filter((c) => c.lat !== null && c.lng !== null) ?? [];
  const clubs = (category === 'clubs' ? clubsQuery.data : undefined)?.filter((c) => c.lat !== null && c.lng !== null) ?? [];

  const first = centres[0] ?? clubs[0];
  const initialRegion = first
    ? { latitude: first.lat!, longitude: first.lng!, latitudeDelta: 0.5, longitudeDelta: 0.5 }
    : { latitude: 53.3498, longitude: -6.2603, latitudeDelta: 4, longitudeDelta: 4 }; // Dublin fallback

  return (
    <MapView style={styles.map} initialRegion={initialRegion}>
      {centres.map((centre) => (
        <Marker key={centre.id} coordinate={{ latitude: centre.lat!, longitude: centre.lng! }}>
          <Callout onPress={() => router.push(`/(details)/centre/${centre.id}`)}>
            <ThemedText style={styles.calloutTitle}>{centre.name}</ThemedText>
            <ThemedText>
              {centre.area}, {centre.county} · From {formatPrice(centre.from)}/hr
            </ThemedText>
          </Callout>
        </Marker>
      ))}
      {clubs.map((club) => (
        <Marker key={club.id} coordinate={{ latitude: club.lat!, longitude: club.lng! }}>
          <Callout onPress={() => router.push(`/(details)/club/${club.id}`)}>
            <ThemedText style={styles.calloutTitle}>{club.name}</ThemedText>
            <ThemedText>
              {club.area}, {club.county} · {formatPrice(club.price)}/{club.unit}
            </ThemedText>
          </Callout>
        </Marker>
      ))}
    </MapView>
  );
}

const styles = StyleSheet.create({
  map: {
    flex: 1,
  },
  calloutTitle: {
    fontWeight: '700',
  },
});
