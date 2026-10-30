import crypto from "node:crypto";
import http, { type Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, setSetting } from "./db/index.js";
import { adminRouter } from "./routes/admin.js";
import { vendorRouter } from "./routes/vendor.js";
import { experiencesRouter } from "./routes/experiences.js";
import { DEFAULT_POLICY, cleanPolicy, FieldPolicyError, forbiddenWording, LIBRARY, reservedLabel } from "./fieldRegistry.js";
import { cleanAnswers, cleanQuestionSet, QuestionError, type Question } from "./participation/questions.js";

// Configuration framework Phase F (docs/participation-expansion/16) — the field
// registry: classes, library fields, approved types, reserved / forbidden /
// special-category restrictions, admin policy (versioned, audited), export
// rules and editability. Real routers, isolated MySQL, cash event.

const run = crypto.randomUUID().slice(0, 8);
const id = (k: string) => `t-${k}-fr-${run}`;
const orgId = id("org");
const ownerId = id("owner");
const financeId = id("finance");
const expId = id("exp");
const sessId = id("sess");
const clientId = id("client");
const refs: string[] = [];
let server: Server;
let base: string;
let policyVersionAtStart = 0;

function userFor(who: string) {
  const v = { role: "vendor", status: "approved", orgId, orgStatus: "active", name: who, businessName: who, email: `${who}@example.test` };
  if (who === "owner") return { ...v, id: ownerId, invitedStaff: false, platformRole: null };
  if (who === "finance") return { ...v, id: financeId, invitedStaff: true, platformRole: "finance" };
  if (who === "super") return { id: "t-super-fr", role: "admin", status: "approved", adminRole: "super", name: "s", email: "s@example.test" };
  if (who === "support") return { id: "t-support-fr", role: "admin", status: "approved", adminRole: "support", name: "u", email: "u@example.test" };
  return undefined;
}
async function call(method: string, path: string, body?: unknown, who?: string) {
  const res = await fetch(`${base}${path}`, { method, headers: { "Content-Type": "application/json", "X-Client-Id": clientId, ...(who ? { "X-Test-User": who } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json, text };
}
const q = (extra: Record<string, unknown>) => ({ scope: "booking", inputType: "text", label: "Anything else?", purpose: "To plan the day", ...extra });
const refusal = (raw: unknown[], special = false, policy = DEFAULT_POLICY) => {
  try { cleanQuestionSet(raw, special, policy); return null; } catch (e) { return e instanceof QuestionError ? e.code ?? e.message : String(e); }
};
const future = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

beforeAll(async () => {
  for (const k of ["participation.attendees", "participation.events"]) await setSetting(k, "true");
  const row = (await db.prepare(`SELECT version FROM field_policies WHERE id = 1`).get()) as { version: number } | undefined;
  policyVersionAtStart = Number(row?.version ?? 0);
  await db.prepare(`INSERT INTO organisations (id, name, kind) VALUES (?, 'FR', 'vendor')`).run(orgId);
  await db.prepare(`INSERT INTO users (id, email, password_hash, role, status, name, org_id, invited_staff, platform_role) VALUES (?, ?, 'x', 'vendor', 'approved', 'FR', ?, 0, NULL), (?, ?, 'x', 'vendor', 'approved', 'FR fin', ?, 1, 'finance')`).run(ownerId, `${ownerId}@example.test`, orgId, financeId, `${financeId}@example.test`, orgId);
  await db.prepare(`INSERT INTO experiences (id, vendor_id, kind, title, blurb, description, fitness_requirements, itinerary, equipment_provided, equipment_required, transport_info, safety_info, weather_policy, eligibility, cancellation_terms, status, capacity, price_cents, payment_method)
    VALUES (?, ?, 'event', 'FR event', 'b', 'd', '', '', '', '', '', '', '', '', '', 'approved', 50, 0, 'cash')`).run(expId, ownerId);
  await db.prepare(`INSERT INTO experience_sessions (id, experience_id, date, time) VALUES (?, ?, ?, '10:00')`).run(sessId, expId, future(10));
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const who = req.header("X-Test-User");
    if (who) (req as any).user = userFor(who);
    next();
  });
  app.use("/api/admin", adminRouter);
  app.use("/api/vendor", vendorRouter);
  app.use("/api/experiences", experiencesRouter);
  server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, r));
  const a = server.address();
  if (!a || typeof a === "string") throw new Error("bind");
  base = `http://127.0.0.1:${a.port}`;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  for (const k of ["participation.attendees", "participation.events"]) await setSetting(k, "false");
  // Put the shared field policy back exactly as it was.
  await db.prepare(`UPDATE field_policies SET version = ?, policy_json = NULL WHERE id = 1`).run(policyVersionAtStart);
  const ph = refs.map(() => "?").join(",") || "''";
  for (const t of ["order_acknowledgements", "booking_attendees", "registration_answers"]) await db.prepare(`DELETE FROM ${t} WHERE source_ref IN (${ph})`).run(...refs);
  await db.prepare(`DELETE FROM experience_booking_participants WHERE booking_ref IN (${ph})`).run(...refs);
  await db.prepare(`DELETE FROM notifications WHERE listing_id = ?`).run(expId);
  await db.prepare(`DELETE FROM experience_bookings WHERE experience_id = ?`).run(expId);
  await db.prepare(`DELETE FROM registration_questions WHERE listing_id = ?`).run(expId);
  await db.prepare(`DELETE FROM experience_sessions WHERE experience_id = ?`).run(expId);
  await db.prepare(`DELETE FROM experiences WHERE id = ?`).run(expId);
  await db.prepare(`DELETE FROM audit_log WHERE object_id IN (?, '1') AND action IN ('experience.questions_saved', 'experience.attendees_exported', 'fields.policy_changed', 'experience_booking.answers_edited')`).run(expId);
  await db.prepare(`DELETE FROM users WHERE id IN (?, ?)`).run(ownerId, financeId);
  await db.prepare(`DELETE FROM organisations WHERE id = ?`).run(orgId);
});

