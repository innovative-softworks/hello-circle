import { mkdirSync } from "node:fs";
import path from "node:path";
import type { Browser, BrowserContext, Page } from "@playwright/test";
import { test, expect, env } from "../fixtures";
import { evidence } from "../authorization-fixture";
import { connectedPreflight } from "../runtime";
import { uiActor, noHorizontalScroll, overflowingElements } from "../lifecycle-ui-fixture";

// OG-23 — every workspace page touched by the OG-01…OG-32 pass, at the nine
// widths the brief names, against the real stack (real React app, real
// Express + isolated MySQL). A page passes when it renders its one H1, has no
// horizontal page overflow, and its navigation is reachable (sidebar at
// desktop widths, the "Sections" button below 1025px). Logins: partner,
// admin, host = 3 (shared by the nine per-width tests).

const WIDTHS = [320, 375, 390, 428, 768, 1024, 1280, 1440, 1920] as const;

async function staffActor(browser: Browser, role: "QA_VENDOR" | "QA_ADMIN") {
  const context: BrowserContext = await browser.newContext({ baseURL: env.E2E_BASE_URL, viewport: { width: 1440, height: 900 }, serviceWorkers: "block" });
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
  if (role === "QA_VENDOR") expect((await context.request.post("/api/auth/accept-terms", { data: { termsAccepted: true } })).status()).toBe(200);
  const page = await context.newPage();
  const pageErrors: string[] = [];
  page.on("pageerror", (e) => pageErrors.push(e.name));
  return { context, page, pageErrors, close: async () => { await context.request.post("/api/auth/logout"); await context.close(); } };
}

async function shot(page: Page, name: string) {
  if (!/^[a-z0-9-]+$/.test(name)) throw new Error("bad screenshot name");
  const checked = await connectedPreflight();
  await checked.connection.end();
  const dir = path.join(checked.manifest.dataDir, "evidence", "og-responsive");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  await page.screenshot({ path: path.join(dir, `${name}.png`), fullPage: false });
}

/** Visits each url at one width; returns the failures (empty = all good). */
async function sweep(page: Page, width: number, pages: { url: string; name: string }[]) {
  const failures: string[] = [];
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width, height: width < 768 ? 844 : 900 });
  for (const p of pages) {
    await page.goto(p.url);
    await expect(page.locator("h1").first()).toBeVisible();
    // Let data-driven sections (tables, lists) render before measuring.
    await page.waitForLoadState("networkidle");
    if (!(await noHorizontalScroll(page))) failures.push(`${p.name} @${width}: ${(await overflowingElements(page)).join(" | ")}`);
    if (width >= 1025) {
      if (!(await page.locator(".adm-side nav").isVisible())) failures.push(`${p.name} @${width}: sidebar not visible`);
    } else if (!(await page.getByRole("button", { name: "Sections" }).isVisible())) failures.push(`${p.name} @${width}: no Sections button`);
    if (width === 320 || width === 1440) await shot(page, `${p.name}-${width}`);
  }
  return failures;
}

const ADMIN_PAGES = [
  { url: "/admin?tab=exceptions", name: "admin-exceptions" },
  { url: "/admin?tab=orders", name: "admin-orders" },
  { url: "/admin?tab=finance", name: "admin-finance" },
  { url: "/admin?tab=privacy", name: "admin-privacy" },
  { url: "/admin?tab=settings", name: "admin-settings" },
  // OG-24 (2026-10-17): the two lists now paged on the server.
  { url: "/admin?tab=vendors", name: "admin-vendors" },
  { url: "/admin?tab=listings", name: "admin-listings" },
];
const PARTNER_PAGES = [
  { url: "/vendor?tab=bookings&bsec=all", name: "partner-all-orders" },
  { url: "/vendor?tab=customers", name: "partner-customers" },
  { url: "/vendor?tab=earnings", name: "partner-earnings" },
];
const HOST_PAGES = [
  { url: "/manage?tab=activities", name: "host-activities" },
  { url: "/manage?tab=reservations", name: "host-reservations" },
  { url: "/games/host?from=manage", name: "host-new-activity" },
];

// One test per width (was one 600 s test for all 99 page loads, which used ~518 s
// of its budget on a normal run and timed out on a slower one). The three
// sessions are shared across the widths, so the batch still uses 3 logins.
test.describe.serial("OG-23-RESPONSIVE", () => {
  let admin: Awaited<ReturnType<typeof staffActor>>;
  let vendor: Awaited<ReturnType<typeof staffActor>>;
  let host: Awaited<ReturnType<typeof uiActor>>;
  test.beforeAll(async ({ browser }) => {
    admin = await staffActor(browser, "QA_ADMIN");
    vendor = await staffActor(browser, "QA_VENDOR");
    host = await uiActor(browser, "QA_HOST", "desktop");
    expect((await host.context.request.post("/api/residents/me/accept-terms", { data: { termsAccepted: true } })).status()).toBe(200);
  });
  test.afterAll(async () => {
    await admin?.close();
    await vendor?.close();
    await host?.close();
  });
  for (const width of WIDTHS) {
    test(`OG-23-RESPONSIVE-${width}: admin, partner and host workspace pages at ${width}px`, async () => {
      test.setTimeout(240_000);
      const failures = [...(await sweep(admin.page, width, ADMIN_PAGES)), ...(await sweep(vendor.page, width, PARTNER_PAGES)), ...(await sweep(host.page, width, HOST_PAGES))];
      expect(failures, `every page at ${width}px`).toEqual([]);
      for (const s of [admin, vendor]) expect(s.pageErrors, "no uncaught page errors").toEqual([]);
      expect(host.consoleErrors, "no uncaught page errors").toEqual([]);
      await evidence(`og-23-responsive-${width}`, { width, pages: ADMIN_PAGES.length + PARTNER_PAGES.length + HOST_PAGES.length });
    });
  }
});
