import { test, expect, env } from "../fixtures";
import { withInvitation } from "../invitation-fixture";

test("INVITE-CONCURRENCY: intended new recipient accepts exactly once with one session", async ({ playwright }) => {
  await withInvitation(playwright, [], undefined, async f => {
    const contexts = await Promise.all([0,1].map(() => playwright.request.newContext({ baseURL: env.E2E_BASE_URL })));
    try {
      const responses = await Promise.all(contexts.map(c => c.post("/api/auth/accept-invite", { data: f.payload })));
      expect(responses.map(r => r.status()).sort()).toEqual([201,400]);
      const winner = responses.findIndex(r => r.status() === 201), loser = 1-winner;
      const [users] = await f.connection.query<any[]>("SELECT id,org_id,platform_role FROM users WHERE email=?", [f.email]);
      expect(users.length).toBe(1);
      expect(users[0].org_id === f.orgId).toBe(true);
      expect(users[0].platform_role).toBe("read_only_analyst");
      const [sessions] = await f.connection.query<any[]>("SELECT COUNT(*) n FROM sessions WHERE user_id=?", [users[0].id]);
      expect(Number(sessions[0].n)).toBe(1);
      expect(responses[loser].headers()["set-cookie"] === undefined).toBe(true);
      expect((await (await contexts[loser].get("/api/auth/me")).json()).user).toBeNull();
      expect((await (await contexts[winner].get("/api/auth/me")).json()).user.id === users[0].id).toBe(true);
      const account = await f.snapshot("SELECT * FROM users WHERE email=?", [f.email]);
      const session = await f.snapshot("SELECT * FROM sessions WHERE user_id=? ORDER BY token", [users[0].id]);
      const [invites] = await f.connection.query<any[]>("SELECT status FROM org_invites WHERE token=?", [f.token]);
      expect(invites[0].status).toBe("accepted");
      expect((await contexts[loser].post("/api/auth/accept-invite", { data: f.payload })).status()).toBe(400);
      await account(); await session();
    } finally { await Promise.all(contexts.map(c => c.dispose())); }
  });
});
