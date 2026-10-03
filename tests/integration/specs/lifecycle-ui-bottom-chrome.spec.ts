import type { Page } from "@playwright/test";
import { expect, personas } from "../fixtures";
import { evidence } from "../authorization-fixture";
import { test, withActors, createActivity, createCircle, rows } from "../lifecycle-fixture";
import { uiActor } from "../lifecycle-ui-fixture";

// HC-QA-001 — fixed bottom chrome (mobile tab bar, join bars, compare tray)
// vs. the cookie consent banner and other bottom surfaces. Real React/Vite +
// Express + isolated MySQL; consent semantics unchanged (localStorage values).

type Box = { top: number; bottom: number; height: number; width: number };
async function box(page: Page, selector: string): Promise<Box | null> {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el || getComputedStyle(el).display === "none") return null;
    const r = el.getBoundingClientRect();
    return { top: Math.round(r.top), bottom: Math.round(r.bottom), height: Math.round(r.height), width: Math.round(r.width) };
  }, selector);
}
/** Real hit-test at the element's centre (what a tap/click reaches). */
const reachable = (page: Page, locator: ReturnType<Page["getByRole"]>) =>
  locator.evaluate((el) => { const r = el.getBoundingClientRect(); const t = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!t && (t === el || el.contains(t)); });
/** Scroll to the true end of the page once content has finished loading. */
async function scrollToEnd(page: Page) {
  await page.waitForLoadState("networkidle");
  let last = -1;
  for (let i = 0; i < 10; i++) {
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForTimeout(300);
    const y = await page.evaluate(() => Math.round(window.scrollY));
    if (y === last) return;
    last = y;
  }
}
const BANNER = '[aria-label="Cookie preferences"]';
const consentButtons = (page: Page) => [page.getByRole("button", { name: "Necessary only", exact: true }), page.getByRole("button", { name: "Accept", exact: true })];

test("HC-QA-001-CONSENT: banner clear of the tab bar, reachable, keyboard-accessible; accept/reject/reopen at mobile sizes", async ({ browser }) => {
  test.setTimeout(150_000);
  const facts: Record<string, unknown> = {};
  for (const [name, vp] of [["small", "small"], ["390x844", "mobile"], ["large", "large"], ["short", "short"]] as const) {
    const sizes = { small: { width: 320, height: 568 }, mobile: { width: 390, height: 844 }, large: { width: 430, height: 932 }, short: { width: 390, height: 420 } };
    const ui = await uiActor(browser, null, "mobile", { consent: false });
    try {
      const { page } = ui;
      await page.setViewportSize(sizes[vp]);
      await page.goto("/");
      await expect(page.locator(BANNER)).toBeVisible();
      await page.waitForTimeout(400);
      const bar = await box(page, ".mobile-tab-bar"), banner = await box(page, BANNER);
      expect(bar, `${name}: tab bar visible`).not.toBeNull();
      expect(banner!.bottom, `${name}: banner sits above the tab bar`).toBeLessThanOrEqual(bar!.top - 8);
      for (const button of consentButtons(page)) {
        await button.scrollIntoViewIfNeeded(); // short heights: banner scrolls internally
        expect(await reachable(page, button), `${name}: consent button not obstructed`).toBe(true);
        const b = (await button.boundingBox())!;
        expect(b.height, `${name}: touch target height`).toBeGreaterThanOrEqual(32);
        expect(b.y + b.height, `${name}: button above tab bar`).toBeLessThanOrEqual(bar!.top);
      }
      // Keyboard: Learn more is a real link; Tab moves to Necessary only, visibly focused and unobstructed.
      const learn = page.locator(BANNER).getByRole("link", { name: "Learn more" });
      await learn.focus();
      await page.keyboard.press("Tab");
      const necessary = consentButtons(page)[0];
      await expect(necessary).toBeFocused();
      expect(await necessary.evaluate(el => getComputedStyle(el).outlineStyle)).not.toBe("none");
      expect(await reachable(page, necessary)).toBe(true);
      await page.keyboard.press("Tab");
      await expect(consentButtons(page)[1]).toBeFocused();
      // Reject with the keyboard: semantics unchanged.
      await page.keyboard.press("Shift+Tab");
      await page.keyboard.press("Enter");
      await expect(page.locator(BANNER)).toHaveCount(0);
      expect(await page.evaluate(() => localStorage.getItem("hello_circle_cookie_consent"))).toBe("rejected");
      expect(await page.evaluate(() => document.body.style.paddingBottom)).toBe("");
      // Reopen from the Cookie Policy, then accept by tap.
      await page.goto("/cookies");
      const change = page.getByRole("button", { name: "Change my cookie choice" });
      await change.scrollIntoViewIfNeeded();
      expect(await reachable(page, change), `${name}: change-choice not under the tab bar`).toBe(true);
      await change.click();
      await expect(page.locator(BANNER)).toBeVisible();
      await consentButtons(page)[1].scrollIntoViewIfNeeded();
      await consentButtons(page)[1].click();
      await expect(page.locator(BANNER)).toHaveCount(0);
      expect(await page.evaluate(() => localStorage.getItem("hello_circle_cookie_consent"))).toBe("accepted");
      facts[name] = { barTop: bar!.top, barHeight: bar!.height, bannerBottom: banner!.bottom, bannerHeight: banner!.height };
    } finally { await ui.close(); }
  }
  await evidence("hc-qa-001-consent", { viewports: JSON.stringify(facts) });
});

