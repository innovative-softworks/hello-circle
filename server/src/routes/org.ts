import crypto from "node:crypto";
import { orgCapabilityStates } from "../capabilities.js";
import { Router } from "express";
import { requireVendor } from "../auth.js";
import { writeAudit } from "../audit.js";
import { db } from "../db/index.js";
import { orgFeatureFlagsById } from "../db/queries.js";
import { sendMail } from "../email.js";
import { CLIENT_URL } from "../stripe.js";
import { isValidEmail } from "../util.js";

export const orgRouter = Router();
orgRouter.use(requireVendor);

const PLATFORM_ROLES = ["centre_manager", "facility_manager", "finance", "communications", "read_only_analyst", "checkin_staff"];

// Organisation-as-entity + Staff (Phase C — Gate 2 from the plan doc). Every
// vendor already has an org_id (backfilled 1:1 at boot for pre-existing
// vendors, assigned at signup for new ones) — this is the first UI to
// actually use that linkage for something.

orgRouter.get("/", async (req, res) => {
  const orgId = req.user!.orgId;
  if (!orgId) return res.status(404).json({ error: "No organisation linked to this account" });

  const org = (await db.prepare(`SELECT id, name, kind FROM organisations WHERE id = ?`).get(orgId)) as { id: string; name: string; kind: string } | undefined;
  // The logo/description/website/socials belong to the org owner's own
  // account row, not `organisations` — a staff member viewing this can see
  // them but only the owner can change them (see PUT / below). `description`
  // previously had no edit route anywhere despite being shown publicly on
  // ProviderProfile.tsx — this GET is also the first place it's ever read
  // back for editing.
  const owner = (await db.prepare(`SELECT logo, description, website, socials FROM users WHERE org_id = ? AND invited_staff = 0 LIMIT 1`).get(orgId)) as
    | { logo: string | null; description: string | null; website: string | null; socials: string | null }
    | undefined;
  const policies = (await db
    .prepare(
      `SELECT cancellation_hours as cancellationHours, booking_window_days as bookingWindowDays,
              refund_policy_text as refundPolicyText, tax_number as taxNumber, business_registration_number as businessRegistrationNumber
       FROM org_policies WHERE org_id = ?`
    )
    .get(orgId)) as
    | { cancellationHours: number; bookingWindowDays: number; refundPolicyText: string | null; taxNumber: string | null; businessRegistrationNumber: string | null }
    | undefined;
  // D-08: invitedStaff (false = the owner), rowVersion for stale-screen
  // protection on role changes and removal, and when they joined.
  const staff = ((await db
    .prepare(
      `SELECT id, name, email, platform_role as platformRole, status, invited_staff as invitedStaff, row_version as rowVersion, created_at as joinedAt
       FROM users WHERE org_id = ? ORDER BY invited_staff, created_at`
    )
    .all(orgId)) as { invitedStaff: number }[]).map((m) => ({ ...m, invitedStaff: !!m.invitedStaff }));
  // Only owners manage invitations. A management identifier must not double
  // as the bearer credential used by the public acceptance endpoint.
  const pendingInvites = req.user!.invitedStaff ? [] : await db
    .prepare(`SELECT SHA2(token, 256) as id, email, platform_role as platformRole, status, created_at as createdAt, expires_at as expiresAt FROM org_invites WHERE org_id = ? AND status = 'pending' AND expires_at > NOW()`)
    .all(orgId);
  const locations = await db.prepare(`SELECT id, name, 'centre' as type FROM centres WHERE vendor_id IN (SELECT id FROM users WHERE org_id = ?) UNION ALL SELECT id, name, 'club' as type FROM clubs WHERE vendor_id IN (SELECT id FROM users WHERE org_id = ?)`).all(orgId, orgId);
  // Read-only here — feature flags are admin-controlled, never vendor-self-
  // serve (see routes/admin.ts's GET/PUT). Surfaced so the vendor UI can
  // proactively hide/disable a create button rather than only ever failing
  // server-side after the fact.
  const flags = await orgFeatureFlagsById(orgId);
  // Configuration framework Phase B/D — what the organisation can use (effective).
  const capabilities = Object.fromEntries((await orgCapabilityStates(orgId)).map((c) => [c.key, c.effective]));

  res.json({
    org,
    policies: policies ?? { cancellationHours: 48, bookingWindowDays: 90, refundPolicyText: null, taxNumber: null, businessRegistrationNumber: null },
    staff,
    pendingInvites,
    locations,
    isOwner: !req.user!.invitedStaff,
    flags,
    capabilities,
    logo: owner?.logo || null,
    description: owner?.description || null,
    website: owner?.website || null,
    socials: owner?.socials ? JSON.parse(owner.socials) : { instagram: "", facebook: "", x: "" },
  });
});

