import type { Centre } from '@hello-circle/types';

import { request } from './client';

export function fetchCentres(county?: string, radiusKm?: number): Promise<Centre[]> {
  const params = new URLSearchParams();
  if (county && county !== 'All') params.set('county', county);
  if (radiusKm) params.set('radiusKm', String(radiusKm));
  const qs = params.toString();
  return request(`/centres${qs ? `?${qs}` : ''}`);
}

export function fetchCentre(id: string): Promise<Centre> {
  return request(`/centres/${id}`);
}
