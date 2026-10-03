import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import { test, expect, env } from "../fixtures";
import { withSecurityIdentity, assertAnonymous, assertLoggedOut, assertRejected, conflict } from "../security-fixture";

test("AUTH-SEC-BROWSER: real signup UI rejects an existing Google identity", async ({ page }) => {
  await withSecurityIdentity("google", async (fixture) => {
    await page.goto("/signin/create");
    await page.getByRole("button", { name: "Necessary only", exact: true }).click();
    await page.getByLabel("Full name", { exact: true }).fill("QA unrelated requester");
    await page.getByLabel("Email address", { exact: true }).fill(fixture.email);
    await page.getByLabel("Password", { exact: true }).fill(fixture.password);
    await page.getByRole("checkbox", { name: "I agree to HelloCircle's Privacy Policy and Terms.", exact: true }).check();
    const response = page.waitForResponse((r) => new URL(r.url()).pathname === "/api/guest/signup" && r.request().method() === "POST");
    await page.getByRole("button", { name: "Create account →", exact: true }).click();
    expect((await response).status()).toBe(409);
    await expect(page.getByRole("alert")).toHaveText(conflict.error);
    await expect(page).toHaveURL(/\/signin\/create$/);
    await assertAnonymous(page.request);
    const state = await page.context().storageState();
    expect(state.origins.every((origin) => origin.localStorage.every((entry) => !/(?:access.?token|refresh.?token|session.?token)/i.test(entry.name)))).toBe(true);
    await fixture.unchanged();
    await fixture.resolveOriginalGoogle();
  });
});

test("AUTH-SEC-003: legitimate new signup and one-time email verification still work", async ({ request }) => {
  await withSecurityIdentity("new", async (fixture) => {
    const signup = await request.post("/api/guest/signup", { data: { email: fixture.email, password: fixture.password, name: "QA legitimate signup", termsAccepted: true } });
    expect(signup.status()).toBe(201);
    expect(Object.keys(await signup.json())).toEqual(["email"]);
    const [rows] = await fixture.connection.query<any[]>("SELECT * FROM residents WHERE email = ?", [fixture.email]);
    expect(rows.length).toBe(1);
    expect(bcrypt.compareSync(fixture.password, rows[0].password_hash)).toBe(true);
    expect(rows[0].google_uid).toBeNull();
    expect(rows[0].email_verified_at).toBeNull();
    expect(!!rows[0].terms_accepted_at).toBe(true);
    expect((await (await request.get("/api/residents/me")).json()).resident.id).toBe(rows[0].id);
    const [tokens] = await fixture.connection.query<any[]>("SELECT token, expires_at > NOW() AS valid, TIMESTAMPDIFF(SECOND, NOW(), expires_at) AS seconds FROM guest_login_tokens WHERE email = ?", [fixture.email]);
    expect(tokens.length).toBe(1);
    expect(/^[a-f0-9]{64}$/.test(tokens[0].token)).toBe(true);
    expect(Number(tokens[0].valid)).toBe(1);
    expect(Number(tokens[0].seconds)).toBeLessThanOrEqual(900);
    expect((await request.post("/api/guest/verify", { data: { token: tokens[0].token } })).status()).toBe(200);
    const [verified] = await fixture.connection.query<any[]>("SELECT email_verified_at FROM residents WHERE email = ?", [fixture.email]);
    expect(!!verified[0].email_verified_at).toBe(true);
    expect((await request.post("/api/guest/verify", { data: { token: tokens[0].token } })).status()).toBe(400);
    await request.post("/api/guest/logout");
    await assertLoggedOut(request);
  });
});

test("AUTH-SEC-RACE: concurrent new signups produce one account and one conflict", async ({ playwright }) => {
  await withSecurityIdentity("new", async (fixture) => {
    const contexts = await Promise.all([0, 1].map(() => playwright.request.newContext({ baseURL: env.E2E_BASE_URL })));
    const passwords = [fixture.password, randomBytes(32).toString("hex")];
    try {
      const responses = await Promise.all(contexts.map((context, index) => context.post("/api/guest/signup", { data: { email: fixture.email, password: passwords[index], termsAccepted: true } })));
      expect(responses.map((response) => response.status()).sort()).toEqual([201, 409]);
      const winner = responses.findIndex((response) => response.status() === 201);
      const loser = 1 - winner;
      await assertRejected(responses[loser], contexts[loser]);
      const [rows] = await fixture.connection.query<any[]>("SELECT id, password_hash FROM residents WHERE email = ?", [fixture.email]);
      expect(rows.length).toBe(1);
      expect(bcrypt.compareSync(passwords[winner], rows[0].password_hash)).toBe(true);
      expect(bcrypt.compareSync(passwords[loser], rows[0].password_hash)).toBe(false);
      const [sessions] = await fixture.connection.query<any[]>("SELECT COUNT(*) AS count FROM guest_sessions WHERE email = ?", [fixture.email]);
      expect(Number(sessions[0].count)).toBe(1);
    } finally { await Promise.all(contexts.map((context) => context.dispose())); }
  });
});

test("AUTH-SEC-PASSWORDLESS: non-Google passwordless identity is protected too", async ({ request }) => {
  await withSecurityIdentity("magic", async (fixture) => {
    await assertRejected(await request.post("/api/guest/signup", { data: { email: fixture.email, password: fixture.password, termsAccepted: true } }), request);
    await fixture.unchanged();
  });
});
