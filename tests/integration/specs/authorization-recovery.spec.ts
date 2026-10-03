import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { test, expect, env } from "../fixtures";
import { withSecurityIdentity } from "../security-fixture";
import { evidence } from "../authorization-fixture";

test("HC-QA-003: one valid recovery token permits only one concurrent reset", async ({ request, playwright }) => {
  await withSecurityIdentity("password", async (fixture) => {
    expect((await request.post("/api/guest/request-password-reset", { data: { email: fixture.email } })).status()).toBe(200);
    const [tokens] = await fixture.connection.query<any[]>("SELECT token FROM resident_password_reset_tokens WHERE email = ?", [fixture.email]);
    expect(tokens.length).toBe(1);
    const other = await playwright.request.newContext({ baseURL: env.E2E_BASE_URL });
    const secondPassword = randomBytes(32).toString("hex");
    try {
      const results = await Promise.all([
        request.post("/api/guest/reset-password", { data: { token: tokens[0].token, password: fixture.password } }),
        other.post("/api/guest/reset-password", { data: { token: tokens[0].token, password: secondPassword } }),
      ]);
      const [after] = await fixture.connection.query<any[]>("SELECT password_hash FROM residents WHERE id = ?", [fixture.id]);
      const [sessions] = await fixture.connection.query<any[]>("SELECT COUNT(*) AS count FROM guest_sessions WHERE email = ?", [fixture.email]);
      const [remaining] = await fixture.connection.query<any[]>("SELECT COUNT(*) AS count FROM resident_password_reset_tokens WHERE email = ?", [fixture.email]);
      const successes = results.filter((result) => result.status() === 200).length;
      const firstIdentity = await (await request.get("/api/residents/me")).json();
      const secondIdentity = await (await other.get("/api/residents/me")).json();
      await evidence("hc-qa-003", { statuses: results.map((result) => result.status()), successfulResets: successes,
        createdSessions: Number(sessions[0].count), remainingTokens: Number(remaining[0].count),
        firstRequesterAuthenticated: firstIdentity.resident?.id === fixture.id,
        secondRequesterAuthenticated: secondIdentity.resident?.id === fixture.id,
        passwordChanged: !bcrypt.compareSync(fixture.originalPassword, after[0].password_hash),
        finalPasswordMatchesOneSubmission: bcrypt.compareSync(fixture.password, after[0].password_hash) || bcrypt.compareSync(secondPassword, after[0].password_hash),
      });
      expect(successes, "One-time recovery token must authorize only one concurrent credential mutation").toBe(1);
      expect(Number(sessions[0].count)).toBe(1);
    } finally { await other.dispose(); }
  });
});
