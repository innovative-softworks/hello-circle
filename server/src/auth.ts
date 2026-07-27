import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { db } from "./db/index.js";

export const SESSION_COOKIE = "hello_circle_session";
const SESSION_DAYS = 30;

export type Role = "vendor" | "admin";
export type UserStatus = "pending" | "approved" | "suspended";
export type VendorType = "community" | "sports";

export interface VendorProfile {
  vendorType: VendorType;
  businessName: string;
  address: string;
  county: string;
  mobile: string;
  landline?: string;
  description: string;
}

export interface AuthedUser {
  id: string;
  email: string;
  role: Role;
  status: UserStatus;
  name: string;
  vendorType: VendorType | null;
  businessName: string;
  address: string;
  county: string;
  mobile: string;
  landline: string;
  description: string;
}

interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  role: Role;
  status: UserStatus;
  name: string;
  vendor_type: VendorType | null;
  business_name: string;
  address: string;
  county: string;
  mobile: string;
  landline: string;
  description: string;
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

export function createUser(
  email: string,
  password: string,
  name: string,
  role: Role,
  status: UserStatus,
  profile?: VendorProfile
): AuthedUser {
  const id = crypto.randomUUID();
  const normalizedEmail = email.toLowerCase().trim();
  db.prepare(
    `INSERT INTO users (id, email, password_hash, role, status, name, vendor_type, business_name, address, county, mobile, landline, description)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    normalizedEmail,
    hashPassword(password),
    role,
    status,
    name,
    profile?.vendorType ?? null,
    profile?.businessName ?? "",
    profile?.address ?? "",
    profile?.county ?? "",
    profile?.mobile ?? "",
    profile?.landline ?? "",
    profile?.description ?? ""
  );
  return {
    id,
    email: normalizedEmail,
    role,
    status,
    name,
    vendorType: profile?.vendorType ?? null,
    businessName: profile?.businessName ?? "",
    address: profile?.address ?? "",
    county: profile?.county ?? "",
    mobile: profile?.mobile ?? "",
    landline: profile?.landline ?? "",
    description: profile?.description ?? "",
  };
}

function rowToUser(row: UserRow): AuthedUser {
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    status: row.status,
    name: row.name,
    vendorType: row.vendor_type,
    businessName: row.business_name,
    address: row.address,
    county: row.county,
    mobile: row.mobile,
    landline: row.landline,
    description: row.description,
  };
}

export function findUserByEmail(email: string): (AuthedUser & { passwordHash: string }) | null {
  const row = db
    .prepare(
      `SELECT id, email, password_hash, role, status, name, vendor_type, business_name, address, county, mobile, landline, description
       FROM users WHERE email = ?`
    )
    .get(email.toLowerCase().trim()) as UserRow | undefined;
  if (!row) return null;
  return { ...rowToUser(row), passwordHash: row.password_hash };
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
      `SELECT u.id, u.email, u.role, u.status, u.name, u.vendor_type, u.business_name, u.address, u.county, u.mobile, u.landline, u.description
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token = ? AND s.expires_at > datetime('now')`
    )
    .get(token) as UserRow | undefined;
  return row ? rowToUser(row) : null;
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
