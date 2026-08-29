// Landing page design tokens — design-system unification pass: these used
// to be a fully separate palette/font pairing (Manrope/Inter, a slightly
// different green/orange/gold) with a comment arguing the landing page
// needed "a distinct premium/editorial identity, not the existing
// product's app-chrome palette." That directly worked against the wider
// brief this pass implements ("a user should recognize a HelloCircle
// screen even without seeing the logo") — a visitor could land on a page
// that reads as a different product before ever reaching the app.
//
// Every `lc`/`lcFonts` property name below is unchanged, so none of the
// ~15 landing/*.tsx call sites needed touching — only the values they
// point at now alias the real, shared design tokens, which also gives the
// landing page real dark-mode support for free (`colors.*` are CSS-var
// references, not literal hex — see ../theme.ts's own comment).
//
// Two exceptions, both deliberate: `white` stays a literal `#ffffff`
// rather than `colors.surface`, since it's used both for card backgrounds
// *and* for text/icon color on top of a colored button fill (green/ink) —
// the latter needs to stay literal white in dark mode too, the same way
// ui.tsx's own Button primary/dark variants always use `color: "#fff"`
// rather than a theme-following token. `goldBg`/`overlay` have no direct
// equivalent in the shared `colors` object (a light gold tint, a dark
// image-overlay scrim) and are kept as close hand-picked constants instead.
import { colors, fonts, maxWidth, radius } from "../theme";

export const lc = {
  ink: colors.text,
  inkSoft: colors.textSoft,
  paper: colors.bg,
  paperRaised: colors.panel,
  line: colors.border,
  lineStrong: colors.borderStrong,
  forest: colors.green,
  forestDark: colors.greenDark,
  forestBg: colors.greenBg,
  ember: colors.orange,
  emberBg: colors.orangeBg,
  gold: colors.gold,
  goldBg: "#fbf0dc",
  white: "#ffffff",
  overlay: "rgba(30, 36, 32, 0.55)",
};

export const lcFonts = {
  display: fonts.display,
  body: fonts.body,
};

export const lcMaxWidth = maxWidth;
export const lcRadius = radius;
