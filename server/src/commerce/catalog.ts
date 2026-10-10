// Commerce Engine — the catalog of editable commercial rules (Phase 1).
//
// This is the ONLY place a commercial default appears in code, and only as
// the seed for version 1 of each rule — every runtime read goes through the
// published, versioned rows in commerce_rule_versions (rules.ts). Rule v1
// deliberately reproduces today's live behaviour (pricing.ts / bookings.ts /
// bookingIntegrity.ts / db/queries.ts) so the Phase 2 shadow comparison is
// like-for-like; the target commercial model is seeded as an unpublished
// draft (TARGET_MODEL_DRAFT) for an admin to review and publish deliberately.
//
// Field kinds keep validation declarative: every field has a type and hard
// bounds, and some bounds are technical rather than commercial (the checkout
// hold can't leave Stripe's 30-minute..24-hour Checkout session window).

import crypto from "node:crypto";

/** sha256 of the values with keys sorted — stored with every rule version and
 * snapshot so a tampered or mis-copied payload is detectable. */
export function canonicalHash(values: Record<string, unknown>): string {
  const canonical = JSON.stringify(Object.keys(values).sort().reduce<Record<string, unknown>>((o, k) => ((o[k] = values[k]), o), {}));
  return crypto.createHash("sha256").update(canonical).digest("hex");
}

export type ScopeType = "global" | "scenario" | "category" | "partner";
export const SCOPE_ORDER: ScopeType[] = ["global", "scenario", "category", "partner"]; // least → most specific

/** Commercial scenarios (master prompt §3). */
export const SCENARIOS = ["vendor_activity", "host_activity", "venue_host", "venue_booking", "free", "programme", "pass", "experience"] as const;
export type Scenario = (typeof SCENARIOS)[number];

/** Resource categories = the paid resource types (checkoutService.ts CheckoutType). */
export const CATEGORIES = ["booking", "registration", "game", "program", "pass", "experience"] as const;
export type Category = (typeof CATEGORIES)[number];

/** Plan entitlements are on/off; kept as an enum so every rule value stays a
 * string or integer (and the generic admin editor needs no new field type). */
const ENTITLEMENT_VALUES = ["included", "not_included"] as const;

export type FieldSpec =
  | { kind: "bps"; label: string; help?: string; min: number; max: number }
  | { kind: "minor"; label: string; help?: string; min: number; max: number }
  | { kind: "int"; label: string; help?: string; unit: string; min: number; max: number }
  | { kind: "enum"; label: string; help?: string; values: readonly string[] };

export interface RuleKeySpec {
  key: string;
  label: string;
  description: string;
  scopes: ScopeType[];
  fields: Record<string, FieldSpec>;
  /** Version 1 — today's live behaviour. */
  v1: Record<string, number | string>;
}

