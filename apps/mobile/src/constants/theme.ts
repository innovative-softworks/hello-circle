/**
 * Light/dark palette, matching @hello-circle/design-tokens (shared with the
 * web client, see packages/design-tokens/src/colors.ts) value-for-value —
 * per explicit direction, mobile uses the same fonts/colours/style as web,
 * not an invented separate palette. Kept as a literal mobile-native object
 * (not an import of the shared package) so this file stays the single
 * source of truth for React Native's `StyleSheet`/`Text` API, which can't
 * consume web's CSS-custom-property color tokens — but the values below
 * must be kept in sync BY HAND with client/src/index.css's `:root`/dark
 * blocks, the same rule packages/design-tokens/src/colors.ts documents.
 */

import '@/global.css';

import { Platform } from 'react-native';

export const Colors = {
  light: {
    text: '#1e2420',
    background: '#fbfaf7',
    backgroundElement: '#ffffff',
    backgroundSelected: '#f0eee8',
    textSecondary: '#5b635c',
    primary: '#1e7a4c',
    primaryDark: '#175f3b',
    accent: '#c74c1a',
    border: '#e7e4dc',
    danger: '#b00020',
  },
  dark: {
    text: '#ecefe9',
    background: '#15181a',
    backgroundElement: '#1d2220',
    backgroundSelected: '#1d2220',
    textSecondary: '#b6bcb1',
    primary: '#1e7a4c',
    primaryDark: '#175f3b',
    accent: '#c74c1a',
    border: '#2b302d',
    danger: '#e37272',
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

// Bricolage Grotesque (display/headings) and Hanken Grotesk (body/UI) —
// matching packages/design-tokens's `fonts` and the web client's @font-face
// setup exactly, same brand faces used everywhere, no separate mobile-only
// typeface. Loaded on native via useFonts() in the root layout
// (apps/mobile/src/app/_layout.tsx) using @expo-google-fonts/* — family
// names below must match the useFonts() keys there exactly.
export const Fonts = Platform.select({
  web: {
    display: '"Bricolage Grotesque", ui-sans-serif, system-ui, sans-serif',
    displaySemibold: '"Bricolage Grotesque", ui-sans-serif, system-ui, sans-serif',
    displayExtraBold: '"Bricolage Grotesque", ui-sans-serif, system-ui, sans-serif',
    body: '"Hanken Grotesk", ui-sans-serif, system-ui, sans-serif',
    bodyMedium: '"Hanken Grotesk", ui-sans-serif, system-ui, sans-serif',
    bodySemibold: '"Hanken Grotesk", ui-sans-serif, system-ui, sans-serif',
    bodyBold: '"Hanken Grotesk", ui-sans-serif, system-ui, sans-serif',
    mono: 'var(--font-mono)',
  },
  default: {
    display: 'BricolageGrotesque_700Bold',
    displaySemibold: 'BricolageGrotesque_600SemiBold',
    displayExtraBold: 'BricolageGrotesque_800ExtraBold',
    body: 'HankenGrotesk_400Regular',
    bodyMedium: 'HankenGrotesk_500Medium',
    bodySemibold: 'HankenGrotesk_600SemiBold',
    bodyBold: 'HankenGrotesk_700Bold',
    mono: Platform.select({ ios: 'ui-monospace', default: 'monospace' }),
  },
});

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  seven: 48,
  six: 64,
} as const;

// Shape language: mostly subtle/straight, larger radius reserved for
// imagery, bottom sheets, and feature cards (spec §9) — never nested. Keep
// `control`/`pill` numerically identical to Button/Chip's pre-existing
// hardcoded values so adopting `Radius` there is a visual no-op.
export const Radius = {
  subtle: 4,
  control: 10,
  card: 16,
  pill: 999,
  sheet: 24,
} as const;

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 800;
