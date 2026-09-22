import crypto from "node:crypto";
import http, { type Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../db/index.js";
import { vendorProgramsRouter } from "./vendorPrograms.js";

// Phase 0 protect: vendor-facing program enrollment cancel + refund,
// previously entirely missing. Auth stubbed the same way
// vendorOperations.test.ts does (org-owner vendor, always passes
// requirePlatformRole/assertPlatformRole — see auth.ts's hasPlatformRole).

let server: Server;
let baseUrl: string;

const testVendorUserId = `test-vendor-${crypto.randomUUID()}`;
const testCentreId = `test-centre-${crypto.randomUUID()}`;
const testProgramId = `test-program-${crypto.randomUUID()}`;
let enrollmentRefA: string;
let enrollmentIdA: number;
let enrollmentRefB: string;
let enrollmentIdB: number;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).user = { id: testVendorUserId, role: "vendor", status: "approved", invitedStaff: false };
    (req as any).vendorIds = [testVendorUserId];
    next();
  });
  app.use("/", vendorProgramsRouter);

  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Failed to bind test server");
  baseUrl = `http://127.0.0.1:${address.port}`;

  await db.prepare(`INSERT INTO users (id, email, password_hash, role, status, name) VALUES (?, ?, 'x', 'vendor', 'approved', 'Test Vendor')`).run(testVendorUserId, `${testVendorUserId}@example.test`);
  await db
    .prepare(
      `INSERT INTO centres (id, name, area, county, rating, reviews, capacity, from_price, managed_by, ph, image_url, blurb, vendor_id)
       VALUES (?, 'Test Centre', 'Test Area', 'Dublin', 0, 0, 20, 1000, 'Test Manager', '', '', '', ?)`
    )
    .run(testCentreId, testVendorUserId);
  await db
    .prepare(`INSERT INTO programs (id, listing_type, listing_id, vendor_id, title, description, status) VALUES (?, 'centre', ?, ?, 'Test Program', 'A test program', 'published')`)
    .run(testProgramId, testCentreId, testVendorUserId);

  enrollmentRefA = `test-pr-a-${crypto.randomUUID()}`;
  enrollmentRefB = `test-pr-b-${crypto.randomUUID()}`;
  const resultA = await db
    .prepare(`INSERT INTO program_enrollments (ref, program_id, client_id, participant_name, email, payment_status) VALUES (?, ?, ?, 'Test Child A', 'a@example.test', 'paid')`)
    .run(enrollmentRefA, testProgramId, `test-client-a-${crypto.randomUUID()}`);
  enrollmentIdA = Number(resultA.lastInsertRowid);
  const resultB = await db
    .prepare(`INSERT INTO program_enrollments (ref, program_id, client_id, participant_name, email, payment_status) VALUES (?, ?, ?, 'Test Child B', 'b@example.test', 'paid')`)
    .run(enrollmentRefB, testProgramId, `test-client-b-${crypto.randomUUID()}`);
  enrollmentIdB = Number(resultB.lastInsertRowid);
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await db.prepare(`DELETE FROM audit_log WHERE object_id IN (?, ?)`).run(enrollmentRefA, enrollmentRefB);
  await db.prepare(`DELETE FROM notifications WHERE listing_id = ?`).run(testCentreId);
  await db.prepare(`DELETE FROM program_enrollments WHERE program_id = ?`).run(testProgramId);
  await db.prepare(`DELETE FROM programs WHERE id = ?`).run(testProgramId);
  await db.prepare(`DELETE FROM centres WHERE id = ?`).run(testCentreId);
  await db.prepare(`DELETE FROM users WHERE id = ?`).run(testVendorUserId);
});

describe("POST /programs/:programId/enrollments/:enrollmentId/cancel", () => {
  it("cancels an enrollment", async () => {
    const res = await fetch(`${baseUrl}/programs/${testProgramId}/enrollments/${enrollmentIdA}/cancel`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    expect(res.status).toBe(200);
    const row = (await db.prepare(`SELECT status FROM program_enrollments WHERE ref = ?`).get(enrollmentRefA)) as { status: string };
    expect(row.status).toBe("cancelled");
  });

  it("rejects cancelling the same enrollment twice", async () => {
    const res = await fetch(`${baseUrl}/programs/${testProgramId}/enrollments/${enrollmentIdA}/cancel`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    expect(res.status).toBe(409);
  });
});

describe("POST /programs/:programId/enrollments/:enrollmentId/refund — idempotency guard", () => {
  it("the UPDATE guard blocks a second concurrent refund from also flipping payment_status", async () => {
    const results = await Promise.all([
      db.prepare(`UPDATE program_enrollments SET payment_status = 'refunded' WHERE ref = ? AND payment_status = 'paid'`).run(enrollmentRefB),
      db.prepare(`UPDATE program_enrollments SET payment_status = 'refunded' WHERE ref = ? AND payment_status = 'paid'`).run(enrollmentRefB),
    ]);
    const changesTotal = results.reduce((sum, r) => sum + r.changes, 0);
    expect(changesTotal).toBe(1);
  });

  it("a refund attempt on an already-refunded enrollment is rejected by the route", async () => {
    const res = await fetch(`${baseUrl}/programs/${testProgramId}/enrollments/${enrollmentIdB}/refund`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    expect(res.status).toBe(409);
  });
});
