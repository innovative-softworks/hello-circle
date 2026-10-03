import { test, expect, env, personas } from "../fixtures";
import { withInvitation } from "../invitation-fixture";

test("INVITE-BINDING: conflicting authenticated recipient is denied; intended resident can onboard", async ({ playwright }) => {
  await withInvitation(playwright, ["QA_USER", "QA_USER_B", "QA_VENDOR"], env.QA_USER_EMAIL, async f => {
    const invitation = await f.snapshot("SELECT * FROM org_invites WHERE token=?", [f.token]);
    const accounts = await f.snapshot("SELECT * FROM users WHERE email=? OR id=?", [f.email,personas.QA_VENDOR.id]);
    const residents = await f.snapshot("SELECT * FROM residents WHERE id IN (?,?) ORDER BY id", [personas.QA_USER.id,personas.QA_USER_B.id]);
    const sessions = await f.snapshot("SELECT * FROM sessions WHERE user_id=? ORDER BY token", [personas.QA_VENDOR.id]);
    const guestSessions = await f.snapshot("SELECT * FROM guest_sessions WHERE email IN (?,?) ORDER BY token", [env.QA_USER_EMAIL,env.QA_USER_B_EMAIL]);
    for (const actor of [f.actors.QA_USER_B, f.actors.QA_VENDOR]) {
      const response = await actor.post("/api/auth/accept-invite", { data: f.payload });
      expect(response.status()).toBe(403);
      expect(response.headers()["set-cookie"] === undefined).toBe(true);
      expect((await response.text()).includes(f.email)).toBe(false);
      await invitation(); await accounts(); await residents(); await sessions(); await guestSessions();
    }
    // A browser holding A's resident session AND B's vendor session must fail closed.
    const mixed = await playwright.request.newContext({ baseURL: env.E2E_BASE_URL, storageState: {
      cookies: [...(await f.actors.QA_USER.storageState()).cookies, ...(await f.actors.QA_VENDOR.storageState()).cookies], origins: [] } });
    try {
      expect((await mixed.post("/api/auth/accept-invite", { data: f.payload })).status()).toBe(403);
      await invitation(); await accounts(); await residents(); await sessions(); await guestSessions();
    } finally { await mixed.dispose(); }
    // Normalization uses the server identity, never a client-supplied email.
    await f.connection.execute("UPDATE org_invites SET email=? WHERE token=?", [` ${f.email.toUpperCase()} `,f.token]);
    const response = await f.actors.QA_USER.post("/api/auth/accept-invite", { data: { ...f.payload, role: "admin", orgId: "ignored", platformRole: "centre_manager" } });
    expect(response.status()).toBe(201);
    const [users] = await f.connection.query<any[]>("SELECT id,org_id,platform_role,invited_staff,email FROM users WHERE email=?", [f.email]);
    expect(users.length).toBe(1);
    expect(users[0].org_id === f.orgId).toBe(true);
    expect(users[0].platform_role).toBe("read_only_analyst");
    expect(Number(users[0].invited_staff)).toBe(1);
    expect((await (await f.actors.QA_USER.get("/api/auth/me")).json()).user.id === users[0].id).toBe(true);
    await residents();
  });
});
