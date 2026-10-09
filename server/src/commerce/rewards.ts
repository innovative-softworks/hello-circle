import { writeAudit } from "../audit.js";
import { db } from "../db/index.js";
import { refundedSoFar } from "./payments.js";
import { assignPlan, currentPlanFor, type PartnerKey } from "./plans.js";
import { resolveRule } from "./rules.js";
import { liveSubscription } from "./subscriptions.js";
import { commerceSwitch } from "./switches.js";

// Revenue & Connect Stage 5b — partner reward points ("Circle Credits").
// Earned when a settlement is created, on the settled GMV (what customers
// paid for the orders released into it, less refunds), at the published
// pointsPerEuro; each award is a lot that expires after expiryMonths.
// Redeeming the published number of points gives one month of Pro. Points
// have no cash value.

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

/** Awards points for one settlement (idempotent per settlement). */
export async function awardForSettlement(settlementId: number): Promise<number> {
  if (!(await commerceSwitch("commerce.circle_credits"))) return 0;
  const s = (await db.prepare(`SELECT party_type as kind, party_id as pid FROM settlements WHERE id = ?`).get(settlementId)) as { kind: string; pid: string } | undefined;
  if (!s || s.kind === "vendor") return 0;
  // The orders released into this settlement: release:<type>:<ref> groups.
  const items = (await db
    .prepare(`SELECT g.idempotency_key as k FROM settlement_items i JOIN ledger_entry_groups g ON g.id = i.ledger_group_id WHERE i.settlement_id = ? AND g.idempotency_key LIKE 'release:%'`)
    .all(settlementId)) as { k: string }[];
  let gmv = 0;
  for (const { k } of items) {
    const [, type, ref] = k.split(":");
    const paid = (await db.prepare(`SELECT amount_minor as a FROM payment_records WHERE source_type = ? AND source_ref = ?`).get(type, ref)) as { a: number | string } | undefined;
    if (!paid) continue;
    gmv += Math.max(0, Number(paid.a) - (await refundedSoFar(db, type, ref)));
  }
  const rule = await resolveRule("rewards", { orgId: s.kind === "org" ? s.pid : null, hostResidentId: s.kind === "host" ? s.pid : null });
  const points = Math.floor((gmv * Number(rule.values.pointsPerEuro)) / 100);
  if (points <= 0) return 0;
  const r = await db
    .prepare(`INSERT IGNORE INTO reward_lots (party_type, party_id, source_ref, points_earned, points_remaining, expires_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(s.kind, s.pid, `settlement:${settlementId}`, points, points, addMonths(new Date(), Number(rule.values.expiryMonths)));
  return r.changes > 0 ? points : 0;
}

export async function rewardBalance(partner: PartnerKey, at: Date = new Date()) {
  const row = (await db
    .prepare(`SELECT COALESCE(SUM(points_remaining), 0) as p, MIN(CASE WHEN points_remaining > 0 THEN expires_at END) as nextExpiry FROM reward_lots WHERE party_type = ? AND party_id = ? AND expires_at > ?`)
    .get(partner.kind, partner.id, at)) as { p: number | string; nextExpiry: string | null };
  const rule = await resolveRule("rewards", { orgId: partner.kind === "org" ? partner.id : null, hostResidentId: partner.kind === "host" ? partner.id : null }, at);
  return { points: Number(row.p), nextExpiry: row.nextExpiry, redemptionPoints: Number(rule.values.redemptionPoints), pointsPerEuro: Number(rule.values.pointsPerEuro) };
}

/** Spends the published number of points (oldest first) on one month of Pro. */
export async function redeemForProMonth(partner: PartnerKey, actorId: string) {
  if (!(await commerceSwitch("commerce.circle_credits"))) throw new RewardError("Reward points aren't available yet", 409);
  const sub = await liveSubscription(partner);
  if (sub && sub.status !== "checkout") throw new RewardError("You're subscribed to Pro already — points can be redeemed when you're not on a paid subscription", 409);
  const { redemptionPoints } = await rewardBalance(partner);
  const result = await db.transaction(async (tx) => {
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
