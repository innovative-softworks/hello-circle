import crypto from "node:crypto";
import http, { type Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../db/index.js";
import { reviewsRouter } from "./reviews.js";

// Resident Experience Polish — Changeset 1B. Centre/Club review eligibility
// previously only checked "does any booking/registration row exist at
// all" — no date, status, or payment_status check, unlike Game/Host/
// Experience, which all require genuine past-and-paid participation. This
// suite proves the fix via GET /eligible (side-effect-free) with real
// fixture rows for every case: future-dated, cancelled, unpaid, and a
// genuinely eligible past+paid+confirmed one.

let server: Server;
let baseUrl: string;

const vendorId = `test-vendor-reviews-${crypto.randomUUID()}`;
const centreId = `test-centre-reviews-${crypto.randomUUID()}`;
const clubId = `test-club-reviews-${crypto.randomUUID()}`;
const programId = `test-program-reviews-${crypto.randomUUID()}`;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/", reviewsRouter);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Failed to bind test server");
  baseUrl = `http://127.0.0.1:${address.port}`;

  await db.prepare(`INSERT INTO users (id, email, password_hash, role, status, name) VALUES (?, ?, 'x', 'vendor', 'approved', 'Test Vendor')`).run(vendorId, `${vendorId}@example.test`);
  await db
    .prepare(`INSERT INTO centres (id, name, area, county, rating, reviews, capacity, from_price, managed_by, ph, image_url, blurb, vendor_id, status) VALUES (?, 'Reviews Centre', 'Area', 'Dublin', 0, 0, 20, 1000, 'Mgr', '', '', '', ?, 'approved')`)
    .run(centreId, vendorId);
  await db
    .prepare(`INSERT INTO clubs (id, name, sport, area, county, ages, price, unit, trial, ph, image_url, blurb, vendor_id, status) VALUES (?, 'Reviews Club', 'Testball', 'Area', 'Dublin', '5-12', 10, 'year', 0, '', '', '', ?, 'approved')`)
    .run(clubId, vendorId);
  await db
    .prepare(`INSERT INTO programs (id, listing_type, listing_id, vendor_id, title, description, status) VALUES (?, 'centre', ?, ?, 'Reviews Program', '', 'published')`)
    .run(programId, centreId, vendorId);
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await db.prepare(`DELETE FROM bookings WHERE centre_id = ?`).run(centreId);
  await db.prepare(`DELETE FROM registrations WHERE club_id = ?`).run(clubId);
  await db.prepare(`DELETE FROM program_enrollments WHERE program_id = ?`).run(programId);
  await db.prepare(`DELETE FROM program_sessions WHERE program_id = ?`).run(programId);
  await db.prepare(`DELETE FROM programs WHERE id = ?`).run(programId);
  await db.prepare(`DELETE FROM centres WHERE id = ?`).run(centreId);
  await db.prepare(`DELETE FROM clubs WHERE id = ?`).run(clubId);
  await db.prepare(`DELETE FROM users WHERE id = ?`).run(vendorId);
});

async function checkEligible(clientId: string, listingType: string, listingId: string): Promise<boolean> {
  const res = await fetch(`${baseUrl}/eligible?listingType=${listingType}&listingId=${listingId}`, { headers: { "X-Client-Id": clientId } });
  const body = (await res.json()) as { eligible: boolean };
  return body.eligible;
}

