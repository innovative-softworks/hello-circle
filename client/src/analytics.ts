// Google Analytics (GA4) + Google Tag Manager — only ever loaded after real
// opt-in consent (see CookieNotice.tsx's Accept/Reject choice), never
// unconditionally, since this is an Ireland/EU-facing site and analytics
// cookies are non-essential under GDPR/ePrivacy — they require genuine
// prior consent, not just a dismissible notice. Never import or call either
// load function from anywhere except CookieNotice's own consent-gated call
// sites.
//
// Both are currently installed side by side: GA4 (G-7R0EXK4RB5) direct, and
// GTM (GTM-WWNNDL99) as a separate container — deliberately not consolidated
// into "GTM loads GA4" (the usual setup) because it's unknown whether the
// GTM container has a GA4 tag configured for the same property yet. If one
// gets added there later, remove loadGoogleAnalytics()'s call site in
// CookieNotice.tsx so pageviews/events aren't double-counted.
const GA_MEASUREMENT_ID = "G-7R0EXK4RB5";
const GTM_CONTAINER_ID = "GTM-WWNNDL99";

declare global {
  interface Window {
    dataLayer?: unknown[];
  }
}

let gaLoaded = false;

export function loadGoogleAnalytics(): void {
  if (gaLoaded || typeof window === "undefined") return;
  gaLoaded = true;

  const script = document.createElement("script");
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`;
  document.head.appendChild(script);

  window.dataLayer = window.dataLayer || [];
  function gtag(...args: unknown[]) {
    window.dataLayer!.push(args);
  }
  gtag("js", new Date());
  gtag("config", GA_MEASUREMENT_ID);
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
