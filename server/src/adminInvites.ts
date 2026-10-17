import crypto from "node:crypto";
import { writeAudit } from "./audit.js";
import { ADMIN_ROLES, createUser, type AdminRole, type AuthedUser } from "./auth.js";
import { db } from "./db/index.js";
import { sendMail } from "./email.js";
import { CLIENT_URL } from "./stripe.js";

// OG-06 / DEC-02 — HelloCircle admins join by invitation from a super admin.
// - The link is single use and expires after 72 hours; only a SHA-256 hash of
//   the token is stored, so a database read can't be turned into a working link.
// - The role is fixed by the inviter; accepting can't choose or raise it.
// - One pending invite per email: a new invite replaces the earlier one.
// - An email that already has any HelloCircle staff or partner account is
//   refused (no silent conversion of an existing account into an admin).
// - Creating, accepting and revoking are audit-logged.
// - The new admin still has to set up two-step sign-in before any admin tool
//   opens (adminMfa.ts).

export const INVITE_HOURS = 72;
const hash = (token: string) => crypto.createHash("sha256").update(token).digest("hex");

export class InviteError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export interface AdminInviteRow {
  id: number;
  email: string;
  adminRole: AdminRole;
  status: "pending" | "accepted" | "revoked" | "replaced" | "expired";
  invitedByEmail: string | null;
  createdAt: string;
  expiresAt: string;
  acceptedAt: string | null;
}

export async function listAdminInvites(): Promise<AdminInviteRow[]> {
  return (await db
    .prepare(
      `SELECT i.id, i.email, i.admin_role as adminRole,
              CASE WHEN i.status = 'pending' AND i.expires_at <= NOW() THEN 'expired' ELSE i.status END as status,
              u.email as invitedByEmail, i.created_at as createdAt, i.expires_at as expiresAt, i.accepted_at as acceptedAt
       FROM admin_invites i LEFT JOIN users u ON u.id = i.invited_by
       ORDER BY i.created_at DESC LIMIT 100`
    )
    .all()) as AdminInviteRow[];
}

export async function createAdminInvite(input: { email: string; adminRole: string; inviter: AuthedUser }): Promise<{ id: number }> {
  const email = input.email.toLowerCase().trim();
  if (!(ADMIN_ROLES as readonly string[]).includes(input.adminRole)) throw new InviteError(`Role must be one of ${ADMIN_ROLES.join(", ")}`);
  if (input.inviter.adminRole !== "super") throw new InviteError("Only a super admin can invite admins", 403);
  const token = crypto.randomBytes(32).toString("hex");
  const created = await db.transaction(async (tx) => {
    // Serialise invites for the same email (a unique pending row would need a
    // partial index MySQL doesn't have): lock any existing rows for it first.
    await tx.prepare(`SELECT id FROM admin_invites WHERE email = ? FOR UPDATE`).all(email);
    const existing = await tx.prepare(`SELECT id, role FROM users WHERE LOWER(email) = ?`).get(email);
    if (existing) throw new InviteError("That email already has a HelloCircle account. Use a different address for the admin account.", 409);
    const replaced = await tx.prepare(`UPDATE admin_invites SET status = 'replaced' WHERE email = ? AND status = 'pending'`).run(email);
    const info = await tx
      .prepare(`INSERT INTO admin_invites (token_hash, email, admin_role, invited_by, expires_at) VALUES (?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL ${INVITE_HOURS} HOUR))`)
      .run(hash(token), email, input.adminRole, input.inviter.id);
    return { id: Number(info.lastInsertRowid), replaced: replaced.changes };
  });
  await writeAudit({
    actorUserId: input.inviter.id,
    action: "admin.invited",
    objectType: "admin_invite",
    objectId: String(created.id),
    newValue: { email, adminRole: input.adminRole, replacedPendingInvites: created.replaced },
  });
  const url = `${CLIENT_URL}/admin-invite?token=${token}`;
  await sendMail({
    to: email,
    subject: "You've been invited to the HelloCircle admin team",
    text: `Hi,\n\n${input.inviter.name || input.inviter.email} has invited you to join the HelloCircle admin team as a ${input.adminRole} admin.\n\nSet up your account (password, then two-step sign-in with an authenticator app):\n${url}\n\nThis link works once and expires in ${INVITE_HOURS} hours. If you weren't expecting it, ignore this email.`,
    cta: { label: "Set up your admin account", url },
  });
  return { id: created.id };
}

