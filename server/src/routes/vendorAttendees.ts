import { Router, type Request, type Response } from "express";
import { requirePlatformRole } from "../auth.js";
import { writeAudit } from "../audit.js";
import { db } from "../db/index.js";
import { ROSTER_ROLES } from "./vendorHelpers.js";
import { readAttendeesFor, reconcile } from "../participation/attendees.js";
import { readOrderLinesFor } from "../participation/lines.js";
import { attendeesOn, checkinOn, specialCategoryQuestionsOn } from "../participation/options.js";
import { activeQuestions, cleanQuestionSet, questionsVersion, QuestionError, readAnswersFor, replaceQuestions } from "../participation/questions.js";
import { attendanceSummary, checkinsFor } from "../participation/checkin.js";

// Participation Phase 2 (docs/participation-expansion/11 X2–X3, 12) — the
// partner side of attendees, registration questions and check-in staff for
// an experience or event. Mounted under routes/vendor.ts (requireVendor +
// attachVendorIds already ran). Each route names its role group, reusing the
// existing ones:
//   attendee list (names, contacts, answers) — ROSTER_ROLES, like the roster
//   attendance summary (counts only)        — ROSTER_ROLES + read_only_analyst
//   question set / check-in staff edits     — EXPERIENCE_ROLES (same two managers)
// Finance and communications get nothing new here.

export const vendorAttendeesRouter = Router();

const EDIT_ROLES = ["centre_manager", "facility_manager"] as const;

async function ownedExperience(req: Request, res: Response): Promise<{ id: string; title: string; vendorId: string } | null> {
  const row = (await db.prepare(`SELECT id, title, vendor_id AS vendorId FROM experiences WHERE id = ?`).get(req.params.id)) as { id: string; title: string; vendorId: string } | undefined;
  if (!row || !req.vendorIds!.includes(row.vendorId)) {
    res.status(403).json({ error: "Not your listing" });
    return null;
  }
  return row;
}

// --- attendees ---------------------------------------------------------------

vendorAttendeesRouter.get("/experiences/:id/attendees", requirePlatformRole(...ROSTER_ROLES), async (req, res) => {
  const exp = await ownedExperience(req, res);
  if (!exp) return;
  const sessionId = typeof req.query.sessionId === "string" && req.query.sessionId ? req.query.sessionId : null;
  // Paid and refunded/cancelled ones too, so the partner sees why someone isn't on the door list.
  const rows = (await db
    .prepare(
      `SELECT eb.ref, eb.session_id AS sessionId, eb.participant_name AS participantName, eb.email, eb.phone, eb.party_size AS partySize,
              eb.status, eb.payment_status AS paymentStatus, eb.created_at AS createdAt, es.date, es.time
       FROM experience_bookings eb JOIN experience_sessions es ON es.id = eb.session_id
       WHERE eb.experience_id = ? AND eb.payment_status IN ('paid', 'refunded')${sessionId ? " AND eb.session_id = ?" : ""}
       ORDER BY es.date, es.time, eb.participant_name`
    )
    .all(...(sessionId ? [exp.id, sessionId] : [exp.id]))) as {
    ref: string;
    sessionId: string;
    participantName: string;
    email: string;
    phone: string;
    partySize: number;
    status: string;
    paymentStatus: string;
    createdAt: string;
    date: string;
    time: string;
  }[];
  const refs = rows.map((r) => r.ref);
  const people = await readAttendeesFor("experience", rows.map((r) => ({ ref: r.ref, partySize: Number(r.partySize), participantName: r.participantName })));
  const answers = await readAnswersFor("experience", refs);
  const lines = await readOrderLinesFor("experience", refs);
  const checks = await checkinsFor(refs);
  res.json({
    questions: await activeQuestions("experience", exp.id),
    bookings: rows.map((r) => {
      const ps = people.get(r.ref) ?? [];
      const c = checks.get(r.ref) ?? [];
      return {
        ...r,
        partySize: Number(r.partySize),
        lines: (lines.get(r.ref) ?? []).map((l) => ({ lineNo: l.lineNo, kind: l.kind, label: l.label, quantity: l.quantity, heads: l.heads })),
        attendees: ps.map((p) => {
          const hit = c.find((x) => Number(x.attendee_no) === p.attendeeNo);
          return { ...p, checkedInAt: hit ? new Date(hit.checked_in_at).toISOString() : null, checkinMethod: hit?.method ?? null };
        }),
        answers: answers.get(r.ref) ?? [],
        issues: reconcile(ps, Number(r.partySize), lines.get(r.ref) ?? []),
      };
    }),
  });
});

vendorAttendeesRouter.get("/experiences/:id/attendance-summary", requirePlatformRole(...ROSTER_ROLES, "read_only_analyst"), async (req, res) => {
  const exp = await ownedExperience(req, res);
  if (!exp) return;
  res.json({ sessions: await attendanceSummary(exp.id) });
});

// --- registration questions ---------------------------------------------------

vendorAttendeesRouter.get("/experiences/:id/questions", async (req, res) => {
  const exp = await ownedExperience(req, res);
  if (!exp) return;
  res.json({
    questions: await activeQuestions("experience", exp.id),
    version: await questionsVersion(exp.id),
    enabled: await attendeesOn(),
    specialCategoryEnabled: await specialCategoryQuestionsOn(),
  });
});

