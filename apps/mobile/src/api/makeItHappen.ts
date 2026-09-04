import { request } from './client';

export interface MakeItHappenSearchInput {
  activityLabel: string;
  county?: string;
  date: string;
  time: string;
  duration: number;
  partySize: number;
  maxBudgetPerPersonCents?: number;
}

export interface MakeItHappenCandidate {
  centreId: string;
  centreName: string;
  area: string;
  county: string;
  roomId: string;
  roomName: string;
  capacity: number;
  perPersonCents: number;
  totalCents: number;
  paymentMethod: 'online' | 'cash';
}

export interface MakeItHappenConfirmInput extends MakeItHappenSearchInput {
  centreId: string;
  roomId: string;
  name: string;
  email: string;
  phone: string;
  notes?: string;
}

export function searchMakeItHappen(input: MakeItHappenSearchInput): Promise<MakeItHappenCandidate[]> {
  return request('/make-it-happen/search', { method: 'POST', body: JSON.stringify(input) });
}

// Requires a signed-in resident — "the recruiting game needs a host."
export function confirmMakeItHappen(input: MakeItHappenConfirmInput): Promise<{ ref: string; url?: string; totalEuro: number }> {
  return request('/make-it-happen/confirm', { method: 'POST', body: JSON.stringify(input) });
}
