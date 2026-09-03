// Mirrors client/src/api/public.ts's discovery-feed functions exactly
// (same endpoints, same param names).
import type { DiscoverFeed, DiscoverItem } from '@hello-circle/types';

import { request } from './client';

export function fetchDiscover(county?: string, radiusKm?: number): Promise<DiscoverFeed> {
  const params = new URLSearchParams();
  if (county) params.set('county', county);
  if (radiusKm) params.set('radiusKm', String(radiusKm));
  const qs = params.toString();
  return request(`/discover${qs ? `?${qs}` : ''}`);
}

export function fetchFreeTimeOptions(opts: {
  county?: string;
  maxMinutes?: number;
  mood?: string;
  lat?: number;
  lng?: number;
  radiusKm?: number;
}): Promise<DiscoverItem[]> {
  const params = new URLSearchParams();
  if (opts.county) params.set('county', opts.county);
  if (opts.maxMinutes !== undefined) params.set('maxMinutes', String(opts.maxMinutes));
  if (opts.mood) params.set('mood', opts.mood);
  if (opts.lat !== undefined) params.set('lat', String(opts.lat));
  if (opts.lng !== undefined) params.set('lng', String(opts.lng));
  if (opts.radiusKm !== undefined) params.set('radiusKm', String(opts.radiusKm));
  return request(`/discover/free-time?${params.toString()}`);
}

// Signed-in only — server derives the resident from the bearer token.
export function fetchNextBestParticipation(): Promise<DiscoverItem[]> {
  return request('/discover/next-best');
}
