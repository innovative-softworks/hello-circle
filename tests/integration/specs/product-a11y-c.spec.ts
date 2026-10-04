import { expect } from "../fixtures";
import { evidence } from "../authorization-fixture";
import { test, withActors, createActivity, createCircle } from "../lifecycle-fixture";
import { uiActor } from "../lifecycle-ui-fixture";
import { focused } from "../product-fixture";
import { closureGame } from "../closure-fixture";
import { headingAudit, settle, type HeadingAudit } from "../a11y-audit";

// Phase 12 — HC-QA-083 (headings, skip link), HC-QA-065 (page titles),
// HC-QA-070 (navigation semantics). WCAG-oriented automated + keyboard checks.

// Reliable "start keyboard navigation from the top of the document".
const focusTop = (page: import("@playwright/test").Page) => page.evaluate(() => {
  (document.activeElement as HTMLElement | null)?.blur?.();
  document.body.setAttribute("tabindex", "-1");
  document.body.focus();
  document.body.removeAttribute("tabindex");
});

const problems = (rows: HeadingAudit[]) => rows.filter((r) => r.h1 !== 1 || r.skips.length > 0 || r.main !== 1).map((r) => `${r.path}: h1=${r.h1} main=${r.main} ${r.skips.join("; ")}`);

test("HC-QA-083-PUBLIC: public pages have one H1, no heading-level skips, one <main>", async ({ playwright, browser }) => {
  await withActors(playwright, ["QA_HOST"], async (f) => {
    const game = await createActivity(f, "QA_HOST");
    const circle = await createCircle(f, "QA_HOST", { joinMode: "open" });
    const ui = await uiActor(browser, null, "desktop");
    try {
      const rows: HeadingAudit[] = [];
      for (const path of ["/home", "/explore", "/games", "/circles", "/adventures", "/experiences", "/programs", "/signin", "/login", "/vendor/signup", "/privacy", "/cookies", `/games/${game.id}`, `/circles/${circle.slug ?? circle.id}`, "/host/does-not-exist-qa", "/no-such-page-qa"]) {
        await settle(ui.page, path);
        rows.push(await headingAudit(ui.page, path));
      }
      const home = rows.find((r) => r.path === "/home")!;
      await evidence("hc-qa-083-public", { audit: JSON.stringify(rows), problems: problems(rows).join(" | ") || "none" });
      expect(problems(rows), "one H1, no skips, one main").toEqual([]);
      expect(home.h1Text, "Home H1 words are separated").not.toMatch(/happennear/i);
    } finally { await ui.close(); }
  });
});

test("HC-QA-083-RESIDENT: signed-in pages (My Life, Profile, Host, Manage, Circle) have one H1 and no skips", async ({ playwright, browser }) => {
  await withActors(playwright, ["QA_HOST"], async (f) => {
    const circle = await createCircle(f, "QA_HOST", { joinMode: "open" });
    const ui = await uiActor(browser, "QA_HOST", "desktop");
    try {
      const rows: HeadingAudit[] = [];
      for (const path of ["/my-life", "/profile", "/games/host", "/manage", `/manage/circles/${circle.id}`, `/manage/circles/${circle.id}?tab=members`, `/manage/circles/${circle.id}?tab=settings`, `/circles/${circle.slug ?? circle.id}`]) {
        await settle(ui.page, path);
        rows.push(await headingAudit(ui.page, path));
      }
      await evidence("hc-qa-083-resident", { audit: JSON.stringify(rows), problems: problems(rows).join(" | ") || "none" });
      expect(problems(rows)).toEqual([]);
    } finally { await ui.close(); }
  });
});

test("HC-QA-083-SKIP: 'Skip to main content' is the first Tab stop, hidden until focused, moves focus to <main>, and works after a route change", async ({ browser }) => {
  const ui = await uiActor(browser, null, "desktop");
  try {
    const { page } = ui;
    await settle(page, "/explore");
    await expect(page.getByRole("link", { name: "Skip to main content" })).toHaveCount(1);
    await focusTop(page);
    await page.keyboard.press(browser.browserType().name() === "webkit" ? "Alt+Tab" : "Tab");
    const first = await focused(page);
    expect(first.name, "first Tab stop").toBe("Skip to main content");
    const link = page.getByRole("link", { name: "Skip to main content" });
    expect(await link.evaluate((el) => el.getBoundingClientRect().height > 1), "visible once focused").toBe(true);
    await page.keyboard.press("Enter");
    await expect.poll(() => page.evaluate(() => document.activeElement?.tagName)).toBe("MAIN");
    // Hidden again when not focused.
    expect(await link.evaluate((el) => { const r = el.getBoundingClientRect(); return r.width <= 1 || r.height <= 1; })).toBe(true);
    // After an in-app route change it still works.
    await page.evaluate(() => { history.pushState({}, "", "/circles"); dispatchEvent(new PopStateEvent("popstate")); });
    await page.waitForTimeout(500);
    await focusTop(page);
    await page.keyboard.press(browser.browserType().name() === "webkit" ? "Alt+Tab" : "Tab");
    expect((await focused(page)).name).toBe("Skip to main content");
    await page.keyboard.press("Enter");
    await expect.poll(() => page.evaluate(() => document.activeElement?.tagName)).toBe("MAIN");
    await evidence("hc-qa-083-skip", { firstTabStop: first.name, movesToMain: true, afterRouteChange: true });
  } finally { await ui.close(); }
});

