import crypto from "node:crypto";
import http, { type Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, setSetting } from "../db/index.js";
import { vendorRouter } from "../routes/vendor.js";
import { experiencesRouter } from "../routes/experiences.js";
import { cleanAnswers, cleanQuestionSet, QuestionError, type Question } from "./questions.js";

// Configuration framework Phase G (docs/participation-expansion/17) — the form
// builder: sections, conditions, drafts, publish, version history, templates
// and compatibility with answers already given. Real routers, isolated MySQL.

const run = crypto.randomUUID().slice(0, 8);
const id = (k: string) => `t-${k}-fb-${run}`;
const orgA = id("orgA");
const orgB = id("orgB");
const ownerA = id("ownerA");
const ownerB = id("ownerB");
const financeA = id("financeA");
const expId = id("exp");
const sessId = id("sess");
const clientId = id("client");
const refs: string[] = [];
const templateIds: string[] = [];
let server: Server;
let base: string;

function userFor(who: string) {
  const v = { role: "vendor", status: "approved", orgStatus: "active", name: who, businessName: who, email: `${who}@example.test` };
  if (who === "ownerA") return { ...v, id: ownerA, orgId: orgA, invitedStaff: false, platformRole: null };
  if (who === "ownerB") return { ...v, id: ownerB, orgId: orgB, invitedStaff: false, platformRole: null };
  if (who === "financeA") return { ...v, id: financeA, orgId: orgA, invitedStaff: true, platformRole: "finance" };
  return undefined;
}
async function call(method: string, path: string, body?: unknown, who?: string) {
  const res = await fetch(`${base}${path}`, { method, headers: { "Content-Type": "application/json", "X-Client-Id": clientId, ...(who ? { "X-Test-User": who } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json };
}
const future = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
const Q = "/api/vendor/experiences";

beforeAll(async () => {
  for (const k of ["participation.attendees", "participation.events"]) await setSetting(k, "true");
  await db.prepare(`INSERT INTO organisations (id, name, kind) VALUES (?, 'FB A', 'vendor'), (?, 'FB B', 'vendor')`).run(orgA, orgB);
  await db.prepare(`INSERT INTO users (id, email, password_hash, role, status, name, org_id, invited_staff, platform_role) VALUES (?, ?, 'x', 'vendor', 'approved', 'A', ?, 0, NULL), (?, ?, 'x', 'vendor', 'approved', 'B', ?, 0, NULL), (?, ?, 'x', 'vendor', 'approved', 'F', ?, 1, 'finance')`)
    .run(ownerA, `${ownerA}@example.test`, orgA, ownerB, `${ownerB}@example.test`, orgB, financeA, `${financeA}@example.test`, orgA);
  await db.prepare(`INSERT INTO experiences (id, vendor_id, kind, title, blurb, description, fitness_requirements, itinerary, equipment_provided, equipment_required, transport_info, safety_info, weather_policy, eligibility, cancellation_terms, status, capacity, price_cents, payment_method)
    VALUES (?, ?, 'event', 'FB event', 'b', 'd', '', '', '', '', '', '', '', '', '', 'approved', 50, 0, 'cash')`).run(expId, ownerA);
  await db.prepare(`INSERT INTO experience_sessions (id, experience_id, date, time) VALUES (?, ?, ?, '10:00')`).run(sessId, expId, future(15));
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const who = req.header("X-Test-User");
    if (who) (req as any).user = userFor(who);
    next();
  });
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
  const ph = refs.map(() => "?").join(",") || "''";
  for (const t of ["order_acknowledgements", "booking_attendees", "registration_answers"]) await db.prepare(`DELETE FROM ${t} WHERE source_ref IN (${ph})`).run(...refs);
  await db.prepare(`DELETE FROM experience_booking_participants WHERE booking_ref IN (${ph})`).run(...refs);
  await db.prepare(`DELETE FROM notifications WHERE listing_id = ?`).run(expId);
  await db.prepare(`DELETE FROM experience_bookings WHERE experience_id = ?`).run(expId);
  await db.prepare(`DELETE FROM registration_questions WHERE listing_id = ?`).run(expId);
  await db.prepare(`DELETE FROM registration_form_drafts WHERE listing_id = ?`).run(expId);
  await db.prepare(`DELETE FROM registration_form_templates WHERE org_id IN (?, ?)`).run(orgA, orgB);
  await db.prepare(`DELETE FROM experience_sessions WHERE experience_id = ?`).run(expId);
  await db.prepare(`DELETE FROM experiences WHERE id = ?`).run(expId);
  await db.prepare(`DELETE FROM audit_log WHERE object_id = ? OR object_type = 'form_template' AND object_id IN (${templateIds.map(() => "?").join(",") || "''"})`).run(expId, ...templateIds);
  await db.prepare(`DELETE FROM users WHERE id IN (?, ?, ?)`).run(ownerA, ownerB, financeA);
  await db.prepare(`DELETE FROM organisations WHERE id IN (?, ?)`).run(orgA, orgB);
});

const coming = { key: "q_coming000", scope: "booking", inputType: "radio", label: "Will you stay for lunch?", purpose: "Catering numbers", choices: ["Yes", "No"], required: true, section: "Lunch" };
const diet = { key: "q_diet00000", fieldKey: "food_preference", required: true, section: "Lunch", showIf: { key: "q_coming000", values: ["Yes"] } };

describe("sections and conditions", () => {
  const err = (raw: unknown[]) => { try { cleanQuestionSet(raw, false); return null; } catch (e) { return e instanceof QuestionError ? e.message : String(e); } };
  it("a condition points at an earlier pick-from-a-list or tick-box question, with valid answers", () => {
    expect(err([diet, coming])).toMatch(/question above it/);
    expect(err([{ key: "q_free000000", scope: "booking", inputType: "text", label: "Group", purpose: "x" }, { ...coming, key: "q_x00000000", showIf: { key: "q_free000000", values: ["a"] } }])).toMatch(/pick-from-a-list or tick-box/);
    expect(err([coming, { ...diet, showIf: { key: "q_coming000", values: ["Maybe"] } }])).toMatch(/which answers show it/);
    const attendeeQ = { key: "q_level0000", fieldKey: "experience_level" };
    expect(err([attendeeQ, { key: "q_bk0000000", scope: "booking", inputType: "text", label: "Car reg", purpose: "Parking", showIf: { key: "q_level0000", values: ["Beginner"] } }])).toMatch(/can't depend on one person's answer/);
    const ok = cleanQuestionSet([coming, diet], false);
    expect(ok[1]).toMatchObject({ section: "Lunch", showIf: { key: "q_coming000", values: ["Yes"] } });
  });
  it("a hidden question is never required, and anything sent for it is dropped", () => {
    const qs = cleanQuestionSet([coming, diet], false).map((q, i) => ({ ...q, id: `x${i}`, sortOrder: i, version: 1 })) as Question[];
    const people = [{ attendeeNo: 1, personType: "adult" as const, name: "A" }];
    expect(cleanAnswers(qs, { booking: { q_coming000: "No" }, attendees: [{ q_diet00000: "Vegan" }] }, people).map((a) => a.question.key)).toEqual(["q_coming000"]);
    expect(() => cleanAnswers(qs, { booking: { q_coming000: "Yes" }, attendees: [{}] }, people)).toThrow(/answer "Food preference"/);
    expect(cleanAnswers(qs, { booking: { q_coming000: "Yes" }, attendees: [{ q_diet00000: "Vegan" }] }, people)).toHaveLength(2);
  });
});

describe("drafts, publish and history", () => {
  let v1 = 0;
  it("publishes a first version directly (Phase 2 path still works) and a guest answers it", async () => {
    const r = await call("PUT", `${Q}/${expId}/questions`, { version: 0, questions: [coming, diet] }, "ownerA");
    expect(r.status).toBe(200);
    v1 = r.body.version;
    const b = await call("POST", `/api/experiences/${expId}/sessions/${sessId}/checkout`, { participantName: "FB Guest", email: "fb@example.test", acceptedTerms: true, partySize: 1, questionsVersion: v1, attendees: [{ name: "FB Guest" }], answers: { booking: { q_coming000: "Yes" }, attendees: [{ q_diet00000: "Vegetarian" }] } });
    expect(b.status).toBe(201);
    refs.push(b.body.ref);
  });

  it("a draft can be incomplete, isn't seen by anyone booking, and can't be published until fixed", async () => {
    expect((await call("PUT", `${Q}/${expId}/questions/draft`, { questions: [coming] }, "financeA")).status).toBe(403);
    expect((await call("PUT", `${Q}/${expId}/questions/draft`, { questions: [coming] }, "ownerB")).status).toBe(403);
    const draft = await call("PUT", `${Q}/${expId}/questions/draft`, { questions: [coming, { key: "q_new0000000", scope: "booking", inputType: "text", label: "", purpose: "" }] }, "ownerA");
    expect(draft.status).toBe(200);
    expect(draft.body.draft.issues[0]).toMatch(/write the question/);
    // The public form still shows the live version.
    expect((await call("GET", `/api/experiences/${expId}`)).body.registration.attendeeDetails.questions).toHaveLength(2);
    expect((await call("POST", `${Q}/${expId}/questions/publish`, {}, "ownerA")).status).toBe(400);
    const fixed = await call("PUT", `${Q}/${expId}/questions/draft`, { questions: [coming, { key: "q_new0000000", scope: "booking", inputType: "text", label: "Group name", purpose: "Seating", section: "About you" }] }, "ownerA");
    expect(fixed.body.draft.issues).toEqual([]);
    const pub = await call("POST", `${Q}/${expId}/questions/publish`, {}, "ownerA");
    expect(pub.status).toBe(200);
    expect(pub.body.version).toBe(v1 + 1);
    expect((await call("GET", `${Q}/${expId}/questions`, undefined, "ownerA")).body.draft).toBeNull();
    const audit = (await db.prepare(`SELECT COUNT(*) AS n FROM audit_log WHERE object_id = ? AND action = 'experience.questions_published'`).get(expId)) as { n: number };
    expect(Number(audit.n)).toBe(1);
  });

  it("#8 answers given on an older version keep their wording; the history lists every version and can be copied back", async () => {
    const details = await call("GET", `/api/experiences/bookings/${refs[0]}/details`);
    expect(details.body.answers.find((a: { key: string }) => a.key === "q_diet00000")).toMatchObject({ label: "Food preference", value: "Vegetarian", version: v1 });
    const versions = await call("GET", `${Q}/${expId}/questions/versions`, undefined, "financeA");
    expect(versions.body.versions.map((v: { version: number; live: boolean }) => [v.version, v.live])).toEqual([[v1 + 1, true], [v1, false]]);
    const old = await call("GET", `${Q}/${expId}/questions/versions/${v1}`, undefined, "ownerA");
    expect(old.body.questions.map((q: { key: string }) => q.key)).toEqual(["q_coming000", "q_diet00000"]);
    const copied = await call("POST", `${Q}/${expId}/questions/draft/from`, { version: v1 }, "ownerA");
    expect(copied.body.draft.questions).toHaveLength(2);
  });

  it("a draft started before someone else published is refused (409), never overwrites", async () => {
    const live = (await call("GET", `${Q}/${expId}/questions`, undefined, "ownerA")).body.version;
    expect((await call("PUT", `${Q}/${expId}/questions`, { version: live, questions: [coming] }, "ownerA")).status).toBe(200);
    const stale = await call("POST", `${Q}/${expId}/questions/publish`, {}, "ownerA");
    expect([stale.status, stale.body.code]).toEqual([409, "stale"]);
    expect((await call("DELETE", `${Q}/${expId}/questions/draft`, undefined, "ownerA")).body.discarded).toBe(true);
  });
});

describe("templates", () => {
  it("platform templates follow the field policy; applying one fills the draft only", async () => {
    const list = (await call("GET", `/api/vendor/form-templates`, undefined, "ownerA")).body.templates as { id: string; scope: string; questions: { fieldKey?: string }[] }[];
    expect(list.filter((t) => t.scope === "platform")).toHaveLength(7);
    const club = list.find((t) => t.id === "platform:club_registration")!;
    expect(club.questions.map((q) => q.fieldKey)).toEqual(["experience_level", "tshirt_size"]); // photo consent is admin-only, off
    const applied = await call("POST", `${Q}/${expId}/questions/draft/from`, { templateId: "platform:event_registration" }, "ownerA");
    expect(applied.status).toBe(200);
    expect(applied.body.draft.questions.map((q: { fieldKey?: string; section?: string }) => q.section)).toContain("Getting there");
    expect(applied.body.draft.issues).toEqual([]);
    // Ready-made fields come back spelled out (regression: the builder crashed on bare field keys).
    expect(applied.body.draft.questions[0]).toMatchObject({ fieldKey: "badge_name", label: "Name on badge", inputType: "text", choices: [] });
  });

  it("an organisation saves, duplicates and archives its own; others can't see or change them", async () => {
    const created = await call("POST", `/api/vendor/form-templates`, { name: "Vratham registration", formType: "event_registration", questions: [coming, diet] }, "ownerA");
    expect(created.status).toBe(201);
    templateIds.push(created.body.id);
    expect((await call("POST", `/api/vendor/form-templates`, { name: "Bad", formType: "event_registration", questions: [{ scope: "booking", inputType: "text", label: "PPS number", purpose: "x" }] }, "ownerA")).body.code).toBe("forbidden_field");
    const dup = await call("POST", `/api/vendor/form-templates/${created.body.id}/duplicate`, {}, "ownerA");
    expect(dup.status).toBe(201);
    templateIds.push(dup.body.id);
    expect((await call("GET", `/api/vendor/form-templates`, undefined, "ownerB")).body.templates.some((t: { id: string }) => t.id === created.body.id)).toBe(false);
    expect((await call("POST", `/api/vendor/form-templates/${created.body.id}/archive`, {}, "ownerB")).status).toBe(404);
    expect((await call("POST", `/api/vendor/form-templates/platform:event_registration/archive`, {}, "ownerA")).status).toBe(403);
    expect((await call("POST", `/api/vendor/form-templates/${dup.body.id}/archive`, {}, "ownerA")).status).toBe(200);
    const active = (await call("GET", `/api/vendor/form-templates`, undefined, "ownerA")).body.templates.map((t: { id: string }) => t.id);
    expect(active).toContain(created.body.id);
    expect(active).not.toContain(dup.body.id);
    expect((await call("POST", `${Q}/${expId}/questions/draft/from`, { templateId: dup.body.id }, "ownerA")).status).toBe(404);
  });
});
