import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

// Lets Admin/Vendor dashboards put their nav-sidebar toggle in the global
// Header (next to the logo) instead of inside their own page content — the
// dashboard page registers an "open" trigger on mount and clears it on
// unmount; Header.tsx only renders the burger button when one is
// registered, which is how it stays admin/vendor-only without Header
// needing to know about routes or tab lists itself.

/** What a workspace (admin / partner / host) shows in the global header since
 * 2026-10-16: its name, the account line, the "View platform" link and the
 * sidebar collapse toggle. The separate workspace strip row was merged in. */
export interface HeaderWorkspace {
  label: string;
  account?: string;
  link: { label: string; to: string; newTab?: boolean };
  collapsed: boolean;
  onToggleCollapse: () => void;
}

interface DashboardNavContextValue {
  openNav: (() => void) | null;
  setOpenNav: (fn: (() => void) | null) => void;
  workspace: HeaderWorkspace | null;
  setWorkspace: (w: HeaderWorkspace | null) => void;
}

const DashboardNavContext = createContext<DashboardNavContextValue>({
  openNav: null,
  setOpenNav: () => {},
  workspace: null,
  setWorkspace: () => {},
});

export function DashboardNavProvider({ children }: { children: ReactNode }) {
  const [openNav, setOpenNavState] = useState<(() => void) | null>(null);
  // Stored as `() => fn` (not `fn` directly) since useState would otherwise
  // treat a bare function value as a lazy initializer/updater. Wrapped in
  // useCallback with an empty dep array so its identity is stable across
  // renders — otherwise a consumer's `useEffect(() => { setOpenNav(...) },
  // [setOpenNav])` would loop: calling it re-renders this provider, which
  // would hand out a new setOpenNav reference, re-triggering that effect.
  const setOpenNav = useCallback((fn: (() => void) | null) => setOpenNavState(() => fn), []);
  const [workspace, setWorkspaceState] = useState<HeaderWorkspace | null>(null);
  const setWorkspace = useCallback((w: HeaderWorkspace | null) => setWorkspaceState(w), []);

  return <DashboardNavContext.Provider value={{ openNav, setOpenNav, workspace, setWorkspace }}>{children}</DashboardNavContext.Provider>;
}

export function useDashboardNav() {
  return useContext(DashboardNavContext);
}
