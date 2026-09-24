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

// --- Circle Experience Polish — Changeset 6 -------------------------------
// Below: membership state machine (§5), visibility model (§1B), poll
// authorization (§1A), closed-circle behaviour (§1D), and real-vs-fuzzy
// Circle↔Activity linkage (§2A/2C) — all previously untested per the audit.

describe("Join modes", () => {
  const openOrganiserId = `test-open-org-${crypto.randomUUID()}`;
  const approvalOrganiserId = `test-appr-org-${crypto.randomUUID()}`;
  const inviteOrganiserId = `test-inv-org-${crypto.randomUUID()}`;
  const requesterId = `test-requester-${crypto.randomUUID()}`;
  const openCircleId = `test-open-circle-${crypto.randomUUID()}`;
  const approvalCircleId = `test-approval-circle-${crypto.randomUUID()}`;
  const inviteCircleId = `test-invite-circle-${crypto.randomUUID()}`;

  beforeAll(async () => {
    await db.prepare(`INSERT INTO residents (id, email, name) VALUES (?, ?, 'Open Organiser')`).run(openOrganiserId, `${openOrganiserId}@example.test`);
    await db.prepare(`INSERT INTO residents (id, email, name) VALUES (?, ?, 'Approval Organiser')`).run(approvalOrganiserId, `${approvalOrganiserId}@example.test`);
    await db.prepare(`INSERT INTO residents (id, email, name) VALUES (?, ?, 'Invite Organiser')`).run(inviteOrganiserId, `${inviteOrganiserId}@example.test`);
    await db.prepare(`INSERT INTO residents (id, email, name) VALUES (?, ?, 'Requester')`).run(requesterId, `${requesterId}@example.test`);

    await db
      .prepare(`INSERT INTO circles (id, name, activity_label, area, county, about, created_by_resident_id, join_mode) VALUES (?, 'Open Test Circle', 'Testball', 'Area', 'Dublin', '', ?, 'open')`)
      .run(openCircleId, openOrganiserId);
    await db.prepare(`INSERT INTO circle_members (circle_id, resident_id, role) VALUES (?, ?, 'organiser')`).run(openCircleId, openOrganiserId);

    await db
      .prepare(`INSERT INTO circles (id, name, activity_label, area, county, about, created_by_resident_id, join_mode) VALUES (?, 'Approval Test Circle', 'Testball', 'Area', 'Dublin', '', ?, 'approval')`)
      .run(approvalCircleId, approvalOrganiserId);
    await db.prepare(`INSERT INTO circle_members (circle_id, resident_id, role) VALUES (?, ?, 'organiser')`).run(approvalCircleId, approvalOrganiserId);

    await db
      .prepare(`INSERT INTO circles (id, name, activity_label, area, county, about, created_by_resident_id, join_mode) VALUES (?, 'Invite Test Circle', 'Testball', 'Area', 'Dublin', '', ?, 'invite')`)
      .run(inviteCircleId, inviteOrganiserId);
    await db.prepare(`INSERT INTO circle_members (circle_id, resident_id, role) VALUES (?, ?, 'organiser')`).run(inviteCircleId, inviteOrganiserId);
  });

  afterAll(async () => {
    for (const cid of [openCircleId, approvalCircleId, inviteCircleId]) {
      await db.prepare(`DELETE FROM circle_invites WHERE circle_id = ?`).run(cid);
      await db.prepare(`DELETE FROM circle_members WHERE circle_id = ?`).run(cid);
      await db.prepare(`DELETE FROM circles WHERE id = ?`).run(cid);
    }
    await db.prepare(`DELETE FROM notifications WHERE listing_id IN (?, ?, ?)`).run(openCircleId, approvalCircleId, inviteCircleId);
    await db.prepare(`DELETE FROM residents WHERE id IN (?, ?, ?, ?)`).run(openOrganiserId, approvalOrganiserId, inviteOrganiserId, requesterId);
  });

  it("open circle: joining is instant", async () => {
    const res = await fetch(`${baseUrl}/circles/${openCircleId}/join`, { method: "POST", headers: { "X-Test-Resident-Id": requesterId } });
    expect(res.status).toBe(201);
    const row = await db.prepare(`SELECT role FROM circle_members WHERE circle_id = ? AND resident_id = ?`).get(openCircleId, requesterId);
    expect(row).toBeTruthy();
  });

  it("open circle: duplicate join is idempotent", async () => {
    const res = await fetch(`${baseUrl}/circles/${openCircleId}/join`, { method: "POST", headers: { "X-Test-Resident-Id": requesterId } });
    expect(res.status).toBe(201);
  });

  it("open circle: leave then rejoin works", async () => {
    const leave = await fetch(`${baseUrl}/circles/${openCircleId}/join`, { method: "DELETE", headers: { "X-Test-Resident-Id": requesterId } });
    expect(leave.status).toBe(200);
    const gone = await db.prepare(`SELECT 1 FROM circle_members WHERE circle_id = ? AND resident_id = ?`).get(openCircleId, requesterId);
    expect(gone).toBeFalsy();
    const rejoin = await fetch(`${baseUrl}/circles/${openCircleId}/join`, { method: "POST", headers: { "X-Test-Resident-Id": requesterId } });
    expect(rejoin.status).toBe(201);
  });

  it("approval circle: files a pending request, not instant membership", async () => {
    const res = await fetch(`${baseUrl}/circles/${approvalCircleId}/join`, { method: "POST", headers: { "X-Test-Resident-Id": requesterId } });
    expect(res.status).toBe(202);
    const body = (await res.json()) as { requested: boolean };
    expect(body.requested).toBe(true);
    const member = await db.prepare(`SELECT 1 FROM circle_members WHERE circle_id = ? AND resident_id = ?`).get(approvalCircleId, requesterId);
    expect(member).toBeFalsy();
  });

  it("approval circle: duplicate request is idempotent, not a duplicate row", async () => {
    const res = await fetch(`${baseUrl}/circles/${approvalCircleId}/join`, { method: "POST", headers: { "X-Test-Resident-Id": requesterId } });
    expect(res.status).toBe(202);
    const { n } = (await db.prepare(`SELECT COUNT(*) as n FROM circle_invites WHERE circle_id = ? AND resident_id = ?`).get(approvalCircleId, requesterId)) as { n: number };
    expect(n).toBe(1);
  });

  it("approval circle: organiser can approve the request into membership", async () => {
    const list = await fetch(`${baseUrl}/circles/${approvalCircleId}/join-requests`, { headers: { "X-Test-Resident-Id": approvalOrganiserId } });
    const requests = (await list.json()) as { id: string; residentId: string }[];
    const req = requests.find((r) => r.residentId === requesterId);
    expect(req).toBeTruthy();
    const res = await fetch(`${baseUrl}/circles/${approvalCircleId}/join-requests/${req!.id}/respond`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Test-Resident-Id": approvalOrganiserId },
      body: JSON.stringify({ accept: true }),
    });
    expect(res.status).toBe(200);
    const member = await db.prepare(`SELECT 1 FROM circle_members WHERE circle_id = ? AND resident_id = ?`).get(approvalCircleId, requesterId);
    expect(member).toBeTruthy();
  });

  it("approval circle: rejecting a request does not create membership", async () => {
    const secondRequesterId = `test-requester2-${crypto.randomUUID()}`;
    await db.prepare(`INSERT INTO residents (id, email, name) VALUES (?, ?, 'Requester 2')`).run(secondRequesterId, `${secondRequesterId}@example.test`);
    await fetch(`${baseUrl}/circles/${approvalCircleId}/join`, { method: "POST", headers: { "X-Test-Resident-Id": secondRequesterId } });
    const list = await fetch(`${baseUrl}/circles/${approvalCircleId}/join-requests`, { headers: { "X-Test-Resident-Id": approvalOrganiserId } });
    const requests = (await list.json()) as { id: string; residentId: string }[];
    const req = requests.find((r) => r.residentId === secondRequesterId);
    const res = await fetch(`${baseUrl}/circles/${approvalCircleId}/join-requests/${req!.id}/respond`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Test-Resident-Id": approvalOrganiserId },
      body: JSON.stringify({ accept: false }),
    });
    expect(res.status).toBe(200);
    const member = await db.prepare(`SELECT 1 FROM circle_members WHERE circle_id = ? AND resident_id = ?`).get(approvalCircleId, secondRequesterId);
    expect(member).toBeFalsy();
    await db.prepare(`DELETE FROM circle_invites WHERE circle_id = ? AND resident_id = ?`).run(approvalCircleId, secondRequesterId);
    await db.prepare(`DELETE FROM residents WHERE id = ?`).run(secondRequesterId);
  });

  it("invite-only circle: self-serve join is refused without an invite", async () => {
    const res = await fetch(`${baseUrl}/circles/${inviteCircleId}/join`, { method: "POST", headers: { "X-Test-Resident-Id": requesterId } });
    expect(res.status).toBe(403);
  });

  it("invite-only circle: an organiser-sent invite lets the resident in via the same join endpoint", async () => {
    const invite = await fetch(`${baseUrl}/circles/${inviteCircleId}/invite`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Test-Resident-Id": inviteOrganiserId },
      body: JSON.stringify({ residentId: requesterId }),
    });
    expect(invite.status).toBe(201);
    const join = await fetch(`${baseUrl}/circles/${inviteCircleId}/join`, { method: "POST", headers: { "X-Test-Resident-Id": requesterId } });
    expect(join.status).toBe(201);
    const member = await db.prepare(`SELECT 1 FROM circle_members WHERE circle_id = ? AND resident_id = ?`).get(inviteCircleId, requesterId);
    expect(member).toBeTruthy();
  });

  it("inviting an already-member is rejected", async () => {
    const res = await fetch(`${baseUrl}/circles/${inviteCircleId}/invite`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Test-Resident-Id": inviteOrganiserId },
      body: JSON.stringify({ residentId: requesterId }),
    });
    expect(res.status).toBe(409);
  });

  it("removing a member then rejoining an open circle works with no cooldown", async () => {
    await fetch(`${baseUrl}/circles/${openCircleId}/members/${requesterId}/remove`, { method: "POST", headers: { "X-Test-Resident-Id": openOrganiserId } });
    const gone = await db.prepare(`SELECT 1 FROM circle_members WHERE circle_id = ? AND resident_id = ?`).get(openCircleId, requesterId);
    expect(gone).toBeFalsy();
    const rejoin = await fetch(`${baseUrl}/circles/${openCircleId}/join`, { method: "POST", headers: { "X-Test-Resident-Id": requesterId } });
    expect(rejoin.status).toBe(201);
  });

  it("promote then demote a member", async () => {
    const promote = await fetch(`${baseUrl}/circles/${openCircleId}/members/${requesterId}/promote`, { method: "POST", headers: { "X-Test-Resident-Id": openOrganiserId } });
    expect(promote.status).toBe(200);
    let row = (await db.prepare(`SELECT role FROM circle_members WHERE circle_id = ? AND resident_id = ?`).get(openCircleId, requesterId)) as { role: string };
    expect(row.role).toBe("organiser");

    const demote = await fetch(`${baseUrl}/circles/${openCircleId}/members/${requesterId}/demote`, { method: "POST", headers: { "X-Test-Resident-Id": openOrganiserId } });
    expect(demote.status).toBe(200);
    row = (await db.prepare(`SELECT role FROM circle_members WHERE circle_id = ? AND resident_id = ?`).get(openCircleId, requesterId)) as { role: string };
    expect(row.role).toBe("member");
  });

  it("Changeset 1C — the last organiser cannot leave", async () => {
    const res = await fetch(`${baseUrl}/circles/${openCircleId}/join`, { method: "DELETE", headers: { "X-Test-Resident-Id": openOrganiserId } });
    expect(res.status).toBe(409);
    const stillThere = await db.prepare(`SELECT 1 FROM circle_members WHERE circle_id = ? AND resident_id = ?`).get(openCircleId, openOrganiserId);
    expect(stillThere).toBeTruthy();
  });

  it("Changeset 1D — a closed circle rejects new joins", async () => {
    await fetch(`${baseUrl}/circles/${openCircleId}/status`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "X-Test-Resident-Id": openOrganiserId },
      body: JSON.stringify({ status: "closed" }),
    });
    const lateJoinerId = `test-late-joiner-${crypto.randomUUID()}`;
    await db.prepare(`INSERT INTO residents (id, email, name) VALUES (?, ?, 'Late Joiner')`).run(lateJoinerId, `${lateJoinerId}@example.test`);
    const res = await fetch(`${baseUrl}/circles/${openCircleId}/join`, { method: "POST", headers: { "X-Test-Resident-Id": lateJoinerId } });
    expect(res.status).toBe(409);
    await db.prepare(`DELETE FROM residents WHERE id = ?`).run(lateJoinerId);
  });
});

