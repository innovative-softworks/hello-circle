// Revenue & Connect Stage 2c — payment records, refunds, disputes and their
// ledger postings (brief §10–§12).
//
// One function per business event, each idempotent:
//   recordPaymentConfirmed  checkout paid       → payment_records + ledger "payment:<type>:<ref>"
//   refundInApp             full/partial refund → refunds row (pending → succeeded) + proportional reversal
//   recordProviderRefunds   charge.refunded     → refunds the provider made that we didn't (delta) + reversal
//   recordDispute           charge.dispute.*    → disputes row + "opened" / "won" / "lost" groups
//
// Ledger posting runs only while the `commerce.settlement_ledger` switch is
// on; payment records, refunds and disputes are always recorded (they are
// the operational truth the ledger is later reconciled against).

import { db } from "../db/index.js";
import { issueStripeRefund, type CheckoutType } from "../checkoutService.js";
import { applyBps } from "./money.js";
import { postGroup, reverseGroup, type LedgerLine } from "./ledger.js";
import { resolveRule } from "./rules.js";
import { reverseRewardsForOrder } from "./rewards.js";
import { commerceSwitch } from "./switches.js";
import { SOURCE_TABLES, syncOrderFromSource } from "./engine.js";

type Tx = Pick<typeof db, "prepare">;

export class NeedsReviewError extends Error {}
export class RefundError extends Error {
  constructor(message: string, readonly status: number = 400) {
    super(message);
  }
}

const TOTAL_COLUMN: Record<CheckoutType, string> = {
  booking: "total_cents",
  registration: "total_cents",
  experience: "total_cents",
  program: "total_cents",
  game: "total_cents",
  pass: "purchased_cents",
};

/** Who is owed the partner share of an order, and on which payable account. */
export async function sourceOwner(type: CheckoutType, ref: string, tx: Tx = db): Promise<{ partyType: "org" | "vendor" | "host"; partyId: string; account: string } | null> {
  const sql: Record<CheckoutType, string> = {
    booking: `SELECT c.vendor_id as v, NULL as h FROM bookings x JOIN centres c ON c.id = x.centre_id WHERE x.ref = ?`,
    registration: `SELECT c.vendor_id as v, NULL as h FROM registrations x JOIN clubs c ON c.id = x.club_id WHERE x.ref = ?`,
    experience: `SELECT e.vendor_id as v, NULL as h FROM experience_bookings x JOIN experiences e ON e.id = x.experience_id WHERE x.ref = ?`,
    program: `SELECT p.vendor_id as v, NULL as h FROM program_enrollments x JOIN programs p ON p.id = x.program_id WHERE x.ref = ?`,
    game: `SELECT NULL as v, g.host_resident_id as h FROM game_participants x JOIN games g ON g.id = x.game_id WHERE x.ref = ?`,
    pass: `SELECT c.vendor_id as v, NULL as h FROM passes x JOIN clubs c ON c.id = x.listing_id WHERE x.ref = ?`,
  };
  const row = (await tx.prepare(sql[type]).get(ref)) as { v: string | null; h: string | null } | undefined;
  if (!row) return null;
  if (row.h) return { partyType: "host", partyId: row.h, account: "host_payable" };
  if (!row.v) return null;
  const org = (await tx.prepare(`SELECT org_id as orgId FROM users WHERE id = ?`).get(row.v)) as { orgId: string | null } | undefined;
  return org?.orgId ? { partyType: "org", partyId: org.orgId, account: "partner_payable" } : { partyType: "vendor", partyId: row.v, account: "partner_payable" };
}

/** Recovers the pe-1 split of a legacy total (taxable + VAT + fee) when a row
 * stored only its total, by finding the unique taxable amount that the
 * published legacy formula maps to exactly this total. Null when none fits
 * (then the payment goes to manual review instead of a guessed posting). */
