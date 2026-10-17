import type { NextFunction, Request, Response } from "express";
import { ADMIN_ROLES, MFA_PENDING_ERROR, mfaPending, mfaStale, type AdminRole, type AuthedUser } from "./auth.js";

// D-02 — admin action permissions (approved for local implementation,
// 2026-10-14; docs/hellocircle-operating-decisions.md).
//
// One table decides what each admin role may do. It is deny-by-default:
//   - a permission name that isn't in this table is refused;
//   - an admin whose role is empty or not one of ADMIN_ROLES is refused;
//   - every route under /api/admin (and the admin-only review delete) declares
//     exactly one permission with requireAdminPermission(); a route-inventory
//     test (adminPermissions.test.ts) fails if any route doesn't.
// There is no environment variable, diagnostic mode or switch that widens
// this table. A rollback is a reviewed redeploy of an earlier version of the
// table itself (see the "Rollback" note in the implementation plan).
//
// Super is listed explicitly in every row — nothing is implied.

const S: AdminRole = "super";
const F: AdminRole = "finance";
const U: AdminRole = "support";
const L: AdminRole = "legal";
const ALL: readonly AdminRole[] = [S, F, U, L];

export const ADMIN_PERMISSIONS = {
  // Workspace basics (read-only)
  "workspace.view": ALL, // overview stats, system status, maps switch state
  "audit.view": ALL,
  "support.search": ALL, // support console search and activity overview
  "insights.view": ALL, // demand, marketplace health, referrals, funnel, market config (read)
  "decisions.view": ALL, // moderation decision history (without internal notes)
  "decisions.internal_notes.view": [S, U, L],

  // Admin accounts
  "admins.manage": [S],

  // Partners (vendor accounts)
  "partners.view": ALL,
  "partners.approve": [S, U], // pending → approved
  "partners.suspend": [S], // suspend, reinstate, or move back to pending
  "partners.platform_role": [S],
  "partners.tier": [S],

  // Listings
  "listings.view": ALL,
  "listings.moderate": [S, U], // approve / reject / back to pending
  "listings.edit": [S, U], // admin edits a listing's content
  "listings.feature": [S, U],
  "listings.delete": [S], // destructive (status "deleted" or hard delete)

  // Claims, host applications, place suggestions
  "queues.view": [S, U, L],
  "queues.decide": [S, U],

  // Organisations
  "orgs.view": ALL,
  "orgs.manage": [S], // create, flags, listing assignment
  "orgs.suspend": [S], // D-01: suspend or reinstate a whole organisation

  // Trust & safety
  "reviews.view": [S, U, L],
  "reviews.moderate": [S, U, L], // hide (DELETE /api/reviews/:id only hides) and unhide
  "reports.view": [S, U, L],
  "reports.moderate": [S, U, L],
  "complaints.handle": [S, U, L],
  "traders.view": [S, U, L],
  "traders.verify": [S, L],
  "policies.manage": [S, L],
  "help.edit": [S, L],
  "templates.view": [S, L],
  "templates.edit": [S, L],
  "templates.delete": [S], // destructive (reset to default)
  "demand.notify": [S, U], // sends notifications to residents

  // Media
  "media.view": [S, U],
  "media.editorial": [S, U],
  "media.delete": [S], // destructive

  // Platform settings (switches and configuration)
  "platform.settings": [S],

  // Money
  "finance.operate": [S, F], // the whole finance tool (ledger, refunds, settlements, transfers, debts, credits, rewards, webhooks)
  "finance.payment_state.view": [S, F, U], // read-only refunds and payment records, for support cases
  "commerce.operate": [S, F], // commercial rules (their own draft → review → approve → publish steps still apply), financial switches, plans
  // The matrix gives finance "financial switches only" without listing them.
  // The switches that aren't financial (GOVERNANCE_SWITCHES in
  // routes/adminCommerce.ts) stay Super-only until that is decided.
  "commerce.governance_switches": [S],
  "coupons.manage": [S, F],
  "coupons.delete": [S], // destructive; deactivating stays with finance

  // Operational platform (2026-10-16, docs/hellocircle-implementation-tracker.md)
  "activities.moderate": [S, U], // OG-14 cancel a harmful activity (participants refunded in full, as any cancellation)
  "orders.cancel": [S, F, U], // OG-10 cancel or move an order on the provider's behalf (existing cancel/refund rules)
  "privacy.requests": [S, L], // OG-29 review data access / export / erasure requests
  "residents.restrict": [S, U], // OG-08 resident restrictions — creation stays off until D-07 is approved
} as const satisfies Record<string, readonly AdminRole[]>;

