import crypto from "node:crypto";
import { db } from "../db/index.js";
import type { CleanAttendee, PersonType } from "./attendees.js";
import { DATA_CLASSES, DEFAULT_POLICY, forbiddenWording, INPUT_TYPES, libraryField, reservedLabel, SPECIAL_CLASSES, TYPE_LABELS, type FieldPolicy, type InputType } from "../fieldRegistry.js";

// Participation Phase 2 (docs/participation-expansion/12 §3) — a listing's
// registration questions and the answers to them.
//
// - The set is saved whole under experiences.questions_version (409 when
//   stale), like registration options. Rows are never deleted, only switched
//   off; a question keeps its `qkey` across versions.
// - Answers freeze the question's label, type, choices and door visibility at
//   the time of answering, so a later edit of the question never changes what
//   someone agreed to or what the door screen shows.
// - Data minimisation: at most MAX_QUESTIONS, each with a "why we ask" line
//   shown to the person answering. Special-category questions (health,
//   religion, ethnicity, …) are refused while
//   participation.special_category_questions is locked — by the category the
//   partner picks and by the wording of the question.

type Tx = Pick<typeof db, "prepare">;

// Configuration Phase F — answer types, data classes and library fields come
// from the field registry (fieldRegistry.ts); this module keeps the question
// sets, answers and their validation.
export { INPUT_TYPES } from "../fieldRegistry.js";
export type { InputType } from "../fieldRegistry.js";
export const QUESTION_SCOPES = ["booking", "attendee"] as const;
export const APPLIES_TO = ["all", "adult", "child"] as const;
export const GENERAL_CATEGORIES = DATA_CLASSES;
export const SPECIAL_CATEGORIES = SPECIAL_CLASSES;
export const EDITABILITY = ["until_start", "locked"] as const;
export type QuestionScope = (typeof QUESTION_SCOPES)[number];
export type AppliesTo = (typeof APPLIES_TO)[number];
export type QuestionCategory = (typeof GENERAL_CATEGORIES)[number] | (typeof SPECIAL_CATEGORIES)[number];
export type Editability = (typeof EDITABILITY)[number];

export const MAX_QUESTIONS = 12;
export const MAX_CHOICES = 20;
export const MAX_ANSWER = 500;
export const MAX_LONG_ANSWER = 1000;
const CHOICE_TYPES: readonly InputType[] = ["select", "multi_select", "radio"];
const TEXT_TYPES: readonly InputType[] = ["text", "long_text"];

export interface Question {
  id: string;
  key: string;
  scope: QuestionScope;
  inputType: InputType;
  label: string;
  help: string;
  purpose: string;
  required: boolean;
  choices: string[];
  min: number | null;
  max: number | null;
  appliesTo: AppliesTo;
  doorVisible: boolean;
  category: QuestionCategory;
  sortOrder: number;
  version: number;
  /** Phase F — registry properties. */
  fieldKey: string | null;
  placeholder: string;
  defaultValue: string | null;
  minLength: number | null;
  maxLength: number | null;
  editability: Editability;
  exportable: boolean;
  /** Phase G — section heading (null = none) and simple conditional visibility. */
  section: string | null;
  showIf: ShowIf | null;
}

/** Shown only when an earlier question's answer is one of `values`. */
export interface ShowIf {
  key: string;
  values: string[];
}

/** What a person answering sees (no internal category, export flag or ids). */
export type PublicQuestion = Pick<Question, "key" | "scope" | "inputType" | "label" | "help" | "purpose" | "required" | "choices" | "min" | "max" | "appliesTo" | "doorVisible" | "placeholder" | "defaultValue" | "minLength" | "maxLength" | "editability" | "section" | "showIf">;
export const toPublicQuestion = ({ key, scope, inputType, label, help, purpose, required, choices, min, max, appliesTo, doorVisible, placeholder, defaultValue, minLength, maxLength, editability, section, showIf }: Question): PublicQuestion => ({
  key, scope, inputType, label, help, purpose, required, choices, min, max, appliesTo, doorVisible, placeholder, defaultValue, minLength, maxLength, editability, section, showIf,
});