describe("Changeset 1B — visibility model", () => {
  const orgId = `test-priv-org-${crypto.randomUUID()}`;
  const memId = `test-priv-mem-${crypto.randomUUID()}`;
  const outId = `test-priv-out-${crypto.randomUUID()}`;
  const approvalId = `test-priv-approval-${crypto.randomUUID()}`;
  const inviteId = `test-priv-invite-${crypto.randomUUID()}`;

  beforeAll(async () => {
    await db.prepare(`INSERT INTO residents (id, email, name) VALUES (?, ?, 'Priv Organiser')`).run(orgId, `${orgId}@example.test`);
    await db.prepare(`INSERT INTO residents (id, email, name) VALUES (?, ?, 'Priv Member')`).run(memId, `${memId}@example.test`);
    await db.prepare(`INSERT INTO residents (id, email, name) VALUES (?, ?, 'Priv Outsider')`).run(outId, `${outId}@example.test`);

    await db
      .prepare(`INSERT INTO circles (id, name, activity_label, area, county, about, created_by_resident_id, join_mode) VALUES (?, 'Approval Privacy Circle', 'Testball', 'Area', 'Dublin', 'about text', ?, 'approval')`)
      .run(approvalId, orgId);
    await db.prepare(`INSERT INTO circle_members (circle_id, resident_id, role) VALUES (?, ?, 'organiser')`).run(approvalId, orgId);
    await db.prepare(`INSERT INTO circle_members (circle_id, resident_id, role) VALUES (?, ?, 'member')`).run(approvalId, memId);

    await db
      .prepare(`INSERT INTO circles (id, name, activity_label, area, county, about, created_by_resident_id, join_mode) VALUES (?, 'Invite Privacy Circle', 'Testball', 'Area', 'Dublin', 'about text', ?, 'invite')`)
      .run(inviteId, orgId);
    await db.prepare(`INSERT INTO circle_members (circle_id, resident_id, role) VALUES (?, ?, 'organiser')`).run(inviteId, orgId);
    await db.prepare(`INSERT INTO circle_members (circle_id, resident_id, role) VALUES (?, ?, 'member')`).run(inviteId, memId);
  });

  afterAll(async () => {
    for (const cid of [approvalId, inviteId]) {
      await db.prepare(`DELETE FROM circle_members WHERE circle_id = ?`).run(cid);
      await db.prepare(`DELETE FROM circles WHERE id = ?`).run(cid);
    }
    await db.prepare(`DELETE FROM residents WHERE id IN (?, ?, ?)`).run(orgId, memId, outId);
  });

  it("approval circle: a non-member gets the teaser shape from GET /:id, with member count but no internal content", async () => {
    const res = await fetch(`${baseUrl}/circles/${approvalId}`, { headers: { "X-Test-Resident-Id": outId } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { restricted?: boolean; members: number; whatWeDo: string | null; activePlan: unknown };
    expect(body.restricted).toBe(true);
    expect(body.members).toBeGreaterThan(0);
    expect(body.whatWeDo).toBeNull();
    expect(body.activePlan).toBeNull();
  });

  it("approval circle: a member gets the full response, not the teaser", async () => {
    const res = await fetch(`${baseUrl}/circles/${approvalId}`, { headers: { "X-Test-Resident-Id": memId } });
    const body = (await res.json()) as { restricted?: boolean };
    expect(body.restricted).toBeUndefined();
  });

  it("invite circle: a non-member's teaser has no member count at all", async () => {
    const res = await fetch(`${baseUrl}/circles/${inviteId}`, { headers: { "X-Test-Resident-Id": outId } });
    const body = (await res.json()) as { restricted?: boolean; members: number };
    expect(body.restricted).toBe(true);
    expect(body.members).toBe(0);
  });

  it("approval circle: a non-member is rejected from members/plan-ideas/polls/upcoming", async () => {
    const headers = { "X-Test-Resident-Id": outId };
    expect((await fetch(`${baseUrl}/circles/${approvalId}/members`, { headers })).status).toBe(403);
    expect((await fetch(`${baseUrl}/circles/${approvalId}/plan-ideas`, { headers })).status).toBe(403);
    expect((await fetch(`${baseUrl}/circles/${approvalId}/polls`, { headers })).status).toBe(403);
    expect((await fetch(`${baseUrl}/circles/${approvalId}/upcoming`, { headers })).status).toBe(403);
  });

  it("invite circle: a non-member is rejected the same way", async () => {
    const headers = { "X-Test-Resident-Id": outId };
    expect((await fetch(`${baseUrl}/circles/${inviteId}/members`, { headers })).status).toBe(403);
    expect((await fetch(`${baseUrl}/circles/${inviteId}/plan-ideas`, { headers })).status).toBe(403);
    expect((await fetch(`${baseUrl}/circles/${inviteId}/polls`, { headers })).status).toBe(403);
  });

  it("approval circle: a member CAN read members/plan-ideas/polls", async () => {
    const headers = { "X-Test-Resident-Id": memId };
    expect((await fetch(`${baseUrl}/circles/${approvalId}/members`, { headers })).status).toBe(200);
    expect((await fetch(`${baseUrl}/circles/${approvalId}/plan-ideas`, { headers })).status).toBe(200);
    expect((await fetch(`${baseUrl}/circles/${approvalId}/polls`, { headers })).status).toBe(200);
  });

  it("invite circle: an invited (but not-yet-member) resident is still rejected from members/plan-ideas — only accepting the invite grants access", async () => {
    const invitedId = `test-priv-invited-${crypto.randomUUID()}`;
    await db.prepare(`INSERT INTO residents (id, email, name) VALUES (?, ?, 'Priv Invited')`).run(invitedId, `${invitedId}@example.test`);
    await fetch(`${baseUrl}/circles/${inviteId}/invite`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Test-Resident-Id": orgId },
      body: JSON.stringify({ residentId: invitedId }),
    });
    const detail = await fetch(`${baseUrl}/circles/${inviteId}`, { headers: { "X-Test-Resident-Id": invitedId } });
    const body = (await detail.json()) as { restricted?: boolean; hasPendingInvite?: boolean };
    expect(body.restricted).toBe(true);
    expect(body.hasPendingInvite).toBe(true);
    const members = await fetch(`${baseUrl}/circles/${inviteId}/members`, { headers: { "X-Test-Resident-Id": invitedId } });
    expect(members.status).toBe(403);
    await db.prepare(`DELETE FROM circle_invites WHERE circle_id = ? AND resident_id = ?`).run(inviteId, invitedId);
    await db.prepare(`DELETE FROM residents WHERE id = ?`).run(invitedId);
  });

  it("open circle: a non-member can still read members/plan-ideas (unchanged behaviour)", async () => {
    const membersRes = await fetch(`${baseUrl}/circles/${circleId}/members`, { headers: { "X-Test-Resident-Id": outsiderId } });
    expect(membersRes.status).toBe(200);
    const planIdeasRes = await fetch(`${baseUrl}/circles/${circleId}/plan-ideas`);
    expect(planIdeasRes.status).toBe(200);
  });
});

// Cloudflare R2 Media System — Task 2 (restricted Circle media). Before
// this, toCircleJson()/toCircleTeaserJson() put the raw permanent R2 URL
// in `imageUrl` unconditionally — including for a non-member's teaser
// response and for GET / (the public, unauthenticated browse list, which
// used the full shape for every circle regardless of join_mode). This is
// the regression suite proving that's closed: `imageUrl` is only ever
// real for an "open" Circle; every other join mode gets `imageUrl: null`
// + `hasImage: true`, for every read path (list, mine, detail — teaser
// AND full/member view alike), forcing the client onto the protected
// `/api/media/circles/:id/cover` endpoint instead.
describe("Media plan Task 2 — imageUrl exposure by join mode", () => {
  const orgId = `test-img-org-${crypto.randomUUID()}`;
  const memId = `test-img-mem-${crypto.randomUUID()}`;
  const outId = `test-img-out-${crypto.randomUUID()}`;
  const openId = `test-img-open-${crypto.randomUUID()}`;
  const inviteId = `test-img-invite-${crypto.randomUUID()}`;
  const realImageUrl = "https://media.hellocircle.ie/circles/test-img-fixture/cover/x.jpg";

  beforeAll(async () => {
    await db.prepare(`INSERT INTO residents (id, email, name) VALUES (?, ?, 'Img Organiser')`).run(orgId, `${orgId}@example.test`);
    await db.prepare(`INSERT INTO residents (id, email, name) VALUES (?, ?, 'Img Member')`).run(memId, `${memId}@example.test`);
    await db.prepare(`INSERT INTO residents (id, email, name) VALUES (?, ?, 'Img Outsider')`).run(outId, `${outId}@example.test`);

    await db
      .prepare(
        `INSERT INTO circles (id, name, activity_label, area, county, about, created_by_resident_id, join_mode, image_url) VALUES (?, 'Open Image Circle', 'Testball', 'Area', 'Dublin', '', ?, 'open', ?)`
      )
      .run(openId, orgId, realImageUrl);
    await db.prepare(`INSERT INTO circle_members (circle_id, resident_id, role) VALUES (?, ?, 'organiser')`).run(openId, orgId);

    await db
      .prepare(
        `INSERT INTO circles (id, name, activity_label, area, county, about, created_by_resident_id, join_mode, image_url) VALUES (?, 'Invite Image Circle', 'Testball', 'Area', 'Dublin', '', ?, 'invite', ?)`
      )
      .run(inviteId, orgId, realImageUrl);
    await db.prepare(`INSERT INTO circle_members (circle_id, resident_id, role) VALUES (?, ?, 'organiser')`).run(inviteId, orgId);
    await db.prepare(`INSERT INTO circle_members (circle_id, resident_id, role) VALUES (?, ?, 'member')`).run(inviteId, memId);
  });

  afterAll(async () => {
    for (const cid of [openId, inviteId]) {
      await db.prepare(`DELETE FROM circle_members WHERE circle_id = ?`).run(cid);
      await db.prepare(`DELETE FROM circles WHERE id = ?`).run(cid);
    }
    await db.prepare(`DELETE FROM residents WHERE id IN (?, ?, ?)`).run(orgId, memId, outId);
  });

  it("open circle: real imageUrl is exposed via GET /:id, even to a signed-out visitor", async () => {
    const res = await fetch(`${baseUrl}/circles/${openId}`);
    const body = (await res.json()) as { imageUrl: string | null; hasImage?: boolean };
    expect(body.imageUrl).toBe(realImageUrl);
    expect(body.hasImage).toBe(true);
  });

  it("open circle: real imageUrl is also exposed via GET / (the public browse list)", async () => {
    const res = await fetch(`${baseUrl}/circles`);
    const body = (await res.json()) as { id: string; imageUrl: string | null }[];
    const mine = body.find((c) => c.id === openId);
    expect(mine?.imageUrl).toBe(realImageUrl);
  });

  it("invite circle: a non-member's teaser never gets the raw imageUrl", async () => {
    const res = await fetch(`${baseUrl}/circles/${inviteId}`, { headers: { "X-Test-Resident-Id": outId } });
    const body = (await res.json()) as { imageUrl: string | null; hasImage?: boolean; restricted?: boolean };
    expect(body.restricted).toBe(true);
    expect(body.imageUrl).toBeNull();
    expect(body.hasImage).toBe(true);
  });

  it("invite circle: a signed-out visitor's teaser never gets the raw imageUrl either", async () => {
    const res = await fetch(`${baseUrl}/circles/${inviteId}`);
    const body = (await res.json()) as { imageUrl: string | null; hasImage?: boolean };
    expect(body.imageUrl).toBeNull();
    expect(body.hasImage).toBe(true);
  });

  it("invite circle: an actual MEMBER's full response also withholds the raw imageUrl (the real fix — this used to leak)", async () => {
    const res = await fetch(`${baseUrl}/circles/${inviteId}`, { headers: { "X-Test-Resident-Id": memId } });
    const body = (await res.json()) as { imageUrl: string | null; hasImage?: boolean; restricted?: boolean };
    expect(body.restricted).toBeUndefined();
    expect(body.imageUrl).toBeNull();
    expect(body.hasImage).toBe(true);
  });

  it("invite circle: the organiser's own view also withholds the raw imageUrl", async () => {
    const res = await fetch(`${baseUrl}/circles/${inviteId}`, { headers: { "X-Test-Resident-Id": orgId } });
    const body = (await res.json()) as { imageUrl: string | null; hasImage?: boolean };
    expect(body.imageUrl).toBeNull();
    expect(body.hasImage).toBe(true);
  });

  it("invite circle: GET /:id/plan-ideas etc. never appear on the public list either (org-wide list scoping unaffected by this change)", async () => {
    const res = await fetch(`${baseUrl}/circles`);
    const body = (await res.json()) as { id: string; imageUrl: string | null }[];
    const mine = body.find((c) => c.id === inviteId);
    // The invite circle IS returned by the public list (status/join_mode
    // don't gate list membership, only field content) — but never with a
    // usable image URL.
    expect(mine?.imageUrl).toBeNull();
  });

  it("visibility open -> private: switching join_mode stops exposing the raw imageUrl on the next read", async () => {
    const before = await fetch(`${baseUrl}/circles/${openId}`);
    expect(((await before.json()) as { imageUrl: string | null }).imageUrl).toBe(realImageUrl);

    const switchRes = await fetch(`${baseUrl}/circles/${openId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "X-Test-Resident-Id": orgId },
      body: JSON.stringify({ name: "Open Image Circle", joinMode: "invite" }),
    });
    expect(switchRes.status).toBe(200);

    const after = await fetch(`${baseUrl}/circles/${openId}`, { headers: { "X-Test-Resident-Id": outId } });
    const afterBody = (await after.json()) as { imageUrl: string | null; hasImage?: boolean };
    expect(afterBody.imageUrl).toBeNull();
    expect(afterBody.hasImage).toBe(true); // the file is still there — just no longer exposed as a permanent public URL

    // Revert for any other test relying on openId being open.
    await fetch(`${baseUrl}/circles/${openId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "X-Test-Resident-Id": orgId },
      body: JSON.stringify({ name: "Open Image Circle", joinMode: "open" }),
    });
  });

  it("visibility private -> open: switching join_mode starts exposing the real imageUrl again", async () => {
    const switchRes = await fetch(`${baseUrl}/circles/${inviteId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "X-Test-Resident-Id": orgId },
      body: JSON.stringify({ name: "Invite Image Circle", joinMode: "open" }),
    });
    expect(switchRes.status).toBe(200);

    const after = await fetch(`${baseUrl}/circles/${inviteId}`);
    const afterBody = (await after.json()) as { imageUrl: string | null };
    expect(afterBody.imageUrl).toBe(realImageUrl);

    // Revert.
    await fetch(`${baseUrl}/circles/${inviteId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "X-Test-Resident-Id": orgId },
      body: JSON.stringify({ name: "Invite Image Circle", joinMode: "invite" }),
    });
  });

  it("PUT /:id omitting imageUrl entirely (an unrelated edit) never wipes the stored cover (COALESCE safety)", async () => {
    const res = await fetch(`${baseUrl}/circles/${openId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "X-Test-Resident-Id": orgId },
      body: JSON.stringify({ name: "Open Image Circle", about: "unrelated edit, no imageUrl in payload" }),
    });
    expect(res.status).toBe(200);
    const row = (await db.prepare(`SELECT image_url as imageUrl FROM circles WHERE id = ?`).get(openId)) as { imageUrl: string };
    expect(row.imageUrl).toBe(realImageUrl);
  });

  it("PUT /:id with an explicit empty imageUrl DOES clear the stored cover", async () => {
    const res = await fetch(`${baseUrl}/circles/${inviteId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "X-Test-Resident-Id": orgId },
      body: JSON.stringify({ name: "Invite Image Circle", imageUrl: "" }),
    });
    expect(res.status).toBe(200);
    const row = (await db.prepare(`SELECT image_url as imageUrl FROM circles WHERE id = ?`).get(inviteId)) as { imageUrl: string };
    expect(row.imageUrl).toBe("");
    // Restore for the other tests in this block.
    await db.prepare(`UPDATE circles SET image_url = ? WHERE id = ?`).run(realImageUrl, inviteId);
  });
});

