import bcrypt from "bcryptjs";
import { STEP_UP_MINUTES, adminMfaRequired } from "./adminMfa.js";
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
  providerTier: "standard" | "verified" | "featured";
  createdAt: string;
  /** HelloCircle Manage (Phase 1) — set once this vendor links the resident
   * (magic-link) account of the same person via routes/manage.ts. Null for
   * every vendor until they deliberately do that. */
  residentId: string | null;
  /** Revenue & Connect Stage 2a — admin sub-role (super | finance | support |
   * legal); null for every non-admin. */
  adminRole: AdminRole | null;
  /** D-01 — the status of the member's organisation ("active" | "suspended"),
   * read with the session on every request, so a suspension or reinstatement
   * applies to existing sessions on their next request. Undefined/null when
   * the member has no organisation or the row wasn't loaded with it. */
  orgStatus?: string | null;
  /** OG-07 — an admin session's two-step state (set for admin sessions only). */
  mfa?: { required: boolean; enrolled: boolean; verifiedMinutesAgo: number | null };
}

export const ADMIN_ROLES = ["super", "finance", "support", "legal"] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];

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
  provider_tier: "standard" | "verified" | "featured";
  created_at: string;
  resident_id: string | null;
  admin_role: AdminRole | null;
  org_status?: string | null;
  mfa_enrolled?: number | null;
  mfa_age?: number | null;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthedUser;
      /** Every user id sharing req.user's organisation — see orgVendorIds(). */
      vendorIds?: string[];
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
    `INSERT INTO users (id, email, password_hash, role, status, name, vendor_type, business_name, address, county, mobile, landline, description, org_id, platform_role, invited_staff, admin_role)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
    org?.invitedStaff ? 1 : 0,
    // D-02: an admin account always carries an explicit role. The seeded and
    // QA admins are created here, so they get "super" rather than relying on
    // the boot backfill (which runs before seeding on a fresh database).
    role === "admin" ? "super" : null
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
    providerTier: "standard",
    createdAt: new Date().toISOString(),
    residentId: null,
    adminRole: null,
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
    providerTier: row.provider_tier,
    createdAt: row.created_at,
    residentId: row.resident_id,
    // D-02: no implicit "super". A missing or unknown value stays null and is
    // denied by every admin permission check (adminPermissions.ts).
    adminRole: row.role === "admin" && (ADMIN_ROLES as readonly string[]).includes(String(row.admin_role)) ? row.admin_role : null,
    orgStatus: row.org_status ?? null,
  };
}

export async function findUserByEmail(email: string): Promise<(AuthedUser & { passwordHash: string }) | null> {
  const row = (await db
    .prepare(
      `SELECT id, email, password_hash, role, status, name, vendor_type, business_name, address, county, mobile, landline, description, org_id, platform_role, invited_staff, provider_tier, created_at, resident_id, admin_role
       FROM users WHERE email = ?`
    )
    .get(email.toLowerCase().trim())) as UserRow | undefined;
  if (!row) return null;
  return { ...rowToUser(row), passwordHash: row.password_hash };
}

// --- Google sign-in (vendor/admin) — login-only, see routes/auth.ts's POST
// /google. Never creates a users row: an unrecognised email is sent back to
// the existing /vendor/signup listing-intake flow instead, so Google can't
// be used to grant a role or skip admin approval.

export async function findUserByGoogleUid(uid: string): Promise<AuthedUser | null> {
  const row = (await db
    .prepare(
      `SELECT id, email, password_hash, role, status, name, vendor_type, business_name, address, county, mobile, landline, description, org_id, platform_role, invited_staff, provider_tier, created_at, resident_id, admin_role
       FROM users WHERE google_uid = ?`
    )
    .get(uid)) as UserRow | undefined;
  return row ? rowToUser(row) : null;
}

/** Links a verified Google identity onto an existing users row — only ever
 * called from an already-authenticated session (PUT /auth/link-google), not
 * during sign-in (see the account-linking audit note on POST /auth/google).
 * Being logged in already proves control of this account, so this can
 * safely overwrite a previously-linked uid — it's an explicit, deliberate
 * user action, not an inference from a matching email. Grants no new
 * privileges; the account's role/status/org are entirely unchanged. */
export async function linkUserGoogleUid(userId: string, uid: string): Promise<void> {
  await db.prepare(`UPDATE users SET google_uid = ? WHERE id = ?`).run(uid, userId);
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
      `SELECT u.id, u.email, u.role, u.status, u.name, u.vendor_type, u.business_name, u.address, u.county, u.mobile, u.landline, u.description, u.org_id, u.platform_role, u.invited_staff, u.provider_tier, u.created_at, u.resident_id, u.admin_role,
              o.status AS org_status, u.mfa_secret_enc IS NOT NULL AS mfa_enrolled, TIMESTAMPDIFF(MINUTE, s.mfa_verified_at, NOW()) AS mfa_age
       FROM sessions s JOIN users u ON u.id = s.user_id LEFT JOIN organisations o ON o.id = u.org_id
       WHERE s.token = ? AND s.expires_at > NOW()`
    )
    .get(token)) as UserRow | undefined;
  if (!row) return null;
  const user = rowToUser(row);
  if (user.role === "admin") {
    user.mfa = { required: await adminMfaRequired(), enrolled: Number(row.mfa_enrolled) === 1, verifiedMinutesAgo: row.mfa_age === null || row.mfa_age === undefined ? null : Number(row.mfa_age) };
  }
  return user;
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

/** D-01 — the only partner API a member of a suspended organisation can use:
 * the read-only obligations view. Account routes (sign-in, password, sign-out)
 * don't use requireVendor and stay available. */
const SUSPENDED_ORG_ALLOWED = new Set(["GET /api/vendor/obligations"]);
export const ORG_SUSPENDED_ERROR = "Your organisation is suspended, so the Partner workspace is read-only. You can still see your upcoming obligations.";

/** D-01 — true when the member's organisation is suspended. */
export const orgSuspended = (user: AuthedUser | undefined) => user?.orgStatus === "suspended";

/** D-08 — invited staff whose membership was removed (no organisation any
 * more). Their account remains, but it has no partner workspace. */
export const removedStaff = (user: AuthedUser | undefined) => !!user && user.role === "vendor" && user.invitedStaff && !user.orgId;
export const REMOVED_STAFF_ERROR = "You're no longer a member of an organisation on HelloCircle.";

export function requireVendor(req: Request, res: Response, next: NextFunction) {
  if (!req.user || req.user.role !== "vendor") return res.status(401).json({ error: "Vendor login required" });
  if (req.user.status !== "approved") return res.status(403).json({ error: "Vendor account not yet approved" });
  if (removedStaff(req.user)) return res.status(403).json({ error: REMOVED_STAFF_ERROR, removedFromOrg: true });
  if (orgSuspended(req.user) && !SUSPENDED_ORG_ALLOWED.has(`${req.method} ${req.originalUrl.split("?")[0]}`)) {
    return res.status(403).json({ error: ORG_SUSPENDED_ERROR, orgSuspended: true });
  }
  next();
}

/** Authentication for the admin area: no session → 401; a signed-in account
 * that isn't an admin → 403 (D-02). What an admin may *do* is decided per
 * route by requireAdminPermission (adminPermissions.ts). */
export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.user) return res.status(401).json({ error: "Admin login required" });
  if (req.user.role !== "admin") return res.status(403).json({ error: "Admin access only" });
  if (mfaPending(req.user)) return res.status(403).json({ error: MFA_PENDING_ERROR, mfaRequired: true });
  next();
}

// OG-07 — an admin session opens nothing until two-step sign-in is done.
export const MFA_PENDING_ERROR = "Finish two-step sign-in to use the admin tools";
/** True for an admin session that still has to enter a code. */
export function mfaPending(user: AuthedUser | undefined | null): boolean {
  return !!user && user.role === "admin" && !!user.mfa?.required && user.mfa.verifiedMinutesAgo === null;
}
/** True when a sensitive action needs a fresh code (verified more than STEP_UP_MINUTES ago). */
export function mfaStale(user: AuthedUser | undefined | null): boolean {
  return !!user && user.role === "admin" && !!user.mfa?.required && (user.mfa.verifiedMinutesAgo === null || user.mfa.verifiedMinutesAgo > STEP_UP_MINUTES);
}

// D-02: the old role guards (hasAdminRole / requireAdminRole) were removed.
// Admin routes declare a permission with requireAdminPermission() from
// adminPermissions.ts, which denies by default.

/** Either an approved vendor or an admin — used for actions (like uploads) that both roles may perform. */
export function requireVendorOrAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.user) return res.status(401).json({ error: "Login required" });
  if (req.user.role === "admin") return next();
  if (req.user.role === "vendor" && req.user.status === "approved") return next();
  return res.status(403).json({ error: "Not authorized" });
}

/** Every user id belonging to the same organisation as `user` — i.e. the set
 * of vendor_id values that should count as "this vendor's own listing" now
 * that a listing can be owned by any org member, not just its creator. Every
 * vendor is backfilled with a 1:1 organisation on server boot (see
 * initSchema()'s vendorsNeedingOrg loop in db/index.ts), so orgId is
 * expected to be set for an approved vendor — the null fallback below just
 * behaves like the pre-Phase-C single-vendor scoping if it's ever missing. */
export async function orgVendorIds(user: AuthedUser): Promise<string[]> {
  if (!user.orgId) return [user.id];
  const rows = (await db.prepare(`SELECT id FROM users WHERE org_id = ?`).all(user.orgId)) as { id: string }[];
  return rows.length ? rows.map((r) => r.id) : [user.id];
}

/** Attaches req.vendorIds — mount after requireVendor. */
export async function attachVendorIds(req: Request, _res: Response, next: NextFunction) {
  req.vendorIds = await orgVendorIds(req.user!);
  next();
}

/** RBAC (Phase C — wired into real routes, no longer just a stored field).
 * An admin always passes. A vendor who is the organisation's owner (i.e.
 * not `invitedStaff` — every vendor before Phase C, and every vendor who
 * signs up directly today) is unrestricted, same access they've always
 * had — RBAC only ever narrows an *invited staff member's* access down to
 * their assigned platform_role, never an owner's.
 *
 * Pulled out as a plain function (not just the requirePlatformRole
 * middleware below) because some routes only know which role applies after
 * a DB lookup — e.g. a program's role requirement depends on its
 * listing_type, not the URL — so they need to call this inline mid-handler
 * instead of as static route middleware. */
export function hasPlatformRole(user: AuthedUser, ...roles: string[]): boolean {
  if (user.role === "admin") return true;
  if (user.role === "vendor" && !user.invitedStaff) return true;
  return !!user.platformRole && roles.includes(user.platformRole);
}

export function requirePlatformRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: "Login required" });
    if (hasPlatformRole(req.user, ...roles)) return next();
    return res.status(403).json({ error: "Not authorized for this role" });
  };
}

/** For routes that only know which role applies after a DB lookup (a
 * program's/session's role requirement depends on its listing_type, not the
 * URL) and so can't use requirePlatformRole as static middleware — collapses
 * the repeated `if (!hasPlatformRole(...)) return res.status(403)...` block
 * into one line. Writes the 403 itself; returns false when it did (caller
 * should `return` immediately), true when the caller should proceed. */
export function assertPlatformRole(req: Request, res: Response, ...roles: string[]): boolean {
  if (hasPlatformRole(req.user!, ...roles)) return true;
  res.status(403).json({ error: "Not authorized for this role" });
  return false;
}
