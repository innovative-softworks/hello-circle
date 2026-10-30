import crypto from "node:crypto";
import http, { type Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, setSetting } from "../db/index.js";
import { vendorRouter } from "../routes/vendor.js";
import { bookingsRouter } from "../routes/bookings.js";
import { centresRouter } from "../routes/centres.js";
import { clubsRouter } from "../routes/clubs.js";
import { programsRouter } from "../routes/programs.js";
import { registrationsRouter } from "../routes/registrations.js";
import { endPendingHold } from "../bookingIntegrity.js";
import { personTypeFromDob } from "./formAnswers.js";
import { fixedFieldClash } from "./formListings.js";

// Phase H (docs/participation-expansion/19) — the one form engine on club
// registrations, programme enrolments and hall bookings: ownership, roles,
// capability, fixed-field duplication, version integrity, answers stored with
// the order (and gone with a deleted pending hold), and unchanged flows when a
// listing has no form. Real routers, isolated MySQL.

const run = crypto.randomUUID().slice(0, 8);
const id = (k: string) => `t-${k}-uf-${run}`;
const orgA = id("orgA");
const orgB = id("orgB");
const ownerA = id("ownerA");
const ownerB = id("ownerB");
const financeA = id("financeA");
const centreMgrA = id("centreMgrA");
const facilityMgrA = id("facilityMgrA");
const clubId = id("club");
const centreId = id("centre");
const roomId = "room-1";
const programId = id("program");
const clientId = id("client");
const bookingDate = new Date(Date.now() + 20 * 86_400_000).toISOString().slice(0, 10);
let server: Server;
let base: string;

