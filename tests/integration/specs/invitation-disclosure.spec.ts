import { randomUUID, randomBytes, createHash } from "node:crypto";
import bcrypt from "bcryptjs";
import { test, expect, env, personas } from "../fixtures";
import { withActors, evidence } from "../authorization-fixture";

test("INVITATION-DISCLOSURE: organisation reads never expose redemption credentials", async ({ playwright }) => {
  await withActors(playwright, ["QA_VENDOR", "QA_USER", "GUEST"], async ({ actors, connection, track, snapshot }) => {
    const [owners] = await connection.query<any[]>("SELECT org_id FROM users WHERE id = ?", [personas.QA_VENDOR.id]);
    const recipient = `qa_invite_${randomUUID()}@example.test`;
    track("org_invites", "email", recipient);
    expect((await actors.QA_VENDOR.post("/api/vendor/org/staff/invite", { data: { email: recipient, platformRole: "centre_manager" } })).status()).toBe(201);
    const [rows] = await connection.query<any[]>("SELECT * FROM org_invites WHERE email = ?", [recipient]);
    expect(rows.length).toBe(1);
    const secret = rows[0].token;
    track("audit_log", "object_id", secret);
    const unchanged = await snapshot("SELECT * FROM org_invites WHERE email = ?", [recipient]);
    for (const role of ["read_only_analyst", "centre_manager"]) {
      const id = randomUUID(), password = randomBytes(32).toString("hex"), email = `qa_staff_${id}@example.test`;
      track("users", "id", id); track("sessions", "user_id", id);
      await connection.execute("INSERT INTO users (id,email,password_hash,role,status,name,org_id,platform_role,invited_staff) VALUES (?,?,?,'vendor','approved','QA invitation reader',?,?,1)", [id,email,bcrypt.hashSync(password,10),owners[0].org_id,role]);
      const staff = await playwright.request.newContext({ baseURL: env.E2E_BASE_URL });
      try {
        expect((await staff.post("/api/auth/login", { data: {email,password} })).status()).toBe(200);
        const response = await staff.get("/api/vendor/org");
        expect(response.status()).toBe(200);
        const body = await response.json();
        const exposed = JSON.stringify(body).includes(secret);
        await evidence(`invitation-${role.replaceAll("_", "-")}`, { rawTokenExposed: exposed, redemptionAttempted: false });
        expect(exposed, "Organisation read must not disclose invitation credential").toBe(false);
        expect(body.pendingInvites.length).toBe(0);
        expect(/accept-invite|[?&]token=/.test(JSON.stringify(body))).toBe(false);
        const managementId = createHash("sha256").update(secret).digest("hex");
        expect((await staff.delete(`/api/vendor/org/staff/invite/${managementId}`)).status()).toBe(403);
        await unchanged();
      } finally { await staff.dispose(); }
    }
    for (const actor of [actors.QA_USER, actors.GUEST]) {
      const response = await actor.get("/api/vendor/org");
      expect(response.status()).toBe(401);
      expect((await response.text()).includes(secret)).toBe(false);
    }
    const body = await (await actors.QA_VENDOR.get("/api/vendor/org")).json();
    expect(JSON.stringify(body).includes(secret)).toBe(false);
    expect(/accept-invite|[?&]token=/.test(JSON.stringify(body))).toBe(false);
    const metadata = body.pendingInvites.find((i: any) => i.email === recipient);
    expect(Object.keys(metadata).sort()).toEqual(["createdAt", "email", "expiresAt", "id", "platformRole", "status"].sort());
    expect(metadata.platformRole).toBe("centre_manager");
    expect(metadata.status).toBe("pending");
    expect(metadata.id === createHash("sha256").update(secret).digest("hex")).toBe(true);
    // Read-only lookup only: never redeem an invitation or assume its identity.
    expect((await actors.GUEST.get(`/api/invites/${metadata.id}`)).status()).toBe(404);
    await unchanged();
    track("audit_log", "object_id", metadata.id);
    expect((await actors.QA_VENDOR.delete(`/api/vendor/org/staff/invite/${metadata.id}`)).status()).toBe(200);
    const [after] = await connection.query<any[]>("SELECT status FROM org_invites WHERE email = ?", [recipient]);
    expect(after[0].status).toBe("revoked");
  });
});
