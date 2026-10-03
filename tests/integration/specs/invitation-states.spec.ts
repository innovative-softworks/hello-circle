import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { test, expect, env } from "../fixtures";
import { withInvitation } from "../invitation-fixture";

test("INVITE-STATES: existing member is not changed for same or conflicting role", async ({ playwright }) => {
  await withInvitation(playwright, [], undefined, async f => {
    const id = randomUUID();
    await f.connection.execute("INSERT INTO users (id,email,password_hash,role,status,name,org_id,platform_role,invited_staff) VALUES (?,?,?,'vendor','approved','QA existing staff',?,'read_only_analyst',1)", [id,f.email,bcrypt.hashSync(String(f.payload.password),10),f.orgId]);
    const context = await playwright.request.newContext({ baseURL: env.E2E_BASE_URL });
    try {
      expect((await context.post("/api/auth/login", { data: { email: f.email, password: f.payload.password } })).status()).toBe(200);
      const account = await f.snapshot("SELECT * FROM users WHERE id=?", [id]);
      const sessions = await f.snapshot("SELECT * FROM sessions WHERE user_id=? ORDER BY token", [id]);
      for (const role of ["read_only_analyst", "centre_manager"]) {
        await f.connection.execute("UPDATE org_invites SET platform_role=? WHERE token=?", [role,f.token]);
        const invite = await f.snapshot("SELECT * FROM org_invites WHERE token=?", [f.token]);
        const response = await context.post("/api/auth/accept-invite", { data: f.payload });
        expect(response.status()).toBe(409);
        expect(response.headers()["set-cookie"] === undefined).toBe(true);
        await account(); await sessions(); await invite();
      }
    } finally { await context.dispose(); }
  });
});

test("INVITE-STATES: expired, consumed and revoked credentials never create accounts or sessions", async ({ playwright }) => {
  await withInvitation(playwright, ["GUEST"], undefined, async f => {
    for (const [status, expiry] of [["pending","2000-01-01"],["accepted","2035-01-01"],["revoked","2035-01-01"]]) {
      await f.connection.execute("UPDATE org_invites SET status=?,expires_at=? WHERE token=?", [status,expiry,f.token]);
      const unchanged = await f.snapshot("SELECT * FROM org_invites WHERE token=?", [f.token]);
      const response = await f.actors.GUEST.post("/api/auth/accept-invite", { data: f.payload });
      expect(response.status()).toBe(400);
      expect(response.headers()["set-cookie"] === undefined).toBe(true);
      const [rows] = await f.connection.query<any[]>("SELECT id FROM users WHERE email=?", [f.email]);
      expect(rows.length).toBe(0); await unchanged();
    }
  });
});
