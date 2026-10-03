import crypto from "node:crypto";
import { Router } from "express";
import { logEvent } from "../analytics.js";
import { db } from "../db/index.js";
import { sendMail } from "../email.js";
import { notifyResident } from "../notifications.js";
import { getResidentByEmail, requireResident } from "../residents.js";
import { CLIENT_URL } from "../stripe.js";
import { isValidEmail } from "../util.js";
import { getShareData, type ShareEntityType } from "./sharing.js";
import { loadViewableGame } from "../gameVisibility.js";
import { writeAudit } from "../audit.js";

export const invitationsRouter = Router();

// Universal Sharing & Invitation system, Phase 2 — a polymorphic
// person-to-person invite (§8/§9/§12), distinct from circle_invites (see
// db/index.ts's own comment on the invitations table for why circle
// membership keeps its own, older, dedicated flow). Scoped to entities a
// person can meaningfully be invited to *participate in*: games, programs
// and experiences — per the spec's §7 "Invite" is for activities/events/
// plans/bookings, not for a Centre/Club/Host/Provider profile page, which
// only ever gets the broader "Share" action.
const INVITABLE_ENTITY_TYPES = new Set<ShareEntityType>(["game", "experience", "adventure", "program"]);

const INVITE_EXPIRY_DAYS = 30;

interface InviteRow {
  id: string;
  token: string;
  entity_type: ShareEntityType;
  entity_id: string;
  inviter_resident_id: string;
  invitee_resident_id: string | null;
  invitee_email: string | null;
  status: string;
  created_at: string;
  responded_at: string | null;
  expires_at: string;
}

function effectiveStatus(row: Pick<InviteRow, "status" | "expires_at">): string {
  if (row.status === "pending" && new Date(row.expires_at).getTime() < Date.now()) return "expired";
  return row.status;
}

interface CreateInviteBody {
  entityType?: string;
  entityId?: string;
  inviteeResidentIds?: string[];
  inviteeEmails?: string[];
  message?: string;
}