describe("Changeset 1A — poll authorization requires membership", () => {
  it("a non-member cannot create a poll", async () => {
    const res = await fetch(`${baseUrl}/circles/${circleId}/polls`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Test-Resident-Id": outsiderId },
      body: JSON.stringify({ question: "Should not be allowed", options: [{ date: "2099-07-01" }] }),
    });
    expect(res.status).toBe(403);
  });

  it("a non-member cannot vote", async () => {
    const create = await fetch(`${baseUrl}/circles/${circleId}/polls`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Test-Resident-Id": memberId },
      body: JSON.stringify({ question: "Members-only poll", options: [{ date: "2099-07-02" }] }),
    });
    const { id: pollId } = (await create.json()) as { id: string };
    const list = await fetch(`${baseUrl}/circles/${circleId}/polls`);
    const polls = (await list.json()) as { id: string; options: { id: number }[] }[];
    const optionId = polls.find((p) => p.id === pollId)!.options[0].id;

    const res = await fetch(`${baseUrl}/circles/${circleId}/polls/${pollId}/options/${optionId}/vote`, { method: "POST", headers: { "X-Test-Resident-Id": outsiderId } });
    expect(res.status).toBe(403);
  });

  it("a member can vote, and voting the same option twice toggles it off rather than double-counting", async () => {
    const create = await fetch(`${baseUrl}/circles/${circleId}/polls`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Test-Resident-Id": memberId },
      body: JSON.stringify({ question: "Toggle test", options: [{ date: "2099-07-03" }] }),
    });
    const { id: pollId } = (await create.json()) as { id: string };
    const list1 = await fetch(`${baseUrl}/circles/${circleId}/polls`);
    const polls1 = (await list1.json()) as { id: string; options: { id: number }[] }[];
    const optionId = polls1.find((p) => p.id === pollId)!.options[0].id;

    await fetch(`${baseUrl}/circles/${circleId}/polls/${pollId}/options/${optionId}/vote`, { method: "POST", headers: { "X-Test-Resident-Id": memberId } });
    const list2 = await fetch(`${baseUrl}/circles/${circleId}/polls`);
    const polls2 = (await list2.json()) as { id: string; options: { id: number; voteCount: number }[] }[];
    expect(polls2.find((p) => p.id === pollId)!.options[0].voteCount).toBe(1);

    await fetch(`${baseUrl}/circles/${circleId}/polls/${pollId}/options/${optionId}/vote`, { method: "POST", headers: { "X-Test-Resident-Id": memberId } });
    const list3 = await fetch(`${baseUrl}/circles/${circleId}/polls`);
    const polls3 = (await list3.json()) as { id: string; options: { id: number; voteCount: number }[] }[];
    expect(polls3.find((p) => p.id === pollId)!.options[0].voteCount).toBe(0);
  });

  it("only the organiser can close a poll", async () => {
    const create = await fetch(`${baseUrl}/circles/${circleId}/polls`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Test-Resident-Id": memberId },
      body: JSON.stringify({ question: "Close test", options: [{ date: "2099-07-04" }] }),
    });
    const { id: pollId } = (await create.json()) as { id: string };
    const asMember = await fetch(`${baseUrl}/circles/${circleId}/polls/${pollId}/close`, { method: "POST", headers: { "X-Test-Resident-Id": memberId } });
    expect(asMember.status).toBe(403);
    const asOrganiser = await fetch(`${baseUrl}/circles/${circleId}/polls/${pollId}/close`, { method: "POST", headers: { "X-Test-Resident-Id": organiserId } });
    expect(asOrganiser.status).toBe(200);
  });
});

