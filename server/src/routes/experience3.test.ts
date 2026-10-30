import crypto from "node:crypto";
import http, { type Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FEATURE_SWITCHES, setFeature } from "../circleFeatures.js";
import { db } from "../db/index.js";
import { spotAlertsRouter, sweepSpotAlerts } from "../spotAlerts.js";
import { circleExperienceRouter } from "./circleExperience.js";
import { circlesRouter } from "./circles.js";
import { discoverRouter } from "./discover.js";
import { experienceHubRouter } from "./experienceHub.js";
import { experiencesRouter } from "./experiences.js";
import { gamesRouter } from "./games.js";

// Experience 3.0 (docs/experience-3/) end to end against the isolated test DB:
// switches, the Free Time duration fix, Smart Match / Going solo / Surprise,
// collections, spot alerts, Passport, programme journey, Plan My Day + saved
// plans, and Circle-to-Circle activities (incl. partner visibility).

let server: Server;
let base: string;
const t = crypto.randomUUID().slice(0, 8);
const COUNTY = `Cx3shire-${t}`;
const vendor = `test-x3-vendor-${t}`;
const me = `test-x3-me-${t}`;
const other = `test-x3-other-${t}`;
const outsider = `test-x3-out-${t}`;
const clientId = `test-x3-client-${t}`;
const exp = { timed: `test-x3-exp-timed-${t}`, untimed: `test-x3-exp-untimed-${t}`, solo: `test-x3-exp-solo-${t}`, full: `test-x3-exp-full-${t}` };
const sess = { timed: `test-x3-s-timed-${t}`, untimed: `test-x3-s-untimed-${t}`, solo: `test-x3-s-solo-${t}`, full: `test-x3-s-full-${t}`, past: `test-x3-s-past-${t}` };
const program = `test-x3-prog-${t}`;
const progSessions = [`test-x3-ps1-${t}`, `test-x3-ps2-${t}`, `test-x3-ps3-${t}`, `test-x3-ps4-${t}`];
const enrolRef = `test-x3-pe-${t}`;
const circleA = `test-x3-ca-${t}`;
const circleB = `test-x3-cb-${t}`;
const plusDays = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const DAY = plusDays(5); // inside Free Time's 7-day default window

const as = (who: string | null, path: string, init: { method?: string; body?: unknown } = {}) =>
  fetch(`${base}${path}`, {
    method: init.method ?? "GET",
    headers: { "Content-Type": "application/json", "X-Client-Id": clientId, ...(who ? { "X-Test-Resident-Id": who } : {}) },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });

