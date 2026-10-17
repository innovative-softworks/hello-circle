import { mkdirSync } from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import { expect } from "../fixtures";
import { evidence } from "../authorization-fixture";
import { test, withActors, createActivity } from "../lifecycle-fixture";
import { businessUiActor, focused } from "../product-fixture";
import { uiActor } from "../lifecycle-ui-fixture";
import { bookableCentre, bookableExperience } from "../booking-fixture";
import { connectedPreflight } from "../runtime";

// UI completion (second pass, 2026-10-14) — form error summaries, anchored
// action menus, and the two former silent failures (credit balance, review
// eligibility). Real stack. Route interception is used only to inject one
// failed response per check, labelled as UI verification.

async function shot(page: Page, name: string) {
  const checked = await connectedPreflight();
  await checked.connection.end();
  const dir = path.join(checked.manifest.dataDir, "evidence", "completion");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.screenshot({ path: path.join(dir, `${name}.png`), fullPage: true });
}

test("COMPLETE-FORMS: the editor's error summary takes focus, links to fields, keeps values on a failed save, and blocks double submits", async ({ playwright, browser }) => {
  test.setTimeout(120_000);
  await withActors(playwright, ["QA_VENDOR"], async (f) => {
    const centre = await bookableCentre(f);
    const vendor = await businessUiActor(browser, "QA_VENDOR", "desktop");
    try {
      const { page } = vendor;
      await page.goto(`/vendor/centres/${centre.id}`);
      // Workspace editors (option A, 2026-10-16): each section edits in a popup
      // that saves the whole form; the error summary lives inside the popup.
      await page.getByRole("button", { name: "Edit general" }).click();
      const dialog = page.getByRole("dialog");
      await expect(dialog.getByText("Fields marked * are required.")).toBeVisible();
      const name = page.locator("#centre-name");
      const blurb = page.locator("#centre-blurb");
      await expect(name).toHaveAttribute("required", "");
      await name.fill("");
      await blurb.fill("");
      await dialog.getByRole("button", { name: "Save", exact: true }).click();
      // Client validation: summary focused, linked problems (the fixture centre has no area/county
      // either, so four), inline messages tied to the fields.
      const summary = page.locator(".form-error-summary");
      await expect(summary).toBeFocused();
      await expect(page.getByRole("group", { name: "There are 4 things to fix before saving" })).toBeVisible();
      await expect(name).toHaveAttribute("aria-invalid", "true");
      await expect(name).toHaveAttribute("aria-describedby", /centre-name-error/);
      await shot(page, "partner-form-error-summary");
      await summary.getByRole("link", { name: "Venue name is required" }).click();
      await expect(name).toBeFocused();
      // Editing one field clears only its own message.
      await name.fill("QA renamed hall");
      await expect(summary.getByRole("link")).toHaveCount(3);
      await blurb.fill("QA description kept after a failure");
      // A problem in another section: its link opens that section's popup, keeping what was typed.
      await summary.getByRole("link", { name: "Area is required" }).click();
      await expect(page.getByRole("dialog", { name: "Location" })).toBeVisible();
      await expect(page.locator("#centre-area")).toBeVisible();
      await page.locator("#centre-area").fill("QA area");
      await page.locator("#centre-county").fill("Dublin");
      await expect(summary).toHaveCount(0);
      // Server failure (UI interception, one request): values stay, reason in the summary.
      let puts = 0;
      await page.route((u) => u.pathname === `/api/vendor/centres/${centre.id}`, async (r) => {
        if (r.request().method() !== "PUT") return r.fallback();
        puts += 1;
        await new Promise((res) => setTimeout(res, 400));
        await r.fulfill({ status: 500, contentType: "application/json", body: '{"error":"Server error"}' });
      });
      const save = page.getByRole("dialog", { name: "Location" }).getByRole("button", { name: /^(Save|Saving…)$/ });
      await save.click();
      await save.click({ force: true }).catch(() => undefined); // second click while saving
      await expect(page.getByRole("group", { name: "There's 1 thing to fix before saving" })).toContainText("Couldn't save");
      expect(puts, "one request despite two clicks").toBe(1);
      await expect(page.locator("#centre-area")).toHaveValue("QA area");
      await shot(page, "partner-form-save-failed");
      // Unsaved changes: closing the popup asks first.
      await page.keyboard.press("Escape");
      const leave = page.getByRole("alertdialog", { name: "Discard your changes?" });
      await expect(leave).toBeVisible();
      await leave.getByRole("button", { name: /Keep editing|Cancel|Keep/ }).first().click();
      await expect(page.locator("#centre-area")).toHaveValue("QA area");
      await expect(page).toHaveURL(new RegExp(`/vendor/centres/${centre.id}`));
      await page.unroute((u) => u.pathname === `/api/vendor/centres/${centre.id}`);
    } finally {
      await vendor.close();
    }
    await evidence("complete-forms", { summaryFocused: true, linkedFields: true, ariaInvalid: true, valuesPreserved: true, singleSubmit: true, unsavedGuard: true });
  });
});

