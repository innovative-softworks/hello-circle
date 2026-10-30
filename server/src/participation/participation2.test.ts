import crypto from "node:crypto";
import http, { type Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db, setSetting } from "../db/index.js";
import { experiencesRouter } from "../routes/experiences.js";
import { vendorRouter } from "../routes/vendor.js";
import { LockedFeatureError, setFeature } from "../circleFeatures.js";
import { irelandTodayIso } from "../irelandTime.js";
import { cleanAttendees, reconcile, slotsForResolved, AttendeeError, type Attendee } from "./attendees.js";
import { cleanQuestionSet, specialCategoryOf, QuestionError } from "./questions.js";
import { admitVerdict } from "./checkin.js";

// Participation Phase 2 — attendees, registration questions and door check-in
// (docs/participation-expansion/12 §7). The real vendor router is mounted at
// /api/vendor, so requireVendor (suspension, removed staff, the check-in-only
// allow-list) and attachVendorIds run as in production; the test only
// stands in for attachUser / attachResident. Real isolated MySQL, cash
// listing (no payment provider involved).

const run = crypto.randomUUID().slice(0, 8);
const orgId = `t-org-p2-${run}`;
const otherOrgId = `t-org2-p2-${run}`;
const id = (k: string) => `t-${k}-p2-${run}`;
const U = {
  owner: id("owner"),
  manager: id("manager"),
  finance: id("finance"),
  comms: id("comms"),
  analyst: id("analyst"),
  doorA: id("doorA"),
  doorB: id("doorB"),
  other: id("other"),
};
const eventId = id("event");
const otherEventId = id("otherevent");
const sessToday = id("sToday");
const sessFuture = id("sFuture");
const otherSess = id("sOther");
const clientId = id("client");
const otherClient = id("client2");
const residentId = id("res");
const otherResident = id("res2");
const refs: string[] = [];
let server: Server;
let base: string;
const opt: Record<string, string> = {};
const qk: Record<string, string> = {};
let qVersion = 0;
let mainRef = "";

const SWITCHES = ["participation.events", "participation.options", "participation.attendees", "participation.checkin", "participation.special_category_questions", "participation.partial_cancel"];
const switches = async (on: Record<string, boolean>) => {
  for (const [k, v] of Object.entries(on)) await setSetting(k, v ? "true" : "false");
};
const one = async <T = any>(sql: string, ...p: unknown[]) => (await db.prepare(sql).get(...p)) as T;
const all = async <T = any>(sql: string, ...p: unknown[]) => (await db.prepare(sql).all(...p)) as T[];
const future = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

type Who = keyof typeof U | "removed" | "suspendedDoor" | null;
interface CallOpts {
  who?: Who;
  client?: string;
  resident?: string;
}
async function call(method: string, path: string, body?: unknown, o: CallOpts = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-Client-Id": o.client ?? clientId,
      ...(o.who ? { "X-Test-User": o.who } : {}),
      ...(o.resident ? { "X-Test-Resident": o.resident } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, body: json, text };
}

function userFor(who: string) {
  const base = { role: "vendor", status: "approved", name: who, businessName: "KNOTS QA", email: `${who}@example.test`, orgStatus: "active" };
  switch (who) {
    case "owner": return { ...base, id: U.owner, orgId, invitedStaff: false, platformRole: null };
    case "manager": return { ...base, id: U.manager, orgId, invitedStaff: true, platformRole: "centre_manager" };
    case "finance": return { ...base, id: U.finance, orgId, invitedStaff: true, platformRole: "finance" };
    case "comms": return { ...base, id: U.comms, orgId, invitedStaff: true, platformRole: "communications" };
    case "analyst": return { ...base, id: U.analyst, orgId, invitedStaff: true, platformRole: "read_only_analyst" };
    case "doorA": return { ...base, id: U.doorA, orgId, invitedStaff: true, platformRole: "checkin_staff" };
    case "doorB": return { ...base, id: U.doorB, orgId, invitedStaff: true, platformRole: "checkin_staff" };
    case "suspendedDoor": return { ...base, id: U.doorA, orgId, invitedStaff: true, platformRole: "checkin_staff", orgStatus: "suspended" };
    case "removed": return { ...base, id: U.doorA, orgId: null, invitedStaff: true, platformRole: "checkin_staff" };
    case "other": return { ...base, id: U.other, orgId: otherOrgId, invitedStaff: false, platformRole: null };
  }
  return null;
}

async function book(sessionId: string, extra: Record<string, unknown>, o: CallOpts = {}) {
  const r = await call("POST", `/api/experiences/${eventId}/sessions/${sessionId}/checkout`, { participantName: "Asha QA", email: "qa_p2@example.test", acceptedTerms: true, ...extra }, o);
  if (r.body?.ref) refs.push(r.body.ref);
  return r;
}

