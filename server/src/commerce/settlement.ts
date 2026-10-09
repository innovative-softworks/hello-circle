// Revenue & Connect Stage 2d — completion, settlement runs, dispute recovery
// and fee reconciliation (brief §10, §12).
//
// Ledger flow for one partner order (all groups idempotent):
//   payment:<t>:<ref>        Dr stripe_clearing          Cr partner_payable    (pending share)
//   refund:<id>              reverses the payment proportionally; after release
//                            the partner leg moves to partner_available
//   release:<t>:<ref>        Dr partner_payable          Cr partner_available  (completion + review period)
//   settlement:<id>          Dr partner_available        Cr settlement_payable (weekly run, ≥ minimum)
//   dispute_recovery:<id>    Dr partner_available        Cr chargeback_loss    (partner-caused loss)
//
// "Transfer eligibility begins after the activity is completed and the
// configured review period has passed." Nothing here moves money: a
// settlement is an amount due; transfers/payouts are Stage 5.

import { db } from "../db/index.js";
import { irelandWallTimeToUtc } from "../irelandTime.js";
import type { CheckoutType } from "../checkoutService.js";
import { applyBps } from "./money.js";
import { postGroup, type LedgerLine } from "./ledger.js";
import { ledgerEnabled, sourceOwner } from "./payments.js";
import { resolveRule, RuleError } from "./rules.js";
import { SOURCE_TABLES } from "./engine.js";
import { paymentProvider } from "../payments/provider.js";

type Tx = Pick<typeof db, "prepare">;

const at = (d: Date) => d.toISOString().slice(0, 19).replace("T", " ");

function wall(date: string, time: string, plusMinutes: number): Date {
  const [h, m] = String(time).split(":").map(Number);
  return new Date(irelandWallTimeToUtc(date, h || 0, m || 0).getTime() + plusMinutes * 60_000);
}

/** When the service behind an order ends (Ireland wall time → UTC). Club
 * registrations are recurring memberships with no end, so they complete at
 * payment (decision B13); passes settle per redeemed session (B8, later). */
export async function serviceEnd(type: CheckoutType, ref: string, tx: Tx = db): Promise<Date | null> {
  if (type === "booking") {
    const r = (await tx.prepare(`SELECT date, time, duration FROM bookings WHERE ref = ?`).get(ref)) as { date: string; time: string; duration: number } | undefined;
    return r ? wall(r.date, r.time, Number(r.duration) * 60) : null;
  }
  if (type === "experience") {
    const r = (await tx
      .prepare(`SELECT s.date, s.time, e.duration_minutes as mins FROM experience_bookings b JOIN experience_sessions s ON s.id = b.session_id JOIN experiences e ON e.id = b.experience_id WHERE b.ref = ?`)
      .get(ref)) as { date: string; time: string; mins: number } | undefined;
    return r ? wall(r.date, r.time, Number(r.mins ?? 120)) : null;
  }
  if (type === "game") {
    const r = (await tx.prepare(`SELECT g.date, g.time, g.duration_minutes as mins FROM game_participants p JOIN games g ON g.id = p.game_id WHERE p.ref = ?`).get(ref)) as
      | { date: string; time: string; mins: number | null }
      | undefined;
    return r ? wall(r.date, r.time, Number(r.mins ?? 120)) : null;
  }
  if (type === "program") {
    const r = (await tx
      .prepare(
        `SELECT s.date, s.time, s.duration_minutes as mins FROM program_enrollments e JOIN program_sessions s ON s.program_id = e.program_id
         WHERE e.ref = ? ORDER BY s.date DESC, s.time DESC LIMIT 1`
      )
      .get(ref)) as { date: string; time: string; mins: number } | undefined;
    if (r) return wall(r.date, r.time, Number(r.mins ?? 60));
  }
  if (type === "registration" || type === "program") {
    const p = (await tx.prepare(`SELECT created_at FROM payment_records WHERE source_type = ? AND source_ref = ?`).get(type, ref)) as { created_at: Date | string } | undefined;
    return p ? new Date(p.created_at) : null;
  }
  return null;
}

