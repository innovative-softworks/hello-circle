import { db } from "./db/index.js";

/** Platform-wide audit log (Phase D, best-effort). Written to going forward
 * from admin actions; nothing is backfilled for actions taken before this
 * existed. Never throws — an audit-log failure must not fail the action
 * that triggered it, same contract as the notification helpers. */
export async function writeAudit(params: {
  actorUserId: string | null;
  action: string;
  objectType: string;
  objectId: string;
  previousValue?: unknown;
  newValue?: unknown;
  /** Commerce Engine — why the change was made (audit_log.reason). */
  reason?: string;
  actorKind?: "user" | "resident" | "system";
}) {
  try {
    await db
      .prepare(`INSERT INTO audit_log (actor_user_id, action, object_type, object_id, previous_value, new_value, reason, actor_kind, environment) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(
        params.actorUserId,
        params.action,
        params.objectType,
        params.objectId,
        params.previousValue === undefined ? null : JSON.stringify(params.previousValue),
        params.newValue === undefined ? null : JSON.stringify(params.newValue),
        params.reason ?? null,
        params.actorKind ?? null,
        (process.env.APP_ENV || process.env.NODE_ENV || "development").slice(0, 20)
      );
  } catch (e) {
    console.error("[audit] write failed:", e);
  }
}
