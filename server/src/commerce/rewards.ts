import { writeAudit } from "../audit.js";
import { db } from "../db/index.js";
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
  // The orders released into this settlement: release:<type>:<ref> groups.
  const items = (await db
    .prepare(`SELECT g.idempotency_key as k FROM settlement_items i JOIN ledger_entry_groups g ON g.id = i.ledger_group_id WHERE i.settlement_id = ? AND g.idempotency_key LIKE 'release:%'`)
    .all(settlementId)) as { k: string }[];
  return db.transaction(async (tx) => {
    if (await tx.prepare(`SELECT id FROM reward_awards WHERE settlement_id = ? LIMIT 1`).get(settlementId)) return 0;
    const orders: { type: string; ref: string; gmv: number; refunded: number; points: number }[] = [];
    for (const { k } of items) {
      const [, type, ref] = k.split(":");
      if (await tx.prepare(`SELECT id FROM reward_awards WHERE source_type = ? AND source_ref = ?`).get(type, ref)) continue;
      const paid = (await tx.prepare(`SELECT amount_minor as a FROM payment_records WHERE source_type = ? AND source_ref = ?`).get(type, ref)) as { a: number | string } | undefined;
      if (!paid) continue;
      const refunded = await refundedFor(tx, type, ref);
      const gmv = Math.max(0, Number(paid.a) - refunded);
      orders.push({ type, ref, gmv, refunded, points: Math.floor((gmv * perEuro) / 100) });
    }
    const total = orders.reduce((a, o) => a + o.points, 0);
    if (total <= 0) return 0;
    // Repay any points debt first.
    const debt = await lockDebt(tx, s.kind, s.pid);
    const repay = Math.min(debt, total);
    if (repay > 0) await tx.prepare(`UPDATE reward_debts SET points_owed = points_owed - ? WHERE party_type = ? AND party_id = ?`).run(repay, s.kind, s.pid);
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
    return total;
  });
}

/** Re-derives how many of an order's points should be reversed (refunds
 * since the award + lost disputes) and reverses the difference. Safe to call
 * after every refund / dispute change; a no-op for orders never awarded. */
export async function reverseRewardsForOrder(tx: Tx, type: string, ref: string, reason: "refund" | "dispute_lost"): Promise<number> {
  const award = (await tx
    .prepare(`SELECT id, party_type as kind, party_id as pid, gmv_minor as gmv, refunded_at_award_minor as refundedAtAward, points, reversed_points as reversed, lot_id as lotId FROM reward_awards WHERE source_type = ? AND source_ref = ? FOR UPDATE`)
    .get(type, ref)) as { id: number; kind: string; pid: string; gmv: number | string; refundedAtAward: number | string; points: number; reversed: number; lotId: number | null } | undefined;
  if (!award || Number(award.gmv) <= 0 || award.points <= 0) return 0;
  const lost = (await tx.prepare(`SELECT COALESCE(SUM(amount_minor), 0) as s FROM disputes WHERE source_type = ? AND source_ref = ? AND status = 'lost'`).get(type, ref)) as { s: number | string };
  const loss = Math.min(Number(award.gmv), Math.max(0, (await refundedFor(tx, type, ref)) - Number(award.refundedAtAward)) + Number(lost.s));
  const target = Math.floor((award.points * loss) / Number(award.gmv));
  const delta = target - award.reversed;
  if (delta <= 0) return 0;

  let need = delta;
  const now = new Date();
  const lots = (await tx
    .prepare(
      `SELECT id, points_remaining as r FROM reward_lots WHERE party_type = ? AND party_id = ? AND expires_at > ? AND points_remaining > 0
       ORDER BY (id = ?) DESC, expires_at, id FOR UPDATE`
    )
    .all(award.kind, award.pid, now, award.lotId ?? 0)) as { id: number; r: number }[];
  for (const l of lots) {
    if (need <= 0) break;
    const take = Math.min(Number(l.r), need);
    await tx.prepare(`UPDATE reward_lots SET points_remaining = points_remaining - ? WHERE id = ?`).run(take, l.id);
    need -= take;
  }
  const fromLots = delta - need;
  if (need > 0) {
    await lockDebt(tx, award.kind, award.pid);
    await tx.prepare(`UPDATE reward_debts SET points_owed = points_owed + ? WHERE party_type = ? AND party_id = ?`).run(need, award.kind, award.pid);
  }
  await tx.prepare(`UPDATE reward_awards SET reversed_points = ? WHERE id = ?`).run(target, award.id);
  await tx.prepare(`INSERT INTO reward_reversals (award_id, points, from_lots, to_debt, reason) VALUES (?, ?, ?, ?, ?)`).run(award.id, delta, fromLots, need, reason);
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
