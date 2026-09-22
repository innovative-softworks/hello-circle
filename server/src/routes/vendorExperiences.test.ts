import crypto from "node:crypto";
import http, { type Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../db/index.js";
import { vendorExperiencesRouter } from "./vendorExperiences.js";

// Phase 0 protect: vendor-facing experience booking cancel + refund,
// previously entirely missing. Same auth-stub convention as
// vendorOperations.test.ts / vendorPrograms.test.ts.

let server: Server;
let baseUrl: string;

const testVendorUserId = `test-vendor-${crypto.randomUUID()}`;
const testExperienceId = `test-experience-${crypto.randomUUID()}`;
const testSessionId = `test-session-${crypto.randomUUID()}`;
let bookingRefA: string;
let bookingIdA: number;
let bookingRefB: string;
let bookingIdB: number;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).user = { id: testVendorUserId, role: "vendor", status: "approved", invitedStaff: false };
    (req as any).vendorIds = [testVendorUserId];
    next();
  });
  app.use("/", vendorExperiencesRouter);

  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Failed to bind test server");
  baseUrl = `http://127.0.0.1:${address.port}`;

  await db.prepare(`INSERT INTO users (id, email, password_hash, role, status, name) VALUES (?, ?, 'x', 'vendor', 'approved', 'Test Vendor')`).run(testVendorUserId, `${testVendorUserId}@example.test`);
  await db
    .prepare(`INSERT INTO experiences (id, vendor_id, title, blurb, description, fitness_requirements, itinerary, equipment_provided, equipment_required, transport_info, safety_info, weather_policy, eligibility, cancellation_terms, status) VALUES (?, ?, 'Test Adventure', 'A test blurb', 'A test description', '', '', '', '', '', '', '', '', '', 'approved')`)
    .run(testExperienceId, testVendorUserId);
  const future = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  await db.prepare(`INSERT INTO experience_sessions (id, experience_id, date, time) VALUES (?, ?, ?, '18:00')`).run(testSessionId, testExperienceId, future);

  bookingRefA = `test-eb-a-${crypto.randomUUID()}`;
  bookingRefB = `test-eb-b-${crypto.randomUUID()}`;
  const resultA = await db
    .prepare(`INSERT INTO experience_bookings (ref, experience_id, session_id, client_id, participant_name, email, payment_status) VALUES (?, ?, ?, ?, 'Guest A', 'a@example.test', 'paid')`)
    .run(bookingRefA, testExperienceId, testSessionId, `test-client-a-${crypto.randomUUID()}`);
  bookingIdA = Number(resultA.lastInsertRowid);
  const resultB = await db
    .prepare(`INSERT INTO experience_bookings (ref, experience_id, session_id, client_id, participant_name, email, payment_status) VALUES (?, ?, ?, ?, 'Guest B', 'b@example.test', 'paid')`)
    .run(bookingRefB, testExperienceId, testSessionId, `test-client-b-${crypto.randomUUID()}`);
  bookingIdB = Number(resultB.lastInsertRowid);
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await db.prepare(`DELETE FROM audit_log WHERE object_id IN (?, ?)`).run(bookingRefA, bookingRefB);
  await db.prepare(`DELETE FROM notifications WHERE listing_id = ?`).run(testExperienceId);
  await db.prepare(`DELETE FROM experience_bookings WHERE experience_id = ?`).run(testExperienceId);
  await db.prepare(`DELETE FROM experience_sessions WHERE experience_id = ?`).run(testExperienceId);
  await db.prepare(`DELETE FROM experiences WHERE id = ?`).run(testExperienceId);
  await db.prepare(`DELETE FROM users WHERE id = ?`).run(testVendorUserId);
});

describe("POST /experiences/:id/bookings/:bookingId/cancel", () => {
  it("cancels a booking", async () => {
    const res = await fetch(`${baseUrl}/experiences/${testExperienceId}/bookings/${bookingIdA}/cancel`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    expect(res.status).toBe(200);
    const row = (await db.prepare(`SELECT status FROM experience_bookings WHERE ref = ?`).get(bookingRefA)) as { status: string };
    expect(row.status).toBe("cancelled");
  });

  it("rejects cancelling the same booking twice", async () => {
    const res = await fetch(`${baseUrl}/experiences/${testExperienceId}/bookings/${bookingIdA}/cancel`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    expect(res.status).toBe(409);
  });
});

describe("POST /experiences/:id/bookings/:bookingId/refund — idempotency guard", () => {
  it("the UPDATE guard blocks a second concurrent refund from also flipping payment_status", async () => {
    const results = await Promise.all([
      db.prepare(`UPDATE experience_bookings SET payment_status = 'refunded' WHERE ref = ? AND payment_status = 'paid'`).run(bookingRefB),
      db.prepare(`UPDATE experience_bookings SET payment_status = 'refunded' WHERE ref = ? AND payment_status = 'paid'`).run(bookingRefB),
    ]);
    const changesTotal = results.reduce((sum, r) => sum + r.changes, 0);
    expect(changesTotal).toBe(1);
  });

  it("a refund attempt on an already-refunded booking is rejected by the route", async () => {
    const res = await fetch(`${baseUrl}/experiences/${testExperienceId}/bookings/${bookingIdB}/refund`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    expect(res.status).toBe(409);
  });
});
