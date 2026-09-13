import type { ResidentNotification } from '@hello-circle/types';

import { request } from './client';

export type { ResidentNotification };

// server/src/routes/residents.ts's "/me/notifications" pair — same table as
// the vendor/admin notifications, scoped by resident_id instead.
export function fetchMyNotifications(): Promise<ResidentNotification[]> {
  return request('/residents/me/notifications');
}

export function markNotificationRead(id: number): Promise<{ ok: boolean }> {
  return request(`/residents/me/notifications/${id}/read`, { method: 'POST' });
}
