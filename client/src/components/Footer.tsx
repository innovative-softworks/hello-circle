import { useNavigate } from "react-router-dom";
import { colors, fonts, maxWidth } from "../theme";

// Footer upgrade (Game Detail redesign §32) — every link below resolves to
// a route/tab that genuinely exists (checked against App.tsx's route table
// and MyBookings.tsx's ?tab= deep-link support, e.g. "Do it again?" already
// used the same pattern from Home.tsx). Two columns from the source brief
// were dropped rather than faked:
//   - "My Circles" / "My interests" — no such distinct page exists; the
//     closest real thing is the "Favourites" tab, used instead.
//   - "Follow us" (social links) — this is a prototype with no real social
//     presence anywhere in the app; a column of placeholder icons linking
//     nowhere would violate the spec's own "don't add links to features
//     that don't exist" instruction, so it's simply omitted.
//   - "Report an issue" / "Terms" — no generic (non-listing-scoped) report
//     flow and no Terms page exist either; also omitted.

const COLUMNS: { heading: string; links: { label: string; to: string; external?: boolean }[] }[] = [
  {
    heading: "Explore",
    links: [
      { label: "Find activities", to: "/games" },
      { label: "Browse Circles", to: "/circles" },
      { label: "Places & venues", to: "/browse/centres" },
      { label: "This weekend", to: "/games?when=weekend" },
    ],
  },
  {
    heading: "Your account",
    links: [
      { label: "My bookings", to: "/bookings" },
      { label: "Favourites", to: "/bookings?tab=favourites" },
      { label: "Profile", to: "/bookings?tab=profile" },
    ],
  },
  {
    heading: "Support",
    links: [
      { label: "Help & Support", to: "/bookings?tab=help" },
      { label: "Safety Centre", to: "/bookings?tab=safety" },
      { label: "Contact us", to: "mailto:support@hellocircle.ie", external: true },
    ],
  },
  {
    // Deliberately only two links, not the four the original brief
    // sketched ("Venue resources"/"Partner support") — no such pages
    // exist yet, and this file's own established precedent (see header
    // comment) is to drop a column entry rather than link somewhere fake.
    heading: "For venues",
    links: [
      { label: "List your venue", to: "/for-venues" },
      { label: "How it works", to: "/for-venues#how-it-works" },
    ],
  },
];

export function Footer() {
  const navigate = useNavigate();

  return (
    <footer style={{ borderTop: `1px solid ${colors.border}`, background: colors.footerBg }}>
      <div style={{ maxWidth, margin: "0 auto", padding: "40px 24px 24px" }}>
        <div className="grid-responsive" style={{ display: "grid", gridTemplateColumns: "1.2fr repeat(4, 1fr)", gap: 32, marginBottom: 32 }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 9, cursor: "pointer", marginBottom: 10 }} onClick={() => navigate("/")}>
              <img src="/illustrations/Logo.svg" alt="Hello Circle" style={{ height: 38 }} />
            </div>
            <p style={{ margin: 0, color: "#8A928B", fontSize: 14, maxWidth: 320 }}>
              Local community spaces & sports clubs across Ireland. A concept prototype — not affiliated with any council
              or governing body.
            </p>
          </div>
          {COLUMNS.map((col) => (
            <div key={col.heading}>
              <div style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 12.5, textTransform: "uppercase", letterSpacing: ".04em", color: colors.text, marginBottom: 12 }}>
                {col.heading}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
                {col.links.map((link) =>
                  link.external ? (
                    <a key={link.label} href={link.to} className="link-accent" style={{ fontSize: 13.5, color: colors.muted, textDecoration: "none" }}>
                      {link.label}
                    </a>
                  ) : (
                    <span key={link.label} className="link-accent" style={{ fontSize: 13.5, color: colors.muted, cursor: "pointer" }} onClick={() => navigate(link.to)}>
                      {link.label}
                    </span>
                  )
                )}
              </div>
            </div>
          ))}
        </div>

        <div style={{ borderTop: `1px solid ${colors.border}`, paddingTop: 18, display: "flex", flexWrap: "wrap", gap: 20, color: colors.muted, fontSize: 14, fontWeight: 600 }}>
          <span className="link-accent" style={{ cursor: "pointer" }} onClick={() => navigate("/browse/centres")}>
            Councils
          </span>
          <span className="link-accent" style={{ cursor: "pointer" }} onClick={() => navigate("/browse/clubs")}>
            Clubs
          </span>
          <span className="link-accent" style={{ cursor: "pointer" }} onClick={() => navigate("/privacy")}>
            Privacy
          </span>
          <span className="link-accent" style={{ cursor: "pointer" }} onClick={() => navigate("/cookies")}>
            Cookies
          </span>
        </div>
      </div>
    </footer>
  );
}
