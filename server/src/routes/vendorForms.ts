import { Router, type Request, type Response } from "express";
import { assertPlatformRole } from "../auth.js";
import { assertCapability, capabilityLimit } from "../capabilities.js";
import { CLASS_LABELS, DATA_CLASSES, fieldPolicy, INPUT_TYPES, LIBRARY } from "../fieldRegistry.js";
import { orderByRef, orderPeople, type OrderSource } from "../participation/orderRecords.js";
import { writeAudit } from "../audit.js";
import { db } from "../db/index.js";
import { attendeesOn, specialCategoryQuestionsOn } from "../participation/options.js";
import { activeQuestions, QuestionError, questionsVersion, readAnswersFor } from "../participation/questions.js";
import { cleanDraft, discardDraft, findTemplate, getDraft, publishDraft, saveDraft, usableTemplateQuestions, versionHistory, versionQuestions } from "../participation/forms.js";
import { ANSWER_SOURCE, DEFAULT_FORM_TYPE, FIXED_LIBRARY_FIELDS, PERSON_QUESTIONS } from "../participation/formListings.js";

// Phase H (docs/participation-expansion/19) — the Phase G form builder for club
// registrations, programme enrolments and hall bookings. The same engine,
// drafts, versions, templates and policy as experiences (vendorAttendees.ts);
// only the listing lookup and the role differ. Mounted under routes/vendor.ts
// (requireVendor + attachVendorIds already ran; check-in-only staff can't reach it).
//   read the form / versions          — any member of the owning organisation
//   draft, publish                    — the role that edits that listing (as in vendorListings/vendorPrograms)
//   answers people gave               — the same role (they see these orders' contact details already)
// Writes need participation.attendees and the organisation's registration_questions capability.

export const vendorFormsRouter = Router();

type Typed = "club" | "program" | "centre";
const TYPES = "club|program|centre";
interface OwnedListing { type: Typed; id: string; title: string; vendorId: string; role: "centre_manager" | "facility_manager" }

async function ownedListing(req: Request, res: Response): Promise<OwnedListing | null> {
  const type = req.params.listingType as Typed;
  const id = req.params.id;
  let row: { title: string; vendorId: string; parent?: string } | undefined;
  if (type === "club") row = (await db.prepare(`SELECT name AS title, vendor_id AS vendorId FROM clubs WHERE id = ?`).get(id)) as typeof row;
  else if (type === "centre") row = (await db.prepare(`SELECT name AS title, vendor_id AS vendorId FROM centres WHERE id = ?`).get(id)) as typeof row;
  else row = (await db.prepare(`SELECT title, vendor_id AS vendorId, listing_type AS parent FROM programs WHERE id = ?`).get(id)) as typeof row;
  if (!row || !row.vendorId || !req.vendorIds!.includes(row.vendorId)) {
    res.status(403).json({ error: "Not your listing" });
    return null;
  }
  // Same split as the listing editors: halls (and programmes at a hall) are the centre manager's, clubs the facility manager's.
  const role = type === "centre" || (type === "program" && row.parent === "centre") ? "centre_manager" : "facility_manager";
  return { type, id, title: row.title, vendorId: row.vendorId, role };
}

async function canEdit(req: Request, res: Response, l: OwnedListing): Promise<boolean> {
  if (!assertPlatformRole(req, res, l.role)) return false;
  if (!(await attendeesOn())) {
    res.status(404).json({ error: "Registration questions aren't available yet" });
    return false;
  }
  return assertCapability(req, res, "registration_questions", l.vendorId);
}

async function suggestedForm(l: OwnedListing): Promise<string> {
  const row = (await db
    .prepare(`SELECT c.suggested_form AS f FROM listing_taxonomy lt JOIN taxonomy_categories c ON c.id = lt.category_id WHERE lt.listing_type = ? AND lt.listing_id = ?`)
    .get(l.type, l.id)) as { f: string | null } | undefined;
  return row?.f ?? DEFAULT_FORM_TYPE[l.type];
}

function formError(res: Response, e: unknown): void {
  if (e instanceof QuestionError) {
    res.status(e.status).json({ error: e.message, code: e.code });
    return;
  }
  throw e;
}

