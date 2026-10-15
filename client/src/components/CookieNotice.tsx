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
// R3A (commercial UX) — two layout rules so the banner never hides what the
// person is doing:
// 1. While a modal dialog is open (any [aria-modal="true"]: drawers, sheets,
//    modals, the photo lightbox) the banner steps aside entirely and comes
//    back when it closes. No choice is recorded by hiding it.
// 2. On a checkout screen at phone/tablet width (the booking kit's fixed
//    submit bar is present) it shows the first sentence and the three
//    choices; the rest of the same wording is one tap away ("More about
//    optional cookies"), and opens automatically under "Choose…".
function useDomFlag(query: () => boolean): boolean {
  const [flag, setFlag] = useState(false);
  useEffect(() => {
    let frame = 0;
    const check = () => {
      frame = 0;
      setFlag(query());
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(check);
    };
    check();
    const mo = typeof MutationObserver !== "undefined" ? new MutationObserver(schedule) : null;
    mo?.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["aria-modal"] });
    window.addEventListener("resize", schedule);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      mo?.disconnect();
      window.removeEventListener("resize", schedule);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return flag;
}

const modalOpen = () => !!document.querySelector('[aria-modal="true"]');
const compactCheckout = () => !!document.querySelector(".bk-submitbar") && window.matchMedia("(max-width: 899px)").matches;
// Homepage UX audit (2026-10-12) — at phone width the full wording covered
// about half of a 320px screen (the headline and search). The same compact
// form checkout already uses (first sentence + choices, the rest one tap
// away) now applies to every page on a phone. Wording is unchanged.
const compactPhone = () => window.matchMedia("(max-width: 640px)").matches;
const compactView = () => compactCheckout() || compactPhone();

export function CookieNotice() {
  const navigate = useNavigate();
  const overlayOpen = useDomFlag(modalOpen);
  const compact = useDomFlag(compactView);
  const [showDetails, setShowDetails] = useState(false);
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
    if (consent !== null || !el || overlayOpen) return;
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
  }, [consent, overlayOpen]);

  if (consent !== null) return null;
  const brief = compact && !showDetails && !choosing;

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
    // Touch targets: 44px minimum (homepage UX audit).
    minHeight: 44,
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
      className="pop-in-up"
      hidden={overlayOpen}
      data-compact={compact || undefined}
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
        // `hidden` alone loses to an inline display value.
        display: overlayOpen ? "none" : "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: compact ? 10 : 14,
      }}
    >
      <p id="cookie-notice-text" style={{ margin: 0, fontSize: 13.5, lineHeight: 1.5, flex: "1 1 320px" }}>
        We use strictly necessary cookies and local storage to run this site.{" "}
        {/* The compact phone form still names both optional purposes before
            any choice is offered (consent must be informed at the first
            layer); the fuller explanation stays one tap away. */}
        {brief && (
          <>
            <strong>Analytics</strong> and <strong>advertising</strong> cookies are optional and only used if you allow them.{" "}
          </>
        )}
        {!brief && (
          <>
            With your permission we'd also use <strong>analytics</strong> cookies (Google Analytics, to understand how the site is used) and, separately,{" "}
            <strong>advertising</strong> cookies (to measure and personalise ads). You can choose each one.{" "}
          </>
        )}
        {compact && !choosing && (
          <>
            <button
              type="button"
              aria-expanded={showDetails}
              aria-controls="cookie-notice-text"
              onClick={() => setShowDetails((v) => !v)}
              className="btn-reset"
              style={{ color: "#fff", textDecoration: "underline", fontWeight: 600, fontSize: 13.5, cursor: "pointer", padding: 0 }}
            >
              {showDetails ? "Show less" : "More about optional cookies"}
            </button>{" "}
          </>
        )}
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
      {/* Release validation 2026-10-11: shrinkable (not flex: none) so the three
          choices wrap inside the banner on phones — at 320–390 px "Accept all"
          previously ran past the banner edge. Never grows, so desktop is unchanged. */}
      <div style={{ display: "flex", gap: 8, flex: "0 1 auto", minWidth: 0, maxWidth: "100%", flexWrap: "wrap" }}>
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
            // Fixed light button on the dark banner, in both themes.
            background: "#f7f4ec",
            color: "#172019",
            border: "none",
            borderRadius: radius.control,
            padding: "9px 18px",
            minHeight: 44,
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
