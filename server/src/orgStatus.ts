import { db } from "./db/index.js";
import { VENDOR_SUSPENDED_ERROR } from "./bookingIntegrity.js";
import { ConflictError } from "./util.js";

// D-01 — organisation suspension (approved for local implementation,
// 2026-10-15; docs/hellocircle-operating-decisions.md).
//
// Ownership: a listing (centre, club, experience, programme; a pass belongs
// to its club) is owned by the organisation of the member in its `vendor_id`
// — `listing.vendor_id → users.org_id`. That is the relationship every
// partner workspace permission already uses (`orgVendorIds()` in auth.ts),
// and D-08 keeps it true when a member leaves (their listings move to the
// owner). `centres.org_id` / `clubs.org_id` are a separate, experimental
// admin-assigned link (e.g. a council) and are NOT ownership.
//
// Listings with no `vendor_id` (seeded or unclaimed) or whose member has no
// organisation belong to no organisation: an organisation suspension can't
// affect them; their own listing status still applies.
//
// A suspended organisation's supply is hidden from public reads and refused
// at every sale path. Listing statuses are never rewritten — reinstatement
// therefore can't publish a draft, rejected or paused listing.
//
// The existing per-user rule stays too: a listing whose member account is
// individually suspended isn't sellable (unchanged from before D-01).

export const SUPPLY_UNAVAILABLE_ERROR = VENDOR_SUSPENDED_ERROR;

export { orgActiveSql } from "./orgSql.js";

type Tx = Pick<typeof db, "prepare">;

/** Organisation of a member, with its status (null when the member has none). */
export async function orgOfVendor(vendorId: string | null | undefined, tx: Tx = db): Promise<{ orgId: string; status: string } | null> {
  if (!vendorId) return null;
  const row = (await tx
    .prepare(`SELECT o.id AS orgId, o.status FROM users u JOIN organisations o ON o.id = u.org_id WHERE u.id = ?`)
    .get(vendorId)) as { orgId: string; status: string } | undefined;
  return row ?? null;
}

/** Pre-check before pricing or opening a checkout (no lock). */
export async function offeringSellable(vendorId: string | null | undefined): Promise<boolean> {
  if (!vendorId) return true;
  const row = (await db
    .prepare(`SELECT u.status AS userStatus, o.status AS orgStatus FROM users u LEFT JOIN organisations o ON o.id = u.org_id WHERE u.id = ?`)
    .get(vendorId)) as { userStatus: string; orgStatus: string | null } | undefined;
  if (!row) return true;
  return row.userStatus !== "suspended" && row.orgStatus !== "suspended";
}

/** Inside a sale's transaction, immediately before the row that records the
 * sale is written: re-checks the member and the organisation with a shared
 * lock on the organisation row. A suspension (which updates that row) and a
 * sale therefore serialise — a sale either commits before the suspension (an
 * existing booking, kept) or sees it and is refused. Throws ConflictError. */
export async function assertSellable(tx: Tx, vendorId: string | null | undefined): Promise<void> {
  if (!vendorId) return;
  const member = (await tx.prepare(`SELECT status, org_id AS orgId FROM users WHERE id = ?`).get(vendorId)) as { status: string; orgId: string | null } | undefined;
  if (!member) return;
  if (member.status === "suspended") throw new ConflictError(SUPPLY_UNAVAILABLE_ERROR);
  if (!member.orgId) return;
  const org = (await tx.prepare(`SELECT status FROM organisations WHERE id = ? LOCK IN SHARE MODE`).get(member.orgId)) as { status: string } | undefined;
  if (org?.status === "suspended") throw new ConflictError(SUPPLY_UNAVAILABLE_ERROR);
}

/** The member who owns a sale's supply, by checkout type and order ref. */
export async function supplyVendorForOrder(type: string, ref: string, tx: Tx = db): Promise<string | null> {
  const sql: Record<string, string> = {
    booking: `SELECT c.vendor_id AS v FROM bookings b JOIN centres c ON c.id = b.centre_id WHERE b.ref = ?`,
    registration: `SELECT c.vendor_id AS v FROM registrations r JOIN clubs c ON c.id = r.club_id WHERE r.ref = ?`,
    program: `SELECT p.vendor_id AS v FROM program_enrollments e JOIN programs p ON p.id = e.program_id WHERE e.ref = ?`,
    experience: `SELECT x.vendor_id AS v FROM experience_bookings b JOIN experiences x ON x.id = b.experience_id WHERE b.ref = ?`,
    pass: `SELECT c.vendor_id AS v FROM passes p JOIN clubs c ON c.id = p.listing_id AND p.listing_type = 'club' WHERE p.ref = ?`,
  };
  if (!sql[type]) return null;
  const row = (await tx.prepare(sql[type]).get(ref)) as { v: string | null } | undefined;
  return row?.v ?? null;
}

