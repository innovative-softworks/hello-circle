import type { Club } from '@hello-circle/types';

import { request } from './client';

export function fetchClubs(county?: string, sport?: string, radiusKm?: number): Promise<Club[]> {
  const params = new URLSearchParams();
  if (county && county !== 'All') params.set('county', county);
  if (sport && sport !== 'All') params.set('sport', sport);
  if (radiusKm) params.set('radiusKm', String(radiusKm));
  const qs = params.toString();
  return request(`/clubs${qs ? `?${qs}` : ''}`);
}

export function fetchClub(id: string): Promise<Club> {
  return request(`/clubs/${id}`);
}
