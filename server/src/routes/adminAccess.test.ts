import crypto from "node:crypto";
import http, { type Server } from "node:http";
import express from "express";
import cookieParser from "cookie-parser";
import { Secret, TOTP } from "otpauth";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const sent: { to: string; text: string }[] = [];
vi.mock("../email.js", async (orig) => ({ ...(await orig<typeof import("../email.js")>()), sendMail: async (m: { to: string; text: string }) => void sent.push(m) }));

const { db, setSetting } = await import("../db/index.js");
const { SESSION_COOKIE, attachUser, createSession, createUser } = await import("../auth.js");
const { MFA_SETTING, clearMfaSettingCache } = await import("../adminMfa.js");
const { adminInviteRouter, adminMfaRouter } = await import("./adminAccess.js");
const { adminRouter } = await import("./admin.js");

// OG-06 / OG-07 — admins join by a super admin's single-use invitation, and
// no admin tool opens until two-step sign-in (TOTP) is done; codes can't be
// replayed, wrong codes lock, recovery codes are single use, and sensitive
// changes need a recent code.

let server: Server;
let baseUrl: string;
const t = crypto.randomUUID().slice(0, 8);
const superEmail = `test-mfa-super-${t}@example.test`;
let superId = "";
let secret = "";
const createdEmails: string[] = [superEmail];

const call = (path: string, token: string, init: RequestInit = {}) =>
  fetch(`${baseUrl}${path}`, { ...init, headers: { "Content-Type": "application/json", Cookie: `${SESSION_COOKIE}=${token}`, ...(init.headers ?? {}) } });
const totp = () => new TOTP({ secret: Secret.fromBase32(secret), digits: 6, period: 30, algorithm: "SHA1" });
/** The current code, after forgetting the last accepted time step (as if the
 * next 30-second window had arrived), so a test needn't wait for the clock. */
const nextCode = async (userId = superId) => {
  await db.prepare(`UPDATE users SET mfa_last_step = NULL WHERE id = ?`).run(userId);
  return totp().generate();
};

beforeAll(async () => {
  await setSetting(MFA_SETTING, "true");
  clearMfaSettingCache();
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use(attachUser);
  app.use("/auth/mfa", adminMfaRouter);
  app.use("/auth/admin-invite", adminInviteRouter);
  app.use("/admin", adminRouter);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("no port");
  baseUrl = `http://127.0.0.1:${address.port}`;
  superId = (await createUser(superEmail, "a-long-password-123", "MFA Super", "admin", "approved")).id;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  for (const email of createdEmails) {
    const u = (await db.prepare(`SELECT id FROM users WHERE email = ?`).get(email)) as { id: string } | undefined;
    if (!u) continue;
    await db.prepare(`DELETE FROM sessions WHERE user_id = ?`).run(u.id);
    await db.prepare(`DELETE FROM admin_mfa_recovery_codes WHERE user_id = ?`).run(u.id);
    await db.prepare(`DELETE FROM users WHERE id = ?`).run(u.id);
  }
  await db.prepare(`DELETE FROM admin_invites WHERE email LIKE ?`).run(`%${t}%`);
  // The isolated test database is disposable, but leave the default as found.
  await setSetting(MFA_SETTING, "true");
  clearMfaSettingCache();
});

