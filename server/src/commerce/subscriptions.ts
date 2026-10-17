import { proPurchaseAllowed } from "./releaseGates.js";
import { noticePastDue } from "../financialExceptions.js";
import { writeAudit } from "../audit.js";
import { db } from "../db/index.js";
import { paymentProvider } from "../payments/provider.js";
import { CLIENT_URL } from "../stripe.js";
import { postGroup } from "./ledger.js";
import { applyBps, divRoundHalfUp } from "./money.js";
import { ledgerEnabled } from "./payments.js";
import { assignPlan, currentPlanFor, type PartnerKey } from "./plans.js";
import { resolveRule } from "./rules.js";
import { commerceSwitch } from "./switches.js";

// Revenue & Connect Stage 5b — HelloCircle Pro on Stripe Billing.
//
//   checkout (mode=subscription) → checkout.session.completed → Pro starts
//   invoice.paid                 → subscription revenue + VAT in the ledger
//   payment fails (past_due)     → 7-day grace, Pro continues
//   grace runs out (sweep)       → cancelled at Stripe, back to Free
//   partner cancels              → renews no more; Pro until the period ends,
//                                  customer.subscription.deleted → Free
//
// Pricing (Stage 5c): Pro is the published plan_pro price *excluding* VAT.
// The VAT that applies is resolved per partner from the versioned tax_vat
// rule (standard rate, or none for an exempt / reverse-charge partner) and
// frozen on the subscription with both rule hashes. Stripe gets the net
// price plus an exclusive tax rate, so the invoice shows VAT separately.
// There is no single "Pro price incl. VAT" — it depends on the partner.

export class SubscriptionError extends Error {
  constructor(message: string, readonly status: number = 400) {
    super(message);
  }
}

const LIVE = ["checkout", "active", "past_due"];
/** How long an open Pro checkout is reused instead of starting a new one (Stripe sessions live 24 h). */
const CHECKOUT_REUSE_MINUTES = 55;
/** Stripe requires a subscription trial to end at least 48 h after Checkout. */
const MIN_TRIAL_HOURS = 49;

/** Stage 5f — the grace period in force now (rule subscription_policy). */
export async function graceDays(at: Date = new Date()): Promise<number> {
  return Number((await resolveRule("subscription_policy", {}, at)).values.graceDays);
}

const ctxOf = (partner?: PartnerKey) => ({ orgId: partner?.kind === "org" ? partner.id : null, hostResidentId: partner?.kind === "host" ? partner.id : null });

/** The Pro price for this partner: net (ex-VAT) from plan_pro, VAT from the partner's tax_vat rule. */
export async function proPrice(partner?: PartnerKey, at: Date = new Date()) {
  const [plan, tax] = await Promise.all([resolveRule("plan_pro", ctxOf(partner), at), resolveRule("tax_vat", ctxOf(partner), at)]);
  const netMinor = Number(plan.values.subscriptionMonthlyMinor);
  const vatMode = String(tax.values.vatMode ?? "standard");
  const vatBps = vatMode === "standard" ? Number(tax.values.vatBps) : 0;
  const vatMinor = applyBps(netMinor, vatBps);
  // Stage 5f — the tax row's label for this partner (never a hard-coded Irish example).
  const taxLabel = vatMode === "standard" ? `VAT ${(vatBps / 100).toFixed(vatBps % 100 ? 2 : 0)}%` : vatMode === "reverse_charge" ? "Reverse charge — no VAT charged" : "VAT exempt";
  return { netMinor, vatMinor, grossMinor: netMinor + vatMinor, vatBps, vatMode, taxLabel, planRuleHash: plan.hash, taxRuleHash: tax.hash };
}

const SUB_FIELDS = `id, party_type as partyType, party_id as partyId, provider_subscription_id as subscriptionId, status, gross_minor as grossMinor,
  current_period_end as currentPeriodEnd, cancel_at_period_end as cancelAtPeriodEnd, grace_until as graceUntil, created_at as createdAt,
  checkout_session_id as checkoutSessionId, checkout_url as checkoutUrl, billing_starts_at as billingStartsAt, grace_days as graceDays`;

