import { proPurchaseAllowed } from "./releaseGates.js";
import { writeAudit } from "../audit.js";
import { db } from "../db/index.js";
import { allocationPartners, isSplitOrder } from "./allocations.js";
import { allocate } from "./money.js";
import { assignPlan, currentPlanFor, type PartnerKey } from "./plans.js";
import { resolveRule } from "./rules.js";
import { commerceSwitch } from "./switches.js";

// Revenue & Connect Stage 5b/5c — partner reward points ("Circle Credits").
//
// Earned when a settlement is created, per order, on the settled GMV (what
// the customer paid less refunds so far) at the published pointsPerEuro; the
// settlement's points form one lot that expires after expiryMonths. Each
// order's award is recorded (reward_awards) so that a refund or lost dispute
// *after* settlement reverses that order's points proportionally:
//
//   reversed = floor(points × min(gmv, refunds since award + lost disputes) / gmv)
//
// Reversed points come out of the order's own lot first (if unexpired), then
// other unexpired lots oldest-first; anything already spent becomes a points
// debt. While a debt is open, redemption is refused, and new awards repay it
// before adding spendable points. Points have no cash value.

type Tx = Pick<typeof db, "prepare">;

export class RewardError extends Error {
  constructor(message: string, readonly status: number = 400) {
    super(message);
  }
}

function addMonths(d: Date, months: number): Date {
  const out = new Date(d);
  out.setUTCMonth(out.getUTCMonth() + months);
  return out;
}

const ctxOf = (kind: string, id: string) => ({ orgId: kind === "org" ? id : null, hostResidentId: kind === "host" ? id : null });

async function refundedFor(tx: Tx, type: string, ref: string): Promise<number> {
  const r = (await tx.prepare(`SELECT COALESCE(SUM(amount_minor), 0) as s FROM refunds WHERE source_type = ? AND source_ref = ? AND status IN ('pending', 'succeeded', 'reconciled')`).get(type, ref)) as { s: number | string };
  return Number(r.s);
}

async function lockDebt(tx: Tx, kind: string, id: string): Promise<number> {
  await tx.prepare(`INSERT IGNORE INTO reward_debts (party_type, party_id, points_owed) VALUES (?, ?, 0)`).run(kind, id);
  const r = (await tx.prepare(`SELECT points_owed as p FROM reward_debts WHERE party_type = ? AND party_id = ? FOR UPDATE`).get(kind, id)) as { p: number };
  return Number(r.p);
}

