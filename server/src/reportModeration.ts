import { writeAudit } from "./audit.js";
import { db } from "./db/index.js";
import { notifyPartner, NEXT_STEPS } from "./moderationNotify.js";
import { recordDecision, type DecisionReason } from "./moderationDecisions.js";
import { notifyResident } from "./notifications.js";
import { removePlan } from "./circleModeration.js";
import { cancelGameAndNotify } from "./routes/games.js";

// OG-03 / DEC-10 — a report's "suspend" decision changes the reported
// content's real state, per type, and a report is only marked as actioned when
// that state actually changed:
//   review       → hidden (as before)
//   circle       → closed (as before)
//   chat_message → hidden; the text stays stored as evidence, readers see
//                  "removed by HelloCircle"
//   game         → the activity is cancelled through the existing cancel path:
//                  participants and waitlist are told, paid places are refunded
//                  in full (the existing rule when an activity is cancelled)
//   centre/club/experience → status "suspended": hidden and closed to new
//                  sales, existing bookings kept; the partner can't resume it
//                  themselves; HelloCircle can reinstate the previous status
// Chat, activity and listing actions need a D-03 reason (category +
// explanation for the person affected).

export const REPORT_TARGET_TYPES = ["review", "circle", "chat_message", "game", "centre", "club", "experience", "program", "host", "provider", "circle_memory", "circle_plan"] as const;
/** Detail-page audit DP-06 (2026-10-22) — reportable from their public pages,
 * but review-only: there is no one-click "suspend" for a programme or a person.
 * Admins act through the existing tools (listing/programme edit, host status,
 * organisation suspension) and close the report as actioned. */
export const REVIEW_ONLY_REPORT_TYPES: readonly ReportTargetType[] = ["program", "host", "provider"];
export type ReportTargetType = (typeof REPORT_TARGET_TYPES)[number];
export const isReportTargetType = (v: unknown): v is ReportTargetType => typeof v === "string" && (REPORT_TARGET_TYPES as readonly string[]).includes(v);
/** Types whose "suspend" action needs a recorded reason. */
export const REASON_REQUIRED: readonly ReportTargetType[] = ["review", "chat_message", "game", "centre", "club", "experience", "circle_memory", "circle_plan"];

export class ModerationError extends Error {
  status: number;
  constructor(message: string, status = 409) {
    super(message);
    this.status = status;
  }
}

const LISTING_TABLE = { centre: "centres", club: "clubs", experience: "experiences" } as const;
const LISTING_NAME = { centre: "name", club: "name", experience: "title" } as const;