test("HC-QA-065: titles follow direct load, client navigation, Back/Forward, entity load and 404 — never a private name", async ({ playwright, browser }) => {
  await withActors(playwright, ["QA_HOST"], async (f) => {
    const game = await createActivity(f, "QA_HOST");
    const privateGame = await closureGame(f);
    const ui = await uiActor(browser, null, "desktop");
    try {
      const { page } = ui;
      const seen: string[] = [];
      await settle(page, "/explore");
      await expect(page).toHaveTitle("Explore | HelloCircle");
      seen.push(await page.title());
      await page.evaluate(() => { history.pushState({}, "", "/circles"); dispatchEvent(new PopStateEvent("popstate")); });
      await expect(page, "client-side navigation").toHaveTitle("Circles | HelloCircle");
      seen.push(await page.title());
      await page.goBack();
      await expect(page, "Back").toHaveTitle("Explore | HelloCircle");
      await page.goForward();
      await expect(page, "Forward").toHaveTitle("Circles | HelloCircle");
      await settle(page, `/games/${game.id}`);
      await expect(page, "entity name once loaded").toHaveTitle(`${game.activityLabel} | HelloCircle`);
      seen.push(await page.title());
      await page.evaluate(() => { history.pushState({}, "", "/games"); dispatchEvent(new PopStateEvent("popstate")); });
      await expect(page, "no stale entity title").toHaveTitle("Activities | HelloCircle");
      await settle(page, "/no-such-page-qa");
      await expect(page).toHaveTitle("Page not found | HelloCircle");
      seen.push(await page.title());
      const [{ activity_label: privateLabel }] = (await f.connection.query<any[]>("SELECT activity_label FROM games WHERE id = ?", [privateGame]))[0];
      await settle(page, `/games/${privateGame}`);
      await page.waitForTimeout(800);
      expect(await page.title(), "private activity name never in the title").not.toContain(privateLabel);
      seen.push(await page.title());
      await evidence("hc-qa-065-titles", { titles: seen.join(" || ") });
    } finally { await ui.close(); }
  });
});

test("HC-QA-070: header disclosures expose aria-expanded/aria-controls; current nav item has aria-current=page (desktop + mobile)", async ({ browser }) => {
  const desktop = await uiActor(browser, null, "desktop");
  try {
    const { page } = desktop;
    await settle(page, "/circles");
    const nav = page.locator("nav.desktop-nav");
    const explore = nav.getByRole("button", { name: /^Explore/ });
    await expect(explore).toHaveAttribute("aria-expanded", "false");
    await explore.click();
    await expect(explore).toHaveAttribute("aria-expanded", "true");
    const controls = await explore.getAttribute("aria-controls");
    expect(controls).toBeTruthy();
    await expect(page.locator(`#${controls}`)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(explore, "Escape closes the menu").toHaveAttribute("aria-expanded", "false");
    await expect.poll(async () => (await focused(page)).name, { message: "focus returns to the trigger" }).toMatch(/^Explore/);
    await expect(nav.getByRole("button", { name: "Circles", exact: true })).toHaveAttribute("aria-current", "page");
    await expect(nav.locator('[aria-current="page"]')).toHaveCount(1);
    await page.evaluate(() => { history.pushState({}, "", "/explore"); dispatchEvent(new PopStateEvent("popstate")); });
    await expect(nav.getByRole("button", { name: "Circles", exact: true }), "state updates on navigation").not.toHaveAttribute("aria-current", "page");
  } finally { await desktop.close(); }
  const mobile = await uiActor(browser, null, "mobile");
  try {
    const { page } = mobile;
    await settle(page, "/circles");
    const bar = page.getByRole("navigation", { name: "Primary" });
    await expect(bar.getByRole("button", { name: "Circles" })).toHaveAttribute("aria-current", "page");
    const exploreTab = bar.getByRole("button", { name: "Explore" });
    await expect(exploreTab).toHaveAttribute("aria-expanded", "false");
    await exploreTab.click();
    await expect(exploreTab).toHaveAttribute("aria-expanded", "true");
    await evidence("hc-qa-070-nav", { desktopExpanded: true, desktopCurrent: true, mobileCurrent: true, mobileExpanded: true });
  } finally { await mobile.close(); }
});
