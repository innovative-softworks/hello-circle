import crypto from "node:crypto";
import http, { type Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, setSetting } from "../db/index.js";
import { orderFormsRouter } from "../routes/orderForms.js";
import { cleanQuestionSet, replaceQuestions } from "./questions.js";
import { questionsVersion } from "./questions.js";

// Phase I (docs/participation-expansion/20) — a resident's registration on
// their own club registration, programme enrolment and hall booking: read,
// form version, locked answers, missing answers, edit windows, ownership,
// audit and the partner's notice. Real router, isolated MySQL.

const run = crypto.randomUUID().slice(0, 8);
const id = (k: string) => `t-${k}-or-${run}`;
const vendor = id("vendor");
const org = id("org");
const clubId = id("club");
const centreId = id("centre");
const programId = id("program");
const mine = id("client-mine");
const other = id("client-other");
const regRef = `CR-OR-${run}`;
const cancelledRef = `CR-ORX-${run}`;
const progRef = `PR-OR-${run}`;
const hallRef = `HB-OR-${run}`;
const pastHallRef = `HB-ORP-${run}`;
const future = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10);
let server: Server;
let base: string;

const call = async (method: string, path: string, client: string, body?: unknown, verifiedEmail?: string) => {
  const r = await fetch(`${base}${path}`, { method, headers: { "Content-Type": "application/json", "X-Client-Id": client, ...(verifiedEmail ? { "X-Test-Email": verifiedEmail } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: (await r.json()) as any };
};
const ask = (o: Record<string, unknown>) => ({ scope: "booking", inputType: "text", label: "Anything else?", purpose: "To plan", required: false, ...o });
async function publish(listingType: "club" | "program" | "centre", listingId: string, qs: unknown[]) {
  return replaceQuestions(listingId, cleanQuestionSet(qs, false, undefined, listingType), await questionsVersion(listingId, db, listingType), vendor, listingType);
}
async function answer(source: string, ref: string, version: number, rows: [number, string, string, string][]) {
  for (const [no, key, label, value] of rows) {
    await db.prepare(`INSERT INTO registration_answers (source_type, source_ref, attendee_no, question_id, qkey, questions_version, label_snapshot, input_type_snapshot, value_text) VALUES (?, ?, ?, 'q', ?, ?, ?, 'text', ?)`).run(source, ref, no, key, version, label, value);
  }
}

beforeAll(async () => {
  await setSetting("participation.attendees", "true");
  await db.prepare(`INSERT INTO organisations (id, name, kind) VALUES (?, 'OR org', 'vendor')`).run(org);
  await db.prepare(`INSERT INTO users (id, email, password_hash, role, status, name, org_id) VALUES (?, ?, 'x', 'vendor', 'approved', 'OR', ?)`).run(vendor, `${vendor}@example.test`, org);
  await db.prepare(`INSERT INTO clubs (id, name, sport, area, county, ages, price, unit, trial, ph, image_url, blurb, vendor_id, status) VALUES (?, 'OR Club', 'x', 'a', 'Dublin', '5-12', 0, 'year', 0, '', '', '', ?, 'approved')`).run(clubId, vendor);
  await db.prepare(`INSERT INTO centres (id, name, area, county, rating, reviews, capacity, from_price, managed_by, ph, image_url, blurb, vendor_id, status) VALUES (?, 'OR Hall', 'Area', 'Dublin', 0, 0, 20, 1000, 'Mgr', '', '', '', ?, 'approved')`).run(centreId, vendor);
  await db.prepare(`INSERT INTO programs (id, listing_type, listing_id, vendor_id, title, description, status, price_cents) VALUES (?, 'club', ?, ?, 'OR Course', '', 'published', 0)`).run(programId, clubId, vendor);
  await db.prepare(`INSERT INTO program_sessions (id, program_id, date, time) VALUES (?, ?, ?, '10:00'), (?, ?, ?, '10:00')`).run(id("s1"), programId, future(-3), id("s2"), programId, future(20));
  for (const [ref, status] of [[regRef, "confirmed"], [cancelledRef, "cancelled"]]) {
    await db
      .prepare(`INSERT INTO registrations (ref, client_id, club_id, team, child_first, child_last, dob, g_first, g_last, email, phone, address, ec_name, ec_phone, ec_rel, medical, consent, trial, total_cents, payment_status, status) VALUES (?, ?, ?, 'U10', 'Aoife', 'OR', '2016-01-01', 'G', 'P', 'or@example.test', '0', 'A', 'E', '0', 'P', '', 1, 0, 0, 'paid', ?)`)
      .run(ref, mine, clubId, status);
  }
  await db.prepare(`INSERT INTO program_enrollments (ref, program_id, client_id, participant_name, participant_dob, email, phone, total_cents, payment_status, status) VALUES (?, ?, ?, 'Cian OR', '2015-05-05', 'or@example.test', '', 0, 'paid', 'confirmed')`).run(progRef, programId, mine);
  for (const [ref, date] of [[hallRef, future(10)], [pastHallRef, future(-2)]]) {
    await db.prepare(`INSERT INTO bookings (ref, client_id, centre_id, room_id, date, time, duration, event_type, guests, name, email, phone, notes, total_cents, payment_status) VALUES (?, ?, ?, 'r1', ?, '10:00', 1, 'Party', 4, 'OR Booker', 'or@example.test', '0', '', 0, 'paid')`).run(ref, mine, centreId, date);
  }
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const e = req.header("X-Test-Email");
    if (e) (req as any).guestEmail = e;
    next();
  });
  app.use("/api/orders", orderFormsRouter);
  server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, r));
  const a = server.address();
  if (!a || typeof a === "string") throw new Error("bind");
  base = `http://127.0.0.1:${a.port}`;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  await setSetting("participation.attendees", "false");
  const refs = [regRef, cancelledRef, progRef, hallRef, pastHallRef];
  for (const r of refs) {
    await db.prepare(`DELETE FROM registration_answers WHERE source_ref = ?`).run(r);
    await db.prepare(`DELETE FROM audit_log WHERE object_id = ?`).run(r);
    await db.prepare(`DELETE FROM notifications WHERE ref = ?`).run(r);
  }
  for (const lid of [clubId, centreId, programId]) await db.prepare(`DELETE FROM registration_questions WHERE listing_id = ?`).run(lid);
  await db.prepare(`DELETE FROM registrations WHERE club_id = ?`).run(clubId);
  await db.prepare(`DELETE FROM bookings WHERE centre_id = ?`).run(centreId);
  await db.prepare(`DELETE FROM program_enrollments WHERE program_id = ?`).run(programId);
  await db.prepare(`DELETE FROM program_sessions WHERE program_id = ?`).run(programId);
  await db.prepare(`DELETE FROM programs WHERE id = ?`).run(programId);
  await db.prepare(`DELETE FROM centres WHERE id = ?`).run(centreId);
  await db.prepare(`DELETE FROM clubs WHERE id = ?`).run(clubId);
  await db.prepare(`DELETE FROM users WHERE id = ?`).run(vendor);
  await db.prepare(`DELETE FROM organisations WHERE id = ?`).run(org);
});