/** What the admin case page shows about the reported thing, including the impact of acting on it. */
export async function resolveReportTarget(type: string, id: string): Promise<Record<string, unknown> | null> {
  if (type === "circle") {
    return ((await db.prepare(`SELECT id, name, status, created_by_resident_id as createdByResidentId FROM circles WHERE id = ?`).get(id)) as Record<string, unknown> | undefined) ?? null;
  }
  if (type === "circle_memory") {
    // Circle Experience 2.0 — a member photo or reflection. Admins see the
    // caption/text and who added it; the photo itself stays members-only.
    return ((await db
      .prepare(
        `SELECT m.id, m.circle_id as circleId, c.name as circleName, m.kind, m.caption, m.body, m.status, m.created_at as createdAt, r.name as authorName, m.resident_id as authorResidentId
         FROM circle_memories m LEFT JOIN circles c ON c.id = m.circle_id LEFT JOIN residents r ON r.id = m.resident_id WHERE m.id = ?`
      )
      .get(id)) as Record<string, unknown> | undefined) ?? null;
  }
  if (type === "circle_plan") {
    // Circles 3.0 — a suggested plan (and the listing it points at, if any).
    return ((await db
      .prepare(
        `SELECT p.id, p.circle_id as circleId, c.name as circleName, p.title, p.note, p.status, p.listing_type as listingType, p.listing_id as listingId,
                p.created_at as createdAt, r.name as authorName, p.created_by_resident_id as authorResidentId
         FROM circle_plans p LEFT JOIN circles c ON c.id = p.circle_id LEFT JOIN residents r ON r.id = p.created_by_resident_id WHERE p.id = ?`
      )
      .get(id)) as Record<string, unknown> | undefined) ?? null;
  }
  if (type === "review") {
    return ((await db.prepare(`SELECT id, listing_type as listingType, listing_id as listingId, name, comment, hidden FROM reviews WHERE id = ?`).get(id)) as Record<string, unknown> | undefined) ?? null;
  }
  if (type === "chat_message") {
    const m = (await db
      .prepare(
        `SELECT cm.id, cm.scope_type as scopeType, cm.scope_id as scopeId, cm.body, cm.created_at as createdAt, cm.hidden_at as hiddenAt, cm.hidden_reason as hiddenReason,
                COALESCE(NULLIF(u.business_name, ''), u.name, r.name) as authorName, cm.resident_id as authorResidentId, cm.author_user_id as authorUserId
         FROM chat_messages cm LEFT JOIN residents r ON r.id = cm.resident_id LEFT JOIN users u ON u.id = cm.author_user_id WHERE cm.id = ?`
      )
      .get(id)) as Record<string, unknown> | undefined;
    return m ?? null;
  }
  if (type === "game") {
    const g = (await db
      .prepare(
        `SELECT g.id, g.activity_label as activityLabel, g.date, g.time, g.status, g.host_resident_id as hostResidentId, r.name as hostName,
                (SELECT COUNT(*) FROM game_participants p WHERE p.game_id = g.id AND p.status = 'joined') as joined,
                (SELECT COUNT(*) FROM game_participants p WHERE p.game_id = g.id AND p.status = 'joined' AND p.payment_status = 'paid' AND p.stripe_session_id IS NOT NULL AND p.total_cents > 0) as paidOnline
         FROM games g LEFT JOIN residents r ON r.id = g.host_resident_id WHERE g.id = ?`
      )
      .get(id)) as Record<string, unknown> | undefined;
    return g ? { ...g, joined: Number(g.joined), paidOnline: Number(g.paidOnline) } : null;
  }
  if (type === "program") {
    return ((await db
      .prepare(`SELECT p.id, p.title as name, p.status, p.vendor_id as vendorId, u.business_name as partnerName FROM programs p LEFT JOIN users u ON u.id = p.vendor_id WHERE p.id = ?`)
      .get(id)) as Record<string, unknown> | undefined) ?? null;
  }
  if (type === "host") {
    return ((await db.prepare(`SELECT id, name, host_status as hostStatus FROM residents WHERE id = ?`).get(id)) as Record<string, unknown> | undefined) ?? null;
  }
  if (type === "provider") {
    return ((await db
      .prepare(`SELECT id, COALESCE(NULLIF(business_name, ''), name) as name, status FROM users WHERE id = ? AND role = 'vendor'`)
      .get(id)) as Record<string, unknown> | undefined) ?? null;
  }
  if (type === "centre" || type === "club" || type === "experience") {
    const t = LISTING_TABLE[type];
    const row = (await db
      .prepare(`SELECT l.id, l.${LISTING_NAME[type]} as name, l.status, l.vendor_id as vendorId, u.business_name as partnerName FROM ${t} l LEFT JOIN users u ON u.id = l.vendor_id WHERE l.id = ?`)
      .get(id)) as Record<string, unknown> | undefined;
    return row ?? null;
  }
  return null;
}

export interface ReportAction {
  action: string;
  summary: string;
}

