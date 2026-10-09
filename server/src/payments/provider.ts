// Revenue & Connect Stage 2b — payment-provider abstraction (brief rule 12).
//
// Every call to a payment provider goes through `PaymentProvider`, so the
// commerce engine, ledger and settlement code can run end to end against a
// deterministic, network-free stub, and the Stripe implementation stays the
// only place that knows Stripe's API shape. The webhook signature check
// (stripe.webhooks.constructEvent) is verification, not a call, and stays in
// routes/stripeWebhook.ts.
//
// Connect (Stage 5a): Express connected accounts with Stripe-hosted
// onboarding (Account Links), separate charges and transfers, explicit
// transfer reversals. Every Connect code path is additionally gated by the
// commerce.connect_v1 switch in payments/connect.ts, and live keys are still
// refused outside production (stripe.ts), so in development this can only
// ever reach a Stripe test-mode account.

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

export interface ConnectedAccountStatus {
  id: string;
  country: string | null;
  detailsSubmitted: boolean;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  /** "active" | "inactive" | "pending" — the transfers capability. */
  transfersCapability: string;
  requirementsDue: string[];
  disabledReason: string | null;
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
  /** The provider's actual processing fee for a payment, or null if not yet known. */
  paymentFee(paymentIntentId: string): Promise<number | null>;
  /** Re-fetch a webhook event by id (admin replay; never trust a stored copy). */
  retrieveEvent(eventId: string): Promise<import("./webhookEvents.js").IncomingEvent | null>;
  // Connect (Stage 5a).
  createConnectedAccount(p: { country: string; email: string; idempotencyKey: string; metadata: Record<string, string> }): Promise<{ id: string }>;
  retrieveConnectedAccount(accountId: string): Promise<ConnectedAccountStatus>;
  /** Stripe-hosted onboarding / update link (single use, short-lived). */
  createOnboardingLink(p: { accountId: string; refreshUrl: string; returnUrl: string }): Promise<{ url: string }>;
  /** One-time login link to the partner's Express dashboard (payouts, bank details). */
  createDashboardLink(accountId: string): Promise<{ url: string }>;
  createTransfer(p: { amountMinor: number; currency: string; destinationAccountId: string; transferGroup: string; sourceTransactionId?: string; idempotencyKey: string; metadata: Record<string, string> }): Promise<{ id: string }>;
  // Billing (Stage 5b) — HelloCircle Pro, a monthly subscription paid by the partner.
  createSubscriptionCheckout(p: { customerEmail: string; productName: string; unitAmountMinor: number; currency: string; successUrl: string; cancelUrl: string; metadata: Record<string, string> }): Promise<{ id: string; url: string | null }>;
  /** atPeriodEnd: stop renewing (Pro continues to the end of the paid month); otherwise end now. */
  cancelSubscription(p: { subscriptionId: string; atPeriodEnd: boolean }): Promise<void>;
  resumeSubscription(subscriptionId: string): Promise<void>;
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

  async paymentFee(paymentIntentId: string) {
    const pi = await this.client.paymentIntents.retrieve(paymentIntentId, { expand: ["latest_charge.balance_transaction"] });
    const charge = pi.latest_charge && typeof pi.latest_charge !== "string" ? pi.latest_charge : null;
    const bt = charge?.balance_transaction && typeof charge.balance_transaction !== "string" ? charge.balance_transaction : null;
    return bt ? bt.fee : null;
  }

  async retrieveEvent(eventId: string) {
    const e = await this.client.events.retrieve(eventId);
    return { id: e.id, type: e.type, created: e.created, livemode: e.livemode, account: e.account ?? null, data: { object: e.data.object as unknown as Record<string, any> } };
  }

  // Express dashboard + platform-managed pricing + platform-owned negative
  // balance liability (the recommended configuration, docs 05). No
  // application_fee_amount anywhere: with separate charges and transfers
  // HelloCircle keeps the charge minus what it transfers.
  async createConnectedAccount(p: { country: string; email: string; idempotencyKey: string; metadata: Record<string, string> }) {
    const a = await this.client.accounts.create(
      {
        country: p.country,
        email: p.email,
        controller: {
          fees: { payer: "application" },
          losses: { payments: "application" },
          stripe_dashboard: { type: "express" },
          requirement_collection: "stripe",
        },
        capabilities: { transfers: { requested: true } },
        metadata: p.metadata,
      },
      { idempotencyKey: p.idempotencyKey }
    );
    return { id: a.id };
  }

