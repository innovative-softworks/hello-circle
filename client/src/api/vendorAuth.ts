import type { AuthUser } from "../types";
import { request } from "./core";

// Vendor/admin signup, login, password reset, invite acceptance — used by
// both Login.tsx/VendorSignup.tsx and the vendor dashboard. Split out of
// the original single api.ts (see CLAUDE.md).

export function signup(input: {
  email: string;
  password: string;
  name: string;
  vendorType: "community" | "sports";
  businessName: string;
  address: string;
  county: string;
  mobile: string;
  landline?: string;
  description: string;
}): Promise<{ user: AuthUser }> {
  return request(`/auth/signup`, { method: "POST", body: JSON.stringify(input) });
}

export function login(input: { email: string; password: string }): Promise<{ user: AuthUser }> {
  return request(`/auth/login`, { method: "POST", body: JSON.stringify(input) });
}

export function logout(): Promise<{ ok: boolean }> {
  return request(`/auth/logout`, { method: "POST" });
}

export function fetchMe(): Promise<{ user: AuthUser | null }> {
  return request(`/auth/me`);
}

export function requestPasswordReset(email: string): Promise<{ ok: boolean }> {
  return request(`/auth/request-reset`, { method: "POST", body: JSON.stringify({ email }) });
}

export function resetPassword(token: string, password: string): Promise<{ ok: boolean }> {
  return request(`/auth/reset-password`, { method: "POST", body: JSON.stringify({ token, password }) });
}

/** Host Manage spec §28 — authenticated change-password, distinct from the
 * unauthenticated forgot-password flow above. */
export function changePassword(currentPassword: string, newPassword: string): Promise<{ ok: boolean }> {
  return request(`/auth/password`, { method: "PUT", body: JSON.stringify({ currentPassword, newPassword }) });
}

export function deactivateVendorAccount(): Promise<{ ok: boolean }> {
  return request(`/auth/deactivate`, { method: "POST" });
}

export function fetchInviteDetails(token: string): Promise<{ email: string; platformRole: string; orgName: string }> {
  return request(`/invites/${token}`);
}

export function acceptInvite(input: { token: string; name: string; password: string }): Promise<{ user: AuthUser }> {
  return request(`/auth/accept-invite`, { method: "POST", body: JSON.stringify(input) });
}
