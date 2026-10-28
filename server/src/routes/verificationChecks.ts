import { Router, type Request, type Response } from "express";
import { adminCan, requireAdminPermission } from "../adminPermissions.js";
import { writeAudit } from "../audit.js";
import { requireVendor } from "../auth.js";
import { db } from "../db/index.js";
import { notifyPartner } from "../moderationNotify.js";
import { parseDecisionReason, recordDecision } from "../moderationDecisions.js";
import { CHECK_AVAILABILITY, CHECK_SUBJECT, expireChecks, isCheckType, openKey, type CheckStatus, type CheckType, type SubjectType } from "../verification.js";

// Trust & Retention batch 1 — the verification check workflow.
//
// Partner (organisation owner only): ask for a business-details check, answer
// a request for more information, see the outcome and the reason.
// Admin: queue → case page → request more information / approve (with a
// written note of what was checked and an optional expiry) / reject or revoke
// (D-03 reason the partner sees). Every step is audited; rowVersion stops two
// admins deciding the same case from stale screens. The admin's evidence note
// is shown only to roles holding decisions.internal_notes.view and never
// leaves the admin API. Identity checks are refused (see verification.ts).

const DETAILS_MIN = 20;
const DETAILS_MAX = 4000;

type CheckRow = {
  id: number;
  subjectType: SubjectType;
  subjectId: string;
  checkType: CheckType;
  status: CheckStatus;
  submittedDetails: string | null;
  infoRequest: string | null;
  evidenceNote: string | null;
  decisionReason: string | null;
  requestedBy: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  expiresAt: string | null;
  rowVersion: number;
  createdAt: string;
  updatedAt: string;
};

const COLUMNS = `id, subject_type as subjectType, subject_id as subjectId, check_type as checkType, status, submitted_details as submittedDetails,
  info_request as infoRequest, evidence_note as evidenceNote, decision_reason as decisionReason, requested_by as requestedBy,
  decided_by as decidedBy, decided_at as decidedAt, expires_at as expiresAt, row_version as rowVersion, created_at as createdAt, updated_at as updatedAt`;

async function loadCheck(id: string | number): Promise<CheckRow | undefined> {
  return (await db.prepare(`SELECT ${COLUMNS} FROM verification_checks WHERE id = ?`).get(id)) as CheckRow | undefined;
}

/** What a partner may see of their own check — never the admin's evidence note. */
function forPartner(c: CheckRow) {
  const { evidenceNote: _e, decidedBy: _d, requestedBy: _r, ...rest } = c;
  return rest;
}

async function subjectSummary(subjectType: SubjectType, subjectId: string) {
  if (subjectType === "vendor") {
    return ((await db.prepare(`SELECT id, COALESCE(NULLIF(business_name, ''), name) as name, email, county, status FROM users WHERE id = ? AND role = 'vendor'`).get(subjectId)) as
      | Record<string, unknown>
      | undefined) ?? null;
  }
  return ((await db.prepare(`SELECT id, name, email, host_status as hostStatus FROM residents WHERE id = ?`).get(subjectId)) as Record<string, unknown> | undefined) ?? null;
}

function staleOrMissing(res: Response, row: CheckRow | undefined, rowVersion: unknown) {
  if (!row) return res.status(404).json({ error: "Check not found" });
  if (typeof rowVersion !== "number" || rowVersion !== row.rowVersion) {
    return res.status(409).json({ error: "This check changed since you opened it. Reload and try again.", stale: true });
  }
  return null;
}

/** Conditional update — only one of two racing decisions lands. */
async function transition(row: CheckRow, from: CheckStatus[], set: string, params: unknown[]): Promise<boolean> {
  const r = await db
    .prepare(`UPDATE verification_checks SET ${set}, row_version = row_version + 1 WHERE id = ? AND row_version = ? AND status IN (${from.map(() => "?").join(", ")})`)
    .run(...params, row.id, row.rowVersion, ...from);
  return r.changes === 1;
}

// --- admin ------------------------------------------------------------------

export const adminVerificationRouter = Router();

