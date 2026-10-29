import crypto from "node:crypto";
import http, { type Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, setSetting } from "../db/index.js";
import { irelandTodayIso } from "../irelandTime.js";
import { vendorReportsRouter } from "./vendorReports.js";
import { vendorFormsRouter } from "./vendorForms.js";
import { cleanQuestionSet, questionsVersion, replaceQuestions } from "../participation/questions.js";

// Phase L (docs/participation-expansion/20) — the participation report and
// the answers export: organisation isolation, roles (analyst reads counts;
// communications nothing; finance no answers), no personal data in the
// report, field export policy, and an audit row for every download.

const run = crypto.randomUUID().slice(0, 8);
const id = (k: string) => `t-${k}-rp-${run}`;
const vendorA = id("vendorA");
const vendorB = id("vendorB");
const centreId = id("centre");
const clubId = id("club");
const expId = id("exp");
const sessId = id("sess");
const today = irelandTodayIso();
const day = (d: number) => new Date(Date.parse(`${today}T12:00:00Z`) + d * 86_400_000).toISOString().slice(0, 10);
const hallRef = `HB-RP-${run}`;
const hallCancelled = `HB-RPX-${run}`;
const regRef = `CR-RP-${run}`;
const expRef = `EX-RP-${run}`;
let server: Server;
let base: string;

const as = async (path: string, vendorIds: string[], role: string | null = null) => {
  const r = await fetch(`${base}${path}`, { headers: { "X-Test": JSON.stringify({ vendorIds, role }) } });
  return { status: r.status, text: await r.text() };
};
const json = async (path: string, vendorIds: string[], role: string | null = null) => {
  const r = await as(path, vendorIds, role);
  return { status: r.status, body: JSON.parse(r.text) };
};
const Q = `?from=${day(-30)}&to=${day(30)}`;