export function legacyBreakdownFromTotal(totalMinor: number, vatBps: number, feeBps: number): { taxable: number; vat: number; fee: number } | null {
  const guess = Math.floor((totalMinor * 10_000) / (10_000 + vatBps + feeBps));
  for (let t = Math.max(0, guess - 3); t <= guess + 3; t++) {
    const vat = applyBps(t, vatBps);
    const fee = applyBps(t, feeBps);
    if (t + vat + fee === totalMinor) return { taxable: t, vat, fee };
  }
  return null;
}

async function paymentLines(tx: Tx, type: CheckoutType, ref: string, totalMinor: number, at: Date): Promise<LedgerLine[]> {
  const owner = await sourceOwner(type, ref, tx);
  if (!owner) throw new NeedsReviewError(`No partner found for ${type} ${ref}`);
  const party = { partyType: owner.partyType, partyId: owner.partyId };

  // Engine-priced order: the frozen snapshot is the source of truth.
  const snap = (await tx
    .prepare(
      `SELECT s.customer_paid_minor as paid, s.vat_minor as vat, s.customer_fee_minor as customerFee, s.success_fee_minor as successFee,
              s.partner_payout_minor as payout, s.partner_payment_cost_minor as partnerCost, s.deposit_minor as deposit,
              s.platform_funded_discount_minor as funded
       FROM pricing_snapshots s JOIN commerce_orders o ON o.id = s.order_id WHERE o.source_type = ? AND o.source_ref = ?`
    )
    .get(type, ref)) as Record<string, number | string> | undefined;
  if (snap) {
    const n = (k: string) => Number(snap[k]);
    if (n("paid") !== totalMinor) throw new NeedsReviewError(`Snapshot total ${n("paid")} ≠ charged ${totalMinor} for ${type} ${ref}`);
    return [
      { account: "stripe_clearing", amountMinor: n("paid"), memo: "customer payment" },
      { account: "coupon_expense", amountMinor: n("funded"), memo: "HelloCircle-funded discount" },
      { account: owner.account, amountMinor: -n("payout"), ...party, memo: "partner share" },
      { account: "platform_fee_revenue", amountMinor: -(n("customerFee") + n("successFee")), memo: "platform fees" },
      { account: "underlying_tax_payable", amountMinor: -n("vat"), memo: "VAT collected" },
      { account: "accrued_payment_costs", amountMinor: -n("partnerCost"), memo: "partner-borne payment cost" },
      { account: "refund_liability", amountMinor: -n("deposit"), memo: "refundable deposit" },
    ];
  }

  // Legacy (pe-1) row: stored breakdown where the table has one, else derived.
  const pricing = await resolveRule("pricing", {}, at);
  const vatBps = Number(pricing.values.vatBps);
  const feeBps = Number(pricing.values.customerFeeBps);
  let taxable: number;
  let vat: number;
  let fee: number;
  let deposit = 0;
  if (type === "booking" || type === "registration" || type === "experience") {
    const table = SOURCE_TABLES[type];
    const row = (await tx.prepare(`SELECT subtotal_cents as t, vat_cents as v, platform_fee_cents as f FROM ${table} WHERE ref = ?`).get(ref)) as { t: number; v: number; f: number };
    taxable = Number(row.t);
    vat = Number(row.v);
    fee = Number(row.f);
    deposit = totalMinor - taxable - vat - fee;
    if (deposit < 0) throw new NeedsReviewError(`Stored breakdown exceeds the total for ${type} ${ref}`);
  } else {
    const derived = legacyBreakdownFromTotal(totalMinor, vatBps, feeBps);
    if (!derived) throw new NeedsReviewError(`Can't derive the price breakdown of ${type} ${ref} (${totalMinor})`);
    ({ taxable, vat, fee } = derived);
  }
  const funded = (await tx
    .prepare(`SELECT COALESCE(SUM(platform_funded_minor), 0) as f FROM coupon_redemptions WHERE source_type = ? AND source_ref = ? AND status IN ('reserved', 'confirmed')`)
    .get(type, ref)) as { f: number | string };
  const platformFunded = Number(funded.f);
  return [
    { account: "stripe_clearing", amountMinor: totalMinor, memo: "customer payment" },
    { account: "coupon_expense", amountMinor: platformFunded, memo: "HelloCircle-funded discount" },
    { account: owner.account, amountMinor: -(taxable + platformFunded), ...party, memo: "partner share (legacy pricing)" },
    { account: "platform_fee_revenue", amountMinor: -fee, memo: "customer platform fee (legacy)" },
    { account: "underlying_tax_payable", amountMinor: -vat, memo: "VAT collected (legacy)" },
    { account: "refund_liability", amountMinor: -deposit, memo: "refundable deposit" },
  ];
}