  async retrieveConnectedAccount(accountId: string): Promise<ConnectedAccountStatus> {
    return accountStatusFrom(await this.client.accounts.retrieve(accountId));
  }

  async createOnboardingLink(p: { accountId: string; refreshUrl: string; returnUrl: string }) {
    const link = await this.client.accountLinks.create({ account: p.accountId, refresh_url: p.refreshUrl, return_url: p.returnUrl, type: "account_onboarding" });
    return { url: link.url };
  }

  async createDashboardLink(accountId: string) {
    const link = await this.client.accounts.createLoginLink(accountId);
    return { url: link.url };
  }

  async createTransfer(p: { amountMinor: number; currency: string; destinationAccountId: string; transferGroup: string; sourceTransactionId?: string; idempotencyKey: string; metadata: Record<string, string> }) {
    const t = await this.client.transfers.create(
      {
        amount: p.amountMinor,
        currency: p.currency.toLowerCase(),
        destination: p.destinationAccountId,
        transfer_group: p.transferGroup,
        ...(p.sourceTransactionId ? { source_transaction: p.sourceTransactionId } : {}),
        metadata: p.metadata,
      },
      { idempotencyKey: p.idempotencyKey }
    );
    return { id: t.id };
  }

  async createSubscriptionCheckout(p: { customerEmail: string; productName: string; unitAmountMinor: number; currency: string; successUrl: string; cancelUrl: string; metadata: Record<string, string> }) {
    const session = await this.client.checkout.sessions.create({
      mode: "subscription",
      customer_email: p.customerEmail,
      line_items: [{ quantity: 1, price_data: { currency: p.currency.toLowerCase(), unit_amount: p.unitAmountMinor, recurring: { interval: "month" }, product_data: { name: p.productName } } }],
      success_url: p.successUrl,
      cancel_url: p.cancelUrl,
      metadata: p.metadata,
      subscription_data: { metadata: p.metadata },
    });
    return { id: session.id, url: session.url };
  }

  async cancelSubscription(p: { subscriptionId: string; atPeriodEnd: boolean }) {
    if (p.atPeriodEnd) await this.client.subscriptions.update(p.subscriptionId, { cancel_at_period_end: true });
    else await this.client.subscriptions.cancel(p.subscriptionId);
  }

  async resumeSubscription(subscriptionId: string) {
    await this.client.subscriptions.update(subscriptionId, { cancel_at_period_end: false });
  }

  async reverseTransfer(p: { transferId: string; amountMinor?: number; idempotencyKey: string; metadata: Record<string, string> }) {
    const r = await this.client.transfers.createReversal(p.transferId, { ...(p.amountMinor ? { amount: p.amountMinor } : {}), metadata: p.metadata }, { idempotencyKey: p.idempotencyKey });
    return { id: r.id, amountMinor: r.amount };
  }
}