describe("field classes and restrictions (#9 invalid and malicious fields)", () => {
  it("platform-locked fields can't be re-asked; financial and identity data are refused even with special categories unlocked", () => {
    expect(reservedLabel("Email address")).toBeTruthy();
    expect(reservedLabel("Your phone number?")).toBeTruthy();
    expect(reservedLabel("Name on badge")).toBeNull();
    expect(refusal([q({ label: "Price" })])).toBe("reserved_field");
    expect(forbiddenWording("Your PPS number")).toBeTruthy();
    expect(refusal([q({ label: "Card number for the deposit" })], true)).toBe("forbidden_field");
    expect(refusal([q({ label: "Bank details", purpose: "Refunds" })], true)).toBe("forbidden_field");
    expect(refusal([q({ inputType: "select", label: "ID", choices: ["Passport", "Other"] })], true)).toBe("forbidden_field");
    expect(refusal([q({ label: "Any allergies?" })])).toBe("special_category");
    expect(refusal([q({ placeholder: "e.g. inhaler" })])).toBe("special_category");
  });

  it("library fields take their wording from the registry; admin-only ones need the policy", () => {
    const [shirt] = cleanQuestionSet([{ fieldKey: "tshirt_size", label: "Ignored", purpose: "Ignored", required: true }], false);
    expect(shirt).toMatchObject({ fieldKey: "tshirt_size", label: "T-shirt size", inputType: "select", required: true, scope: "attendee" });
    expect(refusal([{ fieldKey: "emergency_contact" }])).toBe("field_not_available");
    const on = { ...DEFAULT_POLICY, library: { ...DEFAULT_POLICY.library, emergency_contact: true } };
    expect(refusal([{ fieldKey: "emergency_contact" }], false, on)).toBeNull();
    expect(refusal([{ fieldKey: "tshirt_size" }, { fieldKey: "tshirt_size" }])).toMatch(/already in this form/);
    expect(refusal([{ fieldKey: "nope" }])).toMatch(/unknown ready-made/);
  });

  it("every ready-made field passes the platform's own checks when switched on (regression: the food-preference hint mentions allergies)", () => {
    const allOn = { ...DEFAULT_POLICY, library: Object.fromEntries(LIBRARY.map((f) => [f.key, true])) };
    for (const f of LIBRARY) expect([f.key, refusal([{ fieldKey: f.key }], false, allOn)]).toEqual([f.key, null]);
  });

  it("approved types, validation rules and classes", () => {
    const noEmail = { ...DEFAULT_POLICY, customTypes: { ...DEFAULT_POLICY.customTypes, email: false } };
    expect(refusal([q({ inputType: "email", label: "Second contact email" })], false, noEmail)).toBe("type_not_allowed");
    const [email] = cleanQuestionSet([q({ inputType: "email", label: "Second contact email", category: "general" })], false);
    expect(email.category).toBe("contact");
    expect(refusal([q({ inputType: "radio", choices: ["Only"] })])).toMatch(/two choices/);
    expect(refusal([q({ minLength: 10, maxLength: 5 })])).toMatch(/shortest answer is longer/);
    expect(refusal([q({ inputType: "select", choices: ["A", "B"], defaultValue: "C" })])).toMatch(/one of the choices/);
    const [info] = cleanQuestionSet([q({ inputType: "info", label: "Bring a packed lunch", required: true, doorVisible: true })], false);
    expect(info).toMatchObject({ required: false, doorVisible: false, exportable: false });
  });

  it("answers for the new types are checked on the server", () => {
    const mk = (inputType: string, extra: Partial<Question> = {}) => ({ id: "x", key: "k", scope: "booking", inputType, label: "L", help: "", purpose: "p", required: true, choices: ["A", "B", "C"], min: null, max: null, appliesTo: "all", doorVisible: false, category: "general", sortOrder: 0, version: 1, fieldKey: null, placeholder: "", defaultValue: null, minLength: null, maxLength: null, editability: "until_start", exportable: false, ...extra }) as Question;
    const one = (question: Question, value: unknown) => {
      try { return cleanAnswers([question], { booking: { k: value } }, [])[0]?.value ?? null; } catch (e) { return e instanceof QuestionError ? `ERR ${e.message}` : String(e); }
    };
    expect(one(mk("multi_select"), ["C", "A"])).toBe('["A","C"]');
    expect(one(mk("multi_select"), ["Z"])).toMatch(/^ERR/);
    expect(one(mk("email"), "not-an-email")).toMatch(/^ERR/);
    expect(one(mk("email"), "a@b.ie")).toBe("a@b.ie");
    expect(one(mk("tel"), "085 123 4567")).toBe("085 123 4567");
    expect(one(mk("radio"), "B")).toBe("B");
    expect(one(mk("long_text", { maxLength: 5 }), "too long")).toMatch(/^ERR/);
    expect(one(mk("text", { minLength: 3 }), "ab")).toMatch(/at least 3/);
    expect(cleanAnswers([mk("info")], { booking: { k: "x" } }, [])).toEqual([]);
  });
});

