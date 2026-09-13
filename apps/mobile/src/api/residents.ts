import type { HostProfile, NotificationPrefs, ResidentSearchResult } from '@hello-circle/types';

import { request } from './client';

export interface ResidentProfile {
  id: string;
  email: string;
  name: string;
  homeCounty: string;
  homeLat: number | null;
  homeLng: number | null;
  notificationPrefs: NotificationPrefs | null;
  createdAt: string;
}

export function fetchMyResidentProfile(): Promise<{ resident: ResidentProfile | null }> {
  return request('/residents/me');
}

// Only finds residents who opted into "findable by name".
export function searchResidents(q: string): Promise<ResidentSearchResult[]> {
  return request(`/residents/search?q=${encodeURIComponent(q)}`);
}

// Mirrors client/src/api/resident.ts's updateResidentMe() — name, homeCounty,
// and (mobile onboarding redesign) an optional homeLat/homeLng point are
// editable server-side (PUT /residents/me); there's no bio/photo field on
// the resident record itself (bio only exists on the separate
// host-application flow).
export function updateResidentMe(input: { name?: string; homeCounty?: string; homeLat?: number; homeLng?: number }): Promise<{ ok: boolean }> {
  return request('/residents/me', { method: 'PUT', body: JSON.stringify(input) });
}

// Mirrors client/src/api/resident.ts's saveNotificationPrefs() — same
// endpoint, same shape. Note (per server/src/notifications.ts's own
// comment): only `waitlistOffers`/`intentMatches` currently gate a real
// send; the rest are stored signal, same as on web — not a mobile-only
// limitation.
export function saveNotificationPrefs(prefs: Partial<NotificationPrefs>): Promise<{ ok: boolean }> {
  return request('/residents/me/notification-prefs', { method: 'PUT', body: JSON.stringify(prefs) });
}

// Public host-profile page for a resident who has been admin-approved as a
// host (host_status = 'verified') — 404s otherwise. Mirrors web's
// HostProfile.tsx / fetchHostProfile(). Distinct from a vendor's
// ProviderProfile (centre/club), which mobile doesn't have yet.
export function fetchHostProfile(residentId: string): Promise<HostProfile> {
  return request(`/residents/${residentId}/host-profile`);
}
