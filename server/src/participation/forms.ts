import crypto from "node:crypto";
import { db } from "../db/index.js";
import { FORM_TYPES, isFormType, type FormTypeKey } from "../categoryPolicy.js";
import { fieldPolicy, libraryField, type FieldPolicy } from "../fieldRegistry.js";
import { activeQuestions, cleanQuestionSet, QuestionError, questionFromRow, questionsVersion, replaceQuestions, type CleanQuestion, type Question, type QuestionInput } from "./questions.js";

// Configuration framework Phase G (docs/participation-expansion/17) — the form
// builder's storage, on top of the Phase 2 question sets:
//
// - Live form   = the listing's active registration_questions (published
//                 versions; every older version is still there, inactive).
// - Draft       = registration_form_drafts: the partner's work in progress, saved
//                 as they go and never seen by anyone booking. Publishing runs the
//                 full registry/policy validation and the existing versioned
//                 replace, so answers already given keep their own snapshot.
// - Templates   = platform templates (code, one per form type, built from
//                 ready-made fields) and an organisation's own (saved from a
//                 form; duplicated; archived, never deleted).
// A template is a starting point only: applying one fills the draft.

type Tx = Pick<typeof db, "prepare">;
export const MAX_DRAFT_BYTES = 60_000;

export interface TemplateView {
  id: string;
  scope: "platform" | "organisation";
  formType: FormTypeKey;
  name: string;
  description: string;
  status: "active" | "archived";
  questions: QuestionInput[];
  updatedAt: string | null;
}

const info = (label: string, help = "") => ({ scope: "booking", inputType: "info", label, help, purpose: "Information for everyone booking" });

/** Platform templates: one per form type, from ready-made fields (the registry decides availability). */
export const PLATFORM_TEMPLATES: TemplateView[] = (
  [
    ["event_registration", "Event registration", "Badge names, how people travel and food preferences.", [{ fieldKey: "badge_name", section: "About each person" }, { fieldKey: "food_preference", section: "About each person" }, { fieldKey: "transport", section: "Getting there" }, { ...info("Doors open 30 minutes before the start"), section: "Getting there" }]],
    ["activity_registration", "Activity registration", "Experience level and equipment.", [{ fieldKey: "experience_level" }, { fieldKey: "equipment" }]],
    ["programme_enrolment", "Programme enrolment", "Experience level and how people travel.", [{ fieldKey: "experience_level" }, { fieldKey: "transport" }]],
    ["club_registration", "Club registration", "Experience level, kit size and photo consent (when HelloCircle allows it).", [{ fieldKey: "experience_level" }, { fieldKey: "tshirt_size" }, { fieldKey: "photo_consent" }]],
    ["experience_booking", "Experience booking", "Experience level and equipment, with a what-to-bring note.", [{ fieldKey: "experience_level" }, { fieldKey: "equipment" }, info("Wear comfortable clothes and bring water")]],
    ["venue_booking", "Venue or room booking", "How people arrive, with a note about the room.", [{ fieldKey: "transport" }, info("Please leave the room as you found it")]],
    ["volunteer_registration", "Volunteer registration", "T-shirt size and photo consent (when HelloCircle allows it).", [{ fieldKey: "tshirt_size" }, { fieldKey: "photo_consent" }]],
  ] as [FormTypeKey, string, string, QuestionInput[]][]
).map(([formType, name, description, questions]) => ({ id: `platform:${formType}`, scope: "platform", formType, name, description, status: "active", questions, updatedAt: null }));

/** A platform template's fields the current policy allows (an admin-only field that's off is skipped),
 * with every ready-made field spelled out from the registry so the builder can show it. */
export function usableTemplateQuestions(questions: QuestionInput[], policy: FieldPolicy): QuestionInput[] {
  return questions.filter((q) => typeof q.fieldKey !== "string" || policy.library[q.fieldKey] === true).map(expandLibrary);
}

/** Fills a ready-made field's wording, type and choices from the registry (the partner's own settings kept). */
export function expandLibrary(q: QuestionInput): QuestionInput {
  const lib = typeof q.fieldKey === "string" ? libraryField(q.fieldKey) : undefined;
  const base = { key: typeof q.key === "string" ? q.key : `q_${crypto.randomBytes(5).toString("hex")}`, required: false, doorVisible: false, exportable: false, editability: "until_start", placeholder: "", defaultValue: null, minLength: null, maxLength: null, min: null, max: null, help: "", choices: [] as string[], appliesTo: "all", section: null, showIf: null, category: "general" };
  if (!lib) return { ...base, ...q };
  return { ...base, ...q, label: lib.label, purpose: lib.purpose, help: lib.help, scope: lib.scope, inputType: lib.inputType, choices: lib.choices, appliesTo: lib.appliesTo, category: lib.dataClass };
}

