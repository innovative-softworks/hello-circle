// PUB-04 — the payment result page's document title follows the state the page
// is actually showing. Only a server-confirmed paid order may say "confirmed";
// every other state (still checking, under review, refund pending, failed, not
// found, couldn't check) says what it is. The route-level title for
// /payment/success is the neutral "Payment status" (pageTitle.ts).

export type PaymentResultStatus = "checking" | "paid" | "pending" | "review" | "case" | "failed" | "notfound" | "error";

export type PaymentCaseState = "review" | "review_urgent" | "review_expired" | "refund_pending" | "refunded" | "not_fulfilled";

const CASE_TITLES: Record<PaymentCaseState, string> = {
  review: "Payment needs a check",
  review_urgent: "Payment not confirmed",
  review_expired: "Booking not confirmed",
  refund_pending: "Refund on its way",
  refunded: "Payment refunded",
  not_fulfilled: "Booking not confirmed",
};

export function paymentResultTitle(status: PaymentResultStatus, caseState?: PaymentCaseState | null): string {
  switch (status) {
    case "paid":
      return "Booking confirmed";
    case "checking":
      return "Checking your payment";
    case "pending":
      return "Payment still confirming";
    case "review":
      return "Payment needs a check";
    case "case":
      return (caseState && CASE_TITLES[caseState]) || "Payment needs a check";
    case "failed":
      return "Payment didn't go through";
    case "notfound":
      return "Booking not found";
    case "error":
    default:
      return "Couldn't check your payment";
  }
}