describe("Centre review eligibility", () => {
  it("true for a paid, confirmed, past booking", async () => {
    const clientId = `test-client-${crypto.randomUUID()}`;
    await db
      .prepare(
        `INSERT INTO bookings (ref, client_id, centre_id, room_id, date, time, duration, event_type, guests, name, email, phone, notes, total_cents, status, payment_status)
         VALUES (?, ?, ?, 'test-room', '2020-01-01', '18:00', 1, 'Event', 2, 'Guest', 'guest@example.test', '0850000000', '', 1000, 'confirmed', 'paid')`
      )
      .run(`test-bkg-${crypto.randomUUID()}`, clientId, centreId);
    expect(await checkEligible(clientId, "centre", centreId)).toBe(true);
  });

  it("false for a future-dated booking (hasn't happened yet)", async () => {
    const clientId = `test-client-${crypto.randomUUID()}`;
    await db
      .prepare(
        `INSERT INTO bookings (ref, client_id, centre_id, room_id, date, time, duration, event_type, guests, name, email, phone, notes, total_cents, status, payment_status)
         VALUES (?, ?, ?, 'test-room', '2099-01-01', '18:00', 1, 'Event', 2, 'Guest', 'guest@example.test', '0850000000', '', 1000, 'confirmed', 'paid')`
      )
      .run(`test-bkg-${crypto.randomUUID()}`, clientId, centreId);
    expect(await checkEligible(clientId, "centre", centreId)).toBe(false);
  });

  it("false for a cancelled past booking, even though payment_status stayed 'paid'", async () => {
    const clientId = `test-client-${crypto.randomUUID()}`;
    await db
      .prepare(
        `INSERT INTO bookings (ref, client_id, centre_id, room_id, date, time, duration, event_type, guests, name, email, phone, notes, total_cents, status, payment_status)
         VALUES (?, ?, ?, 'test-room', '2020-01-01', '18:00', 1, 'Event', 2, 'Guest', 'guest@example.test', '0850000000', '', 1000, 'cancelled', 'paid')`
      )
      .run(`test-bkg-${crypto.randomUUID()}`, clientId, centreId);
    expect(await checkEligible(clientId, "centre", centreId)).toBe(false);
  });

  it("false for a never-paid (pending) past booking", async () => {
    const clientId = `test-client-${crypto.randomUUID()}`;
    await db
      .prepare(
        `INSERT INTO bookings (ref, client_id, centre_id, room_id, date, time, duration, event_type, guests, name, email, phone, notes, total_cents, status, payment_status)
         VALUES (?, ?, ?, 'test-room', '2020-01-01', '18:00', 1, 'Event', 2, 'Guest', 'guest@example.test', '0850000000', '', 1000, 'confirmed', 'pending')`
      )
      .run(`test-bkg-${crypto.randomUUID()}`, clientId, centreId);
    expect(await checkEligible(clientId, "centre", centreId)).toBe(false);
  });

  it("false with no participation at all", async () => {
    const clientId = `test-client-${crypto.randomUUID()}`;
    expect(await checkEligible(clientId, "centre", centreId)).toBe(false);
  });
});

describe("Club review eligibility", () => {
  it("true for a paid, confirmed registration", async () => {
    const clientId = `test-client-${crypto.randomUUID()}`;
    await db
      .prepare(
        `INSERT INTO registrations (ref, client_id, club_id, team, child_first, child_last, dob, g_first, g_last, email, phone, address, ec_name, ec_phone, ec_rel, medical, consent, trial, total_cents, status, payment_status)
         VALUES (?, ?, ?, 'Team', 'Test', 'Child', '2015-01-01', 'Test', 'Guardian', 'guardian@example.test', '0850000000', '1 Test St', 'Contact', '0850000001', 'Parent', '', 1, 0, 1000, 'confirmed', 'paid')`
      )
      .run(`test-reg-${crypto.randomUUID()}`, clientId, clubId);
    expect(await checkEligible(clientId, "club", clubId)).toBe(true);
  });

  it("false for a cancelled registration", async () => {
    const clientId = `test-client-${crypto.randomUUID()}`;
    await db
      .prepare(
        `INSERT INTO registrations (ref, client_id, club_id, team, child_first, child_last, dob, g_first, g_last, email, phone, address, ec_name, ec_phone, ec_rel, medical, consent, trial, total_cents, status, payment_status)
         VALUES (?, ?, ?, 'Team', 'Test', 'Child', '2015-01-01', 'Test', 'Guardian', 'guardian@example.test', '0850000000', '1 Test St', 'Contact', '0850000001', 'Parent', '', 1, 0, 1000, 'cancelled', 'paid')`
      )
      .run(`test-reg-${crypto.randomUUID()}`, clientId, clubId);
    expect(await checkEligible(clientId, "club", clubId)).toBe(false);
  });

  it("false for a never-paid registration", async () => {
    const clientId = `test-client-${crypto.randomUUID()}`;
    await db
      .prepare(
        `INSERT INTO registrations (ref, client_id, club_id, team, child_first, child_last, dob, g_first, g_last, email, phone, address, ec_name, ec_phone, ec_rel, medical, consent, trial, total_cents, status, payment_status)
         VALUES (?, ?, ?, 'Team', 'Test', 'Child', '2015-01-01', 'Test', 'Guardian', 'guardian@example.test', '0850000000', '1 Test St', 'Contact', '0850000001', 'Parent', '', 1, 0, 1000, 'confirmed', 'pending')`
      )
      .run(`test-reg-${crypto.randomUUID()}`, clientId, clubId);
    expect(await checkEligible(clientId, "club", clubId)).toBe(false);
  });

  it("false with no participation at all", async () => {
    const clientId = `test-client-${crypto.randomUUID()}`;
    expect(await checkEligible(clientId, "club", clubId)).toBe(false);
  });
});

