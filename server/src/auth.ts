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
  orgId: string | null;
  platformRole: string | null;
  invitedStaff: boolean;
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
  org_id: string | null;
  platform_role: string | null;
  invited_staff: number;
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

export async function createUser(
  email: string,
  password: string,
  name: string,
  role: Role,
  status: UserStatus,
  profile?: VendorProfile,
  // Accepts a transaction's `tx` in place of the module-level pool so this
  // insert participates in a caller's transaction (see signup in
  // routes/auth.ts, which inserts the user + their draft listing together).
  conn: Pick<typeof db, "prepare"> = db,
  // Organisation linkage (Phase C). orgId unset = this account gets its own
  // 1:1 organisation via the initSchema backfill on next boot, same as
  // every vendor before this existed — only the invite-acceptance route
  // passes an explicit orgId (joining an existing organisation as staff).
  org?: { orgId?: string; platformRole?: string; invitedStaff?: boolean }
): Promise<AuthedUser> {
  const id = crypto.randomUUID();
  const normalizedEmail = email.toLowerCase().trim();
  await conn.prepare(
    `INSERT INTO users (id, email, password_hash, role, status, name, vendor_type, business_name, address, county, mobile, landline, description, org_id, platform_role, invited_staff)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
    profile?.description ?? "",
    org?.orgId ?? null,
    org?.platformRole ?? null,
    org?.invitedStaff ? 1 : 0
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
    orgId: org?.orgId ?? null,
    platformRole: org?.platformRole ?? null,
    invitedStaff: !!org?.invitedStaff,
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
    orgId: row.org_id,
    platformRole: row.platform_role,
    invitedStaff: !!row.invited_staff,
  };
}

export async function findUserByEmail(email: string): Promise<(AuthedUser & { passwordHash: string }) | null> {
  const row = (await db
    .prepare(
      `SELECT id, email, password_hash, role, status, name, vendor_type, business_name, address, county, mobile, landline, description, org_id, platform_role, invited_staff
       FROM users WHERE email = ?`
    )
    .get(email.toLowerCase().trim())) as UserRow | undefined;
  if (!row) return null;
  return { ...rowToUser(row), passwordHash: row.password_hash };
}

export async function createSession(userId: string): Promise<{ token: string; expiresAt: Date }> {
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  // Computed by the DB itself (DATE_ADD/NOW()) rather than sending a JS ISO
  // string, so it can't drift against whatever the `NOW()` comparison in
  // userFromToken uses if the app server and DB server are in different
  // timezones.
  await db
    .prepare(`INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL ${SESSION_DAYS} DAY))`)
    .run(token, userId);
  return { token, expiresAt };
}

export async function destroySession(token: string) {
  await db.prepare(`DELETE FROM sessions WHERE token = ?`).run(token);
}

async function userFromToken(token: string): Promise<AuthedUser | null> {
  const row = (await db
    .prepare(
      `SELECT u.id, u.email, u.role, u.status, u.name, u.vendor_type, u.business_name, u.address, u.county, u.mobile, u.landline, u.description, u.org_id, u.platform_role, u.invited_staff
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token = ? AND s.expires_at > NOW()`
    )
    .get(token)) as UserRow | undefined;
  return row ? rowToUser(row) : null;
}

/** Reads the session cookie (if any) and attaches req.user. Never rejects. */
export async function attachUser(req: Request, _res: Response, next: NextFunction) {
  const token = req.cookies?.[SESSION_COOKIE];
  if (token) {
    const user = await userFromToken(token);
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

/** RBAC (Phase C — wired into real routes, no longer just a stored field).
 * An admin always passes. A vendor who is the organisation's owner (i.e.
 * not `invitedStaff` — every vendor before Phase C, and every vendor who
 * signs up directly today) is unrestricted, same access they've always
 * had — RBAC only ever narrows an *invited staff member's* access down to
 * their assigned platform_role, never an owner's. */
export function requirePlatformRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: "Login required" });
    if (req.user.role === "admin") return next();
    if (req.user.role === "vendor" && !req.user.invitedStaff) return next();
    if (req.user.platformRole && roles.includes(req.user.platformRole)) return next();
    return res.status(403).json({ error: "Not authorized for this role" });
  };
}
