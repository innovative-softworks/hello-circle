// Every value below is a CSS custom property reference, not a literal hex —
// the actual light/dark values live in index.css's `:root` block (+ its
// `@media (prefers-color-scheme: dark)` override), so every one of this
// object's ~970 call sites across the app gets dark-mode support for free,
// with zero per-call-site changes. Two values were deliberately changed
// from their original hex here (see index.css's :root comment for the
// measured before/after): `mutedLight` and `faint` previously failed WCAG
// AA contrast at the sizes they're actually used at (3.73:1 and 2.56:1
// respectively, against a 4.5:1 requirement for body text) — this is the
// app's most-used secondary/metadata text color, not an edge case. `orange`
// and `orangeDark` were both deepened slightly for the same reason (white-
// on-orange button text was 3.38:1; orangeDark-on-orangeBg badge text was
// 4.36:1) — small enough shifts that the palette still reads as the same
// brand color, just legible. `surface` is new: card/panel backgrounds were
// hardcoded as a literal `"#fff"` at 171 call sites app-wide (never part of
// this object) rather than a token, meaning they'd stay pure white against
// a dark page background in dark mode. `ui.tsx`'s `Card` (this app's actual
// shared surface primitive) and this session's own newer components now use
// `colors.surface`; the remaining hand-rolled white boxes across older
// pages are a known, explicitly-flagged follow-up, not silently fixed.
export const colors = {
  bg: "var(--color-bg)",
  surface: "var(--color-surface)",
  text: "var(--color-text)",
  muted: "var(--color-muted)",
  mutedLight: "var(--color-muted-light)",
  faint: "var(--color-faint)",
  /** A third body-text tier, softer than `text` but stronger than `muted` —
   * see index.css's own token comment for the measured contrast rationale.
   * Reach for this for long-form paragraph copy that repeatedly hardcoded
   * `#3B423C` before this token existed. */
  textSoft: "var(--color-text-soft)",
  border: "var(--color-border)",
  borderStrong: "var(--color-border-strong)",
  inputBorder: "var(--color-input-border)",
  panel: "var(--color-panel)",
  footerBg: "var(--color-footer-bg)",

  green: "var(--color-green)",
  greenDark: "var(--color-green-dark)",
  greenBg: "var(--color-green-bg)",
  greenText: "var(--color-green-text)",

  orange: "var(--color-orange)",
  orangeDark: "var(--color-orange-dark)",
  orangeBg: "var(--color-orange-bg)",
  orangeBgHover: "var(--color-orange-bg-hover)",

  gold: "var(--color-gold)",
  dark: "var(--color-dark)",
  darkHover: "var(--color-dark-hover)",

  // Previously a hand-copied literal (#b00020 / #FBEAEA or #F6E3E3, two
  // slightly different reds for the same "error" role) in 23 files, never
  // part of this object — meaning it couldn't adapt to dark mode. Both call
  // sites now converge on one danger red.
  danger: "var(--color-danger)",
  dangerBg: "var(--color-danger-bg)",

  /** The sticky header's translucent backdrop-blur fill — its own token
   * (not `bg` + an opacity trick) since it needs a real `rgba()`, and
   * `rgba(var(--color-bg-rgb), .86)` isn't reliably available without also
   * defining bg as separate r/g/b channel variables. */
  headerBg: "var(--color-header-bg)",
};

export const fonts = {
  display: "'Bricolage Grotesque', system-ui, sans-serif",
  body: "'Hanken Grotesk', system-ui, sans-serif",
};

export const maxWidth = 1440;

/** Photo-overlay badge treatment (urgency/status pills sitting on top of a
 * hero image, e.g. "3 spots left" over a game/experience photo) —
 * deliberately NOT a CSS-var token: it tints over arbitrary photography, not
 * the page background, so it doesn't participate in light/dark theming the
 * way `colors.*` does. Was a repeated raw `rgba(232,163,58,.92)`/`#4A3400`
 * pair (goldBg/goldText) across Games.tsx, GameDetail.tsx,
 * ExperienceDetail.tsx, CircleDiscoveryCard.tsx, ExperienceKindBrowse.tsx,
 * DiscoverRow.tsx, plus a `rgba(255,255,255,.92)` neutral variant. */
export const photoOverlay = {
  goldBg: "rgba(232,163,58,.92)",
  goldText: "#4A3400",
  whiteBg: "rgba(255,255,255,.92)",
} as const;

/** Diagonal-stripe placeholder background for Photo's `ph` prop, used when a
 * listing has no real image yet — was a raw, copy-pasted gradient string in
 * 10 files. Three color pairs were already established by convention
 * (green default, blue for programs, orange for club sessions); `size`
 * controls stripe width (14px default everywhere except AuthShell's larger
 * photo panel, which used 18px). */
export function stripedPlaceholder(colorA: string, colorB: string, size = 14): string {
  return `repeating-linear-gradient(135deg,${colorA} 0 ${size}px,${colorB} ${size}px ${size * 2}px)`;
}

export const placeholderStripes = {
  green: stripedPlaceholder("#DDE8DA", "#E6EEE3"),
  blue: stripedPlaceholder("#D9E6EC", "#E4EDF1"),
  orange: stripedPlaceholder("#F5E1D3", "#FAEBE0"),
} as const;

