// Google Analytics (GA4) — only ever loaded after real opt-in consent (see
// CookieNotice.tsx's Accept/Reject choice), never unconditionally, since
// this is an Ireland/EU-facing site and analytics cookies are non-essential
// under GDPR/ePrivacy — they require genuine prior consent, not just a
// dismissible notice. Never import or call loadGoogleAnalytics() from
// anywhere except CookieNotice's own consent-gated call sites.
const GA_MEASUREMENT_ID = "G-7R0EXK4RB5";

declare global {
  interface Window {
    dataLayer?: unknown[];
  }
}

let loaded = false;

export function loadGoogleAnalytics(): void {
  if (loaded || typeof window === "undefined") return;
  loaded = true;

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
