import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { Secret, TOTP } from "otpauth";
import { writeAudit } from "./audit.js";
import { db, getSetting } from "./db/index.js";

// OG-07 / DEC-11 — authenticator-app (TOTP, RFC 6238) multi-factor
// authentication for HelloCircle admins. TOTP itself comes from the
// maintained `otpauth` library; secrets are encrypted at rest with Node's
// AES-256-GCM. Nothing here implements its own cryptography.
//
// Model:
// - Signing in (password or Google) still creates a session, but an admin's
//   session is *unverified* until a code is entered. Every admin API refuses an
//   unverified session (adminPermissions.ts), so a stolen password alone opens
//   nothing.
// - Every admin role requires MFA (they all reach personal or money data).
// - A code is accepted once: each account remembers the last TOTP time step it
//   accepted, and a code from the same or an earlier step is refused (replay).
// - Five wrong codes lock code entry for 15 minutes.
// - Ten single-use recovery codes are issued at enrolment, stored as bcrypt
//   hashes. A super admin can reset another admin's MFA (with a reason), and
//   that admin enrols again at next sign-in.
// - Sensitive writes need a verification in the last 30 minutes ("step up").
//
// `security.admin_mfa_required` (app_settings, default "true") exists only so
// the isolated QA database can run the non-MFA suites; there is no API or
// screen that changes it.

export const MFA_SETTING = "security.admin_mfa_required";
export const STEP_UP_MINUTES = 30;
const ISSUER = "HelloCircle";
const LOCK_AFTER = 5;
const LOCK_MINUTES = 15;
const RECOVERY_CODES = 10;

let settingCache: { value: boolean; at: number } | null = null;

/** Whether admin MFA is enforced (cached for 5 s). */
export async function adminMfaRequired(): Promise<boolean> {
  if (settingCache && Date.now() - settingCache.at < 5000) return settingCache.value;
  const value = (await getSetting(MFA_SETTING, "true")) !== "false";
  settingCache = { value, at: Date.now() };
  return value;
}

export function clearMfaSettingCache() {
  settingCache = null;
}

// --- secret storage ------------------------------------------------------------

let devKeyWarned = false;
function encryptionKey(): Buffer {
  const raw = process.env.HELLO_CIRCLE_MFA_KEY;
  if (raw) {
    const key = Buffer.from(raw, "base64");
    if (key.length !== 32) throw new MfaError("HELLO_CIRCLE_MFA_KEY must be 32 bytes, base64-encoded", 503);
    return key;
  }
  if (process.env.NODE_ENV === "production" || process.env.APP_ENV === "staging") {
    throw new MfaError("Two-step sign-in isn't configured on this server (HELLO_CIRCLE_MFA_KEY is missing)", 503);
  }
  if (!devKeyWarned) {
    console.warn("[mfa] HELLO_CIRCLE_MFA_KEY is not set — using a fixed development key. Never use this outside local development.");
    devKeyWarned = true;
  }
  return crypto.createHash("sha256").update("hello-circle-local-development-mfa-key").digest();
}

function seal(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), body.toString("base64")].join(".");
}

function unseal(sealed: string): string {
  const [v, iv, tag, body] = sealed.split(".");
  if (v !== "v1" || !iv || !tag || !body) throw new MfaError("Stored two-step secret is unreadable", 500);
  const key = encryptionKey();
  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64"));
    decipher.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(body, "base64")), decipher.final()]).toString("utf8");
  } catch {
    // GCM authentication failed: the secret was sealed with a different key.
    throw new MfaError(
      "This server's HELLO_CIRCLE_MFA_KEY can't read the stored two-step secret (the key changed). Restore the previous key, or sign in with a recovery code and ask another super admin to reset two-step sign-in.",
      500
    );
  }
}

/** What's wrong with the configured key, for a boot-time log line — never the key itself. */
export function mfaKeyProblem(env: NodeJS.ProcessEnv = process.env): string | null {
  const raw = env.HELLO_CIRCLE_MFA_KEY;
  const deployed = env.NODE_ENV === "production" || env.APP_ENV === "staging";
  if (!raw) return deployed ? "HELLO_CIRCLE_MFA_KEY is missing: admin two-step sign-in will refuse every admin until it is set" : null;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(raw.trim()) || Buffer.from(raw, "base64").length !== 32) return "HELLO_CIRCLE_MFA_KEY must be exactly 32 random bytes, base64-encoded (openssl rand -base64 32)";
  return null;
}

export class MfaError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

function totpFor(secretBase32: string, email: string) {
  return new TOTP({ issuer: ISSUER, label: email, algorithm: "SHA1", digits: 6, period: 30, secret: Secret.fromBase32(secretBase32) });
}

const currentStep = (now = Date.now()) => Math.floor(now / 1000 / 30);

// --- state ---------------------------------------------------------------------

interface MfaRow {
  secret: string | null;
  pending: string | null;
  enabledAt: string | null;
  lastStep: number | null;
  failures: number | null;
  lockedUntil: string | Date | null;
  email: string;
}

