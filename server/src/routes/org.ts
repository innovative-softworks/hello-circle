import crypto from "node:crypto";
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

const PLATFORM_ROLES = ["centre_manager", "facility_manager", "finance", "communications", "read_only_analyst"];

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
  const staff = await db
    .prepare(`SELECT id, name, email, platform_role as platformRole, status FROM users WHERE org_id = ? ORDER BY invited_staff, created_at`)
    .all(orgId);
  const pendingInvites = await db
    .prepare(`SELECT token, email, platform_role as platformRole, created_at as createdAt FROM org_invites WHERE org_id = ? AND status = 'pending' AND expires_at > NOW()`)
    .all(orgId);
  const locations = await db.prepare(`SELECT id, name, 'centre' as type FROM centres WHERE vendor_id IN (SELECT id FROM users WHERE org_id = ?) UNION ALL SELECT id, name, 'club' as type FROM clubs WHERE vendor_id IN (SELECT id FROM users WHERE org_id = ?)`).all(orgId, orgId);
  // Read-only here — feature flags are admin-controlled, never vendor-self-
  // serve (see routes/admin.ts's GET/PUT). Surfaced so the vendor UI can
  // proactively hide/disable a create button rather than only ever failing
  // server-side after the fact.
  const flags = await orgFeatureFlagsById(orgId);

  res.json({
    org,
    policies: policies ?? { cancellationHours: 48, bookingWindowDays: 90, refundPolicyText: null, taxNumber: null, businessRegistrationNumber: null },
    staff,
    pendingInvites,
    locations,
    isOwner: !req.user!.invitedStaff,
    flags,
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
  await db
    .prepare(`INSERT INTO org_invites (token, org_id, email, platform_role, expires_at) VALUES (?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL 7 DAY))`)
    .run(token, req.user!.orgId, email.toLowerCase().trim(), platformRole);
  writeAudit({
    actorUserId: req.user!.id,
    action: "org.staff_invited",
    objectType: "org_invite",
    objectId: token,
    newValue: { email: email.toLowerCase().trim(), platformRole },
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

orgRouter.delete("/staff/invite/:token", async (req, res) => {
  if (req.user!.invitedStaff) return res.status(403).json({ error: "Only the organisation owner can manage invites" });
  await db.prepare(`UPDATE org_invites SET status = 'revoked' WHERE token = ? AND org_id = ?`).run(req.params.token, req.user!.orgId);
  writeAudit({ actorUserId: req.user!.id, action: "org.staff_invite_revoked", objectType: "org_invite", objectId: req.params.token });
  res.json({ ok: true });
});

// Public — looked up by an unauthenticated invitee before they have an
// account, so it lives outside requireVendor even though it's in this file.
export const publicInviteRouter = Router();
publicInviteRouter.get("/:token", async (req, res) => {
  const invite = (await db
    .prepare(`SELECT oi.email, oi.platform_role as platformRole, o.name as orgName FROM org_invites oi JOIN organisations o ON o.id = oi.org_id WHERE oi.token = ? AND oi.status = 'pending' AND oi.expires_at > NOW()`)
    .get(req.params.token)) as { email: string; platformRole: string; orgName: string } | undefined;
  if (!invite) return res.status(404).json({ error: "This invite has expired or is no longer valid" });
  res.json(invite);
});
