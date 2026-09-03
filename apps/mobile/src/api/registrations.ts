import type { WaitlistPosition } from '@hello-circle/types';

import { request } from './client';

export interface CreateRegistrationInput {
  clubId: string;
  registrantType?: 'child' | 'adult';
  team?: string;
  childFirst: string;
  childLast: string;
  dob?: string;
  gFirst: string;
  gLast: string;
  email: string;
  phone: string;
  address: string;
  ecName?: string;
  ecPhone?: string;
  ecRel?: string;
  consent: boolean;
  trial?: boolean;
}

export function createRegistrationCheckout(
  input: CreateRegistrationInput
): Promise<{ ref: string; url?: string; totalEuro: number; trial: boolean }> {
  return request('/registrations/checkout', { method: 'POST', body: JSON.stringify(input) });
}

export function fetchRegistrationStatus(ref: string): Promise<{ ref: string; paymentStatus: string; totalCents: number }> {
  return request(`/registrations/status/${encodeURIComponent(ref)}`);
}

export function fetchWaitlistPosition(clubId: string): Promise<WaitlistPosition> {
  return request(`/clubs/${clubId}/waitlist/position`);
}

export function joinClubWaitlist(clubId: string, input: { name?: string; email?: string }): Promise<{ ok: boolean }> {
  return request(`/clubs/${clubId}/waitlist`, { method: 'POST', body: JSON.stringify(input) });
}

export function leaveClubWaitlist(clubId: string): Promise<{ ok: boolean }> {
  return request(`/clubs/${clubId}/waitlist`, { method: 'DELETE' });
}
