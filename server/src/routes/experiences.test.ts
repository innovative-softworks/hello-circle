import crypto from "node:crypto";
import http, { type Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../db/index.js";
import { experiencesRouter } from "./experiences.js";

// Phase 0 protect: experience bookings previously had no cancel route at
// all, even though experience_bookings.status already supported
// 'cancelled'. Unlike programs (no single dated occurrence), an experience
// booking IS tied to one session, so this also covers the org
// cancellationHours cutoff check (same mechanism bookings.ts already uses).

let server: Server;
let baseUrl: string;

const testVendorId = `test-vendor-${crypto.randomUUID()}`;
const testExperienceId = `test-experience-${crypto.randomUUID()}`;
const futureSessionId = `test-session-future-${crypto.randomUUID()}`;
const soonSessionId = `test-session-soon-${crypto.randomUUID()}`;
const testClientId = `test-client-${crypto.randomUUID()}`;
let farFutureBookingRef: string;
let withinCutoffBookingRef: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/", experiencesRouter);

  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Failed to bind test server");
  baseUrl = `http://127.0.0.1:${address.port}`;

  await db.prepare(`INSERT INTO users (id, email, password_hash, role, status, name) VALUES (?, ?, 'x', 'vendor', 'approved', 'Test Vendor')`).run(testVendorId, `${testVendorId}@example.test`);
  await db
    .prepare(`INSERT INTO experiences (id, vendor_id, title, blurb, description, fitness_requirements, itinerary, equipment_provided, equipment_required, transport_info, safety_info, weather_policy, eligibility, cancellation_terms, status) VALUES (?, ?, 'Test Adventure', 'A test blurb', 'A test description', '', '', '', '', '', '', '', '', '', 'approved')`)
    .run(testExperienceId, testVendorId);

  // Default org cancellationHours is 48 (orgPoliciesForVendor's fallback for
  // a vendor with no org row) — one session well outside that window, one
  // well inside it.
  const farFutureDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const soonDate = new Date(Date.now() + 60 * 60 * 1000).toISOString().slice(0, 10);
  const soonHour = new Date(Date.now() + 60 * 60 * 1000).getHours();
  await db.prepare(`INSERT INTO experience_sessions (id, experience_id, date, time) VALUES (?, ?, ?, '18:00')`).run(futureSessionId, testExperienceId, farFutureDate);
  await db.prepare(`INSERT INTO experience_sessions (id, experience_id, date, time) VALUES (?, ?, ?, ?)`).run(soonSessionId, testExperienceId, soonDate, `${String(soonHour).padStart(2, "0")}:00`);

  farFutureBookingRef = `test-eb-far-${crypto.randomUUID()}`;
  withinCutoffBookingRef = `test-eb-soon-${crypto.randomUUID()}`;
  await db
    .prepare(`INSERT INTO experience_bookings (ref, experience_id, session_id, client_id, participant_name, email, payment_status) VALUES (?, ?, ?, ?, 'Test Guest', 'guest@example.test', 'paid')`)
    .run(farFutureBookingRef, testExperienceId, futureSessionId, testClientId);
  await db
    .prepare(`INSERT INTO experience_bookings (ref, experience_id, session_id, client_id, participant_name, email, payment_status) VALUES (?, ?, ?, ?, 'Test Guest', 'guest@example.test', 'paid')`)
    .run(withinCutoffBookingRef, testExperienceId, soonSessionId, testClientId);
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await db.prepare(`DELETE FROM notifications WHERE listing_id = ?`).run(testExperienceId);
  await db.prepare(`DELETE FROM experience_bookings WHERE experience_id = ?`).run(testExperienceId);
  await db.prepare(`DELETE FROM experience_sessions WHERE experience_id = ?`).run(testExperienceId);
  await db.prepare(`DELETE FROM experiences WHERE id = ?`).run(testExperienceId);
  await db.prepare(`DELETE FROM users WHERE id = ?`).run(testVendorId);
});

describe("POST /bookings/:ref/cancel", () => {
  it("cancels a paid booking for a session well outside the cutoff window", async () => {
    const res = await fetch(`${baseUrl}/bookings/${farFutureBookingRef}/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Client-Id": testClientId },
      body: "{}",
    });
    expect(res.status).toBe(200);

    const row = (await db.prepare(`SELECT status FROM experience_bookings WHERE ref = ?`).get(farFutureBookingRef)) as { status: string };
    expect(row.status).toBe("cancelled");
  });

  it("rejects cancelling a booking for a session within the cancellation cutoff", async () => {
    const res = await fetch(`${baseUrl}/bookings/${withinCutoffBookingRef}/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Client-Id": testClientId },
      body: "{}",
    });
    expect(res.status).toBe(409);

    const row = (await db.prepare(`SELECT status FROM experience_bookings WHERE ref = ?`).get(withinCutoffBookingRef)) as { status: string };
    expect(row.status).toBe("confirmed");
  });

  it("rejects cancelling the same booking twice", async () => {
    const res = await fetch(`${baseUrl}/bookings/${farFutureBookingRef}/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Client-Id": testClientId },
      body: "{}",
    });
    expect(res.status).toBe(409);
  });
});