async function insertBooking(ref: string, session: string, f: { party: number; status?: string; payment?: string; name?: string; seats?: string[]; experience?: string }) {
  refs.push(ref);
  await db
    .prepare(`INSERT INTO experience_bookings (ref, experience_id, session_id, client_id, participant_name, email, party_size, total_cents, payment_status, status) VALUES (?, ?, ?, ?, ?, 'legacy@example.test', ?, 2000, ?, ?)`)
    .run(ref, f.experience ?? eventId, session, clientId, f.name ?? "Legacy Lee", f.party, f.payment ?? "paid", f.status ?? "confirmed");
  for (const [i, n] of (f.seats ?? []).entries()) await db.prepare(`INSERT INTO experience_booking_participants (booking_ref, seat, name) VALUES (?, ?, ?)`).run(ref, i + 1, n);
}

const QUESTIONS_V1 = () => [
  { scope: "booking", inputType: "select", label: "How did you hear about us?", purpose: "To plan next year's publicity", choices: ["Friend", "WhatsApp", "Other"], required: true },
  { scope: "attendee", inputType: "text", label: "Name on badge", purpose: "Printed on your name badge", required: false, doorVisible: true },
  { scope: "attendee", appliesTo: "child", inputType: "number", label: "Age", purpose: "To group children for activities", min: 0, max: 17, required: true },
];

function knotsBooking(extra: Record<string, unknown> = {}) {
  return {
    lines: [{ optionId: opt.adult, quantity: 2 }, { optionId: opt.child, quantity: 1 }],
    attendees: [{ name: "Asha QA" }, { name: "Ravi QA" }, { name: "Mira QA", guardian: 1 }],
    answers: { booking: { [qk.heard]: "Friend" }, attendees: [{ [qk.badge]: "Asha R" }, {}, { [qk.age]: 7 }] },
    questionsVersion: qVersion,
    ...extra,
  };
}

beforeAll(async () => {
  await switches(Object.fromEntries(SWITCHES.map((k) => [k, false])));
  await switches({ "participation.events": true, "participation.options": true, "participation.attendees": true, "participation.checkin": true });
  await db.prepare(`INSERT INTO organisations (id, name, kind) VALUES (?, 'KNOTS P2 QA', 'vendor'), (?, 'Other P2 QA', 'vendor')`).run(orgId, otherOrgId);
  const insertUser = `INSERT INTO users (id, email, password_hash, role, status, name, org_id, invited_staff, platform_role) VALUES (?, ?, 'x', 'vendor', 'approved', ?, ?, ?, ?)`;
  for (const [k, uid] of Object.entries(U)) {
    const u = userFor(k)!;
    await db.prepare(insertUser).run(uid, `${uid}@example.test`, k, u.orgId, u.invitedStaff ? 1 : 0, u.platformRole);
  }
  await db.prepare(`INSERT INTO residents (id, email, name) VALUES (?, ?, 'Res QA'), (?, ?, 'Res2 QA')`).run(residentId, `${residentId}@example.test`, otherResident, `${otherResident}@example.test`);
  const insertExp = `INSERT INTO experiences (id, vendor_id, kind, title, blurb, description, fitness_requirements, itinerary, equipment_provided, equipment_required, transport_info, safety_info, weather_policy, eligibility, cancellation_terms, status, capacity, price_cents, payment_method)
                     VALUES (?, ?, 'event', ?, 'Blurb', 'Description', '', '', '', '', '', '', '', '', '', 'approved', 100, 1000, 'cash')`;
  await db.prepare(insertExp).run(eventId, U.owner, "Vratham P2 QA");
  await db.prepare(insertExp).run(otherEventId, U.other, "Other org event P2 QA");
  for (const [sid, exp, date] of [[sessToday, eventId, irelandTodayIso()], [sessFuture, eventId, future(20)], [otherSess, otherEventId, irelandTodayIso()]]) {
    await db.prepare(`INSERT INTO experience_sessions (id, experience_id, date, time) VALUES (?, ?, ?, '23:59')`).run(sid, exp, date);
  }

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const who = req.header("X-Test-User");
    if (who) (req as any).user = userFor(who) ?? undefined;
    const res = req.header("X-Test-Resident");
    if (res) (req as any).resident = { id: res, email: `${res}@example.test` };
    next();
  });
  app.use("/api/experiences", experiencesRouter);
  app.use("/api/vendor", vendorRouter);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("bind");
  base = `http://127.0.0.1:${address.port}`;

  const saved = await call("PUT", `/api/vendor/experiences/${eventId}/options`, {
    version: 0,
    options: [
      { kind: "option", label: "Adult", description: "", priceMinor: 1000, priceBasis: "per_person", ageBand: "adult" },
      { kind: "option", label: "Child", description: "", priceMinor: 500, priceBasis: "per_person", ageBand: "child" },
    ],
  }, { who: "owner" });
  expect(saved.status).toBe(200);
  for (const o of saved.body.options) opt[o.label === "Adult" ? "adult" : "child"] = o.id;
});

