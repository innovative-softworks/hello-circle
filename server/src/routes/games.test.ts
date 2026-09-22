import crypto from "node:crypto";
import http, { type Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../db/index.js";
import { gamesRouter } from "./games.js";

// Real-DB concurrency test (audit's top-stated testing priority: "booking
// row-lock/double-booking prevention"). This exercises the actual
// gamesRouter join handler — including its `FOR UPDATE` transaction and the
// computeCapacity() check — against a real MySQL connection (the same
// hello_circle_dev the rest of local dev already points at; see
// server/TESTING.md). Auth is stubbed at the identity layer only:
// requireResident just checks `req.resident` truthiness (see
// residents.ts), so a tiny test-only middleware sets it from a header
// instead of standing up real magic-link cookie sessions — the thing under
// test is the capacity race, not the auth flow.

let server: Server;
let baseUrl: string;

const testHostId = `test-host-${crypto.randomUUID()}`;
const testResidentAId = `test-res-a-${crypto.randomUUID()}`;
const testResidentBId = `test-res-b-${crypto.randomUUID()}`;
let testGameId: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const residentId = req.header("X-Test-Resident-Id");
    if (residentId) (req as any).resident = { id: residentId };
    next();
  });
  app.use("/", gamesRouter);

  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Failed to bind test server");
  baseUrl = `http://127.0.0.1:${address.port}`;

  await db.prepare(`INSERT INTO residents (id, email, name) VALUES (?, ?, ?)`).run(testHostId, `${testHostId}@example.test`, "Test Host");
  await db.prepare(`INSERT INTO residents (id, email, name) VALUES (?, ?, ?)`).run(testResidentAId, `${testResidentAId}@example.test`, "Test Resident A");
  await db.prepare(`INSERT INTO residents (id, email, name) VALUES (?, ?, ?)`).run(testResidentBId, `${testResidentBId}@example.test`, "Test Resident B");

  testGameId = `test-game-${crypto.randomUUID()}`;
  const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  await db
    .prepare(`INSERT INTO games (id, host_resident_id, activity_label, date, time, capacity, status) VALUES (?, ?, ?, ?, ?, 1, 'open')`)
    .run(testGameId, testHostId, "Test Concurrency Badminton", future, "18:00");
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  // A successful join also fires a "game full" host notification as a side
  // effect — clean that up too, or it lingers in the notifications table
  // (and the seeded admin account's feed, which mirrors every notification).
  await db.prepare(`DELETE FROM notifications WHERE resident_id = ? OR listing_id = ?`).run(testHostId, testGameId);
  await db.prepare(`DELETE FROM favourites WHERE listing_id = ?`).run(testGameId);
  await db.prepare(`DELETE FROM game_participants WHERE game_id = ?`).run(testGameId);
  await db.prepare(`DELETE FROM games WHERE id = ?`).run(testGameId);
  await db.prepare(`DELETE FROM residents WHERE id IN (?, ?, ?)`).run(testHostId, testResidentAId, testResidentBId);
});

describe("POST /:id/join — capacity race", () => {
  it("lets exactly one of two simultaneous joins succeed on a capacity=1 game", async () => {
    const join = (residentId: string) =>
      fetch(`${baseUrl}/${testGameId}/join`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Test-Resident-Id": residentId },
        body: "{}",
      });

    const [resA, resB] = await Promise.all([join(testResidentAId), join(testResidentBId)]);
    const statuses = [resA.status, resB.status].sort();

    // One succeeds (200, free-join path returns { ok: true }), the other is
    // rejected as full (409) — never both succeeding, never both failing.
    expect(statuses).toEqual([200, 409]);

    const { n } = (await db
      .prepare(`SELECT COUNT(*) as n FROM game_participants WHERE game_id = ? AND status = 'joined'`)
      .get(testGameId)) as { n: number };
    expect(n).toBe(1);
  });
});

