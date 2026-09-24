import crypto from "node:crypto";
import http, { type Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../db/index.js";
import { vendorInsightsRouter } from "./vendorInsights.js";

// Vendor Experience Polish — Changeset 1 (Payments correctness). The old
// `/vendor/payments` route derived `totalPaidCents` by reduce()'ing over the
// same 100-rows-per-source `transactions` list it returned for display — so
// once a vendor passed 100 paid bookings (or 100 paid registrations), older
// paid rows fell off the LIMIT and silently stopped counting. It also only
// ever looked at bookings/registrations, undercounting a vendor with paid
// Program/Experience revenue regardless of row count (see vendorInsights.ts's
// current route comment). This suite proves the fix: >100 paid bookings AND
// >100 paid registrations, plus paid rows on all four Vendor-ownable listing
// types, all counted correctly via a true SUM independent of the LIMIT.
//
// Auth is stubbed at the identity layer only, same approach as
// vendorOperations.test.ts — req.user/req.vendorIds set directly by test-only
// middleware rather than standing up a real vendor session.

let server: Server;
let baseUrl: string;

const testVendorUserId = `test-vendor-${crypto.randomUUID()}`;
const testCentreId = `test-centre-${crypto.randomUUID()}`;
const testClubId = `test-club-${crypto.randomUUID()}`;
const testProgramId = `test-program-${crypto.randomUUID()}`;
const testExperienceId = `test-experience-${crypto.randomUUID()}`;

const PAID_BOOKING_COUNT = 105;
const PAID_REGISTRATION_COUNT = 105;
const BOOKING_CENTS = 1000;
const REGISTRATION_CENTS = 1000;
const PROGRAM_ENROLLMENT_COUNT = 3;
const PROGRAM_ENROLLMENT_CENTS = 500;
const EXPERIENCE_BOOKING_COUNT = 3;
const EXPERIENCE_BOOKING_CENTS = 700;
const UNPAID_BOOKING_CENTS = 99999; // must NOT be counted
const CANCELLED_REGISTRATION_CENTS = 88888; // must NOT be counted

const EXPECTED_TOTAL_PAID_CENTS =
  PAID_BOOKING_COUNT * BOOKING_CENTS +
  PAID_REGISTRATION_COUNT * REGISTRATION_CENTS +
  PROGRAM_ENROLLMENT_COUNT * PROGRAM_ENROLLMENT_CENTS +
  EXPERIENCE_BOOKING_COUNT * EXPERIENCE_BOOKING_CENTS;

let bookingRefs: string[] = [];
let registrationRefs: string[] = [];
let programEnrollmentRefs: string[] = [];
let experienceBookingRefs: string[] = [];
let unpaidBookingRef = "";
let cancelledRegistrationRef = "";

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).user = { id: testVendorUserId, role: "vendor", status: "approved", invitedStaff: false, vendorType: "community" };
    (req as any).vendorIds = [testVendorUserId];
    next();
  });
  app.use("/", vendorInsightsRouter);

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
    .prepare(
      `INSERT INTO clubs (id, name, sport, area, county, ages, price, unit, trial, ph, image_url, blurb, vendor_id)
       VALUES (?, 'Test Club', 'Testball', 'Test Area', 'Dublin', '5-12', 10, 'year', 0, '', '', '', ?)`
    )
    .run(testClubId, testVendorUserId);
  await db
    .prepare(`INSERT INTO programs (id, listing_type, listing_id, vendor_id, title, description) VALUES (?, 'centre', ?, ?, 'Test Program', '')`)
    .run(testProgramId, testCentreId, testVendorUserId);
  await db
    .prepare(
      `INSERT INTO experiences (id, vendor_id, title, blurb, description, fitness_requirements, itinerary, equipment_provided, equipment_required, transport_info, safety_info, weather_policy, eligibility, cancellation_terms)
       VALUES (?, ?, 'Test Experience', '', '', '', '', '', '', '', '', '', '', '')`
    )
    .run(testExperienceId, testVendorUserId);

  // Bulk-insert PAID_BOOKING_COUNT paid bookings in one statement — this is
  // the exact >100 boundary the old LIMIT 100 undercounted past.
  bookingRefs = Array.from({ length: PAID_BOOKING_COUNT }, () => `test-bkg-${crypto.randomUUID()}`);
  const bookingValues = bookingRefs.map(() => `(?, ?, ?, 'test-room', '2099-01-01', '18:00', 1, 'Test Event', 2, 'Test Guest', 'guest@example.test', '0850000000', '', ${BOOKING_CENTS}, 'confirmed', 'paid')`).join(", ");
  const bookingParams: unknown[] = [];
  for (const ref of bookingRefs) bookingParams.push(ref, `test-client-${ref}`, testCentreId);
  await db
    .prepare(`INSERT INTO bookings (ref, client_id, centre_id, room_id, date, time, duration, event_type, guests, name, email, phone, notes, total_cents, status, payment_status) VALUES ${bookingValues}`)
    .run(...bookingParams);

  registrationRefs = Array.from({ length: PAID_REGISTRATION_COUNT }, () => `test-reg-${crypto.randomUUID()}`);
  const registrationValues = registrationRefs
    .map(() => `(?, ?, ?, 'Test Team', 'Test', 'Child', '2015-01-01', 'Test', 'Guardian', 'guardian@example.test', '0850000000', '1 Test Street', 'Test Contact', '0850000001', 'Parent', '', 1, 0, ${REGISTRATION_CENTS}, 'confirmed', 'paid')`)
    .join(", ");
  const registrationParams: unknown[] = [];
  for (const ref of registrationRefs) registrationParams.push(ref, `test-client-${ref}`, testClubId);
  await db
    .prepare(
      `INSERT INTO registrations (ref, client_id, club_id, team, child_first, child_last, dob, g_first, g_last, email, phone, address, ec_name, ec_phone, ec_rel, medical, consent, trial, total_cents, status, payment_status) VALUES ${registrationValues}`
    )
    .run(...registrationParams);

  programEnrollmentRefs = Array.from({ length: PROGRAM_ENROLLMENT_COUNT }, () => `test-penr-${crypto.randomUUID()}`);
  const programValues = programEnrollmentRefs.map(() => `(?, ?, ?, 'Test Participant', 'participant@example.test', ${PROGRAM_ENROLLMENT_CENTS}, 'paid')`).join(", ");
  const programParams: unknown[] = [];
  for (const ref of programEnrollmentRefs) programParams.push(ref, testProgramId, `test-client-${ref}`);
  await db
    .prepare(`INSERT INTO program_enrollments (ref, program_id, client_id, participant_name, email, total_cents, payment_status) VALUES ${programValues}`)
    .run(...programParams);

  experienceBookingRefs = Array.from({ length: EXPERIENCE_BOOKING_COUNT }, () => `test-ebkg-${crypto.randomUUID()}`);
  const experienceValues = experienceBookingRefs.map(() => `(?, ?, 'test-session', ?, 'Test Participant', 'participant@example.test', ${EXPERIENCE_BOOKING_CENTS}, 'paid')`).join(", ");
  const experienceParams: unknown[] = [];
  for (const ref of experienceBookingRefs) experienceParams.push(ref, testExperienceId, `test-client-${ref}`);
  await db
    .prepare(`INSERT INTO experience_bookings (ref, experience_id, session_id, client_id, participant_name, email, total_cents, payment_status) VALUES ${experienceValues}`)
    .run(...experienceParams);

  // Non-paid rows with large amounts — must NOT contribute to the total.
  unpaidBookingRef = `test-bkg-unpaid-${crypto.randomUUID()}`;
  await db
    .prepare(
      `INSERT INTO bookings (ref, client_id, centre_id, room_id, date, time, duration, event_type, guests, name, email, phone, notes, total_cents, status, payment_status)
       VALUES (?, ?, ?, 'test-room', '2099-01-01', '19:00', 1, 'Test Event', 2, 'Test Guest', 'guest@example.test', '0850000000', '', ?, 'confirmed', 'pending')`
    )
    .run(unpaidBookingRef, `test-client-${crypto.randomUUID()}`, testCentreId, UNPAID_BOOKING_CENTS);

  cancelledRegistrationRef = `test-reg-cancelled-${crypto.randomUUID()}`;
  await db
    .prepare(
      `INSERT INTO registrations (ref, client_id, club_id, team, child_first, child_last, dob, g_first, g_last, email, phone, address, ec_name, ec_phone, ec_rel, medical, consent, trial, total_cents, status, payment_status)
       VALUES (?, ?, ?, 'Test Team', 'Test', 'Child', '2015-01-01', 'Test', 'Guardian', 'guardian@example.test', '0850000000', '1 Test Street', 'Test Contact', '0850000001', 'Parent', '', 1, 0, ?, 'cancelled', 'refunded')`
    )
    .run(cancelledRegistrationRef, `test-client-${crypto.randomUUID()}`, testClubId, CANCELLED_REGISTRATION_CENTS);
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await db.prepare(`DELETE FROM bookings WHERE centre_id = ?`).run(testCentreId);
  await db.prepare(`DELETE FROM registrations WHERE club_id = ?`).run(testClubId);
  await db.prepare(`DELETE FROM program_enrollments WHERE program_id = ?`).run(testProgramId);
  await db.prepare(`DELETE FROM experience_bookings WHERE experience_id = ?`).run(testExperienceId);
  await db.prepare(`DELETE FROM programs WHERE id = ?`).run(testProgramId);
  await db.prepare(`DELETE FROM experiences WHERE id = ?`).run(testExperienceId);
  await db.prepare(`DELETE FROM clubs WHERE id = ?`).run(testClubId);
  await db.prepare(`DELETE FROM centres WHERE id = ?`).run(testCentreId);
  await db.prepare(`DELETE FROM users WHERE id = ?`).run(testVendorUserId);
});

