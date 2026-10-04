import type { Page } from "@playwright/test";
import { expect } from "../fixtures";
import { evidence } from "../authorization-fixture";
import { test } from "../lifecycle-fixture";
import { uiActor } from "../lifecycle-ui-fixture";

// Phase 12 — HC-QA-071 (form control non-text contrast ≥ 3:1) and HC-QA-072
// (dark-mode text contrast ≥ 4.5:1, theme-bypassing colours), measured from the
// rendered page in both themes. WCAG-oriented automated checks only.

async function contrastFacts(page: Page) {
  return page.evaluate(() => {
    const parse = (c: string) => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const [r, g, b, a = "1"] = m[1].split(",").map((x) => x.trim()); return { r: +r, g: +g, b: +b, a: +a }; };
    const lum = ({ r, g, b }: { r: number; g: number; b: number }) => { const f = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
    const ratio = (a: string, b: string) => { const x = parse(a), y = parse(b); if (!x || !y) return 0; const [l1, l2] = [lum(x), lum(y)].sort((p, q) => q - p); return +(((l1 + 0.05) / (l2 + 0.05)).toFixed(2)); };
    const bgOf = (el: Element | null): string => { while (el) { const c = getComputedStyle(el).backgroundColor; const p = parse(c); if (p && p.a > 0.5) return c; el = el.parentElement; } return getComputedStyle(document.body).backgroundColor; };
    const varColor = (name: string) => { const probe = document.createElement("span"); probe.style.color = `var(${name})`; document.body.appendChild(probe); const c = getComputedStyle(probe).color; probe.remove(); return c; };
    const input = document.querySelector("input[type=email], input[type=text], input[type=password]") as HTMLElement | null;
    const bg = varColor("--color-bg"), surface = getComputedStyle(document.body).backgroundColor;
    return {
      inputBorderVsBehind: input ? ratio(getComputedStyle(input).borderTopColor, bgOf(input.parentElement)) : 0,
      inputBorderTokenVsBg: ratio(varColor("--color-input-border"), bg),
      inputBorderTokenVsSurface: ratio(varColor("--color-input-border"), varColor("--color-surface")),
      greenTextVsBg: ratio(varColor("--color-green-text"), bg),
      orangeDarkVsBg: ratio(varColor("--color-orange-dark"), bg),
      textSoftVsBg: ratio(varColor("--color-text-soft"), bg),
      faintVsBg: ratio(varColor("--color-faint"), bg),
      mutedLightVsBg: ratio(varColor("--color-muted-light"), bg),
      dangerVsBg: ratio(varColor("--color-danger"), bg),
      whiteOnDangerSolid: ratio("rgb(255, 255, 255)", varColor("--color-danger-solid")),
      bodyBg: surface,
    };
  });
}

for (const scheme of ["light", "dark"] as const) {
  test(`HC-QA-071/072-${scheme.toUpperCase()}: form borders ≥ 3:1, text tokens ≥ 4.5:1, filled danger readable, themed logo (${scheme})`, async ({ browser }) => {
    const ui = await uiActor(browser, null, "desktop");
    try {
      const { page } = ui;
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto("/signin");
      await page.waitForLoadState("networkidle").catch(() => {});
      const facts = await contrastFacts(page);
      await page.goto("/explore");
      const logo = await page.locator("header img[alt='Hello Circle']").first().getAttribute("src");
      await evidence(`hc-qa-071-072-${scheme}`, { ...facts, logo: logo ?? "none" });
      expect(facts.inputBorderVsBehind, "rendered input border vs what's behind it").toBeGreaterThanOrEqual(3);
      expect(facts.inputBorderTokenVsBg).toBeGreaterThanOrEqual(3);
      expect(facts.inputBorderTokenVsSurface).toBeGreaterThanOrEqual(3);
      for (const k of ["greenTextVsBg", "orangeDarkVsBg", "textSoftVsBg", "faintVsBg", "mutedLightVsBg", "dangerVsBg", "whiteOnDangerSolid"] as const) {
        expect(facts[k], k).toBeGreaterThanOrEqual(4.5);
      }
      expect(logo, "wordmark readable in this theme").toBe(scheme === "dark" ? "/illustrations/Logo-dark.svg" : "/illustrations/Logo.svg");
    } finally { await ui.close(); }
  });
}