vendorAttendeesRouter.put("/experiences/:id/questions", requirePlatformRole(...EDIT_ROLES), async (req, res) => {
  const exp = await ownedExperience(req, res);
  if (!exp) return;
  if (!(await attendeesOn())) return res.status(404).json({ error: "Registration questions aren't available yet" });
  const { questions, version } = (req.body ?? {}) as { questions?: unknown; version?: unknown };
  if (typeof version !== "number" || !Number.isInteger(version) || version < 0) return res.status(400).json({ error: "Send the version you edited" });
  try {
    const before = await activeQuestions("experience", exp.id);
    const set = cleanQuestionSet(questions, await specialCategoryQuestionsOn());
    const saved = await replaceQuestions(exp.id, set, version, req.user!.id);
    await writeAudit({
      actorUserId: req.user!.id,
      action: "experience.questions_saved",
      objectType: "experience",
      objectId: exp.id,
      previousValue: { version, questions: before.map((q) => ({ key: q.key, label: q.label, inputType: q.inputType, required: q.required, doorVisible: q.doorVisible })) },
      newValue: { version: saved.version, questions: saved.questions.map((q) => ({ key: q.key, label: q.label, inputType: q.inputType, required: q.required, doorVisible: q.doorVisible })) },
    });
    res.json({ questions: saved.questions, version: saved.version });
  } catch (e) {
    if (e instanceof QuestionError) return res.status(e.status).json({ error: e.message, code: e.code });
    throw e;
  }
});

// --- check-in staff for this listing -----------------------------------------
// Members with the check-in-only role, assigned to the whole listing or to one
// date. Managers and the owner already check in for every listing.

vendorAttendeesRouter.get("/experiences/:id/checkin-staff", requirePlatformRole(...ROSTER_ROLES), async (req, res) => {
  const exp = await ownedExperience(req, res);
  if (!exp) return;
  const orgId = req.user!.orgId ?? "";
  const assignments = await db
    .prepare(
      `SELECT a.id, a.user_id AS userId, u.name, u.email, a.session_id AS sessionId, es.date, es.time, a.created_at AS createdAt
       FROM listing_staff_assignments a JOIN users u ON u.id = a.user_id LEFT JOIN experience_sessions es ON es.id = a.session_id
       WHERE a.org_id = ? AND a.listing_type = 'experience' AND a.listing_id = ? AND a.revoked_at IS NULL ORDER BY u.name, es.date`
    )
    .all(orgId, exp.id);
  const members = await db
    .prepare(`SELECT id, name, email FROM users WHERE org_id = ? AND role = 'vendor' AND invited_staff = 1 AND platform_role = 'checkin_staff' AND status = 'approved' ORDER BY name`)
    .all(orgId);
  res.json({ assignments, members, enabled: await checkinOn() });
});

vendorAttendeesRouter.post("/experiences/:id/checkin-staff", requirePlatformRole(...EDIT_ROLES), async (req, res) => {
  const exp = await ownedExperience(req, res);
  if (!exp) return;
  if (!(await checkinOn())) return res.status(404).json({ error: "Door check-in isn't available yet" });
  const { userId, sessionId } = (req.body ?? {}) as { userId?: unknown; sessionId?: unknown };
  if (typeof userId !== "string" || !userId) return res.status(400).json({ error: "Choose a team member" });
  const orgId = req.user!.orgId;
  if (!orgId) return res.status(403).json({ error: "No organisation" });
  const member = (await db
    .prepare(`SELECT id, name FROM users WHERE id = ? AND org_id = ? AND role = 'vendor' AND invited_staff = 1 AND platform_role = 'checkin_staff' AND status = 'approved'`)
    .get(userId, orgId)) as { id: string; name: string } | undefined;
  if (!member) return res.status(400).json({ error: "Only members of your organisation with the Check-in only role can be assigned" });
  let session: string | null = null;
  if (sessionId !== undefined && sessionId !== null && sessionId !== "") {
    if (typeof sessionId !== "string") return res.status(400).json({ error: "Choose a date" });
    const s = await db.prepare(`SELECT id FROM experience_sessions WHERE id = ? AND experience_id = ?`).get(sessionId, exp.id);
    if (!s) return res.status(400).json({ error: "That date isn't on this listing" });
    session = sessionId;
  }
  const activeKey = `${member.id}:experience:${exp.id}:${session ?? "*"}`;
  const ins = await db
    .prepare(
      `INSERT IGNORE INTO listing_staff_assignments (org_id, listing_type, listing_id, session_id, user_id, duty, active_key, created_by) VALUES (?, 'experience', ?, ?, ?, 'checkin', ?, ?)`
    )
    .run(orgId, exp.id, session, member.id, activeKey, req.user!.id);
  if (ins.changes !== 1) return res.status(409).json({ error: `${member.name} is already assigned${session ? " to that date" : " to this listing"}` });
  await writeAudit({ actorUserId: req.user!.id, action: "experience.checkin_staff_assigned", objectType: "experience", objectId: exp.id, newValue: { userId: member.id, sessionId: session } });
  res.status(201).json({ ok: true });
});

vendorAttendeesRouter.delete("/experiences/:id/checkin-staff/:assignmentId", requirePlatformRole(...EDIT_ROLES), async (req, res) => {
  const exp = await ownedExperience(req, res);
  if (!exp) return;
  const r = await db
    .prepare(
      `UPDATE listing_staff_assignments SET revoked_at = NOW(), revoked_by = ?, active_key = NULL
       WHERE id = ? AND org_id = ? AND listing_type = 'experience' AND listing_id = ? AND revoked_at IS NULL`
    )
    .run(req.user!.id, req.params.assignmentId, req.user!.orgId ?? "", exp.id);
  if (r.changes !== 1) return res.status(404).json({ error: "Assignment not found" });
  await writeAudit({ actorUserId: req.user!.id, action: "experience.checkin_staff_revoked", objectType: "experience", objectId: exp.id, newValue: { assignmentId: req.params.assignmentId } });
  res.json({ ok: true });
});
