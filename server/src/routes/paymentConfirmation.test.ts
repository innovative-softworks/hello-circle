import crypto from "node:crypto";
import http, { type Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../db/index.js";
import { bookingsRouter } from "./bookings.js";
import { registrationsRouter } from "./registrations.js";
import { gamesRouter } from "./games.js";
import { experiencesRouter } from "./experiences.js";
import { programsRouter } from "./programs.js";
import { passesRouter } from "./passes.js";

// Resident Experience Polish — Changeset 5. Every GET .../status/:ref route
// PaymentSuccess.tsx polls used to return only {ref, paymentStatus,
// totalCents} — enough to know payment succeeded, not enough to answer
// "what did I just book?" once it had. This proves each of the six now
// returns real, correct contextual information (not just that the field is
// present — the actual values), and that fields with no honest answer for
// a given type (a registration's date, a program enrollment's date) stay
// absent rather than fabricated.

let server: Server;
let baseUrl: string;

const vendorId = `test-vendor-confirm-${crypto.randomUUID()}`;
const residentId = `test-resident-confirm-${crypto.randomUUID()}`;
const clientId = `test-client-confirm-${crypto.randomUUID()}`;
const centreId = `test-centre-confirm-${crypto.randomUUID()}`;
const roomId = `test-room-confirm-${crypto.randomUUID()}`;
const clubId = `test-club-confirm-${crypto.randomUUID()}`;
const gameId = `test-game-confirm-${crypto.randomUUID()}`;
const experienceId = `test-experience-confirm-${crypto.randomUUID()}`;
const sessionId = `test-session-confirm-${crypto.randomUUID()}`;
const programId = `test-program-confirm-${crypto.randomUUID()}`;

const bookingRef = `HB-${crypto.randomUUID().slice(0, 8)}`;
const registrationRef = `CR-${crypto.randomUUID().slice(0, 8)}`;
const gameJoinRef = `GJ-${crypto.randomUUID().slice(0, 8)}`;
const experienceRef = `EX-${crypto.randomUUID().slice(0, 8)}`;
const programRef = `PR-${crypto.randomUUID().slice(0, 8)}`;
const passRef = `PS-${crypto.randomUUID().slice(0, 8)}`;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).resident = { id: residentId };
    next();
  });
  app.use("/bookings", bookingsRouter);
  app.use("/registrations", registrationsRouter);
  app.use("/games", gamesRouter);
  app.use("/experiences", experiencesRouter);
  app.use("/programs", programsRouter);
  app.use("/passes", passesRouter);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Failed to bind test server");
  baseUrl = `http://127.0.0.1:${address.port}`;

  await db.prepare(`INSERT INTO users (id, email, password_hash, role, status, name) VALUES (?, ?, 'x', 'vendor', 'approved', 'Test Vendor')`).run(vendorId, `${vendorId}@example.test`);
  await db
    .prepare(`INSERT INTO centres (id, name, area, county, rating, reviews, capacity, from_price, managed_by, ph, image_url, blurb, vendor_id) VALUES (?, 'Confirm Centre', 'Confirm Area', 'Dublin', 0, 0, 20, 1000, 'Mgr', '', '', '', ?)`)
    .run(centreId, vendorId);
  await db.prepare(`INSERT INTO rooms (id, centre_id, name, cap, rate, \`desc\`, sort_order) VALUES (?, ?, 'Main Hall', 20, 50, '', 0)`).run(roomId, centreId);
  await db
    .prepare(`INSERT INTO clubs (id, name, sport, area, county, ages, price, unit, trial, ph, image_url, blurb, vendor_id) VALUES (?, 'Confirm Club', 'Testball', 'Confirm Area', 'Dublin', '5-12', 10, 'year', 0, '', '', '', ?)`)
    .run(clubId, vendorId);
  await db
    .prepare(`INSERT INTO games (id, host_resident_id, activity_label, centre_id, date, time, capacity, price_cents, status) VALUES (?, ?, 'Confirm Badminton', ?, '2099-01-01', '18:00', 8, 500, 'open')`)
    .run(gameId, residentId, centreId);
  await db
    .prepare(
      `INSERT INTO experiences (id, vendor_id, title, meeting_point, blurb, description, fitness_requirements, itinerary, equipment_provided, equipment_required, transport_info, safety_info, weather_policy, eligibility, cancellation_terms)
       VALUES (?, ?, 'Confirm Hike', 'Trailhead car park', '', '', '', '', '', '', '', '', '', '', '')`
    )
    .run(experienceId, vendorId);
  await db.prepare(`INSERT INTO experience_sessions (id, experience_id, date, time) VALUES (?, ?, '2099-02-01', '09:00')`).run(sessionId, experienceId);
  await db.prepare(`INSERT INTO programs (id, listing_type, listing_id, vendor_id, title, description) VALUES (?, 'centre', ?, ?, 'Confirm Program', '')`).run(programId, centreId, vendorId);

  await db
    .prepare(
      `INSERT INTO bookings (ref, client_id, centre_id, room_id, date, time, duration, event_type, guests, name, email, phone, notes, total_cents, status, payment_status)
       VALUES (?, ?, ?, ?, '2099-03-01', '19:00', 2, 'Party', 12, 'Test Guest', 'guest@example.test', '0850000000', '', 10000, 'confirmed', 'paid')`
    )
    .run(bookingRef, clientId, centreId, roomId);
  await db
    .prepare(
      `INSERT INTO registrations (ref, client_id, club_id, team, child_first, child_last, dob, g_first, g_last, email, phone, address, ec_name, ec_phone, ec_rel, medical, consent, trial, total_cents, status, payment_status)
       VALUES (?, ?, ?, 'Under-10s', 'Test', 'Child', '2016-01-01', 'Test', 'Guardian', 'guardian@example.test', '0850000000', '1 Test St', 'Contact', '0850000001', 'Parent', '', 1, 0, 5000, 'confirmed', 'paid')`
    )
    .run(registrationRef, clientId, clubId);
  await db.prepare(`INSERT INTO game_participants (game_id, resident_id, ref, status, payment_status) VALUES (?, ?, ?, 'joined', 'paid')`).run(gameId, residentId, gameJoinRef);
  await db
    .prepare(`INSERT INTO experience_bookings (ref, experience_id, session_id, client_id, participant_name, email, party_size, total_cents, payment_status) VALUES (?, ?, ?, ?, 'Test Hiker', 'hiker@example.test', 3, 15000, 'paid')`)
    .run(experienceRef, experienceId, sessionId, clientId);
  await db
    .prepare(`INSERT INTO program_enrollments (ref, program_id, client_id, participant_name, email, total_cents, payment_status) VALUES (?, ?, ?, 'Test Enrollee', 'guardian@example.test', 8000, 'paid')`)
    .run(programRef, programId, clientId);
  await db
    .prepare(`INSERT INTO passes (ref, resident_id, listing_type, listing_id, credits_total, purchased_cents, payment_status) VALUES (?, ?, 'club', ?, 10, 9000, 'paid')`)
    .run(passRef, residentId, clubId);
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await db.prepare(`DELETE FROM bookings WHERE ref = ?`).run(bookingRef);
  await db.prepare(`DELETE FROM registrations WHERE ref = ?`).run(registrationRef);
  await db.prepare(`DELETE FROM game_participants WHERE ref = ?`).run(gameJoinRef);
  await db.prepare(`DELETE FROM experience_bookings WHERE ref = ?`).run(experienceRef);
  await db.prepare(`DELETE FROM program_enrollments WHERE ref = ?`).run(programRef);
  await db.prepare(`DELETE FROM passes WHERE ref = ?`).run(passRef);
  await db.prepare(`DELETE FROM games WHERE id = ?`).run(gameId);
  await db.prepare(`DELETE FROM experience_sessions WHERE id = ?`).run(sessionId);
  await db.prepare(`DELETE FROM experiences WHERE id = ?`).run(experienceId);
  await db.prepare(`DELETE FROM programs WHERE id = ?`).run(programId);
  await db.prepare(`DELETE FROM rooms WHERE centre_id = ?`).run(centreId);
  await db.prepare(`DELETE FROM centres WHERE id = ?`).run(centreId);
  await db.prepare(`DELETE FROM clubs WHERE id = ?`).run(clubId);
  await db.prepare(`DELETE FROM users WHERE id = ?`).run(vendorId);
});

