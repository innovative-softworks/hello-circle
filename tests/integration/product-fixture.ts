import { deflateSync } from "node:zlib";
import type { APIRequestContext, Browser, BrowserContext, Page } from "@playwright/test";
import { expect, env, personas } from "./fixtures";
import { connectedPreflight } from "./runtime";
import { VIEWPORTS } from "./lifecycle-ui-fixture";

// Phase 10A product-quality helpers (HC-QA-052..069). Same isolation rules as
// every other real-environment batch: real React/Vite, real Express/MySQL,
// external origins aborted, exact-ID cleanup only.

/** Press Tab (or Shift+Tab) until `match` holds for the focused element. */
export async function tabTo(page: Page, match: (info: FocusInfo) => boolean, opts: { max?: number; back?: boolean } = {}): Promise<FocusInfo | null> {
  // The target may already hold focus (e.g. an autofocused first field);
  // engines differ on whether Tab wraps back from the end of the page.
  const current = await focused(page);
  if (match(current)) return current;
  // Safari/WebKit on macOS: plain Tab only moves between text fields by
  // default; keyboard users reach buttons and links with Option+Tab.
  const webkit = page.context().browser()?.browserType().name() === "webkit";
  const key = `${opts.back ? "Shift+" : ""}${webkit ? "Alt+" : ""}Tab`;
  for (let i = 0; i < (opts.max ?? 60); i++) {
    await page.keyboard.press(key);
    const info = await focused(page);
    if (match(info)) return info;
  }
  return null;
}

export interface FocusInfo { tag: string; type: string; role: string; name: string; id: string; inDialog: boolean; focusVisible: boolean }

export function focused(page: Page): Promise<FocusInfo> {
  return page.evaluate(() => {
    const e = document.activeElement as HTMLElement | null;
    if (!e || e === document.body) return { tag: "BODY", type: "", role: "", name: "", id: "", inDialog: false, focusVisible: false };
    const input = e as HTMLInputElement;
    const labelled = e.getAttribute("aria-labelledby");
    const name = (e.getAttribute("aria-label")
      || (labelled ? labelled.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? "").join(" ") : "")
      || (input.labels && input.labels.length ? Array.from(input.labels).map((l) => l.textContent ?? "").join(" ") : "")
      || e.textContent || "").replace(/\s+/g, " ").trim();
    const style = getComputedStyle(e);
    const wrapper = e.closest("label");
    const wrapperStyle = wrapper ? getComputedStyle(wrapper) : null;
    const visible = (s: CSSStyleDeclaration | null) => !!s && ((s.outlineStyle !== "none" && parseFloat(s.outlineWidth) > 0) || s.boxShadow !== "none");
    return { tag: e.tagName, type: input.type ?? "", role: e.getAttribute("role") ?? "", name, id: e.id, inDialog: !!e.closest("[role=dialog],[role=alertdialog]"), focusVisible: visible(style) || visible(wrapperStyle) };
  });
}

/** A real browser session logged in as a vendor/admin (req.user) persona. */
export async function businessUiActor(browser: Browser, role: string, viewport: keyof typeof VIEWPORTS) {
  const mobile = viewport === "mobile";
  const context: BrowserContext = await browser.newContext({ baseURL: env.E2E_BASE_URL, viewport: VIEWPORTS[viewport], isMobile: mobile && browser.browserType().name() !== "firefox", hasTouch: mobile, serviceWorkers: "block" });
  await context.route("**/*", async (route) => {
    if (new URL(route.request().url()).origin === env.E2E_BASE_URL) await route.continue();
    else await route.abort("blockedbyclient");
  });
  await context.addInitScript(() => { try { localStorage.setItem("hello_circle_cookie_consent", "rejected"); } catch { /* storage unavailable */ } });
  const login = await context.request.post("/api/auth/login", { data: { email: env[`${role}_EMAIL`], password: env[`${role}_PASSWORD`] } });
  expect(login.status(), "real business persona login").toBe(200);
  expect((await (await context.request.get("/api/auth/me")).json()).user.id).toBe(personas[role].id);
  // A vendor persona seeded before the current Terms version sees the
  // blocking "Please confirm our Terms" modal (real product behaviour).
  // Accept it through the real endpoint for this session, then restore the
  // persona's original terms fields by exact id on close.
  let restoreTerms: (() => Promise<void>) | null = null;
  if (personas[role].role === "vendor") {
    const safe = await connectedPreflight();
    try {
      const [[before]] = await safe.connection.query<any[]>("SELECT terms_accepted_at, terms_version FROM users WHERE id = ?", [personas[role].id]);
      if (!before.terms_accepted_at) {
        expect((await context.request.post("/api/auth/accept-terms", { data: { termsAccepted: true } })).status()).toBe(200);
        restoreTerms = async () => {
          const c = await connectedPreflight();
          try { await c.connection.execute("UPDATE users SET terms_accepted_at = ?, terms_version = ? WHERE id = ?", [before.terms_accepted_at, before.terms_version, personas[role].id]); }
          finally { await c.connection.end(); }
        };
      }
    } finally { await safe.connection.end(); }
  }
  const page: Page = await context.newPage();
  return { context, page, close: async () => { await context.request.post("/api/auth/logout"); await context.close(); if (restoreTerms) await restoreTerms(); } };
}