export async function liveSubscription(partner: PartnerKey) {
  return db
    .prepare(`SELECT ${SUB_FIELDS} FROM partner_subscriptions WHERE party_type = ? AND party_id = ? AND status IN ('checkout','active','past_due') ORDER BY id DESC LIMIT 1`)
    .get(partner.kind, partner.id) as Promise<
    | {
        id: number; partyType: string; partyId: string; subscriptionId: string | null; status: string; grossMinor: number; currentPeriodEnd: string | null; cancelAtPeriodEnd: number;
        graceUntil: string | null; createdAt: string; checkoutSessionId: string | null; checkoutUrl: string | null; billingStartsAt: string | null; graceDays: number | null;
      }
    | undefined
  >;
}

/**
 * Stage 5f — starts (or resumes) the partner's Pro checkout. Never two
 * subscriptions: a recent open checkout is reused; an older one is expired at
 * Stripe before a new one is created; a second completed checkout is cancelled
 * on arrival (applySubscriptionCheckout). During a reward-funded Pro month the
 * subscription starts with a trial ending when the reward month ends, so
 * billing starts then (decision D3).
 */
export async function startProCheckout(partner: PartnerKey, input: { email: string; actorId: string; returnPath: string; termsAccepted?: boolean }) {
  if (!(await commerceSwitch("commerce.pro_subscriptions"))) throw new SubscriptionError("Pro subscriptions aren't available yet", 409);
  // Commercial release gate — even with the switch on, no Pro purchase while the fee model is unapproved.
  if (!proPurchaseAllowed()) throw new SubscriptionError("Pro subscriptions aren't available yet", 409);
  if (input.termsAccepted !== true) throw new SubscriptionError("Please confirm the Pro terms before continuing", 400);
  const provider = paymentProvider();
  if (!provider) throw new SubscriptionError("Payments aren't configured on this server", 503);
  const existing = await liveSubscription(partner);
  if (existing && existing.status !== "checkout") throw new SubscriptionError("You already have a Pro subscription", 409);
  if (existing?.checkoutSessionId && existing.checkoutUrl && Date.now() - new Date(existing.createdAt).getTime() < CHECKOUT_REUSE_MINUTES * 60_000) {
    const status = await provider.checkoutSessionStatus(existing.checkoutSessionId).catch(() => "open" as const);
    if (status === "open") return { id: existing.checkoutSessionId, url: existing.checkoutUrl, reused: true };
    if (status === "complete") throw new SubscriptionError("Your Pro payment is being confirmed — this usually takes a few seconds", 409);
  }
  // Any older open checkout for this partner is expired at Stripe, so it can't be paid later.
  const stale = (await db.prepare(`SELECT checkout_session_id as sid FROM partner_subscriptions WHERE party_type = ? AND party_id = ? AND status = 'checkout'`).all(partner.kind, partner.id)) as { sid: string | null }[];
  for (const r of stale) if (r.sid) await provider.expireCheckoutSession(r.sid);
  await db.prepare(`UPDATE partner_subscriptions SET status = 'abandoned' WHERE party_type = ? AND party_id = ? AND status = 'checkout'`).run(partner.kind, partner.id);
  const price = await proPrice(partner);
  const cur = await currentPlanFor(partner);
  const rewardEnd = cur.planKey === "pro" && cur.source === "promotion" && cur.effectiveTo ? new Date(cur.effectiveTo) : null;
  const trialEnd = rewardEnd && rewardEnd.getTime() - Date.now() > MIN_TRIAL_HOURS * 3600_000 ? rewardEnd : null;
  const sep = input.returnPath.includes("?") ? "&" : "?";
  const session = await provider.createSubscriptionCheckout({
    customerEmail: input.email,
    productName: "HelloCircle Pro — monthly",
    netAmountMinor: price.netMinor,
    vatBps: price.vatBps,
    currency: "EUR",
    successUrl: `${CLIENT_URL}${input.returnPath}${sep}pro=success`,
    cancelUrl: `${CLIENT_URL}${input.returnPath}${sep}pro=cancelled`,
    // `type` is part of the webhook routing contract (routes/stripeWebhook.ts).
    metadata: { type: "subscription", party_type: partner.kind, party_id: partner.id },
    trialEndSec: trialEnd ? Math.floor(trialEnd.getTime() / 1000) : null,
  });
  await db
    .prepare(
      `INSERT INTO partner_subscriptions (party_type, party_id, checkout_session_id, checkout_url, status, gross_minor, net_minor, vat_minor, vat_bps, vat_mode, plan_rule_hash, tax_rule_hash, created_by, terms_accepted_at, billing_starts_at)
       VALUES (?, ?, ?, ?, 'checkout', ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?)`
    )
    .run(partner.kind, partner.id, session.id, session.url, price.grossMinor, price.netMinor, price.vatMinor, price.vatBps, price.vatMode, price.planRuleHash, price.taxRuleHash, input.actorId, trialEnd);
  return { id: session.id, url: session.url, reused: false, billingStartsAt: trialEnd?.toISOString() ?? null };
}

