import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { fetchAdminPendingListings, fetchVendorListings, logout } from "../api";
import { useAuth } from "../AuthContext";
import { BellIcon, CloseIcon, LogoMark, MenuIcon } from "./icons";
import { colors, fonts, maxWidth } from "../theme";
import { useMyStuff } from "../MyStuffContext";

export function Header() {
  const navigate = useNavigate();
  const location = useLocation();
  const { count } = useMyStuff();
  const { user, refresh } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const [alerts, setAlerts] = useState(0);

  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

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
          <button
            className="tab-btn"
            style={isActive(["/checklist"]) ? { ...navBtn, background: colors.panel, color: colors.text, fontWeight: 700 } : navBtn}
            onClick={() => go("/checklist")}
          >
            New to Ireland
          </button>
        </nav>
        <div className="desktop-actions" style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
          <button
            className="btn btn-ghost"
            onClick={() => go("/bookings")}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              background: "#fff",
              color: colors.text,
              border: `1px solid ${colors.borderStrong}`,
              borderRadius: 11,
              padding: "9px 15px",
              fontSize: 14,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            My bookings{" "}
            <span
              style={{
                background: colors.green,
                color: "#fff",
                borderRadius: 20,
                fontSize: 11,
                fontWeight: 700,
                padding: "1px 7px",
                transition: "transform .15s ease",
              }}
            >
              {count}
            </span>
          </button>
          {user ? (
            <>
              {(user.role === "admin" || (user.role === "vendor" && user.status === "approved")) && (
                <button
                  className="btn btn-ghost"
                  onClick={() => go(user.role === "admin" ? "/admin" : "/vendor")}
                  aria-label="Notifications"
                  style={{
                    position: "relative",
                    width: 38,
                    height: 38,
                    borderRadius: "50%",
                    border: `1px solid ${colors.borderStrong}`,
                    background: "#fff",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <BellIcon size={17} />
                  {alerts > 0 && (
                    <span
                      style={{
                        position: "absolute",
                        top: -4,
                        right: -4,
                        background: colors.orange,
                        color: "#fff",
                        borderRadius: 20,
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
              <button
                className="tab-btn"
                onClick={() => go(user.role === "admin" ? "/admin" : "/vendor")}
                style={{ ...navBtn, background: colors.greenBg, color: colors.greenText, fontWeight: 700 }}
              >
                {user.role === "admin" ? "Admin dashboard" : "Vendor dashboard"}
              </button>
              <button className="tab-btn" onClick={doLogout} style={navBtn}>
                Log out
              </button>
            </>
          ) : (
            <button
              className="btn btn-ghost"
              onClick={() => go("/login")}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                background: "#fff",
                color: colors.text,
                border: `1px solid ${colors.borderStrong}`,
                borderRadius: 11,
                padding: "9px 15px",
                fontSize: 14,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Login
            </button>
          )}
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
          <button style={mobileNavBtn} onClick={() => go("/checklist")}>
            New to Ireland
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
            <button style={{ ...mobileNavBtn, color: colors.greenText, fontWeight: 700 }} onClick={() => go("/login")}>
              Vendor / admin login
            </button>
          )}
        </div>
      )}
    </header>
  );
}
