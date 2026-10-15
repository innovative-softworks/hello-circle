import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import type { Browser, BrowserContext, Page } from "@playwright/test";
import { test, expect, env, personas } from "../fixtures";
import { withActors, evidence } from "../authorization-fixture";
import { connectedPreflight } from "../runtime";
import { VIEWPORTS, uiActor, noHorizontalScroll } from "../lifecycle-ui-fixture";

// Full validation 2026-10-14 — workspace UX against the real stack (real
// React app, real Express + isolated MySQL). Route interception is used only
// to inject single-endpoint failures, and is labelled as UI verification.
// Logins: partner, host, admin, resident = 4 (real limiter untouched).

async function shot(page: Page, name: string) {
  if (!/^[a-z0-9-]+$/.test(name)) throw new Error("bad screenshot name");
  const checked = await connectedPreflight();
  await checked.connection.end();
  const dir = path.join(checked.manifest.dataDir, "evidence", "validation");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  await page.screenshot({ path: path.join(dir, `${name}.png`), fullPage: true });
}

/** A vendor/admin browser session (uiActor covers residents only). */
async function staffActor(browser: Browser, role: "QA_VENDOR" | "QA_ADMIN") {
  const context: BrowserContext = await browser.newContext({ baseURL: env.E2E_BASE_URL, viewport: VIEWPORTS.desktop, serviceWorkers: "block" });
  await context.route("**/*", async (route) => {
    if (new URL(route.request().url()).origin === env.E2E_BASE_URL) await route.continue();
    else await route.abort("blockedbyclient");
  });
  await context.addInitScript(() => {
    try {
      localStorage.setItem("hello_circle_cookie_consent", "rejected");
    } catch {
      /* storage unavailable */
    }
  });
  const login = await context.request.post("/api/auth/login", { data: { email: env[`${role}_EMAIL`], password: env[`${role}_PASSWORD`] } });
  expect(login.status(), "real persona login").toBe(200);
  // Seeded personas predate recorded Terms acceptance; complete that real
  // step first so the (correct) Terms gate doesn't cover the workspace.
  if (role === "QA_VENDOR") expect((await context.request.post("/api/auth/accept-terms", { data: { termsAccepted: true } })).status()).toBe(200);
  const page = await context.newPage();
  const pageErrors: string[] = [];
  page.on("pageerror", (e) => pageErrors.push(e.name));
  return { context, page, pageErrors, close: async () => { await context.request.post("/api/auth/logout"); await context.close(); } };
}

async function atEachViewport(page: Page, url: string, label: string, name: string) {
  // Screenshots are evidence of layout, not of entrance animations.
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const vp of ["desktop", "tablet", "mobile"] as const) {
    await page.setViewportSize(VIEWPORTS[vp]);
    await page.goto(url);
    await expect(page.locator(".adm-strip-label")).toHaveText(label);
    await expect(page.locator("h1")).toHaveCount(1);
    expect(await noHorizontalScroll(page), `${name} ${vp}: no page overflow`).toBe(true);
    // Navigation stays reachable: sidebar on desktop, "Sections" sheet below 1025px.
    if (vp === "desktop") await expect(page.locator(".adm-side nav")).toBeVisible();
    else await expect(page.getByRole("button", { name: "Sections" })).toBeVisible();
    await shot(page, `${name}-${vp}`);
  }
  // The Sections sheet: opens as a dialog, Escape closes it and returns focus.
  await page.setViewportSize(VIEWPORTS.mobile);
  const trigger = page.getByRole("button", { name: "Sections" });
  await trigger.click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await shot(page, `${name}-mobile-sections`);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await page.setViewportSize(VIEWPORTS.desktop);
}

async function tabHistory(page: Page, base: string, first: string, second: string) {
  await page.goto(base);
  const nav = page.locator(".adm-side nav");
  await nav.getByRole("button", { name: first, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`[?&]tab=`));
  await expect(page.locator("h1")).toHaveText(first);
  await nav.getByRole("button", { name: second, exact: true }).click();
  await expect(page.locator("h1")).toHaveText(second);
  await page.goBack();
  await expect(page.locator("h1"), "Back returns to the previous tab").toHaveText(first);
  await page.goForward();
  await expect(page.locator("h1"), "Forward re-opens the next tab").toHaveText(second);
  await page.reload();
  await expect(page.locator("h1"), "refresh keeps the tab").toHaveText(second);
}

