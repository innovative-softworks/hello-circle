// Commerce Engine — quotes, orders, snapshots and shadow pricing (Phase 2).
//
// The engine WRAPS the existing participation rows; it never replaces them.
// A commerce_orders row is keyed by (source_type, source_ref) — the legacy
// table + ref — and its status columns are mirrored from that row by
// syncOrderFromSource() after every transition the legacy code already makes
// (webhook confirm/expiry, cancel, refund). The pricing snapshot written with
// the order is never updated afterwards: changing a rule tomorrow can't alter
// what an existing order was priced at.
//
// Shadow mode (switch commerce.shadow_pricing) prices every legacy checkout a
// second time with the published rules and records any difference; it never
// changes what the customer sees or pays, and never throws into checkout.

import crypto from "node:crypto";
import type { CheckoutLineItem, CheckoutType } from "../checkoutService.js";
import { db } from "../db/index.js";
import { BPS, divRoundHalfUp, priceBreakdown, type PriceBreakdown, type PricingValues } from "./money.js";
import { resolveRule, type ResolvedRule } from "./rules.js";
import { commerceSwitch } from "./switches.js";
import type { Category, Scenario } from "./catalog.js";

type Tx = Pick<typeof db, "prepare">;

/** A quote is a price promise, not a capacity hold — short-lived on purpose.
 * Technical constant (not commercial): it only bounds how stale a displayed
 * total may be before checkout re-prices it. */
export const QUOTE_TTL_MINUTES = 15;

const CURRENCY = "EUR";

/** checkoutService type → the legacy table its ref lives in. */
export const SOURCE_TABLES: Record<CheckoutType, string> = {
  booking: "bookings",
  registration: "registrations",
  game: "game_participants",
  program: "program_enrollments",
  pass: "passes",
  experience: "experience_bookings",
};

export const SCENARIO_OF: Record<CheckoutType, Scenario> = {
  booking: "venue_booking",
  registration: "vendor_activity",
  game: "host_activity",
  program: "programme",
  pass: "pass",
  experience: "experience",
};

export const CATEGORY_OF: Record<CheckoutType, Category> = {
  booking: "booking",
  registration: "registration",
  game: "game",
  program: "program",
  pass: "pass",
  experience: "experience",
};

/** Is the live engine switched on for this resource type? Both the master
 * switch and the per-type switch must be on. Only experiences are wired in
 * Phase 2; every other type returns false until its own phase. */
export async function engineEnabledFor(type: CheckoutType): Promise<boolean> {
  if (type !== "experience") return false;
  return (await commerceSwitch("commerce.engine_v2")) && (await commerceSwitch("commerce.engine_v2_experience"));
}

export interface PartnerRef {
  kind: "org" | "vendor" | "host";
  id: string;
  vendorUserId: string | null;
  hostResidentId: string | null;
  orgId: string | null;
}

/** The commercial partner behind a vendor-owned listing: the vendor's
 * organisation when it has one (partner overrides are per organisation). */
export async function vendorPartner(vendorUserId: string | null, tx: Tx = db): Promise<PartnerRef | null> {
  if (!vendorUserId) return null;
  const row = (await tx.prepare(`SELECT org_id as orgId FROM users WHERE id = ?`).get(vendorUserId)) as { orgId: string | null } | undefined;
  const orgId = row?.orgId ?? null;
  return { kind: orgId ? "org" : "vendor", id: orgId ?? vendorUserId, vendorUserId, hostResidentId: null, orgId };
}

export function hostPartner(hostResidentId: string): PartnerRef {
  return { kind: "host", id: hostResidentId, vendorUserId: null, hostResidentId, orgId: null };
}

export interface EnginePrice {
  resolved: ResolvedRule;
  values: PricingValues;
  breakdown: PriceBreakdown;
}

/** Prices goods with the rules in force now for this type + partner. */
export async function priceWithRules(
  type: CheckoutType,
  partner: PartnerRef | null,
  input: { listMinor: number; discountMinor: number; depositMinor: number },
  at: Date = new Date()
): Promise<EnginePrice> {
  const resolved = await resolveRule("pricing", { scenario: SCENARIO_OF[type], category: CATEGORY_OF[type], orgId: partner?.orgId ?? null, hostResidentId: partner?.hostResidentId ?? null }, at);
  const values = resolved.values as unknown as PricingValues;
  return { resolved, values, breakdown: priceBreakdown(input, values) };
}

/** Venue hire list price under the rule's day-rate terms. Mirrors legacy
 * bookings.ts hireCost(): the day rate is rounded to whole euros because
 * rooms.rate is stored in whole euros (risk register R11). */