orgRouter.put("/logo", async (req, res) => {
  if (req.user!.invitedStaff) return res.status(403).json({ error: "Only the organisation owner can edit this" });
  const { logo } = req.body as { logo?: string | null };
  await db.prepare(`UPDATE users SET logo = ? WHERE id = ?`).run(logo || null, req.user!.id);
  writeAudit({ actorUserId: req.user!.id, action: "org.logo_updated", objectType: "organisation", objectId: req.user!.orgId! });
  res.json({ ok: true });
});

orgRouter.put("/", async (req, res) => {
  if (req.user!.invitedStaff) return res.status(403).json({ error: "Only the organisation owner can edit this" });
  const { name, kind, description, website, socials } = req.body as {
    name?: string;
    kind?: string;
    description?: string;
    website?: string;
    socials?: { instagram?: string; facebook?: string; x?: string };
  };
  const before = (await db.prepare(`SELECT name, kind FROM organisations WHERE id = ?`).get(req.user!.orgId)) as { name: string; kind: string } | undefined;
  await db.prepare(`UPDATE organisations SET name = COALESCE(?, name), kind = COALESCE(?, kind) WHERE id = ?`).run(name, kind, req.user!.orgId);
  // description/website/socials live on the owner's own users row (same
  // place logo does) — COALESCE-partial-update, same reasoning as
  // PUT /policies above.
  await db
    .prepare(`UPDATE users SET description = COALESCE(?, description), website = COALESCE(?, website), socials = COALESCE(?, socials) WHERE id = ?`)
    .run(description, website, socials ? JSON.stringify(socials) : undefined, req.user!.id);
  writeAudit({ actorUserId: req.user!.id, action: "org.profile_updated", objectType: "organisation", objectId: req.user!.orgId!, previousValue: before, newValue: { name, kind } });
  res.json({ ok: true });
});

orgRouter.put("/policies", async (req, res) => {
  if (req.user!.invitedStaff) return res.status(403).json({ error: "Only the organisation owner can edit this" });
  const { cancellationHours, bookingWindowDays, refundPolicyText, taxNumber, businessRegistrationNumber } = req.body as {
    cancellationHours?: number;
    bookingWindowDays?: number;
    refundPolicyText?: string;
    taxNumber?: string;
    businessRegistrationNumber?: string;
  };
  const before = await db.prepare(`SELECT * FROM org_policies WHERE org_id = ?`).get(req.user!.orgId);
  // COALESCE-on-both-sides (CLAUDE.md's partial-update pattern) — a caller
  // that only sends one field (e.g. SettingsPanel today only ever sends
  // cancellationHours) must not silently reset every other policy field to
  // its hardcoded default on each save. Pre-existing bug fixed as a side
  // effect of adding 3 more fields to this same partial-update route.
  await db
    .prepare(
      `INSERT INTO org_policies (org_id, cancellation_hours, booking_window_days, refund_policy_text, tax_number, business_registration_number)
       VALUES (?, COALESCE(?, 48), COALESCE(?, 90), ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         cancellation_hours = COALESCE(VALUES(cancellation_hours), cancellation_hours),
         booking_window_days = COALESCE(VALUES(booking_window_days), booking_window_days),
         refund_policy_text = COALESCE(VALUES(refund_policy_text), refund_policy_text),
         tax_number = COALESCE(VALUES(tax_number), tax_number),
         business_registration_number = COALESCE(VALUES(business_registration_number), business_registration_number)`
    )
    .run(req.user!.orgId, cancellationHours ?? null, bookingWindowDays ?? null, refundPolicyText ?? null, taxNumber ?? null, businessRegistrationNumber ?? null);
  writeAudit({
    actorUserId: req.user!.id,
    action: "org.policies_updated",
    objectType: "organisation",
    objectId: req.user!.orgId!,
    previousValue: before,
    newValue: { cancellationHours, bookingWindowDays, refundPolicyText, taxNumber, businessRegistrationNumber },
  });
  res.json({ ok: true });
});

