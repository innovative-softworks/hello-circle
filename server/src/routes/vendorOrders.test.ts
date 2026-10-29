import crypto from "node:crypto";
import http, { type Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, setSetting } from "../db/index.js";
import { vendorOrdersRouter } from "./vendorOrders.js";
import { cleanQuestionSet, questionsVersion, replaceQuestions } from "../participation/questions.js";

// Phase J (docs/participation-expansion/20) — the partner record for any
// booking: organisation isolation, which roles see the record and which see
// registration answers (finance doesn't by default), actions per role,
// cancelled orders, partial attendance, and history labels without values.

const run = crypto.randomUUID().slice(0, 8);
const id = (k: string) => `t-${k}-vo-${run}`;
const vendorA = id("vendorA");
const vendorB = id("vendorB");
const clubId = id("club");
const expId = id("exp");
const sessId = id("sess");
const programId = id("program");
const regRef = `CR-VO-${run}`;
const cancelledRef = `CR-VOX-${run}`;
const expRef = `EX-VO-${run}`;
const progRef = `PR-VO-${run}`;
let server: Server;
let base: string;

const as = async (path: string, who: { vendorIds: string[]; role: string | null }) => {
  const r = await fetch(`${base}${path}`, { headers: { "X-Test": JSON.stringify(who) } });
  return { status: r.status, body: (await r.json()) as any };
};
const OWNER_A = { vendorIds: [vendorA], role: null };
const staffA = (role: string) => ({ vendorIds: [vendorA], role });
const OWNER_B = { vendorIds: [vendorB], role: null };
const past = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString().slice(0, 10);

