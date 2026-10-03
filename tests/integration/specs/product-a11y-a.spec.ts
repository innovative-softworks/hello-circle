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
    const circle = await createCircle(f, "QA_HOST", { joinMode: "open" });
    expect((await f.actors.QA_USER.post(`/api/games/${game.id}/join`, { data: {} })).status()).toBeLessThan(300);
    expect((await f.actors.QA_USER.post(`/api/circles/${circle.id}/join`, { data: {} })).status()).toBe(201);
    const ui = await uiActor(browser, "QA_USER", "desktop");
    try {
      const { page } = ui;
      for (const [label, url] of [[game.activityLabel, `/games/${game.id}`], [null, `/circles/`]] as const) {
        await page.goto("/my-life");
        await page.locator("body").focus();
        // The rows live under "View full activity" (keyboard-operable toggle).
        const toggle = page.getByRole("button", { name: /View full activity/ });
        await expect(toggle).toHaveAttribute("aria-expanded", "false");
        await toggle.focus();
        await page.keyboard.press("Enter");
        await expect(page.getByRole("button", { name: /Hide full activity/ })).toHaveAttribute("aria-expanded", "true");
        const target = label
          ? await tabTo(page, (x) => x.tag === "A" && x.name.includes(label), { max: 120 })
          : await tabTo(page, (x) => x.tag === "A" && /member/.test(x.name), { max: 120 });
        expect(target, `${label ?? "Circle"} row reachable by Tab as a link with an accessible name`).not.toBeNull();
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
      const game = await createActivity(f, "QA_HOST");
      const ui = await uiActor(browser, "QA_USER", viewport);
      try {
        const { page } = ui;
        await page.goto(`/games/${game.id}`);
        const trigger = page.getByRole("button", { name: /^(I'm in|Join)/ }).filter({ visible: true }).first();
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
      const row = page.locator("div").filter({ hasText: game.activityLabel }).filter({ has: page.getByRole("button", { name: "Participants" }) }).last();
      await row.getByRole("button", { name: "Cancel" }).focus();
      await page.keyboard.press("Enter");
      const confirm = page.getByRole("alertdialog");
      await expect(confirm).toBeVisible();
      await expect.poll(async () => (await focused(page)).inDialog).toBe(true);
      for (let i = 0; i < 6; i++) { await page.keyboard.press("Tab"); expect((await focused(page)).inDialog).toBe(true); }
      await page.keyboard.press("Escape");
      await expect(confirm).toBeHidden();
    } finally { await ui.close(); }
  });
});
