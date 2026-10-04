import http, { type Server } from "node:http";
import express from "express";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// Phase 12 (Part 14) — unsigned Stripe webhooks are refused unless explicitly
// opted in for local development; never in production or staging.

vi.mock("./stripe.js", () => ({ stripe: { webhooks: { constructEvent: vi.fn() } }, STRIPE_WEBHOOK_SECRET: undefined, CLIENT_URL: "http://127.0.0.1" }));

const { unsignedStripeWebhooksAllowed, stripeWebhookModeNotice } = await import("./stripeWebhookPolicy.js");
const { stripeWebhookHandler } = await import("./routes/stripeWebhook.js");

describe("unsignedStripeWebhooksAllowed", () => {
  it("is off by default (no opt-in)", () => {
    expect(unsignedStripeWebhooksAllowed({ NODE_ENV: "development" })).toBe(false);
    expect(unsignedStripeWebhooksAllowed({ NODE_ENV: "test" })).toBe(false);
  });
  it("allows only an explicit local opt-in", () => {
    expect(unsignedStripeWebhooksAllowed({ NODE_ENV: "development", ALLOW_UNSIGNED_STRIPE_WEBHOOKS: "true" })).toBe(true);
    expect(unsignedStripeWebhooksAllowed({ NODE_ENV: "development", ALLOW_UNSIGNED_STRIPE_WEBHOOKS: "1" })).toBe(false);
  });
  it("never in production or staging, even with the flag", () => {
    expect(unsignedStripeWebhooksAllowed({ NODE_ENV: "production", ALLOW_UNSIGNED_STRIPE_WEBHOOKS: "true" })).toBe(false);
    expect(unsignedStripeWebhooksAllowed({ NODE_ENV: "development", APP_ENV: "staging", ALLOW_UNSIGNED_STRIPE_WEBHOOKS: "true" })).toBe(false);
    expect(unsignedStripeWebhooksAllowed({ NODE_ENV: "development", APP_ENV: "production", ALLOW_UNSIGNED_STRIPE_WEBHOOKS: "true" })).toBe(false);
  });
  it("startup notice warns loudly about unsafe mode and never includes a secret", () => {
    expect(stripeWebhookModeNotice({ ALLOW_UNSIGNED_STRIPE_WEBHOOKS: "true", NODE_ENV: "development" })).toMatch(/WARNING: .*UNSIGNED/);
    expect(stripeWebhookModeNotice({ STRIPE_WEBHOOK_SECRET: "whsec_x" })).toBeNull();
    expect(stripeWebhookModeNotice({ NODE_ENV: "development" })).toMatch(/will be refused/);
  });
});

describe("webhook handler without a signing secret", () => {
  let server: Server;
  let url: string;
  beforeAll(async () => {
    const app = express();
    app.post("/hook", express.raw({ type: "*/*" }), stripeWebhookHandler);
    server = http.createServer(app);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    url = `http://127.0.0.1:${(server.address() as { port: number }).port}/hook`;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));
  afterEach(() => { delete process.env.ALLOW_UNSIGNED_STRIPE_WEBHOOKS; });
  const forged = JSON.stringify({ id: "evt_forged", type: "qa.unhandled", data: { object: {} } });

  it("refuses an unsigned (forged) event by default", async () => {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: forged });
    expect(res.status).toBe(503);
  });
  it("accepts it only with the explicit local opt-in", async () => {
    process.env.ALLOW_UNSIGNED_STRIPE_WEBHOOKS = "true";
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: forged });
    expect(res.status).toBe(200);
  });
});
