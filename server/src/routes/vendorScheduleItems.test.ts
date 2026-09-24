import crypto from "node:crypto";
import http, { type Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../db/index.js";
import { irelandTodayIso } from "../irelandTime.js";
import { vendorOperationsRouter } from "./vendorOperations.js";

// Vendor Experience Polish — Changeset 2 introduced GET /vendor/schedule-items,
// a normalized cross-listing-type read layer (Centre bookings, Club
// sessions, Program sessions, Experience sessions) shared by the Overview
// "Next Up" section and, later, the full Schedule tab. This is the
// correctness suite for that new endpoint: all four source types appear
// together in one chronologically-sorted list, a recurring club_session is
// projected onto the correct real calendar date, and organisation ownership
// scoping holds (Vendor A never sees Vendor B's items) — the exact
// cross-type-collision scenario the Vendor Experience Polish brief calls
// out under its Changeset 3 testing section, already covered here since the
// underlying endpoint was built as shared Changeset 2/3 infrastructure.

let server: Server;
let baseUrl: string;

const vendorAId = `test-vendor-a-${crypto.randomUUID()}`;
const vendorBId = `test-vendor-b-${crypto.randomUUID()}`;
const centreAId = `test-centre-a-${crypto.randomUUID()}`;
const centreBId = `test-centre-b-${crypto.randomUUID()}`;
const clubAId = `test-club-a-${crypto.randomUUID()}`;
const programAId = `test-program-a-${crypto.randomUUID()}`;
const experienceAId = `test-experience-a-${crypto.randomUUID()}`;

const clubSessionId = `test-clubsess-${crypto.randomUUID()}`;
const programSessionId = `test-progsess-${crypto.randomUUID()}`;
const experienceSessionId = `test-expsess-${crypto.randomUUID()}`;
const bookingRef = `test-bkg-${crypto.randomUUID()}`;
const bookingBRef = `test-bkg-b-${crypto.randomUUID()}`;

function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Must match the server's own notion of "today" (GET /schedule-items
// defaults `from` to irelandTodayIso(), not a plain UTC date) — plain
// `new Date().toISOString().slice(0,10)` drifts a full day off Ireland's
// local date during the ~23:00-23:59 UTC window each day when Ireland
// (UTC+1 under BST) has already rolled over to the next calendar date but
// UTC hasn't yet. This is the exact "BST midnight-hour window" bug this
// same file's /schedule-today route has its own comment warning about —
// the test was hitting it, not the production code.
const fromIso = irelandTodayIso();
const todayDayOfWeek = new Date(`${fromIso}T12:00:00Z`).getUTCDay();
const programDate = addDaysIso(fromIso, 5);
const bookingDate = addDaysIso(fromIso, 10);
const experienceDate = addDaysIso(fromIso, 15);

let apiUser: { id: string; role: string; status: string; invitedStaff: boolean; vendorType: string } = {
  id: vendorAId,
  role: "vendor",
  status: "approved",
  invitedStaff: false,
  vendorType: "community",
};

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).user = apiUser;
    (req as any).vendorIds = [apiUser.id];
    next();
  });
  app.use("/", vendorOperationsRouter);

  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Failed to bind test server");
  baseUrl = `http://127.0.0.1:${address.port}`;

  await db.prepare(`INSERT INTO users (id, email, password_hash, role, status, name) VALUES (?, ?, 'x', 'vendor', 'approved', 'Test Vendor A')`).run(vendorAId, `${vendorAId}@example.test`);
  await db.prepare(`INSERT INTO users (id, email, password_hash, role, status, name) VALUES (?, ?, 'x', 'vendor', 'approved', 'Test Vendor B')`).run(vendorBId, `${vendorBId}@example.test`);

  await db
    .prepare(`INSERT INTO centres (id, name, area, county, rating, reviews, capacity, from_price, managed_by, ph, image_url, blurb, vendor_id) VALUES (?, 'Centre A', 'Area A', 'Dublin', 0, 0, 20, 1000, 'Manager', '', '', '', ?)`)
    .run(centreAId, vendorAId);
  await db
    .prepare(`INSERT INTO centres (id, name, area, county, rating, reviews, capacity, from_price, managed_by, ph, image_url, blurb, vendor_id) VALUES (?, 'Centre B', 'Area B', 'Cork', 0, 0, 20, 1000, 'Manager', '', '', '', ?)`)
    .run(centreBId, vendorBId);
  await db
    .prepare(`INSERT INTO clubs (id, name, sport, area, county, ages, price, unit, trial, ph, image_url, blurb, vendor_id) VALUES (?, 'Club A', 'Testball', 'Area A', 'Dublin', '5-12', 10, 'year', 0, '', '', '', ?)`)
    .run(clubAId, vendorAId);
  await db.prepare(`INSERT INTO programs (id, listing_type, listing_id, vendor_id, title, description) VALUES (?, 'centre', ?, ?, 'Program A', '')`).run(programAId, centreAId, vendorAId);
  await db
    .prepare(
      `INSERT INTO experiences (id, vendor_id, title, blurb, description, fitness_requirements, itinerary, equipment_provided, equipment_required, transport_info, safety_info, weather_policy, eligibility, cancellation_terms)
       VALUES (?, ?, 'Experience A', '', '', '', '', '', '', '', '', '', '', '')`
    )
    .run(experienceAId, vendorAId);

  // Vendor A: one item of each of the four source types, staggered so the
  // expected chronological order is club(today) < program(+5d) < centre
  // booking(+10d) < experience(+15d).
  await db.prepare(`INSERT INTO club_sessions (id, club_id, day_of_week, time, label, active) VALUES (?, ?, ?, '08:00', 'Morning Training', 1)`).run(clubSessionId, clubAId, todayDayOfWeek);
  await db.prepare(`INSERT INTO program_sessions (id, program_id, date, time, duration_minutes, status) VALUES (?, ?, ?, '10:00', 60, 'scheduled')`).run(programSessionId, programAId, programDate);
  await db
    .prepare(
      `INSERT INTO bookings (ref, client_id, centre_id, room_id, date, time, duration, event_type, guests, name, email, phone, notes, total_cents, status, payment_status)
       VALUES (?, ?, ?, 'test-room', ?, '18:00', 2, 'Yoga', 18, 'Test Guest', 'guest@example.test', '0850000000', '', 1000, 'confirmed', 'paid')`
    )
    .run(bookingRef, `test-client-${crypto.randomUUID()}`, centreAId, bookingDate);
  await db.prepare(`INSERT INTO experience_sessions (id, experience_id, date, time, status) VALUES (?, ?, ?, '09:00', 'scheduled')`).run(experienceSessionId, experienceAId, experienceDate);

  // Vendor B: a booking in the same window — must never appear for Vendor A.
  await db
    .prepare(
      `INSERT INTO bookings (ref, client_id, centre_id, room_id, date, time, duration, event_type, guests, name, email, phone, notes, total_cents, status, payment_status)
       VALUES (?, ?, ?, 'test-room', ?, '12:00', 2, 'Vendor B Event', 5, 'Other Guest', 'other@example.test', '0850000001', '', 1000, 'confirmed', 'paid')`
    )
    .run(bookingBRef, `test-client-${crypto.randomUUID()}`, centreBId, addDaysIso(fromIso, 3));
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await db.prepare(`DELETE FROM bookings WHERE ref IN (?, ?)`).run(bookingRef, bookingBRef);
  await db.prepare(`DELETE FROM club_sessions WHERE id = ?`).run(clubSessionId);
  await db.prepare(`DELETE FROM program_sessions WHERE id = ?`).run(programSessionId);
  await db.prepare(`DELETE FROM experience_sessions WHERE id = ?`).run(experienceSessionId);
  await db.prepare(`DELETE FROM programs WHERE id = ?`).run(programAId);
  await db.prepare(`DELETE FROM experiences WHERE id = ?`).run(experienceAId);
  await db.prepare(`DELETE FROM clubs WHERE id = ?`).run(clubAId);
  await db.prepare(`DELETE FROM centres WHERE id IN (?, ?)`).run(centreAId, centreBId);
  await db.prepare(`DELETE FROM users WHERE id IN (?, ?)`).run(vendorAId, vendorBId);
});

