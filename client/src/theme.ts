// fonts/space/type/radius/breakpoints/zIndex/etc. moved to
// packages/design-tokens (shared with apps/mobile) — re-exported here so
// every existing `from "./theme"` import keeps working unchanged.
export * from "@hello-circle/design-tokens";

// `colors` stays here, NOT in the shared package: every value below is a CSS
// custom property reference, not a literal hex — the actual light/dark
// values live in index.css's `:root` block (+ its
// `@media (prefers-color-scheme: dark)` override), so every one of this
// object's ~970 call sites across the app gets dark-mode support for free,
// with zero per-call-site changes. React Native has no CSS engine, so this
// mechanism doesn't port — apps/mobile uses
// packages/design-tokens/src/colors.ts's literal lightColors/darkColors
// instead, hand-kept in sync with index.css (see that file's own note).
//
// Two values were deliberately changed from their original hex here (see
// index.css's :root comment for the measured before/after): `mutedLight` and
// `faint` previously failed WCAG AA contrast at the sizes they're actually
// used at (3.73:1 and 2.56:1 respectively, against a 4.5:1 requirement for
// body text) — this is the app's most-used secondary/metadata text color,
// not an edge case. `orange` and `orangeDark` were both deepened slightly
// for the same reason (white-on-orange button text was 3.38:1;
// orangeDark-on-orangeBg badge text was 4.36:1) — small enough shifts that
// the palette still reads as the same brand color, just legible. `surface`
// is new: card/panel backgrounds were hardcoded as a literal `"#fff"` at 171
// call sites app-wide (never part of this object) rather than a token,
// meaning they'd stay pure white against a dark page background in dark
// mode. `ui.tsx`'s `Card` (this app's actual shared surface primitive) and
// this session's own newer components now use `colors.surface`; the
// remaining hand-rolled white boxes across older pages are a known,
// explicitly-flagged follow-up, not silently fixed.
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

  /** The exact orange baked into Logo.svg's mark (the two swirl paths,
   * `.cls-2`) — a literal hex, not a `var(--color-*)` reference like every
   * other token here, because it names a fixed asset color rather than a
   * themeable UI color: Logo.svg has no dark-mode variant, so this never
   * changes with the theme either. Deliberately distinct from `orange`/
   * `orangeDark` (which were tuned for WCAG contrast as UI accent colors)
   * — reach for this only when a use is genuinely referencing the logo's
   * own brand mark, not as a substitute for the functional orange accent.
   * `#ee4826` itself fails normal-text AA contrast (~3.3-3.8:1) against
   * every realistic background — never use `logoMark` for text. */
  logoMark: "#ee4826",
  /** A text-safe derivative of `logoMark` — same hue/saturation, lightness
   * tuned per theme until it cleared 4.5:1+ with real margin (see
   * index.css's own token comment for the exact search). Use this, not
   * `logoMark`, wherever a badge/label wants the logo's brand-orange
   * character as actual text. */
  logoMarkText: "var(--color-logo-mark-text)",
};
