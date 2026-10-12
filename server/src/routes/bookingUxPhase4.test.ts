import crypto from "node:crypto";
import http, { type Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../db/index.js";
import { textFingerprint } from "../orderAcknowledgements.js";
import { experiencesRouter } from "./experiences.js";
import { gamesRouter } from "./games.js";
import { programsRouter } from "./programs.js";

// Booking UX Phase 4: minimum age is enforced (a declaration), named seats
// are recorded and validated, and acknowledgements are stored with the order
// (terms version resolved server-side, safety as a fingerprint of the text).

let server: Server;
let baseUrl: string;
const tag = crypto.randomUUID().slice(0, 8);
const vendorId = `test-vendor-p4-${tag}`;
const expId = `test-exp-p4-${tag}`;
const sessionId = `test-session-p4-${tag}`;
const programId = `test-program-p4-${tag}`;
const gameId = `test-game-p4-${tag}`;
const hostId = `test-host-p4-${tag}`;
const joinerId = `test-joiner-p4-${tag}`;
const SAFETY = "Wear boots. Guides carry first aid.";

const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(`${baseUrl}${path}`, { method: "POST", headers: { "Content-Type": "application/json", "X-Client-Id": `test-client-p4-${tag}`, ...headers }, body: JSON.stringify(body) });
const book = (body: Record<string, unknown>) => post(`/experiences/${expId}/sessions/${sessionId}/checkout`, { participantName: "Lead Booker", email: `p4-${tag}@example.test`, ...body });

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const residentId = req.header("X-Test-Resident-Id");
    if (residentId) (req as unknown as { resident: { id: string; email: string } }).resident = { id: residentId, email: `${residentId}@example.test` };
    next();
  });
  app.use("/experiences", experiencesRouter);
  app.use("/programs", programsRouter);
  app.use("/games", gamesRouter);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Failed to bind test server");
  baseUrl = `http://127.0.0.1:${address.port}`;

  await db.prepare(`INSERT INTO users (id, email, password_hash, role, status, name) VALUES (?, ?, 'x', 'vendor', 'approved', 'P4 Vendor')`).run(vendorId, `${vendorId}@example.test`);
  await db
    .prepare(
      `INSERT INTO experiences (id, vendor_id, title, blurb, description, fitness_requirements, itinerary, equipment_provided, equipment_required, transport_info, safety_info, weather_policy, eligibility, cancellation_terms, status, price_cents, payment_method, capacity, min_age)
       VALUES (?, ?, 'P4 Hike', 'b', 'd', '', '', '', '', '', ?, '', '', '', 'approved', 2000, 'cash', 10, 12)`
    )
    .run(expId, vendorId, SAFETY);
  await db.prepare(`INSERT INTO experience_sessions (id, experience_id, date, time) VALUES (?, ?, '2099-07-01', '10:00')`).run(sessionId, expId);
  await db.prepare(`INSERT INTO programs (id, listing_type, listing_id, vendor_id, title, description, status, price_cents) VALUES (?, 'centre', 'none', ?, 'P4 Course', '', 'published', 0)`).run(programId, vendorId);
  for (const id of [hostId, joinerId]) await db.prepare(`INSERT INTO residents (id, email, name) VALUES (?, ?, ?)`).run(id, `${id}@example.test`, id);
  await db.prepare(`INSERT INTO games (id, host_resident_id, activity_label, date, time, capacity, status, min_age) VALUES (?, ?, 'P4 Climb', '2099-07-02', '10:00', 5, 'open', 16)`).run(gameId, hostId);
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  const refs = ((await db.prepare(`SELECT ref FROM experience_bookings WHERE experience_id = ?`).all(expId)) as { ref: string }[]).map((r) => r.ref);
  for (const ref of refs) await db.prepare(`DELETE FROM experience_booking_participants WHERE booking_ref = ?`).run(ref);
  await db.prepare(`DELETE FROM order_acknowledgements WHERE client_id = ?`).run(`test-client-p4-${tag}`);
  await db.prepare(`DELETE FROM notifications WHERE listing_id IN (?, ?, ?)`).run(expId, programId, gameId);
  await db.prepare(`DELETE FROM experience_bookings WHERE experience_id = ?`).run(expId);
  await db.prepare(`DELETE FROM experience_sessions WHERE experience_id = ?`).run(expId);
  await db.prepare(`DELETE FROM experiences WHERE id = ?`).run(expId);
  await db.prepare(`DELETE FROM program_enrollments WHERE program_id = ?`).run(programId);
  await db.prepare(`DELETE FROM programs WHERE id = ?`).run(programId);
  await db.prepare(`DELETE FROM game_participants WHERE game_id = ?`).run(gameId);
  await db.prepare(`DELETE FROM games WHERE id = ?`).run(gameId);
  await db.prepare(`DELETE FROM residents WHERE id IN (?, ?)`).run(hostId, joinerId);
  await db.prepare(`DELETE FROM users WHERE id = ?`).run(vendorId);
});

describe("experiences — minimum age, named seats, acknowledgements", () => {
  it("refuses a booking without the minimum-age confirmation", async () => {
    const res = await book({ partySize: 1 });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ minAge: 12 });
  });

  it("refuses a party whose names don't match its size", async () => {
    expect((await book({ partySize: 2, meetsMinAge: true, participants: ["Only One"] })).status).toBe(400);
    expect((await book({ partySize: 2, meetsMinAge: true, participants: ["Aoife", "  "] })).status).toBe(400);
  });

  it("records each seat's name and what was agreed, with the order", async () => {
    const res = await book({ partySize: 2, meetsMinAge: true, participants: ["Aoife  Byrne", "Cian Byrne"], acceptedTerms: true, acceptedSafety: true });
    expect(res.status).toBe(201);
    const { ref } = await res.json();
    const seats = (await db.prepare(`SELECT seat, name FROM experience_booking_participants WHERE booking_ref = ? ORDER BY seat`).all(ref)) as { seat: number; name: string }[];
    expect(seats).toEqual([{ seat: 1, name: "Aoife Byrne" }, { seat: 2, name: "Cian Byrne" }]);
    const acks = (await db.prepare(`SELECT kind, doc_key as docKey, doc_version as docVersion, text_fingerprint as fp FROM order_acknowledgements WHERE source_type = 'experience' AND source_ref = ? ORDER BY kind`).all(ref)) as Record<string, unknown>[];
    // No published Terms version in the test database: recorded as such, not invented.
    expect(acks).toEqual([
      { kind: "safety", docKey: null, docVersion: null, fp: textFingerprint(SAFETY) },
      { kind: "terms", docKey: "customer-booking-terms", docVersion: null, fp: null },
    ]);
  });
});

describe("programmes and events", () => {
  it("records the terms acknowledgement with a programme enrolment", async () => {
    const res = await post(`/programs/${programId}/enroll`, { participantName: "P4 Learner", email: `p4-${tag}@example.test`, acceptedTerms: true });
    expect(res.status).toBe(201);
    const { ref } = await res.json();
    const ack = await db.prepare(`SELECT kind FROM order_acknowledgements WHERE source_type = 'program' AND source_ref = ?`).get(ref);
    expect(ack).toEqual({ kind: "terms" });
  });

  it("enforces an event's minimum age at join", async () => {
    const headers = { "X-Test-Resident-Id": joinerId };
    const refused = await post(`/games/${gameId}/join`, {}, headers);
    expect(refused.status).toBe(400);
    expect(await refused.json()).toMatchObject({ minAge: 16, error: expect.stringContaining("at least 16") });
    expect((await post(`/games/${gameId}/join`, { meetsMinAge: true }, headers)).status).toBe(200);
  });
});