beforeAll(async () => {
  await setSetting("participation.attendees", "true");
  for (const v of [vendorA, vendorB]) await db.prepare(`INSERT INTO users (id, email, password_hash, role, status, name) VALUES (?, ?, 'x', 'vendor', 'approved', 'VO')`).run(v, `${v}@example.test`);
  await db.prepare(`INSERT INTO clubs (id, name, sport, area, county, ages, price, unit, trial, ph, image_url, blurb, vendor_id, status) VALUES (?, 'VO Club', 'x', 'a', 'Dublin', '5-12', 0, 'year', 0, '', '', '', ?, 'approved')`).run(clubId, vendorA);
  const set = cleanQuestionSet([{ key: "q_kitsize", scope: "attendee", inputType: "text", label: "Kit size", purpose: "Kit", required: false }, { key: "q_shirtname", scope: "booking", inputType: "text", label: "Shirt name", purpose: "Shirts", required: true }], false, undefined, "club");
  const v = await replaceQuestions(clubId, set, await questionsVersion(clubId, db, "club"), vendorA, "club");
  for (const [ref, status] of [[regRef, "confirmed"], [cancelledRef, "cancelled"]]) {
    await db
      .prepare(`INSERT INTO registrations (ref, client_id, club_id, team, child_first, child_last, dob, g_first, g_last, email, phone, address, ec_name, ec_phone, ec_rel, medical, consent, trial, total_cents, payment_status, status) VALUES (?, 'c', ?, 'U10', 'Aoife', 'VO', '2016-01-01', 'G', 'P', 'vo@example.test', '0', 'A', 'E', '0', 'P', '', 1, 0, 0, 'paid', ?)`)
      .run(ref, clubId, status);
  }
  await db.prepare(`INSERT INTO registration_answers (source_type, source_ref, attendee_no, question_id, qkey, questions_version, label_snapshot, input_type_snapshot, value_text) VALUES ('registration', ?, 1, 'q', 'q_kitsize', ?, 'Kit size', 'text', 'Medium')`).run(regRef, v.version);
  await db.prepare(`INSERT INTO audit_log (actor_user_id, actor_kind, action, object_type, object_id, new_value) VALUES (NULL, 'resident', 'registration.answers_edited', 'registration', ?, '{"keys":["q_kitsize"]}')`).run(regRef);
  // An experience with two people, one checked in at the door.
  await db.prepare(`INSERT INTO experiences (id, vendor_id, kind, title, blurb, description, fitness_requirements, itinerary, equipment_provided, equipment_required, transport_info, safety_info, weather_policy, eligibility, cancellation_terms, status, capacity, price_cents, payment_method) VALUES (?, ?, 'event', 'VO Event', 'b', 'd', '', '', '', '', '', '', '', '', '', 'approved', 20, 0, 'cash')`).run(expId, vendorA);
  await db.prepare(`INSERT INTO experience_sessions (id, experience_id, date, time) VALUES (?, ?, ?, '10:00')`).run(sessId, expId, past(1));
  await db.prepare(`INSERT INTO experience_bookings (ref, experience_id, session_id, client_id, participant_name, email, phone, party_size, total_cents, payment_status) VALUES (?, ?, ?, 'c', 'Lead VO', 'vo@example.test', '', 2, 0, 'paid')`).run(expRef, expId, sessId);
  for (const [no, name] of [[1, "Lead VO"], [2, "Friend VO"]] as const) await db.prepare(`INSERT INTO booking_attendees (source_type, source_ref, attendee_no, person_type, name) VALUES ('experience', ?, ?, 'adult', ?)`).run(expRef, no, name);
  await db.prepare(`INSERT INTO attendee_checkins (source_type, source_ref, attendee_no, session_id, checked_in_by) VALUES ('experience', ?, 1, ?, ?)`).run(expRef, sessId, vendorA);
  // A programme with three past sessions; the participant came to one, missed one.
  await db.prepare(`INSERT INTO programs (id, listing_type, listing_id, vendor_id, title, description, status, price_cents) VALUES (?, 'club', ?, ?, 'VO Course', '', 'published', 0)`).run(programId, clubId, vendorA);
  for (const d of [3, 2, 1]) await db.prepare(`INSERT INTO program_sessions (id, program_id, date, time) VALUES (?, ?, ?, '10:00')`).run(`${id("ps")}-${d}`, programId, past(d));
  await db.prepare(`INSERT INTO program_enrollments (ref, program_id, client_id, participant_name, participant_dob, email, phone, total_cents, payment_status, status) VALUES (?, ?, 'c', 'Cian VO', '', 'vo@example.test', '', 0, 'paid', 'confirmed')`).run(progRef, programId);
  const enrol = (await db.prepare(`SELECT id FROM program_enrollments WHERE ref = ?`).get(progRef)) as { id: number };
  await db.prepare(`INSERT INTO attendance (kind, ref, status) VALUES ('program_session', ?, 'present'), ('program_session', ?, 'absent')`).run(`${id("ps")}-3:${enrol.id}`, `${id("ps")}-2:${enrol.id}`);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const who = JSON.parse(req.header("X-Test") ?? "{}") as { vendorIds: string[]; role: string | null };
    (req as any).user = { id: who.vendorIds[0], role: "vendor", status: "approved", invitedStaff: !!who.role, platformRole: who.role };
    (req as any).vendorIds = who.vendorIds;
    next();
  });
  app.use("/vendor", vendorOrdersRouter);
  server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, r));
  const a = server.address();
  if (!a || typeof a === "string") throw new Error("bind");
  base = `http://127.0.0.1:${a.port}`;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  await setSetting("participation.attendees", "false");
  for (const r of [regRef, cancelledRef, expRef, progRef]) {
    await db.prepare(`DELETE FROM registration_answers WHERE source_ref = ?`).run(r);
    await db.prepare(`DELETE FROM audit_log WHERE object_id = ?`).run(r);
  }
  await db.prepare(`DELETE FROM attendee_checkins WHERE source_ref = ?`).run(expRef);
  await db.prepare(`DELETE FROM booking_attendees WHERE source_ref = ?`).run(expRef);
  await db.prepare(`DELETE FROM attendance WHERE ref LIKE ?`).run(`${id("ps")}%`);
  await db.prepare(`DELETE FROM experience_bookings WHERE ref = ?`).run(expRef);
  await db.prepare(`DELETE FROM experience_sessions WHERE id = ?`).run(sessId);
  await db.prepare(`DELETE FROM experiences WHERE id = ?`).run(expId);
  await db.prepare(`DELETE FROM program_enrollments WHERE ref = ?`).run(progRef);
  await db.prepare(`DELETE FROM program_sessions WHERE program_id = ?`).run(programId);
  await db.prepare(`DELETE FROM programs WHERE id = ?`).run(programId);
  await db.prepare(`DELETE FROM registration_questions WHERE listing_id = ?`).run(clubId);
  await db.prepare(`DELETE FROM registrations WHERE club_id = ?`).run(clubId);
  await db.prepare(`DELETE FROM clubs WHERE id = ?`).run(clubId);
  await db.prepare(`DELETE FROM users WHERE id IN (?, ?)`).run(vendorA, vendorB);
});