async function mfaRow(userId: string): Promise<MfaRow> {
  const row = (await db
    .prepare(
      `SELECT mfa_secret_enc as secret, mfa_pending_secret_enc as pending, mfa_enabled_at as enabledAt, mfa_last_step as lastStep,
              mfa_failures as failures, mfa_locked_until as lockedUntil, email
       FROM users WHERE id = ? AND role = 'admin'`
    )
    .get(userId)) as MfaRow | undefined;
  if (!row) throw new MfaError("Admin account not found", 404);
  return row;
}

export interface MfaStatus {
  required: boolean;
  enrolled: boolean;
  /** This session has entered a code. */
  verified: boolean;
  /** Minutes since this session last entered a code (null if never). */
  verifiedMinutesAgo: number | null;
  recoveryCodesLeft: number;
}

export async function mfaStatus(userId: string, sessionToken: string | undefined): Promise<MfaStatus> {
  const [required, row] = await Promise.all([adminMfaRequired(), mfaRow(userId)]);
  const session = sessionToken
    ? ((await db.prepare(`SELECT TIMESTAMPDIFF(MINUTE, mfa_verified_at, NOW()) as ago FROM sessions WHERE token = ? AND mfa_verified_at IS NOT NULL`).get(sessionToken)) as { ago: number } | undefined)
    : undefined;
  const left = (await db.prepare(`SELECT COUNT(*) as n FROM admin_mfa_recovery_codes WHERE user_id = ? AND used_at IS NULL`).get(userId)) as { n: number | string };
  return { required, enrolled: !!row.secret, verified: !!session, verifiedMinutesAgo: session ? Number(session.ago) : null, recoveryCodesLeft: Number(left.n) };
}

function assertNotLocked(row: MfaRow) {
  if (row.lockedUntil && new Date(row.lockedUntil).getTime() > Date.now()) {
    throw new MfaError("Too many wrong codes. Wait 15 minutes, then try again.", 429);
  }
}

async function recordFailure(userId: string, row: MfaRow) {
  const failures = (row.failures ?? 0) + 1;
  if (failures >= LOCK_AFTER) {
    await db.prepare(`UPDATE users SET mfa_failures = 0, mfa_locked_until = DATE_ADD(NOW(), INTERVAL ${LOCK_MINUTES} MINUTE) WHERE id = ?`).run(userId);
    await writeAudit({ actorUserId: userId, action: "admin.mfa_locked", objectType: "user", objectId: userId, newValue: { minutes: LOCK_MINUTES } });
  } else {
    await db.prepare(`UPDATE users SET mfa_failures = ? WHERE id = ?`).run(failures, userId);
  }
}

async function markSessionVerified(sessionToken: string) {
  await db.prepare(`UPDATE sessions SET mfa_verified_at = NOW() WHERE token = ?`).run(sessionToken);
}

// --- enrolment -------------------------------------------------------------------

/** Starts (or restarts) enrolment: a new secret, kept pending until a code confirms it. */
export async function startEnrolment(userId: string): Promise<{ otpauthUri: string; secret: string }> {
  const row = await mfaRow(userId);
  if (row.secret) throw new MfaError("Two-step sign-in is already set up for this account", 409);
  const secret = new Secret({ size: 20 }).base32;
  await db.prepare(`UPDATE users SET mfa_pending_secret_enc = ? WHERE id = ?`).run(seal(secret), userId);
  return { otpauthUri: totpFor(secret, row.email).toString(), secret };
}

function newRecoveryCode(): string {
  const raw = crypto.randomBytes(5).toString("hex").toUpperCase(); // 10 hex chars
  return `${raw.slice(0, 5)}-${raw.slice(5)}`;
}

async function issueRecoveryCodes(userId: string): Promise<string[]> {
  const codes = Array.from({ length: RECOVERY_CODES }, newRecoveryCode);
  await db.transaction(async (tx) => {
    await tx.prepare(`DELETE FROM admin_mfa_recovery_codes WHERE user_id = ?`).run(userId);
    for (const c of codes) {
      await tx.prepare(`INSERT INTO admin_mfa_recovery_codes (user_id, code_hash) VALUES (?, ?)`).run(userId, bcrypt.hashSync(c.replace("-", ""), 10));
    }
  });
  return codes;
}

