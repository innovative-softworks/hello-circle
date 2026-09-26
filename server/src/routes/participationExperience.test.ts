import crypto from "node:crypto";
import http, { type Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../db/index.js";
import { normalizeAvailability, normalizeGoals } from "../participationVocab.js";
import { gamesRouter } from "./games.js";
import { residentsRouter } from "./residents.js";
import { vendorParticipationRouter } from "./vendorParticipation.js";

// Community participation upgrade, Release 2 — real-DB tests (same
// hello_circle_dev + stubbed-identity approach as games.test.ts): legacy
// vocabulary compatibility, the goal cap, clearing preferences, game
// attribute ↔ solo_friendly sync, the first-timer count threshold/opt-out,
// and the vendor participation editor's ownership and role gating.

let server: Server;
let baseUrl: string;
const run = crypto.randomUUID().slice(0, 8);
const LABEL = `Test Participation ${run}`;
const resId = `test-pe-res-${run}`;
const hostId = `test-pe-host-${run}`;
const playerIds = [0, 1, 2, 3].map((i) => `test-pe-p${i}-${run}`);
const earlierGameId = `test-pe-earlier-${run}`;
let club: { id: string; vendorId: string };
let experience: { id: string; vendorId: string };
let program: { id: string; vendorId: string };
const createdGameIds: string[] = [];

function call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
const asResident = (id: string) => ({ "X-Test-Resident-Id": id });
const asVendor = (vendorId: string, extra: Record<string, string> = {}) => ({ "X-Test-Vendor-Id": vendorId, ...extra });
const iso = (days: number) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const residentId = req.header("X-Test-Resident-Id");
    if (residentId) (req as any).resident = { id: residentId, name: "Test" };
    const vendorId = req.header("X-Test-Vendor-Id");
    if (vendorId) {
      const staffRole = req.header("X-Test-Staff-Role");
      (req as any).user = { id: vendorId, role: "vendor", status: "approved", invitedStaff: !!staffRole, platformRole: staffRole ?? null };
      (req as any).vendorIds = [vendorId];
    }
    next();
  });
  app.use("/residents", residentsRouter);
  app.use("/games", gamesRouter);
  app.use("/vendor", vendorParticipationRouter);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Failed to bind test server");
  baseUrl = `http://127.0.0.1:${address.port}`;

  for (const id of [resId, hostId, ...playerIds]) {
    await db.prepare(`INSERT INTO residents (id, email, name) VALUES (?, ?, ?)`).run(id, `${id}@example.test`, id);
  }
  club = (await db.prepare(`SELECT id, vendor_id as vendorId FROM clubs WHERE vendor_id IS NOT NULL LIMIT 1`).get()) as typeof club;
  experience = (await db.prepare(`SELECT id, vendor_id as vendorId FROM experiences LIMIT 1`).get()) as typeof experience;
  program = (await db.prepare(`SELECT id, vendor_id as vendorId FROM programs LIMIT 1`).get()) as typeof program;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  const games = [...createdGameIds, earlierGameId];
  const marks = games.map(() => "?").join(", ");
  await db.prepare(`DELETE FROM listing_attributes WHERE listing_type = 'game' AND listing_id IN (${marks})`).run(...games);
  await db.prepare(`DELETE FROM game_participants WHERE game_id IN (${marks})`).run(...games);
  await db.prepare(`DELETE FROM notifications WHERE listing_id IN (${marks})`).run(...games);
  await db.prepare(`DELETE FROM games WHERE id IN (${marks})`).run(...games);
  for (const [type, id] of [["club", club.id], ["experience", experience.id], ["program", program.id]]) {
    await db.prepare(`DELETE FROM listing_attributes WHERE listing_type = ? AND listing_id = ?`).run(type, id);
  }
  await db.prepare(`UPDATE experiences SET accessibility_info = NULL WHERE id = ?`).run(experience.id);
  await db.prepare(`UPDATE programs SET arrival_instructions = NULL, accessibility_info = NULL WHERE id = ?`).run(program.id);
  const ids = [resId, hostId, ...playerIds];
  await db.prepare(`DELETE FROM analytics_events WHERE resident_id IN (${ids.map(() => "?").join(", ")})`).run(...ids);
  await db.prepare(`DELETE FROM residents WHERE id IN (${ids.map(() => "?").join(", ")})`).run(...ids);
});

