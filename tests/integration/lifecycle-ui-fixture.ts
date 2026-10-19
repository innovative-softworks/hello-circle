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

/** Diagnostic for a failed overflow check: the outermost elements reaching past
 * the viewport, as tag.class (no text or data). */
export async function overflowingElements(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const vw = window.innerWidth;
    const out: string[] = [];
    for (const el of Array.from(document.querySelectorAll("body *"))) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.right <= vw + 1) continue;
      if (el.parentElement && el.parentElement.getBoundingClientRect().right > vw + 1) continue;
      // Ignore content clipped by a scrolling ancestor.
      let clipped = false;
      for (let p = el.parentElement; p; p = p.parentElement) {
        const ox = getComputedStyle(p).overflowX;
        if (ox === "auto" || ox === "scroll" || ox === "hidden" || ox === "clip") { clipped = true; break; }
      }
      if (clipped) continue;
      out.push(`${el.tagName.toLowerCase()}.${String(el.className || "").split(" ").slice(0, 3).join(".")} right=${Math.round(r.right)}`);
      if (out.length >= 8) break;
    }
    return out;
  });
}

/** A real browser session for a vendor/admin account (password login through
 * the real API, same cookie jar); external origins aborted. Pass `credentials`
 * for an account the test created itself (e.g. a sub-role admin). */
export async function staffActor(browser: Browser, role: string, opts: { credentials?: { email: string; password: string }; viewport?: keyof typeof VIEWPORTS } = {}) {
  const context: BrowserContext = await browser.newContext({ baseURL: env.E2E_BASE_URL, viewport: VIEWPORTS[opts.viewport ?? "desktop"], serviceWorkers: "block", acceptDownloads: true });
  await context.route("**/*", async route => {
    if (new URL(route.request().url()).origin === env.E2E_BASE_URL) await route.continue();
    else await route.abort("blockedbyclient");
  });
  await context.addInitScript(() => { try { localStorage.setItem("hello_circle_cookie_consent", "rejected"); } catch { /* storage unavailable */ } });
  const credentials = opts.credentials ?? { email: env[`${role}_EMAIL`], password: env[`${role}_PASSWORD`] };
  const login = await context.request.post("/api/auth/login", { data: credentials });
  expect(login.status(), "real staff login").toBe(200);
  if (role.startsWith("QA_VENDOR")) expect((await context.request.post("/api/auth/accept-terms", { data: { termsAccepted: true } })).status()).toBe(200);
  const page: Page = await context.newPage();
  const consoleErrors: string[] = [];
  page.on("pageerror", error => consoleErrors.push(error.name));
  return { context, page, consoleErrors, close: async () => { await context.request.post("/api/auth/logout").catch(() => undefined); await context.close(); } };
}
