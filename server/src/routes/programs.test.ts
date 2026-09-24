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

describe("GET /enrollments/mine — real next-session date", () => {
  // Resident Experience Polish — Changeset 1A. Previously the client had no
  // way to know when a program enrollment's next session actually is; the
  // only date available was pe.created_at (when the resident enrolled).
  // These fixtures use their own program/client, isolated from the cancel
  // tests above.
  const programWithSessionsId = `test-program-sessions-${crypto.randomUUID()}`;
  const programNoFutureId = `test-program-nofuture-${crypto.randomUUID()}`;
  const clientId2 = `test-client2-${crypto.randomUUID()}`;
  let enrollmentWithSessionsRef: string;
  let enrollmentNoFutureRef: string;
  const pastSessionId = `test-sess-past-${crypto.randomUUID()}`;
  const nearFutureSessionId = `test-sess-near-${crypto.randomUUID()}`;
  const farFutureSessionId = `test-sess-far-${crypto.randomUUID()}`;
  const cancelledFutureSessionId = `test-sess-cancelled-${crypto.randomUUID()}`;
  const onlyPastSessionId = `test-sess-onlypast-${crypto.randomUUID()}`;

  beforeAll(async () => {
    await db
      .prepare(`INSERT INTO programs (id, listing_type, listing_id, vendor_id, title, description, status) VALUES (?, 'centre', ?, ?, 'Sessions Program', '', 'published')`)
      .run(programWithSessionsId, testCentreId, testVendorId);
    await db
      .prepare(`INSERT INTO programs (id, listing_type, listing_id, vendor_id, title, description, status) VALUES (?, 'centre', ?, ?, 'No Future Sessions Program', '', 'published')`)
      .run(programNoFutureId, testCentreId, testVendorId);

    // programWithSessionsId: one past, one cancelled-future (must be
    // skipped), one near future, one far future — nearest real, non-
    // cancelled future session must win.
    await db.prepare(`INSERT INTO program_sessions (id, program_id, date, time, status) VALUES (?, ?, '2020-01-01', '10:00', 'scheduled')`).run(pastSessionId, programWithSessionsId);
    await db.prepare(`INSERT INTO program_sessions (id, program_id, date, time, status) VALUES (?, ?, '2099-01-05', '09:00', 'cancelled')`).run(cancelledFutureSessionId, programWithSessionsId);
    await db.prepare(`INSERT INTO program_sessions (id, program_id, date, time, status) VALUES (?, ?, '2099-02-01', '18:00', 'scheduled')`).run(farFutureSessionId, programWithSessionsId);
    await db.prepare(`INSERT INTO program_sessions (id, program_id, date, time, status) VALUES (?, ?, '2099-01-10', '19:00', 'scheduled')`).run(nearFutureSessionId, programWithSessionsId);

    // programNoFutureId: only a past session — nextSessionDate must be null.
    await db.prepare(`INSERT INTO program_sessions (id, program_id, date, time, status) VALUES (?, ?, '2020-06-01', '10:00', 'scheduled')`).run(onlyPastSessionId, programNoFutureId);

    enrollmentWithSessionsRef = `test-pr-sessions-${crypto.randomUUID()}`;
    enrollmentNoFutureRef = `test-pr-nofuture-${crypto.randomUUID()}`;
    await db
      .prepare(`INSERT INTO program_enrollments (ref, program_id, client_id, participant_name, email, payment_status) VALUES (?, ?, ?, 'Test Child', 'guardian@example.test', 'paid')`)
      .run(enrollmentWithSessionsRef, programWithSessionsId, clientId2);
    await db
      .prepare(`INSERT INTO program_enrollments (ref, program_id, client_id, participant_name, email, payment_status) VALUES (?, ?, ?, 'Test Child', 'guardian@example.test', 'paid')`)
      .run(enrollmentNoFutureRef, programNoFutureId, clientId2);
  });

  afterAll(async () => {
    await db.prepare(`DELETE FROM program_enrollments WHERE client_id = ?`).run(clientId2);
    await db.prepare(`DELETE FROM program_sessions WHERE program_id IN (?, ?)`).run(programWithSessionsId, programNoFutureId);
    await db.prepare(`DELETE FROM programs WHERE id IN (?, ?)`).run(programWithSessionsId, programNoFutureId);
  });

  it("selects the nearest real, non-cancelled future session — never the past or a cancelled one", async () => {
    const res = await fetch(`${baseUrl}/enrollments/mine`, { headers: { "X-Client-Id": clientId2 } });
    expect(res.status).toBe(200);
    const rows = (await res.json()) as { ref: string; nextSessionDate: string | null; nextSessionTime: string | null }[];
    const row = rows.find((r) => r.ref === enrollmentWithSessionsRef);
    expect(row?.nextSessionDate).toBe("2099-01-10");
    expect(row?.nextSessionTime).toBe("19:00");
  });

  it("returns null, not a fabricated date, when only a past session exists", async () => {
    const res = await fetch(`${baseUrl}/enrollments/mine`, { headers: { "X-Client-Id": clientId2 } });
    const rows = (await res.json()) as { ref: string; nextSessionDate: string | null; nextSessionTime: string | null }[];
    const row = rows.find((r) => r.ref === enrollmentNoFutureRef);
    expect(row?.nextSessionDate).toBeNull();
    expect(row?.nextSessionTime).toBeNull();
  });
});