async function switches(on: boolean) {
  // Only this suite's own switches (Circles / Experience 3.0) — the
  // participation.* group is Phase 1's, and one of its switches is locked.
  for (const f of FEATURE_SWITCHES.filter((x) => x.group !== "participation")) await setFeature(f.key, on);
}

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const id = req.header("X-Test-Resident-Id");
    if (id) (req as any).resident = { id, name: `Resident ${id.slice(-4)}`, email: `${id}@example.test` };
    next();
  });
  app.use("/discover", discoverRouter);
  app.use("/experiences", spotAlertsRouter);
  app.use("/experiences", experiencesRouter);
  app.use("/experience", experienceHubRouter);
  app.use("/circles", circlesRouter);
  app.use("/circles", circleExperienceRouter);
  app.use("/games", gamesRouter);
  server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, r));
  const a = server.address();
  if (!a || typeof a === "string") throw new Error("no port");
  base = `http://127.0.0.1:${a.port}`;

  for (const id of [me, other, outsider]) await db.prepare(`INSERT INTO residents (id, email, name) VALUES (?, ?, ?)`).run(id, `${id}@example.test`, `X3 ${id.slice(-4)}`);
  await db.prepare(`INSERT INTO users (id, email, password_hash, role, status, name) VALUES (?, ?, 'x', 'vendor', 'approved', 'X3 Vendor')`).run(vendor, `${vendor}@example.test`);
  const blank = `'', '', '', '', '', '', '', '', ''`;
  const mk = async (id: string, title: string, kind: string, duration: number, price: number, capacity: number) =>
    db
      .prepare(
        `INSERT INTO experiences (id, vendor_id, kind, title, county, area, lat, lng, location_source, duration_minutes, price_cents, capacity, blurb, description, fitness_requirements, itinerary, equipment_provided, equipment_required, transport_info, safety_info, weather_policy, eligibility, cancellation_terms, status)
         VALUES (?, ?, ?, ?, ?, 'Howth', 53.3786, -6.0583, 'confirmed', ?, ?, ?, '', '', ${blank}, 'approved')`
      )
      .run(id, vendor, kind, title, COUNTY, duration, price, capacity);
  await mk(exp.timed, "X3 timed walk", "adventure", 60, 0, 10);
  await mk(exp.untimed, "X3 untimed walk", "experience", 0, 1500, 10);
  await mk(exp.solo, "X3 solo swim", "experience", 60, 1800, 10);
  await mk(exp.full, "X3 full kayak", "adventure", 120, 3000, 1);
  await db.prepare(`INSERT INTO listing_attributes (listing_type, listing_id, attr) VALUES ('experience', ?, 'come_alone'), ('experience', ?, 'family_friendly')`).run(exp.solo, exp.timed);
  const ses = (id: string, e: string, date: string, time: string) => db.prepare(`INSERT INTO experience_sessions (id, experience_id, date, time) VALUES (?, ?, ?, ?)`).run(id, e, date, time);
  await ses(sess.timed, exp.timed, DAY, "10:00");
  await ses(sess.untimed, exp.untimed, DAY, "11:00");
  await ses(sess.solo, exp.solo, DAY, "13:00");
  await ses(sess.full, exp.full, DAY, "15:00");
  await ses(sess.past, exp.timed, plusDays(-20), "10:00");
  // The full kayak's only place is taken by someone else.
  await db.prepare(`INSERT INTO experience_bookings (ref, experience_id, session_id, client_id, resident_id, participant_name, email, payment_status) VALUES (?, ?, ?, 'other-client', ?, 'Other', 'o@example.test', 'paid')`).run(`test-x3-eb-full-${t}`, exp.full, sess.full, other);
  // Passport: an attended past adventure and a booked-but-unrecorded one.
  await db.prepare(`INSERT INTO experience_bookings (ref, experience_id, session_id, client_id, resident_id, participant_name, email, payment_status) VALUES (?, ?, ?, ?, ?, 'Me', 'me@example.test', 'paid')`).run(`test-x3-eb-went-${t}`, exp.timed, sess.past, clientId, me);
  await db.prepare(`INSERT INTO attendance (kind, ref, checked_in_by, status) VALUES ('experience', ?, ?, 'present')`).run(`test-x3-eb-went-${t}`, vendor);
  await db.prepare(`INSERT INTO experience_bookings (ref, experience_id, session_id, client_id, resident_id, participant_name, email, payment_status) VALUES (?, ?, ?, ?, ?, 'Me', 'me@example.test', 'paid')`).run(`test-x3-eb-nocheck-${t}`, exp.untimed, sess.past, clientId, me);
  // Programme with four sessions: attended, missed, unrecorded past, upcoming.
  await db.prepare(`INSERT INTO programs (id, listing_type, listing_id, vendor_id, title, description, status) VALUES (?, 'centre', 'none', ?, 'X3 Pottery', '', 'published')`).run(program, vendor);
  const dates = [plusDays(-21), plusDays(-14), plusDays(-7), plusDays(7)];
  for (let i = 0; i < 4; i++) await db.prepare(`INSERT INTO program_sessions (id, program_id, date, time, status) VALUES (?, ?, ?, '10:00', 'scheduled')`).run(progSessions[i], program, dates[i]);
  await db.prepare(`INSERT INTO program_enrollments (ref, program_id, client_id, resident_id, participant_name, email, payment_status) VALUES (?, ?, ?, ?, 'Me', 'me@example.test', 'paid')`).run(enrolRef, program, clientId, me);
  const { id: peId } = (await db.prepare(`SELECT id FROM program_enrollments WHERE ref = ?`).get(enrolRef)) as { id: number };
  await db.prepare(`INSERT INTO attendance (kind, ref, checked_in_by, status) VALUES ('program_session', ?, ?, 'present'), ('program_session', ?, ?, 'absent')`).run(`${progSessions[0]}:${peId}`, vendor, `${progSessions[1]}:${peId}`, vendor);
  // Two Circles: A (approval, organised by me), B (organised by other; outsider is in neither).
  await db.prepare(`INSERT INTO circles (id, name, activity_label, area, county, about, created_by_resident_id, join_mode) VALUES (?, 'X3 Walkers', 'Walking', '', 'Dublin', '', ?, 'approval'), (?, 'X3 Swimmers', 'Swimming', '', 'Dublin', '', ?, 'approval')`).run(circleA, me, circleB, other);
  await db.prepare(`INSERT INTO circle_members (circle_id, resident_id, role) VALUES (?, ?, 'organiser'), (?, ?, 'organiser')`).run(circleA, me, circleB, other);
});

