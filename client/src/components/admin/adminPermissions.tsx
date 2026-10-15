import { createContext, useContext, type ReactNode } from "react";

// D-02 — the signed-in admin's permissions, loaded once from
// GET /api/admin/permissions (the server's own table). Navigation, direct page
// access and buttons ask this context so they match what the server will
// allow. It's a mirror only: the server still decides every request, so a
// missing or stale context can hide a control but never grant one.

export interface AdminPermissionState {
  role: string | null;
  permissions: ReadonlySet<string>;
}

const AdminPermissionContext = createContext<AdminPermissionState>({ role: null, permissions: new Set() });

export function AdminPermissionProvider({ value, children }: { value: AdminPermissionState; children: ReactNode }) {
  return <AdminPermissionContext.Provider value={value}>{children}</AdminPermissionContext.Provider>;
}

/** `can("listings.moderate")` — any of several: `can("a", "b")`. Unknown names are false. */
export function useAdminCan(): (...permissions: string[]) => boolean {
  const { permissions } = useContext(AdminPermissionContext);
  return (...wanted: string[]) => wanted.some((p) => permissions.has(p));
}

export function useAdminPermissionState(): AdminPermissionState {
  return useContext(AdminPermissionContext);
}