/** Applies the "suspend" decision to the reported content. Throws ModerationError when nothing would change. */
export async function applyReportAction(report: { id: number; targetType: string; targetId: string }, actorUserId: string, reason: DecisionReason | null): Promise<ReportAction> {
  const { targetType: type, targetId: id } = report;
  if (!isReportTargetType(type)) throw new ModerationError("This report's target can't be acted on", 400);
  if (REVIEW_ONLY_REPORT_TYPES.includes(type)) throw new ModerationError("Act on this from its own admin page, then mark the report as actioned", 400);
  if (REASON_REQUIRED.includes(type) && !reason?.explanation) throw new ModerationError("Give a reason category and an explanation", 400);
  const audit = (action: string, previousValue: unknown, newValue: unknown) =>
    writeAudit({ actorUserId, action, objectType: type, objectId: id, previousValue, newValue: { ...(newValue as object), reportId: report.id }, reason: reason?.explanation });

  if (type === "circle") {
    const r = await db.prepare(`UPDATE circles SET status = 'closed', closed_by = 'helloCircle' WHERE id = ? AND status != 'closed'`).run(id);
    if (r.changes !== 1) throw new ModerationError("This Circle is already closed (or no longer exists)");
    await audit("suspend_by_report", { status: "active" }, { status: "closed" });
    return { action: "circle_closed", summary: "circle closed" };
  }
  if (type === "review") {
    const r = await db.prepare(`UPDATE reviews SET hidden = 1, hidden_reason = ?, hidden_by = ?, hidden_at = NOW() WHERE id = ? AND hidden = 0`).run(reason!.explanation.slice(0, 1000), actorUserId, id);
    if (r.changes !== 1) throw new ModerationError("This review is already hidden (or no longer exists)");
    await audit("suspend_by_report", { hidden: false }, { hidden: true });
    // Trust & Retention — the author is told why and how to ask for reconsideration (existing appeal route).
    const author = (await db.prepare(`SELECT resident_id as residentId FROM reviews WHERE id = ?`).get(id)) as { residentId: string | null } | undefined;
    if (author?.residentId) {
      await notifyResident({
        residentId: author.residentId,
        kind: "moderation",
        title: "HelloCircle hid one of your reviews",
        body: `${reason!.explanation}\n\nIf you think this is wrong, ask us to reconsider: open Complaints & appeals and quote case R-${String(report.id).padStart(6, "0")}.`.slice(0, 2000),
        listingType: "account",
        listingId: author.residentId,
        ref: String(report.id),
      });
    }
    return { action: "review_hidden", summary: "review hidden" };
  }
  if (type === "chat_message") {
    const r = await db
      .prepare(`UPDATE chat_messages SET hidden_at = NOW(), hidden_by = ?, hidden_by_kind = 'admin', hidden_reason = ? WHERE id = ? AND hidden_at IS NULL`)
      .run(actorUserId, reason!.explanation.slice(0, 500), id);
    if (r.changes !== 1) throw new ModerationError("This message is already hidden (or no longer exists)");
    await audit("chat_message.hidden", { hidden: false }, { hidden: true, by: "admin" });
    return { action: "chat_message_hidden", summary: "message hidden" };
  }
  if (type === "circle_memory") {
    const r = await db
      .prepare(`UPDATE circle_memories SET status = 'removed', removed_at = NOW(), removed_by = ?, removed_by_kind = 'admin' WHERE id = ? AND status = 'visible'`)
      .run(actorUserId, id);
    if (r.changes !== 1) throw new ModerationError("This memory is already removed (or no longer exists)");
    await audit("circle_memory.removed", { status: "visible" }, { status: "removed", by: "admin" });
    return { action: "circle_memory_removed", summary: "memory removed" };
  }
  if (type === "circle_plan") {
    const plan = (await db.prepare(`SELECT circle_id as circleId FROM circle_plans WHERE id = ?`).get(id)) as { circleId: string } | undefined;
    if (!plan) throw new ModerationError("This plan no longer exists", 404);
    const r = await removePlan(plan.circleId, id, { kind: "admin", userId: actorUserId }, reason!.explanation);
    if (r === "too_late") throw new ModerationError("This plan is already an activity or closed — act on the activity instead");
    if (r === "missing") throw new ModerationError("This plan no longer exists", 404);
    return { action: "circle_plan_removed", summary: "plan removed" };
  }
  if (type === "game") {
    await cancelActivityByPlatform(id, actorUserId, reason!, report.id);
    return { action: "game_cancelled", summary: "activity cancelled" };
  }
  if (type !== "centre" && type !== "club" && type !== "experience") throw new ModerationError("This report's target can't be acted on", 400);
  // centre / club / experience
  const t = LISTING_TABLE[type];
  const row = (await db.prepare(`SELECT status, vendor_id as vendorId, ${LISTING_NAME[type]} as name FROM ${t} WHERE id = ?`).get(id)) as { status: string; vendorId: string | null; name: string } | undefined;
  if (!row) throw new ModerationError("This listing no longer exists", 404);
  const r = await db.prepare(`UPDATE ${t} SET moderation_prior_status = status, status = 'suspended' WHERE id = ? AND status NOT IN ('suspended', 'deleted')`).run(id);
  if (r.changes !== 1) throw new ModerationError("This listing is already suspended or deleted");
  await recordDecision(db, { objectType: type, objectId: id, action: "listing.suspended", previousState: row.status, newState: "suspended", reason, actorUserId });
  await audit(`${type}.suspended_by_moderation`, { status: row.status }, { status: "suspended" });
  await notifyPartner(row.vendorId, {
    title: `${row.name} has been suspended`,
    intro: `HelloCircle has suspended your listing "${row.name}" after a review. It's hidden and closed to new bookings; existing bookings are kept.`,
    kind: "suspension",
    reason,
    nextSteps: NEXT_STEPS.suspension,
    listingType: type,
    listingId: id,
  });
  return { action: "listing_suspended", summary: "listing suspended" };
}