export const RULE_KEYS: Record<string, RuleKeySpec> = {
  pricing: {
    key: "pricing",
    label: "Pricing & fees",
    description: "How a customer price is built and how it is allocated between partner, HelloCircle and tax.",
    scopes: ["global", "scenario", "category", "partner"],
    fields: {
      customerFeeBps: { kind: "bps", label: "Customer platform fee", help: "Added on top of the price the customer sees. 0 = no customer fee.", min: 0, max: 3000 },
      successFeeBps: { kind: "bps", label: "Partner success fee", help: "Deducted from the partner's earning on completed paid bookings.", min: 0, max: 5000 },
      successFeeBase: { kind: "enum", label: "Success fee charged on", values: ["partner_net", "customer_goods"], help: "Partner net = the goods amount excluding VAT; customer goods = the goods amount the customer paid, VAT included." },
      vatBps: { kind: "bps", label: "VAT rate (assumption)", help: "Tax assumption — confirm the legal treatment with an accountant.", min: 0, max: 5000 },
      vatMode: { kind: "enum", label: "VAT presentation", values: ["added_on_top", "included_in_price"] },
      paymentCostBearer: { kind: "enum", label: "Payment-processing cost borne by", values: ["platform", "partner"] },
      paymentCostBps: { kind: "bps", label: "Processing cost estimate (%)", help: "Estimate used for reporting/contribution only — never charged to the customer.", min: 0, max: 1000 },
      paymentCostFixedMinor: { kind: "minor", label: "Processing cost estimate (fixed)", min: 0, max: 500 },
      venueDepositMinor: { kind: "minor", label: "Venue refundable deposit", help: "Online venue bookings only. 0 = no deposit.", min: 0, max: 100_000 },
      dayRateMinHours: { kind: "int", label: "Venue day-rate threshold", unit: "hours", min: 1, max: 24 },
      dayRateMultiplierBps: { kind: "bps", label: "Venue day rate (× hourly rate)", help: "A full-day booking costs this many times the hourly rate (e.g. 6.5).", min: 10_000, max: 240_000 },
    },
    v1: {
      customerFeeBps: 500,
      successFeeBps: 0,
      successFeeBase: "partner_net",
      vatBps: 2300,
      vatMode: "added_on_top",
      paymentCostBearer: "platform",
      paymentCostBps: 150,
      paymentCostFixedMinor: 25,
      venueDepositMinor: 10_000,
      dayRateMinHours: 8,
      dayRateMultiplierBps: 65_000,
    },
  },
  checkout: {
    key: "checkout",
    label: "Checkout holds",
    description: "How long a pending paid checkout holds capacity (and how long its Stripe Checkout session lives).",
    scopes: ["global"],
    fields: {
      pendingHoldMinutes: { kind: "int", label: "Pending capacity hold", unit: "minutes", help: "Stripe Checkout sessions must live 30 minutes to 24 hours.", min: 30, max: 1440 },
    },
    v1: { pendingHoldMinutes: 30 },
  },
  cancellation: {
    key: "cancellation",
    label: "Cancellation defaults",
    description: "Platform defaults used when an organisation hasn't set its own policy (org_policies still wins for that organisation).",
    scopes: ["global", "scenario", "category"],
    fields: {
      cancellationHours: { kind: "int", label: "Self-cancel cut-off", unit: "hours before start", min: 0, max: 720 },
      bookingWindowDays: { kind: "int", label: "Booking window", unit: "days ahead", min: 1, max: 730 },
    },
    v1: { cancellationHours: 48, bookingWindowDays: 90 },
  },

  // --- Revenue & Connect programme, Stage 2a (docs/revenue-connect/07) -------
  // Values below are SEEDS for version 1 of each rule (the brief's defaults);
  // every runtime read resolves the published version. None of them is read
  // by a live checkout until the pe-2 engine is switched on per type.
  plan_free: {
    key: "plan_free",
    label: "Free plan",
    description: "Free partner plan: no subscription, higher success fee, minimum fee per paid order.",
    scopes: ["global", "partner"],
    fields: {
      successFeeBps: { kind: "bps", label: "Success fee (excl. VAT)", help: "Charged on the fee base of each completed paid order.", min: 0, max: 5000 },
      minFeeMinor: { kind: "minor", label: "Minimum platform fee per paid order", min: 0, max: 10_000 },
      subscriptionMonthlyMinor: { kind: "minor", label: "Subscription price per month (excl. VAT)", min: 0, max: 100_000 },
      freeEventFee: { kind: "enum", label: "Fee on free events", values: ["none"], help: "Free events never carry a platform fee." },
    },
    v1: { successFeeBps: 900, minFeeMinor: 75, subscriptionMonthlyMinor: 0, freeEventFee: "none" },
  },
  plan_pro: {
    key: "plan_pro",
    label: "Pro plan",
    description: "Optional partner subscription with a lower success fee.",
    scopes: ["global", "partner"],
    fields: {
      successFeeBps: { kind: "bps", label: "Success fee (excl. VAT)", help: "Charged on the fee base of each completed paid order.", min: 0, max: 5000 },
      minFeeMinor: { kind: "minor", label: "Minimum platform fee per paid order", min: 0, max: 10_000 },
      subscriptionMonthlyMinor: { kind: "minor", label: "Subscription price per month (excl. VAT)", min: 0, max: 100_000 },
      freeEventFee: { kind: "enum", label: "Fee on free events", values: ["none"], help: "Free events never carry a platform fee." },
    },
    v1: { successFeeBps: 700, minFeeMinor: 50, subscriptionMonthlyMinor: 2_900, freeEventFee: "none" },
  },
  plan_rules: {
    key: "plan_rules",
    label: "Plan changes",
    description: "When plan changes take effect and how long a failed Pro payment keeps Pro rates.",
    scopes: ["global"],
    fields: {
      upgradeTakesEffect: { kind: "enum", label: "Upgrade takes effect", values: ["next_booking", "immediately"] },
      downgradeTakesEffect: { kind: "enum", label: "Downgrade takes effect", values: ["end_of_billing_period"] },
      graceDays: { kind: "int", label: "Grace period after a failed payment", unit: "days", min: 0, max: 30 },
    },
    v1: { upgradeTakesEffect: "next_booking", downgradeTakesEffect: "end_of_billing_period", graceDays: 7 },
  },
  entitlements_free: {
    key: "entitlements_free",
    label: "Free plan features",
    description: "Features available on the Free plan. Never switch off a feature partners use today without notice.",
    scopes: ["global"],
    fields: {
      advancedAnalytics: { kind: "enum", label: "Advanced analytics", values: ENTITLEMENT_VALUES },
      reducedSuccessFee: { kind: "enum", label: "Lower booking fee", values: ENTITLEMENT_VALUES },
      promotionalCampaigns: { kind: "enum", label: "Promotional campaigns", values: ENTITLEMENT_VALUES },
      customerCrm: { kind: "enum", label: "Customer CRM tools", values: ENTITLEMENT_VALUES },
      prioritySupport: { kind: "enum", label: "Priority support", values: ENTITLEMENT_VALUES },
      enhancedMedia: { kind: "enum", label: "Enhanced listing media", values: ENTITLEMENT_VALUES },
      recurringActivities: { kind: "enum", label: "Recurring activities", values: ENTITLEMENT_VALUES },
      waitlists: { kind: "enum", label: "Waitlists", values: ENTITLEMENT_VALUES },
      teamMembers: { kind: "enum", label: "Team members", values: ENTITLEMENT_VALUES },
      advancedReports: { kind: "enum", label: "Advanced reports", values: ENTITLEMENT_VALUES },
      priorityPlacement: { kind: "enum", label: "Priority marketplace placement (labelled)", values: ENTITLEMENT_VALUES },
    },
    v1: { advancedAnalytics: "not_included", reducedSuccessFee: "not_included", promotionalCampaigns: "not_included", customerCrm: "not_included", prioritySupport: "not_included", enhancedMedia: "not_included", recurringActivities: "included", waitlists: "included", teamMembers: "included", advancedReports: "not_included", priorityPlacement: "not_included" },
  },
  entitlements_pro: {
    key: "entitlements_pro",
    label: "Pro plan features",
    description: "Features available on the Pro plan.",
    scopes: ["global"],
    fields: {
      advancedAnalytics: { kind: "enum", label: "Advanced analytics", values: ENTITLEMENT_VALUES },
      reducedSuccessFee: { kind: "enum", label: "Lower booking fee", values: ENTITLEMENT_VALUES },
      promotionalCampaigns: { kind: "enum", label: "Promotional campaigns", values: ENTITLEMENT_VALUES },
      customerCrm: { kind: "enum", label: "Customer CRM tools", values: ENTITLEMENT_VALUES },
      prioritySupport: { kind: "enum", label: "Priority support", values: ENTITLEMENT_VALUES },
      enhancedMedia: { kind: "enum", label: "Enhanced listing media", values: ENTITLEMENT_VALUES },
      recurringActivities: { kind: "enum", label: "Recurring activities", values: ENTITLEMENT_VALUES },
      waitlists: { kind: "enum", label: "Waitlists", values: ENTITLEMENT_VALUES },
      teamMembers: { kind: "enum", label: "Team members", values: ENTITLEMENT_VALUES },
      advancedReports: { kind: "enum", label: "Advanced reports", values: ENTITLEMENT_VALUES },
      priorityPlacement: { kind: "enum", label: "Priority marketplace placement (labelled)", values: ENTITLEMENT_VALUES },
    },
    v1: { advancedAnalytics: "included", reducedSuccessFee: "included", promotionalCampaigns: "included", customerCrm: "included", prioritySupport: "included", enhancedMedia: "included", recurringActivities: "included", waitlists: "included", teamMembers: "included", advancedReports: "included", priorityPlacement: "included" },
  },
  tax_vat: {
    key: "tax_vat",
    label: "VAT on HelloCircle fees",
    description: "VAT on HelloCircle's own platform fee and subscription. The activity's own VAT is the partner's and is kept separate. Confirm with an Irish accountant before relying on it.",
    scopes: ["global", "partner"],
    fields: {
      vatBps: { kind: "bps", label: "VAT rate", min: 0, max: 5000 },
      vatMode: { kind: "enum", label: "VAT treatment", values: ["standard", "exempt", "reverse_charge"], help: "Reverse charge or exempt sets the fee VAT to zero for that partner." },
      feeDisplay: { kind: "enum", label: "Fees shown to partners", values: ["exclusive_of_vat", "inclusive_of_vat"] },
    },
    v1: { vatBps: 2_300, vatMode: "standard", feeDisplay: "exclusive_of_vat" },
  },
  payment_costs: {
    key: "payment_costs",
    label: "Payment cost estimates",
    description: "HelloCircle's own estimates of Stripe costs, used for contribution and margin warnings. Actual Stripe fees replace them through reconciliation.",
    scopes: ["global"],
    fields: {
      cardBps: { kind: "bps", label: "Card processing (%)", min: 0, max: 1000 },
      cardFixedMinor: { kind: "minor", label: "Card processing (fixed)", min: 0, max: 500 },
      payoutBps: { kind: "bps", label: "Connect payout (%)", min: 0, max: 500 },
      payoutFixedMinor: { kind: "minor", label: "Connect payout (fixed)", min: 0, max: 500 },
      activeAccountMonthlyMinor: { kind: "minor", label: "Connect active account (per month)", min: 0, max: 2_000 },
      instantPayoutBps: { kind: "bps", label: "Instant payout price to partners (%)", min: 0, max: 1000 },
      instantPayoutMinMinor: { kind: "minor", label: "Instant payout minimum", min: 0, max: 1_000 },
      fxCost: { kind: "enum", label: "Currency conversion cost", values: ["pass_through"] },
      crossBorderCost: { kind: "enum", label: "Cross-border payout cost", values: ["pass_through"] },
    },
    v1: { cardBps: 150, cardFixedMinor: 25, payoutBps: 25, payoutFixedMinor: 10, activeAccountMonthlyMinor: 200, instantPayoutBps: 125, instantPayoutMinMinor: 75, fxCost: "pass_through", crossBorderCost: "pass_through" },
  },
  settlement: {
    key: "settlement",
    label: "Settlement and payouts",
    description: "Transfer eligibility begins after the activity is completed and the review period has passed.",
    scopes: ["global", "partner"],
    fields: {
      reviewHours: { kind: "int", label: "Review period after completion", unit: "hours", min: 0, max: 720 },
      payoutSchedule: { kind: "enum", label: "Standard payout schedule", values: ["weekly"] },
      payoutWeekday: { kind: "enum", label: "Weekly payout day", values: ["monday", "tuesday", "wednesday", "thursday", "friday"] },
      minPayoutMinor: { kind: "minor", label: "Minimum payout", help: "Smaller balances carry forward.", min: 0, max: 100_000 },
      refundReserveBps: { kind: "bps", label: "Refund reserve", min: 0, max: 5000 },
      disputeReserveBps: { kind: "bps", label: "Dispute reserve", min: 0, max: 5000 },
      marginWarningMinor: { kind: "minor", label: "Warn when contribution per order is below", min: 0, max: 10_000 },
    },
    v1: { reviewHours: 48, payoutSchedule: "weekly", payoutWeekday: "monday", minPayoutMinor: 2_500, refundReserveBps: 0, disputeReserveBps: 0, marginWarningMinor: 0 },
  },
  venue_split: {
    key: "venue_split",
    label: "Venue / host split",
    description: "How the partner share of a host's paid game at a partner venue is divided. The agreed split is frozen into each booking at payment; changing this rule only affects later payments.",
    scopes: ["global"],
    fields: {
      roundingOwner: { kind: "enum", label: "Rounding remainder goes to", values: ["venue", "host", "platform"], help: "A percentage split can leave one cent that can't be divided exactly; it is given to this party and recorded on the booking's allocation." },
      maxVenueBps: { kind: "bps", label: "Largest venue share allowed", help: "Upper limit on the venue's percentage in a proposed split.", min: 0, max: 10_000 },
    },
    v1: { roundingOwner: "venue", maxVenueBps: 9_000 },
  },
  split_rewards: {
    key: "split_rewards",
    label: "Reward points on venue/host split bookings",
    description: "Both partners earn points, each only on their own settled eligible allocation, after settlement. The rate is the reward points rule's points per €1.",
    scopes: ["global"],
    fields: {
      basis: { kind: "enum", label: "Points are earned on", values: ["eligible_allocation"], help: "The partner's own allocation, excluding VAT, HelloCircle fees, Stripe fees, HelloCircle-funded coupons, customer credits, refunded amounts and disputed amounts." },
      rounding: { kind: "enum", label: "Rounding", values: ["floor_total_largest_remainder"], help: "Points for the booking = ⌊total eligible × rate⌋, divided between the partners by largest remainder, so the partners together never earn more than the booking would." },
      timing: { kind: "enum", label: "When points are issued", values: ["after_settlement"] },
    },
    v1: { basis: "eligible_allocation", rounding: "floor_total_largest_remainder", timing: "after_settlement" },
  },
  vat_treatment: {
    key: "vat_treatment",
    label: "VAT treatment of bookings (record only)",
    description: "Who owns the VAT liability on a customer booking, as recorded on its allocation snapshot. Recording only — no VAT amounts are calculated from this. Provisional until confirmed by Irish tax advice.",
    scopes: ["global"],
    fields: {
      liabilityOwner: { kind: "enum", label: "VAT liability owner", values: ["helloCircle", "partner"], help: "HelloCircle is the merchant of record for online bookings (separate charges and transfers)." },
      status: { kind: "enum", label: "Status", values: ["provisional_pending_irish_tax_review", "confirmed_by_tax_adviser"] },
    },
    v1: { liabilityOwner: "helloCircle", status: "provisional_pending_irish_tax_review" },
  },
  rewards: {
    key: "rewards",
    label: "Partner reward points",
    description: "Points earned on settled GMV, redeemable for a free Pro month. Points are not cash and not transferable.",
    scopes: ["global"],
    fields: {
      pointsPerEuro: { kind: "int", label: "Points per €1 of settled GMV", unit: "points", min: 0, max: 100 },
      redemptionPoints: { kind: "int", label: "Points for one free Pro month", unit: "points", min: 1, max: 1_000_000 },
      expiryMonths: { kind: "int", label: "Points expire after", unit: "months", min: 1, max: 60 },
      maxFreeMonthsPerRedemption: { kind: "int", label: "Free months per redemption", unit: "months", min: 1, max: 1 },
    },
    v1: { pointsPerEuro: 1, redemptionPoints: 10_000, expiryMonths: 18, maxFreeMonthsPerRedemption: 1 },
  },
  credits: {
    key: "credits",
    label: "Customer credits",
    description: "Credits are liabilities with a named funding owner. Not convertible to cash.",
    scopes: ["global"],
    fields: {
      defaultExpiryMonths: { kind: "int", label: "Default credit expiry", unit: "months", min: 1, max: 60 },
      refundCreditExpiryMonths: { kind: "int", label: "Refund credit expiry", unit: "months", min: 1, max: 60 },
      cashOut: { kind: "enum", label: "Cash value", values: ["not_supported"] },
    },
    v1: { defaultExpiryMonths: 12, refundCreditExpiryMonths: 24, cashOut: "not_supported" },
  },
  availability: {
    key: "availability",
    label: "Countries and currencies",
    description: "Where partners can be paid. MVP: Ireland and EUR only.",
    scopes: ["global"],
    fields: {
      partnerCountry: { kind: "enum", label: "Partner country", values: ["IE"] },
      currency: { kind: "enum", label: "Currency", values: ["EUR"] },
    },
    v1: { partnerCountry: "IE", currency: "EUR" },
  },
};

