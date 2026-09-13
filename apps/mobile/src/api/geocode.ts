import { request } from './client';

// Mirrors client/src/api/public.ts's searchAddress() exactly — same
// server-side Nominatim proxy (server/src/routes/geocode.ts), no auth
// required, rate-limited server-side. Onboarding's location search uses
// this for real free-text address lookup rather than only the fixed
// county-chip list.
export interface AddressSuggestion {
  label: string;
  lat: number;
  lng: number;
  area: string;
  county: string;
}

export function searchAddress(query: string): Promise<AddressSuggestion[]> {
  return request(`/geocode/search?q=${encodeURIComponent(query)}`);
}