describe("two-step sign-in", () => {
  let session = "";
  let recovery: string[] = [];

  it("an unverified admin session opens no admin tool", async () => {
    session = (await createSession(superId)).token;
    const r = await call("/admin/stats", session);
    expect(r.status).toBe(403);
    expect(await r.json()).toMatchObject({ mfaRequired: true });
  });

  it("enrolment needs a valid code, then returns ten recovery codes and opens the tools", async () => {
    const start = await (await call("/auth/mfa/enrol/start", session, { method: "POST" })).json();
    expect(start.otpauthUri).toMatch(/^otpauth:\/\/totp\/HelloCircle/);
    secret = start.secret;
    expect((await call("/auth/mfa/enrol/confirm", session, { method: "POST", body: JSON.stringify({ code: "000000" }) })).status).toBe(400);
    const ok = await call("/auth/mfa/enrol/confirm", session, { method: "POST", body: JSON.stringify({ code: await nextCode() }) });
    expect(ok.status).toBe(200);
    recovery = (await ok.json()).recoveryCodes;
    expect(recovery).toHaveLength(10);
    expect((await call("/admin/stats", session)).status).toBe(200);
    // A second enrolment can't replace the authenticator.
    expect((await call("/auth/mfa/enrol/start", session, { method: "POST" })).status).toBe(409);
  });

  it("refuses a replayed code", async () => {
    const fresh = (await createSession(superId)).token;
    const code = await nextCode();
    expect((await call("/auth/mfa/verify", fresh, { method: "POST", body: JSON.stringify({ code }) })).status).toBe(200);
    const again = (await createSession(superId)).token;
    const r = await call("/auth/mfa/verify", again, { method: "POST", body: JSON.stringify({ code }) });
    expect(r.status).toBe(400);
    expect((await r.json()).error).toMatch(/already used/);
  });

  it("a recovery code works once", async () => {
    const a = (await createSession(superId)).token;
    expect((await call("/auth/mfa/verify", a, { method: "POST", body: JSON.stringify({ recoveryCode: recovery[0] }) })).status).toBe(200);
    const b = (await createSession(superId)).token;
    expect((await call("/auth/mfa/verify", b, { method: "POST", body: JSON.stringify({ recoveryCode: recovery[0] }) })).status).toBe(400);
  });

  it("asks for a fresh code before a sensitive change", async () => {
    await db.prepare(`UPDATE sessions SET mfa_verified_at = NOW() - INTERVAL 40 MINUTE WHERE token = ?`).run(session);
    expect((await call("/admin/stats", session)).status).toBe(200); // reading is fine
    const r = await call("/admin/admins/invites", session, { method: "POST", body: JSON.stringify({ email: `x-${t}@example.test`, adminRole: "support" }) });
    expect(r.status).toBe(403);
    expect(await r.json()).toMatchObject({ mfaReauth: true });
    expect((await call("/auth/mfa/verify", session, { method: "POST", body: JSON.stringify({ code: await nextCode() }) })).status).toBe(200);
  });

  it("locks code entry after five wrong codes", async () => {
    const s = (await createSession(superId)).token;
    for (let i = 0; i < 5; i++) await call("/auth/mfa/verify", s, { method: "POST", body: JSON.stringify({ code: "123456" }) });
    expect((await call("/auth/mfa/verify", s, { method: "POST", body: JSON.stringify({ code: await nextCode() }) })).status).toBe(429);
    await db.prepare(`UPDATE users SET mfa_locked_until = NULL, mfa_failures = 0 WHERE id = ?`).run(superId);
  });
});

describe("admin invitations", () => {
  let superSession = "";
  const inviteEmail = `test-mfa-invitee-${t}@example.test`;

  beforeAll(async () => {
    superSession = (await createSession(superId)).token;
    await call("/auth/mfa/verify", superSession, { method: "POST", body: JSON.stringify({ code: await nextCode() }) });
    createdEmails.push(inviteEmail);
  });

  it("only a super admin invites; the link is single use and the role can't be changed", async () => {
    const r = await call("/admin/admins/invites", superSession, { method: "POST", body: JSON.stringify({ email: inviteEmail, adminRole: "finance" }) });
    expect(r.status).toBe(201);
    const mail = sent.find((m) => m.to === inviteEmail)!;
    const token = /token=([a-f0-9]{64})/.exec(mail.text)![1];
    expect(await (await fetch(`${baseUrl}/auth/admin-invite?token=${token}`)).json()).toEqual({ email: inviteEmail, adminRole: "finance" });
    const accept = await fetch(`${baseUrl}/auth/admin-invite/accept`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, name: "New Finance", password: "another-long-password", adminRole: "super" }) });
    expect(accept.status).toBe(201);
    const body = await accept.json();
    expect(body.user).toMatchObject({ email: inviteEmail, adminRole: "finance" });
    const reuse = await fetch(`${baseUrl}/auth/admin-invite/accept`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, name: "Again", password: "another-long-password" }) });
    expect(reuse.status).toBe(410);
    // The new admin's session opens nothing until they set up two-step sign-in.
    const cookie = accept.headers.get("set-cookie")!.split(";")[0].split("=")[1];
    expect((await call("/admin/stats", cookie)).status).toBe(403);
    const audit = (await db.prepare(`SELECT action FROM audit_log WHERE action IN ('admin.invited', 'admin.invite_accepted') AND object_type = 'admin_invite' ORDER BY id DESC LIMIT 2`).all()) as { action: string }[];
    expect(audit.map((a) => a.action).sort()).toEqual(["admin.invite_accepted", "admin.invited"]);
  });

  it("refuses an email that already has an account, and revoked links stop working", async () => {
    expect((await call("/admin/admins/invites", superSession, { method: "POST", body: JSON.stringify({ email: superEmail, adminRole: "support" }) })).status).toBe(409);
    const email = `test-mfa-revoked-${t}@example.test`;
    await call("/admin/admins/invites", superSession, { method: "POST", body: JSON.stringify({ email, adminRole: "support" }) });
    const token = /token=([a-f0-9]{64})/.exec(sent.find((m) => m.to === email)!.text)![1];
    const list = await (await call("/admin/admins/invites", superSession)).json();
    const invite = list.find((i: { email: string }) => i.email === email);
    expect((await call(`/admin/admins/invites/${invite.id}`, superSession, { method: "DELETE" })).status).toBe(200);
    expect((await fetch(`${baseUrl}/auth/admin-invite?token=${token}`)).status).toBe(410);
  });
});
