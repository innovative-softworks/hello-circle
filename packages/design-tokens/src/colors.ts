// Literal hex color tokens for apps/mobile only — React Native has no CSS
// engine, so it can't use client/src/theme.ts's `colors` (which are all
// `var(--color-*)` references). Hand-copied from client/src/index.css's
// `:root` and `@media (prefers-color-scheme: dark)` blocks.
//
// IMPORTANT: these must be kept in sync BY HAND with client/src/index.css —
// there is no build step generating one from the other (a reasonable
// Phase 2+ improvement, not built now). If you change a color in index.css,
// mirror the change here, and vice versa.

export const lightColors = {
  bg: "#fbfaf7",
  surface: "#ffffff",
  text: "#1e2420",
  muted: "#5b635c",
  mutedLight: "#5f675e",
  faint: "#656d64",
  textSoft: "#3b423c",
  border: "#e7e4dc",
  borderStrong: "#d8d4cb",
  inputBorder: "#d8d4cb",
  panel: "#f0eee8",
  footerBg: "#f6f4ef",

  green: "#1e7a4c",
  greenDark: "#175f3b",
  greenBg: "#eaf4ee",
  greenText: "#175f3b",

  orange: "#c74c1a",
  orangeDark: "#b0401a",
  orangeBg: "#fcede4",
  orangeBgHover: "#f8ddcc",

  gold: "#e8a33a",
  dark: "#1e2420",
  darkHover: "#252d27",

  danger: "#b00020",
  dangerBg: "#fbeaea",

  headerBg: "rgba(251, 250, 247, 0.86)",

  logoMark: "#ee4826",
  logoMarkText: "#c72f10",
} as const;

export const darkColors = {
  bg: "#15181a",
  surface: "#1d2220",
  text: "#ecefe9",
  muted: "#b6bcb1",
  mutedLight: "#a3a99d",
  faint: "#8b9289",
  textSoft: "#c7cdc0",
  border: "#2b302d",
  borderStrong: "#3b423d",
  inputBorder: "#3b423d",
  panel: "#1d2220",
  footerBg: "#1a1e1c",

  green: "#1e7a4c",
  greenDark: "#175f3b",
  greenBg: "#1c3327",
  greenText: "#7fd3a5",

  orange: "#c74c1a",
  orangeDark: "#f0996a",
  orangeBg: "#3a2517",
  orangeBgHover: "#472d1c",

  gold: "#e8a33a",
  dark: "#444d46",
  darkHover: "#525c54",

  danger: "#e37272",
  dangerBg: "#3a1f1f",

  headerBg: "rgba(21, 24, 26, 0.86)",

  logoMark: "#ee4826",
  logoMarkText: "#f27359",
} as const;

export type ColorTokens = typeof lightColors;
