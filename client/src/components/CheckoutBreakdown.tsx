import type { BookingQuote } from "../api";
import { colors } from "../theme";

// Stage 5f — the customer's price, always in this order:
//   activity price + taxes and fees − coupon − HelloCircle credit = card payment due
// Every figure comes from the server quote (never computed here).

const euro = (m: number) => `€${(m / 100).toFixed(2)}`;

export function CheckoutBreakdown({ quote, unitPriceCents, creditAvailableMinor }: { quote: BookingQuote; unitPriceCents: number; creditAvailableMinor: number }) {
  const credit = quote.creditCents ?? 0;
  const coupon = Math.max(0, quote.discountCents - credit);
  const rows: { label: string; amount: string; strong?: boolean; testId?: string }[] = [
    { label: `Activity price (${quote.partySize} × ${euro(unitPriceCents)})`, amount: euro(quote.subtotalCents) },
  ];
  if (!quote.vatIncluded && quote.vatCents > 0) rows.push({ label: "VAT", amount: `+ ${euro(quote.vatCents)}` });
  if (quote.platformFeeCents > 0) rows.push({ label: "Booking fee", amount: `+ ${euro(quote.platformFeeCents)}` });
  if (coupon > 0) rows.push({ label: `Coupon ${quote.couponCode ?? ""}`.trim(), amount: `− ${euro(coupon)}`, testId: "breakdown-coupon" });
  if (credit > 0) rows.push({ label: "HelloCircle credit", amount: `− ${euro(credit)}`, testId: "breakdown-credit" });
  rows.push({ label: quote.totalCents === 0 ? "Card payment due — none needed" : "Card payment due", amount: euro(quote.totalCents), strong: true, testId: "breakdown-card" });
  return (
    <div style={{ marginTop: 14 }} aria-live="polite">
      <dl style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: "4px 12px", fontSize: 14, margin: 0 }} data-testid="checkout-breakdown">
        {rows.map((r) => (
          <div key={r.label} style={{ display: "contents" }} data-testid={r.testId}>
            <dt style={{ fontWeight: r.strong ? 800 : 400, borderTop: r.strong ? `1px solid ${colors.border}` : undefined, paddingTop: r.strong ? 6 : 0 }}>{r.label}</dt>
            <dd style={{ margin: 0, textAlign: "right", fontWeight: r.strong ? 800 : 400, borderTop: r.strong ? `1px solid ${colors.border}` : undefined, paddingTop: r.strong ? 6 : 0 }}>{r.amount}</dd>
          </div>
        ))}
      </dl>
      {quote.vatIncluded && quote.vatCents > 0 && <p style={{ fontSize: 12.5, color: colors.muted, margin: "4px 0 0" }}>Prices include VAT of {euro(quote.vatCents)}.</p>}
      {credit > 0 && (
        <p style={{ fontSize: 12.5, color: colors.muted, margin: "4px 0 0" }} data-testid="credit-remaining">
          Credit left after this booking: {euro(Math.max(0, creditAvailableMinor - credit))}. If you cancel or get a refund, the credit part comes back as credit and the card part goes back to your card.
        </p>
      )}
    </div>
  );
}
