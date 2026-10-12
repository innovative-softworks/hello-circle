import { BrandLogo } from "./BrandLogo";
import { Link } from "react-router-dom";
import { useTheme } from "../ThemeContext";
import { colors, fonts, maxWidth } from "../theme";
import { VENUE_PAGES_PUBLIC } from "../venueLaunch";
import { COMPANY_BRAND, LEGAL_OPERATOR } from "../companyDetails";

// Footer upgrade (Game Detail redesign §32) — every link below resolves to
// a route/tab that genuinely exists (checked against App.tsx's route table
// and Profile.tsx's ?tab= deep-link support). Two columns from the source
// brief were dropped rather than faked:
//   - "My Circles" / "My interests" — no such distinct page exists; the
//     closest real thing is the "Saved" section, used instead.
//   - "Follow us" (social links) — this is a prototype with no real social
//     presence anywhere in the app; a column of placeholder icons linking
//     nowhere would violate the spec's own "don't add links to features
//     that don't exist" instruction, so it's simply omitted.
//   - "Report an issue" — no generic (non-listing-scoped) report flow
//     exists either; also omitted.
//
// Sitemap audit P1-05/P1-06/P1-10: the account/support links used to point
// at /bookings?tab=…, which My Life never reads (they all landed on the My
// Life root) — they now go to the Profile sections they name. Venue links are
// left out while venue pages are behind the coming-soon gate, so the footer
// never sends anyone to /coming-soon. Every item is a real <Link>/<a>, so it
// is keyboard-reachable and announced as a link.

type FooterLink = { label: string; to: string; external?: boolean; venue?: boolean };

const COLUMNS: { heading: string; links: FooterLink[] }[] = [
  {
    heading: "Explore",
    links: [
      { label: "Find activities", to: "/games" },
      { label: "Browse Circles", to: "/circles" },
      { label: "Community centres", to: "/browse/centres", venue: true },
      { label: "Sports clubs", to: "/browse/clubs", venue: true },
      { label: "This weekend", to: "/games?when=weekend" },
      { label: "Suggest a place", to: "/suggest-place" },
    ],
  },
  {
    heading: "Your account",
    links: [
      { label: "My Life", to: "/bookings" },
      { label: "Saved", to: "/profile?tab=favourites" },
      { label: "Profile", to: "/profile?tab=account" },
    ],
  },
  {
    heading: "Support",
    links: [
      { label: "Full help guide", to: "/help-guide" },
      { label: "Help & Support", to: "/profile?tab=help" },
      { label: "Safety Centre", to: "/profile?tab=safety" },
      { label: "Contact us", to: "/contact" },
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
      { label: "Pricing for partners", to: "/pricing" },
    ],
  },
];

const BOTTOM_LINKS: FooterLink[] = [
  { label: "About", to: "/about" },
  { label: "Privacy", to: "/privacy" },
  { label: "Cookies", to: "/cookies" },
  // Revenue & Connect Stage 4 — the Policy Centre and complaints/appeals.
  { label: "Terms & policies", to: "/policies" },
  { label: "Complaints & appeals", to: "/complaints" },
];

const isLive = (link: FooterLink) => VENUE_PAGES_PUBLIC || !link.venue;

export function Footer() {
  const { resolvedTheme, setTheme } = useTheme();
  return (
    // HC-QA-001 — the footer renders after <main>, outside .mobile-tab-bar-space,
    // so it reserves the fixed bottom chrome itself (0 / safe-area on desktop).
    <footer style={{ borderTop: `1px solid ${colors.border}`, background: colors.footerBg, paddingBottom: "var(--bottom-chrome)" }}>
      <div style={{ maxWidth, margin: "0 auto", padding: "40px 24px 24px" }}>
        <div className="grid-responsive" style={{ display: "grid", gridTemplateColumns: "1.2fr repeat(4, 1fr)", gap: 32, marginBottom: 32 }}>
          <div>
            <Link to="/" aria-label="HelloCircle home" style={{ display: "inline-flex", alignItems: "center", gap: 9, marginBottom: 10 }}>
              <BrandLogo alt="HelloCircle" style={{ height: 38 }} />
            </Link>
            <p style={{ margin: 0, color: colors.faint, fontSize: 14, maxWidth: 320 }}>
              Local activities, Circles and community spaces across Ireland. A product of {COMPANY_BRAND.brandName}, the brand of {LEGAL_OPERATOR}.
            </p>
          </div>
          {COLUMNS.map((col) => (
            <div key={col.heading}>
              <div style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 12.5, textTransform: "uppercase", letterSpacing: 0, color: colors.text, marginBottom: 12 }}>
                {col.heading}
              </div>
              {/* Each link pads to a 24px-tall tap target (sitemap audit P2-12); the
                  gap shrinks to match, so the column looks the same. */}
              <div style={{ display: "flex", flexDirection: "column", gap: 1, alignItems: "flex-start" }}>
                {col.links.filter(isLive).map((link) =>
                  link.external ? (
                    <a key={link.label} href={link.to} className="link-accent" style={{ fontSize: 13.5, color: colors.muted, textDecoration: "none", padding: "4px 0" }}>
                      {link.label}
                    </a>
                  ) : (
                    <Link key={link.label} to={link.to} className="link-accent" style={{ fontSize: 13.5, color: colors.muted, textDecoration: "none", padding: "4px 0" }}>
                      {link.label}
                    </Link>
                  )
                )}
              </div>
            </div>
          ))}
        </div>

        <div style={{ borderTop: `1px solid ${colors.border}`, paddingTop: 14, display: "flex", flexWrap: "wrap", columnGap: 20, rowGap: 0, color: colors.muted, fontSize: 14, fontWeight: 600 }}>
          {BOTTOM_LINKS.filter(isLive).map((link) => (
            <Link key={link.label} className="link-accent" to={link.to} style={{ color: "inherit", textDecoration: "none", padding: "4px 0" }}>
              {link.label}
            </Link>
          ))}
          {/* The header's theme switch lives in the account menu; this one is
              for signed-out visitors (header redesign 2026-10-12). */}
          <button
            type="button"
            className="link-accent"
            onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
            style={{ marginLeft: "auto", background: "none", border: "none", padding: "4px 0", color: "inherit", font: "inherit", cursor: "pointer" }}
          >
            {resolvedTheme === "dark" ? "Light mode" : "Dark mode"}
          </button>
        </div>
      </div>
    </footer>
  );
}
