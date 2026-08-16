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
}) {
  try {
    await db
      .prepare(`INSERT INTO audit_log (actor_user_id, action, object_type, object_id, previous_value, new_value) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(
        params.actorUserId,
        params.action,
        params.objectType,
        params.objectId,
        params.previousValue === undefined ? null : JSON.stringify(params.previousValue),
        params.newValue === undefined ? null : JSON.stringify(params.newValue)
      );
  } catch (e) {
    console.error("[audit] write failed:", e);
  }
}
