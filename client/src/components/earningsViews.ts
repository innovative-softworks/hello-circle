// Commercial UX plan R1 (§3.3) — which Earnings sections a partner sees and
// which one opens first. Pure so it's unit-tested; the availability inputs
// come from the server (payout account `enabled`, plan `state`), never from a
// client copy of the commerce switches.

export type EarningsView = "balance" | "payouts" | "plan";

export const EARNINGS_VIEW_LABELS: Record<EarningsView, string> = {
  balance: "Balance",
  payouts: "Payouts",
  plan: "Plan & billing",
};

export interface EarningsAvailability {
  /** GET /{scope}/payout-account → `enabled` (commerce.connect_v1). False on 403 or error. */
  payouts: boolean;
  /** GET /{scope}/plan → state !== "unavailable" (Pro and/or rewards on). False on 403 (other staff) or error. */
  plan: boolean;
}

export function availableViews(a: EarningsAvailability): EarningsView[] {
  const views: EarningsView[] = ["balance"];
  if (a.payouts) views.push("payouts");
  if (a.plan) views.push("plan");
  return views;
}

/**
 * The view to open. An explicit `?view=` wins; otherwise a Stripe return
 * (`?pro=` from Pro checkout, `?payouts=` from Connect onboarding — both land
 * on `?tab=earnings` per the server's return paths) opens the section that
 * handles it. Anything unavailable falls back to Balance.
 */
export function initialView(params: URLSearchParams, views: EarningsView[]): EarningsView {
  const asked = params.get("view");
  const wanted: EarningsView | null =
    asked === "balance" || asked === "payouts" || asked === "plan" ? asked : params.has("pro") ? "plan" : params.has("payouts") ? "payouts" : null;
  return wanted && views.includes(wanted) ? wanted : "balance";
}

/** Deep link to a section, e.g. the compact plan panel's "Full details" link. */
export function earningsHref(scope: "vendor" | "host", view?: EarningsView): string {
  const base = scope === "vendor" ? "/vendor?tab=earnings" : "/manage?tab=earnings";
  return view && view !== "balance" ? `${base}&view=${view}` : base;
}