function userFor(who: string) {
  const v = { role: "vendor", status: "approved", orgStatus: "active", name: who, businessName: who, email: `${who}@example.test` };
  const staff = (uid: string, platformRole: string) => ({ ...v, id: uid, orgId: orgA, invitedStaff: true, platformRole });
  if (who === "ownerA") return { ...v, id: ownerA, orgId: orgA, invitedStaff: false, platformRole: null };
  if (who === "ownerB") return { ...v, id: ownerB, orgId: orgB, invitedStaff: false, platformRole: null };
  if (who === "financeA") return staff(financeA, "finance");
  if (who === "centreMgrA") return staff(centreMgrA, "centre_manager");
  if (who === "facilityMgrA") return staff(facilityMgrA, "facility_manager");
  return undefined;
}
async function call(method: string, path: string, body?: unknown, who?: string) {
  const res = await fetch(`${base}${path}`, { method, headers: { "Content-Type": "application/json", "X-Client-Id": clientId, ...(who ? { "X-Test-User": who } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json };
}
const F = (type: string, lid: string) => `/api/vendor/forms/${type}/${lid}/questions`;
const ask = (over: Record<string, unknown>) => ({ scope: "booking", inputType: "text", label: "Anything we should plan for?", purpose: "To plan the day", required: false, ...over });
async function publish(type: string, lid: string, questions: unknown[], who = "ownerA") {
  const d = await call("PUT", `${F(type, lid)}/draft`, { questions }, who);
  if (d.status !== 200) return d;
  return call("POST", `${F(type, lid)}/publish`, {}, who);
}
const regBody = (over: Record<string, unknown> = {}) => ({
  clubId, team: "U10", childFirst: "Uf", childLast: `Kid${run}`, dob: "2016-03-04", gFirst: "Uf", gLast: "Parent", email: `uf-${run}@example.test`, phone: "0850000000", address: "1 Main St",
  ecName: "Contact", ecPhone: "0850000001", ecRel: "Parent", consent: true, trial: false, ...over,
});
const hallBody = (over: Record<string, unknown> = {}) => ({ centreId, roomId, date: bookingDate, time: "10:00", duration: 1, guests: 5, eventType: "Party", name: "Uf Booker", email: `uf-${run}@example.test`, phone: "0850000000", ...over });

beforeAll(async () => {
  await setSetting("participation.attendees", "true");
  await db.prepare(`INSERT INTO organisations (id, name, kind) VALUES (?, 'UF A', 'vendor'), (?, 'UF B', 'vendor')`).run(orgA, orgB);
  for (const [uid, org, staff, role] of [[ownerA, orgA, 0, null], [ownerB, orgB, 0, null], [financeA, orgA, 1, "finance"], [centreMgrA, orgA, 1, "centre_manager"], [facilityMgrA, orgA, 1, "facility_manager"]] as const) {
    await db.prepare(`INSERT INTO users (id, email, password_hash, role, status, name, org_id, invited_staff, platform_role) VALUES (?, ?, 'x', 'vendor', 'approved', ?, ?, ?, ?)`).run(uid, `${uid}@example.test`, uid, org, staff, role);
  }
  await db.prepare(`INSERT INTO clubs (id, name, sport, area, county, ages, price, unit, trial, ph, image_url, blurb, vendor_id, status, payment_method) VALUES (?, 'UF Club', 'Testball', 'Area', 'Dublin', '5-12', 0, 'year', 0, '', '', '', ?, 'approved', 'cash')`).run(clubId, ownerA);
  await db.prepare(`INSERT INTO centres (id, name, area, county, rating, reviews, capacity, from_price, managed_by, ph, image_url, blurb, vendor_id, status) VALUES (?, 'UF Hall', 'Area', 'Dublin', 0, 0, 20, 1000, 'Mgr', '', '', '', ?, 'approved')`).run(centreId, ownerA);
  await db.prepare(`INSERT INTO rooms (id, centre_id, name, cap, rate, \`desc\`, sort_order, payment_method) VALUES (?, ?, 'Main Hall', 20, 50, '', 0, 'cash')`).run(roomId, centreId);
  await db.prepare(`INSERT INTO programs (id, listing_type, listing_id, vendor_id, title, description, status, price_cents) VALUES (?, 'club', ?, ?, 'UF Course', '', 'published', 0)`).run(programId, clubId, ownerA);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const who = req.header("X-Test-User");
    if (who) (req as any).user = userFor(who);
    next();
  });
  app.use("/api/vendor", vendorRouter);
  app.use("/api/bookings", bookingsRouter);
  app.use("/api/centres", centresRouter);
  app.use("/api/clubs", clubsRouter);
  app.use("/api/programs", programsRouter);
  app.use("/api/registrations", registrationsRouter);
  server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, r));
  const a = server.address();
  if (!a || typeof a === "string") throw new Error("bind");
  base = `http://127.0.0.1:${a.port}`;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  await setSetting("participation.attendees", "false");
  const lids = [clubId, centreId, programId];
  const refs = [
    ...((await db.prepare(`SELECT ref FROM registrations WHERE club_id = ?`).all(clubId)) as { ref: string }[]),
    ...((await db.prepare(`SELECT ref FROM bookings WHERE centre_id = ?`).all(centreId)) as { ref: string }[]),
    ...((await db.prepare(`SELECT ref FROM program_enrollments WHERE program_id = ?`).all(programId)) as { ref: string }[]),
  ].map((r) => r.ref);
  const ph = refs.map(() => "?").join(",") || "''";
  for (const t of ["order_acknowledgements", "registration_answers"]) await db.prepare(`DELETE FROM ${t} WHERE source_ref IN (${ph})`).run(...refs);
  await db.prepare(`DELETE FROM registration_answers WHERE source_ref LIKE ?`).run(`%${run}%`);
  for (const lid of lids) {
    await db.prepare(`DELETE FROM notifications WHERE listing_id = ?`).run(lid);
    await db.prepare(`DELETE FROM registration_questions WHERE listing_id = ?`).run(lid);
    await db.prepare(`DELETE FROM registration_form_drafts WHERE listing_id = ?`).run(lid);
    await db.prepare(`DELETE FROM audit_log WHERE object_id = ?`).run(lid);
  }
  await db.prepare(`DELETE FROM registrations WHERE club_id = ?`).run(clubId);
  await db.prepare(`DELETE FROM bookings WHERE centre_id = ?`).run(centreId);
  await db.prepare(`DELETE FROM program_enrollments WHERE program_id = ?`).run(programId);
  await db.prepare(`DELETE FROM programs WHERE id = ?`).run(programId);
  await db.prepare(`DELETE FROM rooms WHERE centre_id = ?`).run(centreId);
  await db.prepare(`DELETE FROM centres WHERE id = ?`).run(centreId);
  await db.prepare(`DELETE FROM clubs WHERE id = ?`).run(clubId);
  await db.prepare(`DELETE FROM feature_flags WHERE org_id IN (?, ?)`).run(orgA, orgB);
  await db.prepare(`DELETE FROM users WHERE id IN (?, ?, ?, ?, ?)`).run(ownerA, ownerB, financeA, centreMgrA, facilityMgrA);
  await db.prepare(`DELETE FROM organisations WHERE id IN (?, ?)`).run(orgA, orgB);
});

