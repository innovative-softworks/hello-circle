import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { fetchAdminPendingListings, fetchCentres, fetchVendorListings, logout } from "../api";
import { useAuth } from "../AuthContext";
import { BellIcon, CloseIcon, LogoMark, MenuIcon, PinIcon } from "./icons";
import { colors, fonts, maxWidth } from "../theme";
import { useMyStuff } from "../MyStuffContext";

export function Header() {
  const navigate = useNavigate();
  const location = useLocation();
  const { count } = useMyStuff();
  const { user, refresh } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const [alerts, setAlerts] = useState(0);
  const [countyMenuOpen, setCountyMenuOpen] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [counties, setCounties] = useState<string[]>([]);
  const countyMenuRef = useRef<HTMLDivElement>(null);
  const accountMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMenuOpen(false);
    setCountyMenuOpen(false);
    setAccountMenuOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    fetchCentres().then((centres) => {
      setCounties(Array.from(new Set(centres.map((c) => c.county).filter(Boolean))).sort((a, b) => a.localeCompare(b)));
    });
  }, []);

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
        <div
          onClick={() => go("/")}
          style={{ display: "flex", alignItems: "center", gap: 9, cursor: "pointer" }}
        >
          <LogoMark size={31} style={{ flex: "none" }} />
          <span style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 21, letterSpacing: "-.015em" }}>
            Hello Circle
          </span>
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

          <div ref={accountMenuRef} style={{ position: "relative" }}>
            <button
              className="btn btn-ghost"
              onClick={() => setAccountMenuOpen((o) => !o)}
              aria-label="Menu"
              style={circleBtnStyle}
            >
              <MenuIcon size={17} />
            </button>
            {accountMenuOpen && (
              <div className="pop-in" style={{ ...dropdownStyle, minWidth: 240 }}>
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
          <button style={mobileNavBtn} onClick={() => go("/bookings")}>
            My bookings ({count})
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