vendorFormsRouter.get(`/forms/:listingType(${TYPES})/:id/questions`, async (req, res) => {
  const l = await ownedListing(req, res);
  if (!l) return;
  const policy = await fieldPolicy();
  const special = await specialCategoryQuestionsOn();
  res.json({
    listingType: l.type,
    title: l.title,
    questions: await activeQuestions(l.type, l.id),
    version: await questionsVersion(l.id, db, l.type),
    enabled: await attendeesOn(),
    specialCategoryEnabled: special,
    // Ready-made fields this listing's own fixed form already asks are left out; a hall form asks once per booking.
    library: LIBRARY.filter((f) => policy.library[f.key] && !FIXED_LIBRARY_FIELDS[l.type].includes(f.key) && (PERSON_QUESTIONS[l.type] || f.scope === "booking")),
    allowedTypes: INPUT_TYPES.filter((t) => policy.customTypes[t]),
    classes: DATA_CLASSES.map((c) => ({ key: c, label: CLASS_LABELS[c], exportable: policy.classes[c].exportable, retentionDays: policy.classes[c].retentionDays })),
    personQuestions: PERSON_QUESTIONS[l.type],
    suggestedFormType: await suggestedForm(l),
    draft: await getDraft(l.id, special, db, l.type),
  });
});

vendorFormsRouter.put(`/forms/:listingType(${TYPES})/:id/questions/draft`, async (req, res) => {
  const l = await ownedListing(req, res);
  if (!l || !(await canEdit(req, res, l))) return;
  try {
    const questions = cleanDraft((req.body ?? {}).questions);
    const base = await getDraft(l.id, false, db, l.type);
    await saveDraft(l.id, questions, base?.baseVersion ?? (await questionsVersion(l.id, db, l.type)), req.user!.id, l.type);
    res.json({ draft: await getDraft(l.id, await specialCategoryQuestionsOn(), db, l.type) });
  } catch (e) {
    formError(res, e);
  }
});

vendorFormsRouter.delete(`/forms/:listingType(${TYPES})/:id/questions/draft`, async (req, res) => {
  const l = await ownedListing(req, res);
  if (!l || !assertPlatformRole(req, res, l.role)) return;
  res.json({ discarded: await discardDraft(l.id, l.type) });
});

vendorFormsRouter.post(`/forms/:listingType(${TYPES})/:id/questions/draft/from`, async (req, res) => {
  const l = await ownedListing(req, res);
  if (!l || !(await canEdit(req, res, l))) return;
  const { templateId, version } = (req.body ?? {}) as { templateId?: unknown; version?: unknown };
  let questions;
  if (typeof templateId === "string") {
    const t = await findTemplate(templateId, req.user!.orgId ?? null, await fieldPolicy());
    if (!t || t.status !== "active") return res.status(404).json({ error: "Template not found" });
    questions = t.scope === "platform" ? usableTemplateQuestions(t.questions, await fieldPolicy()) : t.questions;
  } else if (typeof version === "number" && Number.isInteger(version)) {
    questions = await versionQuestions(l.id, version, l.type);
    if (!questions.length && version !== 0) return res.status(404).json({ error: "Unknown version" });
  } else {
    return res.status(400).json({ error: "Choose a template or a version" });
  }
  // A template is a preset (D-A5): anything this listing can't ask shows up as a draft issue, never live.
  await saveDraft(l.id, questions, await questionsVersion(l.id, db, l.type), req.user!.id, l.type);
  res.json({ draft: await getDraft(l.id, await specialCategoryQuestionsOn(), db, l.type) });
});

vendorFormsRouter.post(`/forms/:listingType(${TYPES})/:id/questions/publish`, async (req, res) => {
  const l = await ownedListing(req, res);
  if (!l || !(await canEdit(req, res, l))) return;
  try {
    const draft = await getDraft(l.id, false, db, l.type);
    const max = await capabilityLimit(l.vendorId, "registration_questions", "max_questions");
    if (draft && draft.questions.length > max) return res.status(400).json({ error: `Your organisation can ask at most ${max} questions per listing` });
    const result = await publishDraft(l.id, await specialCategoryQuestionsOn(), req.user!.id, l.type);
    await writeAudit({
      actorUserId: req.user!.id,
      action: `${l.type}.questions_published`,
      objectType: l.type,
      objectId: l.id,
      previousValue: { questions: result.before.map((q) => ({ key: q.key, label: q.label })) },
      newValue: { version: result.version, questions: result.questions.map((q) => ({ key: q.key, label: q.label, section: q.section, showIf: q.showIf })) },
    });
    res.json({ version: result.version, questions: result.questions });
  } catch (e) {
    formError(res, e);
  }
});

vendorFormsRouter.get(`/forms/:listingType(${TYPES})/:id/questions/versions`, async (req, res) => {
  const l = await ownedListing(req, res);
  if (!l) return;
  res.json({ versions: await versionHistory(l.id, l.type) });
});

vendorFormsRouter.get(`/forms/:listingType(${TYPES})/:id/questions/versions/:version`, async (req, res) => {
  const l = await ownedListing(req, res);
  if (!l) return;
  const v = Number(req.params.version);
  if (!Number.isInteger(v) || v < 1) return res.status(400).json({ error: "Unknown version" });
  res.json({ version: v, questions: await versionQuestions(l.id, v, l.type) });
});

