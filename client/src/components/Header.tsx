import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { fetchAdminPendingListings, fetchManageWorkspaces, fetchMyGames, fetchResidentNotifications, fetchVendorListings, guestLogout, logout, markResidentNotificationRead, switchWorkspace } from "../api";
import type { ManageWorkspaces } from "../api/manage";
import { useAuth } from "../AuthContext";
import { useDashboardNav } from "../DashboardNavContext";
import { useGuest } from "../GuestContext";
import { useTheme } from "../ThemeContext";
import { BellIcon, BuildingIcon, ChatIcon, ChevronDownIcon, CloseIcon, LightbulbIcon, MenuIcon, MoonIcon, PlusIcon, SearchIcon, SunIcon } from "./icons";
import { Avatar } from "./ui";
import { colors, maxWidth, radius } from "../theme";
import { useMyStuff } from "../MyStuffContext";
import type { ResidentNotification } from "../types";

export function Header() {
  const navigate = useNavigate();
  const location = useLocation();
  const { count } = useMyStuff();
  const { user, loading: authLoading, refresh } = useAuth();
  const { email: guestEmail, resident, loading: guestLoading, refresh: refreshGuest } = useGuest();
  // Both contexts start with user/email/resident all null and only resolve
  // asynchronously (fetchMe()/fetchGuestSession()) — without checking their
  // loading flags, every full page load briefly rendered the signed-out nav
  // (hamburger icon instead of the avatar) for an already-authenticated
  // vendor/admin/resident, before flashing to the correct state once both
  // fetches resolved.
  const authResolved = !authLoading && !guestLoading;
  // Set only while an Admin/Vendor dashboard is mounted (see
  // DashboardNavContext) — that's what makes this burger admin/vendor-only
  // without Header needing to know about routes or tab lists itself.
  const { openNav } = useDashboardNav();
  const { resolvedTheme, setTheme } = useTheme();
  const [menuOpen, setMenuOpen] = useState(false);
  const [alerts, setAlerts] = useState(0);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  // Free Time Mode + nav restructure (Phase 9) — collapses the old flat
  // Community centres/Sports clubs/Join a game tabs into one "Explore"
  // dropdown, matching the target nav's intent-based grouping.
  const [exploreMenuOpen, setExploreMenuOpen] = useState(false);
  // Global Create hub (IA spec §1 audit) — desktop-only counterpart to
  // MobileTabBar.tsx's Create sheet, same three destinations. Book a
  // place/Join a game routes overlap with Explore's own, so only
  // Make It Happen is exclusive to this menu — moved out of the Explore
  // dropdown below to avoid two entry points for the same destination.
  const [createMenuOpen, setCreateMenuOpen] = useState(false);
  const accountMenuRef = useRef<HTMLDivElement>(null);
  const exploreMenuRef = useRef<HTMLDivElement>(null);
  const createMenuRef = useRef<HTMLDivElement>(null);

  // Resident notification bell (Tier 1) — previously these only lived
  // inside My Bookings > Notifications, easy to miss entirely.
  const [residentNotifs, setResidentNotifs] = useState<ResidentNotification[]>([]);
  const [notifOpen, setNotifOpen] = useState(false);
  const notifRef = useRef<HTMLDivElement>(null);
  const unreadNotifs = residentNotifs.filter((n) => !n.read).length;

  const loadResidentNotifs = () => {
    if (resident) fetchResidentNotifications().then(setResidentNotifs).catch(() => {});
  };

  // HelloCircle Manage (Phase 1) — a resident who has linked a vendor account
  // or organises a Circle gets those as switchable workspaces in this same
  // dropdown, instead of needing to sign in twice. Fetched for a pure
  // resident session (no vendor/admin session active), OR when the active
  // vendor/admin session's own linked resident IS this resident — i.e. this
  // browser has switched into its own linked Personal side, where both
  // cookies now legitimately coexist. Deliberately NOT fetched when `user`
  // and `resident` are simply two unrelated sessions coexisting by
  // coincidence (e.g. an admin who separately signed in as some resident) —
  // `user.residentId` only ever matches when the two are actually linked.
  // Bug found during manual testing: gating this on plain `!user` meant that
  // once a linked vendor ever switched to Personal, `user` never goes back to
  // null client-side (the vendor cookie is deliberately kept valid so you can
  // switch back) — so these entries would silently vanish forever afterward,
  // even across a hard reload, despite the resident session being genuinely
  // active.
  const samePerson = !user || user.residentId === resident?.id;
  const [workspaces, setWorkspaces] = useState<ManageWorkspaces | null>(null);
  useEffect(() => {
    if (resident && samePerson) fetchManageWorkspaces().then(setWorkspaces).catch(() => setWorkspaces(null));
    else setWorkspaces(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resident, user]);

  // Host MVP (Phase 3) — "any resident who's ever hosted" is cheap to derive
  // client-side from the existing hosted-only games list, so this doesn't add
  // a new field to GET /api/manage/workspaces's response.
  const [hasHostedGames, setHasHostedGames] = useState(false);
  useEffect(() => {
    if (resident && samePerson)
      fetchMyGames({ hostedOnly: true })
        .then((games) => setHasHostedGames(games.length > 0))
        .catch(() => setHasHostedGames(false));
    else setHasHostedGames(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resident, user]);

  const switchToVendor = async () => {
    setAccountMenuOpen(false);
    try {
      await switchWorkspace("vendor");
      // AuthProvider only fetches /api/auth/me once, at initial app load —
      // switching workspace mints a brand new vendor cookie without a page
      // reload, so nothing else would ever tell AuthContext's `user` state
      // about it. Without this, VendorDashboard.tsx mounts, sees the still-
      // stale `user` (null, from before this session existed) and bounces
      // straight back to /login.
      await refresh();
      navigate("/vendor");
    } catch {
      // Session mint failed (e.g. link was revoked) — fall back to a normal
      // vendor login rather than leaving the click silently do nothing.
      navigate("/login");
    }
  };

  // Reverse direction — a vendor session whose account is linked to a
  // resident switching to Personal. Always calls switchWorkspace first
  // (idempotent) rather than assuming a resident cookie already exists on
  // this browser/device — same "don't assume, verify" reasoning as
  // switchToVendor above, just mirrored.
  const switchToResident = async () => {
    setAccountMenuOpen(false);
    try {
      await switchWorkspace("resident");
      await refreshGuest();
      navigate("/bookings");
    } catch {
      navigate("/signin");
    }
  };

  useEffect(() => {
    setMenuOpen(false);
    setAccountMenuOpen(false);
    setNotifOpen(false);
    setExploreMenuOpen(false);
    setCreateMenuOpen(false);
  }, [location.pathname]);

  useEffect(loadResidentNotifs, [resident]);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) setNotifOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const handleNotifRead = async (id: number) => {
    await markResidentNotificationRead(id);
    setResidentNotifs((rows) => rows.map((n) => (n.id === id ? { ...n, read: 1 } : n)));
  };

  // Close the two header dropdowns on an outside click — they're popovers,
  // not the full-width mobile panel below, which already only opens via its
  // own toggle button.
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (accountMenuRef.current && !accountMenuRef.current.contains(e.target as Node)) setAccountMenuOpen(false);
      if (exploreMenuRef.current && !exploreMenuRef.current.contains(e.target as Node)) setExploreMenuOpen(false);
      if (createMenuRef.current && !createMenuRef.current.contains(e.target as Node)) setCreateMenuOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  useEffect(() => {
    if (user?.role === "admin") {
      fetchAdminPendingListings()
        .then((data) => setAlerts(data.centres.length + data.clubs.length))
        .catch(() => setAlerts(0));
    } else if (user?.role === "vendor" && user.status === "approved") {
      fetchVendorListings()
        .then((data) => {
          const needsAttention = (rows: { status: string }[]) => rows.filter((r) => r.status === "pending" || r.status === "rejected").length;
          setAlerts(needsAttention(data.centres) + needsAttention(data.clubs));
        })
        .catch(() => setAlerts(0));
    } else {
      setAlerts(0);
    }
  }, [user, location.pathname]);

  const isActive = (prefixes: string[]) => prefixes.some((p) => location.pathname.startsWith(p));

  const go = (path: string) => {
    setMenuOpen(false);
    navigate(path);
  };

  const doLogout = async () => {
    setMenuOpen(false);
    await logout();
    await refresh();
    navigate("/");
  };

  const doGuestLogout = async () => {
    setMenuOpen(false);
    await guestLogout();
    await refreshGuest();
    navigate("/");
  };

  const navBtn: React.CSSProperties = {
    background: "none",
    border: "none",
    padding: "8px 13px",
    borderRadius: radius.control,
    fontSize: 15,
    fontWeight: 500,
    color: "#3B423C",
    cursor: "pointer",
  };
  const mobileNavBtn: React.CSSProperties = {
    ...navBtn,
    textAlign: "left",
    padding: "12px 6px",
    fontSize: 16,
    width: "100%",
  };

  const circleBtnStyle: React.CSSProperties = {
    width: 40,
    height: 40,
    borderRadius: "50%",
    border: `1px solid ${colors.borderStrong}`,
    background: colors.surface,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flex: "none",
  };
  const dropdownStyle: React.CSSProperties = {
    position: "absolute",
    top: "calc(100% + 10px)",
    right: 0,
    zIndex: 60,
    minWidth: 200,
    background: colors.surface,
    border: `1px solid ${colors.border}`,
    borderRadius: 14,
    boxShadow: "0 16px 36px rgba(30,40,32,.14)",
    padding: 8,
  };
  const dropdownLabelStyle: React.CSSProperties = {
    padding: "8px 12px 4px",
    fontSize: 12,
    fontWeight: 700,
    color: colors.muted,
    textTransform: "uppercase",
    letterSpacing: ".04em",
  };
  const dropdownItemStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    width: "100%",
    background: "none",
    border: "none",
    borderRadius: radius.control,
    padding: "10px 12px",
    fontSize: 14.5,
    fontWeight: 600,
    color: colors.text,
    textAlign: "left",
    cursor: "pointer",
  };
  const dropdownDividerStyle: React.CSSProperties = { borderTop: `1px solid ${colors.border}`, margin: "6px 4px" };
  const countBadgeStyle: React.CSSProperties = {
    background: colors.green,
    color: "#fff",
    borderRadius: 20,
    fontSize: 11,
    fontWeight: 700,
    padding: "1px 7px",
    flex: "none",
  };

  return (
    <header
      style={{
        position: "sticky",
        top: 0,
        zIndex: 50,
        background: colors.headerBg,
        backdropFilter: "blur(12px)",
        borderBottom: `1px solid ${colors.border}`,
        // Notch/status-bar clearance — resolves to 0 on web/non-notched
        // devices, same env(safe-area-inset-*) pattern index.css already
        // uses for the mobile bottom tab bar's bottom inset.
        paddingTop: "env(safe-area-inset-top)",
      }}
    >
      <div
        style={{
          maxWidth,
          margin: "0 auto",
          padding: "14px 24px",
          display: "flex",
          alignItems: "center",
          gap: 26,
        }}
      >
        {openNav && (
          <button
            onClick={openNav}
            aria-label="Open dashboard menu"
            // Phase 5 polish — hidden at the same <=860px breakpoint that
            // swaps in .mobile-menu-btn below, so a ManageShell page never
            // shows two hamburger-style buttons at once on mobile. The
            // ManageShell sidebar stays reachable there via a "Dashboard
            // menu" entry at the top of that mobile menu panel instead.
            className="dashboard-nav-btn"
            style={{
              width: 38,
              height: 38,
              borderRadius: radius.control,
              border: `1px solid ${colors.borderStrong}`,
              background: colors.surface,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              flex: "none",
            }}
          >
            <MenuIcon size={17} />
          </button>
        )}
        <div
          onClick={() => go("/")}
          style={{ display: "flex", alignItems: "center", gap: 9, cursor: "pointer" }}
        >
          <img src="/illustrations/Logo.svg" alt="Hello Circle" style={{ height: 36, flex: "none" }} />
        </div>
        <nav className="desktop-nav" style={{ display: "flex", alignItems: "center", gap: 2, marginLeft: 8 }}>
          <div ref={exploreMenuRef} style={{ position: "relative" }}>
            <button
              className="tab-btn"
              style={
                isActive(["/browse/centres", "/centres/", "/browse/clubs", "/clubs/", "/games", "/adventures", "/experiences"])
                  ? { ...navBtn, background: colors.greenBg, color: colors.greenText, fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 4 }
                  : { ...navBtn, display: "inline-flex", alignItems: "center", gap: 4 }
              }
              onClick={() => setExploreMenuOpen((o) => !o)}
            >
              Explore <ChevronDownIcon size={13} style={{ transform: exploreMenuOpen ? "rotate(180deg)" : "none", transition: "transform .15s ease" }} />
            </button>
            {exploreMenuOpen && (
              <div className="pop-in" style={dropdownStyle}>
                <button className="dropdown-item" style={dropdownItemStyle} onClick={() => go("/browse/centres")}>
                  Community centres
                </button>
                <button className="dropdown-item" style={dropdownItemStyle} onClick={() => go("/browse/clubs")}>
                  Sports clubs
                </button>
                <button className="dropdown-item" style={dropdownItemStyle} onClick={() => go("/games")}>
                  Join a game
                </button>
                <button className="dropdown-item" style={dropdownItemStyle} onClick={() => go("/adventures")}>
                  Adventures
                </button>
                <button className="dropdown-item" style={dropdownItemStyle} onClick={() => go("/experiences")}>
                  Experiences
                </button>
              </div>
            )}
          </div>
          <button
            className="tab-btn"
            style={isActive(["/circles"]) ? { ...navBtn, background: colors.greenBg, color: colors.greenText, fontWeight: 700 } : navBtn}
            onClick={() => go("/circles")}
          >
            Circles
          </button>
          <button
            className="tab-btn"
            style={isActive(["/bookings"]) ? { ...navBtn, background: colors.greenBg, color: colors.greenText, fontWeight: 700 } : navBtn}
            onClick={() => go("/bookings")}
          >
            My Life
          </button>
          <button
            className="tab-btn hide-tablet"
            style={isActive(["/ask"]) ? { ...navBtn, background: colors.greenBg, color: colors.greenText, fontWeight: 700 } : navBtn}
            onClick={() => go("/ask")}
          >
            Ask HelloCircle
          </button>
          <button
            className="tab-btn hide-tablet"
            style={isActive(["/for-venues"]) ? { ...navBtn, background: colors.greenBg, color: colors.greenText, fontWeight: 700 } : navBtn}
            onClick={() => go("/for-venues")}
          >
            For venues
          </button>
        </nav>
        <div className="desktop-actions" style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
          <button
            className="btn btn-ghost"
            onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
            aria-label={resolvedTheme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            title={resolvedTheme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            style={circleBtnStyle}
          >
            {resolvedTheme === "dark" ? <SunIcon size={17} /> : <MoonIcon size={17} />}
          </button>
          <button
            className="btn btn-ghost"
            onClick={() => go("/explore?focus=1")}
            aria-label="Search"
            title="Search"
            style={isActive(["/explore"]) ? { ...circleBtnStyle, background: colors.greenBg, borderColor: colors.green } : circleBtnStyle}
          >
            <SearchIcon size={17} />
          </button>
          <div ref={createMenuRef} style={{ position: "relative" }}>
            <button
              className="btn btn-ghost"
              onClick={() => setCreateMenuOpen((o) => !o)}
              aria-label="Create"
              title="Create"
              style={isActive(["/make-it-happen"]) ? { ...circleBtnStyle, background: colors.greenBg, borderColor: colors.green } : circleBtnStyle}
            >
              <PlusIcon size={18} />
            </button>
            {createMenuOpen && (
              <div className="pop-in" style={dropdownStyle}>
                <div style={dropdownLabelStyle}>Create</div>
                <button className="dropdown-item" style={dropdownItemStyle} onClick={() => go("/browse/centres")}>
                  Book a place
                </button>
                <button className="dropdown-item" style={dropdownItemStyle} onClick={() => go("/games")}>
                  Start a game
                </button>
                <button className="dropdown-item" style={dropdownItemStyle} onClick={() => go("/make-it-happen")}>
                  Make It Happen
                </button>
                <button className="dropdown-item" style={dropdownItemStyle} onClick={() => go("/suggest-place")}>
                  Suggest a place
                </button>
              </div>
            )}
          </div>
          <button
            className="btn btn-ghost hide-tablet"
            onClick={() => go("/free-time")}
            aria-label="Free Time Mode"
            title="Free Time Mode"
            style={isActive(["/free-time"]) ? { ...circleBtnStyle, background: colors.orangeBg, borderColor: colors.orange } : circleBtnStyle}
          >
            <LightbulbIcon size={17} style={{ color: colors.orange }} />
          </button>

          {/* A resident session also gets its own bell just below — when both
              exist (a vendor/admin linked to their own resident identity),
              showing two identical, unlabeled bell icons read as a bug, not
              two real notification streams. That bell's dropdown carries a
              "Business notifications" link instead, so this one only ever
              renders standalone. */}
          {user && (user.role === "admin" || user.role === "vendor") && !resident && (
            <button
              className="btn btn-ghost"
              onClick={() => navigate(user.role === "admin" ? "/admin?tab=pending" : "/vendor?tab=messages")}
              aria-label="Notifications"
              style={{ ...circleBtnStyle, position: "relative" }}
            >
              <BellIcon size={17} />
              {alerts > 0 && (
                <span
                  style={{
                    position: "absolute",
                    top: -3,
                    right: -3,
                    background: colors.orange,
                    color: "#fff",
                    borderRadius: radius.pill,
                    fontSize: 10,
                    fontWeight: 700,
                    minWidth: 16,
                    height: 16,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    padding: "0 3px",
                  }}
                >
                  {alerts}
                </span>
              )}
            </button>
          )}

          {resident && (
            <div ref={notifRef} style={{ position: "relative" }}>
              <button
                className="btn btn-ghost"
                onClick={() => setNotifOpen((o) => !o)}
                aria-label="Notifications"
                style={circleBtnStyle}
              >
                <BellIcon size={17} />
                {unreadNotifs > 0 && (
                  <span
                    style={{
                      position: "absolute",
                      top: -3,
                      right: -3,
                      background: colors.orange,
                      color: "#fff",
                      borderRadius: radius.pill,
                      fontSize: 10,
                      fontWeight: 700,
                      minWidth: 16,
                      height: 16,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      padding: "0 3px",
                    }}
                  >
                    {unreadNotifs}
                  </span>
                )}
              </button>
              {notifOpen && (
                <div className="pop-in" style={{ ...dropdownStyle, minWidth: 300, maxHeight: 360, overflowY: "auto" }}>
                  <div style={dropdownLabelStyle}>Notifications</div>
                  {user && (user.role === "admin" || user.role === "vendor") && (
                    <button
                      className="dropdown-item"
                      style={dropdownItemStyle}
                      onClick={() => {
                        setNotifOpen(false);
                        navigate(user.role === "admin" ? "/admin?tab=pending" : "/vendor?tab=messages");
                      }}
                    >
                      Business notifications
                      {alerts > 0 && <span style={{ ...countBadgeStyle, background: colors.orange }}>{alerts}</span>}
                    </button>
                  )}
                  {residentNotifs.length === 0 ? (
                    <div style={{ padding: "16px 12px", fontSize: 13.5, color: colors.mutedLight }}>Nothing yet.</div>
                  ) : (
                    residentNotifs.slice(0, 8).map((n) => (
                      <button
                        key={n.id}
                        onClick={() => {
                          if (!n.read) handleNotifRead(n.id);
                          setNotifOpen(false);
                          navigate("/bookings");
                        }}
                        style={{
                          display: "block",
                          width: "100%",
                          textAlign: "left",
                          background: n.read ? "none" : colors.greenBg,
                          border: "none",
                          borderRadius: radius.control,
                          padding: "10px 12px",
                          cursor: "pointer",
                          marginBottom: 2,
                        }}
                      >
                        <div style={{ fontSize: 13.5, fontWeight: 700, color: colors.text }}>{n.title}</div>
                        <div style={{ fontSize: 12.5, color: colors.mutedLight, marginTop: 2 }}>{n.body}</div>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
          )}

          <div ref={accountMenuRef} style={{ position: "relative" }}>
            <button
              className="btn btn-ghost"
              onClick={() => setAccountMenuOpen((o) => !o)}
              aria-label="Menu"
              style={
                user
                  ? { display: "flex", alignItems: "center", gap: 4, border: "none", background: "none", cursor: "pointer", padding: 0 }
                  : circleBtnStyle
              }
            >
              {!authResolved ? (
                // Neutral placeholder, same footprint as the hamburger icon
                // below — avoids asserting "signed out" before the session
                // fetch has actually resolved.
                <div style={{ width: 17, height: 17 }} />
              ) : user ? (
                <>
                  <Avatar name={user.name} size={36} />
                  <ChevronDownIcon size={15} style={{ color: colors.muted }} />
                </>
              ) : (
                <MenuIcon size={17} />
              )}
            </button>
            {accountMenuOpen && (
              <div className="pop-in" style={{ ...dropdownStyle, minWidth: 240 }}>
                {!user && guestEmail && <div style={dropdownLabelStyle}>Signed in as {guestEmail}</div>}
                <button
                  className="dropdown-item"
                  style={dropdownItemStyle}
                  onClick={() => {
                    setAccountMenuOpen(false);
                    go("/bookings");
                  }}
                >
                  My Life
                  {count > 0 && <span style={countBadgeStyle}>{count}</span>}
                </button>

                {user && (user.role === "admin" || user.role === "vendor") && (
                  <button
                    className="dropdown-item"
                    style={dropdownItemStyle}
                    onClick={() => {
                      setAccountMenuOpen(false);
                      go(user.role === "admin" ? "/admin" : "/vendor");
                    }}
                  >
                    {user.role === "admin" ? "Admin dashboard" : "Vendor dashboard"}
                    {alerts > 0 && <span style={{ ...countBadgeStyle, background: colors.orange }}>{alerts}</span>}
                  </button>
                )}

                {/* HelloCircle Manage (Phase 1) workspace switcher — only
                    ever shows capabilities this account actually has. The
                    "My Life" button above already covers Personal for a
                    resident session; this covers the reverse — a vendor
                    session whose account is linked to a resident. */}
                {user?.role === "vendor" && user.residentId && (
                  <button className="dropdown-item" style={dropdownItemStyle} onClick={switchToResident}>
                    Personal
                  </button>
                )}
                {/* A Host who opened a provider account via /become-provider
                    sits at status 'pending' until admin approves — requireVendor
                    403s every /vendor/* route until then, so show the state
                    rather than a switch that lands on an empty dashboard. */}
                {workspaces?.vendor &&
                  (workspaces.vendor.status === "approved" ? (
                    <button className="dropdown-item" style={dropdownItemStyle} onClick={switchToVendor}>
                      {workspaces.vendor.businessName || "Vendor dashboard"}
                    </button>
                  ) : (
                    <div style={{ ...dropdownItemStyle, color: colors.mutedLight, cursor: "default", fontSize: 12.5 }}>
                      {workspaces.vendor.businessName || "Provider account"} — awaiting approval
                    </div>
                  ))}
                {hasHostedGames && (
                  <button
                    className="dropdown-item"
                    style={dropdownItemStyle}
                    onClick={() => {
                      setAccountMenuOpen(false);
                      go("/manage/activities");
                    }}
                  >
                    Activities
                  </button>
                )}
                {workspaces?.circlesOrganising.map((c) => (
                  <button
                    key={c.id}
                    className="dropdown-item"
                    style={dropdownItemStyle}
                    onClick={() => {
                      setAccountMenuOpen(false);
                      go(`/manage/circles/${c.slug ?? c.id}`);
                    }}
                  >
                    Manage {c.name}
                  </button>
                ))}

                <div style={dropdownDividerStyle} />

                {user ? (
                  <button
                    className="dropdown-item"
                    style={dropdownItemStyle}
                    onClick={() => {
                      setAccountMenuOpen(false);
                      doLogout();
                    }}
                  >
                    Log out
                  </button>
                ) : guestEmail ? (
                  <>
                    <button
                      className="dropdown-item"
                      style={dropdownItemStyle}
                      onClick={() => {
                        setAccountMenuOpen(false);
                        doGuestLogout();
                      }}
                    >
                      Sign out
                    </button>
                    <button
                      className="dropdown-item"
                      style={dropdownItemStyle}
                      onClick={() => {
                        setAccountMenuOpen(false);
                        go("/for-venues");
                      }}
                    >
                      List your venue
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      className="dropdown-item"
                      style={dropdownItemStyle}
                      onClick={() => {
                        setAccountMenuOpen(false);
                        go("/signin");
                      }}
                    >
                      Sign in
                    </button>
                    <button
                      className="dropdown-item"
                      style={dropdownItemStyle}
                      onClick={() => {
                        setAccountMenuOpen(false);
                        go("/login");
                      }}
                    >
                      Vendor / admin login
                    </button>
                    <button
                      className="dropdown-item"
                      style={dropdownItemStyle}
                      onClick={() => {
                        setAccountMenuOpen(false);
                        go("/for-venues");
                      }}
                    >
                      List your venue
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        </div>

        <button
          className="mobile-menu-btn btn btn-ghost"
          onClick={() => setMenuOpen((o) => !o)}
          aria-label="Toggle menu"
          style={{
            marginLeft: "auto",
            width: 40,
            height: 40,
            borderRadius: 11,
            border: `1px solid ${colors.borderStrong}`,
            background: colors.surface,
            alignItems: "center",
            justifyContent: "center",
            flex: "none",
          }}
        >
          {menuOpen ? <CloseIcon size={18} /> : <MenuIcon size={18} />}
        </button>
      </div>

      {menuOpen && (
        <div
          className="pop-in"
          style={{
            borderTop: `1px solid ${colors.border}`,
            background: colors.bg,
            padding: "10px 20px 20px",
          }}
        >
          {/* HelloCircle Manage Phase 5 — the single mobile entry point for
              the ManageShell sidebar (Bookings/Activities/Circle tabs etc.)
              at <=860px, replacing the second hamburger .dashboard-nav-btn
              would otherwise render alongside this menu's own toggle. */}
          {openNav && (
            <>
              <div style={{ ...dropdownLabelStyle, padding: "2px 6px 2px" }}>Manage</div>
              <button
                style={{ ...mobileNavBtn, display: "flex", alignItems: "center", gap: 8 }}
                onClick={() => {
                  setMenuOpen(false);
                  openNav();
                }}
              >
                <MenuIcon size={16} /> Dashboard menu
              </button>
            </>
          )}
          {/* Primary destinations (Community centres/Sports clubs/Join a
              game/Adventures/Experiences/Circles/My Life) moved to the
              persistent mobile bottom tab bar (see MobileTabBar.tsx) — this
              drawer now only holds what the bottom bar doesn't cover:
              secondary actions and account/auth. Grouped by intent (UI/UX
              plan phase 4). */}
          <div style={{ ...dropdownLabelStyle, padding: "2px 6px 2px" }}>Not sure yet?</div>
          <button style={{ ...mobileNavBtn, display: "flex", alignItems: "center", gap: 8 }} onClick={() => go("/explore?focus=1")}>
            <SearchIcon size={16} /> Search
          </button>
          <button style={{ ...mobileNavBtn, display: "flex", alignItems: "center", gap: 8 }} onClick={() => go("/free-time")}>
            <LightbulbIcon size={16} /> Free Time Mode
          </button>
          <button style={{ ...mobileNavBtn, display: "flex", alignItems: "center", gap: 8 }} onClick={() => go("/ask")}>
            <ChatIcon size={16} /> Ask HelloCircle
          </button>
          <button style={{ ...mobileNavBtn, display: "flex", alignItems: "center", gap: 8 }} onClick={() => go("/for-venues")}>
            <BuildingIcon size={16} /> For venues
          </button>

          <div style={{ ...dropdownLabelStyle, padding: "10px 6px 2px" }}>You</div>
          {resident && (
            <button style={{ ...mobileNavBtn, display: "flex", alignItems: "center", gap: 8 }} onClick={() => go("/bookings")}>
              <BellIcon size={16} /> Notifications{unreadNotifs > 0 ? ` (${unreadNotifs})` : ""}
            </button>
          )}
          <button
            style={{ ...mobileNavBtn, display: "flex", alignItems: "center", gap: 8 }}
            onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
          >
            {resolvedTheme === "dark" ? <SunIcon size={16} /> : <MoonIcon size={16} />}
            {resolvedTheme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          </button>
          <div style={{ borderTop: `1px solid ${colors.border}`, margin: "8px 0" }} />
          {user ? (
            <>
              {(user.role === "admin" || (user.role === "vendor" && user.status === "approved")) && (
                <button style={{ ...mobileNavBtn, display: "flex", alignItems: "center", gap: 8 }} onClick={() => go(user.role === "admin" ? "/admin" : "/vendor")}>
                  <BellIcon size={16} /> Notifications{alerts > 0 ? ` (${alerts})` : ""}
                </button>
              )}
              <button style={{ ...mobileNavBtn, color: colors.greenText, fontWeight: 700 }} onClick={() => go(user.role === "admin" ? "/admin" : "/vendor")}>
                {user.role === "admin" ? "Admin dashboard" : "Vendor dashboard"}
              </button>
              <button style={mobileNavBtn} onClick={doLogout}>
                Log out
              </button>
            </>
          ) : guestEmail ? (
            <>
              <div style={{ padding: "6px 6px 2px", fontSize: 13, color: colors.muted }}>
                Signed in as <strong>{guestEmail}</strong>
              </div>
              <button style={mobileNavBtn} onClick={doGuestLogout}>
                Sign out
              </button>
              <button style={mobileNavBtn} onClick={() => go("/for-venues")}>
                List your venue
              </button>
            </>
          ) : (
            <>
              <button style={{ ...mobileNavBtn, color: colors.greenText, fontWeight: 700 }} onClick={() => go("/signin")}>
                Sign in
              </button>
              <button style={mobileNavBtn} onClick={() => go("/login")}>
                Vendor / admin login
              </button>
              <button style={mobileNavBtn} onClick={() => go("/for-venues")}>
                List your venue
              </button>
            </>
          )}
        </div>
      )}
    </header>
  );
}
