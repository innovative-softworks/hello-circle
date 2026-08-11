import { useNavigate } from "react-router-dom";
import { ChevronLeftIcon } from "../components/icons";
import { colors, fonts } from "../theme";

const LAST_UPDATED = "11 August 2026";

interface StorageItem {
  name: string;
  type: "Cookie" | "Local storage";
  purpose: string;
  duration: string;
}

const ITEMS: StorageItem[] = [
  {
    name: "hello_circle_session",
    type: "Cookie",
    purpose: "Keeps you signed in if you have a vendor or admin account. httpOnly — not readable by page scripts.",
    duration: "30 days, or until you sign out",
  },
  {
    name: "hello_circle_client_id",
    type: "Local storage",
    purpose: "A random ID (not linked to your identity) so \"My bookings\" can show your bookings without requiring an account.",
    duration: "Until you clear your browser's site data",
  },
  {
    name: "hello_circle_favorites",
    type: "Local storage",
    purpose: "Remembers which halls/clubs you've saved, so they're still there next time you visit.",
    duration: "Until you clear your browser's site data",
  },
];

const h2Style: React.CSSProperties = { fontFamily: fonts.display, fontWeight: 700, fontSize: 19, margin: "0 0 10px", letterSpacing: "-.01em" };
const pStyle: React.CSSProperties = { color: "#3B423C", fontSize: 15, lineHeight: 1.65, margin: "0 0 10px" };

export function CookiePolicy() {
  const navigate = useNavigate();

  return (
    <div style={{ animation: "fadeUp .3s ease both" }}>
      <section className="section-pad" style={{ maxWidth: 760, margin: "0 auto", padding: "36px 24px 90px" }}>
        <button
          onClick={() => navigate(-1)}
          style={{ display: "inline-flex", alignItems: "center", background: "none", border: "none", color: colors.muted, fontWeight: 600, fontSize: 14, cursor: "pointer", padding: 0, marginBottom: 20 }}
        >
          <ChevronLeftIcon size={14} style={{ marginRight: 4 }} /> Back
        </button>

        <h1 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: "clamp(26px, 5vw, 34px)", margin: "0 0 6px", letterSpacing: "-.02em" }}>
          Cookie Policy
        </h1>
        <p style={{ color: colors.faint, fontSize: 13, margin: "0 0 24px" }}>Last updated {LAST_UPDATED}</p>

        <div style={{ background: colors.greenBg, border: `1px solid ${colors.border}`, borderRadius: 14, padding: "14px 18px", marginBottom: 30, fontSize: 14, color: colors.greenText, lineHeight: 1.6, fontWeight: 600 }}>
          We only use storage that's strictly necessary to run the site. No analytics, no advertising, no tracking
          cookies of any kind — so there's nothing here that needs your consent to switch on.
        </div>

        <div style={{ marginBottom: 30 }}>
          <h2 style={h2Style}>What we store, and why</h2>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13.5 }}>
              <thead>
                <tr style={{ textAlign: "left", borderBottom: `2px solid ${colors.border}` }}>
                  <th style={{ padding: "8px 10px 8px 0", color: colors.muted }}>Name</th>
                  <th style={{ padding: "8px 10px", color: colors.muted }}>Type</th>
                  <th style={{ padding: "8px 10px", color: colors.muted }}>Purpose</th>
                  <th style={{ padding: "8px 0 8px 10px", color: colors.muted }}>Duration</th>
                </tr>
              </thead>
              <tbody>
                {ITEMS.map((item) => (
                  <tr key={item.name} style={{ borderBottom: `1px solid ${colors.border}`, verticalAlign: "top" }}>
                    <td style={{ padding: "10px 10px 10px 0", fontFamily: "monospace", fontSize: 12.5, whiteSpace: "nowrap" }}>{item.name}</td>
                    <td style={{ padding: "10px", whiteSpace: "nowrap" }}>{item.type}</td>
                    <td style={{ padding: "10px", color: "#3B423C" }}>{item.purpose}</td>
                    <td style={{ padding: "10px 0 10px 10px", color: colors.mutedLight, whiteSpace: "nowrap" }}>{item.duration}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div style={{ marginBottom: 30 }}>
          <h2 style={h2Style}>Third parties</h2>
          <p style={pStyle}>
            When you pay for a booking or registration, you're taken to Stripe's own checkout page — Stripe may set its
            own cookies there, governed by <a href="https://stripe.com/ie/privacy" target="_blank" rel="noopener noreferrer" style={{ color: colors.greenText }}>Stripe's privacy policy</a>, not this one.
          </p>
        </div>

        <div>
          <h2 style={h2Style}>Managing storage</h2>
          <p style={pStyle}>
            Since everything above is strictly necessary for booking/login features to work, we don't show a
            cookie-consent toggle — there's nothing optional to switch off. You can still clear cookies and local
            storage for this site at any time via your browser settings; doing so will sign you out and forget your
            saved favourites.
          </p>
        </div>
      </section>
    </div>
  );
}