beforeEach(async () => {
  await switches({ "participation.events": true, "participation.options": true, "participation.attendees": true, "participation.checkin": true });
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await switches(Object.fromEntries(SWITCHES.map((k) => [k, false])));
  const ph = refs.map(() => "?").join(",") || "''";
  for (const t of ["order_lines", "order_acknowledgements", "booking_attendees", "registration_answers", "attendee_checkins"]) await db.prepare(`DELETE FROM ${t} WHERE source_ref IN (${ph})`).run(...refs);
  await db.prepare(`DELETE FROM attendance WHERE kind = 'experience' AND ref IN (${ph})`).run(...refs);
  await db.prepare(`DELETE FROM experience_booking_participants WHERE booking_ref IN (${ph})`).run(...refs);
  await db.prepare(`DELETE FROM commerce_orders WHERE source_ref IN (${ph})`).run(...refs);
  await db.prepare(`DELETE FROM notifications WHERE listing_id IN (?, ?)`).run(eventId, otherEventId);
  await db.prepare(`DELETE FROM experience_bookings WHERE experience_id IN (?, ?)`).run(eventId, otherEventId);
  await db.prepare(`DELETE FROM offering_options WHERE listing_id IN (?, ?)`).run(eventId, otherEventId);
  await db.prepare(`DELETE FROM registration_questions WHERE listing_id IN (?, ?)`).run(eventId, otherEventId);
  await db.prepare(`DELETE FROM listing_staff_assignments WHERE listing_id IN (?, ?)`).run(eventId, otherEventId);
  await db.prepare(`DELETE FROM experience_sessions WHERE experience_id IN (?, ?)`).run(eventId, otherEventId);
  await db.prepare(`DELETE FROM experiences WHERE id IN (?, ?)`).run(eventId, otherEventId);
  await db.prepare(`DELETE FROM audit_log WHERE object_id IN (${ph}) OR object_id IN (?, ?)`).run(...refs, eventId, otherEventId);
  await db.prepare(`DELETE FROM users WHERE id IN (${Object.values(U).map(() => "?").join(",")})`).run(...Object.values(U));
  await db.prepare(`DELETE FROM organisations WHERE id IN (?, ?)`).run(orgId, otherOrgId);
  await db.prepare(`DELETE FROM residents WHERE id IN (?, ?)`).run(residentId, otherResident);
});

// --- pure rules --------------------------------------------------------------------

