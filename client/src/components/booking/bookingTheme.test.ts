import { describe, expect, it } from "vitest";
import { bookingPalette, bookingSurfaceCss, contrastRatio, type BookingPalette } from "./bookingTheme";

// UX plan Q21 — every text/background pairing the kit actually uses meets
// WCAG AA (4.5:1 text, 3:1 for UI boundaries like focus rings and control
// borders), in both schemes, computed from the same values the CSS is built from.
const TEXT_PAIRS: [keyof BookingPalette, keyof BookingPalette][] = [
  ["ink", "bg"], ["ink", "surface"], ["ink", "panel"],
  ["muted", "bg"], ["muted", "surface"], ["muted", "panel"],
  ["soft", "panel"], ["soft", "surface"],
  ["accentText", "bg"], ["accentText", "surface"],
  ["onAccent", "accent"],
  ["danger", "surface"], ["danger", "bg"], ["danger", "dangerBg"],
  ["disabledInk", "disabledBg"],
];
const UI_PAIRS: [keyof BookingPalette, keyof BookingPalette][] = [
  ["focus", "bg"], ["focus", "surface"], ["controlBorder", "surface"], ["accent", "bg"],
];

describe("booking kit palette", () => {
  for (const scheme of ["light", "dark"] as const) {
    const p = bookingPalette[scheme];
    for (const [fg, bg] of TEXT_PAIRS) {
      it(`${scheme}: ${fg} on ${bg} is at least 4.5:1`, () => {
        expect(contrastRatio(p[fg], p[bg])).toBeGreaterThanOrEqual(4.5);
      });
    }
    for (const [fg, bg] of UI_PAIRS) {
      it(`${scheme}: ${fg} against ${bg} is at least 3:1`, () => {
        expect(contrastRatio(p[fg], p[bg])).toBeGreaterThanOrEqual(3);
      });
    }
  }

  it("never uses the brand orange as light-mode text (it fails AA on cream)", () => {
    expect(contrastRatio(bookingPalette.light.accent, bookingPalette.light.bg)).toBeLessThan(4.5);
    expect(bookingPalette.light.accentText).not.toBe(bookingPalette.light.accent);
  });

  it("scopes every token to booking surfaces and follows the app's theme toggle", () => {
    const css = bookingSurfaceCss();
    expect(css).toContain(`[data-surface="booking"]{--bk-bg:#F7F4EC;`);
    expect(css).toContain(`:root:not([data-theme="light"]) [data-surface="booking"]:not([data-scheme="light"])`);
    expect(css).toContain(`:root[data-theme="dark"] [data-surface="booking"]:not([data-scheme="light"])`);
    expect(css).toContain(`[data-surface="booking"][data-scheme="dark"]`);
    // Nothing leaks onto :root or body.
    expect(css).not.toMatch(/(^|[},])\s*(:root|body)\s*\{/);
  });
});
