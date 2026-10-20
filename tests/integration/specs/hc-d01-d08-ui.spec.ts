import { mkdirSync } from "node:fs";
import path from "node:path";
import type { Browser, Page } from "@playwright/test";
import { expect, env } from "../fixtures";
import { evidence } from "../authorization-fixture";
import { test, withActors, rows } from "../lifecycle-fixture";
import { bookingBody, guest, irelandDate } from "../booking-fixture";
import { businessUiActor } from "../product-fixture";
import { seedCentre, seedExperience, syntheticOrg } from "../org-fixture";
import { connectedPreflight } from "../runtime";

// D-01 / D-08 browser checks with synthetic data only: the admin organisation
// page (scope shown before confirming, required reason, failed save keeps the
// text, one decision per double click, phone layout), the partner's restricted
// view and a direct editor link, the public unavailable page, and the owner's
// staff page (role change, stale-screen message, removal confirmation, keyboard).
// Logins (real limiter of 10 per IP): two admin browsers, two owner browsers = 4.

const NOTE = "INTERNAL-ORG-UI-MARKER";

async function shot(page: Page, name: string) {
  const checked = await connectedPreflight();
  await checked.connection.end();
  const dir = path.join(checked.manifest.dataDir, "evidence", "completion");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.screenshot({ path: path.join(dir, `${name}.png`), fullPage: true });
}

async function browserAs(browser: Browser, email: string, password: string, mobile = false) {
  const context = await browser.newContext({ baseURL: env.E2E_BASE_URL, viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 }, isMobile: mobile && browser.browserType().name() !== "firefox", hasTouch: mobile, serviceWorkers: "block" });
  await context.route("**/*", async (route) => (new URL(route.request().url()).origin === env.E2E_BASE_URL ? route.continue() : route.abort("blockedbyclient")));
  await context.addInitScript(() => { try { localStorage.setItem("hello_circle_cookie_consent", "rejected"); } catch { /* storage unavailable */ } });
  expect((await context.request.post("/api/auth/login", { data: { email, password } })).status()).toBe(200);
  return { context, page: await context.newPage() };
}

const noSideScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