export class QuestionError extends Error {
  constructor(message: string, readonly status = 400, readonly code?: string) {
    super(message);
  }
}

// Wording that points at special-category data (GDPR Art. 9) or health data.
// Deliberately broad: a refusal names the switch, it never silently drops.
const SPECIAL_WORDING: { re: RegExp; category: (typeof SPECIAL_CATEGORIES)[number] }[] = [
  { re: /\b(allerg\w*|medical|medic\w*|medication|health|disab\w*|diagnos\w*|illness|pregnan\w*|blood|asthma|epilep\w*|diabet\w*|wheelchair|mental|insulin|epi-?pen|inhaler|seizure\w*|anaphyla\w*|symptom\w*|prescri\w*|therap\w*)\b/i, category: "health" },
  { re: /\b(religio\w*|faith|caste|gotra|denomination)\b/i, category: "religion" },
  { re: /\b(ethnic\w*|race|racial)\b/i, category: "ethnicity" },
  { re: /\b(sexual\w*|orientation|trade union|political|biometric|genetic)\b/i, category: "other_special" },
];

export function specialCategoryOf(text: string): (typeof SPECIAL_CATEGORIES)[number] | null {
  return SPECIAL_WORDING.find((w) => w.re.test(text))?.category ?? null;
}

const SPECIAL_REFUSAL = "Questions about health, religion, ethnicity or other sensitive (special-category) information are switched off until a privacy policy for them is approved.";

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().replace(/\s+/g, " ").slice(0, max + 1) : "");

export interface QuestionInput {
  key?: unknown;
  fieldKey?: unknown;
  scope?: unknown;
  inputType?: unknown;
  label?: unknown;
  help?: unknown;
  purpose?: unknown;
  required?: unknown;
  choices?: unknown;
  min?: unknown;
  max?: unknown;
  appliesTo?: unknown;
  doorVisible?: unknown;
  category?: unknown;
  placeholder?: unknown;
  defaultValue?: unknown;
  minLength?: unknown;
  maxLength?: unknown;
  editability?: unknown;
  exportable?: unknown;
  section?: unknown;
  showIf?: unknown;
}

/** Every question leaving validation has a key (kept, or newly made), so conditions can point at it. */
export type CleanQuestion = Omit<Question, "id" | "version" | "sortOrder">;
const CONDITION_TYPES: readonly InputType[] = ["select", "radio", "multi_select", "checkbox"];

/**
 * Validates a whole question set against the field registry and the admin
 * field policy; throws QuestionError (the first problem, numbered).
 * - A library field (fieldKey) takes its wording, type, choices and class from
 *   the registry; the partner sets only required / door visibility / export.
 * - A custom question uses an allowed type, can't duplicate a platform-locked
 *   field, and can never ask for financial/identity or (while locked)
 *   special-category data — every text a person reads is checked.
 */
