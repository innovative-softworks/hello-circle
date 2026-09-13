import { StyleSheet } from 'react-native';
import MapView, { Marker } from 'react-native-maps';

import { Radius } from '@/constants/theme';

// Single-pin equivalent of client/src/components/SinglePinMap.tsx.
export function DetailMap({ lat, lng, title }: { lat: number; lng: number; title: string }) {
  return (
    <MapView
      style={styles.map}
      initialRegion={{ latitude: lat, longitude: lng, latitudeDelta: 0.02, longitudeDelta: 0.02 }}
      scrollEnabled={false}
      zoomEnabled={false}>
      <Marker coordinate={{ latitude: lat, longitude: lng }} title={title} />
    </MapView>
  );
}

const styles = StyleSheet.create({
  map: {
    width: '100%',
    height: 160,
    borderRadius: Radius.card,
  },
});
