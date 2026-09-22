import crypto from "node:crypto";
import http, { type Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../db/index.js";
import { circlesRouter } from "./circles.js";
import { gamesRouter } from "./games.js";

// Phase 2 "Circles V2" — circles.ts previously had ZERO test coverage at
// all (confirmed via research). This covers both a regression baseline for
// the pre-existing organiser/membership/poll behaviour this phase builds on
// top of, and the new plan-idea lifecycle + Plan->Activity conversion
// (including the concurrency guarantee that's the whole point of the
// idempotency guard in games.ts's createGameRow).
//
// Both routers are mounted (matching how index.ts mounts them for real)
// since Plan->Activity conversion is a genuine cross-file flow: circles.ts
// owns the plan-idea state machine, games.ts's POST / owns turning a
// confirmed plan into a real Game.

let server: Server;
let baseUrl: string;

const organiserId = `test-organiser-${crypto.randomUUID()}`;
const memberId = `test-member-${crypto.randomUUID()}`;
const outsiderId = `test-outsider-${crypto.randomUUID()}`;
const circleId = `test-circle-${crypto.randomUUID()}`;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const residentId = req.header("X-Test-Resident-Id");
    if (residentId) (req as any).resident = { id: residentId, name: `Resident ${residentId.slice(-4)}` };
    next();
  });
  app.use("/circles", circlesRouter);
  app.use("/games", gamesRouter);

  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Failed to bind test server");
  baseUrl = `http://127.0.0.1:${address.port}`;

  await db.prepare(`INSERT INTO residents (id, email, name) VALUES (?, ?, 'Test Organiser')`).run(organiserId, `${organiserId}@example.test`);
  await db.prepare(`INSERT INTO residents (id, email, name) VALUES (?, ?, 'Test Member')`).run(memberId, `${memberId}@example.test`);
  await db.prepare(`INSERT INTO residents (id, email, name) VALUES (?, ?, 'Test Outsider')`).run(outsiderId, `${outsiderId}@example.test`);

  await db
    .prepare(`INSERT INTO circles (id, name, activity_label, area, county, about, created_by_resident_id) VALUES (?, 'Test Circle', 'Testball', 'Test Area', 'Dublin', '', ?)`)
    .run(circleId, organiserId);
  await db.prepare(`INSERT INTO circle_members (circle_id, resident_id, role) VALUES (?, ?, 'organiser')`).run(circleId, organiserId);
  await db.prepare(`INSERT INTO circle_members (circle_id, resident_id, role) VALUES (?, ?, 'member')`).run(circleId, memberId);
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await db.prepare(`DELETE FROM notifications WHERE listing_id = ?`).run(circleId);
  await db.prepare(`DELETE FROM circle_poll_votes WHERE poll_id IN (SELECT id FROM circle_polls WHERE circle_id = ?)`).run(circleId);
  await db.prepare(`DELETE FROM circle_poll_options WHERE poll_id IN (SELECT id FROM circle_polls WHERE circle_id = ?)`).run(circleId);
  await db.prepare(`DELETE FROM circle_polls WHERE circle_id = ?`).run(circleId);
  await db.prepare(`DELETE FROM game_participants WHERE game_id IN (SELECT id FROM games WHERE circle_id = ?)`).run(circleId);
  await db.prepare(`DELETE FROM games WHERE circle_id = ?`).run(circleId);
  await db.prepare(`DELETE FROM circle_plans WHERE circle_id = ?`).run(circleId);
  await db.prepare(`DELETE FROM circle_members WHERE circle_id = ?`).run(circleId);
  await db.prepare(`DELETE FROM circles WHERE id = ?`).run(circleId);
  await db.prepare(`DELETE FROM residents WHERE id IN (?, ?, ?)`).run(organiserId, memberId, outsiderId);
});

// --- regression baseline for pre-existing behaviour this phase builds on ---

describe("regression: existing organiser/membership/poll behaviour", () => {
  it("GET /:id/plans (the pre-existing, untouched endpoint) is organiser-only", async () => {
    const asOutsider = await fetch(`${baseUrl}/circles/${circleId}/plans`, { headers: { "X-Test-Resident-Id": outsiderId } });
    expect(asOutsider.status).toBe(403);
    const asOrganiser = await fetch(`${baseUrl}/circles/${circleId}/plans`, { headers: { "X-Test-Resident-Id": organiserId } });
    expect(asOrganiser.status).toBe(200);
  });

  it("standalone poll creation (no planId) still works exactly as before", async () => {
    const res = await fetch(`${baseUrl}/circles/${circleId}/polls`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Test-Resident-Id": memberId },
      body: JSON.stringify({ question: "Saturday or Sunday?", options: [{ date: "2099-01-04" }, { date: "2099-01-05" }] }),
    });
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: string };
    const row = (await db.prepare(`SELECT plan_id as planId FROM circle_polls WHERE id = ?`).get(id)) as { planId: string | null };
    expect(row.planId).toBeNull();
  });
});

