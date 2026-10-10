// Revenue & Connect Stage 2b — payment-provider abstraction (brief rule 12).
//
// Every call to a payment provider goes through `PaymentProvider`, so the
// commerce engine, ledger and settlement code can run end to end against a
// deterministic, network-free stub, and the Stripe implementation stays the
// only place that knows Stripe's API shape. The webhook signature check
// (stripe.webhooks.constructEvent) is verification, not a call, and stays in
// routes/stripeWebhook.ts.
//
// Connect (Stage 5a; Accounts v2 since Stage 5e): Express-dashboard
// connected accounts created through Stripe Accounts v2 (recipient
// configuration), Stripe-hosted onboarding (v2 Account Links), separate
// charges and transfers, explicit transfer reversals. A small number of
// operations still go through documented Accounts v1 endpoints with the v2
// account id; they are listed in CONNECT_V1_COMPAT below and nowhere else
// may know which API generation performed an operation. Every Connect code path is additionally gated by the
// commerce.connect_v1 switch in payments/connect.ts, and live keys are still
// refused outside production (stripe.ts), so in development this can only
// ever reach a Stripe test-mode account.

import type Stripe from "stripe";
import { stripe } from "../stripe.js";

/** Stage 5d — in the QA Stripe sandbox profile only, every object this
 * provider creates carries the run's id (metadata hc_qa_run), so a sandbox
 * run can prove what it created and never touch anything else. Empty (no
 * change to production metadata) outside that profile. */
export function qaRunMetadata(): Record<string, string> {
  const tag = process.env.HC_QA_STRIPE_RUN ?? "";
  if (process.env.NODE_ENV !== "test" || process.env.QA_E2E_ENABLED !== "true" || process.env.QA_STRIPE_TEST_PROFILE !== "1" || !/^qa_stripe_[a-z0-9]{8,32}$/.test(tag)) return {};
  return { hc_qa_run: tag };
}

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
  /** Stage 5d — the charge id, when known, so a reconciled refund can carry the provider's refund id. */
  chargeId?: string | null;
}

export interface CardSummary {
  id: string;
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
}

export type ConnectApiModel = "v1" | "v2";

/** Model-neutral connected-account state, always read from the provider. */
export interface ConnectedAccountStatus {
  id: string;
  apiModel: ConnectApiModel;
  country: string | null;
  /** "recipient" for v2 (receives transfers into its Stripe balance); null for v1. */
  configurationType: string | null;
  dashboardType: string | null;
  businessType: "company" | "individual" | null;
  detailsSubmitted: boolean;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  /** "not_requested" for a recipient account — HelloCircle is the merchant. */
  chargesCapability: string;
  /** "active" | "pending" | "restricted" | "unsupported" | "inactive" — receiving transfers. */
  transfersCapability: string;
  /** Same values — Stripe paying the partner's Stripe balance out to their bank. */
  payoutsCapability: string;
  /** Requirements the partner must provide now. */
  requirementsDue: string[];
  /** Requirements already overdue (capabilities restricted until provided). */
  requirementsPastDue: string[];
  /** Requirements waiting on Stripe (verification under review). */
  requirementsPending: string[];
  disabledReason: string | null;
}

/**
 * Stage 5e — every Accounts v1 endpoint still used for an Accounts v2
 * account. Stripe documents these as the supported way to do these things
 * for v2 accounts (there is no v2 equivalent in the API or in stripe-node
 * 22.x). Each entry names its removal test: when Stripe ships a v2
 * equivalent, the named test is switched to the v2 call and this entry goes.
 * docs/revenue-connect/adr-accounts-v2.md has the full inventory.
 */
