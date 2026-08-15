import crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { db } from "./db/index.js";

export const GUEST_SESSION_COOKIE = "hello_circle_guest_session";
const GUEST_SESSION_DAYS = 30;
const LOGIN_TOKEN_MINUTES = 15;

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      guestEmail?: string;
    }
  }
}

/** Creates the short-lived, single-use token emailed to the guest as part of
 * the magic-link URL. Deliberately not tied to any users row — guests never
 * get an account/password, this only proves they can read that inbox. */
export async function createLoginToken(email: string): Promise<{ token: string }> {
  const token = crypto.randomBytes(32).toString("hex");
  await db
    .prepare(`INSERT INTO guest_login_tokens (token, email, expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL ${LOGIN_TOKEN_MINUTES} MINUTE))`)
    .run(token, email.toLowerCase().trim());
  return { token };
}

/** Validates + consumes a login token — deleting it doubles as marking it
 * "used", so a link can't be replayed. Returns the verified email, or null
 * if the token doesn't exist, already got used, or expired. */
export async function consumeLoginToken(token: string): Promise<string | null> {
  const row = (await db.prepare(`SELECT email FROM guest_login_tokens WHERE token = ? AND expires_at > NOW()`).get(token)) as
    | { email: string }
    | undefined;
  if (!row) return null;
  await db.prepare(`DELETE FROM guest_login_tokens WHERE token = ?`).run(token);
  return row.email;
}

export async function createGuestSession(email: string): Promise<{ token: string }> {
  const token = crypto.randomBytes(32).toString("hex");
  await db
    .prepare(`INSERT INTO guest_sessions (token, email, expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL ${GUEST_SESSION_DAYS} DAY))`)
    .run(token, email);
  return { token };
}

export async function destroyGuestSession(token: string) {
  await db.prepare(`DELETE FROM guest_sessions WHERE token = ?`).run(token);
}

async function emailFromGuestSession(token: string): Promise<string | null> {
  const row = (await db.prepare(`SELECT email FROM guest_sessions WHERE token = ? AND expires_at > NOW()`).get(token)) as
    | { email: string }
    | undefined;
  return row?.email ?? null;
}

/** Reads the guest-session cookie (if any) and attaches req.guestEmail.
 * Never rejects — mirrors attachUser in auth.ts. */
export async function attachGuestEmail(req: Request, _res: Response, next: NextFunction) {
  const token = req.cookies?.[GUEST_SESSION_COOKIE];
  if (token) {
    const email = await emailFromGuestSession(token);
    if (email) req.guestEmail = email;
  }
  next();
}