/** For confirming a payment: is the supply's organisation suspended? Takes a
 * shared lock on the organisation row (same serialisation as assertSellable).
 * The member's own account status is deliberately not consulted here: a
 * checkout opened before an individual suspension has always confirmed, and
 * D-01 doesn't change that. */
export async function orgSuspendedForVendor(tx: Tx, vendorId: string | null | undefined): Promise<boolean> {
  if (!vendorId) return false;
  const member = (await tx.prepare(`SELECT org_id AS orgId FROM users WHERE id = ?`).get(vendorId)) as { orgId: string | null } | undefined;
  if (!member?.orgId) return false;
  const org = (await tx.prepare(`SELECT status FROM organisations WHERE id = ? LOCK IN SHARE MODE`).get(member.orgId)) as { status: string } | undefined;
  return org?.status === "suspended";
}

/** The reason recorded on a parked payment event (Finance → Payment events). */
export function orgSuspendedReviewMessage(type: string, ref: string): string {
  return `Organisation suspended — ${type} ${ref} was paid after its organisation was suspended, so it was not confirmed. The payment is held for finance review: refund it, or replay this event after the organisation is reinstated (D-01).`;
}

export const UNAVAILABLE_MESSAGE = "This listing isn't available at the moment.";

/** Public detail pages: a listing that would be public (its own status is
 * live) but whose organisation is suspended. Returns just enough to show the
 * unavailable state — no prices, sessions or booking options. */
export async function unavailableListing(
  kind: "centre" | "club" | "experience" | "programme",
  idOrSlug: string
): Promise<{ id: string; name: string; unavailable: true; message: string } | null> {
  const sql = {
    centre: `SELECT id, name, vendor_id AS v FROM centres WHERE (slug = ? OR id = ?) AND status = 'approved'`,
    club: `SELECT id, name, vendor_id AS v FROM clubs WHERE (slug = ? OR id = ?) AND status = 'approved'`,
    experience: `SELECT id, title AS name, vendor_id AS v FROM experiences WHERE (slug = ? OR id = ?) AND status = 'approved'`,
    programme: `SELECT id, title AS name, vendor_id AS v FROM programs WHERE (id = ? OR id = ?) AND status = 'published'`,
  }[kind];
  const row = (await db.prepare(sql).get(idOrSlug, idOrSlug)) as { id: string; name: string; v: string | null } | undefined;
  if (!row) return null;
  const org = await orgOfVendor(row.v);
  if (org?.status !== "suspended") return null;
  return { id: row.id, name: row.name, unavailable: true, message: UNAVAILABLE_MESSAGE };
}

/** D-08 — thrown when the member creating something is no longer in the
 * organisation they started the request in (removed meanwhile). The final
 * error handler in index.ts answers 403 { removedFromOrg: true }. */
export class MembershipChangedError extends Error {
  constructor() {
    super("You're no longer a member of this organisation");
  }
}

/** D-08 — inside the transaction that creates a listing or coupon: re-read the
 * creator's membership with a shared lock on their user row. Staff removal
 * holds an exclusive lock on that row while it moves the member's listings and
 * coupons to the owner, so the two serialise: a creation that commits first is
 * moved by the removal; one that comes after is refused here. Nothing can be
 * created into "no organisation" by a request that raced a removal. */
export async function assertCreatorStillMember(tx: Tx, user: { id: string; orgId: string | null }): Promise<void> {
  const row = (await tx.prepare(`SELECT org_id AS orgId FROM users WHERE id = ? LOCK IN SHARE MODE`).get(user.id)) as { orgId: string | null } | undefined;
  if (!row || (row.orgId ?? null) !== (user.orgId ?? null)) throw new MembershipChangedError();
}