describe("vocabulary", () => {
  it("maps legacy goals to the new list, dedupes and caps at three", () => {
    expect(normalizeGoals(["Become more active", "Get outdoors", "Meet new people"])).toEqual(["Get active", "Meet people"]);
    expect(normalizeGoals(["Volunteer", "Get active", "Learn something", "Meet people"])).toEqual(["Volunteer", "Get active", "Learn something"]);
    expect(normalizeGoals(["not a goal"])).toEqual([]);
  });
  it("expands legacy availability labels into day:slot tokens, in calendar order", () => {
    expect(normalizeAvailability(["Sunday", "fri:evening"])).toEqual(["fri:evening", "sun:morning", "sun:afternoon", "sun:evening"]);
    expect(normalizeAvailability(["Weekday mornings"])).toHaveLength(5);
    expect(normalizeAvailability(["sat:brunch"])).toEqual([]);
  });
});

describe("PUT /residents/me/onboarding", () => {
  const me = async () => (await (await call("GET", "/residents/me", undefined, asResident(resId))).json()).resident;

  it("accepts an old native build's legacy values and stores the new ones", async () => {
    const res = await call("PUT", "/residents/me/onboarding", { goals: ["Do more with family", "Explore my area"], availability: ["Saturday"] }, asResident(resId));
    expect(res.status).toBe(200);
    const r = await me();
    expect(r.goals).toEqual(["Family activities", "Explore locally"]);
    expect(r.availability).toEqual(["sat:morning", "sat:afternoon", "sat:evening"]);
  });

  it("caps goals at three and saves the new comfort preferences", async () => {
    await call("PUT", "/residents/me/onboarding", { goals: ["Meet people", "Get active", "Volunteer", "Learn something"], prefFirstTimer: true, prefFamily: true }, asResident(resId));
    const r = await me();
    expect(r.goals).toEqual(["Meet people", "Get active", "Volunteer"]);
    expect(r).toMatchObject({ prefFirstTimer: true, prefFamily: true });
  });

  it("clears every preference on DELETE /me/preferences", async () => {
    expect((await call("DELETE", "/residents/me/preferences", undefined, asResident(resId))).status).toBe(200);
    const r = await me();
    expect(r).toMatchObject({ goals: [], availability: [], interests: [], prefFirstTimer: false, prefFamily: false, prefSoloFriendly: false });
  });
});

