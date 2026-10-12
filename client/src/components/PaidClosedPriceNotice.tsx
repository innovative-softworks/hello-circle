import { PAID_CLOSED_PRICE_NOTICE, usePaidCheckoutOpen } from "../paidCheckout";
import { colors } from "../theme";

// Sitemap audit P1-08 — shown under a host/vendor price field while paid
// (card) checkout is closed, so nobody publishes a priced listing without
// knowing people can't pay for it yet. Only when a price is actually set and
// the payment method is card: free and cash-on-arrival bookings still work.
export function PaidClosedPriceNotice({ amount, paymentMethod }: { amount: number | string | null | undefined; paymentMethod?: "online" | "cash" }) {
  const paidOpen = usePaidCheckoutOpen();
  const priced = Number(amount) > 0;
  if (paidOpen !== false || !priced || paymentMethod === "cash") return null;
  return (
    <p role="status" style={{ fontSize: 12.5, lineHeight: 1.45, color: colors.orangeDark, fontWeight: 600, margin: "6px 0 0", maxWidth: 420 }}>
      {PAID_CLOSED_PRICE_NOTICE}
      {paymentMethod === "online" && " Cash on arrival still works."}
    </p>
  );
}
