import { request } from "./core";

// OG-06 / OG-07 — admin invitations and two-step sign-in (TOTP).

export interface AdminMfaStatus {
  required: boolean;
  enrolled: boolean;
  verified: boolean;
  verifiedMinutesAgo: number | null;
  recoveryCodesLeft: number;
}

export function fetchAdminMfaStatus(): Promise<AdminMfaStatus> {
  return request(`/auth/mfa/status`);
}
export function startAdminMfaEnrolment(): Promise<{ otpauthUri: string; secret: string }> {
  return request(`/auth/mfa/enrol/start`, { method: "POST" });
}
export function confirmAdminMfaEnrolment(code: string): Promise<{ recoveryCodes: string[] }> {
  return request(`/auth/mfa/enrol/confirm`, { method: "POST", body: JSON.stringify({ code }) });
}
export function verifyAdminMfa(input: { code?: string; recoveryCode?: string }): Promise<{ usedRecoveryCode: boolean; recoveryCodesLeft: number | null }> {
  return request(`/auth/mfa/verify`, { method: "POST", body: JSON.stringify(input) });
}
export function regenerateAdminRecoveryCodes(): Promise<{ recoveryCodes: string[] }> {
  return request(`/auth/mfa/recovery-codes`, { method: "POST" });
}

export interface AdminInvite {
  id: number;
  email: string;
  adminRole: "super" | "finance" | "support" | "legal";
  status: "pending" | "accepted" | "revoked" | "replaced" | "expired";
  invitedByEmail: string | null;
  createdAt: string;
  expiresAt: string;
  acceptedAt: string | null;
}
export function fetchAdminInvites(): Promise<AdminInvite[]> {
  return request(`/admin/admins/invites`);
}
export function createAdminInvite(email: string, adminRole: string): Promise<{ id: number }> {
  return request(`/admin/admins/invites`, { method: "POST", body: JSON.stringify({ email, adminRole }) });
}
export function revokeAdminInvite(id: number): Promise<{ ok: boolean }> {
  return request(`/admin/admins/invites/${id}`, { method: "DELETE" });
}
export function resetAdminMfa(id: string, reason: string): Promise<{ ok: boolean }> {
  return request(`/admin/admins/${encodeURIComponent(id)}/mfa/reset`, { method: "POST", body: JSON.stringify({ reason }) });
}

export function describeAdminInvite(token: string): Promise<{ email: string; adminRole: string }> {
  return request(`/auth/admin-invite?token=${encodeURIComponent(token)}`);
}
export function acceptAdminInvite(input: { token: string; name: string; password: string }): Promise<{ user: { id: string; email: string; adminRole: string }; next: "mfa_setup" }> {
  return request(`/auth/admin-invite/accept`, { method: "POST", body: JSON.stringify(input) });
}
