import { db } from "./db/index.js";

// Configuration framework Phase F (docs/participation-expansion/16) — the
// field registry. Every registration field belongs to one of four classes:
//
//   A. platform_locked      — HelloCircle collects or calculates it (booking
//                             reference, payment status, prices, VAT/fees,
//                             capacity, ownership, contact name/email, attendee
//                             name/type/guardian). Never a custom field: a
//                             partner can't define one with the same meaning.
//   B. admin_configurable   — library fields only an admin can make available
//                             (third-party or personal data: emergency contact,
//                             date of birth, photo consent wording).
//   C. vendor_configurable  — library fields a partner adds as they are
//                             (experience level, T-shirt size, transport…).
//   D. vendor_custom        — the partner's own question (Phase 2 questions),
//                             limited to approved types and platform policy.
//
// Policy (admin, versioned, audited — field_policies): which B/C library fields
// are available, which custom types are allowed, and per data class the
// retention period and whether answers may be exported. Sensitive data
// (special category, D-A4) and financial/identity data are refused for every
// class; the special-category lock is separate and stays locked.

export type FieldClass = "platform_locked" | "admin_configurable" | "vendor_configurable" | "vendor_custom";
export const INPUT_TYPES = ["text", "long_text", "number", "email", "tel", "date", "select", "multi_select", "radio", "checkbox", "info"] as const;
export type InputType = (typeof INPUT_TYPES)[number];
export const DATA_CLASSES = ["general", "logistics", "dietary_preference", "contact", "personal"] as const;
export type DataClass = (typeof DATA_CLASSES)[number];
export const SPECIAL_CLASSES = ["health", "religion", "ethnicity", "other_special"] as const;

export const TYPE_LABELS: Record<InputType, string> = {
  text: "Short text",
  long_text: "Long text",
  number: "Number",
  email: "Email address",
  tel: "Phone number",
  date: "Date",
  select: "Pick one from a list",
  multi_select: "Pick several from a list",
  radio: "Pick one (buttons)",
  checkbox: "Tick box",
  info: "Information only (no answer)",
};

export const CLASS_LABELS: Record<DataClass, string> = {
  general: "General",
  logistics: "Arrival, transport or kit",
  dietary_preference: "Food preference (not allergies)",
  contact: "Contact details",
  personal: "Personal details",
};

/** A: what HelloCircle itself collects or works out. */
export const PLATFORM_LOCKED = [
  { key: "booking_reference", label: "Booking reference", scope: "booking", dataClass: "general" },
  { key: "payment_status", label: "Payment status", scope: "booking", dataClass: "general" },
  { key: "price_total", label: "Price, VAT and fees", scope: "booking", dataClass: "general" },
  { key: "capacity", label: "Places and capacity", scope: "booking", dataClass: "general" },
  { key: "organisation", label: "Organiser and ownership", scope: "booking", dataClass: "general" },
  { key: "contact_name", label: "Booking contact name", scope: "booking", dataClass: "contact" },
  { key: "contact_email", label: "Booking contact email", scope: "booking", dataClass: "contact" },
  { key: "contact_phone", label: "Booking contact phone", scope: "booking", dataClass: "contact" },
  { key: "attendee_name", label: "Name of each person", scope: "attendee", dataClass: "personal" },
  { key: "attendee_type", label: "Adult or child", scope: "attendee", dataClass: "personal" },
  { key: "guardian", label: "Who looks after each child", scope: "attendee", dataClass: "personal" },
] as const;

export interface LibraryField {
  key: string;
  fieldClass: "admin_configurable" | "vendor_configurable";
  label: string;
  purpose: string;
  help: string;
  scope: "booking" | "attendee";
  inputType: InputType;
  choices: string[];
  appliesTo: "all" | "adult" | "child";
  dataClass: DataClass;
  /** Library default; an admin policy can switch it on or off. */
  enabledByDefault: boolean;
}