test("COMPLETE-MENUS: row overflow menus are keyboard operable, restore focus and stay on screen", async ({ playwright, browser }) => {
  test.setTimeout(120_000);
  await withActors(playwright, ["QA_HOST"], async (f) => {
    const game = await createActivity(f, "QA_HOST");
    const ui = await uiActor(browser, "QA_HOST", "desktop");
    try {
      const { page } = ui;
      await page.goto(`/manage?tab=activities&aq=${encodeURIComponent(game.activityLabel)}`);
      const trigger = page.getByRole("button", { name: `More actions for ${game.activityLabel}` });
      await expect(page.getByRole("button", { name: `Manage ${game.activityLabel}` })).toBeVisible(); // main action stays visible
      await trigger.focus();
      await page.keyboard.press("ArrowDown");
      const menu = page.getByRole("menu", { name: `More actions for ${game.activityLabel}` });
      await expect(menu).toBeVisible();
      await expect(trigger).toHaveAttribute("aria-expanded", "true");
      await expect(menu.getByRole("menuitem").first()).toBeFocused();
      await page.keyboard.press("End");
      await expect(menu.getByRole("menuitem", { name: "Cancel activity…" })).toBeFocused();
      await page.keyboard.press("ArrowDown"); // wraps
      await expect(menu.getByRole("menuitem").first()).toBeFocused();
      await shot(page, "host-row-action-menu");
      await page.keyboard.press("Escape");
      await expect(menu).toHaveCount(0);
      expect((await focused(page)).name).toBe(`More actions for ${game.activityLabel}`);
      // Mobile: the menu is positioned inside the viewport.
      await page.setViewportSize({ width: 390, height: 844 });
      await trigger.scrollIntoViewIfNeeded();
      await trigger.click();
      const box = await menu.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(390);
      expect(box!.y + box!.height).toBeLessThanOrEqual(844);
      await shot(page, "host-row-action-menu-mobile");
      await page.mouse.click(5, 5); // outside click closes
      await expect(menu).toHaveCount(0);
    } finally {
      await ui.close();
    }
    await evidence("complete-menus", { keyboard: true, wraps: true, escapeRestoresFocus: true, inViewport: true, outsideClick: true });
  });
});

test("COMPLETE-SILENT: an unavailable credit balance and a failed review-eligibility check are distinct from zero / not eligible", async ({ playwright, browser }) => {
  test.setTimeout(90_000);
  await withActors(playwright, ["QA_VENDOR"], async (f) => {
    const exp = await bookableExperience(f, { price: 2000 });
    const user = await uiActor(browser, "QA_USER", "desktop");
    try {
      const { page } = user;
      // UI interception: one failed credit check and one failed eligibility check.
      let creditsDown = true;
      let eligibilityDown = true;
      await page.route((u) => creditsDown && u.pathname === "/api/credits/me", (r) => r.fulfill({ status: 500, contentType: "application/json", body: '{"error":"Server error"}' }));
      await page.route((u) => eligibilityDown && u.pathname === "/api/reviews/eligible", (r) => r.fulfill({ status: 500, contentType: "application/json", body: '{"error":"Server error"}' }));
      await page.goto(`/experiences/${exp.id}`);
      // Review eligibility (on the page itself).
      await expect(page.getByText("We couldn't check whether you can review this right now.")).toBeVisible();
      // Credit (inside the booking dialog; the single departure skips to the details step).
      await page.getByRole("button", { name: /^Book/ }).first().click();
      const booking = page.getByRole("dialog");
      await expect(booking.getByText("We couldn't check your HelloCircle credit just now")).toBeVisible();
      await expect(booking.getByText(/Use my HelloCircle credit/)).toHaveCount(0); // never assumes eligibility
      await shot(page, "resident-credit-check-failed");
      creditsDown = false;
      await expect(page.getByText(/Only guests with a past booking can leave a review/)).toHaveCount(0); // not shown as "not eligible"
      // Retry reaches the real server, which answers (no message either way: a balance or none).
      await booking.getByRole("button", { name: "Check again" }).click();
      await expect(booking.getByText("We couldn't check your HelloCircle credit just now")).toHaveCount(0);
      await page.keyboard.press("Escape");
      await expect(page.getByText("We couldn't check whether you can review this right now.")).toBeVisible();
      await shot(page, "resident-review-check-failed");
      // Retry reaches the real server: the review check now gives its real answer.
      eligibilityDown = false;
      await page.getByRole("button", { name: "Try again" }).click();
      await expect(page.getByText("We couldn't check whether you can review this right now.")).toHaveCount(0);
    } finally {
      await user.close();
    }
    await evidence("complete-silent", { creditUnavailable: true, eligibilityUnknown: true, retries: true });
  });
});