describe("admin field policy (versioned, audited)", () => {
  it("validates, refuses stale versions and non-policy admins, and is audited", async () => {
    expect(() => cleanPolicy({ customTypes: { text: false } }, DEFAULT_POLICY)).toThrow(FieldPolicyError);
    expect(() => cleanPolicy({ classes: { contact: { retentionDays: 0 } } }, DEFAULT_POLICY)).toThrow(FieldPolicyError);
    const view = await call("GET", `/api/admin/fields`, undefined, "support");
    expect(view.status).toBe(200);
    expect(view.body.platformLocked.map((f: { key: string }) => f.key)).toContain("payment_status");
    const v = view.body.policy.version;
    const change = { version: v, library: { emergency_contact: true }, customTypes: { tel: false }, classes: { general: { retentionDays: 365 } }, reason: "Approve emergency contacts" };
    expect((await call("PUT", `/api/admin/fields/policy`, change, "support")).status).toBe(403);
    expect((await call("PUT", `/api/admin/fields/policy`, change, "owner")).status).toBe(403);
    const saved = await call("PUT", `/api/admin/fields/policy`, change, "super");
    expect(saved.status).toBe(200);
    expect(saved.body.policy).toMatchObject({ version: v + 1, library: { emergency_contact: true }, customTypes: { tel: false } });
    expect((await call("PUT", `/api/admin/fields/policy`, change, "super")).status).toBe(409);
    const audit = (await db.prepare(`SELECT reason FROM audit_log WHERE action = 'fields.policy_changed' ORDER BY id DESC LIMIT 1`).get()) as { reason: string };
    expect(audit.reason).toBe("Approve emergency contacts");
  });
});

