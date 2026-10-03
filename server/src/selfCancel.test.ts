import { describe, expect, it } from "vitest";
import { experienceCancelBlock, programmeCancelBlock, refundStateOf } from "./selfCancel.js";

// Phase 11B — the single source of self-cancel eligibility and refund state.
describe("refundStateOf (Refund Policy A)", () => {
  it("free or cash bookings never report a refund", () => {
    expect(refundStateOf({ status: "cancelled", paymentStatus: "paid", totalCents: 0, paidOnline: true })).toBe("none");
    expect(refundStateOf({ status: "cancelled", paymentStatus: "paid", totalCents: 1500, paidOnline: false })).toBe("none");
  });
  it("a cancelled online payment is 'pending' until the refund is actually issued", () => {
    expect(refundStateOf({ status: "cancelled", paymentStatus: "paid", totalCents: 1500, paidOnline: 1 })).toBe("pending");
    expect(refundStateOf({ status: "confirmed", paymentStatus: "paid", totalCents: 1500, paidOnline: true })).toBe("none");
  });
  it("only a refunded payment reports 'refunded'", () => {
    expect(refundStateOf({ status: "cancelled", paymentStatus: "refunded", totalCents: 1500, paidOnline: true })).toBe("refunded");
    expect(refundStateOf({ status: "confirmed", paymentStatus: "refunded", totalCents: 1500, paidOnline: true })).toBe("refunded");
  });
});

describe("cancel eligibility", () => {
  const future = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  it("programme: paid and not cancelled → allowed; otherwise a 409 reason", () => {
    expect(programmeCancelBlock({ status: "confirmed", paymentStatus: "paid" })).toBeNull();
    expect(programmeCancelBlock({ status: "cancelled", paymentStatus: "paid" })?.status).toBe(409);
    expect(programmeCancelBlock({ status: "confirmed", paymentStatus: "refunded" })?.status).toBe(409);
    expect(programmeCancelBlock({ status: "confirmed", paymentStatus: "pending" })?.status).toBe(409);
  });
  it("experience: the organisation's cut-off applies", () => {
    expect(experienceCancelBlock({ status: "confirmed", paymentStatus: "paid", date: future, time: "10:00" }, 48)).toBeNull();
    expect(experienceCancelBlock({ status: "confirmed", paymentStatus: "paid", date: tomorrow, time: "10:00" }, 48)?.error).toMatch(/within 48 hours/);
    expect(experienceCancelBlock({ status: "cancelled", paymentStatus: "paid", date: future, time: "10:00" }, 48)?.error).toMatch(/already cancelled/);
  });
});
