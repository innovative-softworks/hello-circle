// Revenue & Connect Stage 5c — cookie consent with separate purposes.
//
// Strictly necessary storage needs no consent. Analytics and advertising are
// separate opt-ins: accepting one never implies the other. Stored in this
// browser (same key as before) as a versioned JSON choice; the old
// single-choice values migrate as "accepted" → analytics only (that banner
// only ever asked about Google Analytics) and "rejected" → neither.
//
// Google Consent Mode v2 carries the choice to GTM: everything is denied by
// default, and an update grants analytics_storage and/or the three ad
// signals according to the choice. GTM itself is loaded only when at least
// one optional purpose is granted (see CookieNotice).

export const CONSENT_KEY = "hello_circle_cookie_consent";

export interface CookieChoice {
  v: 2;
  analytics: boolean;
  advertising: boolean;
  decidedAt: string;
}

export function parseStoredChoice(raw: string | null): CookieChoice | null {
  if (!raw) return null;
  if (raw === "accepted") return { v: 2, analytics: true, advertising: false, decidedAt: "" };
  if (raw === "rejected") return { v: 2, analytics: false, advertising: false, decidedAt: "" };
  try {
    const o = JSON.parse(raw) as Partial<CookieChoice>;
    if (o && o.v === 2 && typeof o.analytics === "boolean" && typeof o.advertising === "boolean") return { v: 2, analytics: o.analytics, advertising: o.advertising, decidedAt: String(o.decidedAt ?? "") };
  } catch {
    /* fall through */
  }
  return null;
}

export function readChoice(): CookieChoice | null {
  try {
    return parseStoredChoice(localStorage.getItem(CONSENT_KEY));
  } catch {
    return null;
  }
}

export function saveChoice(analytics: boolean, advertising: boolean): CookieChoice {
  const choice: CookieChoice = { v: 2, analytics, advertising, decidedAt: new Date().toISOString() };
  try {
    localStorage.setItem(CONSENT_KEY, JSON.stringify(choice));
  } catch {
    /* private mode: the choice applies to this page view only */
  }
  return choice;
}

export function clearChoice() {
  try {
    localStorage.removeItem(CONSENT_KEY);
  } catch {
    /* ignore */
  }
}

/** Consent Mode v2 signals for a choice (null = not decided → everything denied). */
export function consentModeSignals(choice: Pick<CookieChoice, "analytics" | "advertising"> | null) {
  const ads = choice?.advertising ? "granted" : "denied";
  return {
    analytics_storage: choice?.analytics ? "granted" : "denied",
    ad_storage: ads,
    ad_user_data: ads,
    ad_personalization: ads,
  } as const;
}

declare global {
  interface Window {
    dataLayer?: unknown[];
  }
}

// Google's own gtag(): GTM only treats a pushed `arguments` object (not an
// array) as a gtag command such as consent default/update.
function gtag(..._args: unknown[]) {
  window.dataLayer = window.dataLayer || [];
  // eslint-disable-next-line prefer-rest-params
  window.dataLayer.push(arguments);
}

let defaultsSet = false;
/** Must run before GTM can load: everything denied until a choice says otherwise. */
export function setConsentDefaults() {
  if (defaultsSet || typeof window === "undefined") return;
  defaultsSet = true;
  gtag("consent", "default", { ...consentModeSignals(null), wait_for_update: 500 });
}

export function applyConsentMode(choice: Pick<CookieChoice, "analytics" | "advertising">) {
  if (typeof window === "undefined") return;
  setConsentDefaults();
  gtag("consent", "update", consentModeSignals(choice));
}