/** Converts live questions into the builder's input shape (for drafts, templates and history). */
export function asInput(q: Question | CleanQuestion): QuestionInput & Record<string, unknown> {
  return {
    key: q.key,
    fieldKey: q.fieldKey,
    scope: q.scope,
    inputType: q.inputType,
    label: q.label,
    help: q.help,
    purpose: q.purpose,
    required: q.required,
    choices: q.choices,
    min: q.min,
    max: q.max,
    appliesTo: q.appliesTo,
    doorVisible: q.doorVisible,
    category: q.category,
    placeholder: q.placeholder,
    defaultValue: q.defaultValue,
    minLength: q.minLength,
    maxLength: q.maxLength,
    editability: q.editability,
    exportable: q.exportable,
    section: q.section,
    showIf: q.showIf,
  };
}

// --- drafts --------------------------------------------------------------------------

export interface DraftView {
  questions: QuestionInput[];
  baseVersion: number;
  updatedAt: string;
  /** Problems that must be fixed before publishing (the draft itself is kept as typed). */
  issues: string[];
}

function issuesOf(questions: unknown, special: boolean, policy: FieldPolicy): string[] {
  try {
    cleanQuestionSet(questions, special, policy);
    return [];
  } catch (e) {
    return [e instanceof QuestionError ? e.message : "This form can't be published yet"];
  }
}

export async function getDraft(listingId: string, special: boolean, tx: Tx = db): Promise<DraftView | null> {
  const row = (await tx.prepare(`SELECT base_version, draft_json, updated_at FROM registration_form_drafts WHERE listing_type = 'experience' AND listing_id = ?`).get(listingId)) as
    | { base_version: number; draft_json: string; updated_at: Date | string }
    | undefined;
  if (!row) return null;
  let questions: QuestionInput[] = [];
  try {
    questions = JSON.parse(row.draft_json) as QuestionInput[];
  } catch {
    questions = [];
  }
  questions = questions.map(expandLibrary);
  return { questions, baseVersion: Number(row.base_version), updatedAt: new Date(row.updated_at).toISOString(), issues: issuesOf(questions, special, await fieldPolicy(tx)) };
}

/** Shape-only checks for a draft; full validation happens on publish. */
export function cleanDraft(raw: unknown): QuestionInput[] {
  if (!Array.isArray(raw)) throw new QuestionError("Send the list of questions");
  if (raw.length > 12) throw new QuestionError("Ask at most 12 questions — only ask what you need");
  if (!raw.every((r) => r && typeof r === "object" && !Array.isArray(r))) throw new QuestionError("Each question must be a set of fields");
  const json = JSON.stringify(raw);
  if (json.length > MAX_DRAFT_BYTES) throw new QuestionError("This draft is too long");
  return JSON.parse(json) as QuestionInput[];
}

export async function saveDraft(listingId: string, questions: QuestionInput[], baseVersion: number, userId: string): Promise<void> {
  await db
    .prepare(
      `INSERT INTO registration_form_drafts (listing_type, listing_id, base_version, draft_json, updated_by) VALUES ('experience', ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE base_version = VALUES(base_version), draft_json = VALUES(draft_json), updated_by = VALUES(updated_by)`
    )
    .run(listingId, baseVersion, JSON.stringify(questions), userId);
}

export async function discardDraft(listingId: string): Promise<boolean> {
  return (await db.prepare(`DELETE FROM registration_form_drafts WHERE listing_type = 'experience' AND listing_id = ?`).run(listingId)).changes === 1;
}

/**
 * Publishes the draft: full validation against the registry and the field
 * policy, then the versioned replace. Refused (409) when the live form changed
 * since the draft was started, so one partner can't overwrite another's publish.
 */
export async function publishDraft(listingId: string, special: boolean, userId: string): Promise<{ version: number; questions: Question[]; before: Question[] }> {
  const draft = await getDraft(listingId, special);
  if (!draft) throw new QuestionError("There's no draft to publish", 404);
  const live = await questionsVersion(listingId);
  if (draft.baseVersion !== live) throw new QuestionError("The live form changed since this draft was started — copy the live form into a new draft and make your changes again", 409, "stale");
  const set = cleanQuestionSet(draft.questions, special, await fieldPolicy());
  const before = await activeQuestions("experience", listingId);
  const saved = await replaceQuestions(listingId, set, live, userId);
  await discardDraft(listingId);
  return { ...saved, before };
}

