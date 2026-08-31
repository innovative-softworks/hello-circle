import { request } from "./core";

// HelloCircle Manage (Phase 1) — account linking + workspace switching.
// See server/src/routes/manage.ts for the full rationale.

export interface ManageWorkspaces {
  personal: boolean;
  vendor: { businessName: string; orgId: string | null } | null;
  circlesOrganising: { id: string; slug: string | null; name: string }[];
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