// --- webhook handlers --------------------------------------------------------------------

/** checkout.session.completed for a subscription checkout. */
export async function applySubscriptionCheckout(session: { id: string; subscription?: string | { id: string } | null; payment_status?: string; metadata?: Record<string, string> | null }) {
  const subId = typeof session.subscription === "string" ? session.subscription : session.subscription?.id ?? null;
  // "no_payment_required" = a trial checkout (paid Pro bought during a reward month; billing starts later).
  if (!subId || (session.payment_status !== "paid" && session.payment_status !== "no_payment_required")) return "ignored" as const;
  const row = (await db.prepare(`SELECT id, party_type as kind, party_id as pid, status FROM partner_subscriptions WHERE checkout_session_id = ?`).get(session.id)) as
    | { id: number; kind: PartnerKey["kind"]; pid: string; status: string }
    | undefined;
  if (!row) return "ignored" as const;
  if (row.status === "active" || row.status === "past_due" || row.status === "duplicate") return "processed" as const; // replay
  // Stage 5f — never two subscriptions: if another one is already live, this one is cancelled at Stripe now.
  const other = (await db
    .prepare(`SELECT id FROM partner_subscriptions WHERE party_type = ? AND party_id = ? AND id <> ? AND status IN ('active','past_due') LIMIT 1`)
    .get(row.kind, row.pid, row.id)) as { id: number } | undefined;
  if (other) {
    const provider = paymentProvider();
    if (provider) await provider.cancelSubscription({ subscriptionId: subId, atPeriodEnd: false });
    await db.prepare(`UPDATE partner_subscriptions SET provider_subscription_id = ?, status = 'duplicate' WHERE id = ?`).run(subId, row.id);
    await writeAudit({ actorUserId: null, actorKind: "system", action: "subscription.duplicate_cancelled", objectType: `partner_${row.kind}`, objectId: row.pid, newValue: { subscriptionId: subId, keptSubscriptionRow: other.id, note: "Refund the duplicate's first payment if one was taken" } });
    return "processed" as const;
  }
  await db.transaction(async (tx) => {
    await tx.prepare(`UPDATE partner_subscriptions SET provider_subscription_id = ?, status = 'active', grace_until = NULL WHERE id = ?`).run(subId, row.id);
    await assignPlan({ partner: { kind: row.kind, id: row.pid }, planKey: "pro", source: "subscription", sourceRef: subId, reason: "Pro subscription started", actorId: "system" }, tx);
  });
  await writeAudit({ actorUserId: null, actorKind: "system", action: "subscription.started", objectType: `partner_${row.kind}`, objectId: row.pid, newValue: { subscriptionId: subId } });
  return "processed" as const;
}

