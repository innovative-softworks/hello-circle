import crypto from "node:crypto";
import http, { type Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../db/index.js";
import { bookingsRouter } from "./bookings.js";
import { circlesRouter } from "./circles.js";
import { gamesRouter } from "./games.js";
import { vendorOperationsRouter } from "./vendorOperations.js";

// Booking UX Phase 5:
//   B10 approval Circles: organiser questions, the requester's note and answers, race-safe respond
//   B11 an activity names a venue only through the host's own confirmed booking
//   E1  a booking with an activity on it: the guest can't pull it out; a venue cancel cascades

let server: Server;
let baseUrl: string;
const tag = crypto.randomUUID().slice(0, 8);
const organiserId = `test-org-p5-${tag}`;
const requesterId = `test-req-p5-${tag}`;
const circleId = `test-circle-p5-${tag}`;
const hostId = `test-host-p5-${tag}`;
const joinerId = `test-joiner-p5-${tag}`;
const vendorId = `test-vendor-p5-${tag}`;
const centreId = `test-centre-p5-${tag}`;
const roomId = `test-room-p5-${tag}`;
const bookingRef = `HB-P5${tag}`;
const hostClient = `test-client-p5-${tag}`;
const DATE = "2099-08-01";

function call(method: string, path: string, body?: unknown, residentId?: string, extra: Record<string, string> = {}) {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(residentId ? { "X-Test-Resident-Id": residentId } : {}), ...extra },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const residentId = req.header("X-Test-Resident-Id");
    if (residentId) (req as unknown as { resident: object }).resident = { id: residentId, name: residentId, email: `${residentId}@example.test` };
    if (req.header("X-Test-Vendor")) {
      (req as unknown as { user: object }).user = { id: vendorId, role: "vendor", status: "approved", invitedStaff: false };
      (req as unknown as { vendorIds: string[] }).vendorIds = [vendorId];
    }
    next();
  });
  app.use("/circles", circlesRouter);
  app.use("/games", gamesRouter);
  app.use("/bookings", bookingsRouter);
  app.use("/vendor", vendorOperationsRouter);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Failed to bind test server");
  baseUrl = `http://127.0.0.1:${address.port}`;

  for (const id of [organiserId, requesterId, hostId, joinerId]) await db.prepare(`INSERT INTO residents (id, email, name) VALUES (?, ?, ?)`).run(id, `${id}@example.test`, id);
  await db.prepare(`INSERT INTO circles (id, name, activity_label, area, county, about, created_by_resident_id, join_mode) VALUES (?, 'P5 Circle', 'Running', 'Area', 'Dublin', '', ?, 'approval')`).run(circleId, organiserId);
  await db.prepare(`INSERT INTO circle_members (circle_id, resident_id, role) VALUES (?, ?, 'organiser')`).run(circleId, organiserId);

  await db.prepare(`INSERT INTO users (id, email, password_hash, role, status, name) VALUES (?, ?, 'x', 'vendor', 'approved', 'P5 Vendor')`).run(vendorId, `${vendorId}@example.test`);
  await db
    .prepare(`INSERT INTO centres (id, name, area, county, rating, reviews, capacity, from_price, managed_by, ph, image_url, blurb, vendor_id) VALUES (?, 'P5 Centre', 'Area', 'Dublin', 0, 0, 10, 1000, 'Mgr', '', '', '', ?)`)
    .run(centreId, vendorId);
  await db.prepare(`INSERT INTO rooms (id, centre_id, name, cap, rate, \`desc\`, sort_order) VALUES (?, ?, 'Hall', 10, 20, '', 0)`).run(roomId, centreId);
  await db
    .prepare(
      `INSERT INTO bookings (ref, client_id, resident_id, centre_id, room_id, date, time, duration, event_type, guests, name, email, phone, notes, total_cents, payment_status)
       VALUES (?, ?, ?, ?, ?, ?, '18:00', 2, 'Game', 4, 'Host', 'host@example.test', '', '', 4000, 'paid')`
    )
    .run(bookingRef, hostClient, hostId, centreId, roomId, DATE);
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  const games = ((await db.prepare(`SELECT id FROM games WHERE host_resident_id = ?`).all(hostId)) as { id: string }[]).map((g) => g.id);
  for (const g of games) {
    await db.prepare(`DELETE FROM game_participants WHERE game_id = ?`).run(g);
    await db.prepare(`DELETE FROM notifications WHERE listing_id = ?`).run(g);
  }
  await db.prepare(`DELETE FROM games WHERE host_resident_id = ?`).run(hostId);
  await db.prepare(`DELETE FROM notifications WHERE listing_id IN (?, ?)`).run(circleId, centreId);
  await db.prepare(`DELETE FROM audit_log WHERE object_id = ?`).run(bookingRef);
  await db.prepare(`DELETE FROM bookings WHERE centre_id = ?`).run(centreId);
  await db.prepare(`DELETE FROM rooms WHERE centre_id = ?`).run(centreId);
  await db.prepare(`DELETE FROM centres WHERE id = ?`).run(centreId);
  await db.prepare(`DELETE FROM users WHERE id = ?`).run(vendorId);
  await db.prepare(`DELETE FROM circle_invites WHERE circle_id = ?`).run(circleId);
  await db.prepare(`DELETE FROM circle_members WHERE circle_id = ?`).run(circleId);
  await db.prepare(`DELETE FROM circles WHERE id = ?`).run(circleId);
  await db.prepare(`DELETE FROM residents WHERE id IN (?, ?, ?, ?)`).run(organiserId, requesterId, hostId, joinerId);
});