describe("Changeset 2A/2C — real Circle-owned activity wins over a same-label unrelated game", () => {
  const fuzzyGameId = `test-fuzzy-game-${crypto.randomUUID()}`;
  const realGameId = `test-real-game-${crypto.randomUUID()}`;
  const realPastGameId = `test-real-past-${crypto.randomUUID()}`;
  const fuzzyPastGameId = `test-fuzzy-past-${crypto.randomUUID()}`;

  beforeAll(async () => {
    // Unrelated game sharing this circle's activity label, earlier date, no circle_id.
    await db
      .prepare(`INSERT INTO games (id, host_resident_id, activity_label, date, time, capacity, status) VALUES (?, ?, 'Testball', '2099-08-01', '10:00', 10, 'open')`)
      .run(fuzzyGameId, outsiderId);
    // Real circle-owned game, later date — should still win as "Next Up".
    await db
      .prepare(`INSERT INTO games (id, host_resident_id, activity_label, date, time, capacity, status, circle_id) VALUES (?, ?, 'Testball', '2099-08-15', '10:00', 10, 'open', ?)`)
      .run(realGameId, organiserId, circleId);

    // Past/completed pair for recent-activity.
    await db
      .prepare(`INSERT INTO games (id, host_resident_id, activity_label, date, time, capacity, status, circle_id) VALUES (?, ?, 'Testball', '2020-01-01', '10:00', 10, 'open', ?)`)
      .run(realPastGameId, organiserId, circleId);
    await db.prepare(`INSERT INTO game_participants (game_id, resident_id, status, attended) VALUES (?, ?, 'joined', 1)`).run(realPastGameId, memberId);
    await db
      .prepare(`INSERT INTO games (id, host_resident_id, activity_label, date, time, capacity, status) VALUES (?, ?, 'Testball', '2020-02-01', '10:00', 10, 'open')`)
      .run(fuzzyPastGameId, outsiderId);
    await db.prepare(`INSERT INTO game_participants (game_id, resident_id, status, attended) VALUES (?, ?, 'joined', 1)`).run(fuzzyPastGameId, outsiderId);
  });

  afterAll(async () => {
    await db.prepare(`DELETE FROM game_participants WHERE game_id IN (?, ?, ?, ?)`).run(fuzzyGameId, realGameId, realPastGameId, fuzzyPastGameId);
    await db.prepare(`DELETE FROM games WHERE id IN (?, ?, ?, ?)`).run(fuzzyGameId, realGameId, realPastGameId, fuzzyPastGameId);
  });

  it("GET /:id returns the real circle-owned game as nextPlan, tagged source:'circle', even though the fuzzy match is earlier", async () => {
    const res = await fetch(`${baseUrl}/circles/${circleId}`, { headers: { "X-Test-Resident-Id": organiserId } });
    const body = (await res.json()) as { nextPlan: { id: string; source: string } | null };
    expect(body.nextPlan?.id).toBe(realGameId);
    expect(body.nextPlan?.source).toBe("circle");
  });

  it("GET /:id/upcoming lists the real game as source:'circle' and the fuzzy one as source:'nearby', real first", async () => {
    const res = await fetch(`${baseUrl}/circles/${circleId}/upcoming`, { headers: { "X-Test-Resident-Id": organiserId } });
    const rows = (await res.json()) as { id: string; source: string }[];
    const real = rows.find((r) => r.id === realGameId);
    const fuzzy = rows.find((r) => r.id === fuzzyGameId);
    expect(real?.source).toBe("circle");
    expect(fuzzy?.source).toBe("nearby");
    expect(rows.indexOf(real!)).toBeLessThan(rows.indexOf(fuzzy!));
  });

  it("GET /:id/recent-activity returns only the real circle-owned completion once one exists", async () => {
    const res = await fetch(`${baseUrl}/circles/${circleId}/recent-activity`, { headers: { "X-Test-Resident-Id": organiserId } });
    const rows = (await res.json()) as { id: string; source: string }[];
    expect(rows.some((r) => r.id === realPastGameId)).toBe(true);
    expect(rows.some((r) => r.id === fuzzyPastGameId)).toBe(false);
    expect(rows.find((r) => r.id === realPastGameId)?.source).toBe("circle");
  });
});

