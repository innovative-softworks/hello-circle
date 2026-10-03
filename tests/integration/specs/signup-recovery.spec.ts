import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { test, expect, env } from "../fixtures";
import { withSecurityIdentity, assertAnonymous, assertLoggedOut, assertRejected } from "../security-fixture";

test("AUTH-SEC-RECOVERY-001: passwordless reset request cannot set credentials or issue a session", async ({ request }) => {
  await withSecurityIdentity("google", async (fixture) => {
    const requested = await request.post("/api/guest/request-password-reset", { data: { email: fixture.email } });
    expect(requested.status()).toBe(200);
    expect(await requested.json()).toEqual({ ok: true });
    const [tokens] = await fixture.connection.query<any[]>("SELECT COUNT(*) AS count FROM resident_password_reset_tokens WHERE email = ?", [fixture.email]);
    expect(Number(tokens[0].count)).toBe(0);
    const attempted = await request.post("/api/guest/reset-password", { data: { email: fixture.email, token: randomBytes(32).toString("hex"), password: fixture.password } });
    await assertRejected(attempted, request, 400);
    await fixture.unchanged();
    await fixture.resolveOriginalGoogle();
  });
});

test("AUTH-SEC-RECOVERY-002: password reset requires an unexpired account-bound token; serial replay rejected", async ({ request, playwright }) => {
  await withSecurityIdentity("password", async (fixture) => {
    expect((await request.post("/api/guest/request-password-reset", { data: { email: fixture.email } })).status()).toBe(200);
    await assertAnonymous(request);
    const [tokens] = await fixture.connection.query<any[]>("SELECT token, TIMESTAMPDIFF(SECOND, NOW(), expires_at) AS seconds FROM resident_password_reset_tokens WHERE email = ?", [fixture.email]);
    expect(tokens.length).toBe(1);
    expect(/^[a-f0-9]{64}$/.test(tokens[0].token)).toBe(true);
    expect(Number(tokens[0].seconds)).toBeGreaterThan(0);
    expect(Number(tokens[0].seconds)).toBeLessThanOrEqual(1800);
    const expired = randomBytes(32).toString("hex");
    await fixture.connection.execute("INSERT INTO resident_password_reset_tokens (token, email, expires_at) VALUES (?, ?, DATE_SUB(NOW(), INTERVAL 1 MINUTE))", [expired, fixture.email]);
    await assertRejected(await request.post("/api/guest/reset-password", { data: { token: expired, password: fixture.password } }), request, 400);
    await fixture.unchanged();
    // QA DB retrieval simulates possession of the emailed secret, not email delivery coverage.
    const reset = await request.post("/api/guest/reset-password", { data: { token: tokens[0].token, email: "unrelated@example.test", password: fixture.password } });
    expect(reset.status()).toBe(200);
    expect((await (await request.get("/api/residents/me")).json()).resident.id).toBe(fixture.id);
    const [after] = await fixture.connection.query<any[]>("SELECT password_hash FROM residents WHERE id = ?", [fixture.id]);
    expect(bcrypt.compareSync(fixture.password, after[0].password_hash)).toBe(true);
    await request.post("/api/guest/logout");
    await assertLoggedOut(request);
    const replay = await playwright.request.newContext({ baseURL: env.E2E_BASE_URL });
    try {
      await assertRejected(await replay.post("/api/guest/reset-password", { data: { token: tokens[0].token, password: fixture.originalPassword } }), replay, 400);
    } finally { await replay.dispose(); }
  });
});