beforeAll(async () => {
  await setSetting("participation.attendees", "true");
  for (const v of [vendorA, vendorB]) await db.prepare(`INSERT INTO users (id, email, password_hash, role, status, name) VALUES (?, ?, 'x', 'vendor', 'approved', 'RP')`).run(v, `${v}@example.test`);
  await db.prepare(`INSERT INTO centres (id, name, area, county, rating, reviews, capacity, from_price, managed_by, ph, image_url, blurb, vendor_id, status) VALUES (?, 'RP Hall', 'a', 'Dublin', 0, 0, 20, 1000, 'Mgr', '', '', '', ?, 'approved')`).run(centreId, vendorA);
  for (const [ref, status, date] of [[hallRef, "confirmed", day(-2)], [hallCancelled, "cancelled", day(5)]]) {
    await db.prepare(`INSERT INTO bookings (ref, client_id, centre_id, room_id, date, time, duration, event_type, guests, name, email, phone, notes, total_cents, payment_status, status) VALUES (?, 'c', ?, 'r1', ?, '10:00', 1, 'Party', 6, 'Secret Booker', 'secret@example.test', '0', '', 0, 'paid', ?)`).run(ref, centreId, date, status);
  }
  await db.prepare(`INSERT INTO attendance (kind, ref, status) VALUES ('booking', ?, 'present')`).run(hallRef);
  await db.prepare(`INSERT INTO clubs (id, name, sport, area, county, ages, price, unit, trial, ph, image_url, blurb, vendor_id, status) VALUES (?, 'RP Club', 'x', 'a', 'Dublin', '5-12', 0, 'year', 0, '', '', '', ?, 'approved')`).run(clubId, vendorA);
  const set = cleanQuestionSet(
    [
      { key: "q_kitsize", scope: "attendee", inputType: "text", label: "Kit size", purpose: "Kit", exportable: true },
      { key: "q_contactx", scope: "booking", inputType: "tel", label: "Second number", purpose: "Backup", exportable: true },
      { key: "q_shirtname", scope: "booking", inputType: "text", label: "Shirt name", purpose: "Shirts", required: true },
    ],
    false,
    undefined,
    "club"
  );
  const v = await replaceQuestions(clubId, set, await questionsVersion(clubId, db, "club"), vendorA, "club");
  await db.prepare(`INSERT INTO registrations (ref, client_id, club_id, team, child_first, child_last, dob, g_first, g_last, email, phone, address, ec_name, ec_phone, ec_rel, medical, consent, trial, total_cents, payment_status) VALUES (?, 'c', ?, 'U10', 'Aoife', 'RP', '2016-01-01', 'G', 'P', 'secret@example.test', '0', 'A', 'E', '0', 'P', '', 1, 0, 0, 'paid')`).run(regRef, clubId);
  for (const [no, key, label, type, value] of [[1, "q_kitsize", "Kit size", "text", "Medium"], [0, "q_contactx", "Second number", "tel", "0861234567"]] as const) {
    await db.prepare(`INSERT INTO registration_answers (source_type, source_ref, attendee_no, question_id, qkey, questions_version, label_snapshot, input_type_snapshot, value_text) VALUES ('registration', ?, ?, 'q', ?, ?, ?, ?, ?)`).run(regRef, no, key, v.version, label, type, value);
  }
  await db.prepare(`INSERT INTO experiences (id, vendor_id, kind, title, blurb, description, fitness_requirements, itinerary, equipment_provided, equipment_required, transport_info, safety_info, weather_policy, eligibility, cancellation_terms, status, capacity, price_cents, payment_method) VALUES (?, ?, 'event', 'RP Event', 'b', 'd', '', '', '', '', '', '', '', '', '', 'approved', 10, 0, 'cash')`).run(expId, vendorA);
  await db.prepare(`INSERT INTO experience_sessions (id, experience_id, date, time, capacity) VALUES (?, ?, ?, '10:00', 10)`).run(sessId, expId, day(-3));
  await db.prepare(`INSERT INTO experience_bookings (ref, experience_id, session_id, client_id, participant_name, email, phone, party_size, total_cents, payment_status) VALUES (?, ?, ?, 'c', 'Secret Booker', 'secret@example.test', '', 2, 0, 'paid')`).run(expRef, expId, sessId);
  await db.prepare(`INSERT INTO attendee_checkins (source_type, source_ref, attendee_no, session_id, checked_in_by) VALUES ('experience', ?, 1, ?, ?)`).run(expRef, sessId, vendorA);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const who = JSON.parse(req.header("X-Test") ?? "{}") as { vendorIds: string[]; role: string | null };
    (req as any).user = { id: who.vendorIds[0], orgId: null, role: "vendor", status: "approved", invitedStaff: !!who.role, platformRole: who.role };
    (req as any).vendorIds = who.vendorIds;
    next();
  });
  app.use("/vendor", vendorReportsRouter);
  app.use("/vendor", vendorFormsRouter);
  server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, r));
  const a = server.address();
  if (!a || typeof a === "string") throw new Error("bind");
  base = `http://127.0.0.1:${a.port}`;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  await setSetting("participation.attendees", "false");
  await db.prepare(`DELETE FROM attendance WHERE ref = ?`).run(hallRef);
  await db.prepare(`DELETE FROM attendee_checkins WHERE source_ref = ?`).run(expRef);
  await db.prepare(`DELETE FROM registration_answers WHERE source_ref = ?`).run(regRef);
  await db.prepare(`DELETE FROM audit_log WHERE actor_user_id IN (?, ?)`).run(vendorA, vendorB);
  await db.prepare(`DELETE FROM experience_bookings WHERE ref = ?`).run(expRef);
  await db.prepare(`DELETE FROM experience_sessions WHERE id = ?`).run(sessId);
  await db.prepare(`DELETE FROM experiences WHERE id = ?`).run(expId);
  await db.prepare(`DELETE FROM registration_questions WHERE listing_id = ?`).run(clubId);
  await db.prepare(`DELETE FROM registrations WHERE club_id = ?`).run(clubId);
  await db.prepare(`DELETE FROM clubs WHERE id = ?`).run(clubId);
  await db.prepare(`DELETE FROM bookings WHERE centre_id = ?`).run(centreId);
  await db.prepare(`DELETE FROM centres WHERE id = ?`).run(centreId);
  await db.prepare(`DELETE FROM users WHERE id IN (?, ?)`).run(vendorA, vendorB);
});