export async function ledgerEnabled(): Promise<boolean> {
  return commerceSwitch("commerce.settlement_ledger");
}

/** Records a confirmed online payment (idempotent) and, with the ledger on,
 * posts it. Called from the webhook after the row is confirmed. */
export async function recordPaymentConfirmed(input: { type: CheckoutType; ref: string; checkoutSessionId: string | null; paymentIntentId: string | null; amountMinor: number; currency: string; provider: "stripe" | "stub" }): Promise<void> {
  await db.transaction(async (tx) => {
    const existing = (await tx.prepare(`SELECT id FROM payment_records WHERE source_type = ? AND source_ref = ? FOR UPDATE`).get(input.type, input.ref)) as { id: number } | undefined;
    if (existing) {
      await tx
        .prepare(`UPDATE payment_records SET payment_intent_id = COALESCE(payment_intent_id, ?), checkout_session_id = COALESCE(checkout_session_id, ?) WHERE id = ?`)
        .run(input.paymentIntentId, input.checkoutSessionId, existing.id);
    } else {
      // Stage 5c — the processing-fee estimate is fixed now, from the rule in force now, and never rewritten.
      const costs = await resolveRule("payment_costs", {}, new Date(), { tx });
      const feeEstimate = applyBps(input.amountMinor, Number(costs.values.cardBps)) + Number(costs.values.cardFixedMinor);
      await tx
        .prepare(
          `INSERT INTO payment_records (source_type, source_ref, provider, checkout_session_id, payment_intent_id, amount_minor, currency, status, fee_estimate_minor, fee_estimate_rule_hash, fee_estimated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'paid', ?, ?, NOW())`
        )
        .run(input.type, input.ref, input.provider, input.checkoutSessionId, input.paymentIntentId, input.amountMinor, input.currency.toUpperCase(), feeEstimate, costs.hash);
      if (await ledgerEnabled()) {
        await postGroup(tx, {
          idempotencyKey: `fee:estimate:${input.type}:${input.ref}`,
          sourceType: "payment_fee",
          sourceId: `${input.type}:${input.ref}`,
          description: `Estimated card fee ${input.type} ${input.ref}`,
          basis: "estimate",
          currency: input.currency.toUpperCase(),
          lines: [
            { account: "processing_fee_expense", amountMinor: feeEstimate, memo: "estimate at payment" },
            { account: "accrued_payment_costs", amountMinor: -feeEstimate, memo: "estimate at payment" },
          ],
        });
      }
    }
    if (!(await ledgerEnabled())) return;
    const lines = await paymentLines(tx, input.type, input.ref, input.amountMinor, new Date());
    await postGroup(tx, {
      idempotencyKey: `payment:${input.type}:${input.ref}`,
      sourceType: input.type,
      sourceId: input.ref,
      description: `Customer payment ${input.type} ${input.ref}`,
      basis: "actual",
      currency: input.currency.toUpperCase(),
      lines,
    });
  });
}

async function paymentGroupId(tx: Tx, type: string, ref: string): Promise<string | null> {
  const g = (await tx.prepare(`SELECT id FROM ledger_entry_groups WHERE idempotency_key = ?`).get(`payment:${type}:${ref}`)) as { id: string } | undefined;
  return g?.id ?? null;
}

/** Posts a refund as a proportional reversal of the original payment (when
 * the payment itself was posted). */