describe("Program review eligibility", () => {
  // Resident Experience Polish — Changeset 3. Program was not a reviewable
  // listing type at all before this. "Meaningful participation" means at
  // least one real, non-cancelled session has already happened — merely
  // being enrolled (even paid) isn't enough, since a program is ongoing.

  it("true once paid, confirmed, and at least one past session exists", async () => {
    const clientId = `test-client-${crypto.randomUUID()}`;
    await db
      .prepare(`INSERT INTO program_sessions (id, program_id, date, time, status) VALUES (?, ?, '2020-01-01', '10:00', 'scheduled')`)
      .run(`test-sess-${crypto.randomUUID()}`, programId);
    await db
      .prepare(`INSERT INTO program_enrollments (ref, program_id, client_id, participant_name, email, payment_status, status) VALUES (?, ?, ?, 'Test Child', 'guardian@example.test', 'paid', 'confirmed')`)
      .run(`test-pe-${crypto.randomUUID()}`, programId, clientId);
    expect(await checkEligible(clientId, "program", programId)).toBe(true);
  });

  it("false when paid and confirmed but no session has happened yet", async () => {
    const noSessionProgramId = `test-program-nosession-${crypto.randomUUID()}`;
    await db
      .prepare(`INSERT INTO programs (id, listing_type, listing_id, vendor_id, title, description, status) VALUES (?, 'centre', ?, ?, 'No Session Yet Program', '', 'published')`)
      .run(noSessionProgramId, centreId, vendorId);
    await db
      .prepare(`INSERT INTO program_sessions (id, program_id, date, time, status) VALUES (?, ?, '2099-01-01', '10:00', 'scheduled')`)
      .run(`test-sess-${crypto.randomUUID()}`, noSessionProgramId);
    const clientId = `test-client-${crypto.randomUUID()}`;
    await db
      .prepare(`INSERT INTO program_enrollments (ref, program_id, client_id, participant_name, email, payment_status, status) VALUES (?, ?, ?, 'Test Child', 'guardian@example.test', 'paid', 'confirmed')`)
      .run(`test-pe-${crypto.randomUUID()}`, noSessionProgramId, clientId);

    expect(await checkEligible(clientId, "program", noSessionProgramId)).toBe(false);

    await db.prepare(`DELETE FROM program_enrollments WHERE program_id = ?`).run(noSessionProgramId);
    await db.prepare(`DELETE FROM program_sessions WHERE program_id = ?`).run(noSessionProgramId);
    await db.prepare(`DELETE FROM programs WHERE id = ?`).run(noSessionProgramId);
  });

  it("false for a cancelled enrollment, even with a past session", async () => {
    const clientId = `test-client-${crypto.randomUUID()}`;
    await db
      .prepare(`INSERT INTO program_enrollments (ref, program_id, client_id, participant_name, email, payment_status, status) VALUES (?, ?, ?, 'Test Child', 'guardian@example.test', 'paid', 'cancelled')`)
      .run(`test-pe-${crypto.randomUUID()}`, programId, clientId);
    expect(await checkEligible(clientId, "program", programId)).toBe(false);
  });

  it("false for a never-paid enrollment", async () => {
    const clientId = `test-client-${crypto.randomUUID()}`;
    await db
      .prepare(`INSERT INTO program_enrollments (ref, program_id, client_id, participant_name, email, payment_status, status) VALUES (?, ?, ?, 'Test Child', 'guardian@example.test', 'pending', 'confirmed')`)
      .run(`test-pe-${crypto.randomUUID()}`, programId, clientId);
    expect(await checkEligible(clientId, "program", programId)).toBe(false);
  });

  it("false with no enrollment at all", async () => {
    const clientId = `test-client-${crypto.randomUUID()}`;
    expect(await checkEligible(clientId, "program", programId)).toBe(false);
  });

  it("an eligible participant can actually submit a program review end to end", async () => {
    const clientId = `test-client-${crypto.randomUUID()}`;
    await db
      .prepare(`INSERT INTO program_enrollments (ref, program_id, client_id, participant_name, email, payment_status, status) VALUES (?, ?, ?, 'Test Child', 'guardian@example.test', 'paid', 'confirmed')`)
      .run(`test-pe-${crypto.randomUUID()}`, programId, clientId);

    const res = await fetch(`${baseUrl}/`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Client-Id": clientId },
      body: JSON.stringify({ listingType: "program", listingId: programId, name: "Test Reviewer", rating: 5, comment: "Great program" }),
    });
    expect(res.status).toBe(201);

    const listRes = await fetch(`${baseUrl}/?listingType=program&listingId=${programId}`);
    const reviews = (await listRes.json()) as { rating: number; comment: string }[];
    expect(reviews.some((r) => r.comment === "Great program")).toBe(true);
  });
});
