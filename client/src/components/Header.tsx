import { BrandLogo } from "./BrandLogo";
import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Bell, ChevronDown, CircleHelp, Heart, Menu, MessageCircle, Plus, Search, Store, type LucideIcon } from "lucide-react";
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
import { EXPLORE_FEATURED, EXPLORE_PATHS, EXPLORE_PLACES, EXPLORE_THINGS, FREE_TIME_ITEM, START_ITEMS, START_PATHS, SUGGEST_PLACE_ITEM, isUnder, visibleItems, type NavContext, type NavItem } from "../navigation/navConfig";
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
  const { openNav } = useDashboardNav();
  const { resolvedTheme, setTheme } = useTheme();
  const openBooking = useOpenBookingOpen();
  const data = useHeaderData(user, resident);

  const [panel, setPanel] = useState<Panel>(null);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [searchScreen, setSearchScreen] = useState(false);
  const megaRef = useRef<HTMLDivElement>(null);
  const panelRefs = {
    explore: useRef<HTMLDivElement>(null),
    start: useRef<HTMLDivElement>(null),
    notifications: useRef<HTMLDivElement>(null),
    account: useRef<HTMLDivElement>(null),
    search: useRef<HTMLDivElement>(null),
  };
  const toggle = (p: Exclude<Panel, null>) => setPanel((cur) => (cur === p ? null : p));
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
  const savedActive = pathname === "/profile" && new URLSearchParams(location.search).get("tab") === "favourites";

  // ── Explore: the existing mega menu, laid out full width ──────────────────
  const places = visibleItems(EXPLORE_PLACES, navCtx);
  const megaTitle: React.CSSProperties = { display: "block", fontFamily: fonts.display, fontSize: 15.5, fontWeight: 700, color: colors.text, letterSpacing: 0 };
  const megaDesc: React.CSSProperties = { display: "block", fontSize: 13, color: colors.muted, marginTop: 2, lineHeight: 1.45 };
  const megaRow = (item: NavItem) => (
    <Link key={item.key} to={item.to} className="hc-mega-row" aria-current={pathname + location.search === item.to ? "page" : undefined} onClick={closeAll}>
      <span className="hc-row-icon">
        <NavIcon icon={item.icon} size={21} />
      </span>
      <span>
        <span style={megaTitle}>{item.label}</span>
        <span style={megaDesc}>{item.desc}</span>
      </span>
    </Link>
  );
  const megaTile = (item: NavItem, cta: string) => (
    <Link key={item.key} to={item.to} className="hc-mega-tile" aria-current={pathname === item.to ? "page" : undefined} onClick={closeAll}>
      <span style={megaTitle}>{item.label}</span>
      <span style={megaDesc}>{item.desc}</span>
      <span style={{ display: "block", fontSize: 11.5, fontWeight: 700, color: colors.orangeDark, letterSpacing: 0, marginTop: 10 }}>{cta} &rarr;</span>
    </Link>
  );
  const exploreMega = (
    <div ref={megaRef} id="hc-explore-menu" className="hc-mega pop-in">
      <div className="hc-mega-inner hc-mega-layout" data-places={places.length > 0 ? "1" : "0"} style={{ maxWidth }}>
        <div>
          <div className="hc-mega-label">
            <span style={{ opacity: 0.6 }}>/</span> THINGS TO DO
          </div>
          <div className="hc-mega-grid">{EXPLORE_THINGS.map(megaRow)}</div>
        </div>
        {places.length > 0 && (
          <div>
            <div className="hc-mega-label">
              <span style={{ opacity: 0.6 }}>/</span> PLACES
            </div>
            {places.map(megaRow)}
          </div>
        )}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div className="hc-mega-label" style={{ marginBottom: 4 }}>
            <span style={{ opacity: 0.6 }}>/</span> FEATURED
          </div>
          {megaTile(EXPLORE_FEATURED[0], "SEE WHAT'S ON")}
          {megaTile(EXPLORE_FEATURED[1], "GET STARTED")}
          {megaTile(FREE_TIME_ITEM, "TRY IT")}
        </div>
        <Link to="/explore" onClick={closeAll} className="hc-mega-photo hc-mega-photo-col" aria-label="Discover what's on — start exploring">
          <img
            src="https://images.unsplash.com/photo-1633894812833-3961145496a3?w=600&q=75&auto=format&fit=crop"
            alt=""
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", display: "block", filter: "grayscale(.15) saturate(1.05)" }}
          />
          <span style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, rgba(30,36,32,0) 45%, rgba(30,36,32,.88) 100%)" }} />
          <span style={{ position: "absolute", left: 20, right: 20, bottom: 20, textAlign: "left" }}>
            <span style={{ display: "block", fontFamily: fonts.display, fontWeight: 800, fontSize: 20, color: "#fff", lineHeight: 1.2 }}>
              Discover
              <br />
              what's on.
            </span>
            <span style={{ display: "block", width: 26, height: 1, background: colors.gold, margin: "14px 0" }} />
            <span style={{ display: "block", fontSize: 12, fontWeight: 700, color: colors.gold, letterSpacing: 0 }}>START EXPLORING &rarr;</span>
          </span>
        </Link>
      </div>
    </div>
  );

  const startPanel = (
    <div className="pop-in" id="hc-start-menu" style={{ ...panelStyle, left: 0, width: 340 }}>
      {visibleItems(START_ITEMS, navCtx).map((item) => (
        <Link key={item.key} to={item.to} className="hc-menu-row" aria-current={pathname === item.to ? "page" : undefined} onClick={closeAll} style={{ alignItems: "flex-start", padding: "10px 12px" }}>
          <span className="hc-row-icon" style={{ marginTop: 1 }}>
            <NavIcon icon={item.icon} size={21} />
          </span>
          <span>
            <span style={menuRowTitleStyle}>{item.label}</span>
            <span style={menuRowDescStyle}>{item.desc}</span>
          </span>
        </Link>
      ))}
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
        <Link to="/" className="hc-logo-link" aria-label="HelloCircle home" aria-current={pathname === "/" || pathname === "/home" ? "page" : undefined}>
          <BrandLogo decorative />
        </Link>

        <nav className="desktop-nav hc-nav" aria-label="Main">
          <div ref={panelRefs.explore}>
            <button type="button" className={`hc-nav-link${exploreActive ? " is-active" : ""}`} onClick={() => toggle("explore")} aria-expanded={panel === "explore"} aria-controls="hc-explore-menu">
              Explore <ChevronDown className="hc-chevron" size={16} strokeWidth={ICON_STROKE} aria-hidden="true" />
            </button>
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

        {/* One search entry point → the Explore search page. Not repeated on
            that page itself, which has its own search box. */}
        {!onSearchPage ? (
          <div className="hc-search-desktop desktop-actions">
            <HeaderSearch />
          </div>
        ) : (
          <div className="desktop-actions" style={{ flex: 1 }} />
        )}

        <div className="desktop-actions" style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 4, flex: "none" }}>
          {!onSearchPage && (
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
                <Link to="/profile?tab=favourites" className={`hc-icon-btn${savedActive ? " is-active" : ""}`} aria-label="Saved" title="Saved" aria-current={savedActive ? "page" : undefined}>
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
          {!onSearchPage && (
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

      {panel === "explore" && exploreMega}

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
