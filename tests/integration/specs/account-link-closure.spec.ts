import type { APIRequestContext } from "@playwright/test";
import { test, expect, personas, env } from "../fixtures";
import { withActors, evidence } from "../authorization-fixture";
import { staffLogin } from "../stage-b-fixture";

test("CLOSURE-LINK: stale confirmation cannot attach a second vendor to an already linked resident", async ({ playwright }) => {
  const opened: APIRequestContext[] = [];
  try {
    await withActors(playwright, ["QA_USER", "QA_USER_B", "GUEST"], async f => {
      const A = await staffLogin(playwright, f, null, null, opened);
      const B = await staffLogin(playwright, f, null, null, opened);
      for (const account of [A, B]) f.track("manage_link_tokens", "user_id", account.id);
      const [existing] = await f.connection.query<any[]>("SELECT id FROM users WHERE resident_id IN (?, ?)", [personas.QA_USER.id, personas.QA_USER_B.id]);
      expect(existing.length).toBe(0);
      const identity = await f.snapshot("SELECT * FROM residents WHERE id IN (?, ?) ORDER BY id", [personas.QA_USER.id, personas.QA_USER_B.id]);
      for (const account of [A, B]) expect((await account.context.post("/api/manage/link/request", { data: { residentEmail: env.QA_USER_EMAIL } })).status()).toBe(200);
      const [tokens] = await f.connection.query<any[]>("SELECT token, user_id FROM manage_link_tokens WHERE user_id IN (?, ?)", [A.id, B.id]);
      const tokenA = tokens.find(row => row.user_id === A.id).token, tokenB = tokens.find(row => row.user_id === B.id).token;
      const confirm = (token: string) => f.actors.GUEST.post("/api/manage/link/confirm", { data: { token } });
      expect((await confirm(tokenA)).status()).toBe(200);
      const links = await f.snapshot("SELECT * FROM users WHERE id IN (?, ?) ORDER BY id", [A.id, B.id]);
      const sessions = await f.snapshot("SELECT * FROM sessions ORDER BY token", []);
      const guestSessions = await f.snapshot("SELECT * FROM guest_sessions ORDER BY token", []);
      const response = await confirm(tokenB);
      const [after] = await f.connection.query<any[]>("SELECT id FROM users WHERE resident_id = ?", [personas.QA_USER.id]);
      await evidence("closure-account-link", { staleStatus: response.status(), linkedVendorCount: after.length, sessionCookieIssued: response.headers()["set-cookie"] !== undefined });
      expect(response.status()).toBe(409);
      expect(after.length).toBe(1);
      await links(); await identity(); await sessions(); await guestSessions();
      expect(response.headers()["set-cookie"]).toBeUndefined();
      expect((await confirm(tokenA)).status()).toBe(400);
    });
  } finally { for (const context of opened) await context.dispose(); }
});
