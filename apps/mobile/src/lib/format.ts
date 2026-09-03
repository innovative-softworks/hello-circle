// Same rounding convention as client/src/formatters.ts's formatPrice —
// whole euros, no decimals, since every price in this app is either a
// round number or intentionally rounds for display.
export function formatPriceCents(cents: number | null): string {
  if (cents === null || cents === 0) return 'Free';
  return `€${Math.round(cents / 100)}`;
}

export function formatPrice(amount: number): string {
  if (amount === 0) return 'Free';
  return `€${Math.round(amount)}`;
}
