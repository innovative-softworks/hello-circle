import { mkdirSync } from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import { expect, personas } from "../fixtures";
import { evidence } from "../authorization-fixture";
import { test, withActors, createActivity } from "../lifecycle-fixture";
import { uiActor, noHorizontalScroll } from "../lifecycle-ui-fixture";
import { bookableCentre } from "../booking-fixture";
import { paidBooking } from "../stage-b-fixture";
import { connectedPreflight } from "../runtime";

// UI completion 2026-10-14 — host activity record page and the resident
// receipt page (both were side drawers/modals), plus restricted and failure
// states. Real stack; one injected failure is labelled UI verification.

/** Progress marker: a timed-out run's evidence shows the last step reached. */
const step = (name: string) => evidence("complete-progress", { step: name });

async function shot(page: Page, name: string) {
  const checked = await connectedPreflight();
  await checked.connection.end();
  const dir = path.join(checked.manifest.dataDir, "evidence", "completion");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.screenshot({ path: path.join(dir, `${name}.png`), fullPage: true });
}

test("COMPLETE-HOST: the activity record page opens from the list, shows separate statuses and returns to the list", async ({ playwright, browser }) => {
  test.setTimeout(120_000);
  await withActors(playwright, ["QA_HOST"], async (f) => {
    const game = await createActivity(f, "QA_HOST");
    await step("host-created");
    const ui = await uiActor(browser, "QA_HOST", "desktop");
    try {
      const { page } = ui;
      // Search narrows the list to this run's activity (earlier suites leave many on the same host).
      await page.goto(`/manage?tab=activities&aq=${encodeURIComponent(game.activityLabel)}`);
      await step("host-list");
      // The row button's accessible name carries the activity (it is labelled "Manage activity" visually).
      await page.getByRole("button", { name: `Manage ${game.activityLabel}` }).click({ timeout: 20_000 });
      await expect(page).toHaveURL(new RegExp(`record=activity`));
      await expect(page.getByRole("heading", { level: 1, name: game.activityLabel })).toBeVisible();
      await step("host-record");
      await expect(page.getByRole("group", { name: "Status" })).toContainText("Places:");
      await expect(page.getByRole("heading", { level: 2, name: "Participants" })).toBeVisible();
      expect(await page.locator(".slide-in-right, .slide-in-left").count()).toBe(0);
      await shot(page, "host-activity-record");
      await step("host-back");
      await page.getByRole("button", { name: /Back to activities/ }).click();
      await expect(page).toHaveURL(/aq=/);
      await expect(page).not.toHaveURL(/record=/);
      // Mobile layout of the record page.
      await step("host-mobile");
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(`/manage?tab=activities&record=activity:${game.id}`);
      await expect(page.getByRole("heading", { level: 1, name: game.activityLabel })).toBeVisible();
      expect(await noHorizontalScroll(page)).toBe(true);
      await shot(page, "host-activity-record-mobile");
    } finally {
      await ui.close();
    }
    await evidence("complete-host", { activityRecord: true, returnContext: true, mobile: true });
  });
});

test("COMPLETE-RESIDENT: a receipt is its own page; signed-out and failed states are distinct", async ({ playwright, browser }) => {
  test.setTimeout(120_000);
  await withActors(playwright, ["QA_VENDOR"], async (f) => {
    const centre = await bookableCentre(f);
    const ref = await paidBooking(f, centre, { residentId: personas.QA_USER.id });
    await step("res-booked");
    const user = await uiActor(browser, "QA_USER", "desktop");
    try {
      const { page } = user;
      await page.goto(`/receipts/${ref}`);
      await expect(page.getByRole("heading", { level: 1, name: "Receipt" })).toBeVisible();
      await expect(page.getByText(ref).first()).toBeVisible();
      expect(await page.locator(".slide-in-right, .slide-in-left, [role=dialog]").count()).toBe(0);
      await shot(page, "resident-receipt-page");
      await step("res-failure");
      let armed = true;
      await page.route((u) => armed && u.pathname === `/api/residents/me/receipts/${ref}`, (r) => r.fulfill({ status: 500, contentType: "application/json", body: '{"error":"Server error"}' }));
      await page.reload();
      await expect(page.getByRole("alert").filter({ hasText: "We couldn't load this receipt." })).toBeVisible();
      await shot(page, "resident-receipt-failed");
      armed = false;
    } finally {
      await user.close();
    }
    await step("res-guest");
    const guest = await uiActor(browser, null, "mobile");
    try {
      await guest.page.goto(`/receipts/${ref}`);
      await expect(guest.page.getByRole("alert").filter({ hasText: "Sign in to see this receipt." })).toBeVisible();
      await shot(guest.page, "receipt-signed-out-mobile");
    } finally {
      await guest.close();
    }
    await evidence("complete-resident", { receiptPage: true, failedState: true, signedOut: true });
  });
});