describe("Phase H — rules", () => {
  it("refuses questions that repeat each listing's own fixed form", () => {
    expect(fixedFieldClash("club", { fieldKey: "emergency_contact", label: "x", scope: "booking" })).toMatch(/already asks/);
    expect(fixedFieldClash("club", { fieldKey: null, label: "Child's date of birth?", scope: "attendee" })).toMatch(/already asks/);
    expect(fixedFieldClash("program", { fieldKey: "date_of_birth", label: "x", scope: "attendee" })).toMatch(/already asks/);
    expect(fixedFieldClash("centre", { fieldKey: null, label: "Number of guests", scope: "booking" })).toMatch(/already asks/);
    expect(fixedFieldClash("centre", { fieldKey: null, label: "Need a projector?", scope: "attendee" })).toMatch(/once per booking/);
    expect(fixedFieldClash("experience", { fieldKey: null, label: "Team", scope: "booking" })).toBeNull();
    expect(fixedFieldClash("club", { fieldKey: null, label: "Kit size", scope: "attendee" })).toBeNull();
  });

  it("works out a programme participant's adult/child type from the date of birth", () => {
    const today = new Date("2026-10-29T12:00:00Z");
    expect(personTypeFromDob("2015-01-01", today)).toBe("child");
    expect(personTypeFromDob("2008-10-29", today)).toBe("adult");
    expect(personTypeFromDob("2008-10-30", today)).toBe("child");
    expect(personTypeFromDob("", today)).toBe("adult");
  });
});

describe("Phase H — access", () => {
  it("only the owning organisation sees or changes a listing's form", async () => {
    for (const [t, lid] of [["club", clubId], ["centre", centreId], ["program", programId]]) {
      expect((await call("GET", F(t, lid), undefined, "ownerB")).status).toBe(403);
      expect((await call("PUT", `${F(t, lid)}/draft`, { questions: [] }, "ownerB")).status).toBe(403);
      expect((await call("GET", `/api/vendor/forms/${t}/${lid}/answers`, undefined, "ownerB")).status).toBe(403);
      expect((await call("GET", F(t, lid), undefined, "ownerA")).status).toBe(200);
    }
    // Unknown listing types never reach the handlers.
    expect((await call("GET", F("game", clubId), undefined, "ownerA")).status).toBe(404);
  });

  it("each listing's editing role decides who publishes; finance can only read", async () => {
    expect((await call("GET", F("club", clubId), undefined, "financeA")).status).toBe(200);
    expect((await call("PUT", `${F("club", clubId)}/draft`, { questions: [] }, "financeA")).status).toBe(403);
    expect((await call("PUT", `${F("club", clubId)}/draft`, { questions: [] }, "centreMgrA")).status).toBe(403);
    expect((await call("PUT", `${F("centre", centreId)}/draft`, { questions: [] }, "facilityMgrA")).status).toBe(403);
    expect((await call("PUT", `${F("centre", centreId)}/draft`, { questions: [] }, "centreMgrA")).status).toBe(200);
    // A programme follows the listing it's attached to (a club here).
    expect((await call("PUT", `${F("program", programId)}/draft`, { questions: [] }, "centreMgrA")).status).toBe(403);
    expect((await call("PUT", `${F("program", programId)}/draft`, { questions: [] }, "facilityMgrA")).status).toBe(200);
    for (const [t, lid] of [["centre", centreId], ["program", programId]]) await call("DELETE", `${F(t, lid)}/draft`, undefined, "ownerA");
    expect((await call("GET", `/api/vendor/forms/club/${clubId}/answers`, undefined, "financeA")).status).toBe(403);
  });

  it("the organisation's registration_questions capability gates publishing", async () => {
    await db.prepare(`INSERT INTO feature_flags (org_id, flag_key, enabled) VALUES (?, 'registration_questions', 0)`).run(orgA);
    try {
      expect((await call("PUT", `${F("club", clubId)}/draft`, { questions: [ask({})] }, "ownerA")).status).toBe(403);
    } finally {
      await db.prepare(`DELETE FROM feature_flags WHERE org_id = ? AND flag_key = 'registration_questions'`).run(orgA);
    }
  });
});

