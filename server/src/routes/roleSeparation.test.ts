import crypto from "node:crypto";
import http, { type Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { requireVendor } from "../auth.js";
import { db } from "../db/index.js";
import { irelandTodayIso } from "../irelandTime.js";
import { circlesRouter } from "./circles.js";
import { gamesRouter } from "./games.js";

// Role-activity validation (2026-10-30, docs/participation-expansion/
// role-activity-validation/09) — negative tests 4, 5 and 18: Circle powers
// stop at the Circle, hosting stays with the host, and a resident session
// gives nothing in the partner workspace.

let server: Server;
let base: string;
const t = crypto.randomUUID().slice(0, 8);
const orgA = `rs-orgA-${t}`; // organiser of Circle A
const orgB = `rs-orgB-${t}`; // organiser of Circle B
const member = `rs-member-${t}`; // member of A, hosts A's Saturday walk
const joiner = `rs-joiner-${t}`;
const circleA = `rs-circleA-${t}`;
const circleB = `rs-circleB-${t}`;
const walk = `rs-walk-${t}`;
const date = new Date(Date.parse(`${irelandTodayIso()}T12:00:00Z`) + 7 * 86_400_000).toISOString().slice(0, 10);

const call = async (method: string, path: string, resident: string | null, body?: unknown) => {
  const r = await fetch(`${base}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(resident ? { "X-Test-Resident-Id": resident } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return r.status;
};

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const id = req.header("X-Test-Resident-Id");
    if (id) (req as any).resident = { id, name: id };
    next();
  });
  app.use("/circles", circlesRouter);
  app.use("/games", gamesRouter);
  app.use("/api/vendor", requireVendor, (_req, res) => res.json({ reached: true }));
  server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, r));
  const a = server.address();
  if (!a || typeof a === "string") throw new Error("bind");
  base = `http://127.0.0.1:${a.port}`;
  for (const id of [orgA, orgB, member, joiner]) await db.prepare(`INSERT INTO residents (id, email, name) VALUES (?, ?, ?)`).run(id, `${id}@example.test`, id);
  for (const [c, owner] of [[circleA, orgA], [circleB, orgB]]) {
    await db.prepare(`INSERT INTO circles (id, name, activity_label, area, county, about, created_by_resident_id) VALUES (?, ?, 'Walking', 'Howth', 'Dublin', '', ?)`).run(c, `Walkers ${c}`, owner);
    await db.prepare(`INSERT INTO circle_members (circle_id, resident_id, role) VALUES (?, ?, 'organiser')`).run(c, owner);
  }
  await db.prepare(`INSERT INTO circle_members (circle_id, resident_id, role) VALUES (?, ?, 'member'), (?, ?, 'member')`).run(circleA, member, circleB, joiner);
  // A Circle-linked activity hosted by a member, not by the organiser.
  await db
    .prepare(`INSERT INTO games (id, host_resident_id, activity_label, location_text, date, time, capacity, status, visibility, lifecycle, circle_id) VALUES (?, ?, 'Saturday coastal walk', 'Howth', ?, '10:00', 12, 'open', 'public', 'active', ?)`)
    .run(walk, member, date, circleA);
  await db.prepare(`INSERT INTO game_participants (game_id, resident_id) VALUES (?, ?), (?, ?)`).run(walk, member, walk, joiner);
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  await db.prepare(`DELETE FROM game_participants WHERE game_id = ?`).run(walk);
  await db.prepare(`DELETE FROM games WHERE id = ?`).run(walk);
  await db.prepare(`DELETE FROM circle_members WHERE circle_id IN (?, ?)`).run(circleA, circleB);
  await db.prepare(`DELETE FROM circles WHERE id IN (?, ?)`).run(circleA, circleB);
  await db.prepare(`DELETE FROM residents WHERE id IN (?, ?, ?, ?)`).run(orgA, orgB, member, joiner);
});

describe("role separation: Circle, host and partner contexts", () => {
  it("an organiser can't manage another Circle (test 5)", async () => {
    expect(await call("PUT", `/circles/${circleB}`, orgA, { name: "Taken over" })).toBe(403);
    expect(await call("POST", `/circles/${circleB}/members/${joiner}/promote`, orgA)).toBe(403);
    expect(await call("POST", `/circles/${circleB}/members/${joiner}/remove`, orgA)).toBe(403);
    expect(await call("POST", `/circles/${circleB}/announcements`, orgA, { body: "hello" })).toBe(403);
    const name = (await db.prepare(`SELECT name FROM circles WHERE id = ?`).get(circleB)) as { name: string };
    expect(name.name).toBe(`Walkers ${circleB}`);
  });

  it("a member can't make an activity the Circle's own, and can't manage the Circle (test 4)", async () => {
    expect(await call("POST", `/games`, member, { activityLabel: "Walk", date, time: "10:00", capacity: 8, locationText: "Howth", circleId: circleA })).toBe(403);
    expect(await call("PUT", `/circles/${circleA}`, member, { name: "Mine" })).toBe(403);
  });

  it("the Circle organiser doesn't manage an activity a member hosts (host-only)", async () => {
    expect(await call("GET", `/games/${walk}/participants/manage`, orgA)).toBe(403);
    expect(await call("POST", `/games/${walk}/cancel`, orgA, {})).toBe(403);
    expect(await call("PUT", `/games/${walk}`, orgA, { activityLabel: "Taken over", date, time: "10:00", capacity: 2, locationText: "Howth" })).toBe(403);
    expect(await call("POST", `/games/${walk}/participants/${joiner}/remove`, orgA, {})).toBe(403);
    expect(await call("GET", `/games/${walk}/participants/manage`, member)).toBe(200);
    expect(((await db.prepare(`SELECT status, capacity FROM games WHERE id = ?`).get(walk)) as { status: string; capacity: number })).toEqual({ status: "open", capacity: 12 });
  });

  it("a resident session (host or organiser) reaches nothing in the partner workspace (test 18)", async () => {
    expect(await call("GET", `/api/vendor/listings`, orgA)).toBe(401);
    expect(await call("GET", `/api/vendor/door/sessions`, member)).toBe(401);
  });
});
