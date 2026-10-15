import type { ReactNode } from "react";
import { WorkspaceShell, type WorkspaceNavItem } from "../workspace/WorkspaceShell";
import { ADMIN_NAV, ADMIN_ROLE_LABEL, canUse, navItem, type AdminRoleName, type AdminTab } from "./adminNav";
import { useAdminCan } from "./adminPermissions";

// Admin workspace shell (2026-10-14 redesign). Since the UI completion pass
// it is the shared WorkspaceShell (also used by the partner and host
// workspaces) fed with the admin catalogue: grouped sidebar at ≥1025px, a
// full-screen "Sections" menu below that, locked items for tools outside the
// admin's sub-role (the server is still the enforcement point), and the
// compact workspace footer.

const ICON = { size: 18, strokeWidth: 1.9, "aria-hidden": true } as const;

export function AdminShell({
  active,
  onNavigate,
  role,
  account,
  counts,
  actions,
  children,
}: {
  active: AdminTab;
  onNavigate: (tab: AdminTab) => void;
  /** null = no valid admin role (every item is locked). */
  role: AdminRoleName | null;
  account: { name: string; email: string };
  counts: Partial<Record<AdminTab, number>>;
  /** Primary page actions, right of the page title. */
  actions?: ReactNode;
  children: ReactNode;
}) {
  const can = useAdminCan();
  const navItems: WorkspaceNavItem<AdminTab>[] = ADMIN_NAV.flatMap((group) =>
    group.items.map((item) => {
      const Icon = item.icon;
      return { key: item.key, label: item.label, icon: <Icon {...ICON} />, group: group.label, count: counts[item.key], locked: !canUse(can, item) };
    })
  );
  const item = navItem(active);
  return (
    <WorkspaceShell
      workspaceLabel="Admin workspace"
      account={`${role ? ADMIN_ROLE_LABEL[role] : "No admin role"} · ${account.email}`}
      navItems={navItems}
      defaultGroup="Admin"
      active={active}
      onNavigate={onNavigate}
      title={item.label}
      subtitle={item.summary}
      actions={actions}
      collapseKey="hc_admin_sidebar_collapsed"
      countLabel="waiting"
    >
      {children}
    </WorkspaceShell>
  );
}
