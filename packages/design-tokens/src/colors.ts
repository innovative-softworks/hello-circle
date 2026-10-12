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
  bg: "#f7f4ec",
  surface: "#ffffff",
  text: "#172019",
  muted: "#5b635c",
  mutedLight: "#5f675e",
  faint: "#656d64",
  textSoft: "#3b433c",
  border: "#e4dfd3",
  borderStrong: "#d3cdbf",
  inputBorder: "#8a857a",
  panel: "#efebe1",
  footerBg: "#f1ede3",

  green: "#1e7a4c",
  greenDark: "#175f3b",
  greenBg: "#eaf4ee",
  greenText: "#175f3b",

  orange: "#b8320f",
  orangeDark: "#9c2a0c",
  orangeBg: "#ffe9e1",
  orangeBgHover: "#ffd9cc",

  gold: "#e8a33a",
  dark: "#172019",
  darkHover: "#232e25",

  danger: "#b00020",
  dangerBg: "#fbeaea",

  headerBg: "rgba(247, 244, 236, 0.88)",

  logoMark: "#ee4826",
  logoMarkText: "#c72f10",

  brand: "#ff4b24",
  brandHover: "#ff6a49",
  onBrand: "#172019",
  night: "#172019",
  onNight: "#f7f4ec",
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
  inputBorder: "#6b736d",
  panel: "#1d2220",
  footerBg: "#1a1e1c",

  green: "#1e7a4c",
  greenDark: "#175f3b",
  greenBg: "#1c3327",
  greenText: "#7fd3a5",

  orange: "#ff7a59",
  orangeDark: "#ff9a7f",
  orangeBg: "#3a2016",
  orangeBgHover: "#4a291c",

  gold: "#e8a33a",
  dark: "#444d46",
  darkHover: "#525c54",

  danger: "#e37272",
  dangerBg: "#3a1f1f",

  headerBg: "rgba(21, 24, 26, 0.86)",

  logoMark: "#ee4826",
  logoMarkText: "#f27359",

  brand: "#ff4b24",
  brandHover: "#ff6a49",
  onBrand: "#172019",
  night: "#0e1310",
  onNight: "#f7f4ec",
} as const;

export type ColorTokens = typeof lightColors;
