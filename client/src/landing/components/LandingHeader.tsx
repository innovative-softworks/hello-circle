import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CloseIcon, MenuIcon } from "../../components/icons";
import { lc, lcFonts, lcMaxWidth, lcRadius } from "../theme";

const NAV_LINKS = [
  { label: "Explore", href: "/explore" },
  { label: "Activities", href: "/games" },
  { label: "Circles", href: "/circles" },
  { label: "Places", href: "/browse/centres" },
  { label: "How it Works", href: "#how-it-works" },
];

export function LandingHeader() {
  const navigate = useNavigate();
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const go = (href: string) => {
    setMenuOpen(false);
    if (href.startsWith("#")) {
      document.querySelector(href)?.scrollIntoView({ behavior: "smooth" });
    } else {
      navigate(href);
    }
  };

  return (
    <header
      className={`lc-header${scrolled ? " lc-scrolled" : ""}`}
      style={{ background: scrolled ? "rgba(250, 248, 242, 0.92)" : "transparent", backdropFilter: scrolled ? "blur(10px)" : undefined }}
    >
      <div style={{ maxWidth: lcMaxWidth, margin: "0 auto", padding: "16px 24px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <button onClick={() => go("/landing")} style={{ background: "none", border: "none", display: "flex", alignItems: "center", gap: 9 }}>
          <span style={{ width: 30, height: 30, borderRadius: 9, background: lc.forest, display: "flex", alignItems: "center", justifyContent: "center", color: lc.white, fontFamily: lcFonts.display, fontWeight: 800, fontSize: 15 }}>
            H
          </span>
          <span style={{ fontFamily: lcFonts.display, fontWeight: 800, fontSize: 18, color: lc.ink }}>HelloCircle</span>
        </button>

        <nav className="lc-header-desktop-only" style={{ display: "flex", alignItems: "center", gap: 30 }}>
          {NAV_LINKS.map((link) => (
            <button key={link.label} className="lc-nav-link" onClick={() => go(link.href)} style={{ background: "none", border: "none", color: lc.ink }}>
              {link.label}
            </button>
          ))}
        </nav>

        <div className="lc-header-desktop-only" style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <button onClick={() => go("/login")} style={{ background: "none", border: "none", fontWeight: 600, fontSize: 14.5, color: lc.ink }}>
            Log in
          </button>
          <button className="lc-btn" style={{ background: lc.forest, color: lc.white }} onClick={() => go("/explore")}>
            Explore near you
          </button>
        </div>

        <button
          onClick={() => setMenuOpen((v) => !v)}
          aria-label={menuOpen ? "Close menu" : "Open menu"}
          style={{ display: "none", background: "none", border: "none", color: lc.ink }}
          className="lc-header-menu-btn"
        >
          {menuOpen ? <CloseIcon size={22} /> : <MenuIcon size={22} />}
        </button>
      </div>

      {menuOpen && (
        <div style={{ background: lc.paper, borderTop: `1px solid ${lc.line}`, padding: "16px 24px 24px", display: "flex", flexDirection: "column", gap: 4 }}>
          {NAV_LINKS.map((link) => (
            <button key={link.label} onClick={() => go(link.href)} style={{ background: "none", border: "none", textAlign: "left", padding: "10px 0", fontSize: 15.5, fontWeight: 600, color: lc.ink }}>
              {link.label}
            </button>
          ))}
          <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
            <button onClick={() => go("/login")} style={{ flex: 1, background: lc.paperRaised, border: "none", borderRadius: lcRadius.pill, padding: "12px 0", fontWeight: 700, fontSize: 14 }}>
              Log in
            </button>
            <button className="lc-btn" style={{ flex: 1, background: lc.forest, color: lc.white }} onClick={() => go("/explore")}>
              Explore near you
            </button>
          </div>
        </div>
      )}

      <style>{`
        @media (max-width: 900px) {
          .lc-header-menu-btn { display: flex !important; align-items: center; justify-content: center; }
          .lc-header-desktop-only { display: none !important; }
        }
      `}</style>
    </header>
  );
}
