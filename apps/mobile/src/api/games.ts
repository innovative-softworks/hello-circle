import type { Game, GameParticipantSummary, GameUpdate, ManageParticipant } from '@hello-circle/types';

import { request } from './client';

export function fetchGames(county?: string): Promise<Game[]> {
  return request(`/games${county ? `?county=${encodeURIComponent(county)}` : ''}`);
}

export function fetchGame(id: string): Promise<Game> {
  return request(`/games/${id}`);
}

// "Who's going" preview (Experience Detail redesign) — name-only, capped
// preview + a real total for AvatarGroup's "+N" overflow. Public, no auth
// required (mirrors the mutual-block filtering server/src/routes/games.ts's
// GET /:id/participants already does).
export function fetchGameParticipants(id: string): Promise<GameParticipantSummary> {
  return request(`/games/${id}/participants`);
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

// HelloCircle Manage (Phase 5, resident-host tools) — every field here
// matches server/src/routes/games.ts's own CreateGameInput exactly, since
// PUT /:id accepts the identical shape as POST /.
export interface CreateGameInput {
  activityLabel: string;
  centreId?: string;
  locationText?: string;
  date: string;
  time: string;
  skillLevel?: string;
  capacity: number;
  priceCents?: number;
  visibility?: 'public' | 'circle' | 'invite';
  soloFriendly?: boolean;
  minParticipants?: number;
  confirmationDeadline?: string;
  description?: string;
  durationMinutes?: number;
  equipmentNeeded?: string;
  minAge?: number;
  surfaceType?: string;
  indoorOutdoor?: string;
  meetingInstructions?: string;
  cancellationPolicy?: string;
  circleId?: string;
}

export function createGame(input: CreateGameInput): Promise<Game> {
  return request('/games', { method: 'POST', body: JSON.stringify(input) });
}

export function updateGame(id: string, input: CreateGameInput): Promise<Game> {
  return request(`/games/${id}`, { method: 'PUT', body: JSON.stringify(input) });
}

export function cancelGame(id: string, reason?: string): Promise<{ ok: boolean }> {
  return request(`/games/${id}/cancel`, { method: 'POST', body: JSON.stringify({ reason }) });
}

export function fetchGameParticipantsForManage(id: string): Promise<ManageParticipant[]> {
  return request(`/games/${id}/participants/manage`);
}

export function removeGameParticipant(id: string, residentId: string): Promise<{ ok: boolean }> {
  return request(`/games/${id}/participants/${residentId}/remove`, { method: 'POST' });
}

export function fetchGameUpdates(id: string): Promise<GameUpdate[]> {
  return request(`/games/${id}/updates`);
}

export function postGameUpdate(id: string, message: string): Promise<GameUpdate> {
  return request(`/games/${id}/updates`, { method: 'POST', body: JSON.stringify({ message }) });
}

// `hostedOnly` narrows this to games this resident hosts (HelloCircle
// Manage) — the unparameterized call keeps the existing hosted-or-joined
// behaviour used by messages.tsx/my-life.tsx.
export function fetchMyGames(opts?: { hostedOnly?: boolean }): Promise<Game[]> {
  return request(`/games/mine${opts?.hostedOnly ? '?hostedOnly=1' : ''}`);
}
