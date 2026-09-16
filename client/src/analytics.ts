// Google Tag Manager — only ever loaded after real opt-in consent (see
// CookieNotice.tsx's Accept/Reject choice), never unconditionally, since
// this is an Ireland/EU-facing site and analytics cookies are non-essential
// under GDPR/ePrivacy — they require genuine prior consent, not just a
// dismissible notice. Never import or call loadGoogleTagManager() from
// anywhere except CookieNotice's own consent-gated call sites.
//
// GA4 (G-7R0EXK4RB5) used to be installed directly here too, alongside GTM
// — removed once a "GA4 - Config" tag was added inside the GTM-WWNNDL99
// container (confirmed firing via Tag Assistant), which made the direct
// install redundant and was double-counting every pageview/event. GTM is
// now the single source for all tracking; add any future tag (ads pixels,
// etc.) inside the GTM dashboard, not as a new function in this file.
const GTM_CONTAINER_ID = "GTM-WWNNDL99";

declare global {
  interface Window {
    dataLayer?: unknown[];
  }
}

let gtmLoaded = false;

// Same effect as Google's own gtm.js snippet, via the DOM API rather than
// its literal `f.parentNode.insertBefore(j,f)` form (which targets "the
// first <script> tag on the page" — brittle to rely on in a bundled React
// app where script order isn't hand-authored). No <noscript> fallback
// iframe: this app is a client-rendered SPA with an empty <div id="root">
// as its entire static markup, so a no-JS visitor sees a blank page
// regardless — there's no functioning site for that fallback to track.
export function loadGoogleTagManager(): void {
  if (gtmLoaded || typeof window === "undefined") return;
  gtmLoaded = true;

  window.dataLayer = window.dataLayer || [];
  window.dataLayer.push({ "gtm.start": new Date().getTime(), event: "gtm.js" });

  const script = document.createElement("script");
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtm.js?id=${GTM_CONTAINER_ID}`;
  document.head.appendChild(script);
}