afterAll(async () => {
  await switches(false);
  await new Promise<void>((r) => server.close(() => r()));
  const ids = Object.values(exp);
  await db.prepare(`DELETE FROM experience_spot_alerts WHERE session_id LIKE 'test-x3-%'`).run();
  await db.prepare(`DELETE FROM attendance WHERE ref LIKE 'test-x3-%' OR ref LIKE '%:%' AND ref LIKE 'test-x3-%'`).run();
  await db.prepare(`DELETE FROM attendance WHERE checked_in_by = ?`).run(vendor);
  await db.prepare(`DELETE FROM experience_bookings WHERE experience_id IN (${ids.map(() => "?").join(",")})`).run(...ids);
  await db.prepare(`DELETE FROM experience_sessions WHERE experience_id IN (${ids.map(() => "?").join(",")})`).run(...ids);
  await db.prepare(`DELETE FROM listing_attributes WHERE listing_id IN (${ids.map(() => "?").join(",")})`).run(...ids);
  await db.prepare(`DELETE FROM experiences WHERE id IN (${ids.map(() => "?").join(",")})`).run(...ids);
  await db.prepare(`DELETE FROM program_enrollments WHERE program_id = ?`).run(program);
  await db.prepare(`DELETE FROM program_sessions WHERE program_id = ?`).run(program);
  await db.prepare(`DELETE FROM programs WHERE id = ?`).run(program);
  await db.prepare(`DELETE FROM game_participants WHERE game_id IN (SELECT id FROM games WHERE circle_id = ?)`).run(circleA);
  await db.prepare(`DELETE FROM games WHERE circle_id = ?`).run(circleA);
  await db.prepare(`DELETE FROM circle_collaborations WHERE proposer_circle_id = ? OR partner_circle_id = ?`).run(circleA, circleA);
  await db.prepare(`DELETE FROM circle_members WHERE circle_id IN (?, ?)`).run(circleA, circleB);
  await db.prepare(`DELETE FROM circles WHERE id IN (?, ?)`).run(circleA, circleB);
  await db.prepare(`DELETE FROM day_plans WHERE resident_id IN (?, ?)`).run(me, other);
  for (const id of [me, other, outsider]) await db.prepare(`DELETE FROM notifications WHERE resident_id = ?`).run(id);
  await db.prepare(`DELETE FROM residents WHERE id IN (?, ?, ?)`).run(me, other, outsider);
  await db.prepare(`DELETE FROM users WHERE id = ?`).run(vendor);
  await db.prepare(`DELETE FROM audit_log WHERE object_id IN (?, ?)`).run(circleA, circleB);
});

const ids = (rows: { id: string }[]) => rows.map((r) => r.id);

describe("switches off (the default)", () => {
  it("every new route answers 404 and Free Time ignores the new inputs", async () => {
    await switches(false);
    for (const p of ["/experience/passport", `/experience/programmes/${enrolRef}/journey`, "/experience/plans", "/discover/collections", `/circles/${circleA}/collaborations`]) expect((await as(me, p)).status, p).toBe(404);
    expect((await as(me, "/experience/plan-my-day", { method: "POST", body: { date: DAY } })).status).toBe(404);
    expect((await as(me, `/experiences/${exp.full}/sessions/${sess.full}/spot-alert`, { method: "POST" })).status).toBe(404);
    // Unknown "when" is ignored rather than refused while Smart Match is off.
    expect((await as(null, `/discover/free-time?county=${COUNTY}&when=nonsense`)).status).toBe(200);
  });
  it("Free Time never claims an unknown length fits (bug fix, switch-independent)", async () => {
    const rows = (await (await as(null, `/discover/free-time?county=${COUNTY}&maxMinutes=120`)).json()) as { id: string }[];
    expect(ids(rows)).not.toContain(sess.untimed);
    expect(ids(rows)).toContain(sess.timed);
  });
});

