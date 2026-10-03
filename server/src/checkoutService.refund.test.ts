import { describe, it, expect, vi, beforeEach } from "vitest";

// HC-QA-091 — issueStripeRefund() decides from the PROVIDER state, never from
// a guess: fully refunded at Stripe → reconcile without a second refund;
// partially refunded → unsupported (refused); otherwise one idempotent refund.
// The Stripe client is a network-free fake.

const fake = {
  checkout: { sessions: { retrieve: vi.fn() } },
  paymentIntents: { retrieve: vi.fn() },
  refunds: { create: vi.fn() },
};
vi.mock("./stripe.js", () => ({ stripe: fake, CLIENT_URL: "http://127.0.0.1", STRIPE_WEBHOOK_SECRET: undefined }));

const { issueStripeRefund } = await import("./checkoutService.js");

const charge = (amount: number, refunded: number) => ({ amount: amount, latest_charge: { amount, amount_refunded: refunded } });

beforeEach(() => {
  vi.clearAllMocks();
  fake.checkout.sessions.retrieve.mockResolvedValue({ payment_intent: "pi_qa", amount_total: 2000 });
});

describe("issueStripeRefund — provider-state reconciliation (HC-QA-091)", () => {
  it("refunds once, idempotently, when nothing has been refunded yet", async () => {
    fake.paymentIntents.retrieve.mockResolvedValue(charge(2000, 0));
    fake.refunds.create.mockResolvedValue({ amount: 2000 });
    expect(await issueStripeRefund("cs_qa_1")).toEqual({ ok: true, amountCents: 2000, reconciled: false });
    expect(fake.refunds.create).toHaveBeenCalledTimes(1);
    expect(fake.refunds.create.mock.calls[0][1]).toEqual({ idempotencyKey: "hc-refund-cs_qa_1" });
  });

  it("reconciles a charge already fully refunded at Stripe without requesting another refund", async () => {
    fake.paymentIntents.retrieve.mockResolvedValue(charge(2000, 2000));
    expect(await issueStripeRefund("cs_qa_2")).toEqual({ ok: true, amountCents: 2000, reconciled: true });
    expect(fake.refunds.create).not.toHaveBeenCalled();
  });

  it("reconciles the race where Stripe refunds between the state check and the refund request", async () => {
    fake.paymentIntents.retrieve.mockResolvedValueOnce(charge(2000, 0)).mockResolvedValueOnce(charge(2000, 2000));
    fake.refunds.create.mockRejectedValue(Object.assign(new Error("Charge has already been refunded."), { code: "charge_already_refunded" }));
    expect(await issueStripeRefund("cs_qa_3")).toEqual({ ok: true, amountCents: 2000, reconciled: true });
  });

  it("refuses (does not guess) when the charge was only partly refunded outside HelloCircle", async () => {
    fake.paymentIntents.retrieve.mockResolvedValue(charge(2000, 500));
    const result = await issueStripeRefund("cs_qa_4");
    expect(result).toMatchObject({ ok: false, kind: "unsupported" });
    expect(fake.refunds.create).not.toHaveBeenCalled();
  });

  it("keeps an unrelated provider failure as a retryable provider error", async () => {
    fake.paymentIntents.retrieve.mockResolvedValue(charge(2000, 0));
    fake.refunds.create.mockRejectedValue(Object.assign(new Error("network"), { code: "api_connection_error" }));
    expect(await issueStripeRefund("cs_qa_5")).toMatchObject({ ok: false, kind: "provider" });
  });
});
