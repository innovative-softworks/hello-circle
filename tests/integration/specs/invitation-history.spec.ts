import { randomBytes, randomUUID } from "node:crypto";
import { test, expect, personas, manifest } from "../fixtures";
import { withActors } from "../authorization-fixture";
import { redactSyntheticInvitationHistory } from "../invitation-history";

test("INVITE-HISTORY: active credential invalidated before synthetic audit redaction; history retained", async ({ playwright }) => {
  await withActors(playwright, ["GUEST"], async ({ connection, actors, track }) => {
    const [owners] = await connection.query<any[]>("SELECT org_id FROM users WHERE id=?", [personas.QA_VENDOR.id]);
    const ids: number[] = [], secrets: string[] = [];
    for (const [status,expiry] of [["pending","2035-01-01"],["pending","2000-01-01"],["accepted","2035-01-01"],["revoked","2035-01-01"]]) {
      const token = randomBytes(32).toString("hex"); secrets.push(token);
      track("org_invites", "token", token);
      await connection.execute("INSERT INTO org_invites (token,org_id,email,platform_role,status,expires_at) VALUES (?,?,?,'read_only_analyst',?,?)", [token,owners[0].org_id,`qa_history_${randomUUID()}@example.test`,status,expiry]);
      const [insert] = await connection.execute<any>("INSERT INTO audit_log (actor_user_id,action,object_type,object_id,previous_value,new_value) VALUES (?,'org.staff_invited','org_invite',?,?,?)", [personas.QA_VENDOR.id,token,JSON.stringify({ token }),JSON.stringify({ qaFixture: manifest.runId, orgId: owners[0].org_id, link: `http://127.0.0.1/accept-invite?token=${token}` })]);
      ids.push(insert.insertId); track("audit_log", "id", insert.insertId);
    }
    const marks = ids.map(() => "?").join(",");
    const [before] = await connection.query<any[]>(`SELECT id,actor_user_id,action,object_type,created_at FROM audit_log WHERE id IN (${marks}) ORDER BY id`, ids);
    expect((await actors.GUEST.get(`/api/invites/${secrets[0]}`)).status()).toBe(200);
    expect(await redactSyntheticInvitationHistory(ids)).toEqual(["active","expired","accepted","revoked"]);
    const [after] = await connection.query<any[]>(`SELECT * FROM audit_log WHERE id IN (${marks}) ORDER BY id`, ids);
    expect(after.length).toBe(4);
    expect(secrets.some(secret => JSON.stringify(after).includes(secret))).toBe(false);
    expect(after.map(({id,actor_user_id,action,object_type,created_at}) => ({id,actor_user_id,action,object_type,created_at}))).toEqual(before);
    const [active] = await connection.query<any[]>("SELECT status FROM org_invites WHERE token=?", [secrets[0]]);
    expect(active[0].status).toBe("revoked");
    expect((await actors.GUEST.get(`/api/invites/${secrets[0]}`)).status()).toBe(404);
    expect(await redactSyntheticInvitationHistory(ids)).toEqual(Array(4).fill("already-redacted"));
    const [again] = await connection.query<any[]>(`SELECT * FROM audit_log WHERE id IN (${marks}) ORDER BY id`, ids);
    expect(JSON.stringify(again) === JSON.stringify(after)).toBe(true);
  });
});
