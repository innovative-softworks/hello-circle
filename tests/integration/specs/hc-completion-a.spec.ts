import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import { expect, personas } from "../fixtures";
import { evidence } from "../authorization-fixture";
import { test, withActors } from "../lifecycle-fixture";
import { businessUiActor } from "../product-fixture";
import { bookableCentre } from "../booking-fixture";
import { paidBooking } from "../stage-b-fixture";
import { connectedPreflight } from "../runtime";
import { noHorizontalScroll } from "../lifecycle-ui-fixture";

// UI completion 2026-10-14 — admin and partner record pages, editors in the
// workspace shell, confirmations and the full-screen section menu, against the
// real stack. Route interception is used only to inject one failed request
// (UI verification). Screenshots: evidence/completion/.

async function shot(page: Page, name: string) {
  const checked = await connectedPreflight();
  await checked.connection.end();
  const dir = path.join(checked.manifest.dataDir, "evidence", "completion");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.screenshot({ path: path.join(dir, `${name}.png`), fullPage: true });
}
/** No side-sliding task panels anywhere on the page. */
async function noSideDrawers(page: Page) {
  expect(await page.locator(".slide-in-right, .slide-in-left, .adm-panel").count(), "no side drawers").toBe(0);
}

test("COMPLETE-ADMIN: listing, vendor and report record pages with return context, confirmations and states", async ({ playwright, browser }) => {
  test.setTimeout(120_000);
  await withActors(playwright, ["QA_VENDOR"], async (f) => {
    const centre = await bookableCentre(f);
    const [[row]] = await f.connection.query<any[]>("SELECT name FROM centres WHERE id = ?", [centre.id]);
    const guest = await playwright.request.newContext({ baseURL: (await import("../fixtures")).env.E2E_BASE_URL, extraHTTPHeaders: { "X-Client-Id": randomUUID() } });
    expect((await guest.post("/api/reports", { data: { targetType: "centre", targetId: centre.id, reason: "QA completion report" } })).status()).toBe(201);
    await guest.dispose();
    const [[report]] = await f.connection.query<any[]>("SELECT id FROM reports WHERE target_id = ? ORDER BY id DESC LIMIT 1", [centre.id]);
    f.track("reports", "target_id", centre.id);
    f.track("audit_log", "object_id", String(report.id));
    const admin = await businessUiActor(browser, "QA_ADMIN", "desktop");
    try {
      const { page } = admin;
      // Listing record from a filtered list, then back with the filter intact.
      await page.goto(`/admin?tab=listings&q=${encodeURIComponent(row.name)}`);
      await page.getByRole("button", { name: new RegExp(row.name) }).first().click();
      await expect(page).toHaveURL(/record=centre/);
      await expect(page.getByRole("heading", { level: 1, name: row.name })).toBeVisible();
      await expect(page.getByRole("group", { name: "Status" })).toContainText("Listing:"); // redesigned admin listing record (2026-10-16)
      await noSideDrawers(page);
      await shot(page, "admin-listing-record");
      await page.getByRole("button", { name: /Back to all listings/ }).click();
      await expect(page.getByRole("searchbox").or(page.getByLabel("Search listings"))).toHaveValue(row.name);
      // Vendor record by direct URL (shareable).
      await page.goto(`/admin?tab=vendors&record=${personas.QA_VENDOR.id}`);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(page.getByRole("group", { name: "Status" })).toContainText("Account");
      await shot(page, "admin-vendor-record");
      // Report case page + a confirmation: focus moves in, Escape closes, focus returns.
      await page.goto(`/admin?tab=reviews&record=report:${report.id}`);
      await expect(page.getByRole("heading", { level: 1, name: new RegExp(`case #${report.id}`) })).toBeVisible();
      const dismiss = page.getByRole("button", { name: "Dismiss report" });
      await dismiss.click();
      const dialog = page.getByRole("alertdialog", { name: "Dismiss this report?" });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByLabel(/Statement of reasons/)).toBeVisible();
      await shot(page, "admin-report-confirm");
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      await expect(dismiss).toBeFocused();
      // Missing record state.
      await page.goto(`/admin?tab=vendors&record=does-not-exist`);
      await expect(page.getByRole("heading", { level: 1, name: /doesn't exist/ })).toBeVisible();
      await shot(page, "admin-record-missing");
    } finally {
      await admin.close();
    }
    await evidence("complete-admin", { listingRecord: true, vendorRecord: true, reportCase: true, missingState: true });
  });
});

test("COMPLETE-PARTNER: booking record, cancel confirmation, editor in the shell, full-screen menu, failure and empty states", async ({ playwright, browser }) => {
  test.setTimeout(150_000);
  await withActors(playwright, ["QA_VENDOR"], async (f) => {
    const centre = await bookableCentre(f);
    const ref = await paidBooking(f, centre);
    const [[row]] = await f.connection.query<any[]>("SELECT name FROM centres WHERE id = ?", [centre.id]);
    const vendor = await businessUiActor(browser, "QA_VENDOR", "desktop");
    try {
      const { page } = vendor;
      await page.goto(`/vendor?tab=bookings&record=booking:${ref}`);
      await expect(page.getByRole("heading", { level: 1, name: "QA synthetic guest" })).toBeVisible();
      const statuses = page.getByRole("group", { name: "Status" });
      for (const label of ["Booking:", "Payment:", "Check-in:"]) await expect(statuses).toContainText(label);
      await noSideDrawers(page);
      await shot(page, "partner-booking-record");
      await page.getByRole("button", { name: "Cancel booking" }).click();
      const dialog = page.getByRole("alertdialog", { name: /Cancel QA synthetic guest's booking/ });
      await expect(dialog).toBeVisible();
      await shot(page, "partner-cancel-confirm");
      await dialog.getByRole("button", { name: "Keep booking" }).click();
      await expect(dialog).toHaveCount(0);
      // Editor inside the partner workspace shell.
      await page.goto(`/vendor/centres/${centre.id}`);
      await expect(page.locator(".hc-ws-label")).toHaveText("Partner workspace");
      await expect(page.getByRole("heading", { level: 1, name: row.name })).toBeVisible();
      await expect(page.locator("h1")).toHaveCount(1);
      await shot(page, "partner-centre-editor");
      // Failure state: one injected failed request.
      let armed = true;
      await page.route((u) => armed && u.pathname === "/api/vendor/bookings", (r) => r.fulfill({ status: 500, contentType: "application/json", body: '{"error":"Server error"}' }));
      await page.goto("/vendor?tab=bookings");
      await expect(page.getByRole("alert").filter({ hasText: "Couldn't load hall bookings." })).toBeVisible();
      await shot(page, "partner-bookings-failed");
      armed = false;
      // Empty (filtered) state.
      await page.goto("/vendor?tab=bookings&bstatus=cancelled&bwhen=past&bq=nobody-matches-this");
      await expect(page.getByText("No bookings match these filters")).toBeVisible();
      await shot(page, "partner-bookings-empty-filtered");
      // Mobile: the section menu is full-screen, not a side panel.
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto("/vendor");
      await page.getByRole("button", { name: "Sections" }).click();
      const menu = page.getByRole("dialog", { name: /Partner workspace sections/ });
      await expect(menu).toBeVisible();
      const box = await menu.boundingBox();
      expect(Math.round(box?.width ?? 0)).toBe(390);
      expect(await noHorizontalScroll(page)).toBe(true);
      await shot(page, "partner-mobile-menu");
      await page.keyboard.press("Escape");
      await expect(menu).toHaveCount(0);
    } finally {
      await vendor.close();
    }
    await evidence("complete-partner", { bookingRecord: true, cancelConfirm: true, editorInShell: true, mobileMenuFullScreen: true });
  });
});
