import type { ResidentSearchResult } from '@hello-circle/types';

import { request } from './client';

export interface ResidentProfile {
  id: string;
  email: string;
  name: string;
  homeCounty: string;
  createdAt: string;
}

export function fetchMyResidentProfile(): Promise<{ resident: ResidentProfile | null }> {
  return request('/residents/me');
}

// Only finds residents who opted into "findable by name".
export function searchResidents(q: string): Promise<ResidentSearchResult[]> {
  return request(`/residents/search?q=${encodeURIComponent(q)}`);
}
