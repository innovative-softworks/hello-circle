import type { APIRequestContext } from "@playwright/test";
import { test, expect, personas, env } from "../fixtures";
import { withActors, evidence } from "../authorization-fixture";
import { staffLogin } from "../stage-b-fixture";

test("CLOSURE-LINK-RACE: competing confirmations serialize and stale tokens cannot replace a link", async ({ playwright }) => {
  const opened: APIRequestContext[] = [];
  try {
    await withActors(playwright, ["GUEST"], async f => {
      const accounts = [await staffLogin(playwright, f, null, null, opened), await staffLogin(playwright, f, null, null, opened)];
      const tokens: { id: string; first: string; replacement: string }[] = [];
      for (const account of accounts) {
        f.track("manage_link_tokens", "user_id", account.id);
        for (const email of [env.QA_USER_EMAIL, env.QA_USER_B_EMAIL]) expect((await account.context.post("/api/manage/link/request", { data: { residentEmail: email } })).status()).toBe(200);
        const [rows] = await f.connection.query<any[]>("SELECT token, resident_email FROM manage_link_tokens WHERE user_id = ?", [account.id]);
        tokens.push({ id: account.id, first: rows.find(row => row.resident_email === env.QA_USER_EMAIL).token, replacement: rows.find(row => row.resident_email === env.QA_USER_B_EMAIL).token });
      }
      const confirm = (token: string) => f.actors.GUEST.post("/api/manage/link/confirm", { data: { token } });
      const results = await Promise.all(tokens.map(token => confirm(token.first)));
      expect(results.map(r => r.status()).sort()).toEqual([200, 409]);
      for (const result of results) expect(result.headers()["set-cookie"]).toBeUndefined();
      const winner = tokens[results.findIndex(r => r.status() === 200)];
      const invariant = await f.snapshot("SELECT * FROM users WHERE id IN (?, ?) ORDER BY id", accounts.map(a => a.id));
      const resident = await f.snapshot("SELECT * FROM residents WHERE id IN (?, ?) ORDER BY id", [personas.QA_USER.id, personas.QA_USER_B.id]);
      const sessions = await f.snapshot("SELECT * FROM sessions ORDER BY token", []);
      expect((await confirm(winner.replacement)).status()).toBe(409);
      await invariant(); await resident(); await sessions();
      const [links] = await f.connection.query<any[]>("SELECT id FROM users WHERE resident_id = ?", [personas.QA_USER.id]);
      expect(links.length).toBe(1);
      expect((await confirm(winner.first)).status()).toBe(400);
      await evidence("closure-link-race", { statuses: results.map(r => r.status()).sort(), linkedVendorCount: links.length, replacementDenied: true, replayDenied: true });
    });
  } finally { for (const context of opened) await context.dispose(); }
});
