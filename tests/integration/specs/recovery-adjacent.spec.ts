import { randomBytes, randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { test, expect, env } from "../fixtures";
import { withSecurityIdentity, assertAnonymous } from "../security-fixture";
import { withActors } from "../authorization-fixture";

test("RECOVERY-ADJACENT: winning request determines password; loser and replay remain anonymous", async ({ request, playwright }) => {
  await withSecurityIdentity("password", async (f) => {
    expect((await request.post("/api/guest/request-password-reset", { data: { email: f.email } })).status()).toBe(200);
    const [tokens] = await f.connection.query<any[]>("SELECT token FROM resident_password_reset_tokens WHERE email = ?", [f.email]);
    const other = await playwright.request.newContext({ baseURL: env.E2E_BASE_URL });
    try {
      const passwords = [f.password, randomBytes(32).toString("hex")];
      const contexts = [request, other];
      const responses = await Promise.all(contexts.map((context, i) => context.post("/api/guest/reset-password", { data: { token: tokens[0].token, password: passwords[i], email: "not-the-owner@example.test" } })));
      expect(responses.map(r => r.status()).sort()).toEqual([200, 400]);
      const winner = responses.findIndex(r => r.status() === 200);
      const loser = 1 - winner;
      const [rows] = await f.connection.query<any[]>("SELECT password_hash FROM residents WHERE id = ?", [f.id]);
      expect(bcrypt.compareSync(passwords[winner], rows[0].password_hash)).toBe(true);
      expect(bcrypt.compareSync(passwords[loser], rows[0].password_hash)).toBe(false);
      expect(responses[loser].headers()["set-cookie"] === undefined).toBe(true);
      await assertAnonymous(contexts[loser]);
      expect((await (await contexts[winner].get("/api/residents/me")).json()).resident.id === f.id).toBe(true);
      expect((await contexts[loser].post("/api/guest/reset-password", { data: { token: tokens[0].token, password: f.originalPassword } })).status()).toBe(400);
      const [sessions] = await f.connection.query<any[]>("SELECT COUNT(*) AS n FROM guest_sessions WHERE email = ?", [f.email]);
      expect(Number(sessions[0].n)).toBe(1);
    } finally { await other.dispose(); }
  });
});

test("RECOVERY-ADJACENT: independent valid tokens remain bound to different accounts", async ({ playwright }) => {
  await withSecurityIdentity("password", async (a) => withSecurityIdentity("password", async (b) => {
    const contexts = await Promise.all([0, 1].map(() => playwright.request.newContext({ baseURL: env.E2E_BASE_URL })));
    try {
      await Promise.all([a, b].map(async (f, i) => {
        expect((await contexts[i].post("/api/guest/request-password-reset", { data: { email: f.email } })).status()).toBe(200);
      }));
      const tokens = await Promise.all([a, b].map(async f => {
        const [rows] = await f.connection.query<any[]>("SELECT token FROM resident_password_reset_tokens WHERE email = ?", [f.email]);
        return rows[0].token;
      }));
      const results = await Promise.all([a, b].map((f, i) => contexts[i].post("/api/guest/reset-password", { data: { token: tokens[i], password: f.password } })));
      expect(results.map(r => r.status())).toEqual([200, 200]);
      for (const [i, f] of [a, b].entries()) {
        expect((await (await contexts[i].get("/api/residents/me")).json()).resident.id === f.id).toBe(true);
        const [rows] = await f.connection.query<any[]>("SELECT password_hash FROM residents WHERE id = ?", [f.id]);
        expect(bcrypt.compareSync(f.password, rows[0].password_hash)).toBe(true);
      }
    } finally { await Promise.all(contexts.map(c => c.dispose())); }
  }));
});

test("RECOVERY-ADJACENT: vendor reset single-use race; invalid and expired tokens rejected without sessions", async ({ playwright }) => {
  await withActors(playwright, [], async ({ connection, track }) => {
    const id = randomUUID();
    const email = `qa_recovery_${id}@example.test`;
    const token = randomBytes(32).toString("hex");
    const passwords = [randomBytes(32).toString("hex"), randomBytes(32).toString("hex")];
    await connection.execute("INSERT INTO users (id,email,password_hash,role,status,name) VALUES (?, ?, ?, 'vendor','approved','QA recovery')", [id, email, bcrypt.hashSync(randomBytes(32).toString("hex"), 10)]);
    track("users", "id", id);
    track("password_reset_tokens", "user_id", id);
    track("sessions", "user_id", id);
    await connection.execute("INSERT INTO password_reset_tokens (token,user_id,expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 30 MINUTE))", [token, id]);
    const contexts = await Promise.all([0, 1].map(() => playwright.request.newContext({ baseURL: env.E2E_BASE_URL })));
    try {
      const responses = await Promise.all(contexts.map((c, i) => c.post("/api/auth/reset-password", { data: { token, password: passwords[i] } })));
      expect(responses.map(r => r.status()).sort()).toEqual([200, 400]);
      const winner = responses.findIndex(r => r.status() === 200);
      const [rows] = await connection.query<any[]>("SELECT password_hash FROM users WHERE id = ?", [id]);
      expect(bcrypt.compareSync(passwords[winner], rows[0].password_hash)).toBe(true);
      expect(bcrypt.compareSync(passwords[1 - winner], rows[0].password_hash)).toBe(false);
      expect((await contexts[0].post("/api/auth/reset-password", { data: { token, password: passwords[0] } })).status()).toBe(400);
      const expired = randomBytes(32).toString("hex");
      await connection.execute("INSERT INTO password_reset_tokens (token,user_id,expires_at) VALUES (?, ?, DATE_SUB(NOW(), INTERVAL 1 MINUTE))", [expired, id]);
      for (const invalid of [expired, randomBytes(32).toString("hex")]) expect((await contexts[0].post("/api/auth/reset-password", { data: { token: invalid, password: passwords[0] } })).status()).toBe(400);
      const [sessions] = await connection.query<any[]>("SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?", [id]);
      expect(Number(sessions[0].n)).toBe(0);
      for (const c of contexts) expect((await c.storageState()).cookies.length).toBe(0);
    } finally { await Promise.all(contexts.map(c => c.dispose())); }
  });
});
