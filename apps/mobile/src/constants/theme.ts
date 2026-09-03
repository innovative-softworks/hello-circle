/**
 * Light/dark palette, sourced from @hello-circle/design-tokens (shared with
 * the web client, see packages/design-tokens/src/colors.ts) instead of the
 * generic Expo-template blue/gray — this is the real HelloCircle brand.
 */

import '@/global.css';

import { darkColors, lightColors } from '@hello-circle/design-tokens/src/colors';
import { Platform } from 'react-native';

export const Colors = {
  light: {
    text: lightColors.text,
    background: lightColors.bg,
    backgroundElement: lightColors.surface,
    backgroundSelected: lightColors.panel,
    textSecondary: lightColors.muted,
    primary: lightColors.green,
    primaryDark: lightColors.greenDark,
    accent: lightColors.orange,
    border: lightColors.border,
    danger: lightColors.danger,
  },
  dark: {
    text: darkColors.text,
    background: darkColors.bg,
    backgroundElement: darkColors.surface,
    backgroundSelected: darkColors.panel,
    textSecondary: darkColors.muted,
    primary: darkColors.green,
    primaryDark: darkColors.greenDark,
    accent: darkColors.orange,
    border: darkColors.border,
    danger: darkColors.danger,
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

// Real HelloCircle typefaces (Bricolage Grotesque / Hanken Grotesk, see
// packages/design-tokens's `fonts`) need bundled .ttf files via expo-font to
// render on native — deliberately deferred (system-font fallback below) per
// the Phase 1 plan; a small, explicitly-flagged polish item, not a blocker.
export const Fonts = Platform.select({
  ios: {
    sans: 'system-ui',
    serif: 'ui-serif',
    rounded: 'ui-rounded',
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: 'var(--font-display)',
    serif: 'var(--font-serif)',
    rounded: 'var(--font-rounded)',
    mono: 'var(--font-mono)',
  },
});

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 800;