describe("B10 — approval Circle requests", () => {
  it("lets the organiser ask up to three questions, shown to would-be members", async () => {
    const base = { name: "P5 Circle", activityLabel: "Running", joinMode: "approval" };
    expect((await call("PUT", `/circles/${circleId}`, { ...base, joinQuestions: ["a", "b", "c", "d"] }, organiserId)).status).toBe(400);
    expect((await call("PUT", `/circles/${circleId}`, { ...base, joinQuestions: ["How often do you run?", "Any injuries?"] }, organiserId)).status).toBe(200);
    // A later edit that doesn't send questions leaves them alone.
    expect((await call("PUT", `/circles/${circleId}`, base, organiserId)).status).toBe(200);
    const seen = await (await call("GET", `/circles/${circleId}`, undefined, requesterId)).json();
    expect(seen.joinQuestions).toEqual(["How often do you run?", "Any injuries?"]);
  });

  it("carries the requester's note and answers to the organiser, paired with the questions", async () => {
    expect((await call("POST", `/circles/${circleId}/join`, { note: "New to the area", answers: ["Twice a week", ""] }, requesterId)).status).toBe(202);
    const [req] = await (await call("GET", `/circles/${circleId}/join-requests`, undefined, organiserId)).json();
    expect(req).toMatchObject({ residentId: requesterId, note: "New to the area", answers: [{ question: "How often do you run?", answer: "Twice a week" }] });

    // Two approvals at once: exactly one wins.
    const [a, b] = await Promise.all([
      call("POST", `/circles/${circleId}/join-requests/${req.id}/respond`, { accept: true }, organiserId),
      call("POST", `/circles/${circleId}/join-requests/${req.id}/respond`, { accept: true }, organiserId),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const { n } = (await db.prepare(`SELECT COUNT(*) as n FROM circle_members WHERE circle_id = ? AND resident_id = ?`).get(circleId, requesterId)) as { n: number };
    expect(Number(n)).toBe(1);
  });
});

describe("B11 + E1 — activities held on a venue booking", () => {
  const game = { activityLabel: "P5 Five-a-side", date: DATE, time: "18:00", capacity: 8, centreId };
  let gameId = "";

  it("refuses a venue without the host's own matching booking", async () => {
    const none = await call("POST", "/games", game, hostId);
    expect(none.status).toBe(400);
    expect(await none.json()).toMatchObject({ needsVenueBooking: true });
    expect((await call("POST", "/games", { ...game, bookingRef }, joinerId)).status).toBe(400); // someone else's booking
    expect((await call("POST", "/games", { ...game, bookingRef, date: "2099-08-02" }, hostId)).status).toBe(400);
    expect((await call("POST", "/games", { ...game, bookingRef, time: "20:00" }, hostId)).status).toBe(400); // outside 18:00–20:00
    expect((await call("POST", "/games", { ...game, bookingRef, capacity: 20 }, hostId)).status).toBe(400); // room holds 10
    // An address instead of a venue needs no booking.
    expect((await call("POST", "/games", { activityLabel: "P5 Park run", date: DATE, time: "09:00", capacity: 8, locationText: "Phoenix Park" }, hostId)).status).toBe(201);
  });

  it("links the activity to the booking when it matches", async () => {
    const res = await call("POST", "/games", { ...game, bookingRef }, hostId);
    expect(res.status).toBe(201);
    gameId = (await res.json()).id;
    const row = (await db.prepare(`SELECT booking_ref FROM games WHERE id = ?`).get(gameId)) as { booking_ref: string };
    expect(row.booking_ref).toBe(bookingRef);
    await db.prepare(`INSERT INTO game_participants (game_id, resident_id) VALUES (?, ?)`).run(gameId, joinerId);
  });

  it("won't let the guest cancel or move the booking out from under the activity", async () => {
    const cancel = await call("POST", `/bookings/${bookingRef}/cancel`, {}, undefined, { "X-Client-Id": hostClient });
    expect(cancel.status).toBe(409);
    expect(await cancel.json()).toMatchObject({ linkedGameId: gameId });
    expect((await call("POST", `/bookings/${bookingRef}/reschedule`, { date: "2099-08-03", time: "18:00" }, undefined, { "X-Client-Id": hostClient })).status).toBe(409);
  });

  it("cancels the activity, and tells its participants, when the venue cancels the booking", async () => {
    expect((await call("POST", `/vendor/bookings/${bookingRef}/cancel`, {}, undefined, { "X-Test-Vendor": "1" })).status).toBe(200);
    expect(((await db.prepare(`SELECT status FROM games WHERE id = ?`).get(gameId)) as { status: string }).status).toBe("cancelled");
    const note = (await db.prepare(`SELECT body FROM notifications WHERE resident_id = ? AND listing_id = ?`).get(joinerId, gameId)) as { body: string } | undefined;
    expect(note?.body).toContain("The venue has cancelled the booking");
  });
});
