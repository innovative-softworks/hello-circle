import type { ParticipationEntry, Receipt } from '@hello-circle/types';

import { request } from './client';

// One unified list across all 5 participant-tracking tables — used as the
// primary My Life data source instead of stitching together
// fetchMyBookings/fetchMyRegistrations/fetchMyGames separately.
export function fetchMyParticipation(): Promise<ParticipationEntry[]> {
  return request('/residents/me/participation');
}

export function fetchReceipts(): Promise<Receipt[]> {
  return request('/residents/me/receipts');
}