export async function revokeAdminInvite(id: number, actor: AuthedUser): Promise<void> {
  const info = await db.prepare(`UPDATE admin_invites SET status = 'revoked', revoked_at = NOW() WHERE id = ? AND status = 'pending'`).run(id);
  if (info.changes !== 1) throw new InviteError("Only a pending invitation can be revoked", 409);
  await writeAudit({ actorUserId: actor.id, action: "admin.invite_revoked", objectType: "admin_invite", objectId: String(id) });
}

interface LiveInvite {
  id: number;
  email: string;
  adminRole: AdminRole;
}

async function liveInvite(token: string, q: Pick<typeof db, "prepare"> = db, lock = false): Promise<LiveInvite> {
  if (!/^[a-f0-9]{64}$/.test(token)) throw new InviteError("This invitation link isn't valid", 404);
  const row = (await q
    .prepare(`SELECT id, email, admin_role as adminRole, status, expires_at <= NOW() as expired FROM admin_invites WHERE token_hash = ?${lock ? " FOR UPDATE" : ""}`)
    .get(hash(token))) as (LiveInvite & { status: string; expired: number }) | undefined;
  if (!row) throw new InviteError("This invitation link isn't valid", 404);
  if (row.status === "accepted") throw new InviteError("This invitation has already been used. Sign in instead.", 410);
  if (row.status !== "pending") throw new InviteError("This invitation was withdrawn. Ask a super admin for a new one.", 410);
  if (Number(row.expired)) throw new InviteError("This invitation has expired. Ask a super admin for a new one.", 410);
  return { id: row.id, email: row.email, adminRole: row.adminRole };
}

/** What the acceptance page shows before the person sets a password. */
export async function describeInvite(token: string): Promise<{ email: string; adminRole: AdminRole }> {
  const i = await liveInvite(token);
  return { email: i.email, adminRole: i.adminRole };
}

export async function acceptAdminInvite(input: { token: string; name: string; password: string }): Promise<AuthedUser> {
  if (input.password.length < 12) throw new InviteError("Use a password of at least 12 characters");
  const name = input.name.trim().slice(0, 120);
  if (!name) throw new InviteError("Enter your name");
  const result = await db.transaction(async (tx) => {
    const invite = await liveInvite(input.token, tx, true);
    if (await tx.prepare(`SELECT id FROM users WHERE LOWER(email) = ?`).get(invite.email)) throw new InviteError("That email already has a HelloCircle account. Sign in instead.", 409);
    const user = await createUser(invite.email, input.password, name, "admin", "approved", undefined, tx);
    await tx.prepare(`UPDATE users SET admin_role = ? WHERE id = ?`).run(invite.adminRole, user.id);
    const used = await tx.prepare(`UPDATE admin_invites SET status = 'accepted', accepted_at = NOW(), accepted_user_id = ? WHERE id = ? AND status = 'pending'`).run(user.id, invite.id);
    if (used.changes !== 1) throw new InviteError("This invitation has already been used. Sign in instead.", 410);
    return { user: { ...user, adminRole: invite.adminRole }, inviteId: invite.id, adminRole: invite.adminRole };
  });
  await writeAudit({ actorUserId: result.user.id, action: "admin.invite_accepted", objectType: "admin_invite", objectId: String(result.inviteId), newValue: { adminRole: result.adminRole } });
  return result.user;
}
