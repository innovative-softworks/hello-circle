import { randomUUID } from "node:crypto";
import { expect, personas } from "../fixtures";
import { evidence } from "../authorization-fixture";
import { test, withActors, createActivity, createCircle } from "../lifecycle-fixture";
import { uiActor } from "../lifecycle-ui-fixture";
import { focused, tabTo } from "../product-fixture";

// Phase 10A — HC-QA-066 (My Life rows mouse-only) and HC-QA-069 (join
// dialog focus management). Keyboard only: Tab / Shift+Tab / Enter / Escape.

test("HC-QA-066: My Life activity and Circle rows open from the keyboard", async ({ playwright, browser }) => {
  await withActors(playwright, ["QA_HOST", "QA_USER"], async (f) => {
    const game = await createActivity(f, "QA_HOST");
    const circleName = `QA keyboard circle ${randomUUID().slice(0, 6)}`;
    const circle = await createCircle(f, "QA_HOST", { joinMode: "open", name: circleName });
    expect((await f.actors.QA_USER.post(`/api/games/${game.id}/join`, { data: {} })).status()).toBeLessThan(300);
    expect((await f.actors.QA_USER.post(`/api/circles/${circle.id}/join`, { data: {} })).status()).toBe(201);
    const ui = await uiActor(browser, "QA_USER", "desktop");
    try {
      const { page } = ui;
      // My Life 3.0: joined activities are cards under My Plans → "Coming up"; Circles have their own tab.
      for (const [tab, label, url] of [["plans", game.activityLabel, `/games/${game.id}`], ["circles", circleName, `/circles/${circle.slug}`]] as const) {
        await page.goto(`/my-life?tab=${tab}`);
        await expect(page.getByRole("link").filter({ hasText: label }).first()).toBeVisible({ timeout: 20_000 });
        await page.locator("body").focus();
        const target = await tabTo(page, (x) => x.tag === "A" && x.name.includes(label), { max: 160 });
        expect(target, `${tab}: "${label}" reachable by Tab as a link with an accessible name`).not.toBeNull();
        expect(target!.focusVisible, "visible focus").toBe(true);
        await page.keyboard.press("Enter");
        await expect(page).toHaveURL(new RegExp(url.replace(/\//g, "\\/")));
      }
      await evidence("hc-qa-066", { activityRowKeyboard: true, circleRowKeyboard: true });
    } finally { await ui.close(); }
    void personas;
  });
});

for (const viewport of ["desktop", "mobile"] as const) {
  test(`HC-QA-069: join dialog moves focus inside, traps Tab, closes on Escape and restores focus (${viewport})`, async ({ playwright, browser }) => {
    await withActors(playwright, ["QA_HOST"], async (f) => {
      // A free, open activity joins in one tap (owner 2026-10-27), so it has no dialog.
      // An approval activity still asks in a dialog (with a note field): test that one.
      const game = await createActivity(f, "QA_HOST");
      f.track("game_join_requests", "game_id", game.id);
      expect((await f.actors.QA_HOST.post(`/api/games/${game.id}/booking-settings`, { data: { joinMode: "approval" } })).status()).toBe(200);
      const ui = await uiActor(browser, "QA_USER", viewport);
      try {
        const { page } = ui;
        await page.goto(`/games/${game.id}`);
        const trigger = page.getByRole("button", { name: /^Request to join/ }).filter({ visible: true }).first();
        await trigger.focus();
        const triggerName = (await focused(page)).name;
        await page.keyboard.press("Enter");
        const dialog = page.getByRole("alertdialog");
        await expect(dialog).toBeVisible();
        await expect.poll(async () => (await focused(page)).inDialog, { message: "focus moved into the dialog" }).toBe(true);
        for (let i = 0; i < 8; i++) { await page.keyboard.press("Tab"); expect((await focused(page)).inDialog, `Tab ${i + 1} stays in dialog`).toBe(true); }
        for (let i = 0; i < 8; i++) { await page.keyboard.press("Shift+Tab"); expect((await focused(page)).inDialog, `Shift+Tab ${i + 1} stays in dialog`).toBe(true); }
        await expect(dialog).toHaveAttribute("aria-modal", "true");
        expect(await dialog.evaluate((d) => !!d.getAttribute("aria-labelledby") && !!document.getElementById(d.getAttribute("aria-labelledby")!)?.textContent?.trim()), "dialog is named by its title").toBe(true);
        await page.keyboard.press("Escape");
        await expect(dialog).toBeHidden();
        const after = await focused(page);
        expect(after.name, "focus returned to the triggering control").toBe(triggerName);
        await evidence(`hc-qa-069-${viewport}`, { focusIn: true, trapped: true, escapeCloses: true, focusRestored: true });
      } finally { await ui.close(); }
    });
  });
}

test("HC-QA-069-ADJACENT: other ConfirmDialog uses (host cancel) trap focus the same way", async ({ playwright, browser }) => {
  await withActors(playwright, ["QA_HOST"], async (f) => {
    const game = await createActivity(f, "QA_HOST");
    const ui = await uiActor(browser, "QA_HOST", "desktop");
    try {
      const { page } = ui;
      // Host cancel = ConfirmDialog; it must trap focus like the join dialog.
      await page.goto("/manage?tab=activities");
      const row = page.getByRole("listitem").filter({ hasText: game.activityLabel }).filter({ has: page.getByRole("button", { name: /^Manage / }) });
      // Since the UI completion pass, Cancel lives in the row's action menu.
      await row.getByRole("button", { name: `More actions for ${game.activityLabel}` }).focus();
      await page.keyboard.press("Enter");
      await page.getByRole("menuitem", { name: "Cancel activity…" }).press("Enter");
      const confirm = page.getByRole("alertdialog");
      await expect(confirm).toBeVisible();
      await expect.poll(async () => (await focused(page)).inDialog).toBe(true);
      for (let i = 0; i < 6; i++) { await page.keyboard.press("Tab"); expect((await focused(page)).inDialog).toBe(true); }
      await page.keyboard.press("Escape");
      await expect(confirm).toBeHidden();
      expect((await focused(page)).name, "focus returns to the menu button").toBe(`More actions for ${game.activityLabel}`);
    } finally { await ui.close(); }
  });
});