/** B + C: ready-made fields a partner adds without writing them. */
export const LIBRARY: LibraryField[] = [
  { key: "experience_level", fieldClass: "vendor_configurable", label: "Experience level", purpose: "To put people in the right group", help: "", scope: "attendee", inputType: "radio", choices: ["Beginner", "Some experience", "Experienced"], appliesTo: "all", dataClass: "general", enabledByDefault: true },
  { key: "tshirt_size", fieldClass: "vendor_configurable", label: "T-shirt size", purpose: "Everyone gets an event T-shirt", help: "", scope: "attendee", inputType: "select", choices: ["Child", "XS", "S", "M", "L", "XL", "XXL"], appliesTo: "all", dataClass: "general", enabledByDefault: true },
  { key: "transport", fieldClass: "vendor_configurable", label: "How will you travel?", purpose: "To plan parking and lifts", help: "", scope: "booking", inputType: "radio", choices: ["Car", "Bus or train", "Walking or cycling", "Getting a lift"], appliesTo: "all", dataClass: "logistics", enabledByDefault: true },
  { key: "equipment", fieldClass: "vendor_configurable", label: "Do you need to borrow equipment?", purpose: "So we bring enough kit", help: "", scope: "attendee", inputType: "radio", choices: ["No, I'll bring my own", "Yes, please"], appliesTo: "all", dataClass: "logistics", enabledByDefault: true },
  { key: "food_preference", fieldClass: "vendor_configurable", label: "Food preference", purpose: "To plan the food", help: "This is a preference only. Speak to the organiser directly about allergies.", scope: "attendee", inputType: "select", choices: ["No preference", "Vegetarian", "Vegan", "Other"], appliesTo: "all", dataClass: "dietary_preference", enabledByDefault: true },
  { key: "badge_name", fieldClass: "vendor_configurable", label: "Name on badge", purpose: "Printed on your name badge", help: "", scope: "attendee", inputType: "text", choices: [], appliesTo: "all", dataClass: "general", enabledByDefault: true },
  { key: "emergency_contact", fieldClass: "admin_configurable", label: "Emergency contact (name and phone)", purpose: "So we can reach someone if there's an emergency on the day", help: "", scope: "booking", inputType: "text", choices: [], appliesTo: "all", dataClass: "contact", enabledByDefault: false },
  { key: "date_of_birth", fieldClass: "admin_configurable", label: "Date of birth", purpose: "To check age rules for this activity", help: "", scope: "attendee", inputType: "date", choices: [], appliesTo: "child", dataClass: "personal", enabledByDefault: false },
  { key: "photo_consent", fieldClass: "admin_configurable", label: "I'm happy for photos of me (or my child) to be used by the organiser", purpose: "Organisers ask before using photos", help: "", scope: "attendee", inputType: "checkbox", choices: [], appliesTo: "all", dataClass: "personal", enabledByDefault: false },
];
export const libraryField = (key: string) => LIBRARY.find((f) => f.key === key);

/** Labels that would duplicate something the platform already collects. */
const RESERVED = /^\s*(your\s+)?(e-?mail(\s+address)?|full\s+name|name|first\s+name|surname|last\s+name|phone(\s+number)?|mobile(\s+number)?|price|amount|payment|total|vat|booking\s+reference|reference|adult\s+or\s+child|guardian)\s*\??\s*$/i;
/** Financial and identity data: never collected through registration fields. */
const FORBIDDEN = /\b(card\s*number|credit\s*card|debit\s*card|cvv|cvc|iban|bic|swift|sort\s*code|bank\s*(account|details)|account\s*number|password|passcode|pin\s*(number|code)?|pps\s*n?(o|umber)?|ppsn|passport|driving\s*licen[cs]e|licence\s*number|social\s*security|tax\s*number|revenue\s*number)\b/i;

export function reservedLabel(label: string): string | null {
  return RESERVED.test(label) ? `HelloCircle already asks for this ("${label.trim()}") — it doesn't need a question` : null;
}
export function forbiddenWording(text: string): string | null {
  return FORBIDDEN.test(text) ? "Payment, bank, password and identity-document details can't be collected in registration questions" : null;
}

// --- admin policy -------------------------------------------------------------------

export interface FieldPolicy {
  version: number;
  /** Library field key → available to partners. */
  library: Record<string, boolean>;
  /** Custom input type → allowed for partners' own questions. */
  customTypes: Record<InputType, boolean>;
  /** Per data class: keep answers this many days after the event (null = until the retention review), exportable or not. */
  classes: Record<DataClass, { retentionDays: number | null; exportable: boolean }>;
}

export const DEFAULT_POLICY: FieldPolicy = {
  version: 0,
  library: Object.fromEntries(LIBRARY.map((f) => [f.key, f.enabledByDefault])),
  customTypes: Object.fromEntries(INPUT_TYPES.map((t) => [t, true])) as Record<InputType, boolean>,
  classes: {
    general: { retentionDays: null, exportable: true },
    logistics: { retentionDays: null, exportable: true },
    dietary_preference: { retentionDays: null, exportable: true },
    contact: { retentionDays: null, exportable: false },
    personal: { retentionDays: null, exportable: false },
  },
};

