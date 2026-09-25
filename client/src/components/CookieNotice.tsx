import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { loadGoogleTagManager } from "../analytics";
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
// guest booking ID, favourites — see CookiePolicy.tsx); Google Tag Manager
// (which loads GA4 itself via its own "GA4 - Config" tag, not a direct
// install here) is the one non-essential/optional cookie source, so this is
// a real Accept/Reject choice, not a one-button acknowledgement — GTM never
// loads until "Accept" is actually clicked (or was on a previous visit).
export function CookieNotice() {
  const navigate = useNavigate();
  const [consent, setConsent] = useState<Consent | null>("accepted");
  const bannerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const stored = getStoredConsent();
    setConsent(stored);
    if (stored === "accepted") loadGoogleTagManager();
  }, []);

  // The banner is position:fixed, so it used to sit on top of whatever was at
  // the bottom of the page — on a short viewport that covered primary buttons
  // (e.g. "Accept & join" on the invite page) until the banner was dismissed.
  // While it's showing, reserve its own height (plus its margin) as padding at
  // the end of the document so the page can always scroll clear of it.
  useEffect(() => {
    const el = bannerRef.current;
    if (consent !== null || !el) return;
    const previous = document.body.style.paddingBottom;
    const reserve = () => {
      document.body.style.paddingBottom = `${el.offsetHeight + 32}px`;
    };
    reserve();
    const observer = new ResizeObserver(reserve);
    observer.observe(el);
    return () => {
      observer.disconnect();
      document.body.style.paddingBottom = previous;
    };
  }, [consent]);

  if (consent !== null) return null;

  const decide = (value: Consent) => {
    localStorage.setItem(CONSENT_KEY, value);
    setConsent(value);
    if (value === "accepted") loadGoogleTagManager();
  };

  return (
    <div
      ref={bannerRef}
      role="region"
      aria-label="Cookie preferences"
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
        Analytics (via Google Tag Manager) to understand how it's used.{" "}
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
