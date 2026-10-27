import { describe, expect, it } from "vitest";
import { paymentResultTitle, type PaymentCaseState, type PaymentResultStatus } from "./paymentResultTitle";

describe("paymentResultTitle (PUB-04)", () => {
  it("only a paid order is called confirmed", () => {
    expect(paymentResultTitle("paid")).toBe("Booking confirmed");
    const others: PaymentResultStatus[] = ["checking", "pending", "review", "case", "failed", "notfound", "error"];
    for (const s of others) expect(paymentResultTitle(s)).not.toMatch(/confirmed/i);
  });

  it("names every payment-review case without saying confirmed", () => {
    const cases: PaymentCaseState[] = ["review", "review_urgent", "review_expired", "refund_pending", "refunded", "not_fulfilled"];
    for (const c of cases) {
      const title = paymentResultTitle("case", c);
      expect(title).toBeTruthy();
      expect(title).not.toMatch(/^Booking confirmed|^Payment confirmed/i);
    }
    expect(paymentResultTitle("case", "refund_pending")).toBe("Refund on its way");
    expect(paymentResultTitle("case", null)).toBe("Payment needs a check");
  });

  it("distinguishes failed, missing and unreachable", () => {
    expect(paymentResultTitle("failed")).toBe("Payment didn't go through");
    expect(paymentResultTitle("notfound")).toBe("Booking not found");
    expect(paymentResultTitle("error")).toBe("Couldn't check your payment");
  });
});
