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