adminVerificationRouter.get("/", requireAdminPermission("queues.view"), async (req, res) => {
  await expireChecks();
  const status = typeof req.query.status === "string" ? req.query.status : "open";
  const filter = status === "all" ? "" : status === "open" ? "WHERE c.status IN ('pending', 'more_info')" : "WHERE c.status = ?";
  const rows = await db
    .prepare(
      `SELECT c.id, c.subject_type as subjectType, c.subject_id as subjectId, c.check_type as checkType, c.status, c.created_at as createdAt,
              c.updated_at as updatedAt, c.decided_at as decidedAt, c.expires_at as expiresAt,
              COALESCE(NULLIF(u.business_name, ''), u.name, r.name) as subjectName
       FROM verification_checks c
       LEFT JOIN users u ON c.subject_type = 'vendor' AND u.id = c.subject_id
       LEFT JOIN residents r ON c.subject_type = 'resident' AND r.id = c.subject_id
       ${filter} ORDER BY c.status = 'pending' DESC, c.updated_at DESC LIMIT 300`
    )
    .all(...(filter.includes("?") ? [status] : []));
  res.json({ checks: rows, availability: CHECK_AVAILABILITY });
});

adminVerificationRouter.get("/:id", requireAdminPermission("queues.view"), async (req, res) => {
  const row = await loadCheck(req.params.id);
  if (!row) return res.status(404).json({ error: "Check not found" });
  const canSeeEvidence = adminCan(req.user, "decisions.internal_notes.view");
  const history = await db
    .prepare(
      `SELECT id, action, previous_state as previousState, new_state as newState, reason_category as category, explanation, created_at as decidedAt
       FROM moderation_decisions WHERE object_type = 'verification_check' AND object_id = ? ORDER BY id DESC`
    )
    .all(String(row.id));
  res.json({
    check: canSeeEvidence ? row : { ...row, evidenceNote: null },
    evidenceRestricted: !canSeeEvidence,
    subject: await subjectSummary(row.subjectType, row.subjectId),
    availability: CHECK_AVAILABILITY[row.checkType],
    history,
  });
});

/** An admin opens a check for a subject (e.g. after a phone call), as the partner could themselves. */
adminVerificationRouter.post("/", requireAdminPermission("queues.decide"), async (req, res) => {
  const { subjectId, checkType, details } = (req.body ?? {}) as { subjectId?: string; checkType?: string; details?: string };
  if (!isCheckType(checkType)) return res.status(400).json({ error: "checkType must be business_details, identity or organiser_identity" });
  if (!CHECK_AVAILABILITY[checkType].available) return res.status(409).json({ error: CHECK_AVAILABILITY[checkType].why, unavailable: true });
  const subjectType = CHECK_SUBJECT[checkType];
  if (!subjectId || !(await subjectSummary(subjectType, subjectId))) return res.status(404).json({ error: "No such account" });
  const text = typeof details === "string" ? details.trim() : "";
  try {
    const r = await db
      .prepare(`INSERT INTO verification_checks (subject_type, subject_id, check_type, status, submitted_details, requested_by, open_key) VALUES (?, ?, ?, 'pending', ?, ?, ?)`)
      .run(subjectType, subjectId, checkType, text.slice(0, DETAILS_MAX) || null, req.user!.id, openKey(subjectType, subjectId, checkType));
    await writeAudit({ actorUserId: req.user!.id, action: "verification.opened", objectType: "verification_check", objectId: String(r.lastInsertRowid), newValue: { subjectType, subjectId, checkType } });
    res.status(201).json({ id: Number(r.lastInsertRowid) });
  } catch (e) {
    if ((e as { code?: string }).code === "ER_DUP_ENTRY") return res.status(409).json({ error: "This account already has an open or approved check of this kind" });
    throw e;
  }
});

adminVerificationRouter.put("/:id/request-info", requireAdminPermission("queues.decide"), async (req, res) => {
  const row = await loadCheck(req.params.id);
  const { message, rowVersion } = (req.body ?? {}) as { message?: string; rowVersion?: number };
  if (staleOrMissing(res, row, rowVersion)) return;
  const text = typeof message === "string" ? message.trim() : "";
  if (text.length < DETAILS_MIN) return res.status(400).json({ error: `Say what you need (at least ${DETAILS_MIN} characters) — the partner sees this` });
  if (!(await transition(row!, ["pending"], "status = 'more_info', info_request = ?", [text.slice(0, DETAILS_MAX)]))) {
    return res.status(409).json({ error: "Only a pending check can be sent back for more information", stale: true });
  }
  await writeAudit({ actorUserId: req.user!.id, action: "verification.info_requested", objectType: "verification_check", objectId: String(row!.id), previousValue: { status: row!.status }, newValue: { status: "more_info" } });
  if (row!.subjectType === "vendor") {
    await notifyPartner(row!.subjectId, {
      title: "HelloCircle needs more information for your business check",
      intro: `To finish checking your business details we need a little more: ${text}`,
      kind: "verification",
      reason: null,
      nextSteps: "Reply from Organisation → Business check in your workspace.",
    });
  }
  res.json({ ok: true });
});

