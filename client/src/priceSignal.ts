// Commercial UX R1 (C1) — the one commercial signal a listing card may carry:
// "Free" or "Free trial", read straight from the server's listing fields. No
// discount percentages and no promotions: coupons are code-only and there is
// no server-verified public offer to show (plan decision U1).

export type PriceSignal = "free" | "free_trial";

export const PRICE_SIGNAL_LABELS: Record<PriceSignal, string> = {
  free: "Free",
  free_trial: "Free trial",
};

/** Clubs: a €0 price is free outright; otherwise a club that offers a trial (`clubs.trial`) shows "Free trial". */
export function clubPriceSignal(club: { price: number; trial: boolean }): PriceSignal | null {
  if (club.price === 0) return "free";
  return club.trial ? "free_trial" : null;
}

/** Cent-priced listings (experiences, activities): no price or 0 means free — the same rule `formatPrice()` already uses. */
export function centsPriceSignal(priceCents: number | null | undefined): PriceSignal | null {
  return priceCents ? null : "free";
}
