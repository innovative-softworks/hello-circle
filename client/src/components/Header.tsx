import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { fetchAdminPendingListings, fetchCentres, fetchResidentNotifications, fetchVendorListings, guestLogout, logout, markResidentNotificationRead } from "../api";
import { useAuth } from "../AuthContext";
import { useDashboardNav } from "../DashboardNavContext";
import { useGuest } from "../GuestContext";
import { BellIcon, ChevronDownIcon, CloseIcon, MenuIcon, PinIcon } from "./icons";
import { Avatar } from "./ui";
import { colors, maxWidth } from "../theme";
import { useMyStuff } from "../MyStuffContext";
import type { ResidentNotification } from "../types";

export function Header() {
  const navigate = useNavigate();
  const location = useLocation();
  const { count } = useMyStuff();
  const { user, refresh } = useAuth();
  const { email: guestEmail, resident, refresh: refreshGuest } = useGuest();
  // Set only while an Admin/Vendor dashboard is mounted (see
  // DashboardNavContext) — that's what makes this burger admin/vendor-only
  // without Header needing to know about routes or tab lists itself.
  const { openNav } = useDashboardNav();
  const [menuOpen, setMenuOpen] = useState(false);
  const [alerts, setAlerts] = useState(0);
  const [countyMenuOpen, setCountyMenuOpen] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [counties, setCounties] = useState<string[]>([]);
  const countyMenuRef = useRef<HTMLDivElement>(null);
  const accountMenuRef = useRef<HTMLDivElement>(null);

  // Resident notification bell (Tier 1) — previously these only lived
  // inside My Bookings > Notifications, easy to miss entirely.
  const [residentNotifs, setResidentNotifs] = useState<ResidentNotification[]>([]);
  const [notifOpen, setNotifOpen] = useState(false);
  const notifRef = useRef<HTMLDivElement>(null);
  const unreadNotifs = residentNotifs.filter((n) => !n.read).length;

  const loadResidentNotifs = () => {
    if (resident) fetchResidentNotifications().then(setResidentNotifs).catch(() => {});
  };

  useEffect(() => {
    setMenuOpen(false);
    setCountyMenuOpen(false);
    setAccountMenuOpen(false);
    setNotifOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    fetchCentres().then((centres) => {
      setCounties(Array.from(new Set(centres.map((c) => c.county).filter(Boolean))).sort((a, b) => a.localeCompare(b)));
    });
  }, []);

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
      if (countyMenuRef.current && !countyMenuRef.current.contains(e.target as Node)) setCountyMenuOpen(false);
      if (accountMenuRef.current && !accountMenuRef.current.contains(e.target as Node)) setAccountMenuOpen(false);
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
    borderRadius: 10,
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
    background: "#fff",
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
    background: "#fff",
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
    borderRadius: 10,
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
        background: "rgba(251,250,247,.86)",
        backdropFilter: "blur(12px)",
        borderBottom: `1px solid ${colors.border}`,
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
            style={{
              width: 38,
              height: 38,
              borderRadius: 10,
              border: `1px solid ${colors.borderStrong}`,
              background: "#fff",
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
        <nav className="desktop-nav" style={{ display: "flex", gap: 2, marginLeft: 8 }}>
          <button
            className="tab-btn"
            style={
              isActive(["/browse/centres", "/centres/"])
                ? { ...navBtn, background: colors.greenBg, color: colors.greenText, fontWeight: 700 }
                : navBtn
            }
            onClick={() => go("/browse/centres")}
          >
            Community centres
          </button>
          <button
            className="tab-btn"
            style={
              isActive(["/browse/clubs", "/clubs/"])
                ? { ...navBtn, background: colors.orangeBg, color: colors.orangeDark, fontWeight: 700 }
                : navBtn
            }
            onClick={() => go("/browse/clubs")}
          >
            Sports clubs
          </button>
          <button
            className="tab-btn"
            style={isActive(["/games"]) ? { ...navBtn, background: colors.greenBg, color: colors.greenText, fontWeight: 700 } : navBtn}
            onClick={() => go("/games")}
          >
            Join a game
          </button>
          <button
            className="tab-btn"
            style={isActive(["/circles"]) ? { ...navBtn, background: colors.greenBg, color: colors.greenText, fontWeight: 700 } : navBtn}
            onClick={() => go("/circles")}
          >
            Circles
          </button>
        </nav>
        <div className="desktop-actions" style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
          <div ref={countyMenuRef} style={{ position: "relative" }}>
            <button
              className="btn btn-ghost"
              onClick={() => setCountyMenuOpen((o) => !o)}
              aria-label="Browse by county"
              style={circleBtnStyle}
            >
              <PinIcon size={17} />
            </button>
            {countyMenuOpen && (
              <div className="pop-in" style={{ ...dropdownStyle, maxHeight: 320, overflowY: "auto" }}>
                <div style={dropdownLabelStyle}>Browse by county</div>
                <button
                  className="dropdown-item"
                  style={dropdownItemStyle}
                  onClick={() => {
                    setCountyMenuOpen(false);
                    navigate("/browse/centres");
                  }}
                >
                  All counties
                </button>
                {counties.map((c) => (
                  <button
                    key={c}
                    className="dropdown-item"
                    style={dropdownItemStyle}
                    onClick={() => {
                      setCountyMenuOpen(false);
                      navigate(`/browse/centres?county=${encodeURIComponent(c)}`);
                    }}
                  >
                    {c}
                  </button>
                ))}
              </div>
            )}
          </div>

          {user && (user.role === "admin" || user.role === "vendor") && (
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
                    borderRadius: 999,
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
                      borderRadius: 999,
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
                          borderRadius: 10,
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
              {user ? (
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
                  My bookings
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
                        go("/vendor/signup");
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
                        go("/login");
                      }}
                    >
                      Login
                    </button>
                    <button
                      className="dropdown-item"
                      style={dropdownItemStyle}
                      onClick={() => {
                        setAccountMenuOpen(false);
                        go("/vendor/signup");
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
            background: "#fff",
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
          <button style={mobileNavBtn} onClick={() => go("/browse/centres")}>
            Community centres
          </button>
          <button style={mobileNavBtn} onClick={() => go("/browse/clubs")}>
            Sports clubs
          </button>
          <button style={mobileNavBtn} onClick={() => go("/games")}>
            Join a game
          </button>
          <button style={mobileNavBtn} onClick={() => go("/circles")}>
            Circles
          </button>
          <button style={mobileNavBtn} onClick={() => go("/bookings")}>
            My bookings ({count})
          </button>
          {resident && (
            <button style={{ ...mobileNavBtn, display: "flex", alignItems: "center", gap: 8 }} onClick={() => go("/bookings")}>
              <BellIcon size={16} /> Notifications{unreadNotifs > 0 ? ` (${unreadNotifs})` : ""}
            </button>
          )}
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
              <button style={mobileNavBtn} onClick={() => go("/vendor/signup")}>
                List your venue
              </button>
            </>
          ) : (
            <>
              <button style={{ ...mobileNavBtn, color: colors.greenText, fontWeight: 700 }} onClick={() => go("/login")}>
                Vendor / admin login
              </button>
              <button style={mobileNavBtn} onClick={() => go("/vendor/signup")}>
                List your venue
              </button>
            </>
          )}
        </div>
      )}
    </header>
  );
}