/** Reverses a listing suspension: back to the status it had before. */
export async function reinstateListing(type: "centre" | "club" | "experience", id: string, actorUserId: string, reason: DecisionReason | null) {
  const t = LISTING_TABLE[type];
  const row = (await db.prepare(`SELECT status, moderation_prior_status as prior, vendor_id as vendorId, ${LISTING_NAME[type]} as name FROM ${t} WHERE id = ?`).get(id)) as
    | { status: string; prior: string | null; vendorId: string | null; name: string }
    | undefined;
  if (!row) throw new ModerationError("Listing not found", 404);
  if (row.status !== "suspended") throw new ModerationError("This listing isn't suspended");
  const restored = row.prior && row.prior !== "suspended" ? row.prior : "pending";
  const r = await db.prepare(`UPDATE ${t} SET status = ?, moderation_prior_status = NULL WHERE id = ? AND status = 'suspended'`).run(restored, id);
  if (r.changes !== 1) throw new ModerationError("This listing isn't suspended");
  await recordDecision(db, { objectType: type, objectId: id, action: "listing.reinstated", previousState: "suspended", newState: restored, reason, actorUserId });
  await writeAudit({ actorUserId, action: `${type}.reinstated`, objectType: type, objectId: id, previousValue: { status: "suspended" }, newValue: { status: restored }, reason: reason?.explanation });
  await notifyPartner(row.vendorId, {
    title: `${row.name} has been reinstated`,
    intro: `Your listing "${row.name}" has been reinstated${restored === "approved" ? " and is live again" : ` (status: ${restored})`}.`,
    kind: "suspension",
    reason,
    nextSteps: "",
    listingType: type,
    listingId: id,
  });
  return { status: restored };
}

/** Restores a hidden chat message (an admin reverses a hide). */
export async function unhideChatMessage(id: string, actorUserId: string, reason: string) {
  const r = await db.prepare(`UPDATE chat_messages SET hidden_at = NULL, hidden_by = NULL, hidden_by_kind = NULL, hidden_reason = NULL WHERE id = ? AND hidden_at IS NOT NULL`).run(id);
  if (r.changes !== 1) throw new ModerationError("This message isn't hidden");
  await writeAudit({ actorUserId, action: "chat_message.unhidden", objectType: "chat_message", objectId: id, previousValue: { hidden: true }, newValue: { hidden: false }, reason });
}

/** HelloCircle cancels an activity (from a report or the admin Activities
 * directory): the existing cancel path tells participants and the waitlist
 * and refunds paid places in full; the host is told why. */
export async function cancelActivityByPlatform(id: string, actorUserId: string, reason: DecisionReason, reportId?: number) {
  const g = (await db.prepare(`SELECT status, host_resident_id as hostId, activity_label as label FROM games WHERE id = ?`).get(id)) as { status: string; hostId: string; label: string } | undefined;
  if (!g) throw new ModerationError("This activity no longer exists", 404);
  if (!(await cancelGameAndNotify(id, { by: "platform", reason: reason.explanation, actorId: actorUserId }))) throw new ModerationError("This activity is already cancelled");
  await writeAudit({ actorUserId, action: "game.cancelled_by_platform", objectType: "game", objectId: id, previousValue: { status: g.status }, newValue: { status: "cancelled", ...(reportId ? { reportId } : {}) }, reason: reason.explanation });
  await recordDecision(db, { objectType: "game", objectId: id, action: "game.cancelled", previousState: g.status, newState: "cancelled", reason, actorUserId });
  await notifyResident({
    residentId: g.hostId,
    kind: "moderation",
    title: `HelloCircle cancelled ${g.label}`,
    body: `${reason.explanation}\n\nParticipants have been told and paid places refunded. ${NEXT_STEPS.suspension}`.slice(0, 2000),
    listingType: "game",
    listingId: id,
    ref: id,
  });
}
