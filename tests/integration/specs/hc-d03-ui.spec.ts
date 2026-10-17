import { randomBytes, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import bcrypt from "bcryptjs";
import type { Page } from "@playwright/test";
import { test, expect, env, personas } from "../fixtures";
import { withActors, evidence } from "../authorization-fixture";
import { businessUiActor } from "../product-fixture";
import { connectedPreflight } from "../runtime";

// D-03 browser checks: reason fields in the centred confirmation, text kept on
// a failed save, one decision per double click, phone layout, and the partner
// and suspended sign-in views, bulk rejection, a restricted (finance) admin and
// keyboard use. Logins (real limiter of 10 per IP): QA_VENDOR, four browser
// sessions, one admin API session, one sign-in attempt, one finance admin = 8.

const NOTE = "INTERNAL-NOTE-MARKER do not show to partners";

async function shot(page: Page, name: string) {
  const checked = await connectedPreflight();
  await checked.connection.end();
  const dir = path.join(checked.manifest.dataDir, "evidence", "completion");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.screenshot({ path: path.join(dir, `${name}.png`), fullPage: true });
}

test("D03-UI: reason fields in the centred confirmation, text kept on failure, partner and suspended sign-in see the explanation", async ({ playwright, browser }) => {
  test.setTimeout(150_000);
  await withActors(playwright, ["QA_VENDOR"], async (f) => {
    const created = await f.actors.QA_VENDOR.post("/api/vendor/centres", { data: { name: `QA D-03 UI ${randomUUID().slice(0, 8)}`, paymentMethod: "cash" } });
    expect(created.status()).toBe(201);
    const { id: centreId, name } = (await created.json()) as { id: string; name: string };
    for (const [t, c] of [["centres", "id"], ["rooms", "centre_id"], ["centre_amenities", "centre_id"], ["centre_images", "centre_id"], ["audit_log", "object_id"], ["moderation_decisions", "object_id"], ["notifications", "listing_id"]]) f.track(t, c, centreId);
    expect((await f.actors.QA_VENDOR.put(`/api/vendor/centres/${centreId}`, { data: { area: "Rathmines", county: "Dublin", blurb: "D-03 UI centre" } })).status()).toBe(200);
    expect((await f.actors.QA_VENDOR.post(`/api/vendor/centres/${centreId}/publish`)).status()).toBe(200);
    const explanation = "The address on the listing doesn't match the hall in the photos.";

    const admin = await businessUiActor(browser, "QA_ADMIN", "desktop");
    try {
      const { page } = admin;
      page.setDefaultTimeout(15_000); // a missing control fails at its step, not at the test timeout
      await page.goto(`/admin?tab=pending&record=centre:${centreId}`);
      await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
      // Pending approvals redesign (2026-10-16): "Reject…", or "Reject & next…" when more are waiting.
      await page.getByRole("button", { name: /^Reject( & next)?…$/ }).click();
      const dialog = page.getByRole("alertdialog", { name: `Reject ${name}?` });
      await expect(dialog).toBeVisible();
      await expect(dialog).toContainText("Visible to the partner");
      await expect(dialog).toContainText("Internal note");
      await expect(dialog).toContainText("The internal note isn't sent to them");
      const confirm = dialog.getByRole("button", { name: "Reject listing" });
      await expect(confirm).toBeDisabled();
      await dialog.getByLabel(/Reason category/).selectOption("misleading");
      await dialog.getByLabel(/^Explanation/).fill("Too short");
      await expect(confirm).toBeDisabled();
      await dialog.getByLabel(/^Explanation/).fill(explanation);
      await dialog.getByLabel(/^Internal note/).fill(NOTE);
      await expect(confirm).toBeEnabled();
      await shot(page, "d03-listing-reject-confirm");

      // A failed save keeps the dialog open with everything typed, and shows the error.
      let calls = 0;
      await page.route(`**/api/admin/centres/${centreId}/status`, async (route) => {
        calls++;
        await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "QA: simulated outage" }) });
      });
      await confirm.click();
      await expect(dialog).toContainText("simulated outage");
      await expect(dialog.getByLabel(/^Explanation/)).toHaveValue(explanation);
      await expect(dialog.getByLabel(/^Internal note/)).toHaveValue(NOTE);
      expect(calls).toBe(1);
      expect((await f.connection.query<any[]>("SELECT status FROM centres WHERE id = ?", [centreId]))[0][0].status).toBe("pending");
      await shot(page, "d03-listing-reject-failed");
      await page.unroute(`**/api/admin/centres/${centreId}/status`);

      // A double click submits once.
      await confirm.dblclick();
      await expect(dialog).toHaveCount(0);
      const [[{ n }]] = await f.connection.query<any[]>("SELECT COUNT(*) AS n FROM moderation_decisions WHERE object_id = ?", [centreId]);
      expect(Number(n)).toBe(1);
      // "Reject & next" moves on to the next waiting listing; the decision is on this listing's record.
      await page.goto(`/admin?tab=listings&record=centre:${centreId}`);
      await expect(page.getByText(explanation)).toBeVisible();
      await expect(page.getByText(NOTE)).toBeVisible(); // super admin: internal notes shown in the history
      await shot(page, "d03-listing-decision-history");

      // Bulk rejection: one reason for every selected listing, one decision each.
      const tag = randomUUID().slice(0, 8);
      const bulkIds: string[] = [];
      for (const n of [1, 2]) {
        const r = await f.actors.QA_VENDOR.post("/api/vendor/centres", { data: { name: `QA D-03 bulk ${tag} ${n}`, paymentMethod: "cash" } });
        const id = (await r.json()).id as string;
        bulkIds.push(id);
        for (const [t, c] of [["centres", "id"], ["rooms", "centre_id"], ["centre_amenities", "centre_id"], ["centre_images", "centre_id"], ["audit_log", "object_id"], ["moderation_decisions", "object_id"], ["notifications", "listing_id"]]) f.track(t, c, id);
        expect((await f.actors.QA_VENDOR.put(`/api/vendor/centres/${id}`, { data: { area: "Rathmines", county: "Dublin", blurb: "D-03 bulk" } })).status()).toBe(200);
        expect((await f.actors.QA_VENDOR.post(`/api/vendor/centres/${id}/publish`)).status()).toBe(200);
      }
      await page.goto(`/admin?tab=pending&q=${encodeURIComponent(`QA D-03 bulk ${tag}`)}`);
      for (const n of [1, 2]) await page.getByLabel(`Select QA D-03 bulk ${tag} ${n}`).check();
      await page.getByRole("region", { name: "Bulk actions" }).getByRole("button", { name: "Reject 2" }).click();
      const bulk = page.getByRole("alertdialog", { name: "Reject 2 listings?" });
      await expect(bulk.getByRole("button", { name: "Reject all" })).toBeDisabled();
      await bulk.getByLabel(/Reason category/).selectOption("duplicate");
      await bulk.getByLabel(/^Explanation/).fill("These duplicate an existing listing for the same hall.");
      await shot(page, "d03-bulk-reject-confirm");
      await bulk.getByRole("button", { name: "Reject all" }).click();
      await expect(page.getByText(/Rejected 2 listings/)).toBeVisible();
      const [bulkRows] = await f.connection.query<any[]>("SELECT object_id, reason_category, explanation FROM moderation_decisions WHERE object_id IN (?, ?) ORDER BY object_id", bulkIds);
      expect(bulkRows.map((r: any) => [r.reason_category, r.explanation])).toEqual([["duplicate", "These duplicate an existing listing for the same hall."], ["duplicate", "These duplicate an existing listing for the same hall."]]);

      // Keyboard: the dialog takes focus, Tab stays inside it, Escape closes it and focus returns.
      await page.goto(`/admin?tab=listings&record=centre:${bulkIds[0]}`);
      const decline = page.getByRole("button", { name: "Back to pending", exact: false }).or(page.getByRole("button", { name: "Approve & publish" }));
      await expect(decline.first()).toBeVisible();
      // Delete lives in the record's "More actions" menu (admin redesign 2026-10-16):
      // open it from the keyboard, End jumps to the destructive item, Enter chooses it.
      const del = page.getByRole("button", { name: /^More actions for / });
      await del.focus();
      await page.keyboard.press("Enter");
      await expect(page.getByRole("menuitem", { name: "Delete listing…" })).toBeVisible();
      await page.keyboard.press("End");
      await expect(page.getByRole("menuitem", { name: "Delete listing…" })).toBeFocused();
      await page.keyboard.press("Enter");
      const delDialog = page.getByRole("alertdialog");
      await expect(delDialog).toBeVisible();
      for (let i = 0; i < 6; i++) {
        await page.keyboard.press("Tab");
        expect(await delDialog.evaluate((d) => d.contains(document.activeElement))).toBe(true);
      }
      await page.keyboard.press("Escape");
      await expect(delDialog).toHaveCount(0);
      await expect(del).toBeFocused();
    } finally { await admin.close(); }

    // A finance admin (no moderation permissions): direct URLs show the record,
    // but no decision controls, and the moderation tools are locked.
    const financeId = randomUUID(), financePassword = randomBytes(24).toString("hex"), financeEmail = `qa_d03_finance_${financeId}@example.test`;
    await f.connection.execute("INSERT INTO users (id, email, password_hash, role, status, name, admin_role) VALUES (?, ?, ?, 'admin', 'approved', 'QA D-03 finance', 'finance')", [financeId, financeEmail, bcrypt.hashSync(financePassword, 10)]);
    for (const [t, c] of [["users", "id"], ["sessions", "user_id"], ["audit_log", "actor_user_id"]]) f.track(t, c, financeId);
    const financeContext = await browser.newContext({ baseURL: env.E2E_BASE_URL, serviceWorkers: "block" });
    try {
      await financeContext.route("**/*", async (route) => (new URL(route.request().url()).origin === env.E2E_BASE_URL ? route.continue() : route.abort("blockedbyclient")));
      await financeContext.addInitScript(() => { try { localStorage.setItem("hello_circle_cookie_consent", "rejected"); } catch { /* storage unavailable */ } });
      expect((await financeContext.request.post("/api/auth/login", { data: { email: financeEmail, password: financePassword } })).status()).toBe(200);
      const page = await financeContext.newPage();
      await page.goto(`/admin?tab=listings&record=centre:${centreId}`);
      await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
      for (const label of ["Reject listing", "Approve & publish", "Delete listing"]) await expect(page.getByRole("button", { name: label })).toHaveCount(0);
      await expect(page.getByText("Internal notes aren't shown for your admin role.")).toBeVisible();
      await expect(page.getByText("INTERNAL-NOTE-MARKER")).toHaveCount(0);
      await shot(page, "d03-finance-listing-record");
      await page.goto(`/admin?tab=vendors&record=${personas.QA_VENDOR_B.id}`);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(page.getByRole("button", { name: "Suspend account" })).toHaveCount(0);
      await page.goto("/admin?tab=claims");
      await expect(page.getByText("Not included in your admin role")).toBeVisible();
      await shot(page, "d03-finance-locked-claims");
    } finally { await financeContext.close(); }

    // Mobile: the confirmation is a centred card that fits a phone with no sideways scroll.
    const mobile = await businessUiActor(browser, "QA_ADMIN", "mobile");
    try {
      const { page } = mobile;
      await page.goto(`/admin?tab=vendors&record=${personas.QA_VENDOR_B.id}`);
      await page.getByRole("button", { name: "Suspend account" }).click();
      const dialog = page.getByRole("alertdialog");
      await expect(dialog).toContainText("Visible to the partner");
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      const box = await dialog.boundingBox();
      expect(box && box.x >= 0 && box.x + box.width <= (page.viewportSize()?.width ?? 0)).toBe(true);
      await shot(page, "d03-suspend-confirm-mobile");
      await dialog.getByRole("button", { name: "Cancel" }).click();
      expect((await f.connection.query<any[]>("SELECT status FROM users WHERE id = ?", [personas.QA_VENDOR_B.id]))[0][0].status).toBe("approved");
    } finally { await mobile.close(); }

    // The partner sees the reason on the listing's editor page, without the note.
    const partner = await businessUiActor(browser, "QA_VENDOR", "desktop");
    try {
      const { page } = partner;
      await page.goto(`/vendor/centres/${centreId}`);
      await expect(page.getByText("Not approved yet — changes needed")).toBeVisible();
      const reason = page.getByTestId("decision-explanation");
      await expect(reason).toContainText("Misleading or inaccurate");
      await expect(reason).toContainText(explanation);
      await expect(page.getByText("INTERNAL-NOTE-MARKER")).toHaveCount(0);
      await shot(page, "d03-partner-listing-reason");
    } finally { await partner.close(); }

    // A suspended partner signing in with the right password sees why.
    const ownerId = randomUUID(), password = randomBytes(24).toString("hex"), email = `qa_d03_ui_${ownerId}@example.test`;
    await f.connection.execute("INSERT INTO users (id, email, password_hash, role, status, name) VALUES (?, ?, ?, 'vendor', 'approved', 'QA D-03 UI partner')", [ownerId, email, bcrypt.hashSync(password, 10)]);
    for (const [t, c] of [["users", "id"], ["sessions", "user_id"], ["audit_log", "object_id"], ["moderation_decisions", "object_id"], ["notifications", "recipient_id"]]) f.track(t, c, ownerId);
    const adminApi = await playwright.request.newContext({ baseURL: env.E2E_BASE_URL });
    try {
      expect((await adminApi.post("/api/auth/login", { data: { email: env.QA_ADMIN_EMAIL, password: env.QA_ADMIN_PASSWORD } })).status()).toBe(200);
      expect((await adminApi.put(`/api/admin/vendors/${ownerId}/status`, { data: { status: "suspended", reasonCategory: "terms_breach", explanation: "Sessions were repeatedly cancelled without notice.", internalNote: NOTE } })).status()).toBe(200);
    } finally { await adminApi.dispose(); }
    const context = await browser.newContext({ baseURL: env.E2E_BASE_URL, serviceWorkers: "block" });
    try {
      await context.route("**/*", async (route) => (new URL(route.request().url()).origin === env.E2E_BASE_URL ? route.continue() : route.abort("blockedbyclient")));
      await context.addInitScript(() => { try { localStorage.setItem("hello_circle_cookie_consent", "rejected"); } catch { /* storage unavailable */ } });
      const page = await context.newPage();
      await page.goto("/login");
      await page.getByLabel(/Email/).first().fill(email);
      await page.getByLabel(/Password/).first().fill(password);
      await page.getByRole("button", { name: /Sign in/ }).click();
      const reason = page.getByTestId("decision-explanation");
      await expect(reason).toContainText("Sessions were repeatedly cancelled without notice.");
      await expect(page.getByText("INTERNAL-NOTE-MARKER")).toHaveCount(0);
      await shot(page, "d03-suspended-sign-in");
    } finally { await context.close(); }
    await evidence("d03-ui", { failedSubmitKeptText: true, doubleClickDecisions: 1 });
  });
});