describe("Phase J — the partner record", () => {
  it("another organisation can't read it; unknown kinds aren't records", async () => {
    expect((await as(`/vendor/orders/registration/${regRef}`, OWNER_B)).status).toBe(404);
    expect((await as(`/vendor/orders/game/${regRef}`, OWNER_A)).status).toBe(404);
    expect((await as(`/vendor/orders/booking/${regRef}`, OWNER_A)).status).toBe(404);
  });

  it("the owner sees answers, missing answers, actions and history (labels only)", async () => {
    const r = (await as(`/vendor/orders/registration/${regRef}`, OWNER_A)).body;
    expect(r.people).toMatchObject([{ name: "Aoife VO", personType: "child" }]);
    expect(r.answersVisible).toBe(true);
    expect(r.answers).toMatchObject([{ key: "q_kitsize", value: "Medium" }]);
    expect(r.missingAnswers).toEqual(["Shirt name"]);
    expect(r.actions).toEqual({ cancel: true, refund: true });
    expect(r.history.map((h: { label: string }) => h.label)).toEqual(["Booked", "Answers changed by the person who booked"]);
    expect(JSON.stringify(r.history)).not.toContain("q_kitsize");
  });

  it("finance gets the record and the refund, but not the answers", async () => {
    const r = await as(`/vendor/orders/registration/${regRef}`, staffA("finance"));
    expect(r.status).toBe(200);
    expect(r.body.answersVisible).toBe(false);
    expect(r.body.answers).toBeNull();
    expect(r.body.answerCount).toBe(1);
    expect(JSON.stringify(r.body)).not.toContain("Medium");
    expect(r.body.missingAnswers).toEqual([]);
    expect(r.body.actions).toEqual({ cancel: false, refund: true });
  });

  it("a manager of a different kind of listing gets the record but not the answers or actions", async () => {
    const r = (await as(`/vendor/orders/registration/${regRef}`, staffA("centre_manager"))).body;
    expect(r.answersVisible).toBe(false);
    expect(r.actions).toEqual({ cancel: false, refund: false });
    const f = (await as(`/vendor/orders/registration/${regRef}`, staffA("facility_manager"))).body;
    expect(f.answersVisible).toBe(true);
    expect(f.actions).toEqual({ cancel: true, refund: false });
  });

  it("communications and analysts can't open records", async () => {
    for (const role of ["communications", "read_only_analyst"]) expect((await as(`/vendor/orders/registration/${regRef}`, staffA(role))).status).toBe(403);
  });

  it("a cancelled registration offers no cancel and nothing is 'missing'", async () => {
    const r = (await as(`/vendor/orders/registration/${cancelledRef}`, OWNER_A)).body;
    expect(r.status).toBe("cancelled");
    expect(r.actions.cancel).toBe(false);
    expect(r.missingAnswers).toEqual([]);
    expect(r.people[0].status).toBe("removed");
  });

  it("partial attendance: one of two people at the door; one of three programme sessions", async () => {
    const e = (await as(`/vendor/orders/experience/${expRef}`, OWNER_A)).body;
    expect(e.attendance.kind).toBe("door");
    expect(e.people.map((p: { name: string; checkedInAt: string | null }) => [p.name, !!p.checkedInAt])).toEqual([["Lead VO", true], ["Friend VO", false]]);
    const p = (await as(`/vendor/orders/program/${progRef}`, OWNER_A)).body;
    expect(p.attendance).toMatchObject({ kind: "sessions", sessionsAttended: 1, sessionsMarked: 2, sessionsTotal: 3 });
    expect(p.orderId).toEqual(expect.any(Number));
  });
});