adminVerificationRouter.put("/:id/approve", requireAdminPermission("queues.decide"), async (req, res) => {
  const row = await loadCheck(req.params.id);
  const { evidenceNote, expiresAt, rowVersion } = (req.body ?? {}) as { evidenceNote?: string; expiresAt?: string | null; rowVersion?: number };
  if (staleOrMissing(res, row, rowVersion)) return;
  if (!CHECK_AVAILABILITY[row!.checkType].available) return res.status(409).json({ error: CHECK_AVAILABILITY[row!.checkType].why, unavailable: true });
  const note = typeof evidenceNote === "string" ? evidenceNote.trim() : "";
  if (note.length < DETAILS_MIN) return res.status(400).json({ error: `Record what you checked and against which record (at least ${DETAILS_MIN} characters)` });
  let expiry: string | null = null;
  if (expiresAt) {
    const d = new Date(expiresAt);
    if (Number.isNaN(d.getTime()) || d.getTime() <= Date.now()) return res.status(400).json({ error: "The expiry date must be in the future" });
    expiry = d.toISOString().slice(0, 19).replace("T", " ");
  }
  if (!(await transition(row!, ["pending"], "status = 'approved', evidence_note = ?, expires_at = ?, decided_by = ?, decided_at = NOW(), decision_reason = NULL", [note.slice(0, DETAILS_MAX), expiry, req.user!.id]))) {
    return res.status(409).json({ error: "Only a pending check can be approved", stale: true });
  }
  await recordDecision(db, { objectType: "verification_check", objectId: String(row!.id), action: "verification.approved", previousState: row!.status, newState: "approved", reason: null, actorUserId: req.user!.id });
  await writeAudit({ actorUserId: req.user!.id, action: "verification.approved", objectType: "verification_check", objectId: String(row!.id), previousValue: { status: row!.status }, newValue: { status: "approved", expiresAt: expiry } });
  if (row!.subjectType === "vendor") {
    await notifyPartner(row!.subjectId, {
      title: "Your business details have been checked",
      intro: "HelloCircle has checked your business details. Your public profile now shows “Business details checked”.",
      kind: "verification",
      reason: null,
      nextSteps: "",
    });
  }
  res.json({ ok: true });
});

async function decline(req: Request, res: Response, to: "rejected" | "revoked") {
  const row = await loadCheck(req.params.id);
  const { rowVersion } = (req.body ?? {}) as { rowVersion?: number };
  if (staleOrMissing(res, row, rowVersion)) return;
  const parsed = parseDecisionReason(req.body, "verification", true);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });
  const reason = parsed.reason!;
  const from: CheckStatus[] = to === "rejected" ? ["pending", "more_info"] : ["approved"];
  if (!(await transition(row!, from, "status = ?, decision_reason = ?, decided_by = ?, decided_at = NOW(), open_key = NULL", [to, reason.explanation, req.user!.id]))) {
    return res.status(409).json({ error: to === "rejected" ? "Only an open check can be declined" : "Only an approved check can be withdrawn", stale: true });
  }
  await recordDecision(db, { objectType: "verification_check", objectId: String(row!.id), action: `verification.${to}`, previousState: row!.status, newState: to, reason, actorUserId: req.user!.id });
  await writeAudit({ actorUserId: req.user!.id, action: `verification.${to}`, objectType: "verification_check", objectId: String(row!.id), previousValue: { status: row!.status }, newValue: { status: to, reasonCategory: reason.category } });
  if (row!.subjectType === "vendor") {
    await notifyPartner(row!.subjectId, {
      title: to === "rejected" ? "We couldn't confirm your business details" : "Your “Business details checked” label has been withdrawn",
      intro: to === "rejected" ? "HelloCircle couldn't confirm the business details you gave us." : "HelloCircle has withdrawn the business-details check from your profile.",
      kind: "verification",
      reason,
      nextSteps: "You can ask for a new check from your workspace once the details are up to date.",
    });
  }
  res.json({ ok: true });
}

