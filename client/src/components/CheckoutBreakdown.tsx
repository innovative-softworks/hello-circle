import type { BookingQuote } from "../api";
import { colors } from "../theme";
import { checkoutRows, type CheckoutRowKey } from "./booking/checkoutLines";
import { formatCents } from "./booking/quoteLines";

// Stage 5f, aligned in commercial UX R3A — the customer's price for an
// experience, in the server's own calculation order (shared checkoutRows):
//   activity price − coupon − HelloCircle credit (+ VAT and fees) = card payment
// Every figure is a quote field: the coupon and credit parts come from the
// server (couponDiscountCents, creditCents) instead of being subtracted here,
// and so does the credit left afterwards (creditBalanceAfterCents).

const TEST_IDS: Partial<Record<CheckoutRowKey, string>> = { coupon: "breakdown-coupon", credit: "breakdown-credit", discount: "breakdown-coupon", total: "breakdown-card" };

export function CheckoutBreakdown({ quote, unitPriceCents }: { quote: BookingQuote; unitPriceCents: number }) {
  // Participation Phase 1 — with options, list what was chosen (server amounts), then the usual totals.
  const lines = quote.lines ?? [];
  const rows = checkoutRows(quote, lines.length ? "Your options" : `Activity price (${quote.partySize} × ${formatCents(unitPriceCents)})`);
  const credit = quote.creditCents ?? 0;
  return (
    <div style={{ marginTop: 14 }} aria-live="polite">
      {lines.length > 0 && (
        <dl style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: "2px 12px", fontSize: 13.5, margin: "0 0 6px", color: colors.muted }} data-testid="checkout-lines">
          {lines.map((l) => (
            <div key={l.optionId} style={{ display: "contents" }}>
              <dt>{l.label} × {l.quantity}</dt>
              <dd style={{ margin: 0, textAlign: "right" }}>{formatCents(l.totalMinor)}</dd>
            </div>
          ))}
        </dl>
      )}
      <dl style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: "4px 12px", fontSize: 14, margin: 0 }} data-testid="checkout-breakdown">
        {rows.map((r) => {
          const strong = r.emphasis === "total";
          const cell = { fontWeight: strong ? 800 : 400, borderTop: strong ? `1px solid ${colors.border}` : undefined, paddingTop: strong ? 6 : 0, color: r.emphasis === "muted" ? colors.muted : undefined };
          return (
            <div key={r.key} style={{ display: "contents" }} data-testid={TEST_IDS[r.key]}>
              <dt style={cell}>{r.label}</dt>
              <dd style={{ ...cell, margin: 0, textAlign: "right" }}>
                {r.negative ? "− " : ""}
                {formatCents(r.cents)}
              </dd>
            </div>
          );
        })}
      </dl>
      {quote.vatIncluded && quote.vatCents > 0 && <p style={{ fontSize: 12.5, color: colors.muted, margin: "4px 0 0" }}>Prices include VAT of {formatCents(quote.vatCents)}.</p>}
      {credit > 0 && (
        <p style={{ fontSize: 12.5, color: colors.muted, margin: "4px 0 0" }} data-testid="credit-remaining">
          {typeof quote.creditBalanceAfterCents === "number" ? `Credit left after this booking: ${formatCents(quote.creditBalanceAfterCents)}. ` : ""}
          If you cancel or get a refund, the credit part comes back as credit and the card part goes back to your card.
        </p>
      )}
    </div>
  );
}
