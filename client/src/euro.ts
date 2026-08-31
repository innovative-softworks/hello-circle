export function euro(n: number): string {
  // Whole-euro rounding here previously discarded cents entirely (e.g.
  // €18.40 displayed as "€18") — every call site passes a real cents/100
  // amount, so a non-whole-euro total (near-guaranteed once VAT/platform
  // fee are applied) rendered as a figure that didn't match what Stripe
  // actually charged. Show cents only when non-zero, so whole-euro amounts
  // (most listing prices) still display cleanly as "€50" rather than "€50.00".
  return Number.isInteger(n) ? `€${n}` : `€${n.toFixed(2)}`;
}

export function dateLabel(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(`${iso}T00:00:00`);
  const dow = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getDay()];
  const mon = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getMonth()];
  return `${dow} ${d.getDate()} ${mon}`;
}
