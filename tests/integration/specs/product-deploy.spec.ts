import type { Page } from "@playwright/test";
import { expect, test } from "../fixtures";
import { evidence } from "../authorization-fixture";
import { uiActor } from "../lifecycle-ui-fixture";

// Phase 11A — HC-QA-090: a tab opened before a deploy must not go blank when
// its next lazy route's chunk no longer exists. The Circles route chunk is
// made unavailable (404, exactly what the server now answers for a missing
// hashed asset) inside a test-owned context; matches both the dev-server
// module path and the production-build asset path (QA_PROD_BUILD=1).
const circlesChunk = (u: URL) => /\/src\/pages\/Circles\.tsx$|\/assets\/Circles-[\w-]+\.js$/.test(u.pathname);

async function openThenLoseChunk(page: Page, persistent: boolean) {
  let loads = 0;
  page.on("load", () => { loads++; });
  let failures = 0;
  await page.route((u) => circlesChunk(u) && (persistent || failures === 0), async (route) => {
    failures++;
    // Same response the server now gives a missing asset (clientAssets.ts),
    // including no-store — otherwise WebKit may cache the injected 404.
    await route.fulfill({ status: 404, contentType: "text/plain", headers: { "Cache-Control": "no-store" }, body: "Not found" });
  });
  await page.goto("/games");
  await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
  const before = loads;
  // In-app (client-side) navigation, no reload → lazy import of the now-missing
  // chunk. Driven through the router's history API so overlays (consent etc.)
  // can't interfere with what is under test.
  await page.evaluate(() => { history.pushState({}, "", "/circles"); dispatchEvent(new PopStateEvent("popstate")); });
  return { reloads: () => loads - before, failures: () => failures };
}

test("HC-QA-090-STALE-TAB: old chunk gone after a deploy → one automatic reload, then the new build renders (no blank page)", async ({ browser, browserName }) => {
  // This harness simulates "the new build has the chunk" by failing and then
  // restoring the SAME chunk URL; WebKit keeps the failed module record for an
  // identical URL across the reload. A real deploy changes the hashed URL, and
  // that real path (rebuild + restart + old tab) is verified end-to-end in
  // WebKit, Chromium and Firefox by the Phase 11A deploy simulation (QA_REPORT).
  // The no-loop/recovery-notice path (PERSISTENT) runs on every engine.
  test.skip(browserName === "webkit", "same-URL simulation not representative in WebKit — covered by the real deploy simulation");
  test.setTimeout(90_000);
  const ui = await uiActor(browser, null, "desktop");
  try {
    const { page } = ui;
    const probe = await openThenLoseChunk(page, false);
    await expect(page).toHaveURL(/\/circles$/);
    await expect.poll(async () => (await page.locator("#root").innerText()).trim().length, { message: "page must not go blank", timeout: 20_000 }).toBeGreaterThan(0);
    await expect(page.getByRole("heading", { level: 1 }).first(), "the route renders after the recovery reload").toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("HelloCircle has been updated")).toHaveCount(0);
    expect(probe.reloads(), "exactly one automatic reload").toBe(1);
    expect((await page.locator("#root").innerText()).trim().length, "never blank").toBeGreaterThan(0);
    await evidence("hc-qa-090-stale-tab", { reloads: probe.reloads(), chunkFailures: probe.failures(), url: new URL(page.url()).pathname });
  } finally { await ui.close(); }
});

test("HC-QA-090-PERSISTENT: chunk still unavailable after the reload → 'Refresh to continue', no reload loop", async ({ browser }) => {
  test.setTimeout(90_000);
  const ui = await uiActor(browser, null, "desktop");
  try {
    const { page } = ui;
    const probe = await openThenLoseChunk(page, true);
    const notice = page.getByRole("alert").filter({ hasText: "HelloCircle has been updated" });
    await expect(notice, "recovery notice instead of a blank page").toBeVisible({ timeout: 20_000 });
    await expect(notice).toContainText("Refresh to continue");
    await expect(notice.getByRole("button", { name: "Refresh" })).toBeVisible();
    await page.waitForTimeout(3_000);
    expect(probe.reloads(), "at most one automatic reload — never a loop").toBe(1);
    // The app shell (header) stays rendered around the notice.
    await expect(page.getByRole("banner").first()).toBeVisible();
    await evidence("hc-qa-090-persistent", { reloads: probe.reloads(), chunkFailures: probe.failures(), notice: true });
  } finally { await ui.close(); }
});

test("HC-QA-090-NAVIGATE-AWAY: leaving the page while a chunk is still loading never triggers a recovery reload that hijacks the navigation", async ({ browser }) => {
  test.setTimeout(90_000);
  const ui = await uiActor(browser, null, "desktop");
  try {
    const { page } = ui;
    const navigations: string[] = [];
    page.on("load", () => navigations.push(new URL(page.url()).pathname));
    // Hold the Circles chunk in flight; the user then navigates elsewhere, so
    // the browser aborts the pending import (Firefox: NS_BINDING_ABORTED).
    let release: () => void = () => {};
    const held = new Promise<void>((r) => { release = r; });
    await page.route((u) => circlesChunk(u), async (route) => { await held; await route.continue().catch(() => {}); });
    await page.goto("/games");
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
    await page.evaluate(() => { history.pushState({}, "", "/circles"); dispatchEvent(new PopStateEvent("popstate")); });
    await page.waitForTimeout(500);
    const target = await page.goto("/programs");
    release();
    expect(target?.ok(), "the user's own navigation completes (not aborted by a recovery reload)").toBeTruthy();
    await page.waitForTimeout(3_000);
    await expect(page).toHaveURL(/\/programs$/);
    expect(navigations.filter((n) => n === "/programs").length, "no extra reload after arriving").toBe(1);
    await expect(page.getByText("HelloCircle has been updated")).toHaveCount(0);
    await evidence("hc-qa-090-navigate-away", { navigations: navigations.join(","), finalUrl: new URL(page.url()).pathname });
  } finally { await ui.close(); }
});
