import type { AuthUser } from "../types";
import { request } from "./core";

// Vendor/admin signup, login, password reset, invite acceptance — used by
// both Login.tsx/VendorSignup.tsx and the vendor dashboard. Split out of
// the original single api.ts (see CLAUDE.md).

interface VendorSignupIntake {
  name: string;
  vendorType: "community" | "sports";
  businessName: string;
  address: string;
  county: string;
  mobile: string;
  landline?: string;
  description: string;
  termsAccepted: boolean;
  marketingConsent: boolean;
}

export function signup(input: VendorSignupIntake & { email: string; password: string }): Promise<{ user: AuthUser }> {
  return request(`/auth/signup`, { method: "POST", body: JSON.stringify(input) });
}

/** Google-authenticated vendor signup — same full listing intake as signup()
 * above (still 'pending' until admin approval, still no auto-login), just
 * backed by a verified Google identity instead of a chosen password. The
 * email itself comes from the server's own verification of `idToken`, not
 * from this input, so there's no separate email field here. */
export function signupWithGoogle(idToken: string, input: VendorSignupIntake): Promise<{ user: AuthUser }> {
  return request(`/auth/signup-google`, { method: "POST", body: JSON.stringify({ idToken, ...input }) });
}

export function login(input: { email: string; password: string }): Promise<{ user: AuthUser }> {
  return request(`/auth/login`, { method: "POST", body: JSON.stringify(input) });
}

export function logout(): Promise<{ ok: boolean }> {
  return request(`/auth/logout`, { method: "POST" });
}

/** Google sign-in for an EXISTING, already-linked account — mirrors server/
 * src/routes/auth.ts's POST /google. An unrecognised email is sent back to
 * /vendor/signup (signupWithGoogle() above) instead of creating a bare
 * account; an existing account with a matching but unlinked email throws
 * (ApiError, `accountExists: true` in its body) instead of auto-linking —
 * see linkGoogleAccount() below for the real linking path. */
export function googleLogin(idToken: string): Promise<{ user: AuthUser }> {
  return request(`/auth/google`, { method: "POST", body: JSON.stringify({ idToken }) });
}

/** Explicit "link my Google account" — only callable while already logged
 * in (requireVendorOrAdmin server-side). Being authenticated is itself the
 * proof of control; no separate re-auth step is needed. */
export function linkVendorGoogleAccount(idToken: string): Promise<{ ok: boolean; googleEmail: string }> {
  return request(`/auth/link-google`, { method: "PUT", body: JSON.stringify({ idToken }) });
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

export function acceptVendorTerms(): Promise<{ ok: boolean }> {
  return request(`/auth/accept-terms`, { method: "POST", body: JSON.stringify({ termsAccepted: true }) });
}

export interface VendorSetupStep {
  key: string;
  label: string;
  done: boolean;
  phase: "submitted" | "review" | "after_approval";
}
export interface VendorSetupStatus {
  accountStatus: "pending" | "approved" | "suspended";
  listing: { type: "centre" | "club"; id: string } | null;
  steps: VendorSetupStep[];
  complete: boolean;
}
/** Works for a pending vendor too — see routes/auth.ts's GET /setup-status. */
export function fetchVendorSetupStatus(): Promise<VendorSetupStatus> {
  return request(`/auth/setup-status`);
}

export function fetchInviteDetails(token: string): Promise<{ email: string; platformRole: string; orgName: string }> {
  return request(`/invites/${token}`);
}

export function acceptInvite(input: { token: string; name: string; password: string; termsAccepted: boolean; marketingConsent: boolean }): Promise<{ user: AuthUser }> {
  return request(`/auth/accept-invite`, { method: "POST", body: JSON.stringify(input) });
}