export function venueHireListMinor(rateEuro: number, hours: number, values: { dayRateMinHours: number; dayRateMultiplierBps: number }): number {
  if (hours >= values.dayRateMinHours) return divRoundHalfUp(rateEuro * values.dayRateMultiplierBps, BPS) * 100;
  return rateEuro * 100 * hours;
}

/** Stripe line items whose sum is exactly breakdown.customerPaidMinor. With
 * VAT added on top the customer sees goods + VAT + fee (today's layout);
 * with VAT included they see one all-in goods line. Zero lines are omitted. */
export function engineLineItems(b: PriceBreakdown, v: PricingValues, goods: { name: string; description?: string }): CheckoutLineItem[] {
  const pct = (bps: number) => `${Number((bps / 100).toFixed(2))}%`;
  const items: CheckoutLineItem[] = [];
  if (v.vatMode === "added_on_top") {
    items.push({ name: goods.name, description: goods.description, unitAmountCents: b.discountedMinor });
    if (b.vatMinor > 0) items.push({ name: `VAT (${pct(v.vatBps)})`, unitAmountCents: b.vatMinor });
  } else {
    items.push({ name: goods.name, description: [goods.description, b.vatMinor > 0 ? `incl. VAT ${pct(v.vatBps)}` : null].filter(Boolean).join(" · ") || undefined, unitAmountCents: b.goodsGrossMinor });
  }
  if (b.customerFeeMinor > 0) items.push({ name: "Platform fee", unitAmountCents: b.customerFeeMinor });
  if (b.depositMinor > 0) items.push({ name: "Refundable deposit", unitAmountCents: b.depositMinor });
  const sum = items.reduce((a, li) => a + li.unitAmountCents, 0);
  if (sum !== b.customerPaidMinor) throw new Error(`Line items (${sum}) don't add up to the customer total (${b.customerPaidMinor})`);
  return items.filter((li, i) => li.unitAmountCents > 0 || i === 0);
}

/** The legacy columns every participation table stores, derived from an
 * engine breakdown (subtotal_cents keeps its legacy meaning: post-discount). */
export function legacyColumns(b: PriceBreakdown) {
  return {
    subtotalCents: b.discountedMinor,
    discountCents: b.discountMinor,
    vatCents: b.vatMinor,
    platformFeeCents: b.customerFeeMinor,
    totalCents: b.customerPaidMinor,
  };
}

// --- quotes -----------------------------------------------------------------

export interface QuoteInput {
  sourceType: CheckoutType;
  resourceId: string;
  sessionId: string | null;
  quantity: number;
  couponCode: string | null;
  clientId: string | null;
  residentId: string | null;
}

