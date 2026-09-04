import type { Circle, CircleInvitation, CircleMemberSummary, CirclePlanPreview } from '@hello-circle/types';

import { request } from './client';

export function fetchCircles(county?: string): Promise<Circle[]> {
  return request(`/circles${county ? `?county=${encodeURIComponent(county)}` : ''}`);
}

export function fetchCircle(id: string): Promise<Circle> {
  return request(`/circles/${id}`);
}

// Every circle this resident belongs to — distinct from fetchCircles(), the
// public browse list. Signed-in only.
export function fetchMyCircles(): Promise<Circle[]> {
  return request('/circles/mine');
}

export function fetchCircleUpcoming(id: string): Promise<CirclePlanPreview[]> {
  return request(`/circles/${id}/upcoming`);
}

export function fetchCircleMembership(id: string): Promise<{ member: boolean; role: string | null; requested: boolean }> {
  return request(`/circles/${id}/membership`);
}

// requested: true means an 'approval' Circle filed a pending join request
// instead of joining outright.
export function joinCircle(id: string): Promise<{ ok: boolean; requested?: boolean }> {
  return request(`/circles/${id}/join`, { method: 'POST' });
}

export function leaveCircle(id: string): Promise<{ ok: boolean }> {
  return request(`/circles/${id}/join`, { method: 'DELETE' });
}

export function inviteToCircle(circleId: string, residentId: string): Promise<{ ok: boolean }> {
  return request(`/circles/${circleId}/invite`, { method: 'POST', body: JSON.stringify({ residentId }) });
}

export function fetchMyCircleInvitations(): Promise<CircleInvitation[]> {
  return request('/circles/invitations/mine');
}

export function respondToCircleInvitation(id: string, accept: boolean): Promise<{ ok: boolean }> {
  return request(`/circles/invitations/${id}/respond`, { method: 'POST', body: JSON.stringify({ accept }) });
}

// HelloCircle Manage (Phase 5, resident-host tools) — organiser-only.
export type CircleJoinMode = 'open' | 'approval' | 'invite';

interface CircleInput {
  name: string;
  activityLabel?: string;
  area?: string;
  county?: string;
  about?: string;
  centreId?: string;
  whatWeDo?: string;
  whoCanJoin?: string;
  values?: string;
  joinMode?: CircleJoinMode;
}

export function updateCircle(id: string, input: CircleInput & { imageUrl?: string }): Promise<Circle> {
  return request(`/circles/${id}`, { method: 'PUT', body: JSON.stringify(input) });
}

export function removeCircleMember(id: string, residentId: string): Promise<{ ok: boolean }> {
  return request(`/circles/${id}/members/${residentId}/remove`, { method: 'POST' });
}

// Not in @hello-circle/types — mirrors web's own convention of keeping this
// shape local rather than shared.
export interface CircleJoinRequest {
  id: string;
  residentId: string;
  name: string;
  createdAt: string;
}

export function fetchCircleJoinRequests(circleId: string): Promise<CircleJoinRequest[]> {
  return request(`/circles/${circleId}/join-requests`);
}

export function respondToCircleJoinRequest(circleId: string, requestId: string, accept: boolean): Promise<{ ok: boolean }> {
  return request(`/circles/${circleId}/join-requests/${requestId}/respond`, { method: 'POST', body: JSON.stringify({ accept }) });
}

export function setCircleStatus(id: string, status: 'active' | 'closed'): Promise<{ ok: boolean }> {
  return request(`/circles/${id}/status`, { method: 'PUT', body: JSON.stringify({ status }) });
}

export function fetchCircleMembers(id: string, full?: boolean): Promise<CircleMemberSummary> {
  return request(`/circles/${id}/members${full ? '?full=1' : ''}`);
}
