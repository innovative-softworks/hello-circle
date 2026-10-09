// Revenue & Connect Stage 2b — payment-provider abstraction (brief rule 12).
//
// Every call to a payment provider goes through `PaymentProvider`, so the
// commerce engine, ledger and settlement code can run end to end against a
// deterministic, network-free stub, and the Stripe implementation stays the
// only place that knows Stripe's API shape. The webhook signature check
// (stripe.webhooks.constructEvent) is verification, not a call, and stays in
// routes/stripeWebhook.ts.
//
// Connect methods are declared now so Stage 2c/2d code is written against the
// final interface; the Stripe implementation refuses them until Stage 5 (it
// needs Connect enabled in test mode and the owner's go-ahead, decision B2).

import type Stripe from "stripe";
import { stripe } from "../stripe.js";

export class ProviderNotEnabledError extends Error {
  constructor(what: string) {
    super(`${what} isn't enabled yet (Stripe Connect is switched on in Stage 5)`);
  }
}

export interface CheckoutSessionParams {
  currency: string;
  lineItems: { name: string; description?: string; unitAmountMinor: number }[];
  customerId?: string | null;
  customerEmail?: string;
  successUrl: string;
  cancelUrl: string;
  metadata: Record<string, string>;
  expiresAt: number;
  /** Offer "save my card" (only meaningful with a customer). */
  savePaymentMethod?: boolean;
}

export interface ChargeState {
  amountMinor: number;
  refundedMinor: number;
}

export interface CardSummary {
  id: string;
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
}

export interface PaymentProvider {
  readonly name: "stripe" | "stub";
  createCheckoutSession(p: CheckoutSessionParams): Promise<{ id: string; url: string | null }>;
  createCustomer(email: string): Promise<string>;
  /** The payment intent behind a Checkout session (null if none yet). */
  sessionPaymentIntent(sessionId: string): Promise<{ paymentIntentId: string | null; amountTotalMinor: number | null }>;
  chargeState(paymentIntentId: string): Promise<ChargeState>;
  /** Omit amountMinor for a full refund. Idempotent by key at the provider. */
  createRefund(p: { paymentIntentId: string; amountMinor?: number; idempotencyKey: string; metadata: Record<string, string> }): Promise<{ id: string | null; amountMinor: number | null }>;
  // Saved cards (resident payment-methods screen).
  listCards(customerId: string): Promise<{ cards: CardSummary[]; defaultId: string | null }>;
  cardOwner(paymentMethodId: string): Promise<string | null>;
  setDefaultCard(customerId: string, paymentMethodId: string): Promise<void>;
  detachCard(paymentMethodId: string): Promise<void>;
  /** Re-fetch a webhook event by id (admin replay; never trust a stored copy). */
  retrieveEvent(eventId: string): Promise<import("./webhookEvents.js").IncomingEvent | null>;
  // Connect (Stage 5).
  createTransfer(p: { amountMinor: number; currency: string; destinationAccountId: string; transferGroup: string; sourceTransactionId?: string; idempotencyKey: string; metadata: Record<string, string> }): Promise<{ id: string }>;
  reverseTransfer(p: { transferId: string; amountMinor?: number; idempotencyKey: string; metadata: Record<string, string> }): Promise<{ id: string; amountMinor: number }>;
}

// --- Stripe -------------------------------------------------------------------

class StripeProvider implements PaymentProvider {
  readonly name = "stripe" as const;
  constructor(private readonly client: Stripe) {}

  async createCheckoutSession(p: CheckoutSessionParams) {
    const session = await this.client.checkout.sessions.create({
      mode: "payment",
      line_items: p.lineItems.map((li) => ({
        price_data: { currency: p.currency.toLowerCase(), product_data: { name: li.name, description: li.description }, unit_amount: li.unitAmountMinor },
        quantity: 1,
      })),
      // Checkout requires exactly one of customer / customer_email.
      ...(p.customerId ? { customer: p.customerId } : { customer_email: p.customerEmail }),
      ...(p.customerId && p.savePaymentMethod ? { saved_payment_method_options: { payment_method_save: "enabled" as const } } : {}),
      success_url: p.successUrl,
      cancel_url: p.cancelUrl,
      metadata: p.metadata,
      expires_at: p.expiresAt,
    });
    return { id: session.id, url: session.url ?? null };
  }