orgRouter.post("/staff/invite", async (req, res) => {
  if (req.user!.invitedStaff) return res.status(403).json({ error: "Only the organisation owner can invite staff" });
  const { email, platformRole } = req.body as { email?: string; platformRole?: string };
  if (!email || !isValidEmail(email)) return res.status(400).json({ error: "A valid email is required" });
  if (!platformRole || !PLATFORM_ROLES.includes(platformRole)) return res.status(400).json({ error: `platformRole must be one of ${PLATFORM_ROLES.join(", ")}` });

  const token = crypto.randomBytes(32).toString("hex");
  const recipient = email.toLowerCase().trim();
  // D-08 follow-up — one transaction under the organisation row lock, so
  // duplicate or concurrent invites for the same person serialise: someone
  // already on the team is refused, and a new invite replaces any earlier
  // pending one (only the newest link works). A previously removed member can be
  // invited again with the same email; they rejoin only by accepting it.
  const created = await db.transaction(async (tx) => {
    await tx.prepare(`SELECT id FROM organisations WHERE id = ? FOR UPDATE`).get(req.user!.orgId);
    const member = await tx.prepare(`SELECT id FROM users WHERE LOWER(email) = ? AND org_id = ?`).get(recipient, req.user!.orgId);
    if (member) return { status: 409 as const, error: "This person is already on your team" };
    const replaced = await tx.prepare(`UPDATE org_invites SET status = 'replaced' WHERE org_id = ? AND LOWER(email) = ? AND status = 'pending'`).run(req.user!.orgId, recipient);
    await tx
      .prepare(`INSERT INTO org_invites (token, org_id, email, platform_role, expires_at) VALUES (?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL 7 DAY))`)
      .run(token, req.user!.orgId, recipient, platformRole);
    return { replaced: replaced.changes };
  });
  if ("error" in created) return res.status(409).json({ error: created.error });
  writeAudit({
    actorUserId: req.user!.id,
    action: "org.staff_invited",
    objectType: "org_invite",
    objectId: crypto.createHash("sha256").update(token).digest("hex"),
    newValue: { orgId: req.user!.orgId, email: recipient, platformRole, replacedPendingInvites: created.replaced },
  });
  const acceptUrl = `${CLIENT_URL}/accept-invite?token=${token}`;
  await sendMail({
    to: email,
    subject: "You've been invited to join a Hello Circle organisation",
    text: `Hi,\n\nYou've been invited to join ${req.user!.businessName || "an organisation"} on Hello Circle as ${platformRole.replace(/_/g, " ")}.\n\nAccept the invite and set your password:\n${acceptUrl}\n\nThis link expires in 7 days.\n\nThanks for using Hello Circle.`,
    cta: { label: "Accept invite", url: acceptUrl },
  });
  res.status(201).json({ ok: true });
});

orgRouter.delete("/staff/invite/:id", async (req, res) => {
  if (req.user!.invitedStaff) return res.status(403).json({ error: "Only the organisation owner can manage invites" });
  const result = await db.prepare(`UPDATE org_invites SET status = 'revoked' WHERE SHA2(token, 256) = ? AND org_id = ?`).run(req.params.id, req.user!.orgId);
  // Never persist unmatched caller input (including a legacy bearer token).
  if (result.changes > 0) writeAudit({ actorUserId: req.user!.id, action: "org.staff_invite_revoked", objectType: "org_invite", objectId: req.params.id });
  res.json({ ok: true });
});

// --- D-08: owner-managed role changes and removal -----------------------------
// Owner only (never invited staff). The target must be an accepted member of
// the owner's own organisation and not the owner. Each change quotes the
// member's row_version: a stale screen or a concurrent change gets 409.
// Effective on the member's next request (sessions re-read the user every
// request). Not available while the organisation is suspended (requireVendor).