// Creates one invitation per invitee (resident id or email) — never a
// single multi-recipient row, so each invitee gets their own accept/decline
// state (a duplicate for the same invitee+entity just re-sends rather than
// erroring, per the spec's "duplicate invitations are handled").
invitationsRouter.post("/", requireResident, async (req, res) => {
  const b = req.body as CreateInviteBody;
  const entityType = b.entityType as ShareEntityType;
  if (!entityType || !INVITABLE_ENTITY_TYPES.has(entityType)) return res.status(400).json({ error: "This can't be invited to — only activities, experiences and programs can." });
  if (!b.entityId) return res.status(400).json({ error: "entityId is required" });
  // A private share teaser is not authority to grant another resident access.
  if (entityType === "game" && !(await loadViewableGame(b.entityId, req.resident!.id))) return res.status(404).json({ error: "That activity is no longer available" });
  const residentIds = (b.inviteeResidentIds ?? []).filter(Boolean);
  const emails = (b.inviteeEmails ?? []).map((e) => e.trim().toLowerCase()).filter((e) => isValidEmail(e));
  if (residentIds.length === 0 && emails.length === 0) return res.status(400).json({ error: "At least one person to invite is required" });

  const data = await getShareData(entityType, b.entityId, req.resident!.id);
  if (!data) return res.status(404).json({ error: "That activity is no longer available" });

  const expiresAt = new Date(Date.now() + INVITE_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

  // Phase 11B — a revoked invitation is only re-issued by someone who may
  // manage it (the activity host or the original inviter); anyone else's
  // "invite" for that person is skipped rather than silently reviving it.
  const manager = await canManageInvitationsFor(entityType, b.entityId, req.resident!.id);
  const revokedFor = async (column: "invitee_resident_id" | "invitee_email", value: string) =>
    (await db.prepare(`SELECT inviter_resident_id as inviterId FROM invitations WHERE entity_type = ? AND entity_id = ? AND ${column} = ? AND status = 'revoked'`)
      .get(entityType, b.entityId, value)) as { inviterId: string } | undefined;
  const blockedResidents = new Set<string>();
  for (const residentId of residentIds) {
    const r = await revokedFor("invitee_resident_id", residentId);
    if (r && !manager && r.inviterId !== req.resident!.id) blockedResidents.add(residentId);
  }
  const blockedEmails = new Set<string>();
  for (const email of emails) {
    // An email belonging to an existing resident is stored by resident id.
    const existing = await getResidentByEmail(email);
    const r = existing ? await revokedFor("invitee_resident_id", existing.id) : await revokedFor("invitee_email", email);
    if (r && !manager && r.inviterId !== req.resident!.id) blockedEmails.add(email);
  }
  residentIds.splice(0, residentIds.length, ...residentIds.filter((id) => !blockedResidents.has(id)));
  emails.splice(0, emails.length, ...emails.filter((e) => !blockedEmails.has(e)));
  if (residentIds.length === 0 && emails.length === 0) return res.status(201).json({ ok: true, count: 0 });

  await db.transaction(async (tx) => {
    for (const residentId of residentIds) {
      if (residentId === req.resident!.id) continue;
      const id = crypto.randomUUID();
      const token = crypto.randomBytes(24).toString("base64url");
      await tx
        .prepare(
          `INSERT INTO invitations (id, token, entity_type, entity_id, inviter_resident_id, invitee_resident_id, expires_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE status = 'pending', token = VALUES(token), created_at = NOW(), responded_at = NULL, expires_at = VALUES(expires_at)`
        )
        .run(id, token, entityType, b.entityId, req.resident!.id, residentId, expiresAt);
    }
    for (const email of emails) {
      const existingResident = await getResidentByEmail(email);
      const id = crypto.randomUUID();
      const token = crypto.randomBytes(24).toString("base64url");
      await tx
        .prepare(
          `INSERT INTO invitations (id, token, entity_type, entity_id, inviter_resident_id, invitee_resident_id, invitee_email, expires_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE status = 'pending', token = VALUES(token), created_at = NOW(), responded_at = NULL, expires_at = VALUES(expires_at)`
        )
        .run(id, token, entityType, b.entityId, req.resident!.id, existingResident?.id ?? null, existingResident ? null : email);
    }
  });

  // Notify/email — best-effort, outside the transaction (same "never block
  // the write on a notification failure" contract as every other notifier
  // in this app).
  for (const residentId of residentIds) {
    if (residentId === req.resident!.id) continue;
    await notifyResident({
      residentId,
      kind: "invite",
      title: `${req.resident!.name} invited you: ${data.title}`,
      body: b.message || `Want to join ${data.title}?`,
      listingType: entityType === "adventure" ? "experience" : (entityType as "game" | "experience" | "program"),
      listingId: b.entityId,
      ref: b.entityId,
    });
  }
  for (const email of emails) {
    const existingResident = await getResidentByEmail(email);
    if (existingResident) {
      await notifyResident({
        residentId: existingResident.id,
        kind: "invite",
        title: `${req.resident!.name} invited you: ${data.title}`,
        body: b.message || `Want to join ${data.title}?`,
        listingType: entityType === "adventure" ? "experience" : (entityType as "game" | "experience" | "program"),
        listingId: b.entityId,
        ref: b.entityId,
      });
    } else {
      const row = (await db.prepare(`SELECT token FROM invitations WHERE entity_type = ? AND entity_id = ? AND invitee_email = ?`).get(entityType, b.entityId, email)) as { token: string } | undefined;
      if (row) {
        const inviteUrl = `${CLIENT_URL}/i/${row.token}`;
        await sendMail({
          to: email,
          subject: `${req.resident!.name} invited you to ${data.title} — HelloCircle`,
          text: `Hi,\n\n${req.resident!.name} has invited you to join ${data.title}${data.date ? ` on ${data.date}${data.time ? ` at ${data.time}` : ""}` : ""}.\n\n${b.message ? `"${b.message}"\n\n` : ""}View the invitation:\n${inviteUrl}\n\nThanks for using Hello Circle.`,
          cta: { label: "View invitation", url: inviteUrl },
        }).catch(() => {});
      }
    }
  }

  void logEvent("invite_created", { residentId: req.resident!.id, metadata: { entityType, entityId: b.entityId, count: residentIds.length + emails.length } });
  res.status(201).json({ ok: true, count: residentIds.length + emails.length });
});

// This resident's own pending inbox — mirrors circles.ts's GET
// /invitations/mine, generalized across every invitable entity type.
interface MineRow {
  id: string;
  entityType: ShareEntityType;
  entityId: string;
  status: string;
  createdAt: string;
  expiresAt: string;
  inviterName: string;
}

invitationsRouter.get("/mine", requireResident, async (req, res) => {
  const rows = (await db
    .prepare(
      `SELECT i.id, i.entity_type as entityType, i.entity_id as entityId, i.status, i.created_at as createdAt, i.expires_at as expiresAt,
              r.name as inviterName
       FROM invitations i JOIN residents r ON r.id = i.inviter_resident_id
       WHERE i.invitee_resident_id = ? AND i.status = 'pending'
       ORDER BY i.created_at DESC`
    )
    .all(req.resident!.id)) as MineRow[];

  const withData = await Promise.all(
    rows.map(async (row) => {
      const status = effectiveStatus({ status: row.status, expires_at: row.expiresAt });
      const data = status === "pending" ? await getShareData(row.entityType, row.entityId, req.resident!.id) : null;
      return { id: row.id, entityType: row.entityType, entityId: row.entityId, status, createdAt: row.createdAt, inviterName: row.inviterName, entity: data };
    })
  );
  res.json(withData.filter((r) => r.status === "pending"));
});

// Public token lookup — no auth required, backs the /i/:token landing page
// (§12). Never leaks who else was invited or any payment/booking detail;
// just the same shareable entity preview plus the inviter's first name.
invitationsRouter.get("/token/:token", async (req, res) => {
  const row = (await db
    .prepare(`SELECT i.*, r.name as inviterName FROM invitations i JOIN residents r ON r.id = i.inviter_resident_id WHERE i.token = ?`)
    .get(req.params.token)) as (InviteRow & { inviterName: string }) | undefined;
  if (!row) return res.status(404).json({ error: "This invitation link isn't valid" });
  const status = effectiveStatus(row);
  // Phase 11B — a revoked invitation reveals nothing (its token is also
  // rotated on revoke, so an old link normally 404s before reaching here).
  if (status === "revoked") return res.status(404).json({ error: "This invitation link isn't valid" });
  const data = await getShareData(row.entity_type, row.entity_id, req.resident?.id ?? null);
  if (!data) return res.status(404).json({ error: "This activity is no longer available" });
  void logEvent("invite_opened", { residentId: req.resident?.id ?? null, metadata: { entityType: row.entity_type, entityId: row.entity_id } });
  res.json({ status, inviterName: row.inviterName, entity: data, respondable: status === "pending" });
});

interface RespondBody {
  response?: "accepted" | "maybe" | "declined";
}

async function respondToInvite(row: InviteRow, response: "accepted" | "maybe" | "declined", residentId: string) {
  const consumed = await db.prepare(`UPDATE invitations SET status = ?, responded_at = NOW(), invitee_resident_id = ?
    WHERE id = ? AND token = ? AND status = 'pending' AND expires_at > NOW()`).run(response, residentId, row.id, row.token);
  if (consumed.changes !== 1) return false;
  const data = await getShareData(row.entity_type, row.entity_id, residentId);
  const resident = (await db.prepare(`SELECT name FROM residents WHERE id = ?`).get(residentId)) as { name: string } | undefined;
  await notifyResident({
    residentId: row.inviter_resident_id,
    kind: "invite",
    title: `${resident?.name ?? "Someone"} ${response === "accepted" ? "accepted" : response === "declined" ? "declined" : "might join"}: ${data?.title ?? "your invite"}`,
    body: `${resident?.name ?? "Someone"} responded to your invitation to ${data?.title ?? "your activity"}.`,
    listingType: row.entity_type === "adventure" ? "experience" : (row.entity_type as "game" | "experience" | "program"),
    listingId: row.entity_id,
    ref: row.entity_id,
  });
  void logEvent(response === "accepted" ? "invite_accepted" : response === "declined" ? "invite_declined" : "invite_maybe", {
    residentId,
    metadata: { entityType: row.entity_type, entityId: row.entity_id },
  });
  return true;
}

invitationsRouter.post("/:id/respond", requireResident, async (req, res) => {
  const { response } = req.body as RespondBody;
  if (response !== "accepted" && response !== "maybe" && response !== "declined") return res.status(400).json({ error: "Invalid response" });
  const row = (await db.prepare(`SELECT * FROM invitations WHERE id = ?`).get(req.params.id)) as InviteRow | undefined;
  if (!row || row.invitee_resident_id !== req.resident!.id) return res.status(404).json({ error: "Invitation not found" });
  if (effectiveStatus(row) !== "pending") return res.status(409).json({ error: "This invitation has already been answered or has expired" });
  if (!(await respondToInvite(row, response, req.resident!.id))) return res.status(409).json({ error: "This invitation has already been answered or has expired" });
  res.json({ ok: true });
});

// Token-based respond — for an invitee who followed an email link. Requires
// the visitor to already be signed in (magic link) so the response is tied
// to a real resident; the invitation's invitee_resident_id is backfilled to
// whoever responds, same as circle_invites never needed to since it's
// always resident-id-based already.
invitationsRouter.post("/token/:token/respond", requireResident, async (req, res) => {
  const { response } = req.body as RespondBody;
  if (response !== "accepted" && response !== "maybe" && response !== "declined") return res.status(400).json({ error: "Invalid response" });
  const row = (await db.prepare(`SELECT * FROM invitations WHERE token = ?`).get(req.params.token)) as InviteRow | undefined;
  if (!row) return res.status(404).json({ error: "Invitation not found" });
  if (row.invitee_resident_id && row.invitee_resident_id !== req.resident!.id) return res.status(403).json({ error: "This invitation was sent to someone else" });
  if (!row.invitee_resident_id && (!row.invitee_email || row.invitee_email.trim().toLowerCase() !== req.resident!.email.trim().toLowerCase())) return res.status(403).json({ error: "This invitation was sent to someone else" });
  if (effectiveStatus(row) !== "pending") return res.status(409).json({ error: "This invitation has already been answered or has expired" });
  if (!(await respondToInvite(row, response, req.resident!.id))) return res.status(409).json({ error: "This invitation has already been answered or has expired" });
  res.json({ ok: true });
});

// --- Phase 11B — sent invitations + revocation --------------------------------
// The activity host may manage every invitation to their activity; anyone
// else only the invitations they sent themselves. Rows are identified by
// their id — the bearer token that accepts an invitation is never exposed.

async function canManageInvitationsFor(entityType: string, entityId: string, residentId: string): Promise<boolean> {
  if (entityType !== "game") return false;
  const game = (await db.prepare(`SELECT host_resident_id as hostId FROM games WHERE id = ?`).get(entityId)) as { hostId: string } | undefined;
  return game?.hostId === residentId;
}

function maskEmail(email: string): string {
  const [user, domain] = email.split("@");
  return `${user.slice(0, 1)}${"•".repeat(Math.max(1, Math.min(user.length - 1, 4)))}@${domain ?? ""}`;
}

invitationsRouter.get("/sent", requireResident, async (req, res) => {
  const entityType = String(req.query.entityType ?? "");
  const entityId = String(req.query.entityId ?? "");
  if (!INVITABLE_ENTITY_TYPES.has(entityType as ShareEntityType) || !entityId) return res.status(400).json({ error: "entityType and entityId are required" });
  const manager = await canManageInvitationsFor(entityType, entityId, req.resident!.id);
  const rows = (await db
    .prepare(
      `SELECT i.id, i.status, i.expires_at as expiresAt, i.created_at as createdAt, i.responded_at as respondedAt,
              i.inviter_resident_id as inviterId, i.invitee_email as inviteeEmail, r.name as inviteeName
       FROM invitations i LEFT JOIN residents r ON r.id = i.invitee_resident_id
       WHERE i.entity_type = ? AND i.entity_id = ? ${manager ? "" : "AND i.inviter_resident_id = ?"}
       ORDER BY i.created_at DESC`
    )
    .all(...(manager ? [entityType, entityId] : [entityType, entityId, req.resident!.id]))) as {
    id: string; status: string; expiresAt: string; createdAt: string; respondedAt: string | null; inviterId: string; inviteeEmail: string | null; inviteeName: string | null;
  }[];
  res.json(
    rows.map((r) => {
      const status = effectiveStatus({ status: r.status, expires_at: r.expiresAt });
      return {
        id: r.id,
        invitee: r.inviteeName ?? (r.inviteeEmail ? maskEmail(r.inviteeEmail) : "Invited guest"),
        status,
        createdAt: r.createdAt,
        expiresAt: r.expiresAt,
        sentByMe: r.inviterId === req.resident!.id,
        canRevoke: status === "pending",
      };
    })
  );
});

invitationsRouter.post("/:id/revoke", requireResident, async (req, res) => {
  const row = (await db.prepare(`SELECT id, entity_type, entity_id, inviter_resident_id, status, expires_at FROM invitations WHERE id = ?`).get(req.params.id)) as
    | Pick<InviteRow, "id" | "entity_type" | "entity_id" | "inviter_resident_id" | "status" | "expires_at">
    | undefined;
  // Unauthorised and nonexistent look the same — no probing of invitation ids.
  const allowed = !!row && (row.inviter_resident_id === req.resident!.id || (await canManageInvitationsFor(row.entity_type, row.entity_id, req.resident!.id)));
  if (!row || !allowed) return res.status(404).json({ error: "Invitation not found" });

  // Single conditional transition; the token is rotated so the old link is dead.
  const result = await db
    .prepare(`UPDATE invitations SET status = 'revoked', responded_at = NOW(), token = ? WHERE id = ? AND status = 'pending' AND expires_at > NOW()`)
    .run(crypto.randomBytes(24).toString("base64url"), row.id);
  if (result.changes === 1) {
    await writeAudit({ actorUserId: req.resident!.id, action: "invitation.revoked", objectType: "invitation", objectId: row.id, previousValue: { status: "pending" }, newValue: { status: "revoked", entityType: row.entity_type, entityId: row.entity_id } });
    void logEvent("invite_revoked", { residentId: req.resident!.id, metadata: { entityType: row.entity_type, entityId: row.entity_id } });
    return res.json({ ok: true, status: "revoked" });
  }
  const current = (await db.prepare(`SELECT status, expires_at FROM invitations WHERE id = ?`).get(row.id)) as { status: string; expires_at: string };
  const status = effectiveStatus(current);
  if (status === "revoked") return res.json({ ok: true, status: "revoked", alreadyRevoked: true });
  if (status === "expired") return res.status(409).json({ error: "This invitation has already expired", status });
  return res.status(409).json({ error: "This invitation has already been answered, so it can't be revoked", status });
});
