// Opt-in only, mirrors the web app's navigator.geolocation pattern
// (client-only capture, only requested when the user explicitly taps "use
// my location" — never on app boot). Coordinates are only sent server-side
// via the specific endpoints that accept lat/lng (fetchFreeTimeOptions);
// everything else uses county-based filtering.
import * as Location from 'expo-location';
import { useState } from 'react';

export function useLocation() {
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function requestLocation(): Promise<{ lat: number; lng: number } | null> {
    setLoading(true);
    setError(null);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setError('Location permission denied');
        return null;
      }
      const position = await Location.getCurrentPositionAsync({});
      const next = { lat: position.coords.latitude, lng: position.coords.longitude };
      setCoords(next);
      return next;
    } catch {
      setError('Could not get your location');
      return null;
    } finally {
      setLoading(false);
    }
  }

  return { coords, error, loading, requestLocation };
}
