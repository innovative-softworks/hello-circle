// Mirrors client/src/api/core.ts's request()/ApiError shape, adapted for a
// native client with no cookie jar: sends the resident bearer token (when
// signed in) via Authorization instead of relying on Set-Cookie, and tells
// the server it's a mobile caller via X-Client-Platform (see
// server/src/routes/guestAuth.ts's additive isNative branches).
import { getClientId } from '@/auth/clientId';
import { getToken } from '@/auth/secureStore';

const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL ?? 'http://localhost:3001';

export class ApiError extends Error {
  body: Record<string, unknown>;
  constructor(message: string, body: Record<string, unknown>) {
    super(message);
    this.body = body;
  }
}

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const [clientId, token] = await Promise.all([getClientId(), getToken()]);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Client-Id': clientId,
    'X-Client-Platform': 'mobile',
    ...(init?.headers as Record<string, string> | undefined),
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${API_BASE_URL}/api${path}`, { ...init, headers });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new ApiError(body.error || `Request failed: ${res.status}`, body);
  }
  return res.json() as Promise<T>;
}