describe("POST /:id/enroll — coupon application", () => {
  // Resident Experience Polish — Changeset 3. couponCode was previously
  // accepted by EnrollBody and silently ignored (computePricing always
  // called with discount=0/code=null). Proves it now genuinely applies and
  // is recorded on the enrollment row.
  const paidProgramId = `test-program-coupon-${crypto.randomUUID()}`;
  const couponCode = `TESTCOUPON${crypto.randomUUID().slice(0, 8).toUpperCase()}`;

  beforeAll(async () => {
    await db
      .prepare(`INSERT INTO programs (id, listing_type, listing_id, vendor_id, title, description, status, price_cents) VALUES (?, 'centre', ?, ?, 'Coupon Program', 'A test program', 'published', 10000)`)
      .run(paidProgramId, testCentreId, testVendorId);
    // 100%-off so the enrollment resolves through the free path (no Stripe
    // call) — this test environment has no STRIPE_SECRET_KEY configured, so
    // any coupon that leaves a nonzero total would 503 on checkout before
    // ever reaching the assertions below.
    await db.prepare(`INSERT INTO coupons (code, kind, amount, active) VALUES (?, 'percent', 100, 1)`).run(couponCode);
  });

  afterAll(async () => {
    await db.prepare(`DELETE FROM program_enrollments WHERE program_id = ?`).run(paidProgramId);
    await db.prepare(`DELETE FROM programs WHERE id = ?`).run(paidProgramId);
    await db.prepare(`DELETE FROM coupons WHERE code = ?`).run(couponCode);
  });

  it("applies a valid coupon's discount and records the code on the enrollment", async () => {
    const res = await fetch(`${baseUrl}/${paidProgramId}/enroll`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Client-Id": `test-client-${crypto.randomUUID()}` },
      body: JSON.stringify({ participantName: "Test Child", email: "guardian@example.test", couponCode }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { ref: string; totalEuro: number };
    expect(body.totalEuro).toBe(0);

    const row = (await db.prepare(`SELECT coupon_code as couponCode, total_cents as totalCents, payment_status as paymentStatus FROM program_enrollments WHERE ref = ?`).get(body.ref)) as {
      couponCode: string | null;
      totalCents: number;
      paymentStatus: string;
    };
    expect(row.couponCode).toBe(couponCode);
    expect(row.totalCents).toBe(0);
    expect(row.paymentStatus).toBe("paid");
  });

  it("rejects an invalid coupon code rather than silently ignoring it", async () => {
    const res = await fetch(`${baseUrl}/${paidProgramId}/enroll`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Client-Id": `test-client-${crypto.randomUUID()}` },
      body: JSON.stringify({ participantName: "Test Child", email: "guardian@example.test", couponCode: "NOT-A-REAL-CODE" }),
    });
    expect(res.status).toBe(400);
  });
});
