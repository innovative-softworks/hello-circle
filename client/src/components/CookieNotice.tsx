import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { loadGoogleTagManager } from "../analytics";
import { recordCookieConsent } from "../api";
import { CONSENT_KEY, applyConsentMode, readChoice, saveChoice, setConsentDefaults, type CookieChoice } from "../cookieConsent";
import { colors, fonts, radius, zIndex } from "../theme";

export { CONSENT_KEY };

/** The stored cookie choice, if any (Stage 5c: analytics and advertising are separate). */
export function getStoredConsent(): CookieChoice | null {
  return readChoice();
}

// Everything else this app stores is strictly necessary (session cookie,
// guest booking ID, favourites — see CookiePolicy.tsx). Google Tag Manager
// is the one optional source, and since Stage 5c it is governed by two
// separate opt-ins — analytics and advertising — passed to its tags through
// Google Consent Mode v2 (denied by default). GTM loads only after at least
// one of them is granted (now or on a previous visit).
export function CookieNotice() {
  const navigate = useNavigate();
  const [consent, setConsent] = useState<CookieChoice | null | "pending">("pending");
  const [choosing, setChoosing] = useState(false);
  const [analytics, setAnalytics] = useState(false);
  const [advertising, setAdvertising] = useState(false);
  const bannerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setConsentDefaults();
    const stored = readChoice();
    setConsent(stored);
    if (stored) {
      applyConsentMode(stored);
      if (stored.analytics || stored.advertising) loadGoogleTagManager();
    }
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
    const root = document.documentElement;
    const reserve = () => {
      document.body.style.paddingBottom = `${el.offsetHeight + 32}px`;
      // HC-QA-043 — let focus/scrollIntoView keep controls clear of the banner
      // (index.css: html scroll-padding-bottom adds this to --bottom-chrome).
      root.style.setProperty("--consent-reserve", `${el.offsetHeight + 16}px`);
    };
    reserve();
    const observer = new ResizeObserver(reserve);
    observer.observe(el);
    return () => {
      observer.disconnect();
      document.body.style.paddingBottom = previous;
      root.style.removeProperty("--consent-reserve");
    };
  }, [consent]);

  if (consent !== null) return null;

  const decide = (a: boolean, ad: boolean) => {
    const choice = saveChoice(a, ad);
    setConsent(choice);
    applyConsentMode(choice);
    if (a || ad) loadGoogleTagManager();
    // Kept as a consent record too (best effort — the choice already applies in this browser).
    recordCookieConsent({ analytics: a, advertising: ad }).catch(() => undefined);
  };
  const ghost = {
    background: "transparent",
    color: "#fff",
    border: "1px solid rgba(255,255,255,.4)",
    borderRadius: radius.control,
    padding: "9px 16px",
    fontSize: 13.5,
    fontWeight: 700,
    fontFamily: fonts.body,
    cursor: "pointer",
  } as const;

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
        // HC-QA-001 — sit above the fixed bottom stack (mobile tab bar, join
        // bars; safe-area inset when there's none) published by
        // BottomChromeSync, instead of underneath it.
        bottom: "calc(var(--bottom-chrome) + 16px)",
        zIndex: zIndex.consent,
        // Short viewports: the banner scrolls internally so both choices stay reachable.
        maxHeight: "calc(100dvh - var(--bottom-chrome) - 32px)",
        overflowY: "auto",
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
        We use strictly necessary cookies and local storage to run this site. With your permission we'd also use{" "}
        <strong>analytics</strong> cookies (Google Analytics, to understand how the site is used) and, separately,{" "}
        <strong>advertising</strong> cookies (to measure and personalise ads). You can choose each one.{" "}
        <a
          href="/cookies"
          onClick={(e) => {
            e.preventDefault();
            navigate("/cookies");
          }}
          style={{ textDecoration: "underline", cursor: "pointer", fontWeight: 600, color: "#fff" }}
        >
          Learn more
        </a>
      </p>
      {choosing && (
        <fieldset style={{ border: 0, margin: 0, padding: 0, flex: "1 1 100%", display: "grid", gap: 8 }}>
          <legend style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>Choose cookies</legend>
          <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13.5 }}>
            <input type="checkbox" checked disabled /> Strictly necessary (always on)
          </label>
          <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13.5 }}>
            <input type="checkbox" checked={analytics} onChange={(e) => setAnalytics(e.target.checked)} /> Analytics
          </label>
          <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13.5 }}>
            <input type="checkbox" checked={advertising} onChange={(e) => setAdvertising(e.target.checked)} /> Advertising
          </label>
        </fieldset>
      )}
      <div style={{ display: "flex", gap: 8, flex: "none", flexWrap: "wrap" }}>
        <button onClick={() => decide(false, false)} className="btn" style={ghost}>
          Necessary only
        </button>
        {choosing ? (
          <button onClick={() => decide(analytics, advertising)} className="btn" style={ghost}>
            Save my choices
          </button>
        ) : (
          <button onClick={() => setChoosing(true)} className="btn" style={ghost}>
            Choose…
          </button>
        )}
        <button
          onClick={() => decide(true, true)}
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
          Accept all
        </button>
      </div>
    </div>
  );
}