describe("Find something for me, Going solo, Surprise me, collections", () => {
  beforeAll(() => switches(true));
  it("filters by day, budget and solo, with stated reasons, for signed-out visitors too", async () => {
    const budget = (await (await as(null, `/discover/free-time?county=${COUNTY}&when=${DAY}&maxPriceCents=2000&limit=12`)).json()) as { id: string; matchReasons: string[] }[];
    expect(ids(budget).sort()).toEqual([sess.timed, sess.untimed, sess.solo].sort()); // the €30 kayak is over budget (and full)
    expect(budget.find((r) => r.id === sess.timed)!.matchReasons).toContain("Free");
    const solo = (await (await as(null, `/discover/free-time?county=${COUNTY}&solo=1&limit=12`)).json()) as { id: string; matchReasons: string[] }[];
    expect(ids(solo)).toEqual([sess.solo]);
    expect(solo[0].matchReasons).toContain("Host says people often come on their own");
    expect((await as(null, `/discover/free-time?when=2001-01-01`)).status).toBe(400);
  });
  it("never offers a full departure", async () => {
    const rows = (await (await as(null, `/discover/free-time?county=${COUNTY}&limit=12&when=${DAY}`)).json()) as { id: string }[];
    expect(ids(rows)).not.toContain(sess.full);
  });
  it("surprise gives one real suggestion and never repeats what was shown", async () => {
    const seen = new Set<string>();
    for (let i = 0; i < 3; i++) {
      const [pick] = (await (await as(null, `/discover/free-time?county=${COUNTY}&surprise=1&exclude=${[...seen].join(",")}`)).json()) as { id: string }[];
      expect(pick).toBeTruthy();
      expect(seen.has(pick.id)).toBe(false);
      seen.add(pick.id);
    }
    expect(await (await as(null, `/discover/free-time?county=${COUNTY}&surprise=1&exclude=${[...seen].join(",")}`)).json()).toEqual([]);
  });
  it("collections come only from stated facts and drop when empty", async () => {
    const { collections } = (await (await as(null, `/discover/collections?county=${COUNTY}`)).json()) as { collections: { key: string; items: { id: string }[] }[] };
    const by = Object.fromEntries(collections.map((c) => [c.key, ids(c.items)]));
    expect(by.free).toEqual([sess.timed]);
    expect(by.under_20.sort()).toEqual([sess.untimed, sess.solo].sort());
    expect(by.family_day).toEqual([sess.timed]);
    expect(by.solo).toEqual([sess.solo]);
    expect(by.outdoors).toEqual([sess.timed]); // the full kayak is excluded
    expect(by).not.toHaveProperty("beginner");
  });
});

describe("Spot alerts", () => {
  it("only on a full, bookable departure; told once when a place opens; never a hold", async () => {
    expect((await as(me, `/experiences/${exp.timed}/sessions/${sess.timed}/spot-alert`, { method: "POST" })).status).toBe(409); // has places
    expect((await as(other, `/experiences/${exp.full}/sessions/${sess.full}/spot-alert`, { method: "POST" })).status).toBe(409); // already booked
    expect((await as(me, `/experiences/${exp.full}/sessions/${sess.timed}/spot-alert`, { method: "POST" })).status).toBe(404); // session of another experience
    expect((await as(me, `/experiences/${exp.full}/sessions/${sess.full}/spot-alert`, { method: "POST" })).status).toBe(201);
    expect((await as(me, `/experiences/${exp.full}/sessions/${sess.full}/spot-alert`, { method: "POST" })).status).toBe(201); // idempotent
    expect(await sweepSpotAlerts(sess.full)).toBe(0); // still full
    await db.prepare(`UPDATE experience_bookings SET status = 'cancelled' WHERE ref = ?`).run(`test-x3-eb-full-${t}`);
    expect(await sweepSpotAlerts(sess.full)).toBe(1);
    expect(await sweepSpotAlerts(sess.full)).toBe(0);
    const notes = (await db.prepare(`SELECT kind, title FROM notifications WHERE resident_id = ? AND ref = ?`).all(me, sess.full)) as { kind: string; title: string }[];
    expect(notes).toEqual([{ kind: "waitlist", title: "A place opened: X3 full kayak" }]);
    const mine = (await (await as(me, `/experiences/spot-alerts/mine`)).json()) as { sessionId: string }[];
    expect(mine.map((m) => m.sessionId)).toContain(sess.full);
    expect((await as(me, `/experiences/${exp.full}/sessions/${sess.full}/spot-alert`, { method: "DELETE" })).status).toBe(200);
  });
});

