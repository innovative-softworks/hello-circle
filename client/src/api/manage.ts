import { request } from "./core";

// HelloCircle Manage (Phase 1) — account linking + workspace switching.
// See server/src/routes/manage.ts for the full rationale.

export interface ManageWorkspaces {
  personal: boolean;
  vendor: { businessName: string; orgId: string | null; status: string } | null;
  circlesOrganising: { id: string; slug: string | null; name: string }[];
}

export interface BecomeProviderInput {
  password: string;
  vendorType: "community" | "sports";
  businessName: string;
  address: string;
  county: string;
  mobile: string;
  landline?: string;
  description: string;
  /** Onboarding audit (consent pass) — required server-side: this creates a
   * brand-new `users` row, a new legal capacity the resident's own prior
   * Terms acceptance doesn't automatically carry over onto. */
  termsAccepted: boolean;
  marketingConsent: boolean;
}

/** Verified Hosts only — opens the provider account this resident doesn't have
 * yet, linked to the resident they already are. Starts pending admin approval,
 * exactly like a /auth/signup vendor. */
export function becomeProvider(input: BecomeProviderInput): Promise<{ user: { id: string; businessName: string } }> {
  return request(`/manage/become-provider`, { method: "POST", body: JSON.stringify(input) });
}

export function fetchManageWorkspaces(): Promise<ManageWorkspaces> {
  return request(`/manage/workspaces`);
}

/** Vendor session only — sends a confirmation link to the resident inbox. */
export function requestManageLink(residentEmail: string): Promise<{ ok: boolean }> {
  return request(`/manage/link/request`, { method: "POST", body: JSON.stringify({ residentEmail }) });
}

export function confirmManageLink(token: string): Promise<{ ok: boolean }> {
  return request(`/manage/link/confirm`, { method: "POST", body: JSON.stringify({ token }) });
}

/** Mints the other side's session cookie for an already-linked account. */
export function switchWorkspace(to: "vendor" | "resident"): Promise<{ ok: boolean }> {
  return request(`/manage/switch`, { method: "POST", body: JSON.stringify({ to }) });
}
