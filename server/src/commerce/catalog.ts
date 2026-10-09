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
};

/** The master prompt's target model (§3), seeded as a DRAFT only — publishing
 * it changes every customer price, so it waits for decisions D1/D2. */
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
  { key: "commerce.coupons_v2", label: "Coupons v2 (COUPONS_V2)", description: "Funding-aware coupon reservation and reversal.", defaultValue: false, activeFromPhase: 3 },
  { key: "commerce.settlement_ledger", label: "Settlement ledger (SETTLEMENT_LEDGER)", description: "Append-only ledger postings and payout allocations.", defaultValue: false, activeFromPhase: 4 },
  { key: "commerce.circle_credits", label: "Circle Credits (CIRCLE_CREDITS)", description: "Partner reward points on settled GMV.", defaultValue: false, activeFromPhase: 5 },
  { key: "commerce.pro_subscriptions", label: "HelloCircle Pro (PRO_SUBSCRIPTIONS)", description: "Optional partner subscription.", defaultValue: false, activeFromPhase: 6 },
  { key: "commerce.boost_vouchers", label: "Boost vouchers (BOOST_VOUCHERS)", description: "Promotional visibility credits.", defaultValue: false, activeFromPhase: 7 },
  { key: "commerce.venue_host_split_payout", label: "Venue + Host split payout (VENUE_HOST_SPLIT_PAYOUT)", description: "One platform fee, payout split between venue and host.", defaultValue: false, activeFromPhase: 8 },
];
