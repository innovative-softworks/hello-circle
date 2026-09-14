import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { loadGoogleAnalytics } from "../analytics";
import { colors, fonts, radius } from "../theme";

export const CONSENT_KEY = "hello_circle_cookie_consent";
type Consent = "accepted" | "rejected";

/** Reads the stored consent choice, if any — used by CookieNotice on mount
 * (to load GA for a returning visitor who already accepted, without
 * re-showing the banner) and available for a future "manage preferences"
 * entry point if one gets built. */
export function getStoredConsent(): Consent | null {
  const v = localStorage.getItem(CONSENT_KEY);
  return v === "accepted" || v === "rejected" ? v : null;
}

// Everything else this app stores is strictly necessary (session cookie,
// guest booking ID, favourites — see CookiePolicy.tsx); Google Analytics is
// the one non-essential/optional cookie, so this is now a real Accept/
// Reject choice, not a one-button acknowledgement — GA never loads until
// "Accept analytics" is actually clicked (or was on a previous visit).
export function CookieNotice() {
  const navigate = useNavigate();
  const [consent, setConsent] = useState<Consent | null>("accepted");

  useEffect(() => {
    const stored = getStoredConsent();
    setConsent(stored);
    if (stored === "accepted") loadGoogleAnalytics();
  }, []);

  if (consent !== null) return null;

  const decide = (value: Consent) => {
    localStorage.setItem(CONSENT_KEY, value);
    setConsent(value);
    if (value === "accepted") loadGoogleAnalytics();
  };

  return (
    <div
      className="pop-in"
      style={{
        position: "fixed",
        left: 16,
        right: 16,
        bottom: 16,
        zIndex: 50,
        maxWidth: 640,
        margin: "0 auto",
        background: colors.dark,
        color: "#fff",
        borderRadius: radius.card,
        padding: "16px 18px",
        boxShadow: "0 18px 40px rgba(0,0,0,.25)",
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: 14,
      }}
    >
      <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.5, flex: "1 1 320px" }}>
        We use strictly necessary cookies/local storage to run this site, and — only if you accept — Google
        Analytics to understand how it's used.{" "}
        <span
          onClick={() => navigate("/cookies")}
          style={{ textDecoration: "underline", cursor: "pointer", fontWeight: 600, color: "#fff" }}
        >
          Learn more
        </span>
      </p>
      <div style={{ display: "flex", gap: 8, flex: "none" }}>
        <button
          onClick={() => decide("rejected")}
          className="btn"
          style={{
            background: "transparent",
            color: "#fff",
            border: "1px solid rgba(255,255,255,.4)",
            borderRadius: radius.control,
            padding: "9px 16px",
            fontSize: 13.5,
            fontWeight: 700,
            fontFamily: fonts.body,
            cursor: "pointer",
          }}
        >
          Necessary only
        </button>
        <button
          onClick={() => decide("accepted")}
          className="btn"
          style={{
            background: "#fff",
            color: colors.dark,
            border: "none",
            borderRadius: radius.control,
            padding: "9px 18px",
            fontSize: 13.5,
            fontWeight: 700,
            fontFamily: fonts.body,
            cursor: "pointer",
          }}
        >
          Accept
        </button>
      </div>
    </div>
  );
}
