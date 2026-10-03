import { createHash, randomUUID, randomBytes } from "node:crypto";
import { test, expect, personas, env } from "../fixtures";
import { withActors } from "../authorization-fixture";

test("INVITATION-AUDIT: creation records a non-secret identifier, never the bearer credential", async ({ playwright }) => {
  await withActors(playwright, ["QA_VENDOR"], async ({ actors, connection, track }) => {
    const email = `qa_audit_${randomUUID()}@example.test`;
    track("org_invites", "email", email);
    expect((await actors.QA_VENDOR.post("/api/vendor/org/staff/invite", { data: { email, platformRole: "read_only_analyst" } })).status()).toBe(201);
    const [invites] = await connection.query<any[]>("SELECT token,org_id FROM org_invites WHERE email = ?", [email]);
    expect(invites.length).toBe(1);
    const raw = invites[0].token, id = createHash("sha256").update(raw).digest("hex");
    track("audit_log", "object_id", raw); track("audit_log", "object_id", id);
    let audit: any[] = [];
    await expect.poll(async () => {
      [audit] = await connection.query<any[]>("SELECT * FROM audit_log WHERE object_type='org_invite' AND object_id IN (?,?) AND action='org.staff_invited'", [raw,id]);
      return audit.length;
    }).toBe(1);
    expect(JSON.stringify(audit).includes(raw), "Audit history must not persist redeemable invitation credentials").toBe(false);
    expect(audit[0].object_id === id).toBe(true);
    expect(audit[0].actor_user_id === personas.QA_VENDOR.id).toBe(true);
    const metadata = JSON.parse(audit[0].new_value);
    expect(metadata.orgId === invites[0].org_id).toBe(true);
    expect(metadata.platformRole).toBe("read_only_analyst");
    // Legacy raw-token revocation input must not become audit data. This is
    // the owner's own synthetic invite; no acceptance endpoint is called.
    expect((await actors.QA_VENDOR.delete(`/api/vendor/org/staff/invite/${raw}`)).status()).toBe(200);
    const [pending] = await connection.query<any[]>("SELECT status FROM org_invites WHERE token=?", [raw]);
    expect(pending[0].status).toBe("pending");
    expect((await actors.QA_VENDOR.delete(`/api/vendor/org/staff/invite/${id}`)).status()).toBe(200);
    await expect.poll(async () => {
      [audit] = await connection.query<any[]>("SELECT * FROM audit_log WHERE object_type='org_invite' AND object_id IN (?,?)", [raw,id]);
      return audit.filter(row => row.action === "org.staff_invite_revoked" && row.object_id === id).length;
    }).toBe(1);
    expect(JSON.stringify(audit).includes(raw)).toBe(false);
    expect(audit.length).toBe(2);
  });
});

test("INVITATION-EXISTING: own existing identity is rejected without role, credential or session changes", async ({ playwright }) => {
  await withActors(playwright, ["QA_VENDOR"], async ({ actors, connection, track, snapshot }) => {
    // The authenticated caller IS the intended synthetic recipient. Never use
    // a second person's invitation and never request a higher permission level.
    const [users] = await connection.query<any[]>("SELECT org_id FROM users WHERE id=?", [personas.QA_VENDOR.id]);
    const token = randomBytes(32).toString("hex");
    track("org_invites", "token", token);
    await connection.execute("INSERT INTO org_invites (token,org_id,email,platform_role,expires_at) VALUES (?,?,?,'read_only_analyst',DATE_ADD(NOW(), INTERVAL 1 DAY))", [token, users[0].org_id, env.QA_VENDOR_EMAIL]);
    const identity = await snapshot("SELECT * FROM users WHERE id=?", [personas.QA_VENDOR.id]);
    const sessions = await snapshot("SELECT * FROM sessions WHERE user_id=? ORDER BY token", [personas.QA_VENDOR.id]);
    const invitation = await snapshot("SELECT * FROM org_invites WHERE token=?", [token]);
    const response = await actors.QA_VENDOR.post("/api/auth/accept-invite", { data: { token, name: "QA existing recipient", password: randomBytes(32).toString("hex"), termsAccepted: true } });
    expect(response.status()).toBe(409);
    expect(response.headers()["set-cookie"] === undefined).toBe(true);
    await identity(); await sessions(); await invitation();
  });
});
