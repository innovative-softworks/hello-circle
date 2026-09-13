import type { Program } from '@hello-circle/types';

import { request } from './client';

export function fetchPrograms(listingType: 'centre' | 'club', listingId: string): Promise<Program[]> {
  return request(`/programs?listingType=${listingType}&listingId=${encodeURIComponent(listingId)}`);
}

export function fetchProgram(id: string): Promise<Program> {
  return request(`/programs/${encodeURIComponent(id)}`);
}

export interface EnrollProgramInput {
  participantName: string;
  participantDob?: string;
  email: string;
  phone?: string;
  couponCode?: string;
}

export function enrollProgram(id: string, input: EnrollProgramInput): Promise<{ ref: string; url?: string; totalEuro: number }> {
  return request(`/programs/${encodeURIComponent(id)}/enroll`, { method: 'POST', body: JSON.stringify(input) });
}

export function fetchProgramEnrollmentStatus(ref: string): Promise<{ ref: string; paymentStatus: string; totalCents: number }> {
  return request(`/programs/enrollments/status/${encodeURIComponent(ref)}`);
}