/** The order's still-pending partner share (net of refunds) for its payee. */
async function pendingShare(tx: Tx, type: string, ref: string, party: { partyType: string; partyId: string }): Promise<number> {
  const { s } = (await tx
    .prepare(
      `SELECT COALESCE(SUM(e.amount_minor), 0) as s FROM ledger_entries e JOIN ledger_entry_groups g ON g.id = e.group_id
       WHERE e.account_code IN ('partner_payable', 'host_payable') AND e.party_type = ? AND e.party_id = ?
         AND (g.idempotency_key = ? OR (g.source_type = 'refund' AND g.source_id IN (SELECT CAST(id AS CHAR) FROM refunds WHERE source_type = ? AND source_ref = ?)))`
    )
    .get(party.partyType, party.partyId, `payment:${type}:${ref}`, type, ref)) as { s: number | string };
  return 0 - Number(s) || 0; // payable is a credit balance (and never -0)
}

export async function isReleased(tx: Tx, type: string, ref: string): Promise<boolean> {
  return !!(await tx.prepare(`SELECT id FROM order_completions WHERE source_type = ? AND source_ref = ?`).get(type, ref));
}

/** Releases every completed, undisputed order's pending share to the
 * partner's available balance. Idempotent (one completion per order). */
export async function releaseCompleted(now: Date = new Date(), opts: { dryRun?: boolean } = {}): Promise<{ released: { type: string; ref: string; amountMinor: number; partyType: string; partyId: string }[] }> {
  const candidates = (await db
    .prepare(
      `SELECT p.source_type as type, p.source_ref as ref FROM payment_records p
       LEFT JOIN order_completions c ON c.source_type = p.source_type AND c.source_ref = p.source_ref
       WHERE c.id IS NULL AND p.source_type != 'pass'
         AND EXISTS (SELECT 1 FROM ledger_entry_groups g WHERE g.idempotency_key = CONCAT('payment:', p.source_type, ':', p.source_ref))
         AND NOT EXISTS (SELECT 1 FROM disputes d WHERE d.source_type = p.source_type AND d.source_ref = p.source_ref AND d.status NOT IN ('won', 'lost', 'warning_closed'))`
    )
    .all()) as { type: CheckoutType; ref: string }[];
  const released: { type: string; ref: string; amountMinor: number; partyType: string; partyId: string }[] = [];
  for (const c of candidates) {
    const owner = await sourceOwner(c.type, c.ref);
    if (!owner) continue;
    const settlementRule = await resolveRule("settlement", { orgId: owner.partyType === "org" ? owner.partyId : null, hostResidentId: owner.partyType === "host" ? owner.partyId : null }, now);
    const ends = await serviceEnd(c.type, c.ref);
    if (!ends) continue;
    const eligibleAt = new Date(ends.getTime() + Number(settlementRule.values.reviewHours) * 3600_000);
    if (eligibleAt > now) continue;
    const row = (await db.prepare(`SELECT status, payment_status as ps FROM ${SOURCE_TABLES[c.type]} WHERE ref = ?`).get(c.ref)) as { status: string; ps: string } | undefined;
    if (!row) continue;
    // A cancelled order with money still held waits for its refund decision.
    if (row.status === "cancelled" && row.ps === "paid") continue;
    if (opts.dryRun) {
      released.push({ type: c.type, ref: c.ref, amountMinor: await pendingShare(db, c.type, c.ref, owner), partyType: owner.partyType, partyId: owner.partyId });
      continue;
    }
    const done = await db.transaction(async (tx) => {
      if (await isReleased(tx, c.type, c.ref)) return null;
      const amount = await pendingShare(tx, c.type, c.ref, owner);
      await tx
        .prepare(`INSERT INTO order_completions (source_type, source_ref, party_type, party_id, service_ends_at, eligible_at, released_minor) VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .run(c.type, c.ref, owner.partyType, owner.partyId, at(ends), at(eligibleAt), amount);
      if (amount !== 0) {
        await postGroup(tx, {
          idempotencyKey: `release:${c.type}:${c.ref}`,
          sourceType: c.type,
          sourceId: c.ref,
          description: `Completed — available for settlement (${c.type} ${c.ref})`,
          basis: "actual",
          currency: "EUR",
          lines: [
            { account: owner.account, amountMinor: amount, partyType: owner.partyType, partyId: owner.partyId, memo: "released from pending" },
            { account: "partner_available", amountMinor: -amount, partyType: owner.partyType, partyId: owner.partyId, memo: "available for settlement" },
          ],
        });
      }
      return amount;
    });
    if (done !== null) released.push({ type: c.type, ref: c.ref, amountMinor: done, partyType: owner.partyType, partyId: owner.partyId });
  }
  return { released };
}

/** Available balances per payee, with the unsettled release/adjustment groups behind each. */
async function availableByParty(tx: Tx) {
  const rows = (await tx
    .prepare(
      `SELECT e.party_type as partyType, e.party_id as partyId, e.group_id as groupId, g.description, SUM(e.amount_minor) as amount
       FROM ledger_entries e JOIN ledger_entry_groups g ON g.id = e.group_id
       LEFT JOIN settlement_items si ON si.ledger_group_id = e.group_id
       WHERE e.account_code = 'partner_available' AND si.id IS NULL AND g.source_type != 'settlement'
       GROUP BY e.party_type, e.party_id, e.group_id, g.description, g.created_at ORDER BY g.created_at`
    )
    .all()) as { partyType: string; partyId: string; groupId: string; description: string; amount: number | string }[];
  const map = new Map<string, { partyType: string; partyId: string; items: { groupId: string; description: string; amountMinor: number }[]; netMinor: number }>();
  for (const r of rows) {
    const k = `${r.partyType}:${r.partyId}`;
    const entry = map.get(k) ?? { partyType: r.partyType, partyId: r.partyId, items: [], netMinor: 0 };
    const owed = 0 - Number(r.amount) || 0; // credit = owed to partner
    entry.items.push({ groupId: r.groupId, description: r.description, amountMinor: owed });
    entry.netMinor += owed;
    map.set(k, entry);
  }
  return [...map.values()];
}

/** Weekly settlement run: release completed orders, then create one
 * settlement per payee whose available balance reaches the minimum payout;
 * smaller (or negative) balances carry forward untouched. */
export async function runSettlement(input: { runKey: string; dryRun: boolean; actorId: string; reason: string; now?: Date }) {
  if (!(await ledgerEnabled())) throw new RuleError("Turn on the financial ledger switch before running settlements", 409);
  if (typeof input.reason !== "string" || input.reason.trim().length < 5) throw new RuleError("A reason (at least 5 characters) is required");
  if (!/^[\w:-]{3,60}$/.test(input.runKey)) throw new RuleError("Run key: 3–60 letters, digits, - _ or :");
  const now = input.now ?? new Date();
  if (!input.dryRun) {
    const prior = await db.prepare(`SELECT id FROM settlement_runs WHERE run_key = ? AND dry_run = 0 AND status = 'completed'`).get(input.runKey);
    if (prior) throw new RuleError("This settlement run has already been completed", 409);
  }
  const runInfo = await db
    .prepare(`INSERT INTO settlement_runs (run_key, dry_run, status, started_by, reason) VALUES (?, ?, 'running', ?, ?)`)
    .run(input.runKey, input.dryRun ? 1 : 0, input.actorId, input.reason.trim());
  const runId = Number(runInfo.lastInsertRowid);
  const { released } = await releaseCompleted(now, { dryRun: input.dryRun });
  const parties = await availableByParty(db);
  // A dry run releases nothing, so add what the real run would release to
  // each payee's preview (the preview must match what the run would do).
  if (input.dryRun) {
    for (const r of released) {
      if (r.amountMinor === 0) continue;
      let p = parties.find((x) => x.partyType === r.partyType && x.partyId === r.partyId);
      if (!p) {
        p = { partyType: r.partyType, partyId: r.partyId, items: [], netMinor: 0 };
        parties.push(p);
      }
      p.items.push({ groupId: `(would release ${r.type} ${r.ref})`, description: `Completed ${r.type} ${r.ref}`, amountMinor: r.amountMinor });
      p.netMinor += r.amountMinor;
    }
  }
  const settled: { partyType: string; partyId: string; netMinor: number; settlementId: number | null }[] = [];
  const carried: { partyType: string; partyId: string; netMinor: number }[] = [];
  for (const p of parties) {
    const rule = await resolveRule("settlement", { orgId: p.partyType === "org" ? p.partyId : null, hostResidentId: p.partyType === "host" ? p.partyId : null }, now);
    if (p.netMinor < Number(rule.values.minPayoutMinor) || p.netMinor <= 0) {
      carried.push({ partyType: p.partyType, partyId: p.partyId, netMinor: p.netMinor });
      continue;
    }
    if (input.dryRun) {
      settled.push({ partyType: p.partyType, partyId: p.partyId, netMinor: p.netMinor, settlementId: null });
      continue;
    }
    const settlementId = await db.transaction(async (tx) => {
      const info = await tx
        .prepare(`INSERT INTO settlements (run_id, party_type, party_id, currency, net_minor, status) VALUES (?, ?, ?, 'EUR', ?, 'due')`)
        .run(runId, p.partyType, p.partyId, p.netMinor);
      const id = Number(info.lastInsertRowid);
      for (const item of p.items) {
        await tx.prepare(`INSERT INTO settlement_items (settlement_id, ledger_group_id, description, amount_minor) VALUES (?, ?, ?, ?)`).run(id, item.groupId, item.description.slice(0, 255), item.amountMinor);
      }
      const g = await postGroup(tx, {
        idempotencyKey: `settlement:${id}`,
        sourceType: "settlement",
        sourceId: String(id),
        description: `Settlement ${input.runKey} for ${p.partyType} ${p.partyId}`,
        basis: "actual",
        currency: "EUR",
        lines: [
          { account: "partner_available", amountMinor: p.netMinor, partyType: p.partyType, partyId: p.partyId, memo: "settled" },
          { account: "settlement_payable", amountMinor: -p.netMinor, partyType: p.partyType, partyId: p.partyId, memo: "due to partner" },
        ],
        createdBy: input.actorId,
      });
      await tx.prepare(`UPDATE settlements SET ledger_group_id = ? WHERE id = ?`).run(g.groupId, id);
      return id;
    });
    settled.push({ partyType: p.partyType, partyId: p.partyId, netMinor: p.netMinor, settlementId });
  }
  const summary = { released, settled, carried };
  await db
    .prepare(`UPDATE settlement_runs SET status = 'completed', released_count = ?, settlement_count = ?, carried_forward_count = ?, summary = ?, finished_at = NOW() WHERE id = ?`)
    .run(released.length, settled.length, carried.length, JSON.stringify(summary), runId);
  return { runId, dryRun: input.dryRun, ...summary };
}

/** Finance decides who bears a lost dispute. Partner-caused losses are
 * recovered from the partner's available balance (which may go negative and
 * is netted against future settlements); platform-caused losses are absorbed. */
export async function resolveDisputeRecovery(input: { disputeId: number; responsible: "partner" | "platform"; actorId: string; reason: string }) {
  if (typeof input.reason !== "string" || input.reason.trim().length < 5) throw new RuleError("A reason (at least 5 characters) is required");
  return db.transaction(async (tx) => {
    const d = (await tx.prepare(`SELECT * FROM disputes WHERE id = ? FOR UPDATE`).get(input.disputeId)) as Record<string, any> | undefined;
    if (!d) throw new RuleError("Dispute not found", 404);
    if (d.status !== "lost" || d.recovery_status !== "pending") throw new RuleError("Only a lost dispute awaiting a recovery decision can be resolved", 409);
    if (input.responsible === "platform") {
      await tx.prepare(`UPDATE disputes SET recovery_status = 'absorbed', responsible = 'platform' WHERE id = ?`).run(input.disputeId);
      return { recovered: 0 };
    }
    if (!d.source_type || !d.source_ref) throw new RuleError("This dispute isn't matched to an order, so it can't be recovered from a partner", 409);
    const owner = await sourceOwner(d.source_type, d.source_ref, tx);
    if (!owner) throw new RuleError("No partner found for this order", 409);
    const amount = Number(d.amount_minor);
    const lines: LedgerLine[] = [
      { account: "partner_available", amountMinor: amount, partyType: owner.partyType, partyId: owner.partyId, memo: "dispute recovered from partner" },
      { account: "chargeback_loss", amountMinor: -amount, memo: "loss recovered" },
    ];
    if (await ledgerEnabled()) {
      await postGroup(tx, { idempotencyKey: `dispute_recovery:${d.provider_dispute_id}`, sourceType: "dispute", sourceId: d.provider_dispute_id, description: `Dispute recovery ${d.provider_dispute_id}`, basis: "actual", currency: d.currency, lines, createdBy: input.actorId });
    }
    await tx.prepare(`UPDATE disputes SET recovery_status = 'recovered', responsible = 'partner' WHERE id = ?`).run(input.disputeId);
    return { recovered: amount };
  });
}

/** Posts the estimated card fee for a payment (accrual), then — when the
 * provider reports the actual fee — reverses the estimate and posts the
 * actual. Estimates and actuals stay separately reportable (basis). */
export async function reconcilePaymentFees(opts: { limit?: number } = {}): Promise<{ reconciled: number; skipped: number }> {
  if (!(await ledgerEnabled())) throw new RuleError("Turn on the financial ledger switch first", 409);
  const provider = paymentProvider();
  if (!provider) throw new RuleError("Payments aren't configured on this server", 503);
  const costs = await resolveRule("payment_costs");
  const rows = (await db
    .prepare(
      `SELECT p.id, p.source_type as type, p.source_ref as ref, p.payment_intent_id as pi, p.amount_minor as amount FROM payment_records p
       LEFT JOIN fee_reconciliations f ON f.payment_record_id = p.id WHERE f.id IS NULL AND p.payment_intent_id IS NOT NULL ORDER BY p.id LIMIT ?`
    )
    .all(opts.limit ?? 200)) as { id: number; type: string; ref: string; pi: string; amount: number | string }[];
  let reconciled = 0;
  let skipped = 0;
  for (const r of rows) {
    const actual = await provider.paymentFee(r.pi);
    if (actual === null) {
      skipped++;
      continue;
    }
    const estimate = applyBps(Number(r.amount), Number(costs.values.cardBps)) + Number(costs.values.cardFixedMinor);
    await db.transaction(async (tx) => {
      const est = await postGroup(tx, {
        idempotencyKey: `fee:estimate:${r.type}:${r.ref}`,
        sourceType: "payment_fee",
        sourceId: `${r.type}:${r.ref}`,
        description: `Estimated card fee ${r.type} ${r.ref}`,
        basis: "estimate",
        currency: "EUR",
        lines: [
          { account: "processing_fee_expense", amountMinor: estimate, memo: "estimate" },
          { account: "accrued_payment_costs", amountMinor: -estimate, memo: "estimate" },
        ],
      });
      // Actual replaces the estimate: reverse the accrual, post the real fee.
      await postGroup(tx, {
        idempotencyKey: `fee:estimate-reversal:${r.type}:${r.ref}`,
        sourceType: "payment_fee",
        sourceId: `${r.type}:${r.ref}`,
        description: `Estimate replaced by actual ${r.type} ${r.ref}`,
        basis: "estimate",
        currency: "EUR",
        reversesGroupId: est.groupId,
        lines: [
          { account: "processing_fee_expense", amountMinor: -estimate, memo: "estimate reversed" },
          { account: "accrued_payment_costs", amountMinor: estimate, memo: "estimate reversed" },
        ],
      });
      await postGroup(tx, {
        idempotencyKey: `fee:actual:${r.type}:${r.ref}`,
        sourceType: "payment_fee",
        sourceId: `${r.type}:${r.ref}`,
        description: `Actual card fee ${r.type} ${r.ref}`,
        basis: "actual",
        currency: "EUR",
        lines: [
          { account: "processing_fee_expense", amountMinor: actual, memo: "actual (provider)" },
          { account: "stripe_clearing", amountMinor: -actual, memo: "fee deducted by provider" },
        ],
      });
      await tx.prepare(`INSERT IGNORE INTO fee_reconciliations (payment_record_id, estimate_minor, actual_minor) VALUES (?, ?, ?)`).run(r.id, estimate, actual);
    });
    reconciled++;
  }
  return { reconciled, skipped };
}

/** A partner's money view (brief §26 partner reports): pending, available,
 * settled-due and recent settlements. Read from the ledger. */
export async function partnerBalances(party: { partyType: string; partyId: string }) {
  const rows = (await db
    .prepare(
      `SELECT e.account_code as account, SUM(e.amount_minor) as s FROM ledger_entries e
       WHERE e.party_type = ? AND e.party_id = ? AND e.account_code IN ('partner_payable', 'host_payable', 'partner_available', 'settlement_payable')
       GROUP BY e.account_code`
    )
    .all(party.partyType, party.partyId)) as { account: string; s: number | string }[];
  const get = (a: string) => 0 - Number(rows.find((r) => r.account === a)?.s ?? 0) || 0;
  const settlements = await db
    .prepare(`SELECT s.id, r.run_key as runKey, s.net_minor as netMinor, s.status, s.created_at as createdAt FROM settlements s JOIN settlement_runs r ON r.id = s.run_id WHERE s.party_type = ? AND s.party_id = ? ORDER BY s.id DESC LIMIT 20`)
    .all(party.partyType, party.partyId);
  return {
    pendingMinor: get("partner_payable") + get("host_payable"),
    availableMinor: get("partner_available"),
    settledDueMinor: get("settlement_payable"),
    settlements,
  };
}
