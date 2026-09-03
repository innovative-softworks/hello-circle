import { request } from './client';

export function saveOnboarding(input: {
  homeCounty?: string;
  searchRadiusKm?: number;
  interests?: string[];
  availability?: string[];
}): Promise<{ ok: boolean }> {
  return request('/residents/me/onboarding', { method: 'PUT', body: JSON.stringify(input) });
}

export function skipOnboarding(): Promise<{ ok: boolean }> {
  return request('/residents/me/onboarding/skip', { method: 'POST' });
}