/** The earlier Commerce Engine brief's target model. No longer seeded —
 * superseded by the Free/Pro plan rules (decision B11, docs/revenue-connect/07);
 * kept only as a fixed reference payload for tests of the generic engine. */
export const TARGET_MODEL_DRAFT: { key: string; payload: Record<string, number | string>; reason: string } = {
  key: "pricing",
  payload: { ...RULE_KEYS.pricing.v1, customerFeeBps: 0, successFeeBps: 700, vatMode: "included_in_price" },
  reason: "Target commercial model from the Commerce Engine brief: €0 customer fee, one VAT-inclusive price, 7% partner success fee. Draft only — awaiting decisions D1/D2.",
};

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

/** Validates a payload for `key`. Global rows must be complete; narrower
 * scopes may override any subset of fields. Unknown fields are rejected so a
 * typo can never silently do nothing. */
export function validatePayload(key: string, scopeType: ScopeType, payload: unknown): ValidationResult {
  const spec = RULE_KEYS[key];
  if (!spec) return { ok: false, errors: [`Unknown rule "${key}"`] };
  if (!spec.scopes.includes(scopeType)) return { ok: false, errors: [`"${spec.label}" can't be overridden at ${scopeType} level`] };
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return { ok: false, errors: ["Values must be an object"] };
  const errors: string[] = [];
  const values = payload as Record<string, unknown>;
  for (const name of Object.keys(values)) {
    if (!spec.fields[name]) errors.push(`Unknown field "${name}"`);
  }
  for (const [name, field] of Object.entries(spec.fields)) {
    const value = values[name];
    if (value === undefined) {
      if (scopeType === "global") errors.push(`${field.label} is required`);
      continue;
    }
    if (field.kind === "enum") {
      if (typeof value !== "string" || !field.values.includes(value)) errors.push(`${field.label} must be one of ${field.values.join(", ")}`);
    } else if (typeof value !== "number" || !Number.isInteger(value) || value < field.min || value > field.max) {
      errors.push(`${field.label} must be a whole number from ${field.min} to ${field.max}`);
    }
  }
  if (scopeType !== "global" && Object.keys(values).length === 0) errors.push("An override must set at least one value");
  return { ok: errors.length === 0, errors };
}