export type AdminPermission = keyof typeof ADMIN_PERMISSIONS;

/** OG-07 — changes to these need a recent two-step code ("step up"): money,
 * suspensions, admin access, platform settings and destructive deletes. */
export const STEP_UP_PERMISSIONS: ReadonlySet<string> = new Set([
  "admins.manage",
  "partners.suspend",
  "orgs.suspend",
  "finance.operate",
  "commerce.operate",
  "commerce.governance_switches",
  "coupons.delete",
  "listings.delete",
  "media.delete",
  "templates.delete",
  "platform.settings",
  "orders.cancel",
  "activities.moderate",
]);

export function isAdminPermission(name: string): name is AdminPermission {
  return Object.prototype.hasOwnProperty.call(ADMIN_PERMISSIONS, name);
}

/** The validated role of an admin, or null (empty or unknown → no access). */
export function adminRoleOf(user: AuthedUser | undefined | null): AdminRole | null {
  if (!user || user.role !== "admin") return null;
  const role = user.adminRole;
  return role && (ADMIN_ROLES as readonly string[]).includes(role) ? role : null;
}

/** Deny-by-default check. Unknown permission, non-admin, empty or unknown role → false. */
export function adminCan(user: AuthedUser | undefined | null, permission: string): boolean {
  if (!isAdminPermission(permission)) return false;
  // OG-07 — an admin session that hasn't entered its two-step code holds nothing.
  if (mfaPending(user)) return false;
  const role = adminRoleOf(user);
  if (!role) return false;
  return (ADMIN_PERMISSIONS[permission] as readonly AdminRole[]).includes(role);
}

/** Every permission the user holds (for the client to mirror in nav and buttons). */
export function permissionsOf(user: AuthedUser | undefined | null): AdminPermission[] {
  return (Object.keys(ADMIN_PERMISSIONS) as AdminPermission[]).filter((p) => adminCan(user, p));
}

/** Marker on route handlers so the inventory test can find the declared permission. */
export type PermissionHandler = ((req: Request, res: Response, next: NextFunction) => void) & { adminPermission: AdminPermission };

/** Route guard: 401 without a session, 403 for a non-admin or an admin lacking
 * the permission. Throws at startup if given a name that isn't in the table,
 * so a typo can't silently create an unguarded route. */
export function requireAdminPermission(permission: AdminPermission): PermissionHandler {
  if (!isAdminPermission(permission)) throw new Error(`Unknown admin permission "${permission}"`);
  const handler = ((req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: "Admin login required" });
    if (req.user.role !== "admin") return res.status(403).json({ error: "Admin access only" });
    if (mfaPending(req.user)) return res.status(403).json({ error: MFA_PENDING_ERROR, mfaRequired: true });
    if (!adminCan(req.user, permission)) return res.status(403).json({ error: "Not included in your admin role", permission });
    // OG-07 — a sensitive change needs a code entered in the last 30 minutes.
    if (req.method !== "GET" && STEP_UP_PERMISSIONS.has(permission) && mfaStale(req.user)) {
      return res.status(403).json({ error: "Enter a fresh two-step code to confirm this change", mfaReauth: true });
    }
    next();
  }) as PermissionHandler;
  handler.adminPermission = permission;
  return handler;
}

/** In-handler check for an action decided by the request body (e.g. a status
 * change whose permission depends on the target status). Sends 403 and
 * returns false when not allowed. */
export function ensureAdminCan(req: Request, res: Response, permission: AdminPermission): boolean {
  if (adminCan(req.user, permission)) return true;
  res.status(403).json({ error: "Not included in your admin role", permission });
  return false;
}