describe("Activity Passport", () => {
  it("is private and only lists what an organiser recorded (or you confirmed)", async () => {
    expect((await as(null, "/experience/passport")).status).toBe(401);
    const p = (await (await as(me, "/experience/passport")).json()) as { entries: { kind: string; title: string; evidence: string }[]; milestones: { key: string }[] };
    const titles = p.entries.map((e) => e.title);
    expect(titles).toContain("X3 timed walk");
    expect(titles).not.toContain("X3 untimed walk"); // booked, never checked in
    expect(titles).toContain("X3 Pottery"); // one attended programme session
    expect(p.entries.find((e) => e.title === "X3 timed walk")).toMatchObject({ kind: "adventure", evidence: "organiser" });
    expect(p.milestones.map((m) => m.key)).toEqual(expect.arrayContaining(["first_activity", "first_adventure", "first_programme", "first_circle"]));
    const theirs = (await (await as(other, "/experience/passport")).json()) as { entries: { title: string }[] };
    expect(theirs.entries.map((e) => e.title)).not.toContain("X3 timed walk");
  });
});

describe("Programme journey", () => {
  it("shows each session from registers only, and only to its owner", async () => {
    const j = (await (await as(me, `/experience/programmes/${enrolRef}/journey`)).json()) as { sessions: { state: string }[]; totals: Record<string, number> };
    expect(j.sessions.map((s) => s.state)).toEqual(["attended", "missed", "not_recorded", "upcoming"]);
    expect(j.totals).toEqual({ attended: 1, missed: 1, notRecorded: 1, upcoming: 1 });
    const stranger = await fetch(`${base}/experience/programmes/${enrolRef}/journey`, { headers: { "X-Client-Id": "someone-else" } });
    expect(stranger.status).toBe(404);
  });
});

describe("Plan My Day and saved plans", () => {
  it("plans real, timed stops with rough travel and is never 'bookable'", async () => {
    const plan = (await (await as(null, "/experience/plan-my-day", { method: "POST", body: { date: DAY, county: COUNTY, startTime: "09:00", endTime: "18:00" } })).json()) as {
      stops: { id: string; start: string; travelMinutes: number | null }[];
      bookable: boolean;
      assumptions: { travel: string; skippedUnknownLength: number };
    };
    expect(plan.bookable).toBe(false);
    // The untimed walk is skipped (no stated length). (The kayak's place was
    // freed by the spot-alert test above, so it may follow.)
    expect(ids(plan.stops).slice(0, 2)).toEqual([sess.timed, sess.solo]);
    expect(ids(plan.stops)).not.toContain(sess.untimed);
    expect(plan.stops[1].travelMinutes).toBeGreaterThan(0);
    expect(plan.assumptions.skippedUnknownLength).toBe(1);
    expect(plan.assumptions.travel).toMatch(/Rough estimate/);
    expect((await as(null, "/experience/plan-my-day", { method: "POST", body: { date: "2001-01-01" } })).status).toBe(400);
  });
  it("saves, re-checks and deletes only your own plans", async () => {
    const stop = { kind: "experience_session", id: sess.timed, title: "X3 timed walk", date: DAY, time: "10:00", durationMinutes: 60, href: `/adventures/${exp.timed}`, priceCents: 0, place: "Howth" };
    expect((await as(me, "/experience/plans", { method: "POST", body: { date: DAY, items: [{ ...stop, date: plusDays(11) }] } })).status).toBe(400);
    expect((await as(me, "/experience/plans", { method: "POST", body: { date: DAY, items: [{ ...stop, href: "https://evil.example" }] } })).status).toBe(400);
    const { id } = (await (await as(me, "/experience/plans", { method: "POST", body: { title: "Saturday", date: DAY, items: [stop] } })).json()) as { id: string };
    const list = (await (await as(me, "/experience/plans")).json()) as { id: string; items: { current: string }[] }[];
    expect(list.find((p) => p.id === id)!.items[0].current).toBe("listed");
    expect((await as(other, `/experience/plans/${id}`, { method: "DELETE" })).status).toBe(404);
    expect((await (await as(other, "/experience/plans")).json()) as unknown[]).toEqual([]);
    expect((await as(me, `/experience/plans/${id}`, { method: "PUT", body: { items: [] } })).status).toBe(400);
    expect((await as(me, `/experience/plans/${id}`, { method: "DELETE" })).status).toBe(200);
  });
});