export const CONNECT_V1_COMPAT = [
  { endpoint: "POST /v1/transfers", use: "platform → connected-account transfer (separate charges and transfers)", reason: "Accounts v2 has no transfers API; Stripe accepts a v2 account id as destination when configuration.recipient stripe_balance.stripe_transfers is active", doc: "https://docs.stripe.com/connect/accounts-v2/api", detect: "SANDBOX-SPLIT-C transfer leg" },
  { endpoint: "POST /v1/transfers/:id/reversals", use: "partial/full transfer reversal (debt recovery)", reason: "no v2 reversal API", doc: "https://docs.stripe.com/connect/separate-charges-and-transfers", detect: "SANDBOX-SPLIT-D reversal leg" },
  { endpoint: "POST /v1/accounts/:id/login_links", use: "one-time link to the partner's Express dashboard", reason: "no v2 login-link API; v2 Express-dashboard accounts use the v1 endpoint", doc: "https://docs.stripe.com/connect/express-dashboard", detect: "connect.test dashboard link" },
  { endpoint: "GET /v1/payouts (Stripe-Account)", use: "reading bank payouts on the connected account (reconciliation)", reason: "payouts are v1 objects on the connected account", doc: "https://docs.stripe.com/connect/payouts-connected-accounts", detect: "SANDBOX-PAYOUTS" },
  { endpoint: "POST /v1/accounts/:id (settings.payouts)", use: "payout schedule (QA harness only — the app never changes it)", reason: "Accounts v2 does not expose payout settings", doc: "https://docs.stripe.com/connect/manage-payout-schedule", detect: "SANDBOX-PAYOUTS setup" },
] as const;

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
  /** Stage 5d — the refunds on a charge (newest first), so refunds made at the provider are recorded under their own ids. */
  chargeRefunds(chargeId: string): Promise<{ id: string; amountMinor: number; status: string }[]>;
  /** The provider's actual processing fee for a payment, or null if not yet known. */
  paymentFee(paymentIntentId: string): Promise<number | null>;
  /** Re-fetch a webhook event by id (admin replay; never trust a stored copy). */
  retrieveEvent(eventId: string): Promise<import("./webhookEvents.js").IncomingEvent | null>;
  // Connect (Stage 5a; Accounts v2 since Stage 5e).
  /** Always creates an Accounts v2 recipient account (Express dashboard). Idempotent by key. */
  createConnectedAccount(p: { country: string; email: string; displayName: string; businessType?: "individual" | "company"; idempotencyKey: string; metadata: Record<string, string> }): Promise<{ id: string; apiModel: ConnectApiModel }>;
  /** The account's current state from the provider (v1 rows created before 5e are read with v1). */
  retrieveConnectedAccount(accountId: string, apiModel?: ConnectApiModel): Promise<ConnectedAccountStatus>;
  /** Stripe-hosted onboarding (first time) or update (more information) link — single use, short-lived. */
  createOnboardingLink(p: { accountId: string; apiModel?: ConnectApiModel; refreshUrl: string; returnUrl: string; purpose?: "onboarding" | "update" }): Promise<{ url: string; expiresAt: string | null }>;
  /** Stage 5e — verifies a v2 ("thin") event notification and returns its id; throws on a bad signature. */
  parseThinEvent(rawBody: Buffer | string, signature: string, secret: string): { id: string; type: string; relatedObjectId: string | null; created: string };
  /** Re-fetches a v2 event by id (the payload is never trusted). */
  retrieveThinEvent(eventId: string): Promise<{ id: string; type: string; relatedObjectId: string | null; created: string; livemode: boolean } | null>;
  /** One-time login link to the partner's Express dashboard (payouts, bank details). */
  createDashboardLink(accountId: string): Promise<{ url: string }>;
  createTransfer(p: { amountMinor: number; currency: string; destinationAccountId: string; transferGroup: string; sourceTransactionId?: string; idempotencyKey: string; metadata: Record<string, string> }): Promise<{ id: string }>;
  // Billing (Stage 5b) — HelloCircle Pro, a monthly subscription paid by the partner.
  /** Net (ex-VAT) monthly price; VAT is added at `vatBps` when > 0 (exclusive tax rate), never baked into the price. */
  createSubscriptionCheckout(p: { customerEmail: string; productName: string; netAmountMinor: number; vatBps: number; currency: string; successUrl: string; cancelUrl: string; metadata: Record<string, string> }): Promise<{ id: string; url: string | null }>;
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
      metadata: { ...p.metadata, ...qaRunMetadata() },
      // Stage 5d — the same {type, ref} on the PaymentIntent (and so its charge,
      // refunds and disputes), so a dispute can always be traced to the booking.
      payment_intent_data: { metadata: { ...p.metadata, ...qaRunMetadata() } },
      expires_at: p.expiresAt,
    });
    return { id: session.id, url: session.url ?? null };
  }

  async createCustomer(email: string) {
    return (await this.client.customers.create({ email, metadata: qaRunMetadata() })).id;
  }

  async sessionPaymentIntent(sessionId: string) {
    const session = await this.client.checkout.sessions.retrieve(sessionId);
    const pi = session.payment_intent;
    return { paymentIntentId: pi ? (typeof pi === "string" ? pi : pi.id) : null, amountTotalMinor: session.amount_total ?? null };
  }

  async chargeState(paymentIntentId: string) {
    const pi = await this.client.paymentIntents.retrieve(paymentIntentId, { expand: ["latest_charge"] });
    const charge = pi.latest_charge && typeof pi.latest_charge !== "string" ? pi.latest_charge : null;
    return { amountMinor: charge?.amount ?? pi.amount_received ?? 0, refundedMinor: charge?.amount_refunded ?? 0, chargeId: charge?.id ?? null };
  }

  async createRefund(p: { paymentIntentId: string; amountMinor?: number; idempotencyKey: string; metadata: Record<string, string> }) {
    const refund = await this.client.refunds.create(
      { payment_intent: p.paymentIntentId, ...(p.amountMinor !== undefined ? { amount: p.amountMinor } : {}), metadata: { ...p.metadata, ...qaRunMetadata() } },
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

  async chargeRefunds(chargeId: string) {
    const list = await this.client.refunds.list({ charge: chargeId, limit: 100 });
    return list.data.map((r) => ({ id: r.id, amountMinor: r.amount, status: String(r.status) }));
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

  // Stage 5e — Accounts v2 (docs/revenue-connect/adr-accounts-v2.md):
  //   dashboard "express"            the partner's Express dashboard
  //   fees/losses_collector "application"  HelloCircle owns pricing and the
  //                                  negative-balance liability
  //   configuration.recipient        receive transfers into the Stripe balance —
  //                                  the only capability requested; HelloCircle
  //                                  stays the merchant (separate charges and
  //                                  transfers; no merchant/card capabilities)
  // Requirement collection is Stripe's (Express): identity is collected on the
  // Stripe-hosted onboarding page, never by HelloCircle.
  private get v2() {
    return (this.client as unknown as { v2: { core: { accounts: any; accountLinks: any; events: any } } }).v2.core;
  }

  async createConnectedAccount(p: { country: string; email: string; displayName: string; businessType?: "individual" | "company"; idempotencyKey: string; metadata: Record<string, string> }) {
    const a = await this.v2.accounts.create(
      {
        contact_email: p.email,
        display_name: p.displayName.slice(0, 100),
        dashboard: "express",
        identity: { country: p.country.toLowerCase(), ...(p.businessType ? { entity_type: p.businessType } : {}) },
        configuration: { recipient: { capabilities: { stripe_balance: { stripe_transfers: { requested: true } } } } },
        defaults: { currency: "eur", responsibilities: { fees_collector: "application", losses_collector: "application" } },
        metadata: { ...p.metadata, ...qaRunMetadata() },
      },
      { idempotencyKey: p.idempotencyKey }
    );
    return { id: a.id as string, apiModel: "v2" as const };
  }

  async retrieveConnectedAccount(accountId: string, apiModel: ConnectApiModel = "v2"): Promise<ConnectedAccountStatus> {
    if (apiModel === "v1") return accountStatusFrom(await this.client.accounts.retrieve(accountId));
    return accountStatusFromV2(await this.v2.accounts.retrieve(accountId, { include: ["configuration.recipient", "requirements", "identity"] }));
  }

  async createOnboardingLink(p: { accountId: string; apiModel?: ConnectApiModel; refreshUrl: string; returnUrl: string; purpose?: "onboarding" | "update" }) {
    if (p.apiModel === "v1") {
      const link = await this.client.accountLinks.create({ account: p.accountId, refresh_url: p.refreshUrl, return_url: p.returnUrl, type: p.purpose === "update" ? "account_update" : "account_onboarding" });
      return { url: link.url, expiresAt: new Date(link.expires_at * 1000).toISOString() };
    }
    const type = p.purpose === "update" ? "account_update" : "account_onboarding";
    const link = await this.v2.accountLinks.create({
      account: p.accountId,
      use_case: { type, [type]: { configurations: ["recipient"], refresh_url: p.refreshUrl, return_url: p.returnUrl } },
    });
    return { url: link.url as string, expiresAt: (link.expires_at as string) ?? null };
  }

  /** Accounts v1 compatibility (CONNECT_V1_COMPAT): no v2 login-link API. */
  async createDashboardLink(accountId: string) {
    const link = await this.client.accounts.createLoginLink(accountId);
    return { url: link.url };
  }

  parseThinEvent(rawBody: Buffer | string, signature: string, secret: string) {
    const n = (this.client as unknown as { parseEventNotification: (b: Buffer | string, s: string, k: string) => any }).parseEventNotification(rawBody, signature, secret);
    return { id: String(n.id), type: String(n.type), relatedObjectId: n.related_object?.id ?? null, created: String(n.created) };
  }

  async retrieveThinEvent(eventId: string) {
    try {
      const e = await this.v2.events.retrieve(eventId);
      return { id: String(e.id), type: String(e.type), relatedObjectId: e.related_object?.id ?? null, created: String(e.created), livemode: !!e.livemode };
    } catch (err) {
      if ((err as { statusCode?: number }).statusCode === 404) return null;
      throw err;
    }
  }

  async createTransfer(p: { amountMinor: number; currency: string; destinationAccountId: string; transferGroup: string; sourceTransactionId?: string; idempotencyKey: string; metadata: Record<string, string> }) {
    const t = await this.client.transfers.create(
      {
        amount: p.amountMinor,
        currency: p.currency.toLowerCase(),
        destination: p.destinationAccountId,
        transfer_group: p.transferGroup,
        ...(p.sourceTransactionId ? { source_transaction: p.sourceTransactionId } : {}),
        metadata: { ...p.metadata, ...qaRunMetadata() },
      },
      { idempotencyKey: p.idempotencyKey }
    );
    return { id: t.id };
  }

  private taxRateIds = new Map<number, string>();

  /** An exclusive Irish VAT tax rate at `bps` (reused if one already exists). */
  private async vatTaxRate(bps: number): Promise<string> {
    const cached = this.taxRateIds.get(bps);
    if (cached) return cached;
    const pct = bps / 100;
    const existing = await this.client.taxRates.list({ active: true, inclusive: false, limit: 100 });
    const hit = existing.data.find((t) => t.percentage === pct && t.country === "IE" && t.display_name === "VAT" && t.metadata?.hellocircle === "pro");
    const id = hit?.id ?? (await this.client.taxRates.create({ display_name: "VAT", percentage: pct, inclusive: false, country: "IE", tax_type: "vat", metadata: { hellocircle: "pro", ...qaRunMetadata() } })).id;
    this.taxRateIds.set(bps, id);
    return id;
  }

  async createSubscriptionCheckout(p: { customerEmail: string; productName: string; netAmountMinor: number; vatBps: number; currency: string; successUrl: string; cancelUrl: string; metadata: Record<string, string> }) {
    const taxRates = p.vatBps > 0 ? [await this.vatTaxRate(p.vatBps)] : undefined;
    const session = await this.client.checkout.sessions.create({
      mode: "subscription",
      customer_email: p.customerEmail,
      line_items: [{ quantity: 1, price_data: { currency: p.currency.toLowerCase(), unit_amount: p.netAmountMinor, recurring: { interval: "month" }, product_data: { name: p.productName } }, ...(taxRates ? { tax_rates: taxRates } : {}) }],
      success_url: p.successUrl,
      cancel_url: p.cancelUrl,
      metadata: { ...p.metadata, ...qaRunMetadata() },
      subscription_data: { metadata: { ...p.metadata, ...qaRunMetadata() } },
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
    const r = await this.client.transfers.createReversal(p.transferId, { ...(p.amountMinor ? { amount: p.amountMinor } : {}), metadata: { ...p.metadata, ...qaRunMetadata() } }, { idempotencyKey: p.idempotencyKey });
    return { id: r.id, amountMinor: r.amount };
  }
}

/** Maps an Accounts v1 account object (accounts created before Stage 5e). */
export function accountStatusFrom(a: Pick<Stripe.Account, "id" | "country" | "details_submitted" | "charges_enabled" | "payouts_enabled" | "capabilities" | "requirements"> & { business_type?: string | null }): ConnectedAccountStatus {
  const pastDue = a.requirements?.past_due ?? [];
  return {
    id: a.id,
    apiModel: "v1",
    country: a.country ?? null,
    configurationType: null,
    dashboardType: "express",
    businessType: a.business_type === "company" || a.business_type === "individual" ? a.business_type : null,
    detailsSubmitted: !!a.details_submitted,
    chargesEnabled: !!a.charges_enabled,
    payoutsEnabled: !!a.payouts_enabled,
    chargesCapability: String(a.capabilities?.card_payments ?? "not_requested"),
    transfersCapability: String(a.capabilities?.transfers ?? "inactive"),
    payoutsCapability: a.payouts_enabled ? "active" : "restricted",
    requirementsDue: (a.requirements?.currently_due ?? []).filter((x) => !pastDue.includes(x)),
    requirementsPastDue: [...pastDue],
    requirementsPending: [...(a.requirements?.pending_verification ?? [])],
    disabledReason: a.requirements?.disabled_reason ?? null,
  };
}

/** Stage 5e — maps an Accounts v2 account (retrieved with configuration.recipient,
 * requirements and identity included). Requirements are split by who must act:
 * the partner (due / past due) or Stripe (pending review). */
export function accountStatusFromV2(a: any): ConnectedAccountStatus {
  const caps = a?.configuration?.recipient?.capabilities?.stripe_balance ?? {};
  const transfers = String(caps.stripe_transfers?.status ?? "inactive");
  const payouts = String(caps.payouts?.status ?? "inactive");
  const entries: any[] = a?.requirements?.entries ?? [];
  const user = entries.filter((e) => e.awaiting_action_from === "user");
  const pastDue = user.filter((e) => e.minimum_deadline?.status === "past_due").map((e) => String(e.description));
  const due = user.filter((e) => e.minimum_deadline?.status === "currently_due").map((e) => String(e.description));
  const pending = entries.filter((e) => e.awaiting_action_from === "stripe").map((e) => String(e.description));
  const detail = (c: any) => (c?.status && c.status !== "active" ? c.status_details?.[0]?.code ?? c.status : null);
  const entity = a?.identity?.entity_type;
  return {
    id: String(a.id),
    apiModel: "v2",
    country: a?.identity?.country ? String(a.identity.country).toUpperCase() : null,
    configurationType: (a?.applied_configurations ?? []).includes("recipient") || a?.configuration?.recipient ? "recipient" : null,
    dashboardType: a?.dashboard ?? null,
    businessType: entity === "company" || entity === "individual" ? entity : null,
    detailsSubmitted: pastDue.length === 0 && due.length === 0,
    chargesEnabled: false,
    payoutsEnabled: payouts === "active",
    chargesCapability: "not_requested",
    transfersCapability: transfers,
    payoutsCapability: payouts,
    requirementsDue: due,
    requirementsPastDue: pastDue,
    requirementsPending: pending,
    disabledReason: detail(caps.stripe_transfers) ?? detail(caps.payouts),
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
  /** Stage 5c — Connect objects are stored under globally unique keys
   * (connected_accounts.account_id, …), and every test file runs in its own
   * process with its own counter: a per-process tag keeps "acct_stub_1" from
   * one file colliding with another's in the shared test database. */
  private readonly tag = `${Math.random().toString(36).slice(2, 8)}_`;
  private charges = new Map<string, ChargeState>();
  private refundsByKey = new Map<string, { id: string; amountMinor: number }>();
  private transfersByKey = new Map<string, { id: string; amountMinor: number }>();
  private events = new Map<string, import("./webhookEvents.js").IncomingEvent>();
  private accounts = new Map<string, ConnectedAccountStatus>();
  private accountsByKey = new Map<string, string>();
  private reversalsByKey = new Map<string, { id: string; amountMinor: number }>();
  /** Test hook: the next createTransfer throws this (then clears). */
  failNextTransfer: (Error & { code?: string; type?: string }) | null = null;
  /** Test hook: the next reverseTransfer throws this (then clears). */
  failNextReversal: (Error & { code?: string; type?: string }) | null = null;

  /** Test helper: make an event retrievable (as the provider would). */
  publishEvent(event: import("./webhookEvents.js").IncomingEvent) {
    this.events.set(event.id, event);
  }

  async chargeRefunds() {
    return []; // the stub keeps no per-charge refund list: callers fall back to the amount-based record
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
    this.failNextReversal = null;
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

  /** Test hook: the next createConnectedAccount throws this AFTER creating the account (a timeout once the provider accepted it). */
  timeoutAfterNextCreate = false;

  async createConnectedAccount(p: { country: string; email: string; displayName: string; businessType?: "individual" | "company"; idempotencyKey: string; metadata: Record<string, string> }) {
    this.record("createConnectedAccount", p);
    const prior = this.accountsByKey.get(p.idempotencyKey);
    if (prior) return { id: prior, apiModel: "v2" as const };
    const id = `acct_stub_${this.tag}${++this.seq}`;
    this.accountsByKey.set(p.idempotencyKey, id);
    this.accounts.set(id, {
      id, apiModel: "v2", country: p.country, configurationType: "recipient", dashboardType: "express", businessType: p.businessType ?? null,
      detailsSubmitted: false, chargesEnabled: false, payoutsEnabled: false, chargesCapability: "not_requested", transfersCapability: "restricted", payoutsCapability: "restricted",
      requirementsDue: [], requirementsPastDue: ["external_account", "identity.attestations.terms_of_service.account.date"], requirementsPending: [], disabledReason: "requirements_past_due",
    });
    if (this.timeoutAfterNextCreate) {
      this.timeoutAfterNextCreate = false;
      throw Object.assign(new Error("Request timed out"), { type: "StripeConnectionError" });
    }
    return { id, apiModel: "v2" as const };
  }

  async retrieveConnectedAccount(accountId: string) {
    this.record("retrieveConnectedAccount", { accountId });
    const a = this.accounts.get(accountId);
    if (!a) throw Object.assign(new Error("No such account"), { code: "resource_missing" });
    return { ...a, requirementsDue: [...a.requirementsDue], requirementsPastDue: [...a.requirementsPastDue], requirementsPending: [...a.requirementsPending] };
  }

  async createOnboardingLink(p: { accountId: string; refreshUrl: string; returnUrl: string; purpose?: "onboarding" | "update" }) {
    this.record("createOnboardingLink", p);
    return { url: `https://connect.stub.invalid/${p.purpose === "update" ? "update" : "onboarding"}/${p.accountId}`, expiresAt: new Date(Date.now() + 5 * 60_000).toISOString() };
  }

  parseThinEvent(rawBody: Buffer | string, signature: string, secret: string) {
    // Stub signature: "stub=<secret>" — enough for route tests; real verification is Stripe's.
    if (signature !== `stub=${secret}`) throw Object.assign(new Error("No signatures found matching the expected signature"), { type: "StripeSignatureVerificationError" });
    const n = JSON.parse(String(rawBody));
    return { id: String(n.id), type: String(n.type), relatedObjectId: n.related_object?.id ?? null, created: String(n.created) };
  }

  private thinEvents = new Map<string, { id: string; type: string; relatedObjectId: string | null; created: string; livemode: boolean }>();
  /** Test helper: make a v2 event retrievable. */
  publishThinEvent(e: { id: string; type: string; relatedObjectId: string | null; created: string }) {
    this.thinEvents.set(e.id, { ...e, livemode: false });
  }
  async retrieveThinEvent(eventId: string) {
    this.record("retrieveThinEvent", { eventId });
    return this.thinEvents.get(eventId) ?? null;
  }

  async createDashboardLink(accountId: string) {
    this.record("createDashboardLink", { accountId });
    return { url: `https://connect.stub.invalid/express/${accountId}` };
  }

  async createSubscriptionCheckout(p: { customerEmail: string; productName: string; netAmountMinor: number; vatBps: number; currency: string; successUrl: string; cancelUrl: string; metadata: Record<string, string> }) {
    this.record("createSubscriptionCheckout", p);
    return { id: `cs_sub_stub_${this.tag}${++this.seq}`, url: null };
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
    // Pre-5e tests set the v1-era fields; keep the v2 fields consistent with them.
    const derived: Partial<ConnectedAccountStatus> = {};
    if (patch.payoutsEnabled !== undefined && patch.payoutsCapability === undefined) derived.payoutsCapability = patch.payoutsEnabled ? "active" : "restricted";
    if (patch.requirementsDue !== undefined && patch.requirementsPastDue === undefined && patch.requirementsDue.length === 0) derived.requirementsPastDue = [];
    if (patch.transfersCapability === "active" && patch.disabledReason === undefined) derived.disabledReason = null;
    this.accounts.set(accountId, { ...a, ...derived, ...patch });
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
    const t = { id: `tr_stub_${this.tag}${++this.seq}`, amountMinor: p.amountMinor };
    this.transfersByKey.set(p.idempotencyKey, t);
    return { id: t.id };
  }

  async reverseTransfer(p: { transferId: string; amountMinor?: number; idempotencyKey: string; metadata: Record<string, string> }) {
    this.record("reverseTransfer", p);
    const prior = this.reversalsByKey.get(p.idempotencyKey);
    if (prior) return prior;
    if (this.failNextReversal) {
      const e = this.failNextReversal;
      this.failNextReversal = null;
      throw e;
    }
    const t = [...this.transfersByKey.values()].find((x) => x.id === p.transferId);
    if (!t) throw Object.assign(new Error("No such transfer"), { code: "resource_missing" });
    const r = { id: `trr_stub_${this.tag}${++this.seq}`, amountMinor: p.amountMinor ?? t.amountMinor };
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