test("D01-D08-UI: organisation suspension and staff management in the browser", async ({ playwright, browser }) => {
  test.setTimeout(240_000);
  const opened: import("@playwright/test").APIRequestContext[] = [];
  await withActors(playwright, [], async (f) => {
    const org = await syntheticOrg(playwright, f, opened, ["centre_manager"], []);
    const [owner, manager] = [org.owner, org.staff[0]];
    const centre = await seedCentre(f, manager.id, { payment: "cash" });
    // Venue (centre/club) pages are behind the coming-soon gate until launch, so the
    // public unavailable state is checked on an experience page, which is public now.
    const experience = await seedExperience(f, owner.id, { price: 0, payment: "cash" });
    const g = await guest(playwright, opened);
    const booked = await g.ctx.post("/api/bookings/checkout", { data: bookingBody(centre, g.email, { date: irelandDate(15) }) });
    expect(booked.status()).toBe(201);
    const bookingRef = (await booked.json()).ref as string;
    f.track("bookings", "ref", bookingRef); f.track("notifications", "ref", bookingRef);
    const explanation = "Serious safety complaints about your venue this month.";

    // --- admin: suspend from the organisation page ------------------------------
    const admin = await businessUiActor(browser, "QA_ADMIN", "desktop");
    try {
      const { page } = admin;
      await page.goto(`/admin?tab=organisations&record=org:${org.id}`);
      await expect(page.getByRole("heading", { level: 1, name: org.name })).toBeVisible();
      await expect(page.getByRole("group", { name: "Status" })).toContainText("Active");
      // Detail template (2026-10-20): suspending is in the record's More actions menu.
      await page.getByRole("button", { name: `More actions for ${org.name}` }).click();
      await page.getByRole("menuitem", { name: "Suspend organisation…" }).click();
      const dialog = page.getByRole("alertdialog", { name: `Suspend ${org.name}?` });
      await expect(dialog).toContainText("2 members");
      await expect(dialog).toContainText("whichever member created them");
      await expect(dialog).toContainText("nothing is cancelled or refunded (1 upcoming)");
      await expect(dialog).toContainText("different from suspending one person's account");
      await expect(dialog).toContainText("Visible to the partner");
      const confirm = dialog.getByRole("button", { name: "Suspend organisation" });
      await expect(confirm).toBeDisabled();
      await dialog.getByLabel(/Reason category/).selectOption("safety");
      await dialog.getByLabel(/^Explanation/).fill("Too short");
      await expect(confirm).toBeDisabled();
      await dialog.getByLabel(/^Explanation/).fill(explanation);
      await dialog.getByLabel(/^Internal note/).fill(NOTE);
      await shot(page, "d01-org-suspend-confirm");
      let calls = 0;
      await page.route(`**/api/admin/organisations/${org.id}/status`, async (route) => {
        calls++;
        await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "QA: simulated outage" }) });
      });
      await confirm.click();
      await expect(dialog).toContainText("simulated outage");
      await expect(dialog.getByLabel(/^Explanation/)).toHaveValue(explanation);
      await expect(dialog.getByLabel(/^Internal note/)).toHaveValue(NOTE);
      expect(calls).toBe(1);
      expect((await rows(f, "SELECT status FROM organisations WHERE id = ?", [org.id]))[0].status).toBe("active");
      await shot(page, "d01-org-suspend-failed");
      await page.unroute(`**/api/admin/organisations/${org.id}/status`);
      await confirm.dblclick();
      await expect(dialog).toHaveCount(0);
      await expect(page.getByRole("group", { name: "Status" })).toContainText("Suspended");
      expect(Number((await rows(f, "SELECT COUNT(*) AS n FROM moderation_decisions WHERE object_id = ?", [org.id]))[0].n)).toBe(1);
      await expect(page.getByText(explanation)).toBeVisible();
      await shot(page, "d01-org-record-suspended");
      // Keyboard: the reinstate dialog closes with Escape and focus returns.
      const reinstateButton = page.getByRole("button", { name: "Reinstate organisation" });
      await reinstateButton.focus();
      await page.keyboard.press("Enter");
      await expect(page.getByRole("alertdialog")).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.getByRole("alertdialog")).toHaveCount(0);
      await expect(reinstateButton).toBeFocused();
    } finally { await admin.close(); }

    // --- phone: the admin dialog fits ------------------------------------------------
    const adminPhone = await businessUiActor(browser, "QA_ADMIN", "mobile");
    try {
      const { page } = adminPhone;
      await page.goto(`/admin?tab=organisations&record=org:${org.id}`);
      await page.getByRole("button", { name: "Reinstate organisation" }).click();
      const dialog = page.getByRole("alertdialog");
      await expect(dialog).toContainText("drafts, paused and rejected listings stay exactly as they are");
      expect(await noSideScroll(page)).toBe(true);
      await shot(page, "d01-org-reinstate-confirm-mobile");
      await dialog.getByRole("button", { name: "Cancel" }).click();
    } finally { await adminPhone.close(); }

    // --- the partner's restricted view, desktop and phone ------------------------------
    const ownerDesk = await browserAs(browser, owner.email, owner.password);
    try {
      const { page } = ownerDesk;
      await page.goto("/vendor");
      await expect(page.getByRole("heading", { level: 1, name: "Your organisation is suspended" })).toBeVisible();
      await expect(page.getByTestId("decision-explanation")).toContainText(explanation);
      await expect(page.getByText(NOTE)).toHaveCount(0);
      await expect(page.getByRole("table", { name: "Upcoming obligations" })).toContainText(bookingRef);
      await expect(page.getByRole("link", { name: "Ask for the decision to be looked at again" })).toBeVisible();
      // Signed in and recognised: no "session expired" prompt from background partner requests.
      await page.waitForLoadState("networkidle");
      await expect(page.getByText("Your session has expired")).toHaveCount(0);
      await shot(page, "d01-partner-restricted");
      await page.goto(`/vendor/centres/${centre.id}`);
      await expect(page.getByRole("heading", { level: 1, name: "Your organisation is suspended" })).toBeVisible();
    } finally { await ownerDesk.context.close(); }
    const ownerPhone = await browserAs(browser, owner.email, owner.password, true);
    try {
      const { page } = ownerPhone;
      await page.goto("/vendor");
      await expect(page.getByRole("heading", { level: 1, name: "Your organisation is suspended" })).toBeVisible();
      expect(await noSideScroll(page)).toBe(true);
      await shot(page, "d01-partner-restricted-mobile");
    } finally { await ownerPhone.context.close(); }

    // --- public direct link ------------------------------------------------------
    const visitor = await browser.newContext({ baseURL: env.E2E_BASE_URL, serviceWorkers: "block" });
    try {
      await visitor.route("**/*", async (route) => (new URL(route.request().url()).origin === env.E2E_BASE_URL ? route.continue() : route.abort("blockedbyclient")));
      await visitor.addInitScript(() => { try { localStorage.setItem("hello_circle_cookie_consent", "rejected"); } catch { /* storage unavailable */ } });
      const page = await visitor.newPage();
      await page.goto(`/experiences/${experience.id}`);
      await expect(page.getByTestId("listing-unavailable")).toContainText("This listing isn't available at the moment.");
      await expect(page.getByRole("button", { name: /Book/ })).toHaveCount(0);
      await shot(page, "d01-public-unavailable");
    } finally { await visitor.close(); }

    // Reinstate (API) for the staff checks.
    expect((await rows(f, "SELECT status FROM centres WHERE id = ?", [centre.id]))[0].status).toBe("approved");
    await f.connection.execute("UPDATE organisations SET status = 'active' WHERE id = ?", [org.id]);

    // --- D-08: the owner's staff page ----------------------------------------------
    const ownerStaff = await browserAs(browser, owner.email, owner.password);
    try {
      const { page } = ownerStaff;
      await page.goto("/vendor?tab=org&section=staff");
      await page.getByRole("button", { name: `Manage QA staff centre_manager` }).click();
      await expect(page).toHaveURL(/record=member/);
      await expect(page.getByRole("heading", { level: 1, name: "QA staff centre_manager" })).toBeVisible();
      await page.getByLabel("New role").selectOption("finance");
      await page.getByRole("button", { name: "Change role…" }).click();
      const roleDialog = page.getByRole("alertdialog");
      await expect(roleDialog).toContainText("applies from their next action");
      await shot(page, "d08-change-role-confirm");
      // Stale screen: the member changes elsewhere before the owner confirms.
      await f.connection.execute("UPDATE users SET row_version = row_version + 1 WHERE id = ?", [manager.id]);
      await roleDialog.getByRole("button", { name: "Change role" }).click();
      await expect(roleDialog).toContainText(/changed since you opened|refresh/i);
      await roleDialog.getByRole("button", { name: "Cancel" }).click();
      await expect(page.getByRole("alert")).toContainText("changed somewhere else");
      await expect(page.getByLabel("New role")).toHaveValue("finance"); // the chosen role is kept
      await shot(page, "d08-stale-member");
      // Refresh reloads the member and re-opens the page with their current
      // details; wait for that reload before choosing again.
      const reloaded = page.waitForResponse((r) => r.url().endsWith("/api/vendor/org") && r.request().method() === "GET");
      await page.getByRole("button", { name: "Refresh" }).click();
      await reloaded;
      await expect(page.getByRole("alert")).toHaveCount(0);
      await page.getByLabel("New role").selectOption("finance");
      await page.getByRole("button", { name: "Change role…" }).click();
      await page.getByRole("alertdialog").getByRole("button", { name: "Change role" }).dblclick();
      await expect(page.getByRole("alertdialog")).toHaveCount(0);
      expect((await rows(f, "SELECT platform_role FROM users WHERE id = ?", [manager.id]))[0].platform_role).toBe("finance");
      expect(Number((await rows(f, "SELECT COUNT(*) AS n FROM audit_log WHERE object_id = ? AND action = 'org.staff_role_changed'", [manager.id]))[0].n)).toBe(1);
      // Removal: the consequences are shown first; cancelled here (removal itself is covered by validation-d08).
      await page.getByRole("button", { name: /^More actions for / }).click();
      await page.getByRole("menuitem", { name: "Remove from team…" }).click();
      const removeDialog = page.getByRole("alertdialog");
      await expect(removeDialog).toContainText("Listings and coupons they created stay with your organisation");
      await shot(page, "d08-remove-confirm");
      await page.keyboard.press("Escape");
      await expect(removeDialog).toHaveCount(0);
      expect((await rows(f, "SELECT org_id FROM users WHERE id = ?", [manager.id]))[0].org_id).toBe(org.id);
    } finally { await ownerStaff.context.close(); }

    await evidence("d01-d08-ui", { failedSubmitKeptText: true, decisionsAfterDoubleClick: 1, staleMessageShown: true });
  });
  for (const c of opened) await c.dispose();
});
