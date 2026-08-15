/** Approximate coordinates for each Irish county — using the county town/city as a
 * practical stand-in for a precise polygon centroid, which is fine for coarse
 * nearest-county matching (see nearestCounty below), not for precise routing.
 * Same 32-county list as VendorSignup.tsx's IRISH_COUNTIES, kept in sync by hand. */
export const IRISH_COUNTY_COORDS: Record<string, { lat: number; lng: number }> = {
  Antrim: { lat: 54.718, lng: -6.2107 },
  Armagh: { lat: 54.3503, lng: -6.6528 },
  Carlow: { lat: 52.8365, lng: -6.9341 },
  Cavan: { lat: 53.9908, lng: -7.3606 },
  Clare: { lat: 52.8438, lng: -8.9864 },
  Cork: { lat: 51.8985, lng: -8.4756 },
  Derry: { lat: 54.9966, lng: -7.3086 },
  Donegal: { lat: 54.6538, lng: -8.1099 },
  Down: { lat: 54.3306, lng: -5.715 },
  Dublin: { lat: 53.3498, lng: -6.2603 },
  Fermanagh: { lat: 54.3439, lng: -7.6355 },
  Galway: { lat: 53.2707, lng: -9.0568 },
  Kerry: { lat: 52.2713, lng: -9.7016 },
  Kildare: { lat: 53.1589, lng: -6.9109 },
  Kilkenny: { lat: 52.6541, lng: -7.2448 },
  Laois: { lat: 53.0344, lng: -7.2994 },
  Leitrim: { lat: 53.9464, lng: -8.0894 },
  Limerick: { lat: 52.6638, lng: -8.6267 },
  Longford: { lat: 53.7276, lng: -7.7933 },
  Louth: { lat: 53.9982, lng: -6.4053 },
  Mayo: { lat: 53.8547, lng: -9.2988 },
  Meath: { lat: 53.6528, lng: -6.682 },
  Monaghan: { lat: 54.2492, lng: -6.9683 },
  Offaly: { lat: 53.2739, lng: -7.493 },
  Roscommon: { lat: 53.628, lng: -8.1874 },
  Sligo: { lat: 54.2766, lng: -8.4761 },
  Tipperary: { lat: 52.3557, lng: -7.7009 },
  Tyrone: { lat: 54.5973, lng: -7.3055 },
  Waterford: { lat: 52.2593, lng: -7.1101 },
  Westmeath: { lat: 53.5241, lng: -7.3382 },
  Wexford: { lat: 52.3369, lng: -6.4633 },
  Wicklow: { lat: 52.9808, lng: -6.0446 },
};

/** Great-circle distance in km between two lat/lng points. */
export function haversineDistanceKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Nearest county to (lat, lng) among `candidates` (should be the app's actual
 * fetched county list, not the full 32) — never suggests a county with no real
 * listings today. Returns null if none of the candidates have known coordinates. */
export function nearestCounty(lat: number, lng: number, candidates: string[]): string | null {
  let best: string | null = null;
  let bestDist = Infinity;
  for (const county of candidates) {
    const coords = IRISH_COUNTY_COORDS[county];
    if (!coords) continue;
    const dist = haversineDistanceKm(lat, lng, coords.lat, coords.lng);
    if (dist < bestDist) {
      bestDist = dist;
      best = county;
    }
  }
  return best;
}