/** customer.subscription.updated / invoice.payment_failed. */
export async function applySubscriptionUpdate(sub: { id: string; status: string; current_period_end?: number | null; cancel_at_period_end?: boolean; items?: { data?: { current_period_end?: number }[] } }) {
  const row = (await db.prepare(`SELECT id, status, grace_until as grace FROM partner_subscriptions WHERE provider_subscription_id = ?`).get(sub.id)) as { id: number; status: string; grace: string | null } | undefined;
  if (!row) return "ignored" as const;
  if (row.status === "canceled" || row.status === "grace_expired") return "ignored" as const;
  const periodEndSec = sub.current_period_end ?? sub.items?.data?.[0]?.current_period_end ?? null;
  const status = sub.status === "past_due" || sub.status === "unpaid" ? "past_due" : sub.status === "active" || sub.status === "trialing" ? "active" : row.status;
  // Stage 5f — the grace period in force when the payment fails is frozen on the subscription.
  const days = status === "past_due" && !row.grace ? await graceDays() : null;
  const grace = status === "past_due" ? row.grace ?? new Date(Date.now() + days! * 864e5) : null;
  await db
    .prepare(`UPDATE partner_subscriptions SET status = ?, current_period_end = COALESCE(?, current_period_end), cancel_at_period_end = ?, grace_until = ?, grace_days = COALESCE(?, grace_days) WHERE id = ?`)
    .run(status, periodEndSec ? new Date(periodEndSec * 1000) : null, sub.cancel_at_period_end ? 1 : 0, grace, days, row.id);
  // OG-05 — the first failed Pro payment is announced to the partner once.
  if (status === "past_due") await noticePastDue(row.id).catch((e) => console.error("[past-due-notice] failed:", e instanceof Error ? e.message : "unknown"));
  return "processed" as const;
}

async function downgrade(rowId: number, partner: PartnerKey, subId: string, status: "canceled" | "grace_expired", reason: string) {
  await db.transaction(async (tx) => {
    await tx.prepare(`UPDATE partner_subscriptions SET status = ?, grace_until = NULL WHERE id = ?`).run(status, rowId);
    const cur = await currentPlanFor(partner, new Date(), tx);
    // Only end Pro that this subscription granted (a promotion or admin plan stays).
    if (cur.source === "subscription" && cur.sourceRef === subId) {
      await assignPlan({ partner, planKey: "free", source: "subscription", sourceRef: subId, reason, actorId: "system" }, tx);
    }
  });
  await writeAudit({ actorUserId: null, actorKind: "system", action: `subscription.${status}`, objectType: `partner_${partner.kind}`, objectId: partner.id, newValue: { subscriptionId: subId } });
}

/** customer.subscription.deleted — the paid period is over (or it was cancelled immediately). */
export async function applySubscriptionDeleted(sub: { id: string }) {
  const row = (await db.prepare(`SELECT id, party_type as kind, party_id as pid, status FROM partner_subscriptions WHERE provider_subscription_id = ?`).get(sub.id)) as
    | { id: number; kind: PartnerKey["kind"]; pid: string; status: string }
    | undefined;
  if (!row) return "ignored" as const;
  if (row.status === "canceled" || row.status === "grace_expired") return "processed" as const;
  await downgrade(row.id, { kind: row.kind, id: row.pid }, sub.id, "canceled", "Pro subscription ended");
  return "processed" as const;
}

