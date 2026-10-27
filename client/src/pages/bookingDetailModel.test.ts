import { describe, expect, it } from "vitest";
import { bookingState, isBookingKind } from "./bookingDetailModel";

describe("bookingState (Batch 2 booking details)", () => {
  it("never calls an unpaid booking booked", () => {
    expect(bookingState({ status: "confirmed", paymentStatus: "pending", isPast: false }).key).toBe("pending");
    expect(bookingState({ status: "confirmed", paymentStatus: "failed", isPast: false }).key).toBe("failed");
    for (const s of [bookingState({ status: "confirmed", paymentStatus: "pending", isPast: false }), bookingState({ status: "confirmed", paymentStatus: "failed", isPast: false })]) {
      expect(s.title).not.toMatch(/booked|confirmed/i);
      expect(s.variant).not.toBe("success");
    }
  });

  it("maps cancellations and refunds", () => {
    expect(bookingState({ status: "cancelled", refundState: "pending", isPast: false }).key).toBe("refund_pending");
    expect(bookingState({ status: "cancelled", refundState: "refunded", isPast: false }).key).toBe("refunded");
    expect(bookingState({ status: "cancelled", isPast: true }).key).toBe("cancelled");
    expect(bookingState({ status: "left", isPast: false }).variant).toBe("cancelled");
    expect(bookingState({ status: "confirmed", paymentStatus: "refunded", isPast: false }).key).toBe("refunded");
  });

  it("confirmed vs completed by date; cash/free bookings count as confirmed", () => {
    expect(bookingState({ status: "confirmed", paymentStatus: "paid", isPast: false }).key).toBe("confirmed");
    expect(bookingState({ status: "confirmed", paymentStatus: "paid", isPast: true }).key).toBe("completed");
    expect(bookingState({ status: "confirmed", paymentStatus: "cash", isPast: false }).key).toBe("confirmed");
    expect(bookingState({ status: "open", paymentStatus: null, isPast: false }).key).toBe("confirmed");
  });

  it("accepts only the known kinds", () => {
    for (const k of ["booking", "registration", "program", "experience", "game", "pass"]) expect(isBookingKind(k)).toBe(true);
    expect(isBookingKind("admin")).toBe(false);
    expect(isBookingKind(undefined)).toBe(false);
  });
});
