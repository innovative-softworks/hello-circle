import { writeAudit } from "./audit.js";
import { db } from "./db/index.js";
import { notifyResident } from "./notifications.js";

// Removing planning items from a Circle (owner, 2026-10-24): an organiser —
// or HelloCircle staff with reports.moderate — can take down a wish, delete a
// poll, or (staff) remove a plan. One place, so the Circle route and the
// admin route behave the same. Every removal is audited; the people whose
// wish or plan it was are told, without naming who removed it.

export type Remover = { kind: "organiser"; residentId: string } | { kind: "admin"; userId: string };

const by = (r: Remover) => (r.kind === "admin" ? "HelloCircle" : "an organiser");

async function audit(r: Remover, action: string, circleId: string, newValue: unknown, reason?: string) {
  await writeAudit({
    actorUserId: r.kind === "admin" ? r.userId : r.residentId,
    actorKind: r.kind === "admin" ? "user" : "resident",
    action,
    objectType: "circle",
    objectId: circleId,
    newValue,
    reason,
  });
}

async function circleName(circleId: string): Promise<string> {
  const row = (await db.prepare(`SELECT name FROM circles WHERE id = ?`).get(circleId)) as { name: string } | undefined;
  return row?.name ?? "your Circle";
}

/** Removes every member's wish for one interest in one week (a wish row is a
 * total, so it goes as a whole). Returns how many wishes were removed. */
export async function removeWishGroup(circleId: string, weekStart: string, interestKey: string, remover: Remover, reason?: string): Promise<number> {
  const owners = (await db
    .prepare(`SELECT resident_id as residentId, interest FROM circle_pulses WHERE circle_id = ? AND week_start = ? AND interest_key = ?`)
    .all(circleId, weekStart, interestKey)) as { residentId: string; interest: string }[];
  if (owners.length === 0) return 0;
  await db.prepare(`DELETE FROM circle_pulses WHERE circle_id = ? AND week_start = ? AND interest_key = ?`).run(circleId, weekStart, interestKey);
  await audit(remover, "circle.wish_removed", circleId, { weekStart, interestKey, count: owners.length }, reason);
  const name = await circleName(circleId);
  for (const o of owners) {
    await notifyResident({
      residentId: o.residentId,
      kind: "circle",
      title: `Your wish was removed from ${name}`,
      body: `"${o.interest}" was taken down by ${by(remover)}${reason ? `: ${reason}` : "."} You can add something else any time.`,
      listingType: "circle",
      listingId: circleId,
      ref: `${weekStart}|${interestKey}`,
    });
  }
  return owners.length;
}

/** Deletes a poll with its options and votes. False when it isn't this Circle's. */
export async function deletePoll(circleId: string, pollId: string, remover: Remover, reason?: string): Promise<boolean> {
  const poll = (await db.prepare(`SELECT question FROM circle_polls WHERE id = ? AND circle_id = ?`).get(pollId, circleId)) as { question: string } | undefined;
  if (!poll) return false;
  await db.transaction(async (tx) => {
    await tx.prepare(`DELETE FROM circle_poll_votes WHERE poll_id = ?`).run(pollId);
    await tx.prepare(`DELETE FROM circle_poll_options WHERE poll_id = ?`).run(pollId);
    await tx.prepare(`DELETE FROM circle_polls WHERE id = ?`).run(pollId);
  });
  await audit(remover, "circle.poll_deleted", circleId, { pollId, question: poll.question }, reason);
  return true;
}

/** HelloCircle staff take down a plan that hasn't become an activity yet
 * (organisers already decline or cancel through the Circle). The plan is
 * kept as cancelled, with the explanation members see. */
export async function removePlan(circleId: string, planId: string, remover: Remover, reason: string): Promise<"ok" | "missing" | "too_late"> {
  const plan = (await db.prepare(`SELECT status, title FROM circle_plans WHERE id = ? AND circle_id = ?`).get(planId, circleId)) as { status: string; title: string } | undefined;
  if (!plan) return "missing";
  const r = await db
    .prepare(`UPDATE circle_plans SET status = 'cancelled', cancelled_at = NOW(), decline_reason = ? WHERE id = ? AND status IN ('idea', 'confirmed')`)
    .run(`Removed by ${by(remover)}: ${reason}`.slice(0, 500), planId);
  if (r.changes !== 1) return "too_late";
  await audit(remover, "circle.plan_removed", circleId, { planId, title: plan.title }, reason);
  const members = (await db.prepare(`SELECT resident_id FROM circle_members WHERE circle_id = ?`).all(circleId)) as { resident_id: string }[];
  for (const m of members) {
    await notifyResident({
      residentId: m.resident_id,
      kind: "circle",
      title: `${plan.title} was removed`,
      body: `This plan was taken down by ${by(remover)}: ${reason}`,
      listingType: "circle",
      listingId: circleId,
      ref: planId,
    });
  }
  return "ok";
}

/** Everything staff need to review a Circle's planning — totals only for
 * wishes, as members see them; never who wished for what. */
export async function circlePlanningForAdmin(circleId: string) {
  const wishes = (await db
    .prepare(
      `SELECT interest_key as interestKey, MIN(interest) as interest, week_start as weekStart, COUNT(*) as count
       FROM circle_pulses WHERE circle_id = ? AND expires_at > NOW() GROUP BY interest_key, week_start ORDER BY week_start, count DESC`
    )
    .all(circleId)) as { interestKey: string; interest: string; weekStart: string; count: number }[];
  const plans = (await db
    .prepare(
      `SELECT p.id, p.title, p.status, p.proposed_date as proposedDate, p.created_at as createdAt, r.name as createdByName, p.listing_type as listingType
       FROM circle_plans p LEFT JOIN residents r ON r.id = p.created_by_resident_id
       WHERE p.circle_id = ? ORDER BY p.created_at DESC LIMIT 100`
    )
    .all(circleId)) as { id: string; title: string; status: string; proposedDate: string | null; createdAt: string; createdByName: string | null }[];
  const polls = (await db
    .prepare(
      `SELECT p.id, p.question, p.status, p.created_at as createdAt, (SELECT COUNT(DISTINCT resident_id) FROM circle_poll_votes v WHERE v.poll_id = p.id) as voters
       FROM circle_polls p WHERE p.circle_id = ? ORDER BY p.created_at DESC LIMIT 100`
    )
    .all(circleId)) as { id: string; question: string; status: string; createdAt: string; voters: number }[];
  return {
    wishes: wishes.map((w) => ({ ...w, count: Number(w.count) })),
    plans,
    polls: polls.map((p) => ({ ...p, voters: Number(p.voters) })),
  };
}