/** invoice.paid — subscription revenue and its VAT. */
export async function recordInvoicePaid(inv: {
  id: string;
  amount_paid?: number;
  currency?: string;
  tax?: number | null;
  total_taxes?: { amount: number }[] | null;
  subscription?: string | { id: string } | null;
  parent?: { subscription_details?: { subscription?: string } };
}) {
  const subId = typeof inv.subscription === "string" ? inv.subscription : inv.subscription?.id ?? inv.parent?.subscription_details?.subscription ?? null;
  if (!subId) return "ignored" as const;
  const known = (await db.prepare(`SELECT vat_bps as vatBps FROM partner_subscriptions WHERE provider_subscription_id = ?`).get(subId)) as { vatBps: number | null } | undefined;
  if (!known) return "ignored" as const;
  const gross = Number(inv.amount_paid ?? 0);
  if (gross <= 0 || !(await ledgerEnabled())) return "processed" as const;
  // The VAT Stripe actually charged on this invoice; else the rate frozen on
  // the subscription (never today's rule — a rate change doesn't rewrite history).
  const reportedTax = typeof inv.tax === "number" ? inv.tax : Array.isArray(inv.total_taxes) ? inv.total_taxes.reduce((a, t) => a + Number(t.amount ?? 0), 0) : null;
  const net = reportedTax !== null ? gross - reportedTax : divRoundHalfUp(gross * 10_000, 10_000 + Number(known.vatBps ?? 0));
  await db.transaction((tx) =>
    postGroup(tx, {
      idempotencyKey: `invoice:${inv.id}`,
      sourceType: "subscription_invoice",
      sourceId: inv.id,
      description: `Pro subscription invoice ${inv.id}`,
      basis: "actual",
      currency: String(inv.currency ?? "eur").toUpperCase(),
      lines: [
        { account: "stripe_clearing", amountMinor: gross, memo: "subscription payment" },
        { account: "subscription_revenue", amountMinor: -net, memo: "Pro subscription" },
        { account: "subscription_vat_payable", amountMinor: -(gross - net), memo: "VAT on subscription" },
      ],
    })
  );
  return "processed" as const;
}

// --- partner actions + sweep --------------------------------------------------------------

export async function cancelPro(partner: PartnerKey, actorId: string) {
  const sub = await liveSubscription(partner);
  if (!sub?.subscriptionId) throw new SubscriptionError("You don't have an active Pro subscription", 404);
  const provider = paymentProvider();
  if (!provider) throw new SubscriptionError("Payments aren't configured on this server", 503);
  await provider.cancelSubscription({ subscriptionId: sub.subscriptionId, atPeriodEnd: true });
  await db.prepare(`UPDATE partner_subscriptions SET cancel_at_period_end = 1 WHERE id = ?`).run(sub.id);
  await writeAudit({ actorUserId: actorId, action: "subscription.cancel_requested", objectType: `partner_${partner.kind}`, objectId: partner.id });
}

export async function resumePro(partner: PartnerKey, actorId: string) {
  const sub = await liveSubscription(partner);
  if (!sub?.subscriptionId || !sub.cancelAtPeriodEnd) throw new SubscriptionError("There's no cancellation to undo", 409);
  const provider = paymentProvider();
  if (!provider) throw new SubscriptionError("Payments aren't configured on this server", 503);
  await provider.resumeSubscription(sub.subscriptionId);
  await db.prepare(`UPDATE partner_subscriptions SET cancel_at_period_end = 0 WHERE id = ?`).run(sub.id);
  await writeAudit({ actorUserId: actorId, action: "subscription.resumed", objectType: `partner_${partner.kind}`, objectId: partner.id });
}

/** Ends Pro for subscriptions still unpaid after the grace period. Safe to run repeatedly. */
export async function sweepSubscriptions(now: Date = new Date()) {
  const due = (await db
    .prepare(`SELECT id, party_type as kind, party_id as pid, provider_subscription_id as subId, grace_days as days FROM partner_subscriptions WHERE status = 'past_due' AND grace_until IS NOT NULL AND grace_until <= ?`)
    .all(now)) as { id: number; kind: PartnerKey["kind"]; pid: string; subId: string; days: number | null }[];
  const provider = paymentProvider();
  let ended = 0;
  for (const r of due) {
    try {
      if (provider) await provider.cancelSubscription({ subscriptionId: r.subId, atPeriodEnd: false });
      await downgrade(r.id, { kind: r.kind, id: r.pid }, r.subId, "grace_expired", `Payment not received within the ${r.days ?? "configured"}-day grace period`);
      ended += 1;
    } catch (e) {
      console.error(`[subscriptions] grace expiry failed for ${r.subId}:`, e);
    }
  }
  return { ended };
}