export async function createQuote(input: QuoteInput, price: EnginePrice): Promise<{ id: string; expiresAt: string }> {
  const id = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + QUOTE_TTL_MINUTES * 60_000);
  await db
    .prepare(
      `INSERT INTO commerce_quotes (id, source_type, resource_id, session_id, quantity, coupon_code, client_id, resident_id, currency, customer_paid_minor, rule_hash, breakdown, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      input.sourceType,
      input.resourceId,
      input.sessionId,
      input.quantity,
      input.couponCode,
      input.clientId,
      input.residentId,
      CURRENCY,
      price.breakdown.customerPaidMinor,
      price.resolved.hash,
      JSON.stringify(price.breakdown),
      expiresAt.toISOString().slice(0, 19).replace("T", " ")
    );
  return { id, expiresAt: expiresAt.toISOString() };
}

export class QuoteError extends Error {
  constructor(message: string, readonly code: "quote_not_found" | "quote_mismatch" | "quote_expired" | "quote_used" | "price_changed") {
    super(message);
  }
}

/** Checks a quote still describes this exact checkout and price, then marks
 * it used inside the caller's transaction (single use — a duplicate click or
 * replay can't create a second order from the same quote). */
export async function consumeQuote(tx: Tx, quoteId: string, input: QuoteInput, current: EnginePrice): Promise<void> {
  const q = (await tx.prepare(`SELECT * FROM commerce_quotes WHERE id = ? FOR UPDATE`).get(quoteId)) as Record<string, any> | undefined;
  if (!q) throw new QuoteError("That price quote wasn't found — please review the total again", "quote_not_found");
  const sameIdentity = (q.client_id ?? null) === input.clientId || (q.resident_id && q.resident_id === input.residentId);
  if (
    q.source_type !== input.sourceType ||
    q.resource_id !== input.resourceId ||
    (q.session_id ?? null) !== input.sessionId ||
    Number(q.quantity) !== input.quantity ||
    (q.coupon_code ?? null) !== input.couponCode ||
    !sameIdentity
  ) {
    throw new QuoteError("This checkout doesn't match the price you were shown — please review the total again", "quote_mismatch");
  }
  if (q.used_at) throw new QuoteError("This price quote has already been used", "quote_used");
  if (new Date(q.expires_at) < new Date()) throw new QuoteError("The price you were shown has expired — please review the total again", "quote_expired");
  if (q.rule_hash !== current.resolved.hash || Number(q.customer_paid_minor) !== current.breakdown.customerPaidMinor) {
    throw new QuoteError("The price has changed since you were shown it — please review the new total", "price_changed");
  }
  await tx.prepare(`UPDATE commerce_quotes SET used_at = NOW() WHERE id = ? AND used_at IS NULL`).run(quoteId);
}

/** Lets a quote be used again when checkout failed before a payment page was
 * ever created (e.g. Stripe unavailable) — nothing was charged. */
export async function releaseQuote(quoteId: string) {
  await db.prepare(`UPDATE commerce_quotes SET used_at = NULL, order_id = NULL WHERE id = ?`).run(quoteId);
}

// --- orders -------------------------------------------------------------------

export interface OrderInput {
  sourceType: CheckoutType;
  sourceRef: string;
  partner: PartnerRef;
  customerClientId: string | null;
  customerResidentId: string | null;
  quoteId: string | null;
  couponCode: string | null;
  paymentStatus: "pending" | "paid";
  line: { itemType: string; itemId: string; quantity: number; unitMinor: number };
  price: EnginePrice;
}

/** Creates the order, its line and its immutable pricing snapshot inside the
 * caller's transaction (the same one that inserts the participation row). */
export async function createOrder(tx: Tx, input: OrderInput): Promise<string> {
  const id = crypto.randomUUID();
  const b = input.price.breakdown;
  await tx
    .prepare(
      `INSERT INTO commerce_orders (id, source_type, source_ref, scenario, category, customer_client_id, customer_resident_id, partner_kind, partner_id,
         vendor_user_id, host_resident_id, currency, order_status, payment_status, customer_paid_minor, quote_id, rule_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      input.sourceType,
      input.sourceRef,
      SCENARIO_OF[input.sourceType],
      CATEGORY_OF[input.sourceType],
      input.customerClientId,
      input.customerResidentId,
      input.partner.kind,
      input.partner.id,
      input.partner.vendorUserId,
      input.partner.hostResidentId,
      CURRENCY,
      input.paymentStatus === "paid" ? "confirmed" : "pending_payment",
      b.customerPaidMinor === 0 ? "not_required" : input.paymentStatus,
      b.customerPaidMinor,
      input.quoteId,
      input.price.resolved.hash
    );
  await tx
    .prepare(
      `INSERT INTO commerce_order_lines (order_id, item_type, item_id, quantity, unit_minor, line_subtotal_minor, discount_minor, tax_minor, final_minor)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(id, input.line.itemType, input.line.itemId, input.line.quantity, input.line.unitMinor, b.listMinor, b.discountMinor, b.vatMinor, b.goodsGrossMinor);
  await tx
    .prepare(
      `INSERT INTO pricing_snapshots (order_id, engine_version, rule_hash, rule_sources, rule_values, currency, list_minor, discount_minor, coupon_code,
         goods_gross_minor, vat_minor, customer_fee_minor, deposit_minor, customer_paid_minor, partner_gross_minor, success_fee_minor,
         payment_cost_minor, partner_payment_cost_minor, partner_payout_minor, platform_revenue_minor, platform_contribution_minor)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      b.engineVersion,
      input.price.resolved.hash,
      JSON.stringify(input.price.resolved.sources),
      JSON.stringify(input.price.resolved.values),
      CURRENCY,
      b.listMinor,
      b.discountMinor,
      input.couponCode,
      b.goodsGrossMinor,
      b.vatMinor,
      b.customerFeeMinor,
      b.depositMinor,
      b.customerPaidMinor,
      b.partnerGrossMinor,
      b.successFeeMinor,
      b.paymentCostMinor,
      b.partnerPaymentCostMinor,
      b.partnerPayoutMinor,
      b.platformRevenueMinor,
      b.platformContributionMinor
    );
  if (input.quoteId) await tx.prepare(`UPDATE commerce_quotes SET order_id = ? WHERE id = ?`).run(id, input.quoteId);
  return id;
}

/** Mirrors the participation row's state onto its order (if it has one).
 * Idempotent and safe to call after any transition; a no-op for rows that
 * were never priced by the engine. A deleted pending row (expired/failed
 * checkout, the legacy convention for several tables) ends the order failed. */
