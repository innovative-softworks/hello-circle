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

export const GRACE_DAYS = 7;
const LIVE = ["checkout", "active", "past_due"];

const ctxOf = (partner?: PartnerKey) => ({ orgId: partner?.kind === "org" ? partner.id : null, hostResidentId: partner?.kind === "host" ? partner.id : null });

/** The Pro price for this partner: net (ex-VAT) from plan_pro, VAT from the partner's tax_vat rule. */
export async function proPrice(partner?: PartnerKey, at: Date = new Date()) {
  const [plan, tax] = await Promise.all([resolveRule("plan_pro", ctxOf(partner), at), resolveRule("tax_vat", ctxOf(partner), at)]);
  const netMinor = Number(plan.values.subscriptionMonthlyMinor);
  const vatMode = String(tax.values.vatMode ?? "standard");
  const vatBps = vatMode === "standard" ? Number(tax.values.vatBps) : 0;
  const vatMinor = applyBps(netMinor, vatBps);
  return { netMinor, vatMinor, grossMinor: netMinor + vatMinor, vatBps, vatMode, planRuleHash: plan.hash, taxRuleHash: tax.hash };
}

const SUB_FIELDS = `id, party_type as partyType, party_id as partyId, provider_subscription_id as subscriptionId, status, gross_minor as grossMinor,
  current_period_end as currentPeriodEnd, cancel_at_period_end as cancelAtPeriodEnd, grace_until as graceUntil, created_at as createdAt`;

export async function liveSubscription(partner: PartnerKey) {
  return db
    .prepare(`SELECT ${SUB_FIELDS} FROM partner_subscriptions WHERE party_type = ? AND party_id = ? AND status IN ('checkout','active','past_due') ORDER BY id DESC LIMIT 1`)
    .get(partner.kind, partner.id) as Promise<
    { id: number; partyType: string; partyId: string; subscriptionId: string | null; status: string; grossMinor: number; currentPeriodEnd: string | null; cancelAtPeriodEnd: number; graceUntil: string | null; createdAt: string } | undefined
  >;
}

export async function startProCheckout(partner: PartnerKey, input: { email: string; actorId: string; returnPath: string }) {
  if (!(await commerceSwitch("commerce.pro_subscriptions"))) throw new SubscriptionError("Pro subscriptions aren't available yet", 409);
  const provider = paymentProvider();
  if (!provider) throw new SubscriptionError("Payments aren't configured on this server", 503);
  const existing = await liveSubscription(partner);
  if (existing && existing.status !== "checkout") throw new SubscriptionError("You already have a Pro subscription", 409);
  const price = await proPrice(partner);
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
  });
  // An abandoned earlier checkout is superseded by this one.
  await db.prepare(`UPDATE partner_subscriptions SET status = 'abandoned' WHERE party_type = ? AND party_id = ? AND status = 'checkout'`).run(partner.kind, partner.id);
  await db
    .prepare(
      `INSERT INTO partner_subscriptions (party_type, party_id, checkout_session_id, status, gross_minor, net_minor, vat_minor, vat_bps, vat_mode, plan_rule_hash, tax_rule_hash, created_by)
       VALUES (?, ?, ?, 'checkout', ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(partner.kind, partner.id, session.id, price.grossMinor, price.netMinor, price.vatMinor, price.vatBps, price.vatMode, price.planRuleHash, price.taxRuleHash, input.actorId);
  return { id: session.id, url: session.url };
}

// --- webhook handlers --------------------------------------------------------------------

/** checkout.session.completed for a subscription checkout. */
export async function applySubscriptionCheckout(session: { id: string; subscription?: string | { id: string } | null; payment_status?: string; metadata?: Record<string, string> | null }) {
  const subId = typeof session.subscription === "string" ? session.subscription : session.subscription?.id ?? null;
  if (!subId || session.payment_status !== "paid") return "ignored" as const;
  const row = (await db.prepare(`SELECT id, party_type as kind, party_id as pid, status FROM partner_subscriptions WHERE checkout_session_id = ?`).get(session.id)) as
    | { id: number; kind: PartnerKey["kind"]; pid: string; status: string }
    | undefined;
  if (!row) return "ignored" as const;
  if (row.status === "active" || row.status === "past_due") return "processed" as const; // replay
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
  const grace = status === "past_due" ? row.grace ?? new Date(Date.now() + GRACE_DAYS * 864e5) : null;
  await db
    .prepare(`UPDATE partner_subscriptions SET status = ?, current_period_end = COALESCE(?, current_period_end), cancel_at_period_end = ?, grace_until = ? WHERE id = ?`)
    .run(status, periodEndSec ? new Date(periodEndSec * 1000) : null, sub.cancel_at_period_end ? 1 : 0, grace, row.id);
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
    .prepare(`SELECT id, party_type as kind, party_id as pid, provider_subscription_id as subId FROM partner_subscriptions WHERE status = 'past_due' AND grace_until IS NOT NULL AND grace_until <= ?`)
    .all(now)) as { id: number; kind: PartnerKey["kind"]; pid: string; subId: string }[];
  const provider = paymentProvider();
  let ended = 0;
  for (const r of due) {
    try {
      if (provider) await provider.cancelSubscription({ subscriptionId: r.subId, atPeriodEnd: false });
      await downgrade(r.id, { kind: r.kind, id: r.pid }, r.subId, "grace_expired", `Payment not received within ${GRACE_DAYS} days`);
      ended += 1;
    } catch (e) {
      console.error(`[subscriptions] grace expiry failed for ${r.subId}:`, e);
    }
  }
  return { ended };
}

export async function subscriptionOverview(partner: PartnerKey) {
  const [enabled, plan, sub, price] = await Promise.all([commerceSwitch("commerce.pro_subscriptions"), currentPlanFor(partner), liveSubscription(partner), proPrice(partner)]);
  return {
    enabled,
    plan: { planKey: plan.planKey, source: plan.source, effectiveTo: plan.effectiveTo },
    subscription: sub && sub.status !== "checkout" ? { status: sub.status, currentPeriodEnd: sub.currentPeriodEnd, cancelAtPeriodEnd: !!sub.cancelAtPeriodEnd, graceUntil: sub.graceUntil } : null,
    price,
    live: LIVE,
  };
}