test("HC-QA-001-STACK: join bars sit on the tab bar, the banner above both, and every bottom control stays usable", async ({ playwright, browser }) => {
  test.setTimeout(180_000);
  await withActors(playwright, ["QA_HOST"], async f => {
    const game = await createActivity(f, "QA_HOST");
    const circle = await createCircle(f, "QA_HOST", { joinMode: "open" });
    const facts: Record<string, unknown> = {};
    for (const [label, size] of [["tablet-820", { width: 820, height: 1180 }], ["no-tabbar-880", { width: 880, height: 900 }], ["390x844", { width: 390, height: 844 }]] as const) {
      const ui = await uiActor(browser, "QA_USER", "mobile", { consent: false });
      try {
        const { page } = ui;
        await page.setViewportSize(size);
        const hasBar = size.width <= 860;
        const stack: Record<string, unknown> = {};
        for (const [route, cta] of [[`/games/${game.id}`, "Join"], [`/circles/${circle.slug}`, "Join Circle"]] as const) {
          await page.goto(route);
          const join = page.locator(".mobile-join-bar").getByRole("button", { name: cta, exact: true });
          await expect(join).toBeVisible();
          await page.waitForTimeout(400);
          const bar = await box(page, ".mobile-tab-bar"), joinBar = await box(page, ".mobile-join-bar"), banner = await box(page, BANNER);
          const innerHeight: number = await page.evaluate(() => window.innerHeight);
          if (hasBar) expect(Math.abs(joinBar!.bottom - bar!.top), `${label} ${route}: join bar sits on the tab bar`).toBeLessThanOrEqual(1);
          else expect(Math.abs(joinBar!.bottom - innerHeight), `${label} ${route}: join bar on the bottom edge without a tab bar`).toBeLessThanOrEqual(1);
          expect(banner!.bottom, `${label} ${route}: banner above the join bar`).toBeLessThanOrEqual(joinBar!.top - 8);
          expect(await reachable(page, join), `${label} ${route}: join CTA reachable`).toBe(true);
          for (const b of consentButtons(page)) expect(await reachable(page, b), `${label} ${route}: consent reachable`).toBe(true);
          const chrome = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--bottom-chrome").trim());
          expect(Number.parseInt(chrome), `${label} ${route}: --bottom-chrome = whole stack`).toBe(innerHeight - joinBar!.top);
          stack[route.startsWith("/games") ? "activity" : "circle"] = { barTop: bar?.top ?? null, joinTop: joinBar!.top, joinBottom: joinBar!.bottom, bannerBottom: banner!.bottom, chrome };
        }
        // The activity join CTA works through the join bar (lifecycle unaffected) — last, as it changes the CTA.
        if (label === "390x844") {
          await page.goto(`/games/${game.id}`);
          await page.locator(".mobile-join-bar").getByRole("button", { name: "Join", exact: true }).click();
          await page.getByRole("button", { name: "Confirm I'm in" }).click();
          await expect.poll(async () => (await rows(f, "SELECT status FROM game_participants WHERE game_id = ? AND resident_id = ?", [game.id, personas.QA_USER.id])).map(r => r.status)).toEqual(["joined"]);
        }
        // The Browse compare tray (centres) shares the fix (bottom: var(--bottom-nav), data-bottom-chrome)
        // but /browse/centres is behind the venue launch-gate carve-out here, so it isn't UI-reachable.
        facts[label] = stack;
      } finally { await ui.close(); }
    }
    await evidence("hc-qa-001-stack", { viewports: JSON.stringify(facts) });
  });
});

