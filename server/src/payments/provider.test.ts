import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { issueStripeRefund } from "../checkoutService.js";
import { stripeKeyRefusal } from "../stripeWebhookPolicy.js";
import { paymentProvider, stubProvider } from "./provider.js";

// Revenue & Connect Stage 2b — the provider abstraction: deterministic stub,
// provider-side idempotency, partial refunds through the real refund path,
// and the live-key refusal rule. No network, no Stripe.

function enableStub() {
  process.env.QA_E2E_ENABLED = "true";
  process.env.QA_PAYMENT_PROVIDER_STUB = "1";
}
function disableStub() {
  delete process.env.QA_E2E_ENABLED;
  delete process.env.QA_PAYMENT_PROVIDER_STUB;
}

describe("provider selection", () => {
  afterEach(disableStub);
  it("uses the stub only with the explicit test-profile opt-in", () => {
    expect(paymentProvider()).toBeNull(); // test profile: no Stripe key
    enableStub();
    expect(paymentProvider()?.name).toBe("stub");
  });
});

describe("stub provider", () => {
  beforeEach(() => stubProvider.reset());

  it("refunds are idempotent by key and can't exceed the charge", async () => {
    stubProvider.markPaid("cs_a", 2_000);
    const first = await stubProvider.createRefund({ paymentIntentId: "pi_stub_cs_a", amountMinor: 500, idempotencyKey: "k1", metadata: {} });
    const again = await stubProvider.createRefund({ paymentIntentId: "pi_stub_cs_a", amountMinor: 500, idempotencyKey: "k1", metadata: {} });
    expect(again).toEqual(first);
    expect((await stubProvider.chargeState("pi_stub_cs_a")).refundedMinor).toBe(500);
    await expect(stubProvider.createRefund({ paymentIntentId: "pi_stub_cs_a", amountMinor: 1_600, idempotencyKey: "k2", metadata: {} })).rejects.toMatchObject({ code: "amount_too_large" });
  });

  it("transfers are idempotent by key; reversals need a real transfer", async () => {
    const t1 = await stubProvider.createTransfer({ amountMinor: 8_893, currency: "EUR", destinationAccountId: "acct_x", transferGroup: "order_1", idempotencyKey: "tr-1", metadata: {} });
    const t2 = await stubProvider.createTransfer({ amountMinor: 8_893, currency: "EUR", destinationAccountId: "acct_x", transferGroup: "order_1", idempotencyKey: "tr-1", metadata: {} });
    expect(t2.id).toBe(t1.id);
    expect((await stubProvider.reverseTransfer({ transferId: t1.id, amountMinor: 1_000, idempotencyKey: "rv-1", metadata: {} })).amountMinor).toBe(1_000);
    await expect(stubProvider.reverseTransfer({ transferId: "tr_missing", idempotencyKey: "rv-2", metadata: {} })).rejects.toMatchObject({ code: "resource_missing" });
  });

  it("records every call so tests can assert what would reach the provider", async () => {
    await stubProvider.createCustomer("x@example.test");
    expect(stubProvider.calls.map((c) => c.method)).toEqual(["createCustomer"]);
  });
});

describe("issueStripeRefund through the provider", () => {
  beforeEach(() => {
    stubProvider.reset();
    enableStub();
  });
  afterEach(disableStub);

  it("full refund once; a second request reconciles instead of refunding again", async () => {
    stubProvider.markPaid("cs_full", 3_000);
    expect(await issueStripeRefund("cs_full")).toEqual({ ok: true, amountCents: 3_000, reconciled: false, refundId: "re_stub_1" });
    expect(await issueStripeRefund("cs_full")).toEqual({ ok: true, amountCents: 3_000, reconciled: true });
    expect(stubProvider.calls.filter((c) => c.method === "createRefund")).toHaveLength(1);
  });

  it("partial refunds use their own idempotency key and the exact amount", async () => {
    stubProvider.markPaid("cs_part", 12_800);
    const r = await issueStripeRefund("cs_part", { amountMinor: 10_000, idempotencyKey: "hc-refund-cs_part-deposit" });
    expect(r).toEqual({ ok: true, amountCents: 10_000, reconciled: false, refundId: "re_stub_1" });
    expect((await stubProvider.chargeState("pi_stub_cs_part")).refundedMinor).toBe(10_000);
  });

  it("an unknown payment is a provider error, never a fabricated refund", async () => {
    expect(await issueStripeRefund("cs_missing")).toMatchObject({ ok: false, kind: "provider" });
  });
});

describe("live Stripe keys are refused outside production (brief rule 10)", () => {
  const live = "sk_live_" + "x".repeat(24);
  const test = "sk_test_" + "x".repeat(24);
  it("allows test keys everywhere", () => {
    for (const env of [{ NODE_ENV: "development" }, { NODE_ENV: "test" }, { NODE_ENV: "production", APP_ENV: "staging" }]) expect(stripeKeyRefusal(test, env)).toBeNull();
  });
  it("refuses live (and restricted live) keys in development, test and staging", () => {
    for (const env of [{ NODE_ENV: "development" }, { NODE_ENV: "test" }, { NODE_ENV: "production", APP_ENV: "staging" }, { NODE_ENV: "production", APP_ENV: "development" }]) {
      expect(stripeKeyRefusal(live, env)).toMatch(/REFUSED/);
      expect(stripeKeyRefusal("rk_live_" + "y".repeat(24), env)).toMatch(/REFUSED/);
    }
  });
  it("accepts a live key only on a production deployment", () => {
    expect(stripeKeyRefusal(live, { NODE_ENV: "production" })).toBeNull();
    expect(stripeKeyRefusal(live, { NODE_ENV: "production", APP_ENV: "production" })).toBeNull();
  });
});