describe("GET /payments — totalPaidCents true-aggregate regression", () => {
  it("counts every paid row across all four listing types, past the old 100-row LIMIT", async () => {
    const res = await fetch(`${baseUrl}/payments`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { transactions: { ref: string; kind: string; paymentStatus: string }[]; totalPaidCents: number };

    expect(body.totalPaidCents).toBe(EXPECTED_TOTAL_PAID_CENTS);

    // Sanity: the un-paid/cancelled rows exist but contributed nothing.
    const naiveWrongTotal = EXPECTED_TOTAL_PAID_CENTS + UNPAID_BOOKING_CENTS + CANCELLED_REGISTRATION_CENTS;
    expect(body.totalPaidCents).not.toBe(naiveWrongTotal);

    // The displayed list stays capped (150) even though the true total isn't
    // — this changeset fixes totalPaidCents specifically, not the display
    // cap's per-type fairness (a vendor with >150 combined paid
    // bookings+registrations could still have their older paid Program/
    // Experience rows pushed out of this visible slice even though they're
    // correctly counted in totalPaidCents above; that's a separate, smaller
    // finding worth flagging, not something to silently fix here).
    expect(body.transactions.length).toBeLessThanOrEqual(150);
    expect(body.transactions.length).toBeGreaterThan(100);

    const kinds = new Set(body.transactions.map((t) => t.kind));
    expect(kinds.has("booking")).toBe(true);
    expect(kinds.has("registration")).toBe(true);
  });
});

describe("GET /insights — real aggregate math, not just HTTP 200", () => {
  // Vendor Experience Polish — Changeset 6 (test coverage backfill). The
  // Vendor Experience Audit's own finding: "GET /vendor/insights is real
  // and honest" was never actually verified by a test — every number below
  // is hand-computed from the exact fixture rows and asserted precisely,
  // not just checked for a 200 status.
  const vendorId = `test-vendor-insights-${crypto.randomUUID()}`;
  const centreId = `test-centre-insights-${crypto.randomUUID()}`;
  const clubId = `test-club-insights-${crypto.randomUUID()}`;

  beforeAll(async () => {
    await db.prepare(`INSERT INTO users (id, email, password_hash, role, status, name) VALUES (?, ?, 'x', 'vendor', 'approved', 'Test Insights Vendor')`).run(vendorId, `${vendorId}@example.test`);
    await db
      .prepare(`INSERT INTO centres (id, name, area, county, rating, reviews, capacity, from_price, managed_by, ph, image_url, blurb, vendor_id) VALUES (?, 'Insights Centre', 'Area', 'Dublin', 0, 0, 20, 1000, 'Mgr', '', '', '', ?)`)
      .run(centreId, vendorId);
    await db
      .prepare(`INSERT INTO clubs (id, name, sport, area, county, ages, price, unit, trial, ph, image_url, blurb, vendor_id) VALUES (?, 'Insights Club', 'Testball', 'Area', 'Dublin', '5-12', 10, 'year', 0, '', '', '', ?)`)
      .run(clubId, vendorId);

    // Paid bookings — Monday (2026-09-21) gets 3 across 2 hours, Tuesday and
    // Wednesday get 1 each, deliberately making Monday the busiest day by
    // more than the 10% narrative threshold. clientA is reused on a Monday
    // + an August (last-month) row to control uniqueBookers precisely.
    const bookingRows: { ref: string; date: string; time: string; client: string; createdAt: string; status: string; paymentStatus: string }[] = [
      { ref: "b1", date: "2026-09-21", time: "10:00", client: "clientA", createdAt: "2026-09-15 10:00:00", status: "confirmed", paymentStatus: "paid" },
      { ref: "b2", date: "2026-09-21", time: "10:30", client: "clientB", createdAt: "2026-09-15 10:00:00", status: "confirmed", paymentStatus: "paid" },
      { ref: "b3", date: "2026-09-21", time: "11:00", client: "clientA", createdAt: "2026-08-15 10:00:00", status: "confirmed", paymentStatus: "paid" },
      { ref: "b4", date: "2026-09-22", time: "14:00", client: "clientC", createdAt: "2026-09-15 10:00:00", status: "confirmed", paymentStatus: "paid" },
      { ref: "b5", date: "2026-09-23", time: "16:00", client: "clientD", createdAt: "2026-09-15 10:00:00", status: "confirmed", paymentStatus: "paid" },
      { ref: "b6", date: "2026-09-24", time: "09:00", client: "clientE", createdAt: "2026-09-15 10:00:00", status: "cancelled", paymentStatus: "refunded" },
    ];
    for (const b of bookingRows) {
      await db
        .prepare(
          `INSERT INTO bookings (ref, client_id, centre_id, room_id, date, time, duration, event_type, guests, name, email, phone, notes, total_cents, status, payment_status, created_at)
           VALUES (?, ?, ?, 'test-room', ?, ?, 1, 'Test Event', 2, 'Test Guest', 'guest@example.test', '0850000000', '', 1000, ?, ?, ?)`
        )
        .run(`test-${b.ref}-${crypto.randomUUID()}`, b.client, centreId, b.date, b.time, b.status, b.paymentStatus, b.createdAt);
    }

    const registrationRows: { ref: string; createdAt: string; status: string; paymentStatus: string }[] = [
      { ref: "r1", createdAt: "2026-09-15 10:00:00", status: "confirmed", paymentStatus: "paid" },
      { ref: "r2", createdAt: "2026-09-15 10:00:00", status: "confirmed", paymentStatus: "paid" },
      { ref: "r3", createdAt: "2026-09-15 10:00:00", status: "cancelled", paymentStatus: "refunded" },
      { ref: "r4", createdAt: "2026-08-10 10:00:00", status: "confirmed", paymentStatus: "paid" },
    ];
    for (const r of registrationRows) {
      await db
        .prepare(
          `INSERT INTO registrations (ref, client_id, club_id, team, child_first, child_last, dob, g_first, g_last, email, phone, address, ec_name, ec_phone, ec_rel, medical, consent, trial, total_cents, status, payment_status, created_at)
           VALUES (?, ?, ?, 'Team', 'Test', 'Child', '2015-01-01', 'Test', 'Guardian', 'guardian@example.test', '0850000000', '1 Test St', 'Contact', '0850000001', 'Parent', '', 1, 0, 1000, ?, ?, ?)`
        )
        .run(`test-${r.ref}-${crypto.randomUUID()}`, `test-client-${r.ref}-${crypto.randomUUID()}`, clubId, r.status, r.paymentStatus, r.createdAt);
    }
  });

  afterAll(async () => {
    await db.prepare(`DELETE FROM bookings WHERE centre_id = ?`).run(centreId);
    await db.prepare(`DELETE FROM registrations WHERE club_id = ?`).run(clubId);
    await db.prepare(`DELETE FROM centres WHERE id = ?`).run(centreId);
    await db.prepare(`DELETE FROM clubs WHERE id = ?`).run(clubId);
    await db.prepare(`DELETE FROM users WHERE id = ?`).run(vendorId);
  });

  it("computes exact totals, narrative, and trend from the seeded fixtures", async () => {
    const app = express();
    app.use((req, _res, next) => {
      (req as any).user = { id: vendorId, role: "vendor", status: "approved", invitedStaff: false, vendorType: "community" };
      (req as any).vendorIds = [vendorId];
      next();
    });
    app.use("/", vendorInsightsRouter);
    const server2 = http.createServer(app);
    await new Promise<void>((resolve) => server2.listen(0, resolve));
    const address = server2.address();
    if (!address || typeof address === "string") throw new Error("Failed to bind test server");
    const url = `http://127.0.0.1:${address.port}`;

    try {
      const res = await fetch(`${url}/insights`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        totals: { totalBookings: number; cancelledBookings: number; totalRegistrations: number; cancelledRegistrations: number; uniqueBookers: number };
        narrative: string | null;
        trend: { thisMonth: number; lastMonth: number; deltaPercent: number | null };
      };

      expect(body.totals).toEqual({
        totalBookings: 5, // b1-b5 (paid); b6 is 'refunded', excluded
        cancelledBookings: 1, // b6 only (status='cancelled', regardless of payment_status)
        totalRegistrations: 3, // r1, r2, r4 (paid)
        cancelledRegistrations: 1, // r3 only
        uniqueBookers: 4, // clientA (b1,b3), clientB, clientC, clientD
      });

      expect(body.narrative).toBe("Monday is your busiest day — 200% more bookings than your other days average.");

      // thisMonth = b1,b2,b4,b5 (4 paid bookings) + r1,r2 (2 paid registrations) = 6.
      // lastMonth = b3 (1) + r4 (1) = 2. deltaPercent = (6-2)/2*100 = 200.
      expect(body.trend).toEqual({ thisMonth: 6, lastMonth: 2, deltaPercent: 200 });
    } finally {
      await new Promise<void>((resolve) => server2.close(() => resolve()));
    }
  });
});