/** Awards points for one settlement (idempotent per settlement and per order). */
export async function awardForSettlement(settlementId: number): Promise<number> {
  if (!(await commerceSwitch("commerce.circle_credits"))) return 0;
  const s = (await db.prepare(`SELECT party_type as kind, party_id as pid FROM settlements WHERE id = ?`).get(settlementId)) as { kind: string; pid: string } | undefined;
  if (!s || s.kind === "vendor") return 0;
  const rule = await resolveRule("rewards", ctxOf(s.kind, s.pid));
  const perEuro = Number(rule.values.pointsPerEuro);
  const splitRule = await resolveRule("split_rewards");
  // The orders released into this settlement: release:<type>:<ref> groups.
  const items = (await db
    .prepare(`SELECT g.idempotency_key as k FROM settlement_items i JOIN ledger_entry_groups g ON g.id = i.ledger_group_id WHERE i.settlement_id = ? AND g.idempotency_key LIKE 'release:%'`)
    .all(settlementId)) as { k: string }[];
  return db.transaction(async (tx) => {
    if (await tx.prepare(`SELECT id FROM reward_awards WHERE settlement_id = ? LIMIT 1`).get(settlementId)) return 0;
    const orders: { type: string; ref: string; gmv: number; refunded: number; points: number }[] = [];
    const splitParts: { type: string; ref: string }[] = [];
    for (const { k } of items) {
      const [, type, ref] = k.split(":");
      if (await tx.prepare(`SELECT id FROM reward_awards WHERE source_type = ? AND source_ref = ?`).get(type, ref)) continue;
      // Stage 5e — a venue/host split booking: each partner earns on its own
      // eligible allocation (rule split_rewards), recorded per partner below.
      if (await isSplitOrder(tx, type, ref)) {
        const [, , , pt, pid] = k.split(":");
        if (pt === s.kind && pid === s.pid) splitParts.push({ type, ref });
        continue;
      }
      const paid = (await tx.prepare(`SELECT amount_minor as a FROM payment_records WHERE source_type = ? AND source_ref = ?`).get(type, ref)) as { a: number | string } | undefined;
      if (!paid) continue;
      const refunded = await refundedFor(tx, type, ref);
      const gmv = Math.max(0, Number(paid.a) - refunded);
      orders.push({ type, ref, gmv, refunded, points: Math.floor((gmv * perEuro) / 100) });
    }
    const splitAwards: { type: string; ref: string; eligible: number; points: number }[] = [];
    for (const sp of splitParts) {
      if (await tx.prepare(`SELECT id FROM reward_split_awards WHERE source_type = ? AND source_ref = ? AND party_type = ? AND party_id = ?`).get(sp.type, sp.ref, s.kind, s.pid)) continue;
      const t = (await splitTargets(tx, sp.type, sp.ref, perEuro))?.find((x) => x.partyType === s.kind && x.partyId === s.pid);
      if (t) splitAwards.push({ type: sp.type, ref: sp.ref, eligible: t.eligibleMinor, points: t.points });
    }
    const total = orders.reduce((a, o) => a + o.points, 0) + splitAwards.reduce((a, o) => a + o.points, 0);
    if (total <= 0) {
      // Still record zero-point split awards so a later reversal has nothing to undo twice.
      for (const sa of splitAwards) {
        await tx.prepare(`INSERT IGNORE INTO reward_split_awards (settlement_id, party_type, party_id, source_type, source_ref, eligible_minor, points, lot_id, rule_hash, rate_per_euro, rewards_rule_hash) VALUES (?, ?, ?, ?, ?, ?, 0, NULL, ?, ?, ?)`).run(settlementId, s.kind, s.pid, sa.type, sa.ref, sa.eligible, splitRule.hash, perEuro, rule.hash);
      }
      return 0;
    }
    // Repay any points debt first.
    const debt = await lockDebt(tx, s.kind, s.pid);
    const repay = Math.min(debt, total);
    if (repay > 0) {
      await tx.prepare(`UPDATE reward_debts SET points_owed = points_owed - ? WHERE party_type = ? AND party_id = ?`).run(repay, s.kind, s.pid);
      // Stage 5f — recorded so the partner's history shows the repayment.
      await tx.prepare(`INSERT INTO reward_debt_repayments (party_type, party_id, settlement_id, points) VALUES (?, ?, ?, ?)`).run(s.kind, s.pid, settlementId, repay);
    }
    const spendable = total - repay;
    const lot = await tx
      .prepare(`INSERT INTO reward_lots (party_type, party_id, source_ref, points_earned, points_remaining, expires_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(s.kind, s.pid, `settlement:${settlementId}`, total, spendable, addMonths(new Date(), Number(rule.values.expiryMonths)));
    const lotId = Number(lot.lastInsertRowid);
    for (const o of orders) {
      await tx
        .prepare(`INSERT INTO reward_awards (settlement_id, party_type, party_id, source_type, source_ref, gmv_minor, refunded_at_award_minor, points, lot_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(settlementId, s.kind, s.pid, o.type, o.ref, o.gmv, o.refunded, o.points, lotId);
    }
    for (const sa of splitAwards) {
      await tx
        .prepare(`INSERT INTO reward_split_awards (settlement_id, party_type, party_id, source_type, source_ref, eligible_minor, points, lot_id, rule_hash, rate_per_euro, rewards_rule_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(settlementId, s.kind, s.pid, sa.type, sa.ref, sa.eligible, sa.points, lotId, splitRule.hash, perEuro, rule.hash);
    }
    return total;
  });
}

/** Re-derives how many of an order's points should be reversed (refunds
 * since the award + lost disputes) and reverses the difference. Safe to call
 * after every refund / dispute change; a no-op for orders never awarded. */
/** Takes points back from a partner: their own lots (the awarding lot first),
 * then a points debt for the rest. */
async function deductPoints(tx: Tx, kind: string, pid: string, lotId: number | null, delta: number): Promise<{ fromLots: number; toDebt: number }> {
  let need = delta;
  const lots = (await tx
    .prepare(
      `SELECT id, points_remaining as r FROM reward_lots WHERE party_type = ? AND party_id = ? AND expires_at > ? AND points_remaining > 0
       ORDER BY (id = ?) DESC, expires_at, id FOR UPDATE`
    )
    .all(kind, pid, new Date(), lotId ?? 0)) as { id: number; r: number }[];
  for (const l of lots) {
    if (need <= 0) break;
    const take = Math.min(Number(l.r), need);
    await tx.prepare(`UPDATE reward_lots SET points_remaining = points_remaining - ? WHERE id = ?`).run(take, l.id);
    need -= take;
  }
  if (need > 0) {
    await lockDebt(tx, kind, pid);
    await tx.prepare(`UPDATE reward_debts SET points_owed = points_owed + ? WHERE party_type = ? AND party_id = ?`).run(need, kind, pid);
  }
  return { fromLots: delta - need, toDebt: need };
}

/**
 * Stage 5e — the points each partner of a venue/host split booking should hold
 * now (rule split_rewards). Eligible = the partner's own frozen allocation
 * minus its share of HelloCircle-funded discounts and customer credits, minus
 * what refunds took from it (from the ledger), minus its share of lost
 * disputes. VAT, HelloCircle fees and Stripe fees are never in a partner
 * allocation. The booking's points = ⌊Σ eligible × rate / 100⌋, divided by
 * largest remainder — so the partners together never exceed the booking.
 */
export async function splitTargets(tx: Tx, type: string, ref: string, perEuro: number): Promise<{ partyType: string; partyId: string; eligibleMinor: number; points: number }[] | null> {
  const partners = (await allocationPartners(tx, type, ref)).filter((p) => p.role === "venue" || p.role === "host");
  if (partners.length < 2) return null;
  const snap = (await tx.prepare(`SELECT gross_minor as g, platform_funded_discount_minor as f, credits_used_minor as c FROM allocation_snapshots WHERE source_type = ? AND source_ref = ?`).get(type, ref)) as
    | { g: number | string; f: number | string; c: number | string }
    | undefined;
  if (!snap) return null;
  const allocs = partners.map((p) => Math.max(0, p.amountMinor));
  const allocSum = allocs.reduce((a, b) => a + b, 0);
  if (allocSum === 0) return partners.map((p) => ({ partyType: p.partyType, partyId: p.partyId, eligibleMinor: 0, points: 0 }));
  const funded = allocate(Math.min(allocSum, Number(snap.f) + Number(snap.c)), allocs);
  const gross = Number(snap.g);
  const lost = Number(((await tx.prepare(`SELECT COALESCE(SUM(amount_minor), 0) as s FROM disputes WHERE source_type = ? AND source_ref = ? AND status = 'lost'`).get(type, ref)) as { s: number | string }).s);
  const disputed = lost > 0 && gross > 0 ? allocate(Math.min(lost, gross), [...allocs, Math.max(0, gross - allocSum)]).slice(0, allocs.length) : allocs.map(() => 0);
  const eligible: number[] = [];
  for (let i = 0; i < partners.length; i++) {
    const p = partners[i];
    const r = (await tx
      .prepare(
        `SELECT COALESCE(SUM(e.amount_minor), 0) as s FROM ledger_entries e JOIN ledger_entry_groups g ON g.id = e.group_id
         WHERE g.source_type = 'refund' AND g.source_id IN (SELECT CAST(id AS CHAR) FROM refunds WHERE source_type = ? AND source_ref = ?)
           AND e.party_type = ? AND e.party_id = ? AND e.account_code IN ('partner_payable', 'host_payable', 'partner_available')`
      )
      .get(type, ref, p.partyType, p.partyId)) as { s: number | string };
    eligible.push(Math.max(0, allocs[i] - funded[i] - Math.max(0, Number(r.s)) - disputed[i]));
  }
  const totalEligible = eligible.reduce((a, b) => a + b, 0);
  const totalPoints = Math.floor((totalEligible * perEuro) / 100);
  const pts = totalEligible > 0 && totalPoints > 0 ? allocate(totalPoints, eligible) : eligible.map(() => 0);
  return partners.map((p, i) => ({ partyType: p.partyType, partyId: p.partyId, eligibleMinor: eligible[i], points: pts[i] }));
}

/** Stage 5e — re-derives each split partner's points and reverses only the excess, per partner. */
async function reverseSplitRewards(tx: Tx, type: string, ref: string, reason: "refund" | "dispute_lost"): Promise<number> {
  const awards = (await tx
    .prepare(`SELECT id, party_type as kind, party_id as pid, points, reversed_points as reversed, lot_id as lotId, rate_per_euro as rate FROM reward_split_awards WHERE source_type = ? AND source_ref = ? FOR UPDATE`)
    .all(type, ref)) as { id: number; kind: string; pid: string; points: number; reversed: number; lotId: number | null; rate: number | null }[];
  if (!awards.length) return 0;
  // Stage 5f — the rate frozen when the points were awarded; never today's rule.
  const frozen = awards.find((a) => a.rate !== null)?.rate;
  const rate = frozen !== undefined && frozen !== null ? Number(frozen) : Number((await resolveRule("rewards", {}, new Date(), { tx })).values.pointsPerEuro);
  const targets = (await splitTargets(tx, type, ref, rate)) ?? [];
  let total = 0;
  for (const a of awards) {
    const target = targets.find((t) => t.partyType === a.kind && t.partyId === a.pid)?.points ?? 0;
    const shouldBeReversed = Math.max(0, Number(a.points) - target);
    const delta = shouldBeReversed - Number(a.reversed);
    if (delta <= 0) continue;
    const d = await deductPoints(tx, a.kind, a.pid, a.lotId, delta);
    await tx.prepare(`UPDATE reward_split_awards SET reversed_points = ? WHERE id = ?`).run(shouldBeReversed, a.id);
    await tx.prepare(`INSERT INTO reward_split_reversals (split_award_id, points, from_lots, to_debt, reason) VALUES (?, ?, ?, ?, ?)`).run(a.id, delta, d.fromLots, d.toDebt, reason);
    total += delta;
  }
  return total;
}

export async function reverseRewardsForOrder(tx: Tx, type: string, ref: string, reason: "refund" | "dispute_lost"): Promise<number> {
  if (await isSplitOrder(tx, type, ref)) return reverseSplitRewards(tx, type, ref, reason);
  const award = (await tx
    .prepare(`SELECT id, party_type as kind, party_id as pid, gmv_minor as gmv, refunded_at_award_minor as refundedAtAward, points, reversed_points as reversed, lot_id as lotId FROM reward_awards WHERE source_type = ? AND source_ref = ? FOR UPDATE`)
    .get(type, ref)) as { id: number; kind: string; pid: string; gmv: number | string; refundedAtAward: number | string; points: number; reversed: number; lotId: number | null } | undefined;
  if (!award || Number(award.gmv) <= 0 || award.points <= 0) return 0;
  const lost = (await tx.prepare(`SELECT COALESCE(SUM(amount_minor), 0) as s FROM disputes WHERE source_type = ? AND source_ref = ? AND status = 'lost'`).get(type, ref)) as { s: number | string };
  const loss = Math.min(Number(award.gmv), Math.max(0, (await refundedFor(tx, type, ref)) - Number(award.refundedAtAward)) + Number(lost.s));
  const target = Math.floor((award.points * loss) / Number(award.gmv));
  const delta = target - award.reversed;
  if (delta <= 0) return 0;

  const d = await deductPoints(tx, award.kind, award.pid, award.lotId, delta);
  await tx.prepare(`UPDATE reward_awards SET reversed_points = ? WHERE id = ?`).run(target, award.id);
  await tx.prepare(`INSERT INTO reward_reversals (award_id, points, from_lots, to_debt, reason) VALUES (?, ?, ?, ?, ?)`).run(award.id, delta, d.fromLots, d.toDebt, reason);
  return delta;
}

export async function rewardBalance(partner: PartnerKey, at: Date = new Date()) {
  const row = (await db
    .prepare(`SELECT COALESCE(SUM(points_remaining), 0) as p, MIN(CASE WHEN points_remaining > 0 THEN expires_at END) as nextExpiry FROM reward_lots WHERE party_type = ? AND party_id = ? AND expires_at > ?`)
    .get(partner.kind, partner.id, at)) as { p: number | string; nextExpiry: string | null };
  const debt = (await db.prepare(`SELECT points_owed as p FROM reward_debts WHERE party_type = ? AND party_id = ?`).get(partner.kind, partner.id)) as { p: number } | undefined;
  const rule = await resolveRule("rewards", ctxOf(partner.kind, partner.id), at);
  const available = Number(row.p);
  const owed = Number(debt?.p ?? 0);
  return {
    /** Spendable points minus any points debt (negative while a debt exceeds the balance). */
    points: available - owed,
    availablePoints: available,
    debtPoints: owed,
    nextExpiry: row.nextExpiry,
    redemptionPoints: Number(rule.values.redemptionPoints),
    pointsPerEuro: Number(rule.values.pointsPerEuro),
  };
}

/** Spends the published number of points (oldest first) on one month of Pro. */
export async function redeemForProMonth(partner: PartnerKey, actorId: string) {
  if (!(await commerceSwitch("commerce.circle_credits"))) throw new RewardError("Reward points aren't available yet", 409);
  // Commercial release gate — a redemption activates Pro, so it waits for the fee model too.
  if (!proPurchaseAllowed()) throw new RewardError("Reward points aren't available yet", 409);
  const sub = await db.prepare(`SELECT id FROM partner_subscriptions WHERE party_type = ? AND party_id = ? AND status IN ('active','past_due') LIMIT 1`).get(partner.kind, partner.id);
  if (sub) throw new RewardError("You're subscribed to Pro already — points can be redeemed when you're not on a paid subscription", 409);
  const { redemptionPoints } = await rewardBalance(partner);
  const result = await db.transaction(async (tx) => {
    const debt = await lockDebt(tx, partner.kind, partner.id);
    if (debt > 0) throw new RewardError(`${debt.toLocaleString("en-IE")} points are owed from refunded or disputed bookings — they're repaid from your next points before you can redeem`, 409);
    const now = new Date();
    const lots = (await tx
      .prepare(`SELECT id, points_remaining as r FROM reward_lots WHERE party_type = ? AND party_id = ? AND expires_at > ? AND points_remaining > 0 ORDER BY expires_at, id FOR UPDATE`)
      .all(partner.kind, partner.id, now)) as { id: number; r: number }[];
    const total = lots.reduce((a, l) => a + Number(l.r), 0);
    if (total < redemptionPoints) throw new RewardError(`You need ${redemptionPoints.toLocaleString("en-IE")} points (you have ${total.toLocaleString("en-IE")})`, 409);
    // Start after any Pro already running (a promotion), so nothing is lost.
    const cur = await currentPlanFor(partner, now, tx);
    if (cur.planKey === "pro" && !cur.effectiveTo) throw new RewardError("You're on Pro already with no end date", 409);
    const from = cur.planKey === "pro" && cur.effectiveTo ? new Date(cur.effectiveTo) : now;
    let need = redemptionPoints;
    for (const l of lots) {
      if (need <= 0) break;
      const take = Math.min(Number(l.r), need);
      await tx.prepare(`UPDATE reward_lots SET points_remaining = points_remaining - ? WHERE id = ?`).run(take, l.id);
      need -= take;
    }
    const red = await tx.prepare(`INSERT INTO reward_redemptions (party_type, party_id, points, created_by) VALUES (?, ?, ?, ?)`).run(partner.kind, partner.id, redemptionPoints, actorId);
    const redemptionId = Number(red.lastInsertRowid);
    const assignmentId = await assignPlan({ partner, planKey: "pro", source: "promotion", sourceRef: `reward:${redemptionId}`, effectiveFrom: from, effectiveTo: addMonths(from, 1), reason: "Reward points redeemed for one month of Pro", actorId }, tx);
    await tx.prepare(`UPDATE reward_redemptions SET plan_assignment_id = ? WHERE id = ?`).run(assignmentId, redemptionId);
    return { redemptionId, proFrom: from.toISOString(), proUntil: addMonths(from, 1).toISOString() };
  });
  await writeAudit({ actorUserId: actorId, action: "rewards.redeemed", objectType: `partner_${partner.kind}`, objectId: partner.id, newValue: result });
  return result;
}

// --- Stage 5f: summary, history, adjustments ---------------------------------------------

/** Points the partner should receive at settlement for bookings paid but not yet settled
 * (an estimate with the same per-booking rules; final points are fixed at settlement). */
async function pendingPoints(partner: PartnerKey, perEuro: number): Promise<number> {
  if (partner.kind === "vendor" || perEuro <= 0) return 0;
  const orders = (await db
    .prepare(
      `SELECT DISTINCT g.source_type as t, g.source_id as ref FROM ledger_entries e JOIN ledger_entry_groups g ON g.id = e.group_id
       WHERE e.party_type = ? AND e.party_id = ? AND e.account_code IN ('partner_payable', 'host_payable') AND g.idempotency_key LIKE 'payment:%'
       ORDER BY g.source_id DESC LIMIT 300`
    )
    .all(partner.kind, partner.id)) as { t: string; ref: string }[];
  let total = 0;
  for (const o of orders) {
    if (await isSplitOrder(db, o.t, o.ref)) {
      if (await db.prepare(`SELECT id FROM reward_split_awards WHERE source_type = ? AND source_ref = ? AND party_type = ? AND party_id = ?`).get(o.t, o.ref, partner.kind, partner.id)) continue;
      total += (await splitTargets(db, o.t, o.ref, perEuro))?.find((x) => x.partyType === partner.kind && x.partyId === partner.id)?.points ?? 0;
      continue;
    }
    if (await db.prepare(`SELECT id FROM reward_awards WHERE source_type = ? AND source_ref = ?`).get(o.t, o.ref)) continue;
    const paid = (await db.prepare(`SELECT amount_minor as a FROM payment_records WHERE source_type = ? AND source_ref = ?`).get(o.t, o.ref)) as { a: number | string } | undefined;
    if (!paid) continue;
    const lost = (await db.prepare(`SELECT COALESCE(SUM(amount_minor), 0) as s FROM disputes WHERE source_type = ? AND source_ref = ? AND status = 'lost'`).get(o.t, o.ref)) as { s: number | string };
    const gmv = Math.max(0, Number(paid.a) - (await refundedFor(db, o.t, o.ref)) - Number(lost.s));
    total += Math.floor((gmv * perEuro) / 100);
  }
  return total;
}

export type RewardHistoryKind = "earned" | "venue_share" | "host_share" | "refund_reversal" | "dispute_reversal" | "debt_repayment" | "redemption" | "adjustment";
export interface RewardHistoryEntry {
  id: string;
  kind: RewardHistoryKind;
  points: number;
  at: string;
  sourceType: string | null;
  sourceRef: string | null;
  note: string | null;
}

/** The partner's full points history, newest first. */
export async function rewardHistory(partner: PartnerKey, opts: { limit?: number; before?: string | null; beforeId?: string | null } = {}): Promise<RewardHistoryEntry[]> {
  const k = partner.kind;
  const id = partner.id;
  const iso = (d: unknown) => new Date(d as string).toISOString();
  const out: RewardHistoryEntry[] = [];
  for (const r of (await db.prepare(`SELECT id, source_type as t, source_ref as ref, points, created_at as at FROM reward_awards WHERE party_type = ? AND party_id = ?`).all(k, id)) as any[]) {
    out.push({ id: `a${r.id}`, kind: "earned", points: Number(r.points), at: iso(r.at), sourceType: r.t, sourceRef: r.ref, note: null });
  }
  for (const r of (await db.prepare(`SELECT id, source_type as t, source_ref as ref, points, eligible_minor as e, created_at as at FROM reward_split_awards WHERE party_type = ? AND party_id = ?`).all(k, id)) as any[]) {
    out.push({ id: `s${r.id}`, kind: k === "host" ? "host_share" : "venue_share", points: Number(r.points), at: iso(r.at), sourceType: r.t, sourceRef: r.ref, note: `on your share of €${(Number(r.e) / 100).toFixed(2)}` });
  }
  for (const r of (await db
    .prepare(`SELECT r.id, r.points, r.reason, r.to_debt as td, r.created_at as at, a.source_type as t, a.source_ref as ref FROM reward_reversals r JOIN reward_awards a ON a.id = r.award_id WHERE a.party_type = ? AND a.party_id = ?`)
    .all(k, id)) as any[]) {
    out.push({ id: `r${r.id}`, kind: r.reason === "dispute_lost" ? "dispute_reversal" : "refund_reversal", points: -Number(r.points), at: iso(r.at), sourceType: r.t, sourceRef: r.ref, note: Number(r.td) > 0 ? `${r.td} added to points debt` : null });
  }
  for (const r of (await db
    .prepare(`SELECT r.id, r.points, r.reason, r.to_debt as td, r.created_at as at, a.source_type as t, a.source_ref as ref FROM reward_split_reversals r JOIN reward_split_awards a ON a.id = r.split_award_id WHERE a.party_type = ? AND a.party_id = ?`)
    .all(k, id)) as any[]) {
    out.push({ id: `x${r.id}`, kind: r.reason === "dispute_lost" ? "dispute_reversal" : "refund_reversal", points: -Number(r.points), at: iso(r.at), sourceType: r.t, sourceRef: r.ref, note: Number(r.td) > 0 ? `${r.td} added to points debt` : null });
  }
  for (const r of (await db.prepare(`SELECT id, points, created_at as at FROM reward_debt_repayments WHERE party_type = ? AND party_id = ?`).all(k, id)) as any[]) {
    out.push({ id: `d${r.id}`, kind: "debt_repayment", points: -Number(r.points), at: iso(r.at), sourceType: null, sourceRef: null, note: "repaid from new points" });
  }
  for (const r of (await db.prepare(`SELECT id, points, created_at as at FROM reward_redemptions WHERE party_type = ? AND party_id = ?`).all(k, id)) as any[]) {
    out.push({ id: `p${r.id}`, kind: "redemption", points: -Number(r.points), at: iso(r.at), sourceType: null, sourceRef: null, note: "one month of Pro" });
  }
  for (const r of (await db.prepare(`SELECT id, points, reason, created_at as at FROM reward_adjustments WHERE party_type = ? AND party_id = ?`).all(k, id)) as any[]) {
    out.push({ id: `j${r.id}`, kind: "adjustment", points: Number(r.points), at: iso(r.at), sourceType: null, sourceRef: null, note: String(r.reason).slice(0, 200) });
  }
  out.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : a.id < b.id ? 1 : -1));
  const before = opts.before ? new Date(opts.before).toISOString() : null;
  // Cursor = (timestamp, id) of the last entry shown, so entries in the same second aren't skipped.
  const after = (e: RewardHistoryEntry) => !before || e.at < before || (e.at === before && !!opts.beforeId && e.id < opts.beforeId);
  return out.filter(after).slice(0, Math.min(Math.max(Number(opts.limit) || 50, 1), 200));
}

/** Stage 5f — the partner's points at a glance (dashboard and Earnings). */
export async function rewardSummary(partner: PartnerKey) {
  const bal = await rewardBalance(partner);
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  const month = (await db.prepare(`SELECT COALESCE(SUM(points_earned), 0) as p FROM reward_lots WHERE party_type = ? AND party_id = ? AND created_at >= ? AND source_ref LIKE 'settlement:%'`).get(partner.kind, partner.id, monthStart)) as {
    p: number | string;
  };
  const pending = await pendingPoints(partner, bal.pointsPerEuro);
  const progressBps = bal.redemptionPoints > 0 ? Math.max(0, Math.min(10_000, Math.floor((Math.max(0, bal.points) * 10_000) / bal.redemptionPoints))) : 0;
  return { ...bal, pendingPoints: pending, earnedThisMonth: Number(month.p), progressBps, recent: await rewardHistory(partner, { limit: 3 }) };
}

/** Stage 5f — a finance admin's manual points adjustment (positive: a new lot; negative: from lots, then debt). Idempotent by key. */
export async function adjustPoints(input: { partner: PartnerKey; points: number; reason: string; idempotencyKey: string; actorId: string }) {
  if (!Number.isSafeInteger(input.points) || input.points === 0 || Math.abs(input.points) > 1_000_000) throw new RewardError("Points must be a non-zero whole number");
  if (typeof input.reason !== "string" || input.reason.trim().length < 5) throw new RewardError("A reason (at least 5 characters) is required");
  if (!/^[\w:-]{8,120}$/.test(input.idempotencyKey)) throw new RewardError("A request key is required");
  const prior = await db.prepare(`SELECT id FROM reward_adjustments WHERE idempotency_key = ?`).get(input.idempotencyKey);
  if (prior) return { id: (prior as { id: number }).id, duplicate: true };
  const rule = await resolveRule("rewards", ctxOf(input.partner.kind, input.partner.id));
  const id = await db.transaction(async (tx) => {
    let lotId: number | null = null;
    let toDebt = 0;
    if (input.points > 0) {
      const lot = await tx
        .prepare(`INSERT INTO reward_lots (party_type, party_id, source_ref, points_earned, points_remaining, expires_at) VALUES (?, ?, ?, ?, ?, ?)`)
        .run(input.partner.kind, input.partner.id, `adjustment:${input.idempotencyKey}`, input.points, input.points, addMonths(new Date(), Number(rule.values.expiryMonths)));
      lotId = Number(lot.lastInsertRowid);
    } else {
      toDebt = (await deductPoints(tx, input.partner.kind, input.partner.id, null, -input.points)).toDebt;
    }
    const r = await tx
      .prepare(`INSERT INTO reward_adjustments (party_type, party_id, points, lot_id, to_debt, reason, idempotency_key, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(input.partner.kind, input.partner.id, input.points, lotId, toDebt, input.reason.trim().slice(0, 2000), input.idempotencyKey, input.actorId);
    return Number(r.lastInsertRowid);
  });
  await writeAudit({ actorUserId: input.actorId, action: "rewards.adjusted", objectType: `partner_${input.partner.kind}`, objectId: input.partner.id, newValue: { points: input.points, adjustmentId: id }, reason: input.reason.trim() });
  return { id, duplicate: false };
}