describe("Phase H — club registration", () => {
  let version = 0;
  it("a club with no form registers exactly as before", async () => {
    expect((await call("GET", `/api/clubs/${clubId}`)).body.registrationForm).toEqual({ questions: [], questionsVersion: 0 });
    expect((await call("POST", "/api/registrations/checkout", regBody({ childFirst: "Before" }))).status).toBe(201);
  });

  it("a fixed club field can't be added again; the library hides it", async () => {
    const get = await call("GET", F("club", clubId), undefined, "ownerA");
    expect(get.body.library.map((f: { key: string }) => f.key)).not.toContain("emergency_contact");
    const refused = await publish("club", clubId, [ask({ label: "Date of birth", scope: "attendee", inputType: "date" })]);
    expect(refused.status).toBe(400);
    expect(refused.body.error).toMatch(/already asks/);
  });

  it("publishes a form with a booking question and a question about the child", async () => {
    const pub = await publish("club", clubId, [ask({ label: "How did you hear about us?", required: true }), ask({ scope: "attendee", inputType: "select", label: "Kit size", choices: ["Small", "Medium", "Large"], appliesTo: "child", required: true })]);
    expect(pub.status).toBe(200);
    version = pub.body.version;
    expect(version).toBe(1);
    const form = (await call("GET", `/api/clubs/${clubId}`)).body.registrationForm;
    expect(form.questionsVersion).toBe(1);
    expect(form.questions.map((q: { label: string }) => q.label)).toEqual(["How did you hear about us?", "Kit size"]);
    expect((await db.prepare(`SELECT action FROM audit_log WHERE object_id = ? AND action = 'club.questions_published'`).get(clubId))).toBeTruthy();
  });

  it("refuses a stale or incomplete registration, then stores the answers with it", async () => {
    expect((await call("POST", "/api/registrations/checkout", regBody({ childFirst: "Stale" }))).body.code).toBe("form_required");
    expect((await call("POST", "/api/registrations/checkout", regBody({ childFirst: "Stale", questionsVersion: version - 1 }))).body.code).toBe("questions_changed");
    const missing = await call("POST", "/api/registrations/checkout", regBody({ childFirst: "Missing", questionsVersion: version, answers: { booking: { q1: "Friend" } } }));
    expect(missing.status).toBe(400);
    const keys = (await call("GET", F("club", clubId), undefined, "ownerA")).body.questions.map((q: { key: string }) => q.key);
    const ok = await call("POST", "/api/registrations/checkout", regBody({ childFirst: "Answered", questionsVersion: version, answers: { booking: { [keys[0]]: "A friend" }, attendees: [{ [keys[1]]: "Medium" }] } }));
    expect(ok.status).toBe(201);
    const rows = (await db.prepare(`SELECT attendee_no, label_snapshot, value_text, questions_version FROM registration_answers WHERE source_type = 'registration' AND source_ref = ? ORDER BY attendee_no`).all(ok.body.ref)) as Record<string, unknown>[];
    expect(rows).toEqual([
      { attendee_no: 0, label_snapshot: "How did you hear about us?", value_text: "A friend", questions_version: 1 },
      { attendee_no: 1, label_snapshot: "Kit size", value_text: "Medium", questions_version: 1 },
    ]);
    // The partner reviews them; the registration itself is unchanged in shape.
    const review = await call("GET", `/api/vendor/forms/club/${clubId}/answers`, undefined, "facilityMgrA");
    expect(review.status).toBe(200);
    expect(review.body.orders.find((o: { ref: string }) => o.ref === ok.body.ref).answers).toHaveLength(2);
    // Phase J — every registration is listed: one made before the form existed shows what it's missing.
    const before = review.body.orders.find((o: { name: string }) => o.name.startsWith("Before"));
    expect(before).toMatchObject({ answers: [], missing: ["How did you hear about us?", expect.stringMatching(/Kit size$/)] });
    expect(review.body.orders.find((o: { ref: string }) => o.ref === ok.body.ref).missing).toEqual([]);
    // A later version leaves the old answers as given.
    expect((await publish("club", clubId, [ask({ label: "How did you hear about us?" })])).body.version).toBe(2);
    const kept = (await db.prepare(`SELECT COUNT(*) AS n FROM registration_answers WHERE source_ref = ? AND questions_version = 1`).get(ok.body.ref)) as { n: number };
    expect(Number(kept.n)).toBe(2);
    expect((await call("GET", `${F("club", clubId)}/versions`, undefined, "ownerA")).body.versions.map((v: { version: number }) => v.version)).toEqual([2, 1]);
  });

  it("an adult registering themselves isn't asked a children-only question", async () => {
    const keys = (await call("GET", F("club", clubId), undefined, "ownerA")).body.questions.map((q: { key: string }) => q.key);
    expect(keys).toHaveLength(1);
    const pub = await publish("club", clubId, [ask({ label: "How did you hear about us?" }), ask({ scope: "attendee", inputType: "select", label: "Kit size", choices: ["S", "M"], appliesTo: "child", required: true })]);
    const adult = await call("POST", "/api/registrations/checkout", regBody({ registrantType: "adult", dob: undefined, team: undefined, childFirst: "Grown", questionsVersion: pub.body.version, answers: {} }));
    expect(adult.status).toBe(201);
  });
});