// --- version history -------------------------------------------------------------------

export async function versionHistory(listingId: string): Promise<{ version: number; questions: number; publishedAt: string; publishedBy: string | null; live: boolean }[]> {
  const live = await questionsVersion(listingId);
  const rows = (await db
    .prepare(
      `SELECT q.version, COUNT(*) AS n, MIN(q.created_at) AS at, MIN(q.created_by_user_id) AS byId, MIN(u.name) AS byName
       FROM registration_questions q LEFT JOIN users u ON u.id = q.created_by_user_id
       WHERE q.listing_type = 'experience' AND q.listing_id = ? GROUP BY q.version ORDER BY q.version DESC`
    )
    .all(listingId)) as { version: number; n: number; at: Date | string; byId: string | null; byName: string | null }[];
  return rows.map((r) => ({ version: Number(r.version), questions: Number(r.n), publishedAt: new Date(r.at).toISOString(), publishedBy: r.byName ?? null, live: Number(r.version) === live }));
}

export async function versionQuestions(listingId: string, version: number): Promise<QuestionInput[]> {
  const rows = (await db.prepare(`SELECT * FROM registration_questions WHERE listing_type = 'experience' AND listing_id = ? AND version = ? ORDER BY sort_order`).all(listingId, version)) as Parameters<typeof questionFromRow>[0][];
  return rows.map((r) => asInput(questionFromRow(r)));
}

// --- organisation templates --------------------------------------------------------------

export async function listTemplates(orgId: string | null, includeArchived: boolean, policy: FieldPolicy): Promise<TemplateView[]> {
  const own = orgId
    ? ((await db
        .prepare(`SELECT id, form_type, name, description, questions_json, status, updated_at FROM registration_form_templates WHERE org_id = ?${includeArchived ? "" : " AND status = 'active'"} ORDER BY name`)
        .all(orgId)) as { id: string; form_type: string; name: string; description: string; questions_json: string; status: string; updated_at: Date | string }[])
    : [];
  return [
    ...PLATFORM_TEMPLATES.map((t) => ({ ...t, questions: usableTemplateQuestions(t.questions, policy) })),
    ...own.map((r) => ({
      id: r.id,
      scope: "organisation" as const,
      formType: (isFormType(r.form_type) ? r.form_type : "event_registration") as FormTypeKey,
      name: r.name,
      description: r.description,
      status: (r.status === "archived" ? "archived" : "active") as "active" | "archived",
      questions: (() => {
        try {
          return JSON.parse(r.questions_json) as QuestionInput[];
        } catch {
          return [];
        }
      })(),
      updatedAt: new Date(r.updated_at).toISOString(),
    })),
  ];
}

export async function findTemplate(id: string, orgId: string | null, policy: FieldPolicy): Promise<TemplateView | null> {
  return (await listTemplates(orgId, true, policy)).find((t) => t.id === id) ?? null;
}

export function cleanTemplateMeta(raw: unknown): { name: string; description: string; formType: FormTypeKey } {
  const b = (raw ?? {}) as { name?: unknown; description?: unknown; formType?: unknown };
  const name = typeof b.name === "string" ? b.name.trim().replace(/\s+/g, " ") : "";
  if (!name || name.length > 120) throw new QuestionError("Give the template a name (up to 120 characters)");
  const description = typeof b.description === "string" ? b.description.trim().slice(0, 300) : "";
  const formType = isFormType(b.formType) ? b.formType : null;
  if (!formType) throw new QuestionError(`Choose what the form is for: ${FORM_TYPES.map((f) => f.label).join(", ")}`);
  return { name, description, formType };
}

export async function createTemplate(orgId: string, meta: { name: string; description: string; formType: FormTypeKey }, questions: CleanQuestion[], userId: string): Promise<string> {
  const id = crypto.randomUUID();
  await db
    .prepare(`INSERT INTO registration_form_templates (id, org_id, form_type, name, description, questions_json, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(id, orgId, meta.formType, meta.name, meta.description, JSON.stringify(questions.map(asInput)), userId);
  return id;
}

export async function setTemplateStatus(id: string, orgId: string, status: "active" | "archived"): Promise<boolean> {
  return (await db.prepare(`UPDATE registration_form_templates SET status = ? WHERE id = ? AND org_id = ?`).run(status, id, orgId)).changes === 1;
}
