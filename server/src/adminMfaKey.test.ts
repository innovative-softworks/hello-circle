import crypto from "node:crypto";
import { Secret, TOTP } from "otpauth";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { db } from "./db/index.js";
import { MfaError, confirmEnrolment, mfaKeyProblem, mfaStatus, resetMfa, startEnrolment, verifyForSession } from "./adminMfa.js";

// OG-07 — the two-step key, verified in the isolated test database (disposable
// container, scrubbed env). Keys here are generated per run and never printed:
// assertions only compare outcomes, never key material.

const t = crypto.randomUUID().slice(0, 8);
const adminId = `test-mfakey-${t}`;
const otherSuper = `test-mfakey-super-${t}`;
const session = `test-mfakey-session-${t}`;
const freshKey = () => crypto.randomBytes(32).toString("base64");
const original = { key: process.env.HELLO_CIRCLE_MFA_KEY, node: process.env.NODE_ENV, app: process.env.APP_ENV };
const code = (secret: string, offsetSteps = 0) => new TOTP({ secret: Secret.fromBase32(secret), digits: 6, period: 30, algorithm: "SHA1" }).generate({ timestamp: Date.now() + offsetSteps * 30_000 });

beforeAll(async () => {
  for (const id of [adminId, otherSuper]) {
    await db.prepare(`INSERT INTO users (id, email, password_hash, role, status, name, admin_role) VALUES (?, ?, 'x', 'admin', 'approved', 'MFA key test', 'super')`).run(id, `${id}@example.test`);
  }
  await db.prepare(`INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 1 DAY))`).run(session, adminId);
});

afterEach(() => {
  process.env.NODE_ENV = original.node;
  if (original.app === undefined) delete process.env.APP_ENV;
  else process.env.APP_ENV = original.app;
});

afterAll(async () => {
  if (original.key === undefined) delete process.env.HELLO_CIRCLE_MFA_KEY;
  else process.env.HELLO_CIRCLE_MFA_KEY = original.key;
  await db.prepare(`DELETE FROM admin_mfa_recovery_codes WHERE user_id = ?`).run(adminId);
  await db.prepare(`DELETE FROM sessions WHERE user_id IN (?, ?)`).run(adminId, otherSuper);
  await db.prepare(`DELETE FROM audit_log WHERE object_id = ?`).run(adminId);
  await db.prepare(`DELETE FROM users WHERE id IN (?, ?)`).run(adminId, otherSuper);
});

describe("HELLO_CIRCLE_MFA_KEY", () => {
  it("is checked at boot without revealing it", () => {
    const key = freshKey();
    expect(mfaKeyProblem({ HELLO_CIRCLE_MFA_KEY: key, NODE_ENV: "production" })).toBeNull();
    expect(mfaKeyProblem({ NODE_ENV: "production" })).toMatch(/missing/);
    expect(mfaKeyProblem({ APP_ENV: "staging" })).toMatch(/missing/);
    expect(mfaKeyProblem({ NODE_ENV: "development" }), "local dev may use the fixed development key").toBeNull();
    const short = crypto.randomBytes(16).toString("base64");
    const problem = mfaKeyProblem({ HELLO_CIRCLE_MFA_KEY: short, NODE_ENV: "production" });
    expect(problem).toMatch(/32 random bytes/);
    expect(problem).not.toContain(short);
    expect(mfaKeyProblem({ HELLO_CIRCLE_MFA_KEY: "not base64!!", NODE_ENV: "production" })).toMatch(/32 random bytes/);
  });

  it("refuses to enrol on a deployed server with no key, and with a wrong-length key", async () => {
    delete process.env.HELLO_CIRCLE_MFA_KEY;
    process.env.NODE_ENV = "production";
    await expect(startEnrolment(adminId)).rejects.toMatchObject({ status: 503, message: expect.stringMatching(/isn't configured/) });
    process.env.NODE_ENV = original.node;
    process.env.APP_ENV = "staging";
    await expect(startEnrolment(adminId)).rejects.toMatchObject({ status: 503 });
    process.env.HELLO_CIRCLE_MFA_KEY = crypto.randomBytes(24).toString("base64");
    await expect(startEnrolment(adminId)).rejects.toMatchObject({ status: 503, message: expect.stringMatching(/32 bytes/) });
  });

  it("with a real key: the secret is stored encrypted, enrolment and sign-in work", async () => {
    process.env.HELLO_CIRCLE_MFA_KEY = freshKey();
    process.env.NODE_ENV = "production";
    const { secret } = await startEnrolment(adminId);
    const [stored] = (await db.prepare(`SELECT mfa_pending_secret_enc AS s FROM users WHERE id = ?`).all(adminId)) as { s: string }[];
    expect(stored.s.startsWith("v1.")).toBe(true);
    expect(stored.s, "never stored in clear").not.toContain(secret);
    const { recoveryCodes } = await confirmEnrolment(adminId, code(secret), session);
    expect(recoveryCodes).toHaveLength(10);
    expect((await mfaStatus(adminId, session)).enrolled).toBe(true);
    await expect(verifyForSession(adminId, { code: code(secret, 1) }, session)).resolves.toMatchObject({ usedRecoveryCode: false });
    // Recovery path when the key is later lost: recovery codes don't need the key.
    process.env.HELLO_CIRCLE_MFA_KEY = freshKey();
    const wrong = verifyForSession(adminId, { code: code(secret, 2) }, session);
    await expect(wrong).rejects.toBeInstanceOf(MfaError);
    await expect(verifyForSession(adminId, { code: code(secret, 2) }, session)).rejects.toMatchObject({ status: 500, message: expect.stringMatching(/key changed/) });
    await expect(verifyForSession(adminId, { recoveryCode: recoveryCodes[0] }, session)).resolves.toMatchObject({ usedRecoveryCode: true, recoveryCodesLeft: 9 });
    // …and another super admin can reset two-step so they enrol again under the new key.
    await resetMfa(adminId, otherSuper, "Key rotated after loss (test)");
    const again = await startEnrolment(adminId);
    await db.prepare(`INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 1 DAY))`).run(`${session}-2`, adminId);
    await expect(confirmEnrolment(adminId, code(again.secret), `${session}-2`)).resolves.toMatchObject({ recoveryCodes: expect.any(Array) });
  });
});
