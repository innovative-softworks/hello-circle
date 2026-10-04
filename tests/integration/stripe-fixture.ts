import { randomUUID } from "node:crypto";
import Stripe from "stripe";
import type { APIRequestContext, APIResponse, Browser, BrowserContext, Page } from "@playwright/test";
import { evidence } from "./authorization-fixture";
import { expect, env, personas } from "./fixtures";
import { isStripeBrowserHost, QA_WEBHOOK_SECRET_PATTERN } from "../support/integration-safety";

// Phase 9 — Stripe TEST-mode helpers. Present only under `qa:stripe`, whose
// runner validated a test-mode key and minted a per-run local webhook secret.
// Never prints, records or asserts on credential values.

export const stripeProfile = process.env.QA_STRIPE_TEST_PROFILE === "1";
const key = process.env.STRIPE_SECRET_KEY ?? "";
if (stripeProfile && (!/^(sk|rk)_test_/.test(key) || !QA_WEBHOOK_SECRET_PATTERN.test(process.env.STRIPE_WEBHOOK_SECRET ?? ""))) throw new Error("QA SAFETY ABORT: Stripe test profile misconfigured.");
export const stripe = stripeProfile ? new Stripe(key) : (null as unknown as Stripe);

export type SignatureMode = "valid" | "missing" | "invalid" | "tampered";

/** A Stripe-shaped event wrapping a REAL test-mode object (retrieved from the
 * provider), delivered to the real webhook route with a real HMAC signature
 * from the per-run secret. `tampered` signs one body and sends another. */
export async function deliver(actor: APIRequestContext, type: string, object: unknown, mode: SignatureMode = "valid", eventId = `evt_qa_${randomUUID().replace(/-/g, "")}`) {
  const payload = JSON.stringify({ id: eventId, object: "event", api_version: null, created: Math.floor(Date.now() / 1000), livemode: false, type, data: { object } });
  const header = stripe.webhooks.generateTestHeaderString({ payload, secret: mode === "invalid" ? `whsec_qa_${"0".repeat(64)}` : process.env.STRIPE_WEBHOOK_SECRET! });
  const body = mode === "tampered" ? payload.replace(/"livemode":false/, '"livemode":false ') : payload;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (mode !== "missing") headers["Stripe-Signature"] = header;
  const response = await actor.post("/api/stripe/webhook", { headers, data: Buffer.from(body) });
  return { status: response.status(), eventId, payload };
}

/** The Checkout Session behind a pending local row (provider truth). */
export async function sessionFor(id: string) {
  const session = await stripe.checkout.sessions.retrieve(id, { expand: ["line_items"] });
  expect(session.livemode, "test-mode object").toBe(false);
  return session;
}

/** Browser actor that may reach the local app AND Stripe-hosted Checkout only. */
export async function stripeUiActor(browser: Browser, role: string | null, viewport: "desktop" | "mobile", opts: { consent?: boolean } = {}) {
  const mobile = viewport === "mobile";
  const context: BrowserContext = await browser.newContext({ baseURL: env.E2E_BASE_URL, viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 }, isMobile: mobile, hasTouch: mobile, serviceWorkers: "block" });
  const blocked: string[] = [];
  await context.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (url.origin === env.E2E_BASE_URL || (url.protocol === "https:" && isStripeBrowserHost(url.hostname))) await route.continue();
    else { blocked.push(url.hostname); await route.abort("blockedbyclient"); }
  });
  if (opts.consent !== false) await context.addInitScript(() => { try { localStorage.setItem("hello_circle_cookie_consent", "rejected"); } catch { /* unavailable */ } });
  if (role) {
    const login = await context.request.post("/api/guest/login", { data: { email: env[`${role}_EMAIL`], password: env[`${role}_PASSWORD`] } });
    expect(login.status(), "real persona login").toBe(200);
    expect((await (await context.request.get("/api/residents/me")).json()).resident.id).toBe(personas[role].id);
  }
  const page: Page = await context.newPage();
  return { context, page, blocked, close: async () => { if (role) await context.request.post("/api/guest/logout"); await context.close(); } };
}

/** Pay an open hosted Checkout page with a Stripe TEST card number. */
export async function payOnHostedCheckout(page: Page, card = "4242424242424242") {
  await page.waitForURL(/checkout\.stripe\.com/, { timeout: 30_000 });
  const email = page.locator("#email");
  if (await email.isVisible().catch(() => false) && !(await email.inputValue())) await email.fill(`qa_${randomUUID().slice(0, 8)}@example.test`);
  await page.locator("#cardNumber").fill(card);
  await page.locator("#cardExpiry").fill("12 / 34");
  await page.locator("#cardCvc").fill("123");
  await page.locator("#billingName").fill("QA Tester");
  const country = page.locator("#billingCountry");
  if (await country.isVisible().catch(() => false)) await country.selectOption("IE");
  const postal = page.locator("#billingPostalCode");
  if (await postal.isVisible().catch(() => false)) await postal.fill("D01 F5P2");
  await page.locator('[data-testid="hosted-payment-submit-button"]').click();
}

/** HC-QA-095 — asserts a Stripe Checkout was created (201). On failure it
 * records the server's CLASSIFIED provider failure (category / Stripe error
 * type and code / provider HTTP status / request id — never messages, keys or
 * payment details), so an intermittent failure says why instead of "400". */
export async function expectCheckoutCreated(res: APIResponse, label: string) {
  if (res.status() === 201) return;
  type Failure = { operation: string; category: string; type: string | null; code: string | null; statusCode: number | null; requestId: string | null };
  const failures: Failure[] = await fetch(`${new URL(env.E2E_API_URL).origin}/api/__qa/stripe-failures`).then((r) => r.json()).catch(() => []);
  const last = failures.at(-1);
  await evidence(`hc-qa-095-${label.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`, {
    status: res.status(), operation: last?.operation ?? "none-recorded", category: last?.category ?? "none-recorded",
    type: last?.type ?? "-", code: last?.code ?? "-", providerStatus: last?.statusCode ?? 0, requestId: last?.requestId ?? "-",
  });
  expect(res.status(), `${label}: provider failure category=${last?.category ?? "none recorded"} code=${last?.code ?? "-"} request_id=${last?.requestId ?? "-"}`).toBe(201);
}