describe("Phase I — a resident's registration", () => {
  it("someone else's booking reads as not found, for every type", async () => {
    for (const [s, r] of [["registration", regRef], ["program", progRef], ["booking", hallRef]]) {
      expect((await call("GET", `/api/orders/${s}/${r}/registration`, other)).status).toBe(404);
      expect((await call("PUT", `/api/orders/${s}/${r}/answers`, other, { answers: {}, questionsVersion: 0 })).status).toBe(404);
      expect((await call("GET", `/api/orders/${s}/${r}/registration`, mine)).status).toBe(200);
    }
    // Same rule as the "my …" lists: a signed-in resident's verified email finds their club and hall bookings
    // from another device; programmes match by device or resident only.
    expect((await call("GET", `/api/orders/registration/${regRef}/registration`, other, undefined, "OR@example.test")).status).toBe(200);
    expect((await call("GET", `/api/orders/booking/${hallRef}/registration`, other, undefined, "or@example.test")).status).toBe(200);
    expect((await call("GET", `/api/orders/program/${progRef}/registration`, other, undefined, "or@example.test")).status).toBe(404);
    expect((await call("GET", `/api/orders/registration/${regRef}/registration`, other, undefined, "someone@example.test")).status).toBe(404);
    // A reference of one type can't be read as another.
    expect((await call("GET", `/api/orders/booking/${regRef}/registration`, mine)).status).toBe(404);
    expect((await call("GET", `/api/orders/game/${regRef}/registration`, mine)).status).toBe(404);
  });

  it("shows the club registrant, answers as given with their version, a locked answer and what's missing", async () => {
    const v1 = await publish("club", clubId, [ask({ key: "q_hearxx", label: "How did you hear about us?" }), ask({ key: "q_kitsize", scope: "attendee", inputType: "select", label: "Kit size", choices: ["S", "M"], appliesTo: "child", editability: "locked" })]);
    await answer("registration", regRef, v1.version, [[0, "q_hearxx", "How did you hear about us?", "A friend"], [1, "q_kitsize", "Kit size", "M"]]);
    // A later version adds a required question the registrant hasn't answered.
    const v2 = await publish("club", clubId, [ask({ key: "q_hearxx", label: "How did you hear about us?" }), ask({ key: "q_kitsize", scope: "attendee", inputType: "select", label: "Kit size", choices: ["S", "M"], appliesTo: "child", editability: "locked" }), ask({ key: "q_shirtxx", label: "Shirt name", required: true })]);
    const r = (await call("GET", `/api/orders/registration/${regRef}/registration`, mine)).body;
    expect(r.attendees).toMatchObject([{ attendeeNo: 1, name: "Aoife OR", personType: "child" }]);
    expect(r.answeredVersions).toEqual([v1.version]);
    expect(r.questionsVersion).toBe(v2.version);
    expect(r.lockedAnswers).toEqual([{ key: "q_kitsize", attendeeNo: 1 }]);
    expect(r.missingAnswers).toEqual(["Shirt name"]);
    expect(r.canEditAnswers).toBe(true);
    expect(r.attendance).toMatchObject({ kind: "order", status: null });
  });

  it("changes answers on the live form, keeps a locked answer as given, audits keys only and tells the partner", async () => {
    const r = (await call("GET", `/api/orders/registration/${regRef}/registration`, mine)).body;
    expect((await call("PUT", `/api/orders/registration/${regRef}/answers`, mine, { answers: { booking: { q_hearxx: "Poster" } }, questionsVersion: r.questionsVersion - 1 })).body.code).toBe("questions_changed");
    expect((await call("PUT", `/api/orders/registration/${regRef}/answers`, mine, { answers: { booking: { q_hearxx: "Poster" } }, questionsVersion: r.questionsVersion })).status).toBe(400);
    const saved = await call("PUT", `/api/orders/registration/${regRef}/answers`, mine, { answers: { booking: { q_hearxx: "Poster", q_shirtxx: "AOIFE" }, attendees: [{ q_kitsize: "S" }] }, questionsVersion: r.questionsVersion });
    expect(saved.status).toBe(200);
    const byKey = Object.fromEntries(saved.body.answers.map((a: { key: string; value: string; version: number }) => [a.key, [a.value, a.version]]));
    expect(byKey).toEqual({ q_hearxx: ["Poster", r.questionsVersion], q_shirtxx: ["AOIFE", r.questionsVersion], q_kitsize: ["M", r.questionsVersion - 1] });
    expect(saved.body.missingAnswers).toEqual([]);
    const audit = (await db.prepare(`SELECT action, new_value AS v FROM audit_log WHERE object_id = ? ORDER BY id DESC LIMIT 1`).get(regRef)) as { action: string; v: string };
    expect(audit.action).toBe("registration.answers_edited");
    expect(audit.v).not.toContain("Poster");
    const note = (await db.prepare(`SELECT recipient_id AS r, title, body FROM notifications WHERE ref = ? ORDER BY id DESC LIMIT 1`).get(regRef)) as { r: string; title: string; body: string };
    expect(note.r).toBe(vendor);
    expect(note.title).toMatch(/Registration answers updated/);
    expect(note.body).not.toContain("Poster");
  });

  it("a cancelled registration and a past hall booking can't be changed", async () => {
    await answer("registration", cancelledRef, 1, [[0, "q_hearxx", "How did you hear about us?", "A friend"]]);
    const c = (await call("GET", `/api/orders/registration/${cancelledRef}/registration`, mine)).body;
    expect(c.canEditAnswers).toBe(false);
    expect(c.editNote).toMatch(/cancelled/);
    expect((await call("PUT", `/api/orders/registration/${cancelledRef}/answers`, mine, { answers: {}, questionsVersion: c.questionsVersion })).body.code).toBe("not_editable");
    await publish("centre", centreId, [ask({ key: "q_kitchenxx", label: "Kitchen needed?" })]);
    const past = (await call("GET", `/api/orders/booking/${pastHallRef}/registration`, mine)).body;
    expect(past.canEditAnswers).toBe(false);
    expect(past.editNote).toMatch(/started/);
    expect(past.attendees).toEqual([]);
  });

  it("a hall booking's answers are once per booking; a programme shows its sessions", async () => {
    const h = (await call("GET", `/api/orders/booking/${hallRef}/registration`, mine)).body;
    expect(h.canEditAnswers).toBe(true);
    const saved = await call("PUT", `/api/orders/booking/${hallRef}/answers`, mine, { answers: { booking: { q_kitchenxx: "Yes" } }, questionsVersion: h.questionsVersion });
    expect(saved.body.answers).toMatchObject([{ attendeeNo: 0, key: "q_kitchenxx", value: "Yes" }]);
    const p = (await call("GET", `/api/orders/program/${progRef}/registration`, mine)).body;
    expect(p.attendees).toMatchObject([{ name: "Cian OR", personType: "child" }]);
    expect(p.attendance).toMatchObject({ kind: "sessions", sessionsAttended: 0, sessionsTotal: 1 });
  });
});