/** The answers people gave, per order (confirmed and cancelled; never unpaid checkouts). */
vendorFormsRouter.get(`/forms/:listingType(${TYPES})/:id/answers`, async (req, res) => {
  const l = await ownedListing(req, res);
  if (!l || !assertPlatformRole(req, res, l.role)) return;
  const sql =
    l.type === "club"
      ? `SELECT ref, CONCAT(child_first, ' ', child_last) AS name, created_at AS at, status FROM registrations WHERE club_id = ? AND payment_status IN ('paid', 'refunded') ORDER BY created_at DESC LIMIT 500`
      : l.type === "program"
        ? `SELECT ref, participant_name AS name, created_at AS at, status FROM program_enrollments WHERE program_id = ? AND payment_status IN ('paid', 'refunded') ORDER BY created_at DESC LIMIT 500`
        : `SELECT ref, name, CONCAT(date, ' ', time) AS at, status FROM bookings WHERE centre_id = ? AND payment_status IN ('paid', 'refunded') ORDER BY date DESC, time DESC LIMIT 500`;
  const orders = (await db.prepare(sql).all(l.id)) as { ref: string; name: string; at: string | Date; status: string }[];
  const answers = await readAnswersFor(ANSWER_SOURCE[l.type], orders.map((o) => o.ref));
  res.json({
    orders: orders
      .filter((o) => answers.has(o.ref))
      .map((o) => ({ ref: o.ref, name: o.name, at: o.at instanceof Date ? o.at.toISOString() : String(o.at), cancelled: o.status === "cancelled", answers: answers.get(o.ref) ?? [] })),
  });
});

// --- export (Phase L) -------------------------------------------------------------
// The answers as CSV for the listing's role, under the same rules as the
// experience export: only questions the partner marked exportable AND whose
// data class the platform lets be exported; never contact details or
// special categories. Every export is audited (who, which listing, how many rows).

const SOURCE_OF: Record<Typed, OrderSource> = { club: "registration", program: "program", centre: "booking" };
const csvCell = (v: unknown) => {
  const t = v === null || v === undefined ? "" : String(v);
  const safe = /^[=+\-@\t\r]/.test(t) ? `'${t}` : t;
  return `"${safe.replace(/"/g, '""')}"`;
};

vendorFormsRouter.get(`/forms/:listingType(${TYPES})/:id/answers.csv`, async (req, res) => {
  const l = await ownedListing(req, res);
  if (!l || !assertPlatformRole(req, res, l.role)) return;
  const policy = await fieldPolicy();
  const questions = (await activeQuestions(l.type, l.id)).filter((q) => q.exportable && q.inputType !== "info" && (DATA_CLASSES as readonly string[]).includes(q.category) && policy.classes[q.category as (typeof DATA_CLASSES)[number]].exportable);
  const sql =
    l.type === "club"
      ? `SELECT ref FROM registrations WHERE club_id = ? AND payment_status = 'paid' ORDER BY created_at`
      : l.type === "program"
        ? `SELECT ref FROM program_enrollments WHERE program_id = ? AND payment_status = 'paid' ORDER BY created_at`
        : `SELECT ref FROM bookings WHERE centre_id = ? AND payment_status = 'paid' ORDER BY date, time`;
  const refs = ((await db.prepare(sql).all(l.id)) as { ref: string }[]).map((r) => r.ref);
  const answers = await readAnswersFor(ANSWER_SOURCE[l.type], refs);
  const header = ["Reference", "Status", "Person", "Adult or child", ...questions.map((q) => q.label)];
  const lines = [header.map(csvCell).join(",")];
  for (const ref of refs) {
    const order = await orderByRef(SOURCE_OF[l.type], ref);
    if (!order) continue;
    const own = answers.get(ref) ?? [];
    const person = (await orderPeople(order))[0];
    const cell = (key: string, scope: string) => own.find((a) => a.key === key && a.attendeeNo === (scope === "booking" ? 0 : 1))?.display ?? "";
    lines.push([ref, order.status === "cancelled" ? "Cancelled" : "Confirmed", person?.name ?? order.contactName, person ? (person.personType === "child" ? "Child" : "Adult") : "", ...questions.map((q) => cell(q.key, q.scope))].map(csvCell).join(","));
  }
  await writeAudit({ actorUserId: req.user!.id, action: `${l.type}.answers_exported`, objectType: l.type, objectId: l.id, newValue: { rows: refs.length, questions: questions.map((q) => q.key) } });
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="answers-${l.type}-${l.id}.csv"`);
  res.send(lines.join("\r\n"));
});
