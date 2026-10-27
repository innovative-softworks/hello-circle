import { BrandLogo } from "./BrandLogo";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { ArrowRight, Bell, ChevronDown, ChevronRight, CircleHelp, MapPin, Sparkles, Heart, Menu, MessageCircle, Plus, Search, Store, type LucideIcon, ExternalLink } from "lucide-react";
import { guestLogout, logout, switchWorkspace } from "../api";
import { useAuth } from "../AuthContext";
import { signInHref, signUpHref } from "../authRedirect";
import { useDashboardNav } from "../DashboardNavContext";
import { useGuest } from "../GuestContext";
import { useTheme } from "../ThemeContext";
import { Avatar, ConfirmDialog, Drawer } from "./ui";
import { colors, fonts, maxWidth } from "../theme";
import { useMyStuff } from "../MyStuffContext";
import { VENUE_PAGES_PUBLIC } from "../venueLaunch";
import { useOpenBookingOpen } from "../paidCheckout";
import { EXPLORE_LEARN, EXPLORE_PATHS, EXPLORE_PLACES, EXPLORE_PLACES_SOON, EXPLORE_THINGS, FREE_TIME_ITEM, START_GROUPS, START_PATHS, SUGGEST_PLACE_ITEM, isUnder, visibleItems, type NavContext, type NavItem } from "../navigation/navConfig";
import { useHeaderData } from "./header/useHeaderData";
import { HeaderSearch } from "./header/HeaderSearch";
import { MobileSearchScreen } from "./header/MobileSearchScreen";
import { NotificationsList } from "./header/NotificationsList";
import { AccountMenuContent } from "./header/AccountMenuContent";
import { ICON_STROKE, badgeStyle, countLabel, menuRowDescStyle, menuRowTitleStyle, panelStyle } from "./header/headerStyles";
import "./header/header.css";

// Header & navigation (premium pass 2026-10-12 — see
// docs/header-navigation-ux-audit-2026-10-12.md). Desktop: logo, Explore ▾,
// Circles, My Life, Start ▾ | search | Saved, notifications, messages, one
// account avatar. Mobile (≤860px): logo + search / notifications / account,
// with MobileTabBar.tsx as the primary navigation. Every destination is a
// real link; menus are disclosures (Escape + outside click close them and
// return focus to their trigger). Icons are lucide-react throughout; menu
// items come from navigation/navConfig.ts, shared with the mobile sheets.

type Panel = "explore" | "start" | "notifications" | "account" | "search" | null;
type Sheet = "account" | "notifications" | null;

const NavIcon = ({ icon: I, size = 20 }: { icon: LucideIcon; size?: number }) => <I size={size} strokeWidth={ICON_STROKE} aria-hidden="true" />;