export type PlanState = "unavailable" | "free" | "processing" | "paid_active" | "cancelling" | "payment_failed" | "reward_active" | "pro_granted";

/**
 * Stage 5f — the partner's plan as one server-derived state (the UI never
 * infers it). "processing" = Stripe reports the Pro checkout complete but the
 * webhook hasn't confirmed it yet.
 */
export async function subscriptionOverview(partner: PartnerKey) {
  const [enabled, rewardsEnabled, plan, sub, price] = await Promise.all([
    commerceSwitch("commerce.pro_subscriptions"),
    commerceSwitch("commerce.circle_credits"),
    currentPlanFor(partner),
    liveSubscription(partner),
    proPrice(partner),
  ]);
  const provider = paymentProvider();
  let checkoutComplete = false;
  if (sub?.status === "checkout" && sub.checkoutSessionId && provider) checkoutComplete = (await provider.checkoutSessionStatus(sub.checkoutSessionId).catch(() => "open")) === "complete";
  const isReward = plan.planKey === "pro" && plan.source === "promotion" && String(plan.sourceRef ?? "").startsWith("reward:");
  let state: PlanState;
  if (!enabled && !rewardsEnabled) state = "unavailable";
  else if (sub?.status === "past_due") state = "payment_failed";
  else if (sub?.status === "active") state = sub.cancelAtPeriodEnd ? "cancelling" : "paid_active";
  else if (checkoutComplete) state = "processing";
  else if (isReward) state = "reward_active";
  else if (plan.planKey === "pro") state = "pro_granted";
  else state = "free";
  const graceMsLeft = sub?.graceUntil ? new Date(sub.graceUntil).getTime() - Date.now() : null;
  return {
    enabled,
    rewardsEnabled,
    state,
    testMode: !!provider?.testMode,
    plan: { planKey: plan.planKey, source: plan.source, effectiveFrom: plan.effectiveFrom, effectiveTo: plan.effectiveTo, rewardFunded: isReward },
    subscription:
      sub && sub.status !== "checkout"
        ? {
            status: sub.status,
            currentPeriodEnd: sub.currentPeriodEnd,
            cancelAtPeriodEnd: !!sub.cancelAtPeriodEnd,
            graceUntil: sub.graceUntil,
            graceDays: sub.graceDays,
            // DATETIME rounds to the second, so allow a minute before counting a part day.
            graceDaysRemaining: graceMsLeft === null ? null : Math.max(0, Math.ceil((graceMsLeft - 60_000) / 864e5)),
            billingStartsAt: sub.billingStartsAt,
          }
        : null,
    pendingCheckout: sub?.status === "checkout",
    price,
    graceDaysPolicy: await graceDays(),
    live: LIVE,
  };
}

/** Stage 5f — Stripe's billing portal (update card, invoices) for the partner's live subscription. */
export async function billingPortalLink(partner: PartnerKey, returnPath: string, actorId: string) {
  const sub = await liveSubscription(partner);
  if (!sub?.subscriptionId) throw new SubscriptionError("There's no Pro subscription to manage", 404);
  const provider = paymentProvider();
  if (!provider) throw new SubscriptionError("Payments aren't configured on this server", 503);
  const link = await provider.createBillingPortalSession({ subscriptionId: sub.subscriptionId, returnUrl: `${CLIENT_URL}${returnPath}` });
  await writeAudit({ actorUserId: actorId, action: "subscription.billing_portal_opened", objectType: `partner_${partner.kind}`, objectId: partner.id });
  return link;
}