export async function postRefund(tx: Tx, type: string, ref: string, refundId: number, amountMinor: number, paidMinor: number, actor: string | null) {
  // Stage 5c — a refund after settlement reverses that order's reward points proportionally (ledger or not).
  await reverseRewardsForOrder(tx, type, ref, "refund");
  if (!(await ledgerEnabled())) return;
  const groupId = await paymentGroupId(tx, type, ref);
  if (!groupId) return; // paid before the ledger existed — reconciliation picks it up
  // After completion the partner's share has moved to "available": the
  // refund comes out of that balance (it may go negative and is netted
  // against later settlements).
  const released = !!(await tx.prepare(`SELECT id FROM order_completions WHERE source_type = ? AND source_ref = ?`).get(type, ref));
  await reverseGroup(tx, groupId, {
    accountMap: released ? { partner_payable: "partner_available", host_payable: "partner_available" } : undefined,
    idempotencyKey: `refund:${refundId}`,
    sourceType: "refund",
    sourceId: String(refundId),
    description: `Refund ${amountMinor} of ${type} ${ref}`,
    ratio: { numerator: amountMinor, denominator: paidMinor },
    createdBy: actor,
  });
}

export async function refundedSoFar(tx: Tx, type: string, ref: string): Promise<number> {
  const { s } = (await tx.prepare(`SELECT COALESCE(SUM(amount_minor), 0) as s FROM refunds WHERE source_type = ? AND source_ref = ? AND status IN ('pending', 'succeeded', 'reconciled')`).get(type, ref)) as { s: number | string };
  return Number(s);
}

/** In-app refund, full (amountMinor omitted) or partial. The source row is
 * locked for the whole operation; a pending refund row is written before the
 * provider call (so a racing charge.refunded webhook, which takes the same
 * lock, can never count it twice) and the provider call is idempotent by the
 * refund row's key. A full refund marks the row refunded. */
export async function refundInApp(input: {
  type: CheckoutType;
  ref: string;
  amountMinor?: number;
  reason: string;
  responsible: "customer" | "partner" | "platform";
  actorId: string;
}): Promise<{ refundId: number; amountMinor: number; full: boolean; reconciled: boolean }> {
  if (input.type === "pass") throw new RefundError("Pass refunds aren't supported yet", 409);
  if (typeof input.reason !== "string" || input.reason.trim().length < 5) throw new RefundError("A reason (at least 5 characters) is required");
  const table = SOURCE_TABLES[input.type];
  return db.transaction(async (tx) => {
    const row = (await tx.prepare(`SELECT payment_status as ps, stripe_session_id as sid, ${TOTAL_COLUMN[input.type]} as total FROM ${table} WHERE ref = ? FOR UPDATE`).get(input.ref)) as
      | { ps: string; sid: string | null; total: number | null }
      | undefined;
    if (!row) throw new RefundError("Not found", 404);
    if (row.ps === "refunded") throw new RefundError("This has already been fully refunded", 409);
    if (row.ps !== "paid") throw new RefundError("Only a paid order can be refunded");
    if (!row.sid) throw new RefundError("This wasn't paid online — refund the customer directly");
    const paid = Number(row.total ?? 0);
    const already = await refundedSoFar(tx, input.type, input.ref);
    const remaining = paid - already;
    const amount = input.amountMinor ?? remaining;
    if (!Number.isSafeInteger(amount) || amount < 1) throw new RefundError("Refund amount must be a whole number of cents, at least 1");
    if (amount > remaining) throw new RefundError(`Only ${remaining} cents can still be refunded`, 409);
    const full = amount === remaining;
    const payment = (await tx.prepare(`SELECT id FROM payment_records WHERE source_type = ? AND source_ref = ?`).get(input.type, input.ref)) as { id: number } | undefined;
    const key = `hc-refund-${row.sid}-${already === 0 && full ? "full" : `${already}-${amount}`}`;
    const info = await tx
      .prepare(
        `INSERT INTO refunds (source_type, source_ref, payment_record_id, idempotency_key, amount_minor, currency, kind, origin, responsible, reason, status, initiated_by)
         VALUES (?, ?, ?, ?, ?, 'EUR', ?, 'in_app', ?, ?, 'pending', ?)`
      )
      .run(input.type, input.ref, payment?.id ?? null, key, amount, full && already === 0 ? "full" : "partial", input.responsible, input.reason.trim(), input.actorId);
    const refundId = Number(info.lastInsertRowid);
    // A first full refund keeps the historical HC-QA-051 key, so a retry after
    // a lost commit can't refund twice at the provider.
    const result = await issueStripeRefund(row.sid, already === 0 && full ? {} : { amountMinor: amount, idempotencyKey: key });
    if (!result.ok) throw new RefundError(result.error, result.kind === "unsupported" ? 409 : 502);
    await tx
      .prepare(`UPDATE refunds SET status = ?, provider_refund_id = ?, origin = ? WHERE id = ?`)
      .run(result.reconciled ? "reconciled" : "succeeded", result.refundId ?? null, result.reconciled ? "provider" : "in_app", refundId);
    if (full) await tx.prepare(`UPDATE ${table} SET payment_status = 'refunded' WHERE ref = ? AND payment_status = 'paid'`).run(input.ref);
    await postRefund(tx, input.type, input.ref, refundId, amount, paid, input.actorId);
    return { refundId, amountMinor: amount, full, reconciled: result.reconciled };
  }).then(async (r) => {
    await syncOrderFromSource(input.type, input.ref);
    return r;
  });
}