// Phase 0 protect: DELETE /:id/join previously hard-deleted a paid
// participant row with zero signal to the host — this confirms the fix
// (notifying the host on a *paid* leave) without changing the underlying
// off-platform-refund convention (no refund is issued, none is expected).
describe("DELETE /:id/join — paid leave notifies the host", () => {
  const paidLeaveGameId = `test-game-paid-leave-${crypto.randomUUID()}`;
  const freeLeaveGameId = `test-game-free-leave-${crypto.randomUUID()}`;

  beforeAll(async () => {
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    await db
      .prepare(`INSERT INTO games (id, host_resident_id, activity_label, date, time, capacity, status) VALUES (?, ?, ?, ?, ?, 10, 'open')`)
      .run(paidLeaveGameId, testHostId, "Test Paid Leave Badminton", future, "18:00");
    await db
      .prepare(`INSERT INTO games (id, host_resident_id, activity_label, date, time, capacity, status) VALUES (?, ?, ?, ?, ?, 10, 'open')`)
      .run(freeLeaveGameId, testHostId, "Test Free Leave Badminton", future, "18:00");
    await db
      .prepare(`INSERT INTO game_participants (game_id, resident_id, ref, status, payment_status) VALUES (?, ?, ?, 'joined', 'paid')`)
      .run(paidLeaveGameId, testResidentAId, `test-ref-a-${crypto.randomUUID()}`);
    await db
      .prepare(`INSERT INTO game_participants (game_id, resident_id, ref, status, payment_status) VALUES (?, ?, ?, 'joined', 'paid')`)
      .run(freeLeaveGameId, testResidentBId, `test-ref-b-${crypto.randomUUID()}`);
  });

  afterAll(async () => {
    await db.prepare(`DELETE FROM notifications WHERE listing_id IN (?, ?)`).run(paidLeaveGameId, freeLeaveGameId);
    await db.prepare(`DELETE FROM game_participants WHERE game_id IN (?, ?)`).run(paidLeaveGameId, freeLeaveGameId);
    await db.prepare(`DELETE FROM games WHERE id IN (?, ?)`).run(paidLeaveGameId, freeLeaveGameId);
  });

  it("notifies the host when a paid participant leaves", async () => {
    const res = await fetch(`${baseUrl}/${paidLeaveGameId}/join`, {
      method: "DELETE",
      headers: { "X-Test-Resident-Id": testResidentAId },
    });
    expect(res.status).toBe(200);

    const { n } = (await db
      .prepare(`SELECT COUNT(*) as n FROM notifications WHERE resident_id = ? AND listing_id = ? AND kind = 'game'`)
      .get(testHostId, paidLeaveGameId)) as { n: number };
    expect(n).toBe(1);

    // The participant row is still gone (hard-delete convention preserved —
    // this fix only adds a signal, it doesn't change the leave semantics).
    const { n: remaining } = (await db
      .prepare(`SELECT COUNT(*) as n FROM game_participants WHERE game_id = ? AND resident_id = ?`)
      .get(paidLeaveGameId, testResidentAId)) as { n: number };
    expect(remaining).toBe(0);
  });
});