describe("Phase L — participation report", () => {
  it("counts by type, attendance, capacity, cancellations and form completion — numbers only", async () => {
    const r = (await json(`/vendor/reports/participation${Q}`, [vendorA])).body;
    const by = Object.fromEntries(r.byType.map((t: { type: string }) => [t.type, t]));
    expect(by["Hall bookings"]).toMatchObject({ orders: 2, active: 1, cancelled: 1, people: 6 });
    expect(by["Club registrations"]).toMatchObject({ orders: 1, active: 1 });
    expect(by["Events and experiences"]).toMatchObject({ orders: 1, people: 2 });
    const att = Object.fromEntries(r.attendance.map((t: { type: string }) => [t.type, t]));
    expect(att["Events and experiences (people)"]).toMatchObject({ expected: 2, attended: 1, unmarked: 1 });
    expect(att["Hall bookings"]).toMatchObject({ expected: 1, attended: 1 });
    expect(r.capacity[0]).toMatchObject({ offered: 10, taken: 2 });
    expect(r.forms).toMatchObject({ ordersChecked: 1, complete: 0, incomplete: 1 });
    const text = JSON.stringify(r);
    for (const secret of ["Secret Booker", "secret@example.test", "Aoife", "Medium"]) expect(text).not.toContain(secret);
  });

  it("is always the caller's own organisation", async () => {
    const r = (await json(`/vendor/reports/participation${Q}`, [vendorB])).body;
    expect(r.byType.every((t: { orders: number }) => t.orders === 0)).toBe(true);
  });

  it("the analyst and finance read it; communications can't; the CSV is audited and has no personal data", async () => {
    expect((await as(`/vendor/reports/participation${Q}`, [vendorA], "read_only_analyst")).status).toBe(200);
    expect((await as(`/vendor/reports/participation${Q}`, [vendorA], "finance")).status).toBe(200);
    expect((await as(`/vendor/reports/participation${Q}`, [vendorA], "communications")).status).toBe(403);
    expect((await as(`/vendor/reports/participation?from=2020-01-01&to=2026-12-31`, [vendorA])).status).toBe(400);
    const csv = await as(`/vendor/reports/participation.csv${Q}`, [vendorA]);
    expect(csv.status).toBe(200);
    expect(csv.text).toContain('"Registrations","Hall bookings","","orders","2"');
    expect(csv.text).not.toContain("Secret");
    expect(await db.prepare(`SELECT id FROM audit_log WHERE actor_user_id = ? AND action = 'report.participation_exported'`).get(vendorA)).toBeTruthy();
  });
});

describe("Phase L — answers export", () => {
  it("includes exportable answers the policy allows, never contact details; audited", async () => {
    const csv = await as(`/vendor/forms/club/${clubId}/answers.csv`, [vendorA]);
    expect(csv.status).toBe(200);
    const [header, row] = csv.text.split("\r\n");
    expect(header).toBe('"Reference","Status","Person","Adult or child","Kit size"');
    expect(row).toContain('"Medium"');
    expect(csv.text).not.toContain("0861234567");
    expect(csv.text).not.toContain("Shirt name");
    expect(await db.prepare(`SELECT id FROM audit_log WHERE actor_user_id = ? AND action = 'club.answers_exported'`).get(vendorA)).toBeTruthy();
  });

  it("finance, other managers and other organisations can't export answers", async () => {
    expect((await as(`/vendor/forms/club/${clubId}/answers.csv`, [vendorA], "finance")).status).toBe(403);
    expect((await as(`/vendor/forms/club/${clubId}/answers.csv`, [vendorA], "centre_manager")).status).toBe(403);
    expect((await as(`/vendor/forms/club/${clubId}/answers.csv`, [vendorB])).status).toBe(403);
  });
});
