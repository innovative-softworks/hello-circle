import crypto from "node:crypto";
import http, { type Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../db/index.js";
import { registrationsRouter } from "./registrations.js";

// Real-DB concurrency + unlimited-capacity tests for registrations.ts's
// session-level `FOR UPDATE` lock (insertRegistrationWithSessionLock) — the
// audit's #3 testing priority, same rationale as games.test.ts. This route
// needs no resident session (guest registrations are the default path), so
// no auth stubbing is needed — only a distinct X-Client-Id per "browser".

let server: Server;
let baseUrl: string;

const testClubId = `test-club-${crypto.randomUUID()}`;
const testSessionId = `test-session-${crypto.randomUUID()}`;
const testUnlimitedSessionId = `test-session-unlimited-${crypto.randomUUID()}`;

function registrationBody(overrides: Record<string, unknown> = {}) {
  return {
    clubId: testClubId,
    sessionId: testSessionId,
    team: "Test Team",
    childFirst: "Test",
    childLast: "Child",
    dob: "2015-01-01",
    gFirst: "Test",
    gLast: "Guardian",
    email: "test-guardian@example.test",
    phone: "0850000000",
    address: "1 Test Street",
    ecName: "Test Contact",
    ecPhone: "0850000001",
    ecRel: "Parent",
    consent: true,
    trial: false,
    ...overrides,
  };
}

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/", registrationsRouter);

  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Failed to bind test server");
  baseUrl = `http://127.0.0.1:${address.port}`;

  // price = 0 so checkout's free path runs unconditionally (no Stripe
  // dependency, regardless of the `trial` flag) — see registrations.ts:236.
  await db
    .prepare(`INSERT INTO clubs (id, name, sport, area, county, ages, price, unit, trial, ph, image_url, blurb) VALUES (?, 'Test Club', 'Testball', 'Test Area', 'Dublin', '5-12', 0, 'year', 1, '', '', '')`)
    .run(testClubId);
  await db
    .prepare(`INSERT INTO club_sessions (id, club_id, day_of_week, time, capacity, label, active) VALUES (?, ?, 1, '18:00', 1, 'Test Session', 1)`)
    .run(testSessionId, testClubId);
  await db
    .prepare(`INSERT INTO club_sessions (id, club_id, day_of_week, time, capacity, label, active) VALUES (?, ?, 2, '18:00', NULL, 'Test Unlimited Session', 1)`)
    .run(testUnlimitedSessionId, testClubId);
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  // Every successful registration also fires an admin/vendor notification
  // as a side effect — clean those up too, or they linger in the
  // notifications table indefinitely.
  await db.prepare(`DELETE FROM notifications WHERE listing_id = ?`).run(testClubId);
  await db.prepare(`DELETE FROM registrations WHERE club_id = ?`).run(testClubId);
  await db.prepare(`DELETE FROM club_sessions WHERE club_id = ?`).run(testClubId);
  await db.prepare(`DELETE FROM clubs WHERE id = ?`).run(testClubId);
});

describe("POST /checkout — session capacity", () => {
  it("lets exactly one of two simultaneous registrations succeed on a capacity=1 session", async () => {
    const register = (clientId: string) =>
      fetch(`${baseUrl}/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Client-Id": clientId },
        body: JSON.stringify(registrationBody()),
      });

    const [resA, resB] = await Promise.all([register(`test-client-a-${crypto.randomUUID()}`), register(`test-client-b-${crypto.randomUUID()}`)]);
    const statuses = [resA.status, resB.status].sort();
    expect(statuses).toEqual([201, 409]);

    const { n } = (await db
      .prepare(`SELECT COUNT(*) as n FROM registrations WHERE session_id = ? AND payment_status = 'paid' AND status != 'cancelled'`)
      .get(testSessionId)) as { n: number };
    expect(n).toBe(1);
  });

  it("never rejects for a null-capacity (unlimited) session", async () => {
    const register = (clientId: string) =>
      fetch(`${baseUrl}/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Client-Id": clientId },
        body: JSON.stringify(registrationBody({ sessionId: testUnlimitedSessionId })),
      });

    const [resA, resB, resC] = await Promise.all([
      register(`test-client-c-${crypto.randomUUID()}`),
      register(`test-client-d-${crypto.randomUUID()}`),
      register(`test-client-e-${crypto.randomUUID()}`),
    ]);
    expect([resA.status, resB.status, resC.status]).toEqual([201, 201, 201]);
  });
});