describe("Phase H — programme enrolment", () => {
  it("asks the participant's questions, by age, and stores them with the enrolment", async () => {
    const pub = await publish("program", programId, [ask({ scope: "attendee", inputType: "radio", label: "Swimming level", choices: ["New", "Confident"], appliesTo: "child", required: true })]);
    expect(pub.status).toBe(200);
    const form = (await call("GET", `/api/programs/${programId}`)).body.registrationForm;
    expect(form.questions).toHaveLength(1);
    const key = form.questions[0].key;
    const enrol = (over: Record<string, unknown>) => call("POST", `/api/programs/${programId}/enroll`, { participantName: `Uf Learner ${crypto.randomUUID().slice(0, 4)}`, email: `uf-${run}@example.test`, questionsVersion: form.questionsVersion, ...over });
    expect((await enrol({ participantDob: "2016-01-01", answers: {} })).status).toBe(400);
    const child = await enrol({ participantDob: "2016-01-01", answers: { attendees: [{ [key]: "Confident" }] } });
    expect(child.status).toBe(201);
    expect(await db.prepare(`SELECT value_text FROM registration_answers WHERE source_type = 'program' AND source_ref = ?`).get(child.body.ref)).toEqual({ value_text: "Confident" });
    // An adult isn't asked the children's question.
    expect((await enrol({ answers: {} })).status).toBe(201);
  });
});

describe("Phase H — hall booking", () => {
  it("asks once per booking only, and stores the answers with the booking", async () => {
    const perPerson = await publish("centre", centreId, [ask({ scope: "attendee", label: "Need a projector?" })]);
    expect(perPerson.status).toBe(400);
    expect(perPerson.body.error).toMatch(/once per booking/);
    const get = await call("GET", F("centre", centreId), undefined, "ownerA");
    expect(get.body.personQuestions).toBe(false);
    expect(get.body.library.every((f: { scope: string }) => f.scope === "booking")).toBe(true);
    const pub = await publish("centre", centreId, [ask({ inputType: "checkbox", label: "We'd like the kitchen opened", purpose: "So the caretaker opens it" })]);
    expect(pub.status).toBe(200);
    const form = (await call("GET", `/api/centres/${centreId}`)).body.registrationForm;
    expect(form.questions).toHaveLength(1);
    expect((await call("POST", "/api/bookings/checkout", hallBody({ time: "11:00" }))).body.code).toBe("form_required");
    const ok = await call("POST", "/api/bookings/checkout", hallBody({ time: "12:00", questionsVersion: form.questionsVersion, answers: { booking: { [form.questions[0].key]: true } } }));
    expect(ok.status).toBe(201);
    expect(await db.prepare(`SELECT attendee_no, value_text FROM registration_answers WHERE source_type = 'booking' AND source_ref = ?`).get(ok.body.ref)).toEqual({ attendee_no: 0, value_text: "yes" });
    const review = await call("GET", `/api/vendor/forms/centre/${centreId}/answers`, undefined, "centreMgrA");
    expect(review.body.orders.map((o: { ref: string }) => o.ref)).toContain(ok.body.ref);
  });

  it("with the participation switch off, the form disappears and booking is unchanged", async () => {
    await setSetting("participation.attendees", "false");
    try {
      expect((await call("GET", `/api/centres/${centreId}`)).body.registrationForm).toEqual({ questions: [], questionsVersion: 0 });
      expect((await call("POST", "/api/bookings/checkout", hallBody({ time: "14:00" }))).status).toBe(201);
    } finally {
      await setSetting("participation.attendees", "true");
    }
  });
});

describe("Phase H — pending holds", () => {
  it("a deleted pending order takes its answers with it", async () => {
    const ref = `CR-UF-${run}`;
    await db.prepare(`INSERT INTO registrations (ref, client_id, club_id, team, child_first, child_last, dob, g_first, g_last, email, phone, address, ec_name, ec_phone, ec_rel, medical, consent, trial, total_cents, payment_status) VALUES (?, ?, ?, 'T', 'P', 'H', '2015-01-01', 'G', 'G', 'x@example.test', '0', 'A', 'E', '0', 'P', '', 1, 0, 1000, 'pending')`).run(ref, clientId, clubId);
    await db.prepare(`INSERT INTO registration_answers (source_type, source_ref, attendee_no, question_id, qkey, questions_version, label_snapshot, input_type_snapshot, value_text) VALUES ('registration', ?, 0, 'q', 'q1', 1, 'L', 'text', 'v')`).run(ref);
    expect(await endPendingHold("registrations", ref, "delete")).toBe(true);
    expect(await db.prepare(`SELECT id FROM registration_answers WHERE source_ref = ?`).get(ref)).toBeUndefined();
  });
});
