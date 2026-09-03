import type { Program } from '@hello-circle/types';

import { request } from './client';

export function fetchPrograms(listingType: 'centre' | 'club', listingId: string): Promise<Program[]> {
  return request(`/programs?listingType=${listingType}&listingId=${encodeURIComponent(listingId)}`);
}
