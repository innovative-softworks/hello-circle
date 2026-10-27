// Booking kit — design tokens (UX plan §3.1, decision D1–D3 "option A",
// 2026-10-11). Scoped to booking surfaces only: everything here applies inside
// an element carrying data-surface="booking" (see BookingSurface), so the rest
// of the app keeps index.css's tokens until a global rollout is decided.
//
// These literal values are the single source of truth: bookingSurfaceCss()
// turns them into the scoped CSS custom properties, and bookingTheme.test.ts
// checks every text/background pair against WCAG AA from the same values.
//
// The button orange #D7380F (owner, 2026-10-22: the app-wide main-action
// orange) is a FILL with WHITE labels (4.7:1); orange text uses accentText.

import { fonts } from "../../theme";

export interface BookingPalette {
  bg: string;
  surface: string;
  panel: string;
  ink: string;
  muted: string;
  soft: string;
  line: string;
  lineStrong: string;
  controlBorder: string;
  accent: string;
  onAccent: string;
  accentText: string;
  danger: string;
  dangerBg: string;
  disabledBg: string;
  disabledInk: string;
  skeleton: string;
  focus: string;
}

export const bookingPalette: { light: BookingPalette; dark: BookingPalette } = {
  light: {
    bg: "#F7F4EC",
    surface: "#FFFFFF",
    panel: "#EFEBDF",
    ink: "#172019",
    muted: "#4C544D",
    soft: "#3A423B",
    line: "rgba(23, 32, 25, 0.14)",
    lineStrong: "rgba(23, 32, 25, 0.32)",
    controlBorder: "#172019",
    accent: "#D7380F",
    onAccent: "#FFFFFF",
    accentText: "#C7350F",
    danger: "#B42318",
    dangerBg: "#FDECEA",
    disabledBg: "#D9D3C4",
    disabledInk: "#4C544D",
    skeleton: "#E9E4D6",
    focus: "#172019",
  },
  dark: {
    bg: "#121814",
    surface: "#1B231D",
    panel: "#222B24",
    ink: "#F2EEE4",
    muted: "#B9B3A6",
    soft: "#D3CDBF",
    line: "rgba(242, 238, 228, 0.14)",
    lineStrong: "rgba(242, 238, 228, 0.32)",
    controlBorder: "#B9B3A6",
    accent: "#D7380F",
    onAccent: "#FFFFFF",
    accentText: "#FF7A5C",
    danger: "#FF8A7A",
    dangerBg: "#3A1E1A",
    disabledBg: "#2A332C",
    disabledInk: "#B9B3A6",
    skeleton: "#26302A",
    focus: "#F2EEE4",
  },
};

const VAR: Record<keyof BookingPalette, string> = {
  bg: "--bk-bg",
  surface: "--bk-surface",
  panel: "--bk-panel",
  ink: "--bk-ink",
  muted: "--bk-muted",
  soft: "--bk-soft",
  line: "--bk-line",
  lineStrong: "--bk-line-strong",
  controlBorder: "--bk-control-border",
  accent: "--bk-accent",
  onAccent: "--bk-on-accent",
  accentText: "--bk-accent-text",
  danger: "--bk-danger",
  dangerBg: "--bk-danger-bg",
  disabledBg: "--bk-disabled-bg",
  disabledInk: "--bk-disabled-ink",
  skeleton: "--bk-skeleton",
  focus: "--bk-focus",
};

/** Token references for inline styles, e.g. `color: bk.ink`. */
export const bk = Object.fromEntries(Object.entries(VAR).map(([k, v]) => [k, `var(${v})`])) as Record<keyof BookingPalette, string>;

/** Minimal radius (the existing `radius.swiss` scale): controls 6, cards 2. */
export const bkRadius = { control: 6, card: 2 } as const;

export const bkFonts = { display: fonts.display, body: fonts.body };

const SURFACE = `[data-surface="booking"]`;

function declarations(p: BookingPalette): string {
  return (Object.keys(VAR) as (keyof BookingPalette)[]).map((k) => `${VAR[k]}:${p[k]};`).join("");
}

/** The kit's whole stylesheet: tokens for light and dark (following the OS
 * unless the app's theme toggle has set data-theme on <html>, exactly like
 * index.css), plus the few rules inline styles can't express — focus rings,
 * breakpoints, the fixed mobile submit bar and reduced-motion handling.
 * `data-scheme` on the surface forces one scheme (the kit preview page). */
export function bookingSurfaceCss(): string {
  const dark = declarations(bookingPalette.dark);
  return [
    `${SURFACE}{${declarations(bookingPalette.light)}background:var(--bk-bg);color:var(--bk-ink);font-family:${bkFonts.body};}`,
    `@media (prefers-color-scheme: dark){:root:not([data-theme="light"]) ${SURFACE}:not([data-scheme="light"]){${dark}}}`,
    `:root[data-theme="dark"] ${SURFACE}:not([data-scheme="light"]),${SURFACE}[data-scheme="dark"]{${dark}}`,
    `${SURFACE} :focus-visible{outline:2px solid var(--bk-focus);outline-offset:2px;}`,
    `${SURFACE} a{color:var(--bk-accent-text);}`,
    // Hover (owner, 2026-10-22): main action goes a deeper orange, white text
    // kept; the outline secondary fills with ink.
    `@media (hover:hover){${SURFACE} .bk-btn--primary:hover:not(:disabled):not([aria-busy]){background:#BF300C!important;color:#FFFFFF!important;}${SURFACE} .bk-btn--secondary:hover:not(:disabled):not([aria-busy]){background:var(--bk-ink)!important;color:var(--bk-bg)!important;}}`,
    `${SURFACE} input,${SURFACE} select,${SURFACE} textarea,${SURFACE} button{font-family:inherit;}`,
    // Phone first: content, then the summary, with the submit bar fixed on
    // the tab bar (bottom: --bottom-nav) — BottomChromeSync measures it via
    // data-bottom-chrome so focused fields scroll clear of it.
    `.bk-shell{box-sizing:border-box;max-width:1120px;margin:0 auto;padding:12px 16px calc(132px + var(--bottom-nav));display:grid;gap:24px;}`,
    `.bk-main{display:flex;flex-direction:column;gap:22px;min-width:0;}`,
    `.bk-rail{min-width:0;}`,
    `.bk-submitbar{position:fixed;left:0;right:0;bottom:var(--bottom-nav);z-index:40;background:var(--bk-bg);border-top:1px solid var(--bk-line);padding:12px 16px 14px;}`,
    `.bk-submitbar-inner{max-width:1120px;margin:0 auto;display:flex;flex-direction:column;gap:8px;}`,
    `@media (min-width: 900px){.bk-shell{grid-template-columns:minmax(0,1fr) 360px;column-gap:72px;padding:32px 32px 64px;}.bk-rail{position:sticky;top:96px;align-self:start;}.bk-submitbar{position:static;background:transparent;border-top:none;padding:0;}.bk-submitbar-inner{margin:0;max-width:none;}}`,
    `@keyframes bk-pulse{0%,100%{opacity:1}50%{opacity:.55}}`,
    `@media (prefers-reduced-motion: no-preference){.bk-skeleton{animation:bk-pulse 1.4s ease-in-out infinite;}.bk-spin{animation:bk-spin .9s linear infinite;}}`,
    `@keyframes bk-spin{to{transform:rotate(360deg)}}`,
  ].join("\n");
}

/** WCAG 2.x contrast ratio between two opaque #RRGGBB colours. */
export function contrastRatio(a: string, b: string): number {
  const lum = (hex: string) => {
    const h = hex.replace("#", "");
    const [r, g, bl] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
