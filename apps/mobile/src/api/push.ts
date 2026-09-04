import { request } from './client';

export function registerPushToken(input: { token: string; platform: string }): Promise<{ ok: boolean }> {
  return request('/residents/me/push-token', { method: 'POST', body: JSON.stringify(input) });
}

export function unregisterPushToken(token: string): Promise<{ ok: boolean }> {
  return request('/residents/me/push-token', { method: 'DELETE', body: JSON.stringify({ token }) });
}