// --- plan-idea creation permissions ---

describe("POST /:id/plan-ideas", () => {
  it("a member can propose a plan-idea", async () => {
    const res = await fetch(`${baseUrl}/circles/${circleId}/plan-ideas`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Test-Resident-Id": memberId },
      body: JSON.stringify({ title: "Coastal Walk", note: "Meet at the station", proposedDate: "2099-02-01", proposedTime: "10:00" }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string; status: string; title: string };
    expect(body.status).toBe("idea");
    expect(body.title).toBe("Coastal Walk");
  });

  it("a non-member is rejected", async () => {
    const res = await fetch(`${baseUrl}/circles/${circleId}/plan-ideas`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Test-Resident-Id": outsiderId },
      body: JSON.stringify({ title: "Should not be created" }),
    });
    expect(res.status).toBe(403);
  });

  it("requires a title", async () => {
    const res = await fetch(`${baseUrl}/circles/${circleId}/plan-ideas`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Test-Resident-Id": memberId },
      body: JSON.stringify({ note: "no title here" }),
    });
    expect(res.status).toBe(400);
  });
});

// --- state transitions ---

describe("plan-idea lifecycle", () => {
  let planId: string;

  beforeAll(async () => {
    const res = await fetch(`${baseUrl}/circles/${circleId}/plan-ideas`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Test-Resident-Id": memberId },
      body: JSON.stringify({ title: "Sunday Hike", proposedDate: "2099-03-01" }),
    });
    ({ id: planId } = (await res.json()) as { id: string });
  });

  it("a member cannot confirm a plan (organiser-only)", async () => {
    const res = await fetch(`${baseUrl}/circles/${circleId}/plan-ideas/${planId}/confirm`, { method: "POST", headers: { "X-Test-Resident-Id": memberId } });
    expect(res.status).toBe(403);
  });

  it("the creator can cancel their own idea", async () => {
    const cancelRes = await fetch(`${baseUrl}/circles/${circleId}/plan-ideas/${planId}/cancel`, { method: "POST", headers: { "X-Test-Resident-Id": memberId } });
    expect(cancelRes.status).toBe(200);
    const detail = await fetch(`${baseUrl}/circles/${circleId}/plan-ideas/${planId}`);
    const body = (await detail.json()) as { status: string };
    expect(body.status).toBe("cancelled");
  });

  it("a cancelled plan cannot be confirmed (invalid transition)", async () => {
    const res = await fetch(`${baseUrl}/circles/${circleId}/plan-ideas/${planId}/confirm`, { method: "POST", headers: { "X-Test-Resident-Id": organiserId } });
    expect(res.status).toBe(409);
  });

  it("a different member cannot cancel someone else's idea", async () => {
    const createRes = await fetch(`${baseUrl}/circles/${circleId}/plan-ideas`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Test-Resident-Id": memberId },
      body: JSON.stringify({ title: "Another idea" }),
    });
    const { id: otherPlanId } = (await createRes.json()) as { id: string };
    // outsiderId isn't even a circle member, but this also proves a random
    // member/non-organiser can't cancel someone else's idea regardless.
    const res = await fetch(`${baseUrl}/circles/${circleId}/plan-ideas/${otherPlanId}/cancel`, { method: "POST", headers: { "X-Test-Resident-Id": outsiderId } });
    expect(res.status).toBe(403);
  });
});

// --- poll <-> plan association ---

describe("poll <-> plan association", () => {
  it("creating a poll with planId links it, and GET ?planId= filters to it", async () => {
    const planRes = await fetch(`${baseUrl}/circles/${circleId}/plan-ideas`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Test-Resident-Id": memberId },
      body: JSON.stringify({ title: "Poll-linked Plan" }),
    });
    const { id: planId } = (await planRes.json()) as { id: string };

    const pollRes = await fetch(`${baseUrl}/circles/${circleId}/polls`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Test-Resident-Id": memberId },
      body: JSON.stringify({ question: "Which time?", options: [{ date: "2099-04-01", time: "09:00" }, { date: "2099-04-01", time: "18:00" }], planId }),
    });
    expect(pollRes.status).toBe(201);
    const { id: pollId } = (await pollRes.json()) as { id: string };

    const filtered = await fetch(`${baseUrl}/circles/${circleId}/polls?planId=${planId}`);
    const polls = (await filtered.json()) as { id: string }[];
    expect(polls.some((p) => p.id === pollId)).toBe(true);

    const row = (await db.prepare(`SELECT plan_id as planId FROM circle_polls WHERE id = ?`).get(pollId)) as { planId: string };
    expect(row.planId).toBe(planId);
  });
});

// --- Plan -> Activity conversion ---