export function cleanQuestionSet(raw: unknown, specialAllowed: boolean, policy: FieldPolicy = DEFAULT_POLICY): CleanQuestion[] {
  if (!Array.isArray(raw)) throw new QuestionError("Send the list of questions");
  if (raw.length > MAX_QUESTIONS) throw new QuestionError(`Ask at most ${MAX_QUESTIONS} questions — only ask what you need`);
  const keys = new Set<string>();
  const libraryUsed = new Set<string>();
  const out = raw.map((r, i) => {
    let q = (r ?? {}) as QuestionInput;
    const n = `Question ${i + 1}`;
    let fieldKey: string | null = null;
    if (q.fieldKey !== undefined && q.fieldKey !== null && q.fieldKey !== "") {
      const lib = typeof q.fieldKey === "string" ? libraryField(q.fieldKey) : undefined;
      if (!lib) throw new QuestionError(`${n}: unknown ready-made field`);
      if (!policy.library[lib.key]) throw new QuestionError(`${n}: "${lib.label}" isn't available — HelloCircle hasn't switched it on`, 400, "field_not_available");
      if (libraryUsed.has(lib.key)) throw new QuestionError(`${n}: "${lib.label}" is already in this form`);
      libraryUsed.add(lib.key);
      fieldKey = lib.key;
      // Registry wording wins; partner settings that may vary are kept.
      q = { ...q, label: lib.label, purpose: lib.purpose, help: lib.help, scope: lib.scope, inputType: lib.inputType, choices: lib.choices, appliesTo: lib.appliesTo, category: lib.dataClass, min: undefined, max: undefined, minLength: undefined, maxLength: undefined };
    }
    const label = str(q.label, 200);
    if (!label) throw new QuestionError(`${n}: write the question`);
    if (label.length > 200) throw new QuestionError(`${n}: keep the question under 200 characters`);
    const help = str(q.help, 300);
    if (help.length > 300) throw new QuestionError(`${n}: keep the hint under 300 characters`);
    const purpose = str(q.purpose, 300);
    if (!purpose) throw new QuestionError(`${n}: say why you're asking — people see this before they answer`);
    if (purpose.length > 300) throw new QuestionError(`${n}: keep "why we ask" under 300 characters`);
    const scope = (QUESTION_SCOPES as readonly string[]).includes(q.scope as string) ? (q.scope as QuestionScope) : null;
    if (!scope) throw new QuestionError(`${n}: choose whether it's asked once per booking or for each person`);
    const inputType = (INPUT_TYPES as readonly string[]).includes(q.inputType as string) ? (q.inputType as InputType) : null;
    if (!inputType) throw new QuestionError(`${n}: choose an answer type`);
    if (!fieldKey && !policy.customTypes[inputType]) throw new QuestionError(`${n}: ${TYPE_LABELS[inputType]} answers aren't allowed for your own questions`, 400, "type_not_allowed");
    const appliesTo = scope === "attendee" && (APPLIES_TO as readonly string[]).includes(q.appliesTo as string) ? (q.appliesTo as AppliesTo) : "all";
    let category = ([...GENERAL_CATEGORIES, ...SPECIAL_CATEGORIES] as readonly string[]).includes(q.category as string) ? (q.category as QuestionCategory) : "general";
    // Email and phone answers are contact details whatever the partner picked.
    if ((inputType === "email" || inputType === "tel") && category !== "personal") category = "contact";
    const placeholder = str(q.placeholder, 120);
    if (placeholder.length > 120) throw new QuestionError(`${n}: keep the placeholder under 120 characters`);
    const choiceText = Array.isArray(q.choices) ? q.choices.filter((c): c is string => typeof c === "string").join(" ") : "";
    const allText = `${label} ${help} ${purpose} ${placeholder} ${choiceText}`;
    if (!fieldKey) {
      const reserved = reservedLabel(label);
      if (reserved) throw new QuestionError(`${n}: ${reserved}`, 400, "reserved_field");
    }
    // Ready-made fields are HelloCircle's own vetted wording (e.g. the food-preference
    // hint tells people to raise allergies directly); the wording checks are for
    // partners' own text. A ready-made field's class is never a special category.
    const forbidden = fieldKey ? null : forbiddenWording(allText);
    if (forbidden) throw new QuestionError(`${n}: ${forbidden}`, 400, "forbidden_field");
    if (!specialAllowed && !fieldKey) {
      if ((SPECIAL_CATEGORIES as readonly string[]).includes(category)) throw new QuestionError(`${n}: ${SPECIAL_REFUSAL}`, 400, "special_category");
      // D-A4 — every text a person reads (wording, hint, why we ask, placeholder, choices) is checked.
      if (specialCategoryOf(allText)) throw new QuestionError(`${n}: "${label}" looks like a question about sensitive information. ${SPECIAL_REFUSAL}`, 400, "special_category");
    }
    let choices: string[] = [];
    if (CHOICE_TYPES.includes(inputType)) {
      if (!Array.isArray(q.choices)) throw new QuestionError(`${n}: add the choices people pick from`);
      choices = q.choices.map((c) => str(c, 80)).filter(Boolean);
      if (choices.length < 2) throw new QuestionError(`${n}: add at least two choices`);
      if (choices.length > MAX_CHOICES) throw new QuestionError(`${n}: at most ${MAX_CHOICES} choices`);
      if (choices.some((c) => c.length > 80)) throw new QuestionError(`${n}: keep each choice under 80 characters`);
      if (new Set(choices.map((c) => c.toLowerCase())).size !== choices.length) throw new QuestionError(`${n}: each choice must be different`);
    }
    const int = (v: unknown) => (v === null || v === undefined || v === "" ? null : typeof v === "number" && Number.isInteger(v) ? v : NaN);
    let min: number | null = null;
    let max: number | null = null;
    if (inputType === "number") {
      min = int(q.min);
      max = int(q.max);
      if (Number.isNaN(min) || Number.isNaN(max)) throw new QuestionError(`${n}: the lowest and highest answers must be whole numbers`);
      if (min !== null && max !== null && min > max) throw new QuestionError(`${n}: the lowest answer is above the highest`);
    }
    let minLength: number | null = null;
    let maxLength: number | null = null;
    if (TEXT_TYPES.includes(inputType)) {
      const cap = inputType === "long_text" ? MAX_LONG_ANSWER : MAX_ANSWER;
      minLength = int(q.minLength);
      maxLength = int(q.maxLength);
      if (Number.isNaN(minLength) || Number.isNaN(maxLength)) throw new QuestionError(`${n}: lengths must be whole numbers`);
      if (minLength !== null && (minLength < 1 || minLength > cap)) throw new QuestionError(`${n}: shortest answer must be between 1 and ${cap}`);
      if (maxLength !== null && (maxLength < 1 || maxLength > cap)) throw new QuestionError(`${n}: longest answer must be between 1 and ${cap}`);
      if (minLength !== null && maxLength !== null && minLength > maxLength) throw new QuestionError(`${n}: the shortest answer is longer than the longest`);
    }
    let defaultValue: string | null = null;
    if (q.defaultValue !== undefined && q.defaultValue !== null && q.defaultValue !== "") {
      if (inputType === "info" || inputType === "checkbox" || inputType === "multi_select" || inputType === "email" || inputType === "tel") throw new QuestionError(`${n}: this answer type can't have a pre-filled answer`);
      defaultValue = str(q.defaultValue, 200);
      if ((inputType === "select" || inputType === "radio") && !choices.includes(defaultValue)) throw new QuestionError(`${n}: the pre-filled answer must be one of the choices`);
      if (inputType === "number" && !Number.isInteger(Number(defaultValue))) throw new QuestionError(`${n}: the pre-filled answer must be a whole number`);
    }
    const editability: Editability = q.editability === "locked" ? "locked" : "until_start";
    let key = `q_${crypto.randomBytes(5).toString("hex")}`;
    if (typeof q.key === "string" && /^q_[a-z0-9]{6,20}$/.test(q.key)) {
      if (keys.has(q.key)) throw new QuestionError(`${n}: duplicate question`);
      key = q.key;
    }
    keys.add(key);
    const section = str(q.section, 120) || null;
    if (section && section.length > 120) throw new QuestionError(`${n}: keep the section name under 120 characters`);
    const info = inputType === "info";
    return {
      key,
      fieldKey,
      scope,
      inputType,
      label,
      help,
      purpose,
      required: !info && q.required === true,
      choices,
      min,
      max,
      appliesTo,
      doorVisible: !info && q.doorVisible === true,
      category,
      placeholder,
      defaultValue,
      minLength,
      maxLength,
      editability,
      exportable: !info && q.exportable === true,
      section,
      showIf: null as ShowIf | null,
      _showIf: q.showIf,
    };
  });
  // Phase G — conditions point at an EARLIER question with fixed answers; a
  // once-per-booking question can't depend on one person's answer.
  out.forEach((cq, i) => {
    const raw = (cq as { _showIf?: unknown })._showIf;
    delete (cq as { _showIf?: unknown })._showIf;
    if (raw === undefined || raw === null) return;
    const n = `Question ${i + 1}`;
    const c = raw as { key?: unknown; values?: unknown };
    const target = out.slice(0, i).find((x) => x.key === c.key);
    if (!target) throw new QuestionError(`${n}: it can only depend on a question above it`);
    if (!CONDITION_TYPES.includes(target.inputType)) throw new QuestionError(`${n}: it can only depend on a pick-from-a-list or tick-box question`);
    if (cq.scope === "booking" && target.scope === "attendee") throw new QuestionError(`${n}: a once-per-booking question can't depend on one person's answer`);
    const allowed = target.inputType === "checkbox" ? ["yes"] : target.choices;
    if (!Array.isArray(c.values) || c.values.length === 0 || !c.values.every((v) => typeof v === "string" && allowed.includes(v))) throw new QuestionError(`${n}: choose which answers show it`);
    cq.showIf = { key: target.key, values: [...new Set(c.values as string[])] };
  });
  return out;
}