test("HC-QA-001-NAV: tab bar navigation, bottom sheet, scroll clearance and desktop unchanged", async ({ browser }) => {
  test.setTimeout(120_000);
  const facts: Record<string, unknown> = {};
  const mobile = await uiActor(browser, "QA_USER", "mobile", { consent: false });
  try {
    const { page } = mobile;
    await page.goto("/home");
    const tabs = page.locator(".mobile-tab-bar").getByRole("button");
    expect(await tabs.count()).toBe(5);
    const heights: number[] = [];
    for (let i = 0; i < 5; i++) heights.push(Math.round((await tabs.nth(i).boundingBox())!.height));
    expect(Math.min(...heights), "tab touch targets").toBeGreaterThanOrEqual(44);
    // Navigation + active state with the banner present.
    await page.locator(".mobile-tab-bar").getByRole("button", { name: "Circles" }).click();
    await expect(page).toHaveURL(/\/circles$/);
    const colours = await tabs.evaluateAll(els => els.map(e => getComputedStyle(e).color));
    expect(new Set(colours).size, "one tab rendered as active").toBe(2);
    // Bottom sheet opens above the banner and its items are reachable.
    await page.locator(".mobile-tab-bar").getByRole("button", { name: "Explore" }).click();
    const games = page.getByRole("button", { name: "Join a session", exact: true });
    await expect(games).toBeVisible();
    await page.waitForTimeout(600); // let the sheet-in slide animation finish before hit-testing
    expect(await reachable(page, games), "bottom sheet item above banner/tab bar").toBe(true);
    await games.click();
    await expect(page).toHaveURL(/\/games$/);
    // Scroll clearance: at the bottom of a long page, the last content clears the banner and the tab bar.
    await page.goto("/circles");
    await scrollToEnd(page);
    const clearance = await page.evaluate(() => {
      const banner = document.querySelector('[aria-label="Cookie preferences"]')!.getBoundingClientRect();
      const footer = document.querySelector("footer");
      const last = ((footer?.firstElementChild as Element | null) ?? document.querySelector("main")!).getBoundingClientRect(); // footer content, not its chrome padding
      return { lastBottom: Math.round(last.bottom), bannerTop: Math.round(banner.top) };
    });
    await evidence("hc-qa-001-clearance", { withBanner: JSON.stringify(clearance) });
    expect(clearance.lastBottom, "page content scrolls clear of the banner").toBeLessThanOrEqual(clearance.bannerTop);
    await page.getByRole("button", { name: "Necessary only", exact: true }).click();
    await scrollToEnd(page);
    const noBanner = await page.evaluate(() => {
      const bar = document.querySelector(".mobile-tab-bar")!.getBoundingClientRect();
      const footer = document.querySelector("footer");
      const last = ((footer?.firstElementChild as Element | null) ?? document.querySelector("main")!).getBoundingClientRect(); // footer content, not its chrome padding
      return { lastBottom: Math.round(last.bottom), barTop: Math.round(bar.top), fixed: getComputedStyle(document.querySelector(".mobile-tab-bar")!).position };
    });
    expect(noBanner.fixed).toBe("fixed");
    expect(noBanner.lastBottom, "page content scrolls clear of the tab bar").toBeLessThanOrEqual(noBanner.barTop);
    facts.mobile = { tabHeights: heights.join(","), clearance: JSON.stringify(clearance), noBanner: JSON.stringify(noBanner) };
  } finally { await mobile.close(); }
  // Desktop: no tab bar, no reserved bottom space, banner where it always was.
  const desktop = await uiActor(browser, null, "desktop", { consent: false });
  try {
    const { page } = desktop;
    await page.goto("/");
    await expect(page.locator(BANNER)).toBeVisible();
    await page.waitForTimeout(600); // pop-in entrance animation
    const d = await page.evaluate(() => {
      const banner = document.querySelector('[aria-label="Cookie preferences"]')!.getBoundingClientRect();
      const space = document.querySelector(".mobile-tab-bar-space");
      return { bannerGap: Math.round(innerHeight - banner.bottom), chrome: getComputedStyle(document.documentElement).getPropertyValue("--bottom-chrome").trim(), tabBar: !!document.querySelector(".mobile-tab-bar") && getComputedStyle(document.querySelector(".mobile-tab-bar")!).display !== "none", spacePadding: space ? getComputedStyle(space).paddingBottom : "none" };
    });
    expect(d.tabBar).toBe(false);
    expect(d.bannerGap, "desktop banner 16px from the edge, as before").toBe(16);
    expect(["0px", "none"]).toContain(d.spacePadding);
    for (const b of consentButtons(page)) expect(await reachable(page, b)).toBe(true);
    facts.desktop = d;
  } finally { await desktop.close(); }
  await evidence("hc-qa-001-nav", { facts: JSON.stringify(facts) });
});
