import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import { expect, env, test } from "../fixtures";
import { evidence, withActors } from "../authorization-fixture";
import { uiActor } from "../lifecycle-ui-fixture";
import { cleanupVendorSignup, focused, mailTo, tabTo } from "../product-fixture";

// Phase 10A — HC-QA-052 (P1, vendor signup keyboard/screen-reader) and
// HC-QA-058 (vendor onboarding emails). Original failing-before regressions
// first; adjacent invariants after. Synthetic example.test vendors only,
// removed by exact email scope.

const PASSWORD = `QA-${randomUUID()}`;

/** Completes the whole two-step signup with the keyboard only (Tab /
 * Shift+Tab / Space / Enter / typing) — never a mouse click. */
async function keyboardVendorSignup(page: Page, email: string) {
  await page.goto("/vendor/signup");
  await expect(page.locator("#vendor-signup-name")).toBeVisible();
  await page.locator("body").focus();
  expect(await tabTo(page, (f) => f.id === "vendor-signup-name"), "name reachable").not.toBeNull();
  await page.keyboard.type("QA Keyboard Vendor");
  expect(await tabTo(page, (f) => f.id === "vendor-signup-email"), "email reachable").not.toBeNull();
  await page.keyboard.type(email);
  expect(await tabTo(page, (f) => f.id === "vendor-signup-password"), "password reachable").not.toBeNull();
  await page.keyboard.type(PASSWORD);
  // The step's own submit ("Continue →"), not "Continue with Google".
  expect(await tabTo(page, (f) => f.tag === "BUTTON" && /^Continue\s*→?$/.test(f.name)), "step-1 submit reachable").not.toBeNull();
  await page.keyboard.press("Enter");
  await expect(page.getByText("About your place.")).toBeVisible();
  // HC-QA-089 — focus moves to the new step's heading (start of new content).
  await expect(page.getByRole("heading", { name: "About your place." })).toBeFocused();

  // The required "What are you?" choice: a native radio, reachable, named,
  // and selectable with the keyboard.
  const radio = await tabTo(page, (f) => f.type === "radio");
  expect(radio, "HC-QA-052: vendor type choice reachable by Tab").not.toBeNull();
  expect(radio!.name).toMatch(/Community hall or Centre|Sports club/);
  await page.keyboard.press("Space");
  const chosen = await focused(page);
  expect(await page.evaluate(() => (document.activeElement as HTMLInputElement).checked), "Space selects the focused vendor type").toBe(true);
  expect(chosen.focusVisible, "focused vendor type shows a visible focus indicator").toBe(true);

  expect(await tabTo(page, (f) => f.id === "vendor-signup-business-name")).not.toBeNull();
  await page.keyboard.type("QA Keyboard Hall");
  expect(await tabTo(page, (f) => f.id === "vendor-signup-county")).not.toBeNull();
  await page.keyboard.type("Dublin");
  expect(await tabTo(page, (f) => f.id === "vendor-signup-address")).not.toBeNull();
  await page.keyboard.type("1 QA Street, Dublin");
  expect(await tabTo(page, (f) => f.id === "vendor-signup-mobile")).not.toBeNull();
  await page.keyboard.type("0870000000");
  expect(await tabTo(page, (f) => f.id === "vendor-signup-description")).not.toBeNull();
  await page.keyboard.type("Synthetic keyboard-only signup");
  const terms = await tabTo(page, (f) => f.id === "vendor-signup-terms");
  expect(terms, "terms checkbox reachable").not.toBeNull();
  expect(terms!.name).toMatch(/agree/i);
  await page.keyboard.press("Space");
  expect(await page.locator("#vendor-signup-terms").isChecked()).toBe(true);
  expect(await tabTo(page, (f) => f.tag === "BUTTON" && /Create vendor account/.test(f.name)), "final submit reachable and enabled").not.toBeNull();
  await page.keyboard.press("Enter");
  await expect(page.getByText("Account created.")).toBeVisible();
}

for (const viewport of ["desktop", "mobile"] as const) {
  test(`HC-QA-052: vendor signup is completable with the keyboard only (${viewport})`, async ({ browser, request }) => {
    const email = `qa_vendor_kbd_${randomUUID().slice(0, 8)}@example.test`;
    const ui = await uiActor(browser, null, viewport);
    try {
      await keyboardVendorSignup(ui.page, email);
      const created = await request.get("/api/__qa/identity"); // backend still the isolated QA one
      expect(created.status()).toBe(200);
      await evidence(`hc-qa-052-${viewport}`, { keyboardOnly: true, completed: true });
    } finally {
      await ui.close();
      await cleanupVendorSignup(email);
    }
  });
}

