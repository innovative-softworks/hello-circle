// Booking details (Batch 2, /bookings/:kind/:ref) — the pure part: which
// state a booking is in and what the page calls it. Uses only the statuses
// the "my …" endpoints already return; no new lifecycle. Never says a booking
// is confirmed while its payment is pending or failed (same rule as the
// payment result page, PUB-04).

import type { ConfirmationVariant } from "../components/booking";

/** The same literals as the checkout metadata `type`, plus `game` for joined activities. */
export const BOOKING_KINDS = ["booking", "registration", "program", "experience", "game", "pass"] as const;
export type BookingKind = (typeof BOOKING_KINDS)[number];

export function isBookingKind(v: string | undefined): v is BookingKind {
  return !!v && (BOOKING_KINDS as readonly string[]).includes(v);
}

export interface BookingStateInput {
  status: string | null | undefined;
  paymentStatus?: string | null;
  refundState?: "none" | "pending" | "refunded" | null;
  /** True once the (last) date is before today in Ireland. */
  isPast: boolean;
}

export interface BookingState {
  key: "confirmed" | "pending" | "failed" | "cancelled" | "refund_pending" | "refunded" | "completed";
  variant: ConfirmationVariant;
  title: string;
  lead: string;
}

export function bookingState(i: BookingStateInput): BookingState {
  const status = (i.status ?? "").toLowerCase();
  const pay = (i.paymentStatus ?? "").toLowerCase();
  if (status === "cancelled" || status === "left" || pay === "refunded") {
    if (i.refundState === "refunded" || pay === "refunded") return { key: "refunded", variant: "cancelled", title: "Cancelled and refunded", lead: "This booking was cancelled and your payment was refunded." };
    if (i.refundState === "pending") return { key: "refund_pending", variant: "cancelled", title: "Cancelled — refund on its way", lead: "Your refund is being processed. It can take a few business days to reach your account." };
    return { key: "cancelled", variant: "cancelled", title: "Cancelled", lead: "This booking was cancelled." };
  }
  if (pay === "failed") return { key: "failed", variant: "failed", title: "Payment didn't go through", lead: "No charge was made and this booking isn't confirmed." };
  if (pay === "pending") return { key: "pending", variant: "pending", title: "Confirming your payment", lead: "This isn't confirmed yet. It usually takes a few seconds — please don't pay again." };
  if (i.isPast) return { key: "completed", variant: "success", title: "Completed", lead: "This has already happened. We hope it went well." };
  return { key: "confirmed", variant: "success", title: "You're booked", lead: "Everything's confirmed. The details are below." };
}