/** Attempted-email facts recorded by the QA backend wrapper (no bodies, no tokens). */
export async function mailTo(request: APIRequestContext, to: string): Promise<{ subject: string; linkOrigins: string[]; tokenLink: boolean }[]> {
  const response = await request.get(`/api/__qa/mail?to=${encodeURIComponent(to)}`);
  expect(response.status()).toBe(200);
  return response.json();
}

/** Exact-scope cleanup of a vendor account created through the real signup UI. */
export async function cleanupVendorSignup(email: string) {
  const safe = await connectedPreflight();
  try {
    const [users] = await safe.connection.query<any[]>("SELECT id, org_id FROM users WHERE email = ?", [email]);
    for (const user of users) {
      const [centres] = await safe.connection.query<any[]>("SELECT id FROM centres WHERE vendor_id = ?", [user.id]);
      for (const centre of centres) {
        await safe.connection.execute("DELETE FROM rooms WHERE centre_id = ?", [centre.id]);
        await safe.connection.execute("DELETE FROM listing_attributes WHERE listing_id = ?", [centre.id]).catch(() => {});
        await safe.connection.execute("DELETE FROM centres WHERE id = ?", [centre.id]);
      }
      await safe.connection.execute("DELETE FROM clubs WHERE vendor_id = ?", [user.id]);
      await safe.connection.execute("DELETE FROM sessions WHERE user_id = ?", [user.id]);
      await safe.connection.execute("DELETE FROM audit_log WHERE object_id = ?", [user.id]);
      await safe.connection.execute("DELETE FROM analytics_events WHERE JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.vendorId')) = ? OR JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.userId')) = ?", [user.id, user.id]);
      await safe.connection.execute("DELETE FROM users WHERE id = ?", [user.id]);
      if (user.org_id) await safe.connection.execute("DELETE FROM organisations WHERE id = ?", [user.org_id]);
    }
  } finally { await safe.connection.end(); }
}

/** A real, decodable 8x8 RGB PNG (magic bytes + IHDR/IDAT/IEND). */
export function tinyPng(): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(8, 0); ihdr.writeUInt32BE(8, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.concat(Array.from({ length: 8 }, () => Buffer.concat([Buffer.from([0]), Buffer.alloc(24, 0x7f)])));
  return Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
function crc32(buf: Buffer) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) { c = (crc ^ buf[n]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; }
  return crc ^ 0xffffffff;
}

/** Visible form controls inside `scope` with no programmatic accessible name
 * (label[for]/wrapping label with text, aria-label, aria-labelledby). */
export function unlabeledControls(page: Page, scope = "main") {
  return page.evaluate((sel) => {
    const root = document.querySelector(sel) ?? document.body;
    const named = (e: HTMLInputElement) => {
      if (e.getAttribute("aria-label")?.trim()) return true;
      const by = e.getAttribute("aria-labelledby");
      if (by && by.split(/\s+/).some((id) => document.getElementById(id)?.textContent?.trim())) return true;
      return !!e.labels && Array.from(e.labels).some((l) => l.textContent?.trim());
    };
    return Array.from(root.querySelectorAll<HTMLInputElement>("input, select, textarea"))
      .filter((e) => !["hidden", "submit", "button", "file"].includes(e.type) && e.offsetParent !== null && !e.hidden)
      .filter((e) => !named(e))
      .map((e) => `${e.tagName.toLowerCase()}[${e.type}]${e.placeholder ? ` placeholder="${e.placeholder}"` : ""}${e.id ? `#${e.id}` : ""}`);
  }, scope);
}
