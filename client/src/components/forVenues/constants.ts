// The app's shared theme.ts `maxWidth` (1440) stays as-is for every other
// page — this page alone narrows to ~1240px, matching the grid spec this
// page's design direction was built against, without touching the shared
// token every other page still reads.
export const FV_MAX_WIDTH = 1440;

// This page runs its own bolder editorial visual language (see the 2026-08-30
// redesign brief) — a single vivid accent distinct from the app's semantic
// green/orange, reserved for this page only. Deliberately a raw hex, not a
// `colors.*` token: it's a one-off brand-poster accent for this landing page,
// not a themed UI color that should shift with light/dark mode the way
// `colors.orange` does elsewhere in the app.
export const FV_ACCENT = "#FF4A1F";
export const FV_ACCENT_DARK = "#D93C15";

// Small monospace stack used for the hero's utility strip and the rotated
// hero-photo tag — a deliberate "technical/utility label" texture borrowed
// from the reference brief, system-stack only (no new font import).
export const FV_MONO = 'ui-monospace, "SF Mono", "Roboto Mono", Menlo, monospace';
