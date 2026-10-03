import type { Browser, BrowserContext, Page } from "@playwright/test";
import { expect, env, personas } from "./fixtures";

export const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  tablet: { width: 820, height: 1180 },
  mobile: { width: 390, height: 844 },
} as const;

/** A separate real browser session for one persona: real React/Vite, real
 * Express/MySQL, only external origins aborted. Login uses the real API in
 * the same cookie jar (UI login itself is covered by qa:auth). Consent is
 * pre-decided ("rejected" = necessary only) unless the caller opts out, so
 * HC-QA-001's banner overlap can be observed separately rather than masking
 * every lifecycle step. */
export async function uiActor(browser: Browser, role: string | null, viewport: keyof typeof VIEWPORTS, opts: { consent?: boolean } = {}) {
  const mobile = viewport === "mobile";
  const context: BrowserContext = await browser.newContext({ baseURL: env.E2E_BASE_URL, viewport: VIEWPORTS[viewport], isMobile: mobile && browser.browserType().name() !== "firefox", hasTouch: mobile, serviceWorkers: "block" });
  await context.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (url.origin === env.E2E_BASE_URL) await route.continue();
    else await route.abort("blockedbyclient");
  });
  if (opts.consent !== false) await context.addInitScript(() => { try { localStorage.setItem("hello_circle_cookie_consent", "rejected"); } catch { /* storage unavailable */ } });
  if (role) {
    const login = await context.request.post("/api/guest/login", { data: { email: env[`${role}_EMAIL`], password: env[`${role}_PASSWORD`] } });
    expect(login.status(), "real persona login").toBe(200);
    expect((await (await context.request.get("/api/residents/me")).json()).resident.id).toBe(personas[role].id);
  }
  const page: Page = await context.newPage();
  const consoleErrors: string[] = [];
  page.on("pageerror", error => consoleErrors.push(error.name));
  return { context, page, consoleErrors, close: async () => { if (role) await context.request.post("/api/guest/logout"); await context.close(); } };
}

/** Horizontal overflow check at the current viewport. */
export async function noHorizontalScroll(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
}