export async function syncOrderFromSource(sourceType: CheckoutType, ref: string): Promise<void> {
  try {
    const order = (await db.prepare(`SELECT id, customer_paid_minor as paid FROM commerce_orders WHERE source_type = ? AND source_ref = ?`).get(sourceType, ref)) as
      | { id: string; paid: number }
      | undefined;
    if (!order) return;
    const table = SOURCE_TABLES[sourceType];
    const row = (await db.prepare(`SELECT status, payment_status as paymentStatus, stripe_session_id as stripeSessionId FROM ${table} WHERE ref = ?`).get(ref)) as
      | { status: string; paymentStatus: string; stripeSessionId: string | null }
      | undefined;
    let orderStatus: string;
    let paymentStatus: string;
    let fulfilment = "scheduled";
    if (!row) {
      orderStatus = "failed";
      paymentStatus = "failed";
      fulfilment = "cancelled";
    } else {
      paymentStatus = Number(order.paid) === 0 && row.paymentStatus === "paid" ? "not_required" : row.paymentStatus;
      if (row.status === "cancelled") {
        orderStatus = "cancelled";
        fulfilment = "cancelled";
      } else if (row.paymentStatus === "pending") orderStatus = "pending_payment";
      else if (row.paymentStatus === "failed") {
        orderStatus = "failed";
        fulfilment = "cancelled";
      } else orderStatus = "confirmed";
    }
    await db
      .prepare(`UPDATE commerce_orders SET order_status = ?, payment_status = ?, fulfilment_status = ?, stripe_session_id = COALESCE(?, stripe_session_id) WHERE id = ?`)
      .run(orderStatus, paymentStatus, fulfilment, row?.stripeSessionId ?? null, order.id);
  } catch (e) {
    // Never fail the legacy transition because the order mirror couldn't update;
    // the reconciliation view (Phase 4) re-derives it from the source row.
    console.error(`[commerce] order sync failed for ${sourceType} ${ref}:`, e);
  }
}

// --- shadow pricing -------------------------------------------------------------

export interface LegacyPricing {
  subtotalCents: number;
  discountCents: number;
  depositCents?: number;
  vatCents: number;
  platformFeeCents: number;
  totalCents: number;
}

/** Re-prices a legacy checkout with the published rules and records whether
 * they agree. Fire-and-forget: never throws, never alters the checkout. */
export async function shadowPrice(type: CheckoutType, ref: string, partner: PartnerRef | null, legacy: LegacyPricing): Promise<void> {
  try {
    if (!(await commerceSwitch("commerce.shadow_pricing"))) return;
    const engine = await priceWithRules(type, partner, { listMinor: legacy.subtotalCents, discountMinor: Math.min(legacy.discountCents, legacy.subtotalCents), depositMinor: legacy.depositCents ?? 0 });
    const b = engine.breakdown;
    const pairs: [string, number, number][] = [
      ["total", legacy.totalCents, b.customerPaidMinor],
      ["vat", legacy.vatCents, b.vatMinor],
      ["fee", legacy.platformFeeCents, b.customerFeeMinor],
      ["discount", Math.min(legacy.discountCents, legacy.subtotalCents), b.discountMinor],
    ];
    const diff = pairs.filter(([, a, c]) => a !== c).map(([k]) => k);
    await db
      .prepare(`INSERT INTO commerce_shadow_diffs (source_type, source_ref, matched, diff_fields, legacy, engine, rule_hash) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(type, ref, diff.length === 0 ? 1 : 0, diff.join(","), JSON.stringify(legacy), JSON.stringify(b), engine.resolved.hash);
    if (diff.length) console.warn(`[commerce] shadow pricing mismatch for ${type} ${ref}: ${diff.join(", ")}`);
  } catch (e) {
    console.error(`[commerce] shadow pricing failed for ${type} ${ref}:`, e);
  }
}

/** Convenience for legacy routes: shadow-price with the partner resolved from
 * the owning vendor user or host resident. Fire-and-forget. */
export function shadowLegacy(type: CheckoutType, ref: string, owner: { vendorUserId?: string | null; hostResidentId?: string | null }, legacy: LegacyPricing): void {
  void (async () => {
    const partner = owner.hostResidentId ? hostPartner(owner.hostResidentId) : await vendorPartner(owner.vendorUserId ?? null);
    await shadowPrice(type, ref, partner, legacy);
  })().catch((e) => console.error(`[commerce] shadow pricing failed for ${type} ${ref}:`, e));
}
