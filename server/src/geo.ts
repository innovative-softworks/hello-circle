// Shared geo helpers — previously a private function inside routes/
// discover.ts (Free Time Mode's own distance filter); moved here so
// db/queries.ts's listCentres()/listClubs()/listScheduledActivities() can
// share the exact same distance math for discovery-radius filtering
// (master-prompt punch list #2) without a route file importing into the db
// layer (the dependency should only ever run the other way).
import { COUNTY_CENTROIDS } from "./db/index.js";

const EARTH_RADIUS_KM = 6371;

export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export interface RadiusFilter {
  lat: number;
  lng: number;
  km: number;
}

/** Discovery-radius filtering (master-prompt punch list #2) — strictly
 * opt-in: returns undefined (no filtering, exact current behavior) unless
 * the caller explicitly passed a radiusKm query param. Real lat/lng (e.g.
 * from the browser's own geolocation, already used by Free Time Mode's
 * "Near You") wins when present; otherwise falls back to the signed-in
 * resident's home-county centroid — the same COUNTY_CENTROIDS map Local
 * Momentum already uses, not a new geocoding dependency. */
export function resolveRadiusFilter(query: { radiusKm?: unknown; lat?: unknown; lng?: unknown }, residentHomeCounty: string | null): RadiusFilter | undefined {
  const radiusKm = typeof query.radiusKm === "string" ? parseFloat(query.radiusKm) : undefined;
  if (radiusKm === undefined || Number.isNaN(radiusKm) || radiusKm <= 0) return undefined;

  const lat = typeof query.lat === "string" ? parseFloat(query.lat) : undefined;
  const lng = typeof query.lng === "string" ? parseFloat(query.lng) : undefined;
  if (lat !== undefined && lng !== undefined && !Number.isNaN(lat) && !Number.isNaN(lng)) {
    return { lat, lng, km: radiusKm };
  }

  if (residentHomeCounty) {
    const centroid = COUNTY_CENTROIDS[residentHomeCounty.trim().toLowerCase()];
    if (centroid) return { lat: centroid.lat, lng: centroid.lng, km: radiusKm };
  }
  return undefined;
}