/** Validates a scope id for its scope type (partner existence is checked in rules.ts). */
export function scopeIdError(scopeType: ScopeType, scopeId: string): string | null {
  if (scopeType === "global") return scopeId === "" ? null : "A global rule has no scope id";
  if (scopeType === "scenario") return (SCENARIOS as readonly string[]).includes(scopeId) ? null : `Scenario must be one of ${SCENARIOS.join(", ")}`;
  if (scopeType === "category") return (CATEGORIES as readonly string[]).includes(scopeId) ? null : `Category must be one of ${CATEGORIES.join(", ")}`;
  return /^(org|host):[\w-]{1,180}$/.test(scopeId) ? null : 'Partner scope must be "org:<organisation id>" or "host:<resident id>"';
}

/** Global on/off switches for the commerce rollout (master prompt §18), kept
 * in app_settings (admin-toggled, audited, no redeploy). Rollout flags stay
 * off — and inert — until the phase that reads them ships; with every flag
 * off the live checkout paths are exactly the pre-Commerce-Engine code. */
export interface CommerceSwitch {
  key: string;
  label: string;
  description: string;
  defaultValue: boolean;
  /** Phase whose code first reads this switch; null = read today. */
  activeFromPhase: number | null;
}

export const COMMERCE_SWITCHES: CommerceSwitch[] = [
  { key: "commerce.require_second_approver", label: "Two-person approval for rule changes", description: "A different admin must approve a rule version before it can be published.", defaultValue: false, activeFromPhase: null },
  { key: "commerce.paid_games_require_verified_host", label: "Paid activities need a verified host", description: "Only residents with host status 'verified' can put a price on an activity.", defaultValue: true, activeFromPhase: null },
  { key: "commerce.shadow_pricing", label: "Shadow pricing (PRICING_RULES_V2)", description: "Price every checkout with the rules engine too and log differences, without changing what the customer is charged.", defaultValue: false, activeFromPhase: null },
  { key: "commerce.engine_v2", label: "Commerce engine (COMMERCE_ENGINE_V2)", description: "Master switch: quotes, orders and pricing snapshots from the commerce engine for the resource types switched on below.", defaultValue: false, activeFromPhase: null },
  { key: "commerce.engine_v2_experience", label: "Commerce engine — Experiences", description: "Experience bookings are priced by the published rules and recorded as commerce orders (needs the master switch too).", defaultValue: false, activeFromPhase: null },
  { key: "commerce.coupons_v2", label: "Coupons v2 (COUPONS_V2)", description: "Record every coupon use in the redemption ledger (reserved → confirmed → released/reversed) and enforce per-customer limits. Funding, minimum spend, maximum discount and start dates apply whenever a coupon sets them.", defaultValue: false, activeFromPhase: null },
  { key: "commerce.settlement_ledger", label: "Financial ledger (SETTLEMENT_LEDGER)", description: "Post confirmed payments, refunds and disputes to the append-only double-entry ledger. Payment, refund and dispute records are kept either way.", defaultValue: false, activeFromPhase: null },
  { key: "commerce.connect_v1", label: "Stripe Connect payouts (CONNECT_V1)", description: "Partners connect a Stripe Express account; settled amounts are transferred to it (separate charges and transfers). Transfers only run when a finance admin runs them. Test mode only until go-live is approved.", defaultValue: false, activeFromPhase: null },
  { key: "commerce.circle_credits", label: "Partner reward points (CIRCLE_CREDITS)", description: "Partners earn points on settled sales (awarded when a settlement is created) and can redeem them for a free month of Pro.", defaultValue: false, activeFromPhase: null },
  { key: "commerce.pro_subscriptions", label: "HelloCircle Pro (PRO_SUBSCRIPTIONS)", description: "Partners can subscribe to Pro through Stripe Billing (monthly, VAT added). 7-day grace after a failed payment; cancelling ends Pro at the end of the paid month.", defaultValue: false, activeFromPhase: null },
  { key: "commerce.customer_credits", label: "Customer credits (CUSTOMER_CREDITS)", description: "Finance can grant HelloCircle-funded credits to residents, who can apply them at checkout (engine-priced bookings). No cash value.", defaultValue: false, activeFromPhase: null },
  { key: "commerce.boost_vouchers", label: "Boost vouchers (BOOST_VOUCHERS)", description: "Promotional visibility credits.", defaultValue: false, activeFromPhase: 7 },
  { key: "commerce.venue_host_split_payout", label: "Venue + Host split payout (VENUE_HOST_SPLIT_PAYOUT)", description: "One platform fee, payout split between venue and host.", defaultValue: false, activeFromPhase: 8 },
];
