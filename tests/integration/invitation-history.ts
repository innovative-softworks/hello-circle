import { createHash } from "node:crypto";
import { connectedPreflight } from "./runtime";

/** QA verification ONLY, deliberately not a production migration command.
 * Reject anything except exact IDs bearing this isolated run's synthetic marker. */
export async function redactSyntheticInvitationHistory(ids: number[]) {
  if (!ids.length || ids.length > 20 || ids.some(id => !Number.isSafeInteger(id) || id <= 0)) throw new Error("QA SAFETY ABORT: explicit synthetic audit IDs required");
  const checked = await connectedPreflight();
  const connection = checked.connection;
  try {
    await connection.beginTransaction();
    const [rows] = await connection.query<any[]>(`SELECT * FROM audit_log WHERE id IN (${ids.map(() => "?").join(",")}) ORDER BY id FOR UPDATE`, ids);
    if (rows.length !== new Set(ids).size) throw new Error("QA SAFETY ABORT: audit scope mismatch");
    const result: string[] = [];
    for (const row of rows) {
      const metadata = JSON.parse(row.new_value ?? "null");
      if (row.object_type !== "org_invite" || metadata?.qaFixture !== checked.manifest.runId) throw new Error("QA SAFETY ABORT: not synthetic history for this run");
      if (metadata.qaRedacted === true) { result.push("already-redacted"); continue; }
      const [invites] = await connection.query<any[]>("SELECT token,status,expires_at > NOW() AS unexpired FROM org_invites WHERE token=? FOR UPDATE", [row.object_id]);
      if (invites.length !== 1) throw new Error("QA SAFETY ABORT: unknown historical credential requires review");
      const invite = invites[0];
      const state = invite.status === "pending" ? (Number(invite.unexpired) ? "active" : "expired") : invite.status;
      if (!["active","expired","accepted","revoked"].includes(state)) throw new Error("QA SAFETY ABORT: unknown invitation state");
      if (state === "active") await connection.execute("UPDATE org_invites SET status='revoked' WHERE token=? AND status='pending'", [invite.token]);
      const safeId = createHash("sha256").update(invite.token).digest("hex");
      const clean = (value: string | null) => value === null ? null : value.split(invite.token).join("[REDACTED]");
      const cleanMetadata = JSON.parse(clean(row.new_value)!);
      cleanMetadata.qaRedacted = true;
      await connection.execute("UPDATE audit_log SET object_id=?,previous_value=?,new_value=? WHERE id=?", [safeId,clean(row.previous_value),JSON.stringify(cleanMetadata),row.id]);
      result.push(state);
    }
    await connection.commit();
    return result;
  } catch (error) { await connection.rollback(); throw error; }
  finally { await connection.end(); }
}
