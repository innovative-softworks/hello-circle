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
    // A legacy booking for 2 (no attendee rows) with one person checked in at the door.
    expect(att["Event bookings"]).toMatchObject({ unit: "bookings", expected: 1, attended: 1, noShow: 0, unmarked: 0 });
    expect(att["Event attendees"]).toMatchObject({ unit: "people", expected: 2, attended: 1, noShow: 0, unmarked: 1 });
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

describe("Phase L — report detail and filters", () => {
  it("per listing, trend, check-ins and repeat people — filtered to one listing, and never another organisation's", async () => {
    const all = (await json(`/vendor/reports/participation/detail${Q}`, [vendorA])).body;
    const titles = all.perListing.map((p: { title: string }) => p.title).sort();
    expect(titles).toEqual(["RP Club", "RP Event", "RP Hall"]);
    const event = all.perListing.find((p: { title: string }) => p.title === "RP Event");
    expect(event).toMatchObject({ orders: 1, people: 2, attended: 1 });
    expect(all.overTime.reduce((a: number, w: { total: number }) => a + w.total, 0)).toBe(4);
    expect(all.checkins.reduce((a: number, d: { count: number }) => a + d.count, 0)).toBeGreaterThanOrEqual(2);
    // The same email booked the hall, the club and the event: one person, returning.
    expect(all.repeat).toEqual({ people: 1, returning: 1 });
    const hall = (await json(`/vendor/reports/participation/detail${Q}&listingType=centre&listingId=${centreId}`, [vendorA])).body;
    expect(hall.perListing).toEqual([expect.objectContaining({ title: "RP Hall", orders: 2, cancelled: 1, attended: 1 })]);
    const foreign = (await json(`/vendor/reports/participation/detail${Q}&listingId=${centreId}`, [vendorB])).body;
    expect(foreign.perListing).toEqual([]);
    expect(JSON.stringify(all)).not.toMatch(/secret@|Secret Booker|Medium/);
  });
});

