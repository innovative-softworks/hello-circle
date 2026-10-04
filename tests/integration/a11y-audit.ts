import type { Page } from "@playwright/test";

// Phase 12 — WCAG-oriented structural checks (headings, landmarks). These are
// automated checks, not a substitute for a manual screen-reader audit.

export interface HeadingAudit { path: string; h1: number; h1Text: string; skips: string[]; main: number; levels: number[] }

/** Visible headings in DOM order: exactly one H1 expected, no level skips. */
export async function headingAudit(page: Page, path: string): Promise<HeadingAudit> {
  const r = await page.evaluate(() => {
    const visible = (el: Element) => {
      const s = getComputedStyle(el as HTMLElement);
      const rect = (el as HTMLElement).getBoundingClientRect();
      return s.display !== "none" && s.visibility !== "hidden" && (rect.width > 0 || rect.height > 0) && !(el as HTMLElement).closest("[aria-hidden='true']");
    };
    const hs = Array.from(document.querySelectorAll("h1,h2,h3,h4,h5,h6")).filter(visible);
    const levels = hs.map((h) => Number(h.tagName[1]));
    const skips: string[] = [];
    let prev = 0;
    for (let i = 0; i < levels.length; i++) {
      const l = levels[i];
      if (prev === 0 && l !== 1) skips.push(`first heading is h${l}`);
      else if (l > prev + 1) skips.push(`h${prev}→h${l} ("${(hs[i].textContent ?? "").trim().slice(0, 30)}")`);
      prev = l;
    }
    const h1s = hs.filter((h) => h.tagName === "H1");
    return { h1: h1s.length, h1Text: (h1s[0] as HTMLElement | undefined)?.innerText?.replace(/\s+/g, " ").trim() ?? "", skips, main: document.querySelectorAll("main").length, levels };
  });
  return { path, ...r };
}

export async function settle(page: Page, path: string) {
  await page.goto(path);
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(400);
}
