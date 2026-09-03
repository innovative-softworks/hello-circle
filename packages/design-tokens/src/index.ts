// Moved from client/src/theme.ts — everything here is portable literal
// data (numbers/strings/functions), shared as-is between the web client and
// apps/mobile. `colors` is NOT here — see ./colors.ts and the note in
// client/src/theme.ts for why (web's colors are CSS custom-property
// references with no RN equivalent).

export const fonts = {
  display: "'Bricolage Grotesque', system-ui, sans-serif",
  body: "'Hanken Grotesk', system-ui, sans-serif",
};

export const maxWidth = 1440;

/** Photo-overlay badge treatment (urgency/status pills sitting on top of a
 * hero image) — deliberately not a themeable token, tints over arbitrary
 * photography rather than the page background. */
export const photoOverlay = {
  goldBg: "rgba(232,163,58,.92)",
  goldText: "#4A3400",
  whiteBg: "rgba(255,255,255,.92)",
} as const;

/** Discovery/listing card image aspect ratios. */
export const cardImageRatio = {
  discovery: "16/10",
  compact: "4/3",
  horizontal: "3/2",
  hero: "16/6",
} as const;

/** Diagonal-stripe placeholder background generator, used when a listing
 * has no real image yet. */
export function stripedPlaceholder(colorA: string, colorB: string, size = 14): string {
  return `repeating-linear-gradient(135deg,${colorA} 0 ${size}px,${colorB} ${size}px ${size * 2}px)`;
}

export const placeholderStripes = {
  green: stripedPlaceholder("#DDE8DA", "#E6EEE3"),
  blue: stripedPlaceholder("#D9E6EC", "#E4EDF1"),
  orange: stripedPlaceholder("#F5E1D3", "#FAEBE0"),
} as const;

/** Neutral categorical icon-tile colors for admin/vendor KPI stat rows. */
export const statTile = {
  purple: { bg: "#F1E9FC", fg: "#7B4FCC" },
  blue: { bg: "#E9F0FC", fg: "#3B5FCC" },
  gold: { bg: "#FCF3D9", fg: "#B8860B" },
} as const;

/** 4px-based spacing scale. */
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

/** A 4-step type scale. `hero` is for a page's own primary heading only;
 * everything one level below should use `section`. */
export const type = {
  hero: { size: 38, weight: 800 },
  section: { size: 28, weight: 700 },
  card: { size: 20, weight: 700 },
  label: { size: 15, weight: 600 },
} as const;

/** Named radii. */
export const radius = {
  control: 10,
  card: 16,
  pill: 999,
  swiss: {
    control: 6,
    card: 2,
    moodTile: 14,
  },
} as const;

/** Canonical breakpoints — meaningful for the web client's own `@media`
 * queries; apps/mobile has no direct use for these today (RN doesn't do
 * viewport-width breakpoints the same way) but they're kept here rather
 * than duplicated, in case a tablet-size split is ever needed. */
export const breakpoints = {
  narrowMobile: 560,
  mobile: 640,
  tablet: 860,
  tabletWide: 900,
  desktop: 1024,
} as const;

export function minWidth(breakpoint: number): number {
  return breakpoint + 1;
}

/** Named z-index scale, listed low to high in actual stacking order. */
export const zIndex = {
  decorative: 1,
  sticky: 50,
  dropdown: 60,
  lightbox: 200,
  mobileBar: 250,
  drawer: 300,
  modal: 400,
} as const;