/** charge.refunded: records whatever the provider refunded beyond what we
 * already know about (a Dashboard refund, or the provider side of our own).
 * Takes the same source-row lock as refundInApp, so an in-flight in-app
 * refund is counted once. */
export async function recordProviderRefunds(input: { paymentIntentId: string; chargeId: string; amountRefundedMinor: number; amountMinor: number; currency: string }): Promise<{ recordedMinor: number }> {
  const payment = (await db.prepare(`SELECT id, source_type as type, source_ref as ref, amount_minor as amount FROM payment_records WHERE payment_intent_id = ?`).get(input.paymentIntentId)) as
    | { id: number; type: CheckoutType; ref: string; amount: number }
    | undefined;
  if (!payment) throw new NeedsReviewError(`No payment record for ${input.paymentIntentId} — refund needs manual matching`);
  const table = SOURCE_TABLES[payment.type];
  const out = await db.transaction(async (tx) => {
    const row = (await tx.prepare(`SELECT payment_status as ps FROM ${table} WHERE ref = ? FOR UPDATE`).get(payment.ref)) as { ps: string } | undefined;
    if (!row) throw new NeedsReviewError(`${payment.type} ${payment.ref} no longer exists`);
    const already = await refundedSoFar(tx, payment.type, payment.ref);
    const delta = input.amountRefundedMinor - already;
    if (delta <= 0) return { recordedMinor: 0 };
    const full = input.amountRefundedMinor >= Number(payment.amount);
    const info = await tx
      .prepare(
        `INSERT INTO refunds (source_type, source_ref, payment_record_id, idempotency_key, amount_minor, currency, kind, origin, responsible, reason, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'provider', 'platform', 'Refunded at the payment provider', 'reconciled')`
      )
      .run(payment.type, payment.ref, payment.id, `provider:${input.chargeId}:${input.amountRefundedMinor}`, delta, input.currency.toUpperCase(), full && already === 0 ? "full" : "partial");
    if (full) await tx.prepare(`UPDATE ${table} SET payment_status = 'refunded' WHERE ref = ? AND payment_status = 'paid'`).run(payment.ref);
    await postRefund(tx, payment.type, payment.ref, Number(info.lastInsertRowid), delta, Number(payment.amount), null);
    return { recordedMinor: delta };
  });
  await syncOrderFromSource(payment.type, payment.ref);
  return out;
}