describe("Circle-to-Circle activities", () => {
  let collabId: string;
  it("only organisers propose, only the partner answers", async () => {
    expect((await as(outsider, `/circles/${circleA}/collaborations`, { method: "POST", body: { partnerCircleId: circleB, title: "Joint swim" } })).status).toBe(403);
    expect((await as(me, `/circles/${circleA}/collaborations`, { method: "POST", body: { partnerCircleId: circleA, title: "Self" } })).status).toBe(400);
    const res = await as(me, `/circles/${circleA}/collaborations`, { method: "POST", body: { partnerCircleId: circleB, title: "Joint swim and walk", proposedDate: DAY } });
    expect(res.status).toBe(201);
    collabId = ((await res.json()) as { id: string }).id;
    expect((await as(me, `/circles/${circleA}/collaborations`, { method: "POST", body: { partnerCircleId: circleB, title: "Another" } })).status).toBe(409);
    // The proposer can't accept its own invitation.
    expect((await as(me, `/circles/${circleA}/collaborations/${collabId}/respond`, { method: "POST", body: { accept: true } })).status).toBe(404);
    // Can't create the activity before the partner agrees.
    const early = await as(me, "/games", { method: "POST", body: { activityLabel: "Joint swim and walk", date: DAY, time: "10:00", capacity: 10, locationText: "Seapoint", circleId: circleA, collaborationId: collabId } });
    expect(early.status).toBe(409);
    expect((await as(other, `/circles/${circleB}/collaborations/${collabId}/respond`, { method: "POST", body: { accept: true } })).status).toBe(200);
    expect((await as(other, `/circles/${circleB}/collaborations/${collabId}/respond`, { method: "POST", body: { accept: true } })).status).toBe(409);
  });
  it("the activity belongs to the proposer and is visible to the partner's members, not to outsiders", async () => {
    const made = await as(me, "/games", { method: "POST", body: { activityLabel: "Joint swim and walk", date: DAY, time: "10:00", capacity: 10, locationText: "Seapoint", circleId: circleA, collaborationId: collabId } });
    expect(made.status).toBe(201);
    const game = (await made.json()) as { id: string; circleId: string; visibility: string; partnerCircle: { id: string } };
    expect(game).toMatchObject({ circleId: circleA, visibility: "circle", partnerCircle: { id: circleB } });
    expect((await as(other, `/games/${game.id}`)).status).toBe(200);
    expect((await as(outsider, `/games/${game.id}`)).status).toBe(404);
    const again = await as(me, "/games", { method: "POST", body: { activityLabel: "Dup", date: DAY, time: "12:00", capacity: 10, locationText: "Seapoint", circleId: circleA, collaborationId: collabId } });
    expect(again.status).toBe(409);
    const upcoming = (await (await as(other, `/circles/${circleB}/upcoming`)).json()) as { id: string; source: string }[];
    expect(upcoming.find((u) => u.id === game.id)?.source).toBe("circle");
    const note = await db.prepare(`SELECT title FROM notifications WHERE resident_id = ? AND listing_id = ?`).get(other, game.id);
    expect(note).toBeTruthy();
  });
});
