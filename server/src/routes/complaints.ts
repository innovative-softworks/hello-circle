import { Router } from "express";
import { writeAudit } from "../audit.js";
import { db } from "../db/index.js";
import { simpleRateLimit } from "../rateLimit.js";
import { isValidEmail } from "../util.js";
import { requireAdminPermission } from "../adminPermissions.js";

// Revenue & Connect Stage 4 — complaints, notices and appeals (DSA notice
// and action + internal complaint handling). Anyone can submit; signed-in
// partners/residents can see their own. Support admins decide, and every
// decision carries a statement of reasons that the submitter can read.

export const complaintsRouter = Router();

const complaintLimiter = simpleRateLimit({ windowMs: 15 * 60 * 1000, max: 10 });

const KINDS = ["complaint", "notice", "appeal"] as const;
const SUBJECTS = ["booking", "listing", "review", "circle", "game", "account", "payout", "moderation_decision", "other"] as const;

complaintsRouter.post("/", complaintLimiter, async (req, res) => {
  const b = (req.body ?? {}) as Record<string, unknown>;
  const kind = String(b.kind ?? "");
  const subjectType = String(b.subjectType ?? "");
  const body = typeof b.body === "string" ? b.body.trim() : "";
  const subjectRef = typeof b.subjectRef === "string" && b.subjectRef.trim() ? b.subjectRef.trim().slice(0, 191) : null;
  if (!(KINDS as readonly string[]).includes(kind)) return res.status(400).json({ error: "Choose what kind of request this is" });
  if (!(SUBJECTS as readonly string[]).includes(subjectType)) return res.status(400).json({ error: "Choose what this is about" });
  if (body.length < 20) return res.status(400).json({ error: "Please describe the problem (at least 20 characters)" });
  if (body.length > 5000) return res.status(400).json({ error: "Please keep it under 5,000 characters" });

  let submitterType = "anonymous";
  let submitterId: string | null = null;
  let email = typeof b.email === "string" ? b.email.trim().toLowerCase() : "";
  if (req.user) {
    submitterType = "user";
    submitterId = req.user.id;
    email = req.user.email;
  } else if (req.resident) {
    submitterType = "resident";
    submitterId = req.resident.id;
    email = req.resident.email;
  }
  if (!isValidEmail(email)) return res.status(400).json({ error: "An email address is needed so we can reply" });

  let reportId: number | null = null;
  if (kind === "appeal" && subjectType === "moderation_decision" && subjectRef && /^\d+$/.test(subjectRef)) {
    const report = await db.prepare(`SELECT id FROM reports WHERE id = ? AND status <> 'pending'`).get(Number(subjectRef));
    if (report) reportId = Number(subjectRef);
  }

  const r = await db
    .prepare(`INSERT INTO complaints (kind, subject_type, subject_ref, report_id, submitter_type, submitter_id, email, body) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(kind, subjectType, subjectRef, reportId, submitterType, submitterId, email, body);
  res.status(201).json({ id: Number(r.lastInsertRowid), status: "open" });
});

const MINE_FIELDS = `id, kind, subject_type as subjectType, subject_ref as subjectRef, body, status, decision, statement_of_reasons as statementOfReasons,
  decided_at as decidedAt, created_at as createdAt`;

complaintsRouter.get("/mine", async (req, res) => {
  const subject = req.user ? ["user", req.user.id] : req.resident ? ["resident", req.resident.id] : null;
  if (!subject) return res.status(401).json({ error: "Sign in to see your requests" });
  res.json(await db.prepare(`SELECT ${MINE_FIELDS} FROM complaints WHERE submitter_type = ? AND submitter_id = ? ORDER BY created_at DESC LIMIT 100`).all(...subject));
});

// --- admin (support) ----------------------------------------------------------------

export const adminComplaintsRouter = Router();

adminComplaintsRouter.get("/", requireAdminPermission("complaints.handle"), async (req, res) => {
  const status = typeof req.query.status === "string" && ["open", "in_review", "closed"].includes(req.query.status) ? req.query.status : null;
  res.json(
    await db
      .prepare(
        `SELECT ${MINE_FIELDS}, report_id as reportId, submitter_type as submitterType, submitter_id as submitterId, email, decided_by as decidedBy
         FROM complaints ${status ? "WHERE status = ?" : ""} ORDER BY created_at DESC LIMIT 200`
      )
      .all(...(status ? [status] : []))
  );
});

adminComplaintsRouter.put("/:id", requireAdminPermission("complaints.handle"), async (req, res) => {
  const { status, decision, statementOfReasons } = (req.body ?? {}) as { status?: string; decision?: string; statementOfReasons?: string };
  const id = Number(req.params.id);
  const row = (await db.prepare(`SELECT id, status, report_id as reportId, kind FROM complaints WHERE id = ?`).get(id)) as { id: number; status: string; reportId: number | null; kind: string } | undefined;
  if (!row) return res.status(404).json({ error: "Not found" });
  if (row.status === "closed") return res.status(409).json({ error: "This request is already decided" });
  if (status === "in_review") {
    await db.prepare(`UPDATE complaints SET status = 'in_review' WHERE id = ? AND status = 'open'`).run(id);
    return res.json({ ok: true });
  }
  if (status !== "closed" || !["upheld", "rejected", "resolved"].includes(decision ?? "")) return res.status(400).json({ error: "Close with a decision: upheld, rejected or resolved" });
  const reasons = (statementOfReasons ?? "").trim();
  if (reasons.length < 20) return res.status(400).json({ error: "A statement of reasons (at least 20 characters) is required — the submitter will see it" });
  // Appeals must be decided by someone other than whoever decided the original report.
  if (row.reportId) {
    const original = (await db.prepare(`SELECT decided_by as decidedBy FROM reports WHERE id = ?`).get(row.reportId)) as { decidedBy: string | null } | undefined;
    if (original?.decidedBy && original.decidedBy === req.user!.id) return res.status(403).json({ error: "An appeal must be decided by someone other than the original decision-maker" });
  }
  await db
    .prepare(`UPDATE complaints SET status = 'closed', decision = ?, statement_of_reasons = ?, decided_by = ?, decided_at = NOW() WHERE id = ? AND status <> 'closed'`)
    .run(decision, reasons.slice(0, 5000), req.user!.id, id);
  await writeAudit({ actorUserId: req.user!.id, action: "complaint.decided", objectType: "complaint", objectId: String(id), newValue: { decision }, reason: reasons.slice(0, 500) });
  res.json({ ok: true });
});
