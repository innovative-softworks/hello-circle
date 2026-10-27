import { maxWidth } from "../../theme";
// Batch 2 (2026-10-22): the same page width as the header and every other
// page (theme.ts maxWidth), so these sections line up with the logo.
export const FV_MAX_WIDTH = maxWidth;

// This page runs its own bolder editorial visual language (see the 2026-08-30
// redesign brief) — a single vivid accent distinct from the app's semantic
// green/orange, reserved for this page only. Deliberately a raw hex, not a
// `colors.*` token: it's a one-off brand-poster accent for this landing page,
// not a themed UI color that should shift with light/dark mode the way
// `colors.orange` does elsewhere in the app.
// Design-system consistency pass: shared brand tokens, not a private hex.
// FV_ACCENT is the bright brand orange (backgrounds, large display type);
// FV_ACCENT_DARK is the accessible deep orange for small text.
export const FV_ACCENT = "var(--color-brand)";
export const FV_ACCENT_DARK = "var(--color-orange)";

// Small monospace stack used for the hero's utility strip and the rotated
// hero-photo tag — a deliberate "technical/utility label" texture borrowed
// from the reference brief, system-stack only (no new font import).
export const FV_MONO = 'ui-monospace, "SF Mono", "Roboto Mono", Menlo, monospace';
