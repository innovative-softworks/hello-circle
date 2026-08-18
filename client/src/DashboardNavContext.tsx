import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

// Lets Admin/Vendor dashboards put their nav-sidebar toggle in the global
// Header (next to the logo) instead of inside their own page content — the
// dashboard page registers an "open" trigger on mount and clears it on
// unmount; Header.tsx only renders the burger button when one is
// registered, which is how it stays admin/vendor-only without Header
// needing to know about routes or tab lists itself.

interface DashboardNavContextValue {
  openNav: (() => void) | null;
  setOpenNav: (fn: (() => void) | null) => void;
}

const DashboardNavContext = createContext<DashboardNavContextValue>({
  openNav: null,
  setOpenNav: () => {},
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

  return <DashboardNavContext.Provider value={{ openNav, setOpenNav }}>{children}</DashboardNavContext.Provider>;
}

export function useDashboardNav() {
  return useContext(DashboardNavContext);
}