/** Confirms enrolment with a code from the app; returns the recovery codes (shown once). */
export async function confirmEnrolment(userId: string, code: string, sessionToken: string): Promise<{ recoveryCodes: string[] }> {
  const row = await mfaRow(userId);
  assertNotLocked(row);
  if (row.secret) throw new MfaError("Two-step sign-in is already set up for this account", 409);
  if (!row.pending) throw new MfaError("Start the set-up again", 409);
  const secret = unseal(row.pending);
  const delta = totpFor(secret, row.email).validate({ token: normaliseCode(code), window: 1 });
  if (delta === null) {
    await recordFailure(userId, row);
    throw new MfaError("That code didn't match. Check the time on your phone and try the newest code.");
  }
  const step = currentStep() + delta;
  await db
    .prepare(`UPDATE users SET mfa_secret_enc = mfa_pending_secret_enc, mfa_pending_secret_enc = NULL, mfa_enabled_at = NOW(), mfa_last_step = ?, mfa_failures = 0, mfa_locked_until = NULL WHERE id = ?`)
    .run(step, userId);
  const recoveryCodes = await issueRecoveryCodes(userId);
  await markSessionVerified(sessionToken);
  await writeAudit({ actorUserId: userId, action: "admin.mfa_enrolled", objectType: "user", objectId: userId });
  return { recoveryCodes };
}

const normaliseCode = (code: string) => code.replace(/\s+/g, "");

/** Verifies a code (or a recovery code) and marks the session verified. */
export async function verifyForSession(userId: string, input: { code?: string; recoveryCode?: string }, sessionToken: string): Promise<{ usedRecoveryCode: boolean; recoveryCodesLeft: number | null }> {
  const row = await mfaRow(userId);
  assertNotLocked(row);
  if (!row.secret) throw new MfaError("Set up two-step sign-in first", 409);

  if (input.recoveryCode) {
    const candidate = input.recoveryCode.replace(/[\s-]/g, "").toUpperCase();
    const unused = (await db.prepare(`SELECT id, code_hash as hash FROM admin_mfa_recovery_codes WHERE user_id = ? AND used_at IS NULL`).all(userId)) as { id: number; hash: string }[];
    const match = unused.find((c) => bcrypt.compareSync(candidate, c.hash));
    if (!match) {
      await recordFailure(userId, row);
      throw new MfaError("That recovery code isn't valid or was already used");
    }
    // Single use, even under a double submit: only the update that marks it used counts.
    const used = await db.prepare(`UPDATE admin_mfa_recovery_codes SET used_at = NOW() WHERE id = ? AND used_at IS NULL`).run(match.id);
    if (used.changes !== 1) throw new MfaError("That recovery code was already used");
    await db.prepare(`UPDATE users SET mfa_failures = 0 WHERE id = ?`).run(userId);
    await markSessionVerified(sessionToken);
    const left = unused.length - 1;
    await writeAudit({ actorUserId: userId, action: "admin.mfa_recovery_code_used", objectType: "user", objectId: userId, newValue: { left } });
    return { usedRecoveryCode: true, recoveryCodesLeft: left };
  }

  const token = normaliseCode(input.code ?? "");
  if (!/^\d{6}$/.test(token)) throw new MfaError("Enter the 6-digit code from your authenticator app");
  const delta = totpFor(unseal(row.secret), row.email).validate({ token, window: 1 });
  const step = delta === null ? null : currentStep() + delta;
  if (step === null) {
    await recordFailure(userId, row);
    throw new MfaError("That code didn't match. Try the newest code from your app.");
  }
  // Replay protection: only a code from a later time step than the last one accepted.
  const accepted = await db.prepare(`UPDATE users SET mfa_last_step = ?, mfa_failures = 0 WHERE id = ? AND (mfa_last_step IS NULL OR mfa_last_step < ?)`).run(step, userId, step);
  if (accepted.changes !== 1) throw new MfaError("That code was already used. Wait for the next code and try again.");
  await markSessionVerified(sessionToken);
  return { usedRecoveryCode: false, recoveryCodesLeft: null };
}

/** New recovery codes (replacing the old ones). Needs a fresh verification. */
export async function regenerateRecoveryCodes(userId: string): Promise<string[]> {
  const codes = await issueRecoveryCodes(userId);
  await writeAudit({ actorUserId: userId, action: "admin.mfa_recovery_codes_regenerated", objectType: "user", objectId: userId });
  return codes;
}

/** A super admin resets another admin's MFA (lost phone and recovery codes).
 * Their sessions end, and they enrol again at next sign-in. */
export async function resetMfa(targetUserId: string, actorUserId: string, reason: string) {
  if (targetUserId === actorUserId) throw new MfaError("You can't reset your own two-step sign-in — ask another super admin", 403);
  const row = await mfaRow(targetUserId);
  await db.transaction(async (tx) => {
    await tx
      .prepare(`UPDATE users SET mfa_secret_enc = NULL, mfa_pending_secret_enc = NULL, mfa_enabled_at = NULL, mfa_last_step = NULL, mfa_failures = 0, mfa_locked_until = NULL WHERE id = ?`)
      .run(targetUserId);
    await tx.prepare(`DELETE FROM admin_mfa_recovery_codes WHERE user_id = ?`).run(targetUserId);
    await tx.prepare(`DELETE FROM sessions WHERE user_id = ?`).run(targetUserId);
  });
  await writeAudit({ actorUserId, action: "admin.mfa_reset", objectType: "user", objectId: targetUserId, previousValue: { enrolled: !!row.secret }, newValue: { enrolled: false }, reason });
}