type MemberRow = { id: string; name: string; email: string; orgId: string | null; invitedStaff: number; platformRole: string | null; rowVersion: number };
class StaffChangeError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function lockMember(tx: Pick<typeof db, "prepare">, ownerId: string, ownerOrgId: string | null, memberId: string, rowVersion: unknown): Promise<MemberRow> {
  if (!ownerOrgId) throw new StaffChangeError(403, "No organisation linked to this account");
  if (memberId === ownerId) throw new StaffChangeError(403, "You can't change or remove your own membership");
  if (typeof rowVersion !== "number" || !Number.isInteger(rowVersion)) throw new StaffChangeError(400, "rowVersion is required");
  // Lock the owner's row first, then the member's, in that fixed order.
  await tx.prepare(`SELECT id FROM users WHERE id = ? FOR UPDATE`).get(ownerId);
  const m = (await tx
    .prepare(`SELECT id, name, email, org_id AS orgId, invited_staff AS invitedStaff, platform_role AS platformRole, row_version AS rowVersion FROM users WHERE id = ? AND role = 'vendor' FOR UPDATE`)
    .get(memberId)) as MemberRow | undefined;
  // Another organisation's member looks exactly like an unknown id.
  if (!m || m.orgId !== ownerOrgId) throw new StaffChangeError(404, "Member not found");
  if (!m.invitedStaff) throw new StaffChangeError(403, "The organisation owner can't be changed or removed here");
  if (Number(m.rowVersion) !== rowVersion) throw new StaffChangeError(409, "This member changed since you opened the page — refresh and try again");
  return m;
}

function staffChangeError(e: unknown, res: import("express").Response) {
  if (e instanceof StaffChangeError) return res.status(e.status).json({ error: e.message });
  throw e;
}

orgRouter.put("/staff/:id", async (req, res) => {
  if (req.user!.invitedStaff) return res.status(403).json({ error: "Only the organisation owner can change staff roles" });
  const { platformRole, rowVersion } = req.body as { platformRole?: string; rowVersion?: unknown };
  if (!platformRole || !PLATFORM_ROLES.includes(platformRole)) return res.status(400).json({ error: `platformRole must be one of ${PLATFORM_ROLES.join(", ")}` });
  try {
    const before = await db.transaction(async (tx) => {
      const m = await lockMember(tx, req.user!.id, req.user!.orgId, req.params.id, rowVersion);
      if (m.platformRole === platformRole) return { m, changed: false };
      await tx.prepare(`UPDATE users SET platform_role = ?, row_version = row_version + 1 WHERE id = ?`).run(platformRole, m.id);
      return { m, changed: true };
    });
    if (before.changed) {
      await writeAudit({
        actorUserId: req.user!.id,
        action: "org.staff_role_changed",
        objectType: "user",
        objectId: before.m.id,
        previousValue: { orgId: req.user!.orgId, platformRole: before.m.platformRole },
        newValue: { orgId: req.user!.orgId, platformRole },
      });
      void sendMail({
        to: before.m.email,
        subject: "Your role on HelloCircle has changed",
        text: `Hi ${before.m.name || "there"},\n\n${req.user!.businessName || "Your organisation"} changed your role to ${platformRole.replace(/_/g, " ")}. It applies from your next action in the Partner workspace.\n\nHelloCircle`,
      }).catch((e) => console.error("[org] role-change email failed:", e instanceof Error ? e.message : e));
    }
    const row = (await db.prepare(`SELECT row_version AS rowVersion FROM users WHERE id = ?`).get(req.params.id)) as { rowVersion: number };
    res.json({ ok: true, changed: before.changed, platformRole, rowVersion: Number(row.rowVersion) });
  } catch (e) {
    return staffChangeError(e, res);
  }
});

/** Removal: the member leaves the organisation. Their account stays (they keep
 * any resident identity and its session); their partner sessions end, and
 * their access to this organisation is gone on the next request. Listings
 * and coupons they created stay with the organisation: listing vendor_id
 * moves to the owner (the creator is kept in created_by_user_id), coupon
 * created_by_vendor_id moves to the owner; every moved id and its previous
 * holder is in the audit entry. Bookings, messages, decisions and audit
 * history are untouched. */