export interface QuestionRow {
  id: string;
  qkey: string;
  version: number;
  scope: string;
  input_type: string;
  label: string;
  help: string;
  purpose: string;
  required: number;
  choices_json: string | null;
  min_value: number | null;
  max_value: number | null;
  applies_to: string;
  door_visible: number;
  category: string;
  sort_order: number;
  field_key: string | null;
  placeholder: string | null;
  default_value: string | null;
  min_length: number | null;
  max_length: number | null;
  editability: string | null;
  exportable: number | null;
  section: string | null;
  show_if_json: string | null;
}

/** Maps a stored row (any version, active or not). */
export function questionFromRow(r: QuestionRow): Question {
  let choices: string[] = [];
  try {
    choices = r.choices_json ? (JSON.parse(r.choices_json) as string[]) : [];
  } catch {
    choices = [];
  }
  return {
    id: r.id,
    key: r.qkey,
    scope: r.scope as QuestionScope,
    inputType: r.input_type as InputType,
    label: r.label,
    help: r.help,
    purpose: r.purpose,
    required: Number(r.required) === 1,
    choices,
    min: r.min_value === null ? null : Number(r.min_value),
    max: r.max_value === null ? null : Number(r.max_value),
    appliesTo: r.applies_to as AppliesTo,
    doorVisible: Number(r.door_visible) === 1,
    category: r.category as QuestionCategory,
    sortOrder: Number(r.sort_order),
    version: Number(r.version),
    fieldKey: r.field_key ?? null,
    placeholder: r.placeholder ?? "",
    defaultValue: r.default_value ?? null,
    minLength: r.min_length === null || r.min_length === undefined ? null : Number(r.min_length),
    maxLength: r.max_length === null || r.max_length === undefined ? null : Number(r.max_length),
    editability: r.editability === "locked" ? "locked" : "until_start",
    exportable: Number(r.exportable ?? 0) === 1,
    section: r.section ?? null,
    showIf: parseShowIf(r.show_if_json),
  };
}

