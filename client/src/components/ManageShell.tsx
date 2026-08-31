import { useEffect, useState, type ReactNode } from "react";
import { useDashboardNav } from "../DashboardNavContext";
import { NavRail, NavSidebar } from "./ui";
import { fonts, maxWidth } from "../theme";

// HelloCircle Manage (Phase 1) — the sidebar/title-row shell shared by every
// operational dashboard, extracted from what used to be two copy-pasted
// implementations (VendorDashboard.tsx and AdminDashboard.tsx each had their
// own navOpen state + useDashboardNav wiring + NavSidebar + <h2> title row,
// byte-for-byte the same shape). This is a pure refactor of already-working
// UI — no visual change — so Host/Circle-organiser Manage surfaces (Phase
// 3/4) can reuse the exact same shell without a third copy-paste.
//
// The colored "overview" banner (DashboardTopPanel, optionally paired with
// something else like AdminHeroPanel) stays a caller-supplied `banner` node
// rather than something this component renders itself, since its contents
// genuinely differ between vendor (one panel) and admin (two side by side)
// — see each dashboard's own render for what it passes.

export function ManageShell<T extends string>({
  navTitle,
  navOptions,
  activeKey,
  onNavChange,
  banner,
  pageTitle,
  headerActions,
  children,
}: {
  /** NavSidebar's own header text, e.g. "Vendor dashboard". */
  navTitle: string;
  navOptions: { key: T; label: string; icon?: ReactNode }[];
  activeKey: T;
  onNavChange: (v: T) => void;
  /** Rendered above the sidebar/title row — typically the colored
   * DashboardTopPanel block, only passed on the "overview" tab. */
  banner?: ReactNode;
  pageTitle: ReactNode;
  /** Right-aligned actions next to pageTitle, e.g. an "Add program" button. */
  headerActions?: ReactNode;
  children: ReactNode;
}) {
  const [navOpen, setNavOpen] = useState(false);
  const { setOpenNav } = useDashboardNav();

  // Registers the Header.tsx burger's click handler while this page is
  // mounted — see DashboardNavContext.
  useEffect(() => {
    setOpenNav(() => setNavOpen(true));
    return () => setOpenNav(null);
  }, [setOpenNav]);

  return (
    <div className="fade-panel">
      <section className="section-pad" style={{ maxWidth, margin: "0 auto", padding: "40px 24px 90px" }}>
        {banner}

        <NavSidebar open={navOpen} onClose={() => setNavOpen(false)} title={navTitle} options={navOptions} value={activeKey} onChange={onNavChange} />

        <div className="manage-shell-grid">
          <NavRail title={navTitle} options={navOptions} value={activeKey} onChange={onNavChange} />

          <div style={{ minWidth: 0 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, marginBottom: 18 }}>
              <h2 style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: 26, margin: 0, letterSpacing: "-.02em" }}>{pageTitle}</h2>
              {headerActions}
            </div>

            {children}
          </div>
        </div>
      </section>
    </div>
  );
}
