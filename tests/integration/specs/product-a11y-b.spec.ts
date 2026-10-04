import { expect } from "../fixtures";
import { evidence } from "../authorization-fixture";
import { test, withActors, createActivity, createCircle } from "../lifecycle-fixture";
import { uiActor } from "../lifecycle-ui-fixture";
import { tabTo, unlabeledControls } from "../product-fixture";

// Phase 10A — HC-QA-067 (photo upload not keyboard-reachable) and HC-QA-068
// (form controls without accessible names: search, host, Circle). Programme
// forms are covered in product-vendor.spec.ts.

test("HC-QA-067: the activity cover 'Add photo' control is reachable and operable by keyboard", async ({ playwright, browser }) => {
  await withActors(playwright, ["QA_HOST"], async (f) => {
    const game = await createActivity(f, "QA_HOST");
    const ui = await uiActor(browser, "QA_HOST", "desktop");
    try {
      const { page } = ui;
      await page.goto(`/games/host/${game.id}`);
      await expect(page.getByText("Cover photo")).toBeVisible();
      await page.locator("body").focus();
      const add = await tabTo(page, (x) => x.tag === "BUTTON" && /add photo/i.test(x.name), { max: 80 });
      expect(add, "Add photo reachable by Tab as a button").not.toBeNull();
      expect(add!.focusVisible).toBe(true);
      // Phase 13 — focusing a control near the viewport edge starts the
      // browser's animated focus scroll (scroll-padding-bottom); a key pressed
      // mid-animation intermittently lost the activation in Chromium. Act once
      // the focused control has come to rest, as a person would.
      await expect.poll(async () => {
        const a = await page.evaluate(() => Math.round((document.activeElement as HTMLElement).getBoundingClientRect().top));
        await page.waitForTimeout(150);
        const b = await page.evaluate(() => Math.round((document.activeElement as HTMLElement).getBoundingClientRect().top));
        return a === b;
      }, { message: "focused control at rest" }).toBe(true);
      for (const key of ["Enter", "Space"]) {
        const chooser = page.waitForEvent("filechooser", { timeout: 3_000 });
        await page.keyboard.press(key);
        await chooser;
      }
      // Upload errors are announced.
      await page.locator('input[type="file"]').first().setInputFiles({ name: "notes.png", mimeType: "image/png", buffer: Buffer.from("not an image") });
      await expect(page.getByRole("alert").filter({ hasText: /image|upload|file/i })).toBeVisible();
      await evidence("hc-qa-067", { keyboardReachable: true, enterAndSpaceOpenChooser: true, errorAnnounced: true });
    } finally { await ui.close(); }
  });
});

test("HC-QA-068: search, host and Circle forms have programmatic labels", async ({ playwright, browser }) => {
  await withActors(playwright, ["QA_HOST"], async (f) => {
    const circle = await createCircle(f, "QA_HOST", { joinMode: "open" });
    void circle;
    const ui = await uiActor(browser, "QA_HOST", "desktop");
    try {
      const { page } = ui;
      const results: Record<string, string[]> = {};
      for (const path of ["/games", "/home", "/circles", "/programs", "/experiences"]) {
        await page.goto(path);
        await page.waitForLoadState("networkidle").catch(() => {});
        results[path] = await unlabeledControls(page);
      }
      await page.goto("/games/host");
      await expect(page.locator("#game-activity")).toBeVisible();
      results["/games/host step 1"] = await unlabeledControls(page);
      await page.fill("#game-activity", "QA label check");
      await page.fill("#game-location", "QA park");
      await page.fill("#game-date", "2030-07-15");
      await page.fill("#game-time", "18:30");
      await page.getByRole("button", { name: /Continue/ }).click();
      await expect(page.getByText("A few more details.")).toBeVisible();
      results["/games/host step 2"] = await unlabeledControls(page);
      await page.goto("/circles/start");
      await page.getByRole("button", { name: /Add more detail/ }).click();
      results["/circles/start"] = await unlabeledControls(page);
      await page.goto("/manage?tab=activities");
      await page.waitForLoadState("networkidle").catch(() => {});
      results["/manage activities"] = await unlabeledControls(page);
      await evidence("hc-qa-068", Object.fromEntries(Object.entries(results).map(([k, v]) => [k, v.length])));
      expect(results).toEqual(Object.fromEntries(Object.keys(results).map((k) => [k, []])));
    } finally { await ui.close(); }
  });
});

test("HC-QA-088: the shared Modal keeps Tab and Shift+Tab inside the popup (every engine)", async ({ playwright, browser }) => {
  await withActors(playwright, ["QA_HOST"], async (f) => {
    const live = await createActivity(f, "QA_HOST");
    const ui = await uiActor(browser, "QA_HOST", "desktop");
    try {
      const { page } = ui;
      await page.goto("/manage?tab=activities");
      const row = page.locator("div").filter({ hasText: live.activityLabel }).filter({ has: page.getByRole("button", { name: "Participants" }) }).last();
      await row.getByRole("button", { name: /Share/ }).focus();
      await page.keyboard.press("Enter");
      const dialog = page.getByRole("dialog");
      await expect(dialog.getByRole("button", { name: /copy link/i })).toBeVisible();
      await expect.poll(async () => page.evaluate(() => !!document.activeElement?.closest("[role=dialog]"))).toBe(true);
      for (const key of ["Tab", "Shift+Tab"]) {
        for (let i = 0; i < 8; i++) {
          await page.keyboard.press(key);
          expect(await page.evaluate(() => !!document.activeElement?.closest("[role=dialog]")), `${key} ${i + 1} stays in the popup`).toBe(true);
        }
      }
      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
      await evidence("hc-qa-088", { trapped: true });
    } finally { await ui.close(); }
  });
});
