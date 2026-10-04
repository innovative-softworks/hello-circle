import { useEffect, useState, type ReactNode } from "react";
import { useDashboardNav } from "../DashboardNavContext";
import { NavRail, NavSidebar } from "./ui";
import { colors, fonts, maxWidth } from "../theme";

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
  contextLabel,
  pageTitle,
  headerActions,
  showNavLogo = true,
  bannerHasHeading = true,
  children,
}: {
  /** NavSidebar's own header text, e.g. "Vendor dashboard". */
  navTitle: string;
  navOptions: { key: T; label: string; icon?: ReactNode; group?: string }[];
  activeKey: T;
  onNavChange: (v: T) => void;
  /** Rendered above the sidebar/title row — typically the colored
   * DashboardTopPanel block, only passed on the "overview" tab. */
  banner?: ReactNode;
  /** Platform Pre-Launch Polish — Changeset 5C. A small, one-line "which
   * workspace am I in" cue above pageTitle — e.g. "MANAGING AS HOST",
   * "MANAGING CIRCLE", "MANAGING VENDOR ACCOUNT" — since pageTitle alone
   * (a bare name like a circle's own name) doesn't say which *kind* of
   * workspace it is. Deliberately just a text line, not a new banner
   * component — every caller already knows its own workspace kind, so this
   * is just surfacing that, not adding new state. */
  contextLabel?: string;
  pageTitle: ReactNode;
  /** Right-aligned actions next to pageTitle, e.g. an "Add program" button. */
  headerActions?: ReactNode;
  /** Passed through to NavRail — false for pages (like Profile) that already
   * sit under the app's own header, where a second logo repeats the brand
   * mark with nothing new to say. */
  showNavLogo?: boolean;
  /** HC-QA-083 — false when the banner is decorative (no H1 inside it), so
   * the title row stays the page's H1. */
  bannerHasHeading?: boolean;
  children: ReactNode;
}) {
  const [navOpen, setNavOpen] = useState(false);
  const { setOpenNav } = useDashboardNav();
  // HC-QA-083 — the banner (DashboardTopPanel) carries the page's H1 when
  // shown (overview tabs); otherwise this title row IS the page heading.
  const TitleTag = banner && bannerHasHeading ? "h2" : "h1";

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
          <NavRail title={navTitle} options={navOptions} value={activeKey} onChange={onNavChange} showLogo={showNavLogo} />

          <div style={{ minWidth: 0 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, marginBottom: 18 }}>
              <div>
                {contextLabel && (
                  <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: colors.mutedLight, marginBottom: 2 }}>
                    {contextLabel}
                  </div>
                )}
                <TitleTag style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: 26, margin: 0, letterSpacing: "-.02em" }}>{pageTitle}</TitleTag>
              </div>
              {headerActions}
            </div>

            {children}
          </div>
        </div>
      </section>
    </div>
  );
}
