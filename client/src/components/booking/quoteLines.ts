// Booking kit — the rows a price summary shows, in a fixed order, straight
// from a server quote. Display only: every amount here is a field the server
// computed (bookings/registrations/programmes/games quotes, plus the commerce
// engine's experience quote without credit). Nothing is added up, rated or
// rounded on the client — the UX plan's rule that the client never prices.

/** The common shape of the server's quote responses (PriceQuote and friends). */
export interface KitQuote {
  subtotalCents: number;
  discountCents: number;
  vatCents: number;
  platformFeeCents: number;
  depositCents?: number;
  totalCents: number;
  couponCode: string | null;
  /** Engine-priced quotes can include VAT in the price instead of adding it. */
  vatIncluded?: boolean;
  /** Cash listing: nothing is charged online. */
  payAtVenue?: boolean;
}

export interface QuoteRow {
  key: "subtotal" | "discount" | "vat" | "fee" | "deposit" | "total";
  label: string;
  cents: number;
  /** Shown with a leading minus (a reduction). */
  negative?: boolean;
  emphasis?: "muted" | "total";
}

export function formatCents(cents: number): string {
  return `€${(cents / 100).toFixed(2)}`;
}

export function quoteRows(quote: KitQuote, subtotalLabel: string): QuoteRow[] {
  const rows: QuoteRow[] = [{ key: "subtotal", label: subtotalLabel, cents: quote.subtotalCents }];
  if (quote.discountCents > 0) {
    rows.push({ key: "discount", label: quote.couponCode ? `Code ${quote.couponCode}` : "Discount", cents: quote.discountCents, negative: true });
  }
  if (!quote.vatIncluded && quote.vatCents > 0) rows.push({ key: "vat", label: "VAT (23%)", cents: quote.vatCents, emphasis: "muted" });
  if (quote.platformFeeCents > 0) rows.push({ key: "fee", label: "Platform fee", cents: quote.platformFeeCents, emphasis: "muted" });
  if (quote.depositCents && quote.depositCents > 0) rows.push({ key: "deposit", label: "Refundable deposit", cents: quote.depositCents, emphasis: "muted" });
  rows.push({ key: "total", label: totalLabel(quote), cents: quote.totalCents, emphasis: "total" });
  return rows;
}

export function totalLabel(quote: Pick<KitQuote, "totalCents" | "payAtVenue">): string {
  if (quote.totalCents === 0) return "Total · nothing to pay";
  return quote.payAtVenue ? "Pay at the venue" : "Total today";
}

/** The primary button's wording for a quote. */
export function payLabel(quote: Pick<KitQuote, "totalCents" | "payAtVenue">, confirmLabel = "Confirm booking"): string {
  if (quote.totalCents === 0 || quote.payAtVenue) return confirmLabel;
  return `Pay ${formatCents(quote.totalCents)}`;
}