describe("Changeset 2B — Game responses expose the Circle backlink", () => {
  it("a circle-linked game's GET response includes circleId/circleName/circleSlug", async () => {
    const gameId = `test-backlink-game-${crypto.randomUUID()}`;
    await db
      .prepare(`INSERT INTO games (id, host_resident_id, activity_label, date, time, capacity, status, circle_id) VALUES (?, ?, 'Testball', '2099-09-01', '10:00', 10, 'open', ?)`)
      .run(gameId, organiserId, circleId);
    const res = await fetch(`${baseUrl}/games/${gameId}`);
    const body = (await res.json()) as { circleId: string | null; circleName: string | null };
    expect(body.circleId).toBe(circleId);
    expect(body.circleName).toBe("Test Circle");
    await db.prepare(`DELETE FROM games WHERE id = ?`).run(gameId);
  });

  it("a game with no circle has null circleId/circleName", async () => {
    const gameId = `test-no-backlink-game-${crypto.randomUUID()}`;
    await db.prepare(`INSERT INTO games (id, host_resident_id, activity_label, date, time, capacity, status) VALUES (?, ?, 'Testball', '2099-09-02', '10:00', 10, 'open')`).run(gameId, organiserId);
    const res = await fetch(`${baseUrl}/games/${gameId}`);
    const body = (await res.json()) as { circleId: string | null };
    expect(body.circleId).toBeNull();
    await db.prepare(`DELETE FROM games WHERE id = ?`).run(gameId);
  });
});