describe("Plan -> Activity conversion", () => {
  let planId: string;

  beforeAll(async () => {
    const createRes = await fetch(`${baseUrl}/circles/${circleId}/plan-ideas`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Test-Resident-Id": memberId },
      body: JSON.stringify({ title: "Confirmed Walk", proposedDate: "2099-05-01", proposedTime: "10:00", locationText: "Bray Station" }),
    });
    ({ id: planId } = (await createRes.json()) as { id: string });
    const confirmRes = await fetch(`${baseUrl}/circles/${circleId}/plan-ideas/${planId}/confirm`, { method: "POST", headers: { "X-Test-Resident-Id": organiserId } });
    expect(confirmRes.status).toBe(200);
  });

  afterAll(async () => {
    await db.prepare(`DELETE FROM game_participants WHERE game_id IN (SELECT id FROM games WHERE plan_id = ?)`).run(planId);
    await db.prepare(`DELETE FROM games WHERE plan_id = ?`).run(planId);
  });

  it("a non-organiser cannot convert a confirmed plan into an activity", async () => {
    const res = await fetch(`${baseUrl}/games`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Test-Resident-Id": memberId },
      body: JSON.stringify({ activityLabel: "Confirmed Walk", date: "2099-05-01", time: "10:00", capacity: 10, locationText: "Bray Station", circleId, planId }),
    });
    expect(res.status).toBe(403);
  });

  it("the organiser can convert a confirmed plan into a real activity, linked both ways", async () => {
    const res = await fetch(`${baseUrl}/games`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Test-Resident-Id": organiserId },
      body: JSON.stringify({ activityLabel: "Confirmed Walk", date: "2099-05-01", time: "10:00", capacity: 10, locationText: "Bray Station", circleId, planId }),
    });
    expect(res.status).toBe(201);
    const game = (await res.json()) as { id: string };

    const planDetail = await fetch(`${baseUrl}/circles/${circleId}/plan-ideas/${planId}`);
    const planBody = (await planDetail.json()) as { status: string; activitySourceId: string; activity: { id: string } | null };
    expect(planBody.status).toBe("activity_created");
    expect(planBody.activitySourceId).toBe(game.id);
    expect(planBody.activity?.id).toBe(game.id);

    // Existing games.circle_id-linked listing (GET /:id/plans, untouched)
    // picks up this same game — confirms backward compatibility.
    const plansListRes = await fetch(`${baseUrl}/circles/${circleId}/plans`, { headers: { "X-Test-Resident-Id": organiserId } });
    const plansList = (await plansListRes.json()) as { id: string }[];
    expect(plansList.some((g) => g.id === game.id)).toBe(true);
  });

  it("converting the same plan again is rejected — no duplicate game", async () => {
    const res = await fetch(`${baseUrl}/games`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Test-Resident-Id": organiserId },
      body: JSON.stringify({ activityLabel: "Confirmed Walk", date: "2099-05-01", time: "10:00", capacity: 10, locationText: "Bray Station", circleId, planId }),
    });
    expect(res.status).toBe(409);
  });

  it("two concurrent conversion attempts for the same plan produce exactly one game", async () => {
    // Fresh plan for this test — the ones above are already activity_created.
    const createRes = await fetch(`${baseUrl}/circles/${circleId}/plan-ideas`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Test-Resident-Id": memberId },
      body: JSON.stringify({ title: "Race Condition Walk", proposedDate: "2099-06-01", proposedTime: "10:00", locationText: "Test Location" }),
    });
    const { id: racePlanId } = (await createRes.json()) as { id: string };
    await fetch(`${baseUrl}/circles/${circleId}/plan-ideas/${racePlanId}/confirm`, { method: "POST", headers: { "X-Test-Resident-Id": organiserId } });

    const convert = () =>
      fetch(`${baseUrl}/games`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Test-Resident-Id": organiserId },
        body: JSON.stringify({ activityLabel: "Race Condition Walk", date: "2099-06-01", time: "10:00", capacity: 10, locationText: "Test Location", circleId, planId: racePlanId }),
      });

    const [resA, resB] = await Promise.all([convert(), convert()]);
    const statuses = [resA.status, resB.status].sort();
    expect(statuses).toEqual([201, 409]);

    const { n } = (await db.prepare(`SELECT COUNT(*) as n FROM games WHERE plan_id = ?`).get(racePlanId)) as { n: number };
    expect(n).toBe(1);

    await db.prepare(`DELETE FROM game_participants WHERE game_id IN (SELECT id FROM games WHERE plan_id = ?)`).run(racePlanId);
    await db.prepare(`DELETE FROM games WHERE plan_id = ?`).run(racePlanId);
  });

  it("cannot cancel a plan once it has become an activity — the activity owns cancellation", async () => {
    const res = await fetch(`${baseUrl}/circles/${circleId}/plan-ideas/${planId}/cancel`, { method: "POST", headers: { "X-Test-Resident-Id": organiserId } });
    expect(res.status).toBe(409);
  });
});