describe("attendee and question rules", () => {
  const slots = slotsForResolved(
    { heads: 3, listMinor: 0, key: "", lines: [
      { lineNo: 1, quantity: 2, heads: 2, unitMinor: 0, totalMinor: 0, option: { id: "a", kind: "option", label: "Adult", ageBand: "adult" } as never },
      { lineNo: 2, quantity: 1, heads: 1, unitMinor: 0, totalMinor: 0, option: { id: "c", kind: "option", label: "Child", ageBand: "child" } as never },
      { lineNo: 3, quantity: 1, heads: 0, unitMinor: 0, totalMinor: 0, option: { id: "x", kind: "addon", label: "Flowers", ageBand: null } as never },
    ] },
    3
  );
  const err = (raw: unknown) => {
    try {
      cleanAttendees(raw, slots);
      return null;
    } catch (e) {
      return e instanceof AttendeeError ? e.message : String(e);
    }
  };
  it("gives one slot per person from the option lines (add-ons carry nobody)", () => {
    expect(slots.map((s) => [s.lineNo, s.fixedType])).toEqual([[1, "adult"], [1, "adult"], [2, "child"]]);
  });
  it("requires a name each, the option's age band, and a guardian for every child", () => {
    expect(err([{ name: "A" }, { name: "B" }])).toMatch(/each of the 3/);
    expect(err([{ name: "A" }, { name: "" }, { name: "C", guardian: 1 }])).toMatch(/name for person 2/);
    expect(err([{ name: "A" }, { name: "B", personType: "child" }, { name: "C", guardian: 1 }])).toMatch(/for an adult/);
    expect(err([{ name: "A" }, { name: "B" }, { name: "C" }])).toMatch(/who looks after C/);
    expect(err([{ name: "A" }, { name: "B" }, { name: "C", guardian: 3 }])).toMatch(/Choose an adult/);
    const ok = cleanAttendees([{ name: "A" }, { name: "B" }, { name: "C", guardian: "contact" }], slots);
    expect(ok[2]).toMatchObject({ personType: "child", guardianKind: "contact", lineNo: 2 });
  });
  it("reconcile reports when people, party size and options disagree", () => {
    const p = (n: number, line: number): Attendee => ({ attendeeNo: n, lineNo: line, lineLabel: null, personType: "adult", name: "x", guardianKind: null, guardianAttendeeNo: null, guardianName: null, status: "active", recorded: true });
    const lines = [{ lineNo: 1, kind: "option", label: "Adult", heads: 2 }] as never;
    expect(reconcile([p(1, 1), p(2, 1)], 2, lines)).toEqual([]);
    expect(reconcile([p(1, 1)], 2, lines).length).toBeGreaterThan(0);
  });
  it("refuses special-category questions by category and by wording, needs a reason, and keeps the switch locked", async () => {
    const bad = (q: Record<string, unknown>) => {
      try {
        cleanQuestionSet([{ scope: "booking", inputType: "text", label: "Q", purpose: "Why", ...q }], false);
        return null;
      } catch (e) {
        return e instanceof QuestionError ? (e.code ?? e.message) : String(e);
      }
    };
    expect(bad({ label: "Any allergies?" })).toBe("special_category");
    expect(bad({ label: "Your gotra" })).toBe("special_category");
    expect(bad({ category: "religion" })).toBe("special_category");
    expect(bad({ purpose: "" })).toMatch(/why you're asking/);
    expect(bad({ inputType: "select", choices: ["Only one"] })).toMatch(/two choices/);
    expect(bad({ inputType: "date" })).toBeNull();
    expect(specialCategoryOf("T-shirt size")).toBeNull();
    expect(cleanQuestionSet([{ scope: "booking", inputType: "text", label: "Any allergies?", purpose: "Kitchen" }], true)).toHaveLength(1);
    await expect(setFeature("participation.special_category_questions", true)).rejects.toBeInstanceOf(LockedFeatureError);
  });
  it("admits only a paid, active booking on this date", () => {
    const s = { sessionId: "s", experienceId: "e", title: "", kind: "event", date: "2026-11-01", time: "10:00", status: "scheduled", vendorId: "v" };
    const b = { ref: "EX-1", sessionId: "s", participantName: "A", partySize: 1, status: "confirmed", paymentStatus: "paid", date: "2026-11-01", sessionStatus: "scheduled" };
    expect(admitVerdict(b, s, "2026-11-01").reason).toBe("ok");
    expect(admitVerdict({ ...b, status: "cancelled" }, s, "2026-11-01").reason).toBe("cancelled");
    expect(admitVerdict({ ...b, paymentStatus: "refunded" }, s, "2026-11-01").reason).toBe("refunded");
    expect(admitVerdict({ ...b, paymentStatus: "pending" }, s, "2026-11-01").reason).toBe("not_paid");
    expect(admitVerdict(b, s, "2026-10-31").reason).toBe("wrong_date");
    expect(admitVerdict({ ...b, sessionId: "other" }, s, "2026-11-01").reason).toBe("other_session");
  });
});

// --- questions + registration -----------------------------------------------------

describe("question builder and registration", () => {
  it("only the two managers and the owner save questions; others and residents can't", async () => {
    expect((await call("PUT", `/api/vendor/experiences/${eventId}/questions`, { version: 0, questions: QUESTIONS_V1() }, { who: "comms" })).status).toBe(403);
    expect((await call("PUT", `/api/vendor/experiences/${eventId}/questions`, { version: 0, questions: QUESTIONS_V1() }, { who: "finance" })).status).toBe(403);
    expect((await call("PUT", `/api/vendor/experiences/${eventId}/questions`, { version: 0, questions: QUESTIONS_V1() }, { who: "other" })).status).toBe(403);
    // #3 — a host (resident session only) can't change an event at all.
    expect((await call("PUT", `/api/vendor/experiences/${eventId}/questions`, { version: 0, questions: QUESTIONS_V1() }, { resident: residentId })).status).toBe(401);
    expect((await call("PUT", `/api/vendor/experiences/${eventId}/options`, { version: 1, options: [] }, { resident: residentId })).status).toBe(401);
    const doorTry = await call("PUT", `/api/vendor/experiences/${eventId}/questions`, { version: 0, questions: QUESTIONS_V1() }, { who: "doorA" });
    expect(doorTry.status).toBe(403);
    expect(doorTry.body.checkinOnly).toBe(true);
    const special = await call("PUT", `/api/vendor/experiences/${eventId}/questions`, { version: 0, questions: [...QUESTIONS_V1(), { scope: "attendee", inputType: "text", label: "Medical conditions", purpose: "Safety" }] }, { who: "manager" });
    expect(special.status).toBe(400);
    expect(special.body.code).toBe("special_category");

    const saved = await call("PUT", `/api/vendor/experiences/${eventId}/questions`, { version: 0, questions: QUESTIONS_V1() }, { who: "manager" });
    expect(saved.status).toBe(200);
    qVersion = saved.body.version;
    expect(qVersion).toBe(1);
    const [heard, badge, age] = saved.body.questions;
    Object.assign(qk, { heard: heard.key, badge: badge.key, age: age.key });
    expect((await call("PUT", `/api/vendor/experiences/${eventId}/questions`, { version: 0, questions: QUESTIONS_V1() }, { who: "manager" })).status).toBe(409);
    const detail = await call("GET", `/api/experiences/${eventId}`);
    expect(detail.body.registration.attendeeDetails.questionsVersion).toBe(1);
    expect(detail.body.registration.attendeeDetails.questions.map((q: { label: string }) => q.label)).toEqual(["How did you hear about us?", "Name on badge", "Age"]);
    expect(JSON.stringify(detail.body.registration.attendeeDetails)).not.toMatch(/category|"id"/);
  });

  it("books with attendees and answers; heads reconcile with lines and capacity", async () => {
    expect((await book(sessToday, knotsBooking({ attendees: [{ name: "A" }, { name: "B" }, { name: "C" }] }))).body.code).toBe("attendees_invalid");
    const missing = await book(sessToday, knotsBooking({ answers: { booking: {}, attendees: [{}, {}, { [qk.age]: 7 }] } }));
    expect([missing.status, missing.body.code]).toEqual([400, "answer_required"]);
    expect((await book(sessToday, knotsBooking({ answers: { booking: { [qk.heard]: "Friend" }, attendees: [{}, {}, { [qk.age]: 30 }] } }))).body.error).toMatch(/highest answer is 17/);
    expect((await book(sessToday, knotsBooking({ questionsVersion: 0 }))).body.code).toBe("questions_changed");

    const r = await book(sessToday, knotsBooking(), { resident: residentId });
    expect(r.status).toBe(201);
    mainRef = r.body.ref;
    const b = await one(`SELECT party_size, payment_status FROM experience_bookings WHERE ref = ?`, mainRef);
    expect(b).toMatchObject({ party_size: 3, payment_status: "paid" });
    const people = await all(`SELECT attendee_no, line_no, person_type, name, guardian_kind, guardian_attendee_no FROM booking_attendees WHERE source_ref = ? ORDER BY attendee_no`, mainRef);
    expect(people.map((p) => [p.attendee_no, p.line_no, p.person_type, p.guardian_attendee_no])).toEqual([[1, 1, "adult", null], [2, 1, "adult", null], [3, 2, "child", 1]]);
    expect((await all(`SELECT name FROM experience_booking_participants WHERE booking_ref = ? ORDER BY seat`, mainRef)).map((s) => s.name)).toEqual(["Asha QA", "Ravi QA", "Mira QA"]);
    const answers = await all(`SELECT attendee_no, qkey, value_text, label_snapshot, door_visible_snapshot FROM registration_answers WHERE source_ref = ? ORDER BY attendee_no, qkey`, mainRef);
    expect(answers).toHaveLength(3);
    expect(answers.find((a) => a.qkey === qk.badge)).toMatchObject({ attendee_no: 1, value_text: "Asha R", door_visible_snapshot: 1 });

    const list = await call("GET", `/api/vendor/experiences/${eventId}/attendees`, undefined, { who: "manager" });
    expect(list.status).toBe(200);
    const row = list.body.bookings.find((x: { ref: string }) => x.ref === mainRef);
    expect(row.issues).toEqual([]);
    expect(row.attendees[2]).toMatchObject({ name: "Mira QA", personType: "child", guardianName: "Asha QA", lineLabel: "Child" });
  });

  it("with participation.attendees off, booking ignores attendee details and the journey shows no questions", async () => {
    await switches({ "participation.attendees": false });
    const r = await book(sessFuture, { lines: [{ optionId: opt.adult, quantity: 1 }], attendees: [{ name: "Ignored" }] });
    expect(r.status).toBe(201);
    expect(await all(`SELECT id FROM booking_attendees WHERE source_ref = ?`, r.body.ref)).toHaveLength(0);
    expect((await call("GET", `/api/experiences/${eventId}`)).body.registration.attendeeDetails).toBeNull();
    expect((await call("PUT", `/api/vendor/experiences/${eventId}/questions`, { version: qVersion, questions: [] }, { who: "manager" })).status).toBe(404);
  });
});

// --- resident view ----------------------------------------------------------------

describe("My Life booking details (#1, #11)", () => {
  it("#1 only the booker's device or resident account sees the attendees and answers", async () => {
    const own = await call("GET", `/api/experiences/bookings/${mainRef}/details`);
    expect(own.status).toBe(200);
    expect(own.body.attendees).toHaveLength(3);
    expect(own.body.answers).toHaveLength(3);
    expect(own.body.canEditAnswers).toBe(true);
    expect(own.text).not.toMatch(/total|Cents/);
    // Same resident on a new device (G8).
    expect((await call("GET", `/api/experiences/bookings/${mainRef}/details`, undefined, { client: otherClient, resident: residentId })).status).toBe(200);
    expect((await call("GET", `/api/experiences/bookings/${mainRef}/details`, undefined, { client: otherClient })).status).toBe(404);
    expect((await call("GET", `/api/experiences/bookings/${mainRef}/details`, undefined, { client: otherClient, resident: otherResident })).status).toBe(404);
    expect((await call("PUT", `/api/experiences/bookings/${mainRef}/answers`, { questionsVersion: qVersion, answers: {} }, { client: otherClient, resident: otherResident })).status).toBe(404);
  });

  it("#11 a question change after purchase keeps the old answers and asks only for what's new", async () => {
    const v2 = [
      { key: qk.badge, scope: "attendee", inputType: "text", label: "Badge name", purpose: "Printed on your name badge", doorVisible: true },
      { key: qk.age, scope: "attendee", appliesTo: "child", inputType: "number", label: "Age", purpose: "To group children for activities", min: 0, max: 17, required: true },
      { scope: "booking", inputType: "text", label: "Arrival time", purpose: "To plan parking", required: true },
    ];
    const saved = await call("PUT", `/api/vendor/experiences/${eventId}/questions`, { version: qVersion, questions: v2 }, { who: "owner" });
    expect(saved.status).toBe(200);
    const oldVersion = qVersion;
    qVersion = saved.body.version;
    const arrival = saved.body.questions.find((q: { label: string }) => q.label === "Arrival time").key;
    const d = await call("GET", `/api/experiences/bookings/${mainRef}/details`);
    expect(d.body.answers.find((a: { key: string }) => a.key === qk.heard)).toMatchObject({ label: "How did you hear about us?", value: "Friend", version: oldVersion });
    expect(d.body.answers.find((a: { key: string }) => a.key === qk.badge).label).toBe("Name on badge");
    expect(d.body.missingAnswers).toEqual(["Arrival time"]);
    // A new checkout on the old version is refused.
    expect((await book(sessToday, knotsBooking({ questionsVersion: oldVersion }))).body.code).toBe("questions_changed");
    expect((await call("PUT", `/api/experiences/bookings/${mainRef}/answers`, { questionsVersion: oldVersion, answers: {} })).status).toBe(409);
    const edit = await call("PUT", `/api/experiences/bookings/${mainRef}/answers`, { questionsVersion: qVersion, answers: { booking: { [arrival]: "10am" }, attendees: [{ [qk.badge]: "Asha R." }, {}, { [qk.age]: 7 }] } });
    expect(edit.status).toBe(200);
    expect(edit.body.missingAnswers).toEqual([]);
    expect(edit.body.answers.find((a: { key: string }) => a.key === qk.heard).value).toBe("Friend");
    expect(edit.body.answers.find((a: { key: string }) => a.key === qk.badge)).toMatchObject({ label: "Badge name", value: "Asha R." });
  });
});

// --- check-in permissions ------------------------------------------------------------

describe("door permissions (#2, #4, #5, #6)", () => {
  const door = (who: Who, sid = sessToday) => call("GET", `/api/vendor/door/sessions/${sid}`, undefined, { who });
  let assignment = 0;

  it("check-in-only staff see nothing until assigned, then only their date", async () => {
    expect((await door("doorA")).status).toBe(403);
    expect((await call("POST", `/api/vendor/experiences/${eventId}/checkin-staff`, { userId: U.finance }, { who: "manager" })).status).toBe(400);
    expect((await call("POST", `/api/vendor/experiences/${eventId}/checkin-staff`, { userId: U.doorA, sessionId: sessToday }, { who: "finance" })).status).toBe(403);
    expect((await call("POST", `/api/vendor/experiences/${eventId}/checkin-staff`, { userId: U.doorA, sessionId: sessToday }, { who: "manager" })).status).toBe(201);
    expect((await call("POST", `/api/vendor/experiences/${eventId}/checkin-staff`, { userId: U.doorA, sessionId: sessToday }, { who: "manager" })).status).toBe(409);
    const list = await call("GET", `/api/vendor/experiences/${eventId}/checkin-staff`, undefined, { who: "manager" });
    assignment = list.body.assignments[0].id;
    expect(list.body.members.map((m: { id: string }) => m.id).sort()).toEqual([U.doorA, U.doorB].sort());
    expect((await door("doorA")).status).toBe(200);
    expect((await door("doorA", sessFuture)).status).toBe(403);
    expect((await door("doorB")).status).toBe(403);
    const mine = await call("GET", `/api/vendor/door`, undefined, { who: "doorA" });
    expect(mine.body.sessions.map((s: { sessionId: string }) => s.sessionId)).toEqual([sessToday]);
  });

  it("#4 check-in staff never reach payment, contact or other workspace data", async () => {
    const res = await door("doorA");
    expect(res.text).not.toMatch(/email|phone|cents|total|amount|price|payment/i);
    for (const path of [`/experiences/${eventId}/bookings`, `/experiences/${eventId}/attendees`, `/orders`, `/payments`, `/earnings`, `/stats`, `/bookings`, `/customers`, `/obligations`, `/experiences`]) {
      const r = await call("GET", `/api/vendor${path}`, undefined, { who: "doorA" });
      expect([path, r.status]).toEqual([path, 403]);
    }
    // Managers can check in; finance, communications and analysts can't.
    expect((await door("manager")).status).toBe(200);
    expect((await door("owner")).status).toBe(200);
    expect((await door("finance")).status).toBe(403);
    expect((await door("comms")).status).toBe(403);
    expect((await door("analyst")).status).toBe(403);
    expect((await call("GET", `/api/vendor/experiences/${eventId}/attendees`, undefined, { who: "analyst" })).status).toBe(403);
    expect((await call("GET", `/api/vendor/experiences/${eventId}/attendance-summary`, undefined, { who: "analyst" })).status).toBe(200);
    expect((await call("GET", `/api/vendor/experiences/${eventId}/attendees`, undefined, { who: "finance" })).status).toBe(403);
  });

  it("#2 another organisation can't see or check in this event's attendees", async () => {
    expect((await door("other")).status).toBe(404);
    expect((await call("GET", `/api/vendor/experiences/${eventId}/attendees`, undefined, { who: "other" })).status).toBe(403);
    expect((await call("POST", `/api/vendor/door/sessions/${sessToday}/checkins`, { ref: mainRef, attendeeNos: [1] }, { who: "other" })).status).toBe(404);
    // A pass from the other organisation's event, scanned at ours.
    await insertBooking(`EX-OT${run.slice(0, 4).toUpperCase()}`, otherSess, { party: 1, experience: otherEventId });
    const other = await call("POST", `/api/vendor/door/sessions/${sessToday}/lookup`, { code: `EX-OT${run.slice(0, 4).toUpperCase()}` }, { who: "manager" });
    expect([other.status, other.body.reason]).toEqual([404, "other_listing"]);
  });

  it("#6 suspended organisation and #5 removed or revoked staff lose door access", async () => {
    const s = await door("suspendedDoor");
    expect([s.status, s.body.orgSuspended]).toEqual([403, true]);
    const r = await door("removed");
    expect([r.status, r.body.removedFromOrg]).toEqual([403, true]);
    expect((await call("DELETE", `/api/vendor/experiences/${eventId}/checkin-staff/${assignment}`, undefined, { who: "doorA" })).status).toBe(403);
    expect((await call("DELETE", `/api/vendor/experiences/${eventId}/checkin-staff/${assignment}`, undefined, { who: "manager" })).status).toBe(200);
    expect((await door("doorA")).status).toBe(403);
    expect((await call("POST", `/api/vendor/door/sessions/${sessToday}/checkins`, { ref: mainRef, attendeeNos: [1] }, { who: "doorA" })).status).toBe(403);
    // Re-assigned to the whole event for the check-in tests below.
    expect((await call("POST", `/api/vendor/experiences/${eventId}/checkin-staff`, { userId: U.doorA }, { who: "owner" })).status).toBe(201);
  });
});

// --- check-in behaviour ----------------------------------------------------------------

describe("door check-in (#7–#10)", () => {
  const lookup = (code: string) => call("POST", `/api/vendor/door/sessions/${sessToday}/lookup`, { code }, { who: "doorA" });
  const checkin = (ref: string, attendeeNos: number[]) => call("POST", `/api/vendor/door/sessions/${sessToday}/checkins`, { ref, attendeeNos, method: "qr" }, { who: "doorA" });

  it("#7 refuses something that isn't a pass and reports a second scan", async () => {
    expect((await lookup("HELLO")).body.reason).toBe("not_a_pass");
    expect((await lookup("EX-000000")).body.reason).toBe("other_listing");
    const ok = await lookup(mainRef.toLowerCase());
    expect([ok.status, ok.body.verdict.ok, ok.body.booking.people.length]).toEqual([200, true, 3]);
    expect(ok.body.booking.people[0].answers).toEqual([{ label: "Badge name", value: "Asha R." }]);
  });

  it("#8 checks in part of a group, then the rest; duplicates and races don't double-count", async () => {
    const first = await checkin(mainRef, [1]);
    expect(first.body.results).toEqual([expect.objectContaining({ attendeeNo: 1, result: "checked_in" })]);
    expect(first.body.booking.checkedIn).toBe(1);
    expect(await one(`SELECT status, source FROM attendance WHERE kind = 'experience' AND ref = ?`, mainRef)).toMatchObject({ status: "present", source: "door" });
    const again = await checkin(mainRef, [1, 2]);
    expect(again.body.results.map((r: { result: string }) => r.result)).toEqual(["already", "checked_in"]);
    const race = await Promise.all([checkin(mainRef, [3]), checkin(mainRef, [3])]);
    expect(race.map((r) => r.body.results[0].result).sort()).toEqual(["already", "checked_in"]);
    expect((await all(`SELECT id FROM attendee_checkins WHERE source_ref = ?`, mainRef)).length).toBe(3);
    expect((await checkin(mainRef, [9])).body.reason).toBe("unknown_person");
    const undo = await call("DELETE", `/api/vendor/door/sessions/${sessToday}/checkins/${mainRef}/2`, undefined, { who: "doorA" });
    expect(undo.body.booking.checkedIn).toBe(2);
    const sessionView = await call("GET", `/api/vendor/door/sessions/${sessToday}`, undefined, { who: "doorA" });
    expect(sessionView.body.counts).toMatchObject({ checkedIn: 2 });
    const summary = await call("GET", `/api/vendor/experiences/${eventId}/attendance-summary`, undefined, { who: "manager" });
    expect(summary.body.sessions.find((s: { sessionId: string }) => s.sessionId === sessToday)).toMatchObject({ checkedIn: 2, children: 1 });
    // The booker sees who has arrived.
    const mine = await call("GET", `/api/experiences/bookings/${mainRef}/details`);
    expect(mine.body.attendees.map((a: { checkedInAt: string | null }) => !!a.checkedInAt)).toEqual([true, false, true]);
  });

  it("#9 an old booking with no attendee records is checked in person by person from its seats", async () => {
    const ref = `EX-LG${run.slice(0, 4).toUpperCase()}`;
    await insertBooking(ref, sessToday, { party: 2, seats: ["Legacy Lee"] });
    const view = await lookup(ref);
    expect(view.body.booking.people.map((p: { name: string }) => p.name)).toEqual(["Legacy Lee", "Guest 2 of Legacy Lee"]);
    expect((await checkin(ref, [2])).body.results[0].result).toBe("checked_in");
    const details = await call("GET", `/api/experiences/bookings/${ref}/details`);
    expect(details.body.attendees.map((a: { recorded: boolean; checkedInAt: string | null }) => [a.recorded, !!a.checkedInAt])).toEqual([[false, false], [false, true]]);
  });

  it("#10 cancelled, refunded, unpaid and other-date bookings are refused, also after a cancellation lands", async () => {
    const tag = run.slice(0, 4).toUpperCase();
    await insertBooking(`EX-CN${tag}`, sessToday, { party: 1, status: "cancelled" });
    await insertBooking(`EX-RF${tag}`, sessToday, { party: 1, payment: "refunded" });
    await insertBooking(`EX-PD${tag}`, sessToday, { party: 1, payment: "pending" });
    await insertBooking(`EX-FT${tag}`, sessFuture, { party: 1 });
    for (const [code, reason] of [[`EX-CN${tag}`, "cancelled"], [`EX-RF${tag}`, "refunded"], [`EX-PD${tag}`, "not_paid"], [`EX-FT${tag}`, "other_session"]]) {
      expect((await lookup(code)).body.verdict.reason).toBe(reason);
      const c = await checkin(code, [1]);
      expect([code, c.status, c.body.reason]).toEqual([code, 409, reason]);
    }
    await db.prepare(`UPDATE experience_bookings SET status = 'cancelled' WHERE ref = ?`).run(mainRef);
    expect((await checkin(mainRef, [2])).body.reason).toBe("cancelled");
    const list = await call("GET", `/api/vendor/door/sessions/${sessToday}`, undefined, { who: "doorA" });
    expect(list.body.bookings.some((b: { ref: string }) => b.ref === mainRef)).toBe(false);
    // The record of who arrived stays.
    expect((await all(`SELECT id FROM attendee_checkins WHERE source_ref = ?`, mainRef)).length).toBe(2);
    expect((await call("PUT", `/api/experiences/bookings/${mainRef}/answers`, { questionsVersion: qVersion, answers: {} })).status).toBe(409);
  });

  it("is off (404) while participation.checkin is off", async () => {
    await switches({ "participation.checkin": false });
    expect((await call("GET", `/api/vendor/door/sessions/${sessToday}`, undefined, { who: "manager" })).status).toBe(404);
    expect((await call("GET", `/api/vendor/door/sessions/${sessToday}`, undefined, { who: "doorA" })).status).toBe(404);
  });
});
