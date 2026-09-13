import type { Experience, MyExperienceBooking } from '@hello-circle/types';

import { request } from './client';

export function fetchExperiences(kind?: 'adventure' | 'experience', county?: string): Promise<Experience[]> {
  const params = new URLSearchParams();
  if (kind) params.set('kind', kind);
  if (county) params.set('county', county);
  const qs = params.toString();
  return request(`/experiences${qs ? `?${qs}` : ''}`);
}

export function fetchExperience(id: string): Promise<Experience> {
  return request(`/experiences/${encodeURIComponent(id)}`);
}

export interface BookExperienceInput {
  participantName: string;
  email: string;
  phone?: string;
  partySize?: number;
  couponCode?: string;
}

export function bookExperienceSession(
  experienceId: string,
  sessionId: string,
  input: BookExperienceInput
): Promise<{ ref: string; url?: string; totalEuro: number }> {
  return request(`/experiences/${encodeURIComponent(experienceId)}/sessions/${encodeURIComponent(sessionId)}/checkout`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function fetchExperienceBookingStatus(ref: string): Promise<{ ref: string; paymentStatus: string; totalCents: number }> {
  return request(`/experiences/bookings/status/${encodeURIComponent(ref)}`);
}

// Kept as its own fetch rather than folded into fetchMyParticipation() —
// web's own MyBookings.tsx does the exact same thing (a separate
// fetchMyExperienceBookings() merged client-side), since
// listResidentParticipation() on the server never picked up
// experience_bookings in the first place. Matching that existing pattern
// instead of changing shared server behavior both clients rely on.
export function fetchMyExperienceBookings(): Promise<MyExperienceBooking[]> {
  return request('/experiences/bookings/mine');
}
