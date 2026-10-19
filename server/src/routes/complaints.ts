import { Router } from "express";
import { writeAudit } from "../audit.js";
import { db } from "../db/index.js";
import { simpleRateLimit } from "../rateLimit.js";
import { isValidEmail } from "../util.js";
import { requireAdminPermission } from "../adminPermissions.js";
import { notifyResident } from "../notifications.js";

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

  // OG-17 / DEC-12 — a complaint or notice about a business's or a host's own
  // booking, listing, activity or Circle is also shown to them (the text and
  // the outcome, never the person's email or identity) so they can respond.
  const owner = kind === "appeal" ? null : await subjectOwner(subjectType, subjectRef);
  const r = await db
    .prepare(
      `INSERT INTO complaints (kind, subject_type, subject_ref, report_id, submitter_type, submitter_id, email, body, subject_vendor_id, subject_host_resident_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(kind, subjectType, subjectRef, reportId, submitterType, submitterId, email, body, owner?.vendorId ?? null, owner?.hostResidentId ?? null);
  const id = Number(r.lastInsertRowid);
  if (owner) await tellSubject(owner, id).catch((e) => console.error("[complaints] subject notice failed:", e instanceof Error ? e.message : e));
  res.status(201).json({ id, status: "open" });
});

/** Who a complaint is about: the partner behind a listing or order, or the host/organiser of an activity or Circle. */
async function subjectOwner(type: string, ref: string | null): Promise<{ vendorId?: string; hostResidentId?: string } | null> {
  if (!ref) return null;
  const one = async (sql: string) => ((await db.prepare(sql).get(ref)) as { v: string | null } | undefined)?.v ?? null;
  if (type === "listing") {
    const v = (await one(`SELECT vendor_id as v FROM centres WHERE id = ?`)) ?? (await one(`SELECT vendor_id as v FROM clubs WHERE id = ?`)) ?? (await one(`SELECT vendor_id as v FROM experiences WHERE id = ?`));
    return v ? { vendorId: v } : null;
  }
  if (type === "booking") {
    const v =
      (await one(`SELECT c.vendor_id as v FROM bookings b JOIN centres c ON c.id = b.centre_id WHERE b.ref = ?`)) ??
      (await one(`SELECT c.vendor_id as v FROM registrations r JOIN clubs c ON c.id = r.club_id WHERE r.ref = ?`)) ??
      (await one(`SELECT p.vendor_id as v FROM program_enrollments pe JOIN programs p ON p.id = pe.program_id WHERE pe.ref = ?`)) ??
      (await one(`SELECT e.vendor_id as v FROM experience_bookings eb JOIN experiences e ON e.id = eb.experience_id WHERE eb.ref = ?`));
    if (v) return { vendorId: v };
    const h = await one(`SELECT g.host_resident_id as v FROM game_participants gp JOIN games g ON g.id = gp.game_id WHERE gp.ref = ?`);
    return h ? { hostResidentId: h } : null;
  }
  if (type === "game") {
    const h = await one(`SELECT host_resident_id as v FROM games WHERE id = ?`);
    return h ? { hostResidentId: h } : null;
  }
  if (type === "circle") {
    const h = await one(`SELECT created_by_resident_id as v FROM circles WHERE id = ?`);
    return h ? { hostResidentId: h } : null;
  }
  return null;
}

async function tellSubject(owner: { vendorId?: string; hostResidentId?: string }, id: number) {
  const title = "Someone has raised a complaint about you";
  const body = `A complaint (#${id}) concerns one of your bookings or listings. You can read it and add your response in your workspace. HelloCircle reviews it and decides; you'll see the outcome.`;
  if (owner.vendorId) {
    await db.prepare(`INSERT INTO notifications (recipient_id, kind, title, body, listing_type, listing_id, ref) VALUES (?, 'complaint', ?, ?, 'account', ?, ?)`).run(owner.vendorId, title, body, owner.vendorId, String(id));
  } else if (owner.hostResidentId) {
    await notifyResident({ residentId: owner.hostResidentId, kind: "moderation", title, body, listingType: "host", listingId: owner.hostResidentId, ref: String(id) });
  }
}

// What the business or host may see: never the submitter's email or identity,
// and never internal notes.
const SUBJECT_FIELDS = `id, kind, subject_type as subjectType, subject_ref as subjectRef, body, status, decision, statement_of_reasons as statementOfReasons,
  decided_at as decidedAt, created_at as createdAt, partner_response as response, partner_responded_at as respondedAt`;

export async function complaintsAbout(owner: { vendorIds?: string[]; hostResidentId?: string }) {
  if (owner.vendorIds) {
    if (!owner.vendorIds.length) return [];
    return db
      .prepare(`SELECT ${SUBJECT_FIELDS} FROM complaints WHERE subject_vendor_id IN (${owner.vendorIds.map(() => "?").join(", ")}) ORDER BY created_at DESC LIMIT 200`)
      .all(...owner.vendorIds);
  }
  return db.prepare(`SELECT ${SUBJECT_FIELDS} FROM complaints WHERE subject_host_resident_id = ? ORDER BY created_at DESC LIMIT 200`).all(owner.hostResidentId);
}

export async function respondAsSubject(id: number, owner: { vendorIds?: string[]; hostResidentId?: string }, responder: string, response: string): Promise<{ status: number; error?: string }> {
  const text = response.trim();
  if (text.length < 10) return { status: 400, error: "Write a response of at least 10 characters" };
  const scope = owner.vendorIds
    ? owner.vendorIds.length
      ? `subject_vendor_id IN (${owner.vendorIds.map(() => "?").join(", ")})`
      : "1 = 0"
    : "subject_host_resident_id = ?";
  const r = await db
    .prepare(`UPDATE complaints SET partner_response = ?, partner_responded_at = NOW(), partner_responded_by = ? WHERE id = ? AND status <> 'closed' AND ${scope}`)
    .run(text.slice(0, 4000), responder, id, ...(owner.vendorIds ?? [owner.hostResidentId]));
  if (r.changes !== 1) return { status: 404, error: "Complaint not found, or already decided" };
  await writeAudit({ actorUserId: responder, actorKind: owner.vendorIds ? "user" : "resident", action: "complaint.subject_responded", objectType: "complaint", objectId: String(id) });
  return { status: 200 };
}

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
        `SELECT ${MINE_FIELDS}, report_id as reportId, submitter_type as submitterType, submitter_id as submitterId, email, decided_by as decidedBy,
                partner_response as partnerResponse, partner_responded_at as partnerRespondedAt
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
