import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { db } from "./db/index.js";

export const SESSION_COOKIE = "hello_circle_session";
const SESSION_DAYS = 30;

export type Role = "vendor" | "admin";
export type UserStatus = "pending" | "approved" | "suspended";

export interface AuthedUser {
  id: string;
  email: string;
  role: Role;
  status: UserStatus;
  name: string;
}

interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  role: Role;
  status: UserStatus;
  name: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthedUser;
    }
  }
}

export function hashPassword(password: string): string {
  return bcrypt.hashSync(password, 10);
}

export function verifyPassword(password: string, hash: string): boolean {
  return bcrypt.compareSync(password, hash);
}

export function createUser(email: string, password: string, name: string, role: Role, status: UserStatus): AuthedUser {
  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO users (id, email, password_hash, role, status, name) VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, email.toLowerCase().trim(), hashPassword(password), role, status, name);
  return { id, email: email.toLowerCase().trim(), role, status, name };
}

export function findUserByEmail(email: string): (AuthedUser & { passwordHash: string }) | null {
  const row = db
    .prepare(`SELECT id, email, password_hash, role, status, name FROM users WHERE email = ?`)
    .get(email.toLowerCase().trim()) as UserRow | undefined;
  if (!row) return null;
  return { id: row.id, email: row.email, role: row.role, status: row.status, name: row.name, passwordHash: row.password_hash };
}

export function createSession(userId: string): { token: string; expiresAt: Date } {
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  db.prepare(`INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)`).run(
    token,
    userId,
    expiresAt.toISOString()
  );
  return { token, expiresAt };
}

export function destroySession(token: string) {
  db.prepare(`DELETE FROM sessions WHERE token = ?`).run(token);
}

function userFromToken(token: string): AuthedUser | null {
  const row = db
    .prepare(
      `SELECT u.id, u.email, u.role, u.status, u.name
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token = ? AND s.expires_at > datetime('now')`
    )
    .get(token) as UserRow | undefined;
  return row ? { id: row.id, email: row.email, role: row.role, status: row.status, name: row.name } : null;
}

/** Reads the session cookie (if any) and attaches req.user. Never rejects. */
export function attachUser(req: Request, _res: Response, next: NextFunction) {
  const token = req.cookies?.[SESSION_COOKIE];
  if (token) {
    const user = userFromToken(token);
    if (user) req.user = user;
  }
  next();
}

export function requireVendor(req: Request, res: Response, next: NextFunction) {
  if (!req.user || req.user.role !== "vendor") return res.status(401).json({ error: "Vendor login required" });
  if (req.user.status !== "approved") return res.status(403).json({ error: "Vendor account not yet approved" });
  next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.user || req.user.role !== "admin") return res.status(401).json({ error: "Admin login required" });
  next();
}

/** Either an approved vendor or an admin — used for actions (like uploads) that both roles may perform. */
export function requireVendorOrAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.user) return res.status(401).json({ error: "Login required" });
  if (req.user.role === "admin") return next();
  if (req.user.role === "vendor" && req.user.status === "approved") return next();
  return res.status(403).json({ error: "Not authorized" });
}