test("HC-QA-052-SEMANTICS: vendor type is a labelled radio group; errors are associated with fields", async ({ browser }) => {
  test.setTimeout(45_000);
  const ui = await uiActor(browser, null, "desktop");
  const { page } = ui;
  try {
    await page.goto("/vendor/signup");
    await page.fill("#vendor-signup-name", "QA Semantics");
    await page.fill("#vendor-signup-email", `qa_vendor_sem_${randomUUID().slice(0, 8)}@example.test`);
    await page.fill("#vendor-signup-password", PASSWORD);
    await page.getByRole("button", { name: "Continue →" }).click();
    const group = page.getByRole("group", { name: "What are you?" });
    await expect(group).toBeVisible();
    await expect(group.getByRole("radio")).toHaveCount(2);
    await expect(group.getByRole("radio", { name: "Community hall or Centre" })).not.toBeChecked();
    await group.getByText("Sports club").click(); // the visible tile (a <label>)
    await expect(group.getByRole("radio", { name: "Sports club" })).toBeChecked();
    // Arrow keys move within the native group.
    await group.getByRole("radio", { name: "Sports club" }).focus();
    await page.keyboard.press("ArrowLeft");
    await expect(group.getByRole("radio", { name: "Community hall or Centre" })).toBeChecked();
    // Field labels stay programmatic.
    for (const id of ["vendor-signup-business-name", "vendor-signup-county", "vendor-signup-address", "vendor-signup-mobile", "vendor-signup-description", "vendor-signup-terms"]) {
      expect(await page.locator(`#${id}`).evaluate((e: HTMLInputElement) => (e.labels?.length ?? 0) > 0 && !!e.labels![0].textContent?.trim()), `${id} labelled`).toBe(true);
    }
  } finally { await ui.close(); }
});

test("HC-QA-058: vendor receives a signup acknowledgement email (local QA sink)", async ({ browser, request }) => {
  const email = `qa_vendor_mail_${randomUUID().slice(0, 8)}@example.test`;
  const ui = await uiActor(browser, null, "desktop");
  try {
    const { page } = ui;
    await page.goto("/vendor/signup");
    await page.fill("#vendor-signup-name", "QA Mail Vendor");
    await page.fill("#vendor-signup-email", email);
    await page.fill("#vendor-signup-password", PASSWORD);
    await page.getByRole("button", { name: "Continue →" }).click();
    await page.getByText("Community hall or Centre").click(); // the visible tile (a <label>)
    await expect(page.getByRole("radio", { name: "Community hall or Centre" })).toBeChecked();
    await page.fill("#vendor-signup-business-name", "QA Mail Hall");
    await page.selectOption("#vendor-signup-county", "Dublin");
    await page.fill("#vendor-signup-address", "2 QA Street");
    await page.fill("#vendor-signup-mobile", "0870000000");
    await page.fill("#vendor-signup-description", "Synthetic");
    await page.check("#vendor-signup-terms");
    await page.getByRole("button", { name: "Create vendor account" }).dblclick();
    await expect(page.getByText("Account created.")).toBeVisible();
    await expect.poll(async () => (await mailTo(request, email)).length).toBe(1);
    const [mail] = await mailTo(request, email);
    expect(mail.subject).toMatch(/received|application/i);
    expect(mail.linkOrigins.every((o) => o === env.CLIENT_URL)).toBe(true);
    expect(mail.tokenLink, "acknowledgement carries no secret-bearing link").toBe(false);
    await evidence("hc-qa-058-signup", { emails: 1, subjectMatches: true });
  } finally {
    await ui.close();
    await cleanupVendorSignup(email);
  }
});

test("HC-QA-058: vendor approval sends exactly one approval email (retries and concurrency)", async ({ playwright, request }) => {
  const email = `qa_vendor_appr_${randomUUID().slice(0, 8)}@example.test`;
  try {
    const signup = await request.post("/api/auth/signup", { data: { name: "QA Approval Vendor", email, password: PASSWORD, vendorType: "community", businessName: "QA Approval Hall", address: "3 QA Street", county: "Dublin", mobile: "0870000000", description: "Synthetic", termsAccepted: true } });
    expect(signup.status()).toBe(201);
    const vendorId = (await signup.json()).user.id as string;
    await withActors(playwright, ["QA_ADMIN"], async (f) => {
      const approve = () => f.actors.QA_ADMIN.put(`/api/admin/vendors/${vendorId}/status`, { data: { status: "approved" } });
      const statuses = (await Promise.all([approve(), approve(), approve()])).map((r) => r.status());
      expect(statuses.every((s) => s === 200), "idempotent approval").toBe(true);
      expect((await approve()).status()).toBe(200);
      const approvals = (await mailTo(request, email)).filter((m) => /approved/i.test(m.subject));
      expect(approvals.length, "one approval email despite 4 approve calls").toBe(1);
      expect(approvals[0].linkOrigins).toEqual([env.CLIENT_URL]);
      expect(approvals[0].tokenLink).toBe(false);
      // Suspending never emails "approved".
      expect((await f.actors.QA_ADMIN.put(`/api/admin/vendors/${vendorId}/status`, { data: { status: "suspended" } })).status()).toBe(200);
      expect((await mailTo(request, email)).filter((m) => /approved/i.test(m.subject)).length).toBe(1);
      // Unknown vendor id still 404s.
      expect((await f.actors.QA_ADMIN.put(`/api/admin/vendors/${randomUUID()}/status`, { data: { status: "approved" } })).status()).toBe(404);
      await evidence("hc-qa-058-approval", { approveCalls: 4, approvalEmails: approvals.length });
    });
  } finally { await cleanupVendorSignup(email); }
});
