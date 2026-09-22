import crypto from "node:crypto";
import http, { type Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../db/index.js";
import { programsRouter } from "./programs.js";

// Phase 0 protect: programs previously had no cancel route at all, even
// though program_enrollments.status already supported 'cancelled'. This
// covers the new resident/guest self-cancel route end-to-end.

let server: Server;
let baseUrl: string;

const testCentreId = `test-centre-${crypto.randomUUID()}`;
const testVendorId = `test-vendor-${crypto.randomUUID()}`;
const testProgramId = `test-program-${crypto.randomUUID()}`;
const testClientId = `test-client-${crypto.randomUUID()}`;
let paidEnrollmentRef: string;
let unpaidEnrollmentRef: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/", programsRouter);

  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Failed to bind test server");
  baseUrl = `http://127.0.0.1:${address.port}`;

  await db.prepare(`INSERT INTO users (id, email, password_hash, role, status, name) VALUES (?, ?, 'x', 'vendor', 'approved', 'Test Vendor')`).run(testVendorId, `${testVendorId}@example.test`);
  await db
    .prepare(
      `INSERT INTO centres (id, name, area, county, rating, reviews, capacity, from_price, managed_by, ph, image_url, blurb, vendor_id)
       VALUES (?, 'Test Centre', 'Test Area', 'Dublin', 0, 0, 20, 1000, 'Test Manager', '', '', '', ?)`
    )
    .run(testCentreId, testVendorId);
  await db
    .prepare(`INSERT INTO programs (id, listing_type, listing_id, vendor_id, title, description, status) VALUES (?, 'centre', ?, ?, 'Test Program', 'A test program', 'published')`)
    .run(testProgramId, testCentreId, testVendorId);

  paidEnrollmentRef = `test-pr-${crypto.randomUUID()}`;
  unpaidEnrollmentRef = `test-pr-unpaid-${crypto.randomUUID()}`;
  await db
    .prepare(`INSERT INTO program_enrollments (ref, program_id, client_id, participant_name, email, payment_status) VALUES (?, ?, ?, 'Test Child', 'guardian@example.test', 'paid')`)
    .run(paidEnrollmentRef, testProgramId, testClientId);
  await db
    .prepare(`INSERT INTO program_enrollments (ref, program_id, client_id, participant_name, email, payment_status) VALUES (?, ?, ?, 'Test Child', 'guardian@example.test', 'pending')`)
    .run(unpaidEnrollmentRef, testProgramId, testClientId);
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await db.prepare(`DELETE FROM notifications WHERE listing_id = ?`).run(testCentreId);
  await db.prepare(`DELETE FROM program_enrollments WHERE program_id = ?`).run(testProgramId);
  await db.prepare(`DELETE FROM programs WHERE id = ?`).run(testProgramId);
  await db.prepare(`DELETE FROM centres WHERE id = ?`).run(testCentreId);
  await db.prepare(`DELETE FROM users WHERE id = ?`).run(testVendorId);
});

describe("POST /enrollments/:ref/cancel", () => {
  it("cancels a paid enrollment owned by this client_id", async () => {
    const res = await fetch(`${baseUrl}/enrollments/${paidEnrollmentRef}/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Client-Id": testClientId },
      body: "{}",
    });
    expect(res.status).toBe(200);

    const row = (await db.prepare(`SELECT status FROM program_enrollments WHERE ref = ?`).get(paidEnrollmentRef)) as { status: string };
    expect(row.status).toBe("cancelled");
  });

  it("rejects cancelling the same enrollment twice", async () => {
    const res = await fetch(`${baseUrl}/enrollments/${paidEnrollmentRef}/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Client-Id": testClientId },
      body: "{}",
    });
    expect(res.status).toBe(409);
  });

  it("rejects cancelling an enrollment that was never paid", async () => {
    const res = await fetch(`${baseUrl}/enrollments/${unpaidEnrollmentRef}/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Client-Id": testClientId },
      body: "{}",
    });
    expect(res.status).toBe(409);
  });

  it("rejects a client_id that doesn't own the enrollment", async () => {
    const res = await fetch(`${baseUrl}/enrollments/${unpaidEnrollmentRef}/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Client-Id": `test-other-client-${crypto.randomUUID()}` },
      body: "{}",
    });
    expect(res.status).toBe(404);
  });
});