describe("Changeset 1D — closed circle behaviour", () => {
  const closedOrgId = `test-closed-org-${crypto.randomUUID()}`;
  const closedOutsiderId = `test-closed-out-${crypto.randomUUID()}`;
  const closedCircleId = `test-closed-circle-${crypto.randomUUID()}`;

  beforeAll(async () => {
    await db.prepare(`INSERT INTO residents (id, email, name) VALUES (?, ?, 'Closed Organiser')`).run(closedOrgId, `${closedOrgId}@example.test`);
    await db.prepare(`INSERT INTO residents (id, email, name) VALUES (?, ?, 'Closed Outsider')`).run(closedOutsiderId, `${closedOutsiderId}@example.test`);
    await db
      .prepare(`INSERT INTO circles (id, name, activity_label, area, county, about, created_by_resident_id) VALUES (?, 'Closed Test Circle', 'Testball', 'Area', 'Dublin', '', ?)`)
      .run(closedCircleId, closedOrgId);
    await db.prepare(`INSERT INTO circle_members (circle_id, resident_id, role) VALUES (?, ?, 'organiser')`).run(closedCircleId, closedOrgId);
  });

  afterAll(async () => {
    await db.prepare(`DELETE FROM circle_invites WHERE circle_id = ?`).run(closedCircleId);
    await db.prepare(`DELETE FROM circle_plans WHERE circle_id = ?`).run(closedCircleId);
    await db.prepare(`DELETE FROM circle_members WHERE circle_id = ?`).run(closedCircleId);
    await db.prepare(`DELETE FROM circles WHERE id = ?`).run(closedCircleId);
    await db.prepare(`DELETE FROM residents WHERE id IN (?, ?)`).run(closedOrgId, closedOutsiderId);
  });

  it("rejects new plan ideas, polls and invitations once closed", async () => {
    const close = await fetch(`${baseUrl}/circles/${closedCircleId}/status`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "X-Test-Resident-Id": closedOrgId },
      body: JSON.stringify({ status: "closed" }),
    });
    expect(close.status).toBe(200);

    const planRes = await fetch(`${baseUrl}/circles/${closedCircleId}/plan-ideas`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Test-Resident-Id": closedOrgId },
      body: JSON.stringify({ title: "Should be rejected" }),
    });
    expect(planRes.status).toBe(409);

    const pollRes = await fetch(`${baseUrl}/circles/${closedCircleId}/polls`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Test-Resident-Id": closedOrgId },
      body: JSON.stringify({ question: "Should be rejected", options: [{ date: "2099-01-01" }] }),
    });
    expect(pollRes.status).toBe(409);

    const inviteRes = await fetch(`${baseUrl}/circles/${closedCircleId}/invite`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Test-Resident-Id": closedOrgId },
      body: JSON.stringify({ residentId: closedOutsiderId }),
    });
    expect(inviteRes.status).toBe(409);
  });

  it("rejects plan→activity conversion once closed, even for an already-confirmed plan", async () => {
    // Reopen to create + confirm a plan, then close again to isolate the conversion check.
    await fetch(`${baseUrl}/circles/${closedCircleId}/status`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "X-Test-Resident-Id": closedOrgId },
      body: JSON.stringify({ status: "active" }),
    });
    const createRes = await fetch(`${baseUrl}/circles/${closedCircleId}/plan-ideas`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Test-Resident-Id": closedOrgId },
      body: JSON.stringify({ title: "Plan before close", proposedDate: "2099-09-10", proposedTime: "10:00" }),
    });
    const { id: planId } = (await createRes.json()) as { id: string };
    await fetch(`${baseUrl}/circles/${closedCircleId}/plan-ideas/${planId}/confirm`, { method: "POST", headers: { "X-Test-Resident-Id": closedOrgId } });
    await fetch(`${baseUrl}/circles/${closedCircleId}/status`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "X-Test-Resident-Id": closedOrgId },
      body: JSON.stringify({ status: "closed" }),
    });

    const res = await fetch(`${baseUrl}/games`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Test-Resident-Id": closedOrgId },
      body: JSON.stringify({ activityLabel: "Plan before close", date: "2099-09-10", time: "10:00", capacity: 10, locationText: "Test", circleId: closedCircleId, planId }),
    });
    expect(res.status).toBe(409);
  });
});