adminVerificationRouter.put("/:id/reject", requireAdminPermission("queues.decide"), (req, res) => decline(req, res, "rejected"));
adminVerificationRouter.put("/:id/revoke", requireAdminPermission("queues.decide"), (req, res) => decline(req, res, "revoked"));

// --- partner ----------------------------------------------------------------

export const vendorVerificationRouter = Router();
vendorVerificationRouter.use(requireVendor);

/** The check belongs to the organisation's owner account; invited staff can read it but not ask. */
async function ownerId(req: Request): Promise<string> {
  if (!req.user!.orgId) return req.user!.id;
  const owner = (await db.prepare(`SELECT id FROM users WHERE org_id = ? AND invited_staff = 0 ORDER BY created_at LIMIT 1`).get(req.user!.orgId)) as { id: string } | undefined;
  return owner?.id ?? req.user!.id;
}

vendorVerificationRouter.get("/", async (req, res) => {
  await expireChecks();
  const subjectId = await ownerId(req);
  const rows = (await db
    .prepare(`SELECT ${COLUMNS} FROM verification_checks WHERE subject_type = 'vendor' AND subject_id = ? ORDER BY created_at DESC LIMIT 20`)
    .all(subjectId)) as CheckRow[];
  res.json({ checks: rows.map(forPartner), availability: CHECK_AVAILABILITY, canRequest: !req.user!.invitedStaff });
});

vendorVerificationRouter.post("/", async (req, res) => {
  if (req.user!.invitedStaff) return res.status(403).json({ error: "Only the organisation's owner can ask for a business check" });
  const { checkType, details } = (req.body ?? {}) as { checkType?: string; details?: string };
  if (checkType !== "business_details") return res.status(400).json({ error: "A partner can ask for a business details check" });
  const text = typeof details === "string" ? details.trim() : "";
  if (text.length < DETAILS_MIN) return res.status(400).json({ error: `Give the registered business name, number and address (at least ${DETAILS_MIN} characters)` });
  if (text.length > DETAILS_MAX) return res.status(400).json({ error: `Keep it under ${DETAILS_MAX} characters` });
  const subjectId = await ownerId(req);
  try {
    const r = await db
      .prepare(`INSERT INTO verification_checks (subject_type, subject_id, check_type, status, submitted_details, requested_by, open_key) VALUES ('vendor', ?, 'business_details', 'pending', ?, ?, ?)`)
      .run(subjectId, text, req.user!.id, openKey("vendor", subjectId, "business_details"));
    await writeAudit({ actorUserId: req.user!.id, action: "verification.requested", objectType: "verification_check", objectId: String(r.lastInsertRowid), newValue: { checkType: "business_details" } });
    res.status(201).json({ id: Number(r.lastInsertRowid), status: "pending" });
  } catch (e) {
    if ((e as { code?: string }).code === "ER_DUP_ENTRY") return res.status(409).json({ error: "You already have a business check open or approved" });
    throw e;
  }
});

vendorVerificationRouter.put("/:id/respond", async (req, res) => {
  if (req.user!.invitedStaff) return res.status(403).json({ error: "Only the organisation's owner can answer this" });
  const subjectId = await ownerId(req);
  const text = typeof req.body?.details === "string" ? req.body.details.trim() : "";
  if (text.length < DETAILS_MIN) return res.status(400).json({ error: `Add the information HelloCircle asked for (at least ${DETAILS_MIN} characters)` });
  const r = await db
    .prepare(
      `UPDATE verification_checks SET status = 'pending', submitted_details = CONCAT(COALESCE(submitted_details, ''), '\n\n— Added ', DATE_FORMAT(NOW(), '%Y-%m-%d'), ':\n', ?), row_version = row_version + 1
       WHERE id = ? AND subject_type = 'vendor' AND subject_id = ? AND status = 'more_info'`
    )
    .run(text.slice(0, DETAILS_MAX), req.params.id, subjectId);
  if (r.changes !== 1) return res.status(404).json({ error: "No check is waiting for your answer" });
  await writeAudit({ actorUserId: req.user!.id, action: "verification.info_provided", objectType: "verification_check", objectId: req.params.id, newValue: { status: "pending" } });
  res.json({ ok: true });
});
