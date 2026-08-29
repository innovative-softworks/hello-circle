import { useNavigate } from "react-router-dom";
import { lc, lcFonts, lcMaxWidth } from "../theme";

const COLUMNS: { title: string; links: { label: string; href: string }[] }[] = [
  {
    title: "HelloCircle",
    links: [
      { label: "Explore", href: "/explore" },
      { label: "Activities", href: "/games" },
      { label: "Circles", href: "/circles" },
      { label: "Places", href: "/browse/centres" },
    ],
  },
  {
    title: "Participate",
    links: [
      { label: "Create an Activity", href: "/games" },
      { label: "Start a Plan", href: "/make-it-happen" },
      { label: "Create a Circle", href: "/circles" },
    ],
  },
  {
    title: "Partners",
    links: [
      { label: "List a Venue", href: "/vendor/signup" },
      { label: "Claim a Venue", href: "/suggest-place" },
      { label: "Organizer Tools", href: "/vendor" },
    ],
  },
  {
    title: "Company",
    links: [
      { label: "About", href: "/" },
      { label: "Contact", href: "/ask" },
      { label: "Help", href: "/ask" },
      { label: "Safety", href: "/bookings" },
    ],
  },
  {
    title: "Legal",
    links: [
      { label: "Privacy", href: "/privacy" },
      { label: "Terms", href: "/privacy" },
      { label: "Cookies", href: "/cookies" },
    ],
  },
];

export function LandingFooter() {
  const navigate = useNavigate();
  return (
    <footer style={{ background: lc.paperRaised, borderTop: `1px solid ${lc.line}`, padding: "64px 24px 32px" }}>
      <div style={{ maxWidth: lcMaxWidth, margin: "0 auto" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1.4fr repeat(4, 1fr)", gap: 32 }} className="lc-footer-grid">
          {COLUMNS.map((col) => (
            <div key={col.title}>
              <div style={{ fontFamily: lcFonts.display, fontWeight: 800, fontSize: 14.5, color: lc.ink, marginBottom: 14 }}>{col.title}</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {col.links.map((link) => (
                  <button
                    key={link.label}
                    onClick={() => navigate(link.href)}
                    style={{ background: "none", border: "none", textAlign: "left", padding: 0, fontSize: 13.5, color: lc.inkSoft }}
                  >
                    {link.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 14, marginTop: 48, paddingTop: 24, borderTop: `1px solid ${lc.line}` }}>
          <span style={{ fontSize: 12.5, color: lc.inkSoft }}>© {new Date().getFullYear()} HelloCircle. Made for real-world participation.</span>
          <div style={{ display: "flex", gap: 16 }}>
            {["Instagram", "X", "LinkedIn"].map((s) => (
              <a key={s} href="#" style={{ fontSize: 12.5, color: lc.inkSoft, fontWeight: 600 }}>
                {s}
              </a>
            ))}
          </div>
        </div>
      </div>

      <style>{`
        @media (max-width: 860px) {
          .lc-footer-grid { grid-template-columns: repeat(2, 1fr) !important; row-gap: 28px !important; }
        }
      `}</style>
    </footer>
  );
}