describe("GET /bookings/status/:ref", () => {
  it("returns the real centre/room/date/time/guests, not just paymentStatus", async () => {
    const res = await fetch(`${baseUrl}/bookings/status/${bookingRef}`, { headers: { "X-Client-Id": clientId } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      paymentStatus: "paid",
      totalCents: 10000,
      centreId,
      centreName: "Confirm Centre",
      roomName: "Main Hall",
      date: "2099-03-01",
      time: "19:00",
      duration: 2,
      guests: 12,
    });
  });
});

describe("GET /registrations/status/:ref", () => {
  it("returns the real club/child/team, with no fabricated date field", async () => {
    const res = await fetch(`${baseUrl}/registrations/status/${registrationRef}`, { headers: { "X-Client-Id": clientId } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ paymentStatus: "paid", totalCents: 5000, clubId, clubName: "Confirm Club", childFirst: "Test", childLast: "Child", team: "Under-10s" });
    expect(body.date).toBeUndefined();
  });
});

describe("GET /games/status/:ref", () => {
  it("returns the real game/date/time/venue", async () => {
    const res = await fetch(`${baseUrl}/games/status/${gameJoinRef}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ paymentStatus: "paid", gameId, activityLabel: "Confirm Badminton", date: "2099-01-01", time: "18:00", centreName: "Confirm Centre" });
  });
});

describe("GET /experiences/bookings/status/:ref", () => {
  it("returns the real experience/session/party size", async () => {
    const res = await fetch(`${baseUrl}/experiences/bookings/status/${experienceRef}`, { headers: { "X-Client-Id": clientId } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      paymentStatus: "paid",
      totalCents: 15000,
      experienceId,
      title: "Confirm Hike",
      meetingPoint: "Trailhead car park",
      date: "2099-02-01",
      time: "09:00",
      partySize: 3,
    });
  });
});

describe("GET /programs/enrollments/status/:ref", () => {
  it("returns the real program/listing name, with no fabricated date field", async () => {
    const res = await fetch(`${baseUrl}/programs/enrollments/status/${programRef}`, { headers: { "X-Client-Id": clientId } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ paymentStatus: "paid", totalCents: 8000, programId, title: "Confirm Program", listingName: "Confirm Centre" });
    expect(body.date).toBeUndefined();
  });
});

describe("GET /passes/status/:ref", () => {
  it("returns the real club/credits", async () => {
    const res = await fetch(`${baseUrl}/passes/status/${passRef}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ paymentStatus: "paid", totalCents: 9000, clubId, clubName: "Confirm Club", creditsTotal: 10 });
  });
});