describe("partner builder, export and editability", () => {
  let version = 0;
  const keys: Record<string, string> = {};
  it("the builder sees only what the policy allows, and saves library + custom fields", async () => {
    const g = await call("GET", `/api/vendor/experiences/${expId}/questions`, undefined, "owner");
    expect(g.body.library.map((f: { key: string }) => f.key)).toContain("emergency_contact");
    expect(g.body.allowedTypes).not.toContain("tel");
    const saved = await call("PUT", `/api/vendor/experiences/${expId}/questions`, {
      version: 0,
      questions: [
        { fieldKey: "tshirt_size", exportable: true, required: true },
        { fieldKey: "emergency_contact", exportable: true },
        { scope: "booking", inputType: "multi_select", label: "Which sessions will you join?", purpose: "To plan numbers", choices: ["Morning", "Afternoon"], exportable: true },
        { scope: "booking", inputType: "text", label: "Group name", purpose: "To seat groups together", exportable: false, editability: "locked" },
      ],
    }, "owner");
    expect(saved.status).toBe(200);
    version = saved.body.version;
    for (const x of saved.body.questions) keys[x.fieldKey ?? x.label] = x.key;
    // The public form carries the new properties, never the export flag.
    const pub = (await call("GET", `/api/experiences/${expId}`)).body.registration.attendeeDetails.questions;
    expect(pub.find((x: { label: string }) => x.label === "Group name")).toMatchObject({ editability: "locked" });
    expect(JSON.stringify(pub)).not.toMatch(/exportable|category/);
  });

  it("exports only exportable answers in exportable classes; roster roles only; audited; formula-safe", async () => {
    const r = await call("POST", `/api/experiences/${expId}/sessions/${sessId}/checkout`, {
      participantName: "=HYPERLINK(1)", email: "fr@example.test", acceptedTerms: true, partySize: 1, questionsVersion: version,
      attendees: [{ name: "Fran" }],
      answers: { booking: { [keys.emergency_contact]: "Pat 0851234567", [keys["Which sessions will you join?"]]: ["Afternoon"], [keys["Group name"]]: "Team Blue" }, attendees: [{ [keys.tshirt_size]: "M" }] },
    });
    expect(r.status).toBe(201);
    refs.push(r.body.ref);
    expect((await call("GET", `/api/vendor/experiences/${expId}/attendees.csv`, undefined, "finance")).status).toBe(403);
    const csv = await call("GET", `/api/vendor/experiences/${expId}/attendees.csv`, undefined, "owner");
    expect(csv.status).toBe(200);
    expect(csv.text).toContain('"T-shirt size"');
    expect(csv.text).toContain('"M"');
    expect(csv.text).toContain('"Afternoon"');
    expect(csv.text).not.toContain("Pat 0851234567"); // contact class isn't exportable by default
    expect(csv.text).not.toContain("Team Blue"); // not marked exportable
    expect(csv.text).not.toContain("fr@example.test");
    const audit = (await db.prepare(`SELECT new_value FROM audit_log WHERE object_id = ? AND action = 'experience.attendees_exported'`).get(expId)) as { new_value: string };
    expect(JSON.parse(audit.new_value).rows).toBe(1);
  });

  it("a locked answer can't be changed after booking; editable ones can", async () => {
    const ref = refs[0];
    const edit = await call("PUT", `/api/experiences/bookings/${ref}/answers`, {
      questionsVersion: version,
      answers: { booking: { [keys.emergency_contact]: "Sam 0860000000", [keys["Which sessions will you join?"]]: ["Morning", "Afternoon"], [keys["Group name"]]: "Team Red" }, attendees: [{ [keys.tshirt_size]: "L" }] },
    });
    expect(edit.status).toBe(200);
    const byKey = Object.fromEntries(edit.body.answers.map((a: { key: string; value: string }) => [a.key, a.value]));
    expect(byKey[keys["Group name"]]).toBe("Team Blue");
    expect(byKey[keys.tshirt_size]).toBe("L");
    expect(byKey[keys.emergency_contact]).toBe("Sam 0860000000");
  });
});