test("VAL-UX-WORKSPACES: partner, host and admin share the cream workspace at 1440/820/390 with URL tabs", async ({ browser }) => {
  test.setTimeout(150_000);
  const vendor = await staffActor(browser, "QA_VENDOR");
  const admin = await staffActor(browser, "QA_ADMIN");
  const host = await uiActor(browser, "QA_HOST", "desktop");
  try {
    expect((await host.context.request.post("/api/residents/me/accept-terms", { data: { termsAccepted: true } })).status()).toBe(200);
    await atEachViewport(vendor.page, "/vendor", "Partner workspace", "partner-overview");
    await atEachViewport(host.page, "/manage", "Host workspace", "host-overview");
    await atEachViewport(admin.page, "/admin", "Admin workspace", "admin-overview");
    // Workspace pages carry the compact workspace footer, not the marketing one.
    for (const p of [vendor.page, host.page]) await expect(p.locator("footer.adm-footer")).toHaveCount(1);

    await tabHistory(vendor.page, "/vendor", "Bookings", "Earnings");
    await shot(vendor.page, "partner-earnings");
    await tabHistory(host.page, "/manage", "Calendar", "Earnings");
    await tabHistory(admin.page, "/admin", "Support", "Audit log");

    for (const s of [vendor, admin]) expect(s.pageErrors, "no uncaught page errors").toEqual([]);
    expect(host.consoleErrors, "no uncaught page errors").toEqual([]);
    await evidence("val-ux-workspaces", { workspaces: 3, viewports: 3, historyChecks: 3 });
  } finally {
    await vendor.close();
    await admin.close();
    await host.close();
  }
});

test("VAL-UX-REJECTED-RESUBMIT: a rejected listing explains the next step and can be resubmitted from its editor", async ({ playwright, browser }) => {
  await withActors(playwright, [], async (f) => {
    const vendor = await staffActor(browser, "QA_VENDOR");
    try {
      const created = await vendor.context.request.post("/api/vendor/centres", { data: { name: `QA UX rejected ${randomUUID()}`, paymentMethod: "cash" } });
      expect(created.status()).toBe(201);
      const id = (await created.json()).id as string;
      for (const [table, column] of [["centres", "id"], ["rooms", "centre_id"], ["centre_amenities", "centre_id"], ["centre_images", "centre_id"], ["audit_log", "object_id"]]) f.track(table, column, id);
      await f.connection.execute("UPDATE centres SET status = 'rejected', area = 'QA', county = 'Dublin', blurb = 'QA' WHERE id = ? AND vendor_id = ?", [id, personas.QA_VENDOR.id]);
      await vendor.page.goto(`/vendor/centres/${id}`);
      const notice = vendor.page.getByRole("status").filter({ hasText: "Not approved yet" });
      await expect(notice).toBeVisible();
      await shot(vendor.page, "partner-rejected-listing");
      await notice.getByRole("button", { name: "Resubmit for review" }).click();
      await expect(vendor.page.getByRole("status").filter({ hasText: "Waiting for HelloCircle review" })).toBeVisible();
      const [[row]] = await f.connection.query<any[]>("SELECT status FROM centres WHERE id = ?", [id]);
      expect(row.status).toBe("pending");
    } finally {
      await vendor.close();
    }
  });
});

test("VAL-UX-ERRORS: failed loads are errors with retry, never an empty list (UI verification, single endpoint injected)", async ({ browser }) => {
  const admin = await staffActor(browser, "QA_ADMIN");
  const user = await uiActor(browser, "QA_USER", "desktop");
  try {
    // Admin Finance → Refunds: one failed request.
    let armed = true;
    await admin.page.route((u) => armed && u.pathname === "/api/admin/finance/refunds", (r) => r.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "Server error" }) }));
    await admin.page.goto("/admin?tab=finance&section=refunds");
    const alert = admin.page.getByRole("alert").filter({ hasText: "Couldn't load this." });
    await expect(alert).toBeVisible();
    await expect(admin.page.getByText("Nothing here.")).toHaveCount(0);
    await shot(admin.page, "admin-finance-load-error");
    armed = false;
    await alert.getByRole("button", { name: "Try again" }).click();
    await expect(alert).toHaveCount(0);

    // My Life: a failed core source no longer leaves the skeleton up or reads as empty.
    let armedUser = true;
    await user.page.route((u) => armedUser && u.pathname === "/api/registrations", (r) => r.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "Server error" }) }));
    await user.page.goto("/my-life");
    const lifeAlert = user.page.getByRole("alert").filter({ hasText: "Some of your activity couldn't load." });
    await expect(lifeAlert).toBeVisible();
    await shot(user.page, "my-life-partial-failure");
    armedUser = false;
    await lifeAlert.getByRole("button", { name: "Try again" }).click();
    await expect(lifeAlert).toHaveCount(0);
  } finally {
    await admin.close();
    await user.close();
  }
});

test("VAL-UX-RESTRICTED: signed-out Pro and rewards pages ask the visitor to sign in", async ({ browser }) => {
  const guest = await uiActor(browser, null, "mobile");
  try {
    await guest.page.goto("/vendor/pro");
    await expect(guest.page.getByRole("alert").filter({ hasText: "Sign in to see your plan." })).toBeVisible();
    await guest.page.goto("/manage/rewards");
    await expect(guest.page.getByRole("alert").filter({ hasText: "Sign in to see your reward history." })).toBeVisible();
    await shot(guest.page, "rewards-signed-out-mobile");
  } finally {
    await guest.close();
  }
});