  async createCustomer(email: string) {
    return (await this.client.customers.create({ email })).id;
  }

  async sessionPaymentIntent(sessionId: string) {
    const session = await this.client.checkout.sessions.retrieve(sessionId);
    const pi = session.payment_intent;
    return { paymentIntentId: pi ? (typeof pi === "string" ? pi : pi.id) : null, amountTotalMinor: session.amount_total ?? null };
  }

  async chargeState(paymentIntentId: string) {
    const pi = await this.client.paymentIntents.retrieve(paymentIntentId, { expand: ["latest_charge"] });
    const charge = pi.latest_charge && typeof pi.latest_charge !== "string" ? pi.latest_charge : null;
    return { amountMinor: charge?.amount ?? pi.amount_received ?? 0, refundedMinor: charge?.amount_refunded ?? 0 };
  }

  async createRefund(p: { paymentIntentId: string; amountMinor?: number; idempotencyKey: string; metadata: Record<string, string> }) {
    const refund = await this.client.refunds.create(
      { payment_intent: p.paymentIntentId, ...(p.amountMinor !== undefined ? { amount: p.amountMinor } : {}), metadata: p.metadata },
      { idempotencyKey: p.idempotencyKey }
    );
    return { id: refund.id ?? null, amountMinor: refund.amount ?? null };
  }

  async listCards(customerId: string) {
    const [methods, customer] = await Promise.all([this.client.paymentMethods.list({ customer: customerId, type: "card" }), this.client.customers.retrieve(customerId)]);
    const defaultPm = !("deleted" in customer && customer.deleted) ? (customer as Stripe.Customer).invoice_settings?.default_payment_method : null;
    return {
      cards: methods.data.map((m) => ({ id: m.id, brand: m.card?.brand ?? "card", last4: m.card?.last4 ?? "????", expMonth: m.card?.exp_month ?? 0, expYear: m.card?.exp_year ?? 0 })),
      defaultId: typeof defaultPm === "string" ? defaultPm : defaultPm?.id ?? null,
    };
  }

  async cardOwner(paymentMethodId: string) {
    const m = await this.client.paymentMethods.retrieve(paymentMethodId);
    return typeof m.customer === "string" ? m.customer : m.customer?.id ?? null;
  }

  async setDefaultCard(customerId: string, paymentMethodId: string) {
    await this.client.customers.update(customerId, { invoice_settings: { default_payment_method: paymentMethodId } });
  }

  async detachCard(paymentMethodId: string) {
    await this.client.paymentMethods.detach(paymentMethodId);
  }

  async retrieveEvent(eventId: string) {
    const e = await this.client.events.retrieve(eventId);
    return { id: e.id, type: e.type, created: e.created, livemode: e.livemode, account: e.account ?? null, data: { object: e.data.object as unknown as Record<string, any> } };
  }

  async createTransfer(): Promise<{ id: string }> {
    throw new ProviderNotEnabledError("Transfers to connected accounts");
  }

  async reverseTransfer(): Promise<{ id: string; amountMinor: number }> {
    throw new ProviderNotEnabledError("Transfer reversals");
  }
}

// --- Stub (tests, offline QA) -------------------------------------------------

/** Deterministic, network-free provider. State is per-process and resettable,
 * and every call is recorded so tests can assert exactly what would have been
 * sent to the provider. */
export class StubProvider implements PaymentProvider {
  readonly name = "stub" as const;
  readonly calls: { method: string; args: unknown }[] = [];
  private seq = 0;
  private charges = new Map<string, ChargeState>();
  private refundsByKey = new Map<string, { id: string; amountMinor: number }>();
  private transfersByKey = new Map<string, { id: string; amountMinor: number }>();
  private events = new Map<string, import("./webhookEvents.js").IncomingEvent>();

  /** Test helper: make an event retrievable (as the provider would). */
  publishEvent(event: import("./webhookEvents.js").IncomingEvent) {
    this.events.set(event.id, event);
  }

  async retrieveEvent(eventId: string) {
    this.record("retrieveEvent", { eventId });
    return this.events.get(eventId) ?? null;
  }