/** Neutral categorical icon-tile colors for admin/vendor KPI stat rows
 * (StatTile) — distinguishes tiles by hue alone (not brand semantics like
 * green=success/orange=urgency), the same way a dashboard chart's series
 * colors would. Was an identical raw hex pair repeated in AdminDashboard.tsx
 * and VendorOverview.tsx with no shared name. */
export const statTile = {
  purple: { bg: "#F1E9FC", fg: "#7B4FCC" },
  blue: { bg: "#E9F0FC", fg: "#3B5FCC" },
  gold: { bg: "#FCF3D9", fg: "#B8860B" },
} as const;

// --- Design tokens (UI/UX plan phases 2 & 6) --------------------------------
// Previously nothing governed spacing/type/radius choices beyond hand-picked
// inline pixel values per call site — 309 borderRadius declarations across
// 255 distinct values, 21 different sizes used for a page's own <h1>, was
// the measured result. These are additive: nothing existing was migrated to
// use them yet (a mechanical, low-risk follow-up), but all new/touched code
// should reach for these instead of a fresh hand-picked number.

/** 4px-based spacing scale — most of the app's existing inline padding/gap
 * values already round to something close to one of these; naming it stops
 * further drift rather than requiring an immediate rewrite. */
export const space = {
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 24,
  6: 32,
  7: 48,
  8: 64,
  9: 96,
} as const;

/** A 4-step type scale — this app doesn't do long-form article content that
 * would justify a denser scale. `hero` is for a page's own primary <h1>
 * only; everything one level below a page title should use `section`. */
export const type = {
  hero: { size: 38, weight: 800 },
  section: { size: 28, weight: 700 },
  card: { size: 20, weight: 700 },
  label: { size: 15, weight: 600 },
} as const;

/** Named radii — `999` (the "pill" shape) was already the one radius value
 * this codebase converged on consistently (46 uses); `control`/`card` name
 * the two other real shapes in use so new code stops picking a fresh number
 * each time. */
export const radius = {
  control: 10,
  card: 16,
  pill: 999,
  /** Home.tsx's own tighter, deliberately different "Swiss" section style —
   * centrally tracked here (post-audit hardening pass) instead of as
   * page-local magic numbers, without forcing that page onto the
   * control/card/pill scale above, which would visibly change its design. */
  swiss: {
    /** Home.tsx's SWISS_RADIUS. */
    control: 6,
    /** Home.tsx's SWISS_CARD_RADIUS — several sharp-cornered banners/rows. */
    card: 2,
    /** Home.tsx's MOOD_TILE_RADIUS — the rounder mood-chip tiles specifically. */
    moodTile: 14,
  },
} as const;

/** Canonical breakpoints — index.css's actual `@media` queries are the
 * source of truth (CSS can't import a JS constant), kept in sync with these
 * by hand; this object exists so any future JS-side viewport logic (e.g. a
 * `matchMedia` call) references the same numbers instead of a fresh guess.
 * `tabletWide` (900) was added post-audit — index.css already used 900 (and
 * its +1 min-width companion, 901) in several places with no corresponding
 * token at all; `minWidth()` below covers that "+1" pairing without needing
 * a separate named constant per breakpoint. `narrowMobile` (560, design-
 * system unification pass) names a real second mobile-range cutover
 * index.css already used (Stepper's label truncation on very narrow
 * phones) with no token at all — narrower than `mobile`, so a distinct step
 * rather than something to force onto the same 640 value sight-unseen. */
export const breakpoints = {
  narrowMobile: 560,
  mobile: 640,
  tablet: 860,
  tabletWide: 900,
  desktop: 1024,
} as const;

/** The min-width companion of a max-width breakpoint above, e.g. for a
 * `@media (min-width: ...)` query that should pick up exactly where a
 * `(max-width: breakpoints.tablet)` query leaves off. */
export function minWidth(breakpoint: number): number {
  return breakpoint + 1;
}

/** Named z-index scale (post-audit hardening pass), listed low to high in
 * actual stacking order. Before this, every file picked a fresh round
 * number by imitation — the same value (400) backed two unrelated overlays,
 * and `1` alone covered at least four unrelated decorative layers. This
 * names the stacking order that was already implicitly in use rather than
 * renumbering it — existing raw values matching one of these still work,
 * migrate call sites to the token incrementally. */
export const zIndex = {
  /** Card-internal overlay layers (photo captions, gradient scrims) — never
   * needs to beat page chrome. */
  decorative: 1,
  /** Sticky headers/filter bars/cookie notice. */
  sticky: 50,
  /** Dropdown menus anchored to sticky chrome — must beat it. */
  dropdown: 60,
  /** Fullscreen photo lightbox. */
  lightbox: 200,
  /** Mobile bottom tab bar + its sticky join bar — floats above a lightbox
   * so it stays reachable even mid-gallery. */
  mobileBar: 250,
  /** Slide-over Drawer / NavSidebar panels. */
  drawer: 300,
  /** ConfirmDialog and other centered modals — always wins, since a confirm
   * can fire from inside an already-open Drawer. */
  modal: 400,
} as const;