/** charge.dispute.created / updated / closed. Funds leave the platform when
 * a dispute opens and come back if it is won; a lost dispute is a loss to
 * recover from the responsible partner (recovery_status "pending" until the
 * settlement/transfer stages act on it). */
export async function recordDispute(input: { disputeId: string; paymentIntentId: string | null; amountMinor: number; currency: string; reason: string; status: string; evidenceDueBy: Date | null }): Promise<void> {
  const payment = input.paymentIntentId
    ? ((await db.prepare(`SELECT source_type as type, source_ref as ref FROM payment_records WHERE payment_intent_id = ?`).get(input.paymentIntentId)) as { type: string; ref: string } | undefined)
    : undefined;
  const closed = input.status === "won" || input.status === "lost";
  await db.transaction(async (tx) => {
    const existing = (await tx.prepare(`SELECT id, status FROM disputes WHERE provider_dispute_id = ? FOR UPDATE`).get(input.disputeId)) as { id: number; status: string } | undefined;
    if (existing) {
      // Never move a closed dispute back to open on an out-of-order event.
      if (existing.status !== "won" && existing.status !== "lost") {
        await tx.prepare(`UPDATE disputes SET status = ?, evidence_due_by = COALESCE(?, evidence_due_by) WHERE id = ?`).run(input.status, input.evidenceDueBy ? input.evidenceDueBy.toISOString().slice(0, 19).replace("T", " ") : null, existing.id);
      }
    } else {
      await tx
        .prepare(
          `INSERT INTO disputes (provider_dispute_id, source_type, source_ref, payment_intent_id, amount_minor, currency, reason, status, evidence_due_by, recovery_status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(input.disputeId, payment?.type ?? null, payment?.ref ?? null, input.paymentIntentId, input.amountMinor, input.currency.toUpperCase(), input.reason.slice(0, 100), input.status, input.evidenceDueBy ? input.evidenceDueBy.toISOString().slice(0, 19).replace("T", " ") : null, payment ? "not_started" : "unmatched");
    }
    if (closed) await tx.prepare(`UPDATE disputes SET recovery_status = ? WHERE provider_dispute_id = ? AND recovery_status IN ('not_started', 'unmatched')`).run(input.status === "lost" ? "pending" : "not_applicable", input.disputeId);
    // Stage 5c — a lost dispute reverses the order's reward points proportionally (no-op if none were awarded).
    if (input.status === "lost" && payment) await reverseRewardsForOrder(tx, payment.type, payment.ref, "dispute_lost");
    if (!(await ledgerEnabled())) return;
    const currency = input.currency.toUpperCase();
    const base = { sourceType: "dispute", sourceId: input.disputeId, basis: "actual" as const, currency };
    await postGroup(tx, { ...base, idempotencyKey: `dispute:${input.disputeId}:opened`, description: `Dispute opened ${input.disputeId}`, lines: [
      { account: "dispute_reserve", amountMinor: input.amountMinor, memo: "funds withdrawn for dispute" },
      { account: "stripe_clearing", amountMinor: -input.amountMinor, memo: "dispute debit" },
    ] });
    if (input.status === "won") {
      await postGroup(tx, { ...base, idempotencyKey: `dispute:${input.disputeId}:won`, description: `Dispute won ${input.disputeId}`, lines: [
        { account: "stripe_clearing", amountMinor: input.amountMinor, memo: "dispute funds returned" },
        { account: "dispute_reserve", amountMinor: -input.amountMinor, memo: "dispute closed (won)" },
      ] });
    } else if (input.status === "lost") {
      await postGroup(tx, { ...base, idempotencyKey: `dispute:${input.disputeId}:lost`, description: `Dispute lost ${input.disputeId}`, lines: [
        { account: "chargeback_loss", amountMinor: input.amountMinor, memo: "dispute lost" },
        { account: "dispute_reserve", amountMinor: -input.amountMinor, memo: "dispute closed (lost)" },
      ] });
    }
  });
}