type Tx = Pick<typeof db, "prepare">;

export async function fieldPolicy(tx: Tx = db): Promise<FieldPolicy> {
  const row = (await tx.prepare(`SELECT version, policy_json FROM field_policies WHERE id = 1`).get()) as { version: number; policy_json: string } | undefined;
  if (!row) return structuredClone(DEFAULT_POLICY);
  let saved: Partial<FieldPolicy> = {};
  try {
    saved = (row.policy_json ? (JSON.parse(row.policy_json) as Partial<FieldPolicy> | null) : null) ?? {};
  } catch {
    saved = {};
  }
  // Unknown keys in a saved policy are ignored; new library fields/types fall back to defaults.
  return {
    version: Number(row.version),
    library: { ...DEFAULT_POLICY.library, ...Object.fromEntries(Object.entries(saved.library ?? {}).filter(([k]) => libraryField(k))) },
    customTypes: { ...DEFAULT_POLICY.customTypes, ...Object.fromEntries(Object.entries(saved.customTypes ?? {}).filter(([k]) => (INPUT_TYPES as readonly string[]).includes(k))) } as Record<InputType, boolean>,
    classes: Object.fromEntries(DATA_CLASSES.map((c) => [c, { ...DEFAULT_POLICY.classes[c], ...(saved.classes?.[c] ?? {}) }])) as FieldPolicy["classes"],
  };
}

export class FieldPolicyError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

/** Validates an admin policy change; returns the full next policy (version not yet bumped). */
export function cleanPolicy(raw: unknown, current: FieldPolicy): Omit<FieldPolicy, "version"> {
  const b = (raw ?? {}) as Partial<FieldPolicy>;
  const library = { ...current.library };
  for (const [k, v] of Object.entries(b.library ?? {})) {
    if (!libraryField(k)) throw new FieldPolicyError(`Unknown library field ${k}`);
    if (typeof v !== "boolean") throw new FieldPolicyError(`${libraryField(k)!.label}: say on or off`);
    library[k] = v;
  }
  const customTypes = { ...current.customTypes };
  for (const [k, v] of Object.entries(b.customTypes ?? {})) {
    if (!(INPUT_TYPES as readonly string[]).includes(k)) throw new FieldPolicyError(`Unknown answer type ${k}`);
    if (typeof v !== "boolean") throw new FieldPolicyError(`${TYPE_LABELS[k as InputType]}: say allowed or not`);
    customTypes[k as InputType] = v;
  }
  if (!customTypes.text) throw new FieldPolicyError("Short text must stay allowed");
  const classes = structuredClone(current.classes);
  for (const [k, v] of Object.entries(b.classes ?? {})) {
    if (!(DATA_CLASSES as readonly string[]).includes(k)) throw new FieldPolicyError(`Unknown data class ${k}`);
    const c = (v ?? {}) as { retentionDays?: unknown; exportable?: unknown };
    if (c.retentionDays !== undefined && c.retentionDays !== null && (typeof c.retentionDays !== "number" || !Number.isInteger(c.retentionDays) || c.retentionDays < 1 || c.retentionDays > 3650)) {
      throw new FieldPolicyError(`${CLASS_LABELS[k as DataClass]}: keep answers for 1 to 3650 days, or until the retention review`);
    }
    if (c.exportable !== undefined && typeof c.exportable !== "boolean") throw new FieldPolicyError(`${CLASS_LABELS[k as DataClass]}: say exportable or not`);
    classes[k as DataClass] = { retentionDays: c.retentionDays === undefined ? classes[k as DataClass].retentionDays : (c.retentionDays as number | null), exportable: c.exportable === undefined ? classes[k as DataClass].exportable : (c.exportable as boolean) };
  }
  return { library, customTypes, classes };
}

/** Answers past their class's retention period (reported, never deleted automatically). */
export async function answersPastRetention(policy: FieldPolicy): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const c of DATA_CLASSES) {
    const days = policy.classes[c].retentionDays;
    if (!days) continue;
    const row = (await db
      .prepare(
        `SELECT COUNT(*) AS n FROM registration_answers a
         JOIN registration_questions q ON q.id = a.question_id
         JOIN experience_bookings eb ON a.source_type = 'experience' AND eb.ref = a.source_ref
         JOIN experience_sessions es ON es.id = eb.session_id
         WHERE q.category = ? AND es.date < DATE_SUB(CURDATE(), INTERVAL ? DAY)`
      )
      .get(c, days)) as { n: number };
    out[c] = Number(row.n);
  }
  return out;
}