describe("GET /schedule-items", () => {
  it("merges all four listing types, in chronological order, scoped to the requesting vendor only", async () => {
    apiUser = { id: vendorAId, role: "vendor", status: "approved", invitedStaff: false, vendorType: "community" };
    const res = await fetch(`${baseUrl}/schedule-items?days=30`);
    expect(res.status).toBe(200);
    const items = (await res.json()) as { id: string; sourceType: string; listingName: string; startDateTime: string; participantCount: number | null; bookingCount: number | null }[];

    const mine = items.filter((i) => [`club-${clubSessionId}-${fromIso}`, `program-${programSessionId}`, `centre-${bookingRef}`, `experience-${experienceSessionId}`].includes(i.id));
    expect(mine).toHaveLength(4);

    // Chronological, ascending.
    const sourceOrder = mine.map((i) => i.sourceType);
    expect(sourceOrder).toEqual(["club", "program", "centre", "experience"]);
    for (let i = 1; i < mine.length; i++) {
      expect(new Date(mine[i].startDateTime).getTime()).toBeGreaterThanOrEqual(new Date(mine[i - 1].startDateTime).getTime());
    }

    // The recurring club session projected onto today's real calendar date,
    // not some other day.
    const clubItem = mine.find((i) => i.sourceType === "club")!;
    expect(clubItem.startDateTime.slice(0, 10)).toBe(fromIso);

    // Real per-source counts, not fabricated ones.
    const centreItem = mine.find((i) => i.sourceType === "centre")!;
    expect(centreItem.participantCount).toBe(18);
    const clubCount = mine.find((i) => i.sourceType === "club")!;
    expect(clubCount.participantCount).toBeNull();
    expect(clubCount.bookingCount).toBeNull();

    // Vendor B's booking must never appear for Vendor A.
    expect(items.some((i) => i.id === `centre-${bookingBRef}`)).toBe(false);
  });

  it("Vendor B sees only its own items, not Vendor A's", async () => {
    apiUser = { id: vendorBId, role: "vendor", status: "approved", invitedStaff: false, vendorType: "community" };
    const res = await fetch(`${baseUrl}/schedule-items?days=30`);
    expect(res.status).toBe(200);
    const items = (await res.json()) as { id: string }[];

    expect(items.some((i) => i.id === `centre-${bookingBRef}`)).toBe(true);
    expect(items.some((i) => i.id === `centre-${bookingRef}`)).toBe(false);
    expect(items.some((i) => i.id === `program-${programSessionId}`)).toBe(false);
    expect(items.some((i) => i.id === `experience-${experienceSessionId}`)).toBe(false);
  });
});