function parseShowIf(v: string | null | undefined): ShowIf | null {
  if (!v) return null;
  try {
    const o = JSON.parse(v) as ShowIf;
    return o && typeof o.key === "string" && Array.isArray(o.values) ? o : null;
  } catch {
    return null;
  }
}

export async function activeQuestions(listingType: "experience", listingId: string, tx: Tx = db): Promise<Question[]> {
  const rows = (await tx
    .prepare(`SELECT * FROM registration_questions WHERE listing_type = ? AND listing_id = ? AND active = 1 ORDER BY sort_order, created_at`)
    .all(listingType, listingId)) as QuestionRow[];
  return rows.map(questionFromRow);
}

export async function questionsVersion(listingId: string, tx: Tx = db): Promise<number> {
  const row = (await tx.prepare(`SELECT questions_version AS v FROM experiences WHERE id = ?`).get(listingId)) as { v: number } | undefined;
  return Number(row?.v ?? 0);
}

/** Replaces the active set. Throws QuestionError(409) when `expectedVersion` is stale. */
export async function replaceQuestions(listingId: string, set: CleanQuestion[], expectedVersion: number, userId: string): Promise<{ version: number; questions: Question[] }> {
  return db.transaction(async (tx) => {
    const row = (await tx.prepare(`SELECT questions_version AS v FROM experiences WHERE id = ? FOR UPDATE`).get(listingId)) as { v: number } | undefined;
    if (!row) throw new QuestionError("Listing not found", 404);
    if (Number(row.v) !== expectedVersion) throw new QuestionError("Someone changed these questions since you opened them — reload to see the latest", 409, "stale");
    const version = Number(row.v) + 1;
    await tx.prepare(`UPDATE registration_questions SET active = 0 WHERE listing_type = 'experience' AND listing_id = ? AND active = 1`).run(listingId);
    for (let i = 0; i < set.length; i++) {
      const q = set[i];
      await tx
        .prepare(
          `INSERT INTO registration_questions (id, listing_type, listing_id, qkey, version, scope, input_type, label, help, purpose, required, choices_json, min_value, max_value, applies_to, door_visible, category, sort_order, active, created_by_user_id,
           field_key, placeholder, default_value, min_length, max_length, editability, exportable, section, show_if_json)
           VALUES (?, 'experience', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          crypto.randomUUID(),
          listingId,
          q.key,
          version,
          q.scope,
          q.inputType,
          q.label,
          q.help,
          q.purpose,
          q.required ? 1 : 0,
          ["select", "multi_select", "radio"].includes(q.inputType) ? JSON.stringify(q.choices) : null,
          q.min,
          q.max,
          q.appliesTo,
          q.doorVisible ? 1 : 0,
          q.category,
          i,
          userId,
          q.fieldKey,
          q.placeholder,
          q.defaultValue,
          q.minLength,
          q.maxLength,
          q.editability,
          q.exportable ? 1 : 0,
          q.section,
          q.showIf ? JSON.stringify(q.showIf) : null
        );
    }
    await tx.prepare(`UPDATE experiences SET questions_version = ? WHERE id = ?`).run(version, listingId);
    return { version, questions: await activeQuestions("experience", listingId, tx) };
  });
}

// --- answers -------------------------------------------------------------------

export interface CleanAnswer {
  attendeeNo: number; // 0 = the booking itself
  question: Question;
  value: string;
}

const appliesToPerson = (q: Question, t: PersonType) => q.appliesTo === "all" || q.appliesTo === t;

function normalise(q: Question, v: unknown, who: string): string | null {
  const name = `${who}"${q.label}"`;
  if (v === undefined || v === null || v === "") return null;
  switch (q.inputType) {
    case "text": {
      if (typeof v !== "string") throw new QuestionError(`${name}: write an answer`);
      const t = v.trim();
      const max = q.maxLength ?? MAX_ANSWER;
      if (t.length > max) throw new QuestionError(`${name}: keep it under ${max} characters`);
      if (t && q.minLength !== null && t.length < q.minLength) throw new QuestionError(`${name}: write at least ${q.minLength} characters`);
      return t || null;
    }
    case "number": {
      const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
      if (!Number.isInteger(n)) throw new QuestionError(`${name}: enter a whole number`);
      if (q.min !== null && n < q.min) throw new QuestionError(`${name}: the lowest answer is ${q.min}`);
      if (q.max !== null && n > q.max) throw new QuestionError(`${name}: the highest answer is ${q.max}`);
      return String(n);
    }
    case "date": {
      if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new QuestionError(`${name}: enter a date`);
      const d = new Date(`${v}T12:00:00Z`);
      if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) throw new QuestionError(`${name}: enter a real date`);
      return v;
    }
    case "select": {
      if (typeof v !== "string" || !q.choices.includes(v)) throw new QuestionError(`${name}: choose one of the options`);
      return v;
    }
    case "checkbox":
      if (v === true || v === "yes") return "yes";
      if (v === false || v === "no") return null;
      throw new QuestionError(`${name}: tick or leave it`);
    case "long_text": {
      if (typeof v !== "string") throw new QuestionError(`${name}: write an answer`);
      const t = v.trim();
      const max = q.maxLength ?? MAX_LONG_ANSWER;
      if (t.length > max) throw new QuestionError(`${name}: keep it under ${max} characters`);
      if (t && q.minLength !== null && t.length < q.minLength) throw new QuestionError(`${name}: write at least ${q.minLength} characters`);
      return t || null;
    }
    case "email": {
      if (typeof v !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim()) || v.length > 200) throw new QuestionError(`${name}: enter an email address like name@example.ie`);
      return v.trim();
    }
    case "tel": {
      if (typeof v !== "string" || !/^\+?[0-9 ()-]{6,20}$/.test(v.trim())) throw new QuestionError(`${name}: enter a phone number`);
      return v.trim();
    }
    case "radio": {
      if (typeof v !== "string" || !q.choices.includes(v)) throw new QuestionError(`${name}: choose one of the options`);
      return v;
    }
    case "multi_select": {
      if (!Array.isArray(v) || !v.every((x) => typeof x === "string" && q.choices.includes(x))) throw new QuestionError(`${name}: choose from the options`);
      const picked = q.choices.filter((c) => (v as string[]).includes(c));
      return picked.length ? JSON.stringify(picked) : null;
    }
    case "info":
      return null;
  }
}

/**
 * Validates answers against the current questions. `raw` is
 * { booking: { [key]: value }, attendees: [{ [key]: value }, …] } (attendees
 * in the same order as the attendee list). Unknown keys are ignored and
 * never stored. `requireAll` = false lets a later edit leave optional gaps
 * (required questions still have to be answered).
 */
export function cleanAnswers(questions: Question[], raw: unknown, people: Pick<CleanAttendee, "attendeeNo" | "personType" | "name">[]): CleanAnswer[] {
  const body = (raw ?? {}) as { booking?: Record<string, unknown>; attendees?: Record<string, unknown>[] };
  const bookingIn = body.booking && typeof body.booking === "object" ? body.booking : {};
  const peopleIn = Array.isArray(body.attendees) ? body.attendees : [];
  const out: CleanAnswer[] = [];
  // Phase G — a question whose condition isn't met is hidden: never required,
  // and anything sent for it is dropped. Conditions only point at earlier
  // questions, so one pass in order sees every value they depend on.
  const bookingVals = new Map<string, string>();
  const personVals = people.map(() => new Map<string, string>());
  const met = (q: Question, own: Map<string, string> | null) => {
    if (!q.showIf) return true;
    const v = bookingVals.get(q.showIf.key) ?? own?.get(q.showIf.key);
    if (v === undefined) return false;
    const picked = v.startsWith("[") ? ((): string[] => { try { return JSON.parse(v) as string[]; } catch { return [v]; } })() : [v];
    return picked.some((x) => q.showIf!.values.includes(x));
  };
  for (const q of questions) {
    if (q.inputType === "info") continue;
    if (q.scope === "booking") {
      if (!met(q, null)) continue;
      const value = normalise(q, bookingIn[q.key], "");
      if (value === null && q.required) throw new QuestionError(`Answer "${q.label}"`, 400, "answer_required");
      if (value !== null) {
        out.push({ attendeeNo: 0, question: q, value });
        bookingVals.set(q.key, value);
      }
      continue;
    }
    people.forEach((p, i) => {
      if (!appliesToPerson(q, p.personType) || !met(q, personVals[i])) return;
      const given = (peopleIn[i] ?? {}) as Record<string, unknown>;
      const value = normalise(q, given[q.key], `${p.name}: `);
      if (value === null && q.required) throw new QuestionError(`${p.name}: answer "${q.label}"`, 400, "answer_required");
      if (value !== null) {
        out.push({ attendeeNo: p.attendeeNo, question: q, value });
        personVals[i].set(q.key, value);
      }
    });
  }
  return out;
}

/** Writes the answers for an order; with `replace` every older answer goes first. */
export async function writeAnswers(tx: Tx, sourceType: "experience", ref: string, version: number, answers: CleanAnswer[], byKind: "booker" | "resident", replace: boolean): Promise<void> {
  if (replace) await tx.prepare(`DELETE FROM registration_answers WHERE source_type = ? AND source_ref = ?`).run(sourceType, ref);
  for (const a of answers) {
    await tx
      .prepare(
        `INSERT INTO registration_answers (source_type, source_ref, attendee_no, question_id, qkey, questions_version, label_snapshot, input_type_snapshot, choices_snapshot, door_visible_snapshot, value_text, answered_by_kind)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE question_id = VALUES(question_id), questions_version = VALUES(questions_version), label_snapshot = VALUES(label_snapshot),
           input_type_snapshot = VALUES(input_type_snapshot), choices_snapshot = VALUES(choices_snapshot), door_visible_snapshot = VALUES(door_visible_snapshot),
           value_text = VALUES(value_text), answered_by_kind = VALUES(answered_by_kind)`
      )
      .run(
        sourceType,
        ref,
        a.attendeeNo,
        a.question.id,
        a.question.key,
        version,
        a.question.label,
        a.question.inputType,
        ["select", "multi_select", "radio"].includes(a.question.inputType) ? JSON.stringify(a.question.choices) : null,
        a.question.doorVisible ? 1 : 0,
        a.value,
        byKind
      );
  }
}

/** How an answer reads to a person (multi-select as a list, a ticked box as "Yes"). */
export function displayValue(inputType: string, value: string): string {
  if (inputType === "checkbox") return value === "yes" ? "Yes" : value;
  if (inputType === "multi_select") {
    try {
      const v = JSON.parse(value) as unknown;
      if (Array.isArray(v)) return v.join(", ");
    } catch {
      /* stored as plain text */
    }
  }
  return value;
}

export interface StoredAnswer {
  attendeeNo: number;
  key: string;
  label: string;
  inputType: InputType;
  value: string;
  /** Phase F — the answer as it reads to a person. */
  display: string;
  version: number;
  doorVisible: boolean;
  updatedAt: string;
}

/** Answers for many orders. `doorOnly` keeps only answers people were told the door sees. */
export async function readAnswersFor(sourceType: "experience", refs: string[], opts: { doorOnly?: boolean } = {}): Promise<Map<string, StoredAnswer[]>> {
  const out = new Map<string, StoredAnswer[]>();
  if (!refs.length) return out;
  const rows = (await db
    .prepare(
      `SELECT source_ref, attendee_no, qkey, label_snapshot, input_type_snapshot, value_text, questions_version, door_visible_snapshot, updated_at
       FROM registration_answers WHERE source_type = ? AND source_ref IN (${refs.map(() => "?").join(", ")})${opts.doorOnly ? " AND door_visible_snapshot = 1" : ""}
       ORDER BY source_ref, attendee_no, id`
    )
    .all(sourceType, ...refs)) as Record<string, any>[];
  for (const r of rows) {
    const list = out.get(r.source_ref) ?? [];
    list.push({
      attendeeNo: Number(r.attendee_no),
      key: r.qkey,
      label: r.label_snapshot,
      inputType: r.input_type_snapshot,
      value: r.value_text,
      display: displayValue(r.input_type_snapshot, r.value_text),
      version: Number(r.questions_version),
      doorVisible: Number(r.door_visible_snapshot) === 1,
      updatedAt: new Date(r.updated_at).toISOString(),
    });
    out.set(r.source_ref, list);
  }
  return out;
}