export function Header() {
  const navigate = useNavigate();
  const location = useLocation();
  const { count } = useMyStuff();
  const { user, loading: authLoading, refresh } = useAuth();
  const { email: guestEmail, resident, loading: guestLoading, refresh: refreshGuest } = useGuest();
  // Both sessions resolve asynchronously; until then show neither the
  // signed-in nor the signed-out controls, so a signed-in visitor never sees
  // a flash of "Log in".
  const authResolved = !authLoading && !guestLoading;
  // Set only while an Admin/Vendor/Manage dashboard is mounted (DashboardNavContext).
  const { openNav, workspace } = useDashboardNav();
  const { resolvedTheme, setTheme } = useTheme();
  const openBooking = useOpenBookingOpen();
  const data = useHeaderData(user, resident);

  const [panel, setPanel] = useState<Panel>(null);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [searchScreen, setSearchScreen] = useState(false);
  const megaRef = useRef<HTMLDivElement>(null);
  // Explore opens under its trigger; nudged left only to stay in the viewport.
  const [exploreOffset, setExploreOffset] = useState(0);
  const panelRefs = {
    explore: useRef<HTMLDivElement>(null),
    start: useRef<HTMLDivElement>(null),
    notifications: useRef<HTMLDivElement>(null),
    account: useRef<HTMLDivElement>(null),
    search: useRef<HTMLDivElement>(null),
  };
  const toggle = (p: Exclude<Panel, null>) => setPanel((cur) => (cur === p ? null : p));
  useLayoutEffect(() => {
    if (panel !== "explore") return;
    const place = () => {
      const trigger = panelRefs.explore.current;
      if (!trigger) return;
      // Align the panel with the page container (same gutter as the logo).
      const gutter = window.innerWidth <= 860 ? 16 : 24;
      const pageLeft = Math.max(gutter, (window.innerWidth - maxWidth) / 2 + gutter);
      setExploreOffset(Math.round(pageLeft - trigger.getBoundingClientRect().left));
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [panel]); // eslint-disable-line react-hooks/exhaustive-deps
  const closeAll = () => {
    setPanel(null);
    setSheet(null);
    setSearchScreen(false);
  };

  const navCtx: NavContext = { venuesPublic: VENUE_PAGES_PUBLIC, openBooking, isVendor: user?.role === "vendor" };
  const pathname = location.pathname;
  const startActive = isUnder(pathname, START_PATHS);
  const exploreActive = isUnder(pathname, EXPLORE_PATHS) && !startActive;
  const onSearchPage = pathname === "/explore";
  // Inside the admin workspace the header is just logo + account (2026-10-16):
  // the workspace has its own navigation and a "View platform" link.
  // Inside a workspace (admin / partner / host) the header carries the
  // workspace name, account line and sidebar toggle instead of the public
  // menu and search (2026-10-16; the separate workspace strip was merged in).
  const inAdmin = pathname === "/admin" || pathname.startsWith("/admin/") || !!workspace;
  const signedIn = !!user || !!guestEmail;
  // My Life is the resident's own home; a guest who has booked on this device
  // also has one (anonymous client id). Not shown to vendor/admin-only sessions.
  const showMyLife = !!resident || (!user && (!!guestEmail || count > 0));
  const vendorOnly = !resident && user?.role === "vendor";
  const businessRow =
    resident && user && (user.role === "admin" || user.role === "vendor")
      ? user.role === "admin"
        ? { label: "Pending approvals", to: "/admin?tab=pending", count: data.businessCount }
        : { label: "Business notifications", to: "/vendor?tab=messages", count: data.vendorUnread }
      : null;

  // Close menus and sheets on navigation.
  useEffect(closeAll, [location.pathname, location.search]);

  // Outside click closes the open dropdown (the Explore panel lives outside
  // its trigger's wrapper, so both count as "inside").
  useEffect(() => {
    if (!panel) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (panelRefs[panel].current?.contains(target)) return;
      if (panel === "explore" && megaRef.current?.contains(target)) return;
      setPanel(null);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panel]);

  // HC-QA-070 — Escape closes the open dropdown and returns focus to its
  // trigger (found via aria-controls). Dialogs handle their own Escape.
  useEffect(() => {
    if (!panel) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || document.querySelector('[role="dialog"][aria-modal="true"], [role="alertdialog"]')) return;
      const id = `hc-${panel}-menu`;
      setPanel(null);
      document.querySelector<HTMLElement>(`[aria-controls="${id}"]`)?.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [panel]);

  const switchToVendor = async () => {
    closeAll();
    try {
      await switchWorkspace("vendor");
      // AuthContext only fetches /auth/me at load — refresh so the dashboard
      // sees the new vendor session instead of bouncing to /login.
      await refresh();
      navigate("/vendor");
    } catch {
      navigate("/login");
    }
  };
  const switchToResident = async () => {
    closeAll();
    try {
      await switchWorkspace("resident");
      await refreshGuest();
      navigate("/bookings");
    } catch {
      navigate("/signin");
    }
  };

  // Signing out is confirmed — the item sits next to plain links.
  const [confirmingLogout, setConfirmingLogout] = useState<"vendor" | "guest" | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);
  const doSignOut = async () => {
    setLoggingOut(true);
    try {
      if (confirmingLogout === "vendor") {
        await logout();
        await refresh();
      } else {
        await guestLogout();
        await refreshGuest();
      }
      navigate("/");
    } finally {
      setLoggingOut(false);
      setConfirmingLogout(null);
    }
  };
  const askSignOut = () => {
    closeAll();
    setConfirmingLogout(user ? "vendor" : "guest");
  };
  const toggleTheme = () => setTheme(resolvedTheme === "dark" ? "light" : "dark");

  const accountProps = {
    user,
    resident,
    guestEmail,
    workspaces: data.workspaces,
    hasHostedGames: data.hasHostedGames,
    myLifeCount: count,
    chatUnread: data.chatUnread,
    unreadNotifs: data.unreadNotifs,
    businessCount: data.businessCount,
    resolvedTheme,
    onToggleTheme: toggleTheme,
    onSwitchVendor: switchToVendor,
    onSwitchPersonal: switchToResident,
    onSignOut: askSignOut,
    onNavigate: closeAll,
  };

  // Business work waiting (admin approvals / vendor listings) — surfaced on
  // the avatar, named in its menu. Real server counts only.
  const accountAttention = user ? data.businessCount : 0;
  const accountLabel = `Account menu${accountAttention > 0 ? `, ${accountAttention} ${user?.role === "admin" ? "pending approvals" : "listings need attention"}` : ""}`;
  const avatarName = resident?.name || user?.name || guestEmail || "?";
  const badge = (n: number) => (n > 0 ? <span style={badgeStyle}>{countLabel(n)}</span> : null);
  const savedActive = (pathname === "/bookings" || pathname === "/my-life") && new URLSearchParams(location.search).get("tab") === "saved";

  // ── Explore ───────────────────────────────────────────────────────────────
  const places = [...visibleItems(EXPLORE_PLACES, navCtx), ...visibleItems(EXPLORE_PLACES_SOON, navCtx)];
  // Navigation redesign 2026-10-22 (owner: "design the nav much better",
  // "I don't need full width menu") — Explore and Start are compact dropdowns
  // under their buttons, sharing one item style: icon tile, title, one line.
  const dropRow = (item: NavItem) => (
    <Link key={item.key} to={item.to} className="hc-drop-row" aria-current={pathname + location.search === item.to ? "page" : undefined} onClick={closeAll}>
      <span className="hc-drop-icon" aria-hidden="true">
        <NavIcon icon={item.icon} size={19} />
      </span>
      <span style={{ minWidth: 0 }}>
        <span className="hc-drop-title">{item.label}</span>
        <span className="hc-drop-desc">{item.desc}</span>
      </span>
    </Link>
  );
  const dropGroup = (id: string, label: string, items: NavItem[]) => (
    <div role="group" aria-labelledby={id} className="hc-drop-group">
      <div id={id} className="hc-drop-label">{label}</div>
      {items.map(dropRow)}
    </div>
  );
  // Explore mega menu (owner reference design, 2026-10-22): page-width panel
  // aligned to the logo, three ruled columns (icon · title · one line ·
  // chevron), a photo card for this weekend, and a tinted footer.
  const weekend = EXPLORE_THINGS.find((i) => i.key === "events")!;
  const editorialLink = (item: NavItem) => (
    <Link key={item.key} to={item.to} className="hc-ed-link" aria-current={pathname + location.search === item.to ? "page" : undefined} onClick={closeAll}>
      <span className="hc-ed-icon" aria-hidden="true">
        <NavIcon icon={item.icon} size={24} />
      </span>
      <span style={{ minWidth: 0, flex: 1 }}>
        <span className="hc-ed-title">{item.label}</span>
        <span className="hc-ed-desc">{item.desc}</span>
      </span>
      {item.soon ? <span className="hc-ed-soon">Soon</span> : <ChevronRight className="hc-ed-chev" size={18} strokeWidth={ICON_STROKE} aria-hidden="true" />}
    </Link>
  );
  const startAndHost = START_GROUPS.flatMap((g) => visibleItems(g.items, navCtx));
  const exploreMega = (
    <div ref={megaRef} id="hc-explore-menu" className="hc-drop hc-drop--editorial pop-in" style={{ left: exploreOffset }}>
      <div className="hc-ed-body">
        <div role="group" aria-labelledby="hc-ed-things" className="hc-ed-col">
          <div id="hc-ed-things" className="hc-drop-label">Things to do</div>
          {EXPLORE_THINGS.map(editorialLink)}
        </div>
        <div className="hc-ed-col">
          <div role="group" aria-labelledby="hc-ed-learn">
            <div id="hc-ed-learn" className="hc-drop-label">Learn & give back</div>
            {EXPLORE_LEARN.map(editorialLink)}
          </div>
          {places.length > 0 && (
            <div role="group" aria-labelledby="hc-ed-places" className="hc-ed-subgroup">
              <div id="hc-ed-places" className="hc-drop-label">Places</div>
              {places.map(editorialLink)}
            </div>
          )}
        </div>
        <div role="group" aria-labelledby="hc-ed-start" className="hc-ed-col">
          <div id="hc-ed-start" className="hc-drop-label">Start & host</div>
          {startAndHost.map(editorialLink)}
        </div>
        <Link to={weekend.to} className="hc-ed-photo" onClick={closeAll}>
          <img src="https://images.unsplash.com/photo-1551632811-561732d1e306?w=640&q=75&auto=format&fit=crop" alt="" loading="eager" />
          <span className="hc-ed-photo-text">
            <span className="hc-ed-photo-kicker">This weekend</span>
            <span className="hc-ed-photo-title">Find your next adventure.</span>
            <span className="hc-ed-photo-sub">Great activities, events and experiences near you.</span>
            <span className="hc-ed-photo-cta">See what's on <ArrowRight size={16} strokeWidth={2.2} aria-hidden="true" /></span>
          </span>
        </Link>
      </div>
      <div className="hc-ed-footer">
        <Link to={FREE_TIME_ITEM.to} className="hc-ed-footer-link" onClick={closeAll} aria-current={pathname === FREE_TIME_ITEM.to ? "page" : undefined}>
          <Sparkles size={20} strokeWidth={ICON_STROKE} aria-hidden="true" style={{ color: colors.text }} />
          <span style={{ color: colors.muted }}>Not sure what to do?</span>
          <span className="hc-ed-footer-cta">
            Try Free Time Mode <ArrowRight size={16} strokeWidth={2.2} aria-hidden="true" />
          </span>
        </Link>
        {resident?.homeCounty && (
          <span className="hc-ed-footer-near">
            <MapPin size={18} strokeWidth={ICON_STROKE} aria-hidden="true" />
            Showing results near <strong>{resident.homeCounty}</strong>
            <Link to="/profile" onClick={closeAll} className="hc-ed-footer-change">Change</Link>
          </span>
        )}
      </div>
    </div>
  );

  const startPanel = (
    <div className="hc-drop hc-drop--start pop-in" id="hc-start-menu">
      {START_GROUPS.map((g) => {
        const items = visibleItems(g.items, navCtx);
        if (!items.length) return null;
        return <div key={g.key}>{dropGroup(`hc-start-${g.key}`, g.label, items)}</div>;
      })}
    </div>
  );

  return (
    <header
      className="hc-header"
      style={{
        position: "sticky",
        top: 0,
        zIndex: 50,
        background: colors.headerBg,
        backdropFilter: "blur(12px)",
        borderBottom: `1px solid ${colors.border}`,
        // Notch/status-bar clearance — 0 on web/non-notched devices.
        paddingTop: "env(safe-area-inset-top)",
      }}
    >
      <div className="hc-header-row" style={{ maxWidth, margin: "0 auto" }}>
        {openNav && (
          // Dashboard side-menu burger: hidden ≥1025px (rail shown) and
          // ≤860px (reached from the Account & More sheet instead).
          <button className="dashboard-nav-btn hc-icon-btn" onClick={openNav} aria-label="Open dashboard menu">
            <NavIcon icon={Menu} />
          </button>
        )}
        {workspace && (
          // Sidebar collapse toggle (≥1025px, where the sidebar is shown).
          <button
            type="button"
            className="hc-icon-btn hc-ws-collapse"
            onClick={workspace.onToggleCollapse}
            aria-expanded={!workspace.collapsed}
            aria-controls="ws-side-nav"
            aria-label={workspace.collapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={workspace.collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            <NavIcon icon={Menu} />
          </button>
        )}
        <Link to="/" className="hc-logo-link" aria-label="HelloCircle home" aria-current={pathname === "/" || pathname === "/home" ? "page" : undefined}>
          <BrandLogo decorative />
        </Link>
        {workspace && <span className="hc-ws-label"><span className="hc-ws-label-text">{workspace.label}</span></span>}

        {!inAdmin && (
        <nav className="desktop-nav hc-nav" aria-label="Main">
          <div ref={panelRefs.explore} style={{ position: "relative" }}>
            <button type="button" className={`hc-nav-link${exploreActive ? " is-active" : ""}`} onClick={() => toggle("explore")} aria-expanded={panel === "explore"} aria-controls="hc-explore-menu">
              Explore <ChevronDown className="hc-chevron" size={16} strokeWidth={ICON_STROKE} aria-hidden="true" />
            </button>
            {panel === "explore" && exploreMega}
                </div>
          <Link to="/circles" className={`hc-nav-link${isUnder(pathname, ["/circles"]) && !startActive ? " is-active" : ""}`} aria-current={pathname === "/circles" ? "page" : undefined}>
            Circles
          </Link>
          {showMyLife && (
            <Link to="/bookings" className={`hc-nav-link${pathname === "/bookings" || pathname === "/my-life" ? " is-active" : ""}`} aria-current={pathname === "/bookings" || pathname === "/my-life" ? "page" : undefined}>
              My Life
            </Link>
          )}
          <div ref={panelRefs.start} style={{ position: "relative" }}>
            <button type="button" className={`hc-nav-link hc-nav-link--start${startActive ? " is-active" : ""}`} onClick={() => toggle("start")} aria-expanded={panel === "start"} aria-controls="hc-start-menu">
              <span className="hc-start-plus" aria-hidden="true">
                <Plus size={15} strokeWidth={2.4} />
              </span>
              Start <ChevronDown className="hc-chevron" size={16} strokeWidth={ICON_STROKE} aria-hidden="true" />
            </button>
            {panel === "start" && startPanel}
          </div>
        </nav>
        )}

        {/* One search entry point → the Explore search page. Not repeated on
            that page itself, which has its own search box. */}
        {!onSearchPage && !inAdmin ? (
          <div className="hc-search-desktop desktop-actions">
            <HeaderSearch />
          </div>
        ) : (
          <div className="desktop-actions" style={{ flex: 1 }} />
        )}

        <div className="desktop-actions" style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 4, flex: "none" }}>
          {workspace && (
            <div className="hc-ws-meta">
              {workspace.account && <span className="hc-ws-account">{workspace.account}</span>}
              {workspace.link.newTab ? (
                <a href={workspace.link.to} target="_blank" rel="noreferrer" className="hc-ws-link" aria-label={`${workspace.link.label} (opens in a new tab)`}>
                  {workspace.link.label} <ExternalLink size={13} strokeWidth={1.9} aria-hidden="true" />
                </a>
              ) : (
                <Link to={workspace.link.to} className="hc-ws-link">
                  {workspace.link.label} <ExternalLink size={13} strokeWidth={1.9} aria-hidden="true" />
                </Link>
              )}
            </div>
          )}
          {!onSearchPage && !inAdmin && (
            <div ref={panelRefs.search} className="hc-search-icon-only" style={{ position: "relative" }}>
              <button type="button" className="hc-icon-btn" aria-label="Search" aria-expanded={panel === "search"} aria-controls="hc-search-menu" onClick={() => toggle("search")}>
                <NavIcon icon={Search} />
              </button>
              {panel === "search" && (
                <div id="hc-search-menu" style={{ ...panelStyle, right: 0, width: 380, padding: 10 }}>
                  <HeaderSearch autoFocus onDone={closeAll} />
                </div>
              )}
            </div>
          )}

          {!authResolved ? (
            <div style={{ width: 44, height: 44 }} aria-hidden="true" />
          ) : signedIn ? (
            <>
              {resident && (
                <Link to="/bookings?tab=saved" className={`hc-icon-btn${savedActive ? " is-active" : ""}`} aria-label="Saved" title="Saved" aria-current={savedActive ? "page" : undefined}>
                  <NavIcon icon={Heart} />
                </Link>
              )}
              {resident && (
                <div ref={panelRefs.notifications} style={{ position: "relative" }}>
                  <button
                    type="button"
                    className="hc-icon-btn"
                    onClick={() => toggle("notifications")}
                    aria-label={data.unreadNotifs > 0 ? `Notifications, ${data.unreadNotifs} unread` : "Notifications"}
                    aria-expanded={panel === "notifications"}
                    aria-controls="hc-notifications-menu"
                  >
                    <NavIcon icon={Bell} />
                    {badge(data.unreadNotifs)}
                  </button>
                  {panel === "notifications" && (
                    <div className="pop-in" id="hc-notifications-menu" style={{ ...panelStyle, right: 0, width: 340, maxHeight: 440, overflowY: "auto" }}>
                      <NotificationsList notifs={data.notifs} markRead={data.markRead} onNavigate={closeAll} business={businessRow} />
                    </div>
                  )}
                </div>
              )}
              {/* A vendor-only session: business notifications live in the
                  dashboard's Messages tab — real unread rows, no listing counts. */}
              {vendorOnly && (
                <Link to="/vendor?tab=messages" className="hc-icon-btn" aria-label={data.vendorUnread > 0 ? `Business notifications, ${data.vendorUnread} unread` : "Business notifications"} title="Business notifications">
                  <NavIcon icon={Bell} />
                  {badge(data.vendorUnread)}
                </Link>
              )}
              {(resident || data.hostOnly) && (
                <Link
                  to="/chats"
                  className={`hc-icon-btn${pathname === "/chats" ? " is-active" : ""}`}
                  aria-label={data.chatUnread > 0 ? `Messages, ${data.chatUnread} unread` : "Messages"}
                  title="Messages"
                  aria-current={pathname === "/chats" ? "page" : undefined}
                >
                  <NavIcon icon={MessageCircle} />
                  {badge(data.chatUnread)}
                </Link>
              )}
              <div ref={panelRefs.account} style={{ position: "relative", marginLeft: 4 }}>
                <button type="button" className="hc-avatar-btn" onClick={() => toggle("account")} aria-label={accountLabel} aria-expanded={panel === "account"} aria-controls="hc-account-menu">
                  <Avatar name={avatarName} size={36} src={resident?.avatarUrl ?? null} />
                  <ChevronDown className="hc-chevron" size={16} strokeWidth={ICON_STROKE} aria-hidden="true" />
                  {badge(accountAttention)}
                </button>
                {panel === "account" && (
                  <div className="pop-in" id="hc-account-menu" style={{ ...panelStyle, right: 0, width: 300, maxHeight: "calc(100vh - 96px)", overflowY: "auto" }}>
                    <AccountMenuContent {...accountProps} />
                  </div>
                )}
              </div>
            </>
          ) : (
            <>
              <Link to={signInHref()} className="hc-btn" style={{ marginLeft: 4 }}>
                Log in
              </Link>
              <Link to={signUpHref()} className="hc-btn hc-btn--primary">
                Sign up
              </Link>
            </>
          )}
        </div>

        {/* Mobile (≤860px): search, notifications, account. The bottom tab
            bar (MobileTabBar) carries the primary destinations. */}
        <div className="hc-mobile-actions">
          {!onSearchPage && !inAdmin && (
            <button type="button" className="hc-icon-btn" aria-label="Search" aria-haspopup="dialog" aria-expanded={searchScreen} onClick={() => setSearchScreen(true)}>
              <NavIcon icon={Search} size={22} />
            </button>
          )}
          {authResolved && resident && (
            <button
              type="button"
              className="hc-icon-btn"
              aria-label={data.unreadNotifs > 0 ? `Notifications, ${data.unreadNotifs} unread` : "Notifications"}
              aria-haspopup="dialog"
              aria-expanded={sheet === "notifications"}
              onClick={() => setSheet("notifications")}
            >
              <NavIcon icon={Bell} size={22} />
              {badge(data.unreadNotifs)}
            </button>
          )}
          {authResolved && vendorOnly && (
            <Link to="/vendor?tab=messages" className="hc-icon-btn" aria-label={data.vendorUnread > 0 ? `Business notifications, ${data.vendorUnread} unread` : "Business notifications"}>
              <NavIcon icon={Bell} size={22} />
              {badge(data.vendorUnread)}
            </Link>
          )}
          <button
            type="button"
            className="hc-icon-btn"
            aria-label={signedIn ? accountLabel.replace("Account menu", "Account and more") : "Menu"}
            aria-haspopup="dialog"
            aria-expanded={sheet === "account"}
            onClick={() => setSheet("account")}
          >
            {authResolved && signedIn ? <Avatar name={avatarName} size={32} src={resident?.avatarUrl ?? null} /> : <NavIcon icon={Menu} size={22} />}
            {badge(accountAttention)}
          </button>
        </div>
      </div>


      <MobileSearchScreen open={searchScreen} onClose={() => setSearchScreen(false)} />

      <Drawer open={sheet === "notifications"} onClose={() => setSheet(null)} title="Notifications">
        <NotificationsList notifs={data.notifs} markRead={data.markRead} onNavigate={closeAll} business={businessRow} />
      </Drawer>

      <Drawer open={sheet === "account"} onClose={() => setSheet(null)} title={signedIn ? "Account & more" : "Welcome to HelloCircle"}>
        {openNav && (
          <button
            type="button"
            className="hc-menu-row"
            onClick={() => {
              setSheet(null);
              openNav();
            }}
          >
            <span className="hc-row-icon">
              <NavIcon icon={Menu} />
            </span>
            Dashboard menu
          </button>
        )}
        {!signedIn && (
          <div style={{ display: "flex", gap: 10, padding: "4px 4px 12px" }}>
            <Link to={signInHref()} className="hc-btn" style={{ flex: 1, height: 44 }} onClick={closeAll}>
              Log in
            </Link>
            <Link to={signUpHref()} className="hc-btn hc-btn--primary" style={{ flex: 1, height: 44 }} onClick={closeAll}>
              Sign up
            </Link>
          </div>
        )}
        <AccountMenuContent
          {...accountProps}
          surface="sheet"
          extra={
            <>
              <div style={{ borderTop: `1px solid ${colors.border}`, margin: "6px 4px" }} />
              {[
                { to: SUGGEST_PLACE_ITEM.to, label: SUGGEST_PLACE_ITEM.label, icon: SUGGEST_PLACE_ITEM.icon },
                { to: "/help-guide", label: "Help guide", icon: CircleHelp },
                { to: "/for-venues", label: "For venues & organisers", icon: Store },
              ].map((r) => (
                <Link key={r.to} to={r.to} className="hc-menu-row" onClick={closeAll}>
                  <span className="hc-row-icon">
                    <NavIcon icon={r.icon} />
                  </span>
                  {r.label}
                </Link>
              ))}
            </>
          }
        />
      </Drawer>

      <ConfirmDialog
        open={confirmingLogout !== null}
        title="Sign out?"
        message={confirmingLogout === "vendor" ? "You'll need to sign back in to reach your dashboard." : "You'll need to sign back in to see your bookings, Circles and saved things."}
        confirmLabel={loggingOut ? "…" : "Sign out"}
        tone="neutral"
        busy={loggingOut}
        onConfirm={doSignOut}
        onCancel={() => setConfirmingLogout(null)}
      />
    </header>
  );
}