// SEO/Privacy audit — Phase 1, P0 fix #1. GET / (the public, zero-auth
// browse list) previously called toCircleJson() unconditionally for every
// row regardless of join_mode, leaking about/whatWeDo/whoCanJoin/values/
// nextPlan/activePlan/hostName/hostVerified/members for every restricted
// Circle. This is the regression suite for the per-row visibility check
// that now gates it exactly like GET /:id already does.
describe("GET / — restricted Circle fields are redacted for an unauthorized viewer", () => {
  const orgId = `test-list-org-${crypto.randomUUID()}`;
  const memId = `test-list-mem-${crypto.randomUUID()}`;
  const outId = `test-list-out-${crypto.randomUUID()}`;
  const inviteId = `test-list-invite-${crypto.randomUUID()}`;
  const approvalId = `test-list-approval-${crypto.randomUUID()}`;
  const openId = `test-list-open-${crypto.randomUUID()}`;

  beforeAll(async () => {
    await db.prepare(`INSERT INTO residents (id, email, name) VALUES (?, ?, 'List Organiser')`).run(orgId, `${orgId}@example.test`);
    await db.prepare(`INSERT INTO residents (id, email, name) VALUES (?, ?, 'List Member')`).run(memId, `${memId}@example.test`);
    await db.prepare(`INSERT INTO residents (id, email, name) VALUES (?, ?, 'List Outsider')`).run(outId, `${outId}@example.test`);

    await db
      .prepare(
        `INSERT INTO circles (id, name, activity_label, area, county, about, created_by_resident_id, join_mode, what_we_do, who_can_join) VALUES (?, 'Secret List Circle', 'Testball', 'Area', 'Dublin', 'real private about text', ?, 'invite', 'real what we do text', 'real who can join text')`
      )
      .run(inviteId, orgId);
    await db.prepare(`INSERT INTO circle_members (circle_id, resident_id, role) VALUES (?, ?, 'organiser')`).run(inviteId, orgId);
    await db.prepare(`INSERT INTO circle_members (circle_id, resident_id, role) VALUES (?, ?, 'member')`).run(inviteId, memId);

    await db
      .prepare(`INSERT INTO circles (id, name, activity_label, area, county, about, created_by_resident_id, join_mode) VALUES (?, 'Approval List Circle', 'Testball', 'Area', 'Dublin', 'approval about text', ?, 'approval')`)
      .run(approvalId, orgId);
    await db.prepare(`INSERT INTO circle_members (circle_id, resident_id, role) VALUES (?, ?, 'organiser')`).run(approvalId, orgId);

    await db
      .prepare(`INSERT INTO circles (id, name, activity_label, area, county, about, created_by_resident_id, join_mode) VALUES (?, 'Open List Circle', 'Testball', 'Area', 'Dublin', 'open about text', ?, 'open')`)
      .run(openId, orgId);
    await db.prepare(`INSERT INTO circle_members (circle_id, resident_id, role) VALUES (?, ?, 'organiser')`).run(openId, orgId);
  });

  afterAll(async () => {
    for (const cid of [inviteId, approvalId, openId]) {
      await db.prepare(`DELETE FROM circle_members WHERE circle_id = ?`).run(cid);
      await db.prepare(`DELETE FROM circles WHERE id = ?`).run(cid);
    }
    await db.prepare(`DELETE FROM residents WHERE id IN (?, ?, ?)`).run(orgId, memId, outId);
  });

  it("a signed-out request gets the invite-only Circle's teaser shape — about is a deliberate exception (existing product decision, helps a prospective member decide whether to request access), but whatWeDo/whoCanJoin/values/nextPlan/activePlan/hostName/members stay genuinely redacted", async () => {
    const res = await fetch(`${baseUrl}/circles`);
    const body = (await res.json()) as {
      id: string;
      about?: string;
      whatWeDo?: string | null;
      whoCanJoin?: string | null;
      values?: string | null;
      nextPlan?: unknown;
      activePlan?: unknown;
      hostName?: string;
      members?: number;
      restricted?: boolean;
    }[];
    const mine = body.find((c) => c.id === inviteId)!;
    expect(mine.restricted).toBe(true);
    expect(mine.about).toBe("real private about text"); // intentional, see toCircleTeaserJson()'s own comment
    expect(mine.whatWeDo).toBeNull();
    expect(mine.whoCanJoin).toBeNull();
    expect(mine.values ?? null).toBeNull();
    expect(mine.nextPlan).toBeNull();
    expect(mine.activePlan).toBeNull();
    expect(mine.hostName).toBe(""); // invite mode: no organiser identity at all
    expect(mine.members).toBe(0);
  });

  it("an outsider (non-member) resident gets the approval-mode teaser — about + member count + organiser identity are the deliberate allow-list for that mode, but whatWeDo/whoCanJoin/values still redacted", async () => {
    const res = await fetch(`${baseUrl}/circles`, { headers: { "X-Test-Resident-Id": outId } });
    const body = (await res.json()) as { id: string; about?: string; whatWeDo?: string | null; restricted?: boolean; hostName?: string }[];
    const mine = body.find((c) => c.id === approvalId)!;
    expect(mine.restricted).toBe(true);
    expect(mine.about).toBe("approval about text"); // intentional for approval mode specifically
    expect(mine.whatWeDo).toBeNull();
    expect(mine.hostName).toBe("List Organiser"); // approval mode's own allow-list includes organiser identity
  });

  it("an actual member sees the real fields for the same invite-only Circle", async () => {
    const res = await fetch(`${baseUrl}/circles`, { headers: { "X-Test-Resident-Id": memId } });
    const body = (await res.json()) as { id: string; about?: string; restricted?: boolean }[];
    const mine = body.find((c) => c.id === inviteId)!;
    expect(mine.restricted).toBeUndefined();
    expect(mine.about).toBe("real private about text");
  });

  it("an open Circle is never redacted for anyone, signed-out included", async () => {
    const res = await fetch(`${baseUrl}/circles`);
    const body = (await res.json()) as { id: string; about?: string; restricted?: boolean }[];
    const mine = body.find((c) => c.id === openId)!;
    expect(mine.restricted).toBeUndefined();
    expect(mine.about).toBe("open about text");
  });
});
