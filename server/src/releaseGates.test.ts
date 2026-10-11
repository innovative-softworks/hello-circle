import { afterEach, describe, expect, it } from "vitest";
import { createCheckoutSession } from "./checkoutService.js";
import { PAID_CHECKOUT_CLOSED_ERROR, paidCheckoutOpen } from "./releaseGates.js";

// Paid-checkout exposure check (2026-10-11) — the server refuses paid checkout
// unless explicitly opened, and fails closed in production.

const saved = process.env.PAID_CHECKOUT;
afterEach(() => {
  if (saved === undefined) delete process.env.PAID_CHECKOUT;
  else process.env.PAID_CHECKOUT = saved;
});

describe("paid checkout gate", () => {
  it("fails closed in production and opens only on the exact word", () => {
    expect(paidCheckoutOpen({ NODE_ENV: "production" })).toBe(false);
    expect(paidCheckoutOpen({ NODE_ENV: "production", PAID_CHECKOUT: "open" })).toBe(true);
    expect(paidCheckoutOpen({ NODE_ENV: "production", PAID_CHECKOUT: " OPEN " })).toBe(true);
    expect(paidCheckoutOpen({ NODE_ENV: "production", PAID_CHECKOUT: "yes" })).toBe(false);
    expect(paidCheckoutOpen({ NODE_ENV: "development", PAID_CHECKOUT: "closed" })).toBe(false);
    expect(paidCheckoutOpen({ NODE_ENV: "test" })).toBe(true);
  });

  it("the checkout service refuses before any provider or stub call", async () => {
    process.env.PAID_CHECKOUT = "closed";
    const r = await createCheckoutSession({ ref: "GATE-TEST", type: "pass", customerEmail: "x@example.test", lineItems: [{ name: "x", unitAmountCents: 100 }] });
    expect(r).toEqual({ ok: false, status: 503, error: PAID_CHECKOUT_CLOSED_ERROR });
  });
});
