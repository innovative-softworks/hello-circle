import type { Game } from '@hello-circle/types';

import { request } from './client';

export function fetchGames(county?: string): Promise<Game[]> {
  return request(`/games${county ? `?county=${encodeURIComponent(county)}` : ''}`);
}

export function fetchGame(id: string): Promise<Game> {
  return request(`/games/${id}`);
}

export function joinGame(id: string): Promise<{ ok?: boolean; ref?: string; url?: string; totalEuro?: number }> {
  return request(`/games/${id}/join`, { method: 'POST' });
}

export function leaveGame(id: string): Promise<{ ok: boolean }> {
  return request(`/games/${id}/join`, { method: 'DELETE' });
}

export function fetchGameJoinStatus(ref: string): Promise<{ ref: string; paymentStatus: string; totalCents: number }> {
  return request(`/games/status/${encodeURIComponent(ref)}`);
}

export function joinGameWaitlist(id: string): Promise<{ ok: boolean }> {
  return request(`/games/${id}/waitlist`, { method: 'POST' });
}

export function leaveGameWaitlist(id: string): Promise<{ ok: boolean }> {
  return request(`/games/${id}/waitlist`, { method: 'DELETE' });
}