/** Maps a Stripe account object (API response or account.updated webhook payload). */
export function accountStatusFrom(a: Pick<Stripe.Account, "id" | "country" | "details_submitted" | "charges_enabled" | "payouts_enabled" | "capabilities" | "requirements">): ConnectedAccountStatus {
  return {
    id: a.id,
    country: a.country ?? null,
    detailsSubmitted: !!a.details_submitted,
    chargesEnabled: !!a.charges_enabled,
    payoutsEnabled: !!a.payouts_enabled,
    transfersCapability: String(a.capabilities?.transfers ?? "inactive"),
    requirementsDue: [...(a.requirements?.currently_due ?? []), ...(a.requirements?.past_due ?? [])].filter((x, i, arr) => arr.indexOf(x) === i),
    disabledReason: a.requirements?.disabled_reason ?? null,
  };
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
  private accounts = new Map<string, ConnectedAccountStatus>();
  private accountsByKey = new Map<string, string>();
  private reversalsByKey = new Map<string, { id: string; amountMinor: number }>();
  /** Test hook: the next createTransfer throws this (then clears). */
  failNextTransfer: (Error & { code?: string; type?: string }) | null = null;

  /** Test helper: make an event retrievable (as the provider would). */
  publishEvent(event: import("./webhookEvents.js").IncomingEvent) {
    this.events.set(event.id, event);
  }

  /** Deterministic "actual" fee: 1.4% + €0.25 (deliberately ≠ the 1.5% estimate). */
  async paymentFee(paymentIntentId: string) {
    this.record("paymentFee", { paymentIntentId });
    const c = this.charges.get(paymentIntentId);
    return c ? Math.floor((c.amountMinor * 140 + 5_000) / 10_000) + 25 : null;
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
    this.accounts.clear();
    this.accountsByKey.clear();
    this.reversalsByKey.clear();
    this.failNextTransfer = null;
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

  async createConnectedAccount(p: { country: string; email: string; idempotencyKey: string; metadata: Record<string, string> }) {
    this.record("createConnectedAccount", p);
    const prior = this.accountsByKey.get(p.idempotencyKey);
    if (prior) return { id: prior };
    const id = `acct_stub_${++this.seq}`;
    this.accountsByKey.set(p.idempotencyKey, id);
    this.accounts.set(id, { id, country: p.country, detailsSubmitted: false, chargesEnabled: false, payoutsEnabled: false, transfersCapability: "inactive", requirementsDue: ["external_account", "individual.verification.document"], disabledReason: "requirements.past_due" });
    return { id };
  }

  async retrieveConnectedAccount(accountId: string) {
    this.record("retrieveConnectedAccount", { accountId });
    const a = this.accounts.get(accountId);
    if (!a) throw Object.assign(new Error("No such account"), { code: "resource_missing" });
    return { ...a, requirementsDue: [...a.requirementsDue] };
  }

  async createOnboardingLink(p: { accountId: string; refreshUrl: string; returnUrl: string }) {
    this.record("createOnboardingLink", p);
    return { url: `https://connect.stub.invalid/onboarding/${p.accountId}` };
  }

  async createDashboardLink(accountId: string) {
    this.record("createDashboardLink", { accountId });
    return { url: `https://connect.stub.invalid/express/${accountId}` };
  }

  async createSubscriptionCheckout(p: { customerEmail: string; productName: string; unitAmountMinor: number; currency: string; successUrl: string; cancelUrl: string; metadata: Record<string, string> }) {
    this.record("createSubscriptionCheckout", p);
    return { id: `cs_sub_stub_${++this.seq}`, url: null };
  }

  async cancelSubscription(p: { subscriptionId: string; atPeriodEnd: boolean }) {
    this.record("cancelSubscription", p);
  }

  async resumeSubscription(subscriptionId: string) {
    this.record("resumeSubscription", { subscriptionId });
  }

  /** Test helper: finish (or break) onboarding for an account. */
  setAccount(accountId: string, patch: Partial<ConnectedAccountStatus>) {
    const a = this.accounts.get(accountId);
    if (!a) throw new Error(`No stub account ${accountId}`);
    this.accounts.set(accountId, { ...a, ...patch });
  }

  async createTransfer(p: { amountMinor: number; idempotencyKey: string; destinationAccountId: string; transferGroup: string; currency: string; metadata: Record<string, string> }) {
    this.record("createTransfer", p);
    const prior = this.transfersByKey.get(p.idempotencyKey);
    if (prior) return { id: prior.id };
    if (this.failNextTransfer) {
      const e = this.failNextTransfer;
      this.failNextTransfer = null;
      throw e;
    }
    const t = { id: `tr_stub_${++this.seq}`, amountMinor: p.amountMinor };
    this.transfersByKey.set(p.idempotencyKey, t);
    return { id: t.id };
  }

  async reverseTransfer(p: { transferId: string; amountMinor?: number; idempotencyKey: string; metadata: Record<string, string> }) {
    this.record("reverseTransfer", p);
    const prior = this.reversalsByKey.get(p.idempotencyKey);
    if (prior) return prior;
    const t = [...this.transfersByKey.values()].find((x) => x.id === p.transferId);
    if (!t) throw Object.assign(new Error("No such transfer"), { code: "resource_missing" });
    const r = { id: `trr_stub_${++this.seq}`, amountMinor: p.amountMinor ?? t.amountMinor };
    this.reversalsByKey.set(p.idempotencyKey, r);
    return r;
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