orgRouter.delete("/staff/:id", async (req, res) => {
  if (req.user!.invitedStaff) return res.status(403).json({ error: "Only the organisation owner can remove staff" });
  const { rowVersion } = req.body as { rowVersion?: unknown };
  try {
    const result = await db.transaction(async (tx) => {
      const m = await lockMember(tx, req.user!.id, req.user!.orgId, req.params.id, rowVersion);
      const moved: Record<string, string[]> = {};
      for (const t of ["centres", "clubs", "experiences", "programs"]) {
        const ids = ((await tx.prepare(`SELECT id FROM ${t} WHERE vendor_id = ? FOR UPDATE`).all(m.id)) as { id: string }[]).map((r) => r.id);
        if (ids.length) {
          await tx.prepare(`UPDATE ${t} SET created_by_user_id = COALESCE(created_by_user_id, vendor_id), vendor_id = ? WHERE vendor_id = ?`).run(req.user!.id, m.id);
          moved[t] = ids;
        }
      }
      const coupons = ((await tx.prepare(`SELECT id FROM coupons WHERE created_by_vendor_id = ? FOR UPDATE`).all(m.id)) as { id: number }[]).map((r) => String(r.id));
      if (coupons.length) {
        await tx.prepare(`UPDATE coupons SET created_by_vendor_id = ? WHERE created_by_vendor_id = ?`).run(req.user!.id, m.id);
        moved.coupons = coupons;
      }
      await tx.prepare(`UPDATE users SET org_id = NULL, platform_role = NULL, row_version = row_version + 1 WHERE id = ?`).run(m.id);
      // Partner sessions only; a resident (magic-link) session is a separate table and stays.
      await tx.prepare(`DELETE FROM sessions WHERE user_id = ?`).run(m.id);
      return { m, moved };
    });
    await writeAudit({
      actorUserId: req.user!.id,
      action: "org.staff_removed",
      objectType: "user",
      objectId: result.m.id,
      previousValue: { orgId: req.user!.orgId, platformRole: result.m.platformRole, membership: "member" },
      newValue: { orgId: null, membership: "removed", movedToOwner: { ownerId: req.user!.id, previousHolder: result.m.id, ...result.moved } },
    });
    void sendMail({
      to: result.m.email,
      subject: "You've been removed from an organisation on HelloCircle",
      text: `Hi ${result.m.name || "there"},\n\n${req.user!.businessName || "An organisation"} removed you from its team on HelloCircle, so you no longer have access to its Partner workspace. Your HelloCircle account itself hasn't been deleted.\n\nHelloCircle`,
    }).catch((e) => console.error("[org] removal email failed:", e instanceof Error ? e.message : e));
    res.json({ ok: true });
  } catch (e) {
    return staffChangeError(e, res);
  }
});

// Public — looked up by an unauthenticated invitee before they have an
// account, so it lives outside requireVendor even though it's in this file.
export const publicInviteRouter = Router();
publicInviteRouter.get("/:token", async (req, res) => {
  const invite = (await db
    .prepare(`SELECT oi.email, oi.platform_role as platformRole, o.name as orgName FROM org_invites oi JOIN organisations o ON o.id = oi.org_id WHERE oi.token = ? AND oi.status = 'pending' AND oi.expires_at > NOW()`)
    .get(req.params.token)) as { email: string; platformRole: string; orgName: string } | undefined;
  if (!invite) return res.status(404).json({ error: "This invite has expired or is no longer valid" });
  // D-08 follow-up — tells the acceptance page this is a previously removed
  // member rejoining (they confirm with their existing password), so it doesn't
  // ask them to create a new account. Only revealed to the holder of the link,
  // which was sent to that email address.
  const existing = (await db
    .prepare(`SELECT role, status, org_id AS orgId, invited_staff AS invitedStaff FROM users WHERE LOWER(email) = ?`)
    .get(invite.email.toLowerCase().trim())) as { role: string; status: string; orgId: string | null; invitedStaff: number } | undefined;
  const rejoin = !!existing && existing.role === "vendor" && existing.status === "approved" && !!existing.invitedStaff && !existing.orgId;
  res.json({ ...invite, rejoin });
});
