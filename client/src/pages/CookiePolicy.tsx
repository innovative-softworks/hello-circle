import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronLeftIcon } from "../components/icons";
import { CONSENT_KEY, getStoredConsent } from "../components/CookieNotice";
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
    purpose: "A random ID (not linked to your identity) so \"My Life\" can show your bookings without requiring an account.",
    duration: "Until you clear your browser's site data",
  },
  {
    name: "hello_circle_favorites",
    type: "Local storage",
    purpose: "Remembers which halls/clubs you've saved, so they're still there next time you visit.",
    duration: "Until you clear your browser's site data",
  },
  {
    name: "hello_circle_cookie_consent",
    type: "Local storage",
    purpose: "Remembers whether you accepted or declined analytics cookies, so we don't ask again every visit.",
    duration: "Until you clear your browser's site data",
  },
  {
    name: "_ga, _ga_*",
    type: "Cookie",
    purpose: "Google Analytics — anonymized statistics on how the site is used (pages visited, rough traffic sources). Only set if you accept analytics below.",
    duration: "Up to 2 years",
  },
];

const h2Style: React.CSSProperties = { fontFamily: fonts.display, fontWeight: 700, fontSize: 19, margin: "0 0 10px", letterSpacing: "-.01em" };
const pStyle: React.CSSProperties = { color: "#3B423C", fontSize: 15, lineHeight: 1.65, margin: "0 0 10px" };

export function CookiePolicy() {
  const navigate = useNavigate();
  const tableWrapRef = useRef<HTMLDivElement>(null);
  const [tableScrollable, setTableScrollable] = useState(false);
  const [consent, setConsent] = useState<ReturnType<typeof getStoredConsent>>(null);

  useEffect(() => {
    setConsent(getStoredConsent());
  }, []);

  // The table's nowrap columns (name/type/duration) keep it wider than a
  // phone screen — overflowX:auto below makes it swipeable, but that's not
  // visually obvious on its own, so show a hint only while it's actually
  // wider than its container (i.e. not on desktop, where it just fits).
  useEffect(() => {
    const el = tableWrapRef.current;
    if (!el) return;
    const check = () => setTableScrollable(el.scrollWidth > el.clientWidth);
    check();
    const observer = new ResizeObserver(check);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

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
          Most of what we store is strictly necessary to run the site. The one exception is Google Analytics, which
          only runs if you accept it in the cookie banner — no advertising cookies, no tracking beyond that.
        </div>

        <div style={{ marginBottom: 30 }}>
          <h2 style={h2Style}>What we store, and why</h2>
          {tableScrollable && (
            <p style={{ margin: "0 0 8px", fontSize: 12.5, color: colors.muted, fontStyle: "italic" }}>
              Scroll right to see full details →
            </p>
          )}
          <div ref={tableWrapRef} style={{ overflowX: "auto" }}>
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
          <p style={pStyle}>
            If you accept analytics cookies, we use <a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer" style={{ color: colors.greenText }}>Google Analytics</a> and{" "}
            <a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer" style={{ color: colors.greenText }}>Google Tag Manager</a> to
            understand overall site usage — neither loads if you decline.
          </p>
        </div>

        <div>
          <h2 style={h2Style}>Managing storage</h2>
          <p style={pStyle}>
            Everything except analytics is strictly necessary for booking/login features to work. Your analytics
            choice is currently:{" "}
            <strong>{consent === "accepted" ? "accepted" : consent === "rejected" ? "declined" : "not yet set"}</strong>.
          </p>
          <button
            onClick={() => {
              localStorage.removeItem(CONSENT_KEY);
              window.location.reload();
            }}
            style={{
              background: "none",
              border: `1px solid ${colors.border}`,
              borderRadius: 10,
              padding: "9px 16px",
              fontSize: 13.5,
              fontWeight: 700,
              color: colors.text,
              cursor: "pointer",
              marginBottom: 14,
            }}
          >
            Change my cookie choice
          </button>
          <p style={pStyle}>
            You can also clear cookies and local storage for this site at any time via your browser settings; doing
            so will sign you out, forget your saved favourites, and reset your cookie choice.
          </p>
        </div>
      </section>
    </div>
  );
}