// Host Experience Polish — GET /host/insights. Dedicated host/resident/game
// fixtures (not the shared testHostId above) so this suite's totals aren't
// perturbed by, or don't perturb, the capacity-race/paid-leave tests above.
describe("GET /host/insights", () => {
  const insightsHostId = `test-insights-host-${crypto.randomUUID()}`;
  const participantAId = `test-insights-a-${crypto.randomUUID()}`;
  const participantBId = `test-insights-b-${crypto.randomUUID()}`;
  const gameOneId = `test-insights-game-1-${crypto.randomUUID()}`;
  const gameTwoId = `test-insights-game-2-${crypto.randomUUID()}`;

  beforeAll(async () => {
    await db.prepare(`INSERT INTO residents (id, email, name) VALUES (?, ?, 'Insights Host')`).run(insightsHostId, `${insightsHostId}@example.test`);
    await db.prepare(`INSERT INTO residents (id, email, name) VALUES (?, ?, 'Participant A')`).run(participantAId, `${participantAId}@example.test`);
    await db.prepare(`INSERT INTO residents (id, email, name) VALUES (?, ?, 'Participant B')`).run(participantBId, `${participantBId}@example.test`);

    const future1 = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const future2 = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString().slice(0, 10);
    await db.prepare(`INSERT INTO games (id, host_resident_id, activity_label, date, time, capacity, status) VALUES (?, ?, 'Insights Game 1', ?, '18:00', 10, 'open')`).run(gameOneId, insightsHostId, future1);
    await db.prepare(`INSERT INTO games (id, host_resident_id, activity_label, date, time, capacity, status) VALUES (?, ?, 'Insights Game 2', ?, '18:00', 10, 'open')`).run(gameTwoId, insightsHostId, future2);

    // A joined and attended both games (repeat participant); B joined only one and was confirmed not-attended.
    await db.prepare(`INSERT INTO game_participants (game_id, resident_id, ref, status, attended) VALUES (?, ?, ?, 'joined', 1)`).run(gameOneId, participantAId, `test-ref-a1-${crypto.randomUUID()}`);
    await db.prepare(`INSERT INTO game_participants (game_id, resident_id, ref, status, attended) VALUES (?, ?, ?, 'joined', 1)`).run(gameTwoId, participantAId, `test-ref-a2-${crypto.randomUUID()}`);
    await db.prepare(`INSERT INTO game_participants (game_id, resident_id, ref, status, attended) VALUES (?, ?, ?, 'joined', 0)`).run(gameOneId, participantBId, `test-ref-b1-${crypto.randomUUID()}`);
  });

  afterAll(async () => {
    await db.prepare(`DELETE FROM game_participants WHERE game_id IN (?, ?)`).run(gameOneId, gameTwoId);
    await db.prepare(`DELETE FROM games WHERE id IN (?, ?)`).run(gameOneId, gameTwoId);
    await db.prepare(`DELETE FROM residents WHERE id IN (?, ?, ?)`).run(insightsHostId, participantAId, participantBId);
  });

  it("computes real totals, repeat-participant %, and attendance rate from confirmed data only", async () => {
    const res = await fetch(`${baseUrl}/host/insights`, { headers: { "X-Test-Resident-Id": insightsHostId } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      totals: { totalSessions: number; cancelledSessions: number; uniqueParticipants: number };
      repeatParticipantPercent: number | null;
      attendanceRatePercent: number | null;
    };
    expect(body.totals.totalSessions).toBe(2);
    expect(body.totals.cancelledSessions).toBe(0);
    expect(body.totals.uniqueParticipants).toBe(2);
    // A joined both (repeat), B joined only one -> 1 of 2 unique participants is a repeat = 50%.
    expect(body.repeatParticipantPercent).toBe(50);
    // 3 confirmed-attendance rows (2 attended, 1 not) -> 2/3 rounded = 67%.
    expect(body.attendanceRatePercent).toBe(67);
  });

  it("returns null (not a fabricated number) for a host with no confirmed attendance data", async () => {
    const emptyHostId = `test-insights-empty-${crypto.randomUUID()}`;
    await db.prepare(`INSERT INTO residents (id, email, name) VALUES (?, ?, 'Empty Host')`).run(emptyHostId, `${emptyHostId}@example.test`);
    try {
      const res = await fetch(`${baseUrl}/host/insights`, { headers: { "X-Test-Resident-Id": emptyHostId } });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { repeatParticipantPercent: number | null; attendanceRatePercent: number | null; narrative: string | null };
      expect(body.repeatParticipantPercent).toBeNull();
      expect(body.attendanceRatePercent).toBeNull();
      expect(body.narrative).toBeNull();
    } finally {
      await db.prepare(`DELETE FROM residents WHERE id = ?`).run(emptyHostId);
    }
  });
});
