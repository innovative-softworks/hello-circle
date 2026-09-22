import { request } from "./core";
import type { ShareData, ShareEntityType } from "./sharing";

// Universal Sharing & Invitation system, Phase 2 — generalized
// person-to-person invitations (games/experiences/adventures/programs).
// Circle *membership* invites keep their own dedicated endpoints
// (fetchMyCircleInvitations/respondToCircleInvitation in resident.ts) —
// this is deliberately a separate, parallel surface, not a replacement.

export type InvitableEntityType = "game" | "experience" | "adventure" | "program";

export interface MyInvitation {
  id: string;
  entityType: ShareEntityType;
  entityId: string;
  status: string;
  createdAt: string;
  inviterName: string;
  entity: ShareData | null;
}

export function createInvitation(input: { entityType: InvitableEntityType; entityId: string; inviteeResidentIds?: string[]; inviteeEmails?: string[]; message?: string }): Promise<{ ok: boolean; count: number }> {
  return request(`/invitations`, { method: "POST", body: JSON.stringify(input) });
}

export function fetchMyInvitations(): Promise<MyInvitation[]> {
  return request(`/invitations/mine`);
}

export function respondToInvitation(id: string, response: "accepted" | "maybe" | "declined"): Promise<{ ok: boolean }> {
  return request(`/invitations/${encodeURIComponent(id)}/respond`, { method: "POST", body: JSON.stringify({ response }) });
}

export interface InviteTokenLookup {
  status: string;
  inviterName: string;
  entity: ShareData;
  respondable: boolean;
}

export function fetchInviteByToken(token: string): Promise<InviteTokenLookup> {
  return request(`/invitations/token/${encodeURIComponent(token)}`);
}

export function respondToInviteToken(token: string, response: "accepted" | "maybe" | "declined"): Promise<{ ok: boolean }> {
  return request(`/invitations/token/${encodeURIComponent(token)}/respond`, { method: "POST", body: JSON.stringify({ response }) });
}