// Pilot remediation (final-validation/14): event no-shows counted as bookings and
// as people, from per-person evidence. A deterministic organisation C, with the
// expected numbers worked out by hand below; organisation D is the other tenant.
describe("Event attendance — bookings and people", () => {
  const vendorC = id("vendorC");
  const vendorD = id("vendorD");
  const evC = id("evC");
  const evD = id("evD");
  const past = id("past");
  const future = id("future");
  const gone = id("gone");
  const pastD = id("pastD");
  const R = (k: string) => `EV-${k}-${run}`;
  const refs = ["B1", "B2", "B3", "B4", "B5", "B6", "B7", "B8", "D1"].map(R);
  const booking = async (ref: string, exp: string, sess: string, party: number, status = "confirmed") =>
    db.prepare(`INSERT INTO experience_bookings (ref, experience_id, session_id, client_id, participant_name, email, phone, party_size, total_cents, payment_status, status) VALUES (?, ?, ?, 'c', 'Synthetic', 'ev@example.test', '', ?, 0, 'paid', ?)`).run(ref, exp, sess, party, status);
  const people = async (ref: string, n: number, removed: number[] = []) => {
    for (let i = 1; i <= n; i++) await db.prepare(`INSERT INTO booking_attendees (source_type, source_ref, attendee_no, name, status) VALUES ('experience', ?, ?, ?, ?)`).run(ref, i, `P${i}`, removed.includes(i) ? "removed" : "active");
  };
  const checkin = async (ref: string, no: number, sess: string) => {
    await db.prepare(`INSERT INTO attendee_checkins (source_type, source_ref, attendee_no, session_id, checked_in_by) VALUES ('experience', ?, ?, ?, ?)`).run(ref, no, sess, vendorC);
    // The door also writes the booking-level mark (as checkin.ts does).
    await db.prepare(`INSERT INTO attendance (kind, ref, status, source) VALUES ('experience', ?, 'present', 'door') ON DUPLICATE KEY UPDATE status = 'present'`).run(ref);
  };
  const mark = (ref: string, status: string, source = "host_manual") => db.prepare(`INSERT INTO attendance (kind, ref, status, source) VALUES ('experience', ?, ?, ?)`).run(ref, status, source);

  beforeAll(async () => {
    for (const v of [vendorC, vendorD]) await db.prepare(`INSERT INTO users (id, email, password_hash, role, status, name) VALUES (?, ?, 'x', 'vendor', 'approved', 'EV')`).run(v, `${v}@example.test`);
    for (const [e, v] of [[evC, vendorC], [evD, vendorD]]) {
      await db.prepare(`INSERT INTO experiences (id, vendor_id, kind, title, blurb, description, fitness_requirements, itinerary, equipment_provided, equipment_required, transport_info, safety_info, weather_policy, eligibility, cancellation_terms, status, capacity, price_cents, payment_method) VALUES (?, ?, 'event', 'EV Event', 'b', 'd', '', '', '', '', '', '', '', '', '', 'approved', 20, 0, 'cash')`).run(e, v);
    }
    for (const [sid, e, d, st] of [[past, evC, day(-3), "scheduled"], [future, evC, day(5), "scheduled"], [gone, evC, day(-4), "cancelled"], [pastD, evD, day(-3), "scheduled"]] as const) {
      await db.prepare(`INSERT INTO experience_sessions (id, experience_id, date, time, capacity, status) VALUES (?, ?, ?, '10:00', 20, ?)`).run(sid, e, d, st);
    }
    // B1 single attendee, checked in.
    await booking(R("B1"), evC, past, 1); await people(R("B1"), 1); await checkin(R("B1"), 1, past);
    // B2 group of 3: person 3 removed (cancelled attendee), person 1 checked in, person 2 not.
    await booking(R("B2"), evC, past, 3); await people(R("B2"), 3, [3]); await checkin(R("B2"), 1, past);
    // B3 group of 2 marked "didn't come".
    await booking(R("B3"), evC, past, 2); await people(R("B3"), 2); await mark(R("B3"), "no_show");
    // B4 cancelled booking, marked no-show before it was cancelled: left out.
    await booking(R("B4"), evC, past, 2, "cancelled"); await people(R("B4"), 2); await mark(R("B4"), "no_show");
    // B5 upcoming session: left out even with a stray mark.
    await booking(R("B5"), evC, future, 2); await people(R("B5"), 2); await mark(R("B5"), "no_show");
    // B6 legacy booking for 2 (no attendee rows), marked present by the organiser, no door check-in.
    await booking(R("B6"), evC, past, 2); await mark(R("B6"), "present");
    // B7 legacy booking for 1, nothing recorded.
    await booking(R("B7"), evC, past, 1);
    // B8 on a cancelled session (booking itself not cancelled): left out.
    await booking(R("B8"), evC, gone, 2); await people(R("B8"), 2); await mark(R("B8"), "no_show");
    // D1 another organisation's no-show.
    await booking(R("D1"), evD, pastD, 4); await people(R("D1"), 4); await mark(R("D1"), "no_show");
  });

  afterAll(async () => {
    for (const r of refs) {
      await db.prepare(`DELETE FROM attendee_checkins WHERE source_ref = ?`).run(r);
      await db.prepare(`DELETE FROM attendance WHERE ref = ?`).run(r);
      await db.prepare(`DELETE FROM booking_attendees WHERE source_ref = ?`).run(r);
    }
    await db.prepare(`DELETE FROM experience_bookings WHERE experience_id IN (?, ?)`).run(evC, evD);
    await db.prepare(`DELETE FROM experience_sessions WHERE experience_id IN (?, ?)`).run(evC, evD);
    await db.prepare(`DELETE FROM experiences WHERE id IN (?, ?)`).run(evC, evD);
    await db.prepare(`DELETE FROM audit_log WHERE actor_user_id IN (?, ?)`).run(vendorC, vendorD);
    await db.prepare(`DELETE FROM users WHERE id IN (?, ?)`).run(vendorC, vendorD);
  });

  // By hand: counted bookings B1, B2, B3, B6, B7 (B4 cancelled, B5 upcoming, B8 cancelled session).
  // Bookings: attended B1, B2 (check-ins), B6 (marked present) = 3; no-show B3 = 1; not recorded B7 = 1.
  // People: expected 1 + 2 (B2 minus removed) + 2 + 2 + 1 = 8; attended B1·1 + B2·1 = 2; no-show B3·2 = 2;
  // not recorded B2·1 + B6·2 + B7·1 = 4, of which 2 on a booking marked present.
  const BOOKINGS = { expected: 5, attended: 3, noShow: 1, unmarked: 1 };
  const PEOPLE = { expected: 8, attended: 2, noShow: 2, unmarked: 4, markedPresentNotRecorded: 2 };

  it("summary: bookings and people are counted separately, from per-person evidence", async () => {
    const r = (await json(`/vendor/reports/participation${Q}`, [vendorC])).body;
    const att = Object.fromEntries(r.attendance.map((t: { type: string }) => [t.type, t]));
    expect(att["Event bookings"]).toMatchObject({ unit: "bookings", ...BOOKINGS });
    expect(att["Event attendees"]).toMatchObject({ unit: "people", ...PEOPLE });
    expect(r.definitions.join(" ")).toMatch(/not recorded/);
  });

  it("the per-listing result and the check-ins by day agree with the summary (no double count of door check-ins)", async () => {
    const d = (await json(`/vendor/reports/participation/detail${Q}&listingType=experience&listingId=${evC}`, [vendorC])).body;
    expect(d.perListing).toEqual([expect.objectContaining({ title: "EV Event", unit: "people", expected: 8, attended: 2, noShow: 2, notRecorded: 4 })]);
    // Door check-ins B1·1 + B2·1, plus B6's organiser mark (no door check-in): 3, not 5.
    expect(d.checkins.reduce((a: number, c: { count: number }) => a + c.count, 0)).toBe(3);
  });

  it("the CSV carries the same numbers with their unit, and the definitions", async () => {
    const csv = (await as(`/vendor/reports/participation.csv${Q}`, [vendorC])).text;
    expect(csv).toContain('"Attendance","Event bookings","","no-show bookings","1"');
    expect(csv).toContain('"Attendance","Event attendees","","no-show people","2"');
    expect(csv).toContain('"Attendance","Event attendees","","not recorded people","4"');
    expect(csv).toContain('"Attendance","Event attendees","","of not recorded: on a booking marked present","2"');
    expect(csv).toMatch(/"Definition","Attendance","","",".*didn't come/);
  });

  it("another organisation's bookings never count, and it sees none of these", async () => {
    const d = (await json(`/vendor/reports/participation${Q}`, [vendorD])).body;
    const att = Object.fromEntries(d.attendance.map((t: { type: string }) => [t.type, t]));
    expect(att["Event bookings"]).toMatchObject({ expected: 1, attended: 0, noShow: 1, unmarked: 0 });
    expect(att["Event attendees"]).toMatchObject({ expected: 4, attended: 0, noShow: 4, unmarked: 0 });
    const foreign = (await json(`/vendor/reports/participation/detail${Q}&listingId=${evC}`, [vendorD])).body;
    expect(foreign.perListing).toEqual([]);
  });
});