  reset() {
    this.calls.length = 0;
    this.seq = 0;
    this.charges.clear();
    this.refundsByKey.clear();
    this.transfersByKey.clear();
    this.events.clear();
  }

  /** Test helper: record that a session was paid for `amountMinor`. */
  markPaid(sessionId: string, amountMinor: number) {
    this.charges.set(`pi_stub_${sessionId}`, { amountMinor, refundedMinor: 0 });
  }

  private record(method: string, args: unknown) {
    this.calls.push({ method, args });
  }

  async createCheckoutSession(p: CheckoutSessionParams) {
    this.record("createCheckoutSession", p);
    // Same id shape the Phase 8 QA seam always used, so existing tests hold.
    return { id: `cs_qa_stub_${p.metadata.ref ?? ++this.seq}`, url: null };
  }

  async createCustomer(email: string) {
    this.record("createCustomer", { email });
    return `cus_stub_${++this.seq}`;
  }

  async sessionPaymentIntent(sessionId: string) {
    this.record("sessionPaymentIntent", { sessionId });
    const pi = `pi_stub_${sessionId}`;
    const c = this.charges.get(pi);
    return { paymentIntentId: c ? pi : null, amountTotalMinor: c?.amountMinor ?? null };
  }

  async chargeState(paymentIntentId: string) {
    this.record("chargeState", { paymentIntentId });
    return { ...(this.charges.get(paymentIntentId) ?? { amountMinor: 0, refundedMinor: 0 }) };
  }

  async createRefund(p: { paymentIntentId: string; amountMinor?: number; idempotencyKey: string; metadata: Record<string, string> }) {
    this.record("createRefund", p);
    const prior = this.refundsByKey.get(p.idempotencyKey);
    if (prior) return prior; // provider-side idempotency
    const c = this.charges.get(p.paymentIntentId);
    if (!c) throw Object.assign(new Error("No such payment"), { code: "resource_missing" });
    const remaining = c.amountMinor - c.refundedMinor;
    const amount = p.amountMinor ?? remaining;
    if (remaining <= 0) throw Object.assign(new Error("Charge has already been refunded."), { code: "charge_already_refunded" });
    if (amount > remaining) throw Object.assign(new Error("Refund exceeds the remaining charge"), { code: "amount_too_large" });
    c.refundedMinor += amount;
    const r = { id: `re_stub_${++this.seq}`, amountMinor: amount };
    this.refundsByKey.set(p.idempotencyKey, r);
    return r;
  }

  async listCards() {
    return { cards: [], defaultId: null };
  }
  async cardOwner() {
    return null;
  }
  async setDefaultCard() {}
  async detachCard() {}

  async createTransfer(p: { amountMinor: number; idempotencyKey: string; destinationAccountId: string; transferGroup: string; currency: string; metadata: Record<string, string> }) {
    this.record("createTransfer", p);
    const prior = this.transfersByKey.get(p.idempotencyKey);
    if (prior) return { id: prior.id };
    const t = { id: `tr_stub_${++this.seq}`, amountMinor: p.amountMinor };
    this.transfersByKey.set(p.idempotencyKey, t);
    return { id: t.id };
  }

  async reverseTransfer(p: { transferId: string; amountMinor?: number; idempotencyKey: string; metadata: Record<string, string> }) {
    this.record("reverseTransfer", p);
    const t = [...this.transfersByKey.values()].find((x) => x.id === p.transferId);
    if (!t) throw Object.assign(new Error("No such transfer"), { code: "resource_missing" });
    return { id: `trr_stub_${++this.seq}`, amountMinor: p.amountMinor ?? t.amountMinor };
  }
}

// --- selection ----------------------------------------------------------------

export const stubProvider = new StubProvider();

/** Phase 8 QA seam (unchanged rule): the stub only ever runs in the isolated
 * test profile with an explicit opt-in — never in development or production. */
export function qaProviderStubEnabled(): boolean {
  return process.env.NODE_ENV === "test" && process.env.QA_E2E_ENABLED === "true" && process.env.QA_PAYMENT_PROVIDER_STUB === "1";
}

/** The provider for this request, or null when payments aren't configured. */
export function paymentProvider(): PaymentProvider | null {
  if (qaProviderStubEnabled()) return stubProvider;
  return stripe ? new StripeProvider(stripe) : null;
}
