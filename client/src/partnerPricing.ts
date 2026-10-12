// R3B finding F1 (docs/r3b-paid-launch-readiness-2026-10-11.md): the plan
// rules (Free 9% / Pro 7% partner success fee + VAT, no customer fee) drive
// only the estimator (pe-2, commerce/calc.ts). Checkout and settlement price
// with the `pricing` rule instead (customer fee + VAT on top, no partner
// success fee). Until the commercial model is decided (R3B D1) and one
// formula drives both, no user-facing page may present the plan model as the
// fees in force.
//
// Flip to true only when checkout, settlement, /pricing and the simulator all
// use the same, approved model. It changes what is shown, never what is charged.
export const PARTNER_FEE_MODEL_CONFIRMED = false;

export const PARTNER_PRICING_PENDING = {
  headline: "Paid-booking pricing for partners is being finalised",
  body: "Listing on HelloCircle is free, and free events stay free. We're finalising the fees for paid bookings and will confirm them with you before you take any.",
  plans: "What each plan means for fees on paid bookings is being finalised and isn't in force yet.",
} as const;

/** Help entries whose text promises the unconfirmed fee model (Pro's lower success / minimum fee). */
export const FEE_MODEL_HELP_KEYS: readonly string[] = ["pro_benefit_1", "pro_benefit_2", "platform_fee", "pro_break_even"];

/** Hides fee-model help entries while the model isn't confirmed. */
export function visibleBenefitKeys(keys: readonly string[]): string[] {
  return PARTNER_FEE_MODEL_CONFIRMED ? [...keys] : keys.filter((k) => !FEE_MODEL_HELP_KEYS.includes(k));
}

/** Admin-only label for anything computed with the plan (pe-2) estimator. */
export const HYPOTHETICAL_PLAN_MODEL_NOTE =
  "Hypothetical. This uses the proposed plan model (partner success fee from the Free/Pro plan rules, formula pe-2). Checkout and settlement don't charge this today: they use the Pricing rule (customer platform fee + VAT on top, no partner success fee). Nothing here is a live rate — see R3B finding F1.";
