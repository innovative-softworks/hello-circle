// Resident magic-link auth — mirrors client/src/api/resident.ts's guest
// session functions. `verifyMagicLink` gets back a bearer `token` here
// (mobile-only response field, see server/src/routes/guestAuth.ts's
// isNative branch) instead of a cookie.
import { request } from './client';

export function requestMagicLink(email: string): Promise<{ ok: boolean }> {
  return request('/guest/request-link', { method: 'POST', body: JSON.stringify({ email }) });
}

export function verifyMagicLink(token: string): Promise<{ email: string; token: string }> {
  return request('/guest/verify', { method: 'POST', body: JSON.stringify({ token }) });
}

export function logout(): Promise<{ ok: boolean }> {
  return request('/guest/logout', { method: 'POST' });
}

export function fetchGuestSession(): Promise<{ email: string | null }> {
  return request('/guest/me');
}