describe("game participation attributes", () => {
  const base = { activityLabel: LABEL, locationText: "Test park", date: iso(4), time: "10:00", capacity: 10 };
  const get = async (id: string) => (await (await call("GET", `/games/${id}`, undefined, asResident(hostId))).json());
  const solo = async (id: string) => ((await db.prepare(`SELECT solo_friendly FROM games WHERE id = ?`).get(id)) as { solo_friendly: number }).solo_friendly;

  it("stores the host's attributes and keeps solo_friendly in sync with come_alone", async () => {
    const res = await call("POST", "/games", { ...base, participationAttributes: ["beginner_friendly", "come_alone", "bogus"], experienceRequired: "None" }, asResident(hostId));
    expect(res.status).toBe(201);
    const { id } = await res.json();
    createdGameIds.push(id);
    const g = await get(id);
    expect(g.participationAttributes).toEqual(["come_alone", "beginner_friendly"]);
    expect(g.experienceRequired).toBe("None");
    expect(await solo(id)).toBe(1);

    // An older client sends only soloFriendly and no new fields: come_alone
    // follows it, the other attribute and experienceRequired survive.
    await call("PUT", `/games/${id}`, { ...base, soloFriendly: false }, asResident(hostId));
    const g2 = await get(id);
    expect(g2.participationAttributes).toEqual(["beginner_friendly"]);
    expect(g2.experienceRequired).toBe("None");
    expect(await solo(id)).toBe(0);

    // "" is an explicit clear.
    await call("PUT", `/games/${id}`, { ...base, participationAttributes: [], experienceRequired: "" }, asResident(hostId));
    const g3 = await get(id);
    expect(g3.participationAttributes).toEqual([]);
    expect(g3.experienceRequired).toBeNull();
  });

  it("counts first-timers only from three up, and respects the opt-out", async () => {
    const res = await call("POST", "/games", base, asResident(hostId));
    const { id } = await res.json();
    createdGameIds.push(id);
    // p0 already did this activity before; p1..p2 are new to it.
    await db
      .prepare(`INSERT INTO games (id, host_resident_id, activity_label, location_text, date, time, capacity, status) VALUES (?, ?, ?, 'x', ?, '09:00', 5, 'open')`)
      .run(earlierGameId, hostId, LABEL.toLowerCase(), iso(-10));
    await db.prepare(`INSERT INTO game_participants (game_id, resident_id, status) VALUES (?, ?, 'joined')`).run(earlierGameId, playerIds[0]);
    for (const p of playerIds.slice(0, 3)) await db.prepare(`INSERT INTO game_participants (game_id, resident_id, status) VALUES (?, ?, 'joined')`).run(id, p);

    expect((await get(id)).firstTimerCount).toBeNull(); // 2 first-timers — below the threshold

    await db.prepare(`INSERT INTO game_participants (game_id, resident_id, status) VALUES (?, ?, 'joined')`).run(id, playerIds[3]);
    expect((await get(id)).firstTimerCount).toBe(3);

    await db.prepare(`UPDATE residents SET hide_from_familiar_count = 1 WHERE id = ?`).run(playerIds[3]);
    expect((await get(id)).firstTimerCount).toBeNull();
  });
});

describe("vendor participation editor", () => {
  it("lets the owning vendor set attributes and only their type's fields", async () => {
    const res = await call("PUT", `/vendor/participation/club/${club.id}`, { attributes: ["small_group", "family_friendly"], accessibilityInfo: "ignored for clubs" }, asVendor(club.vendorId));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ attributes: ["small_group", "family_friendly"], circleId: null });

    const exp = await (await call("PUT", `/vendor/participation/experience/${experience.id}`, { attributes: ["accessible"], accessibilityInfo: "Step-free first 2 km" }, asVendor(experience.vendorId))).json();
    expect(exp).toMatchObject({ attributes: ["accessible"], accessibilityInfo: "Step-free first 2 km" });

    const prog = await (await call("PUT", `/vendor/participation/program/${program.id}`, { arrivalInstructions: "Reception, 10 min early" }, asVendor(program.vendorId))).json();
    expect(prog).toMatchObject({ arrivalInstructions: "Reception, 10 min early", accessibilityInfo: "" });
  });

  it("refuses another vendor, and invited staff without the listing's role", async () => {
    expect((await call("PUT", `/vendor/participation/club/${club.id}`, { attributes: [] }, asVendor(`someone-else-${run}`))).status).toBe(403);
    expect((await call("PUT", `/vendor/participation/club/${club.id}`, { attributes: [] }, asVendor(club.vendorId, { "X-Test-Staff-Role": "finance" }))).status).toBe(403);
    expect((await call("GET", `/vendor/participation/club/${club.id}`, undefined, asVendor(club.vendorId, { "X-Test-Staff-Role": "facility_manager" }))).status).toBe(200);
    expect((await call("GET", `/vendor/participation/nonsense/${club.id}`, undefined, asVendor(club.vendorId))).status).toBe(400);
  });
});
