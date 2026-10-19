import crypto from "node:crypto";
import http, { type Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../db/index.js";
import { irelandTodayIso } from "../irelandTime.js";
import { gamesRouter } from "./games.js";

// OG-12 — a host moves a venue-based activity and its venue booking
// together: both move or neither does.

let server: Server;
let baseUrl: string;
const t = crypto.randomUUID().slice(0, 8);
const host = `test-move-host-${t}`;
const other = `test-move-other-${t}`;
const vendorId = `test-move-vendor-${t}`;
const centreId = `test-move-centre-${t}`;
const roomId = `room-${t}`;
const gameId = `test-move-game-${t}`;
const bookingRef = `HBMV-${t}`;
const date = new Date(Date.parse(`${irelandTodayIso()}T12:00:00Z`) + 20 * 86_400_000).toISOString().slice(0, 10);

const move = (resident: string, body: unknown) =>
  fetch(`${baseUrl}/games/${gameId}/move`, { method: "POST", headers: { "Content-Type": "application/json", "X-Test-Resident-Id": resident }, body: JSON.stringify(body) });
const state = async () => ({
  game: (await db.prepare(`SELECT date, time FROM games WHERE id = ?`).get(gameId)) as { date: string; time: string },
  booking: (await db.prepare(`SELECT date, time FROM bookings WHERE ref = ?`).get(bookingRef)) as { date: string; time: string },
});

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const id = req.header("X-Test-Resident-Id");
    if (id) (req as any).resident = { id, name: id, email: `${id}@example.test` };
    next();
  });
  app.use("/games", gamesRouter);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("no port");
  baseUrl = `http://127.0.0.1:${address.port}`;

  for (const id of [host, other]) await db.prepare(`INSERT INTO residents (id, email, name) VALUES (?, ?, ?)`).run(id, `${id}@example.test`, id);
  await db.prepare(`INSERT INTO users (id, email, password_hash, role, status, name) VALUES (?, ?, 'x', 'vendor', 'approved', 'Move Vendor')`).run(vendorId, `${vendorId}@example.test`);
  await db
    .prepare(`INSERT INTO centres (id, name, area, county, rating, reviews, capacity, from_price, managed_by, ph, image_url, blurb, vendor_id, status, opens_at, closes_at) VALUES (?, 'Move Centre', 'Area', 'Dublin', 0, 0, 20, 1000, 'Mgr', '', '', '', ?, 'approved', '09:00', '21:00')`)
    .run(centreId, vendorId);
  await db.prepare(`INSERT INTO rooms (id, centre_id, name, cap, rate, \`desc\`, sort_order) VALUES (?, ?, 'Hall', 20, 50, '', 0)`).run(roomId, centreId);
  await db
    .prepare(
      `INSERT INTO bookings (ref, client_id, resident_id, centre_id, room_id, date, time, duration, event_type, guests, name, email, phone, notes, total_cents, status, payment_status)
       VALUES (?, 'mv', ?, ?, ?, ?, '10:00', 2, 'Activity', 8, 'Host', 'host@example.test', '', '', 0, 'confirmed', 'paid')`
    )
    .run(bookingRef, host, centreId, roomId, date);
  await db
    .prepare(`INSERT INTO games (id, host_resident_id, activity_label, centre_id, date, time, capacity, status, booking_ref) VALUES (?, ?, 'Move Kickabout', ?, ?, '10:00', 8, 'open', ?)`)
    .run(gameId, host, centreId, date, bookingRef);
  // Another booking occupies 14:00–15:00 in the same room.
  await db
    .prepare(
      `INSERT INTO bookings (ref, client_id, centre_id, room_id, date, time, duration, event_type, guests, name, email, phone, notes, total_cents, status, payment_status)
       VALUES (?, 'mv2', ?, ?, ?, '14:00', 1, 'M', 2, 'Other', 'o@example.test', '', '', 0, 'confirmed', 'paid')`
    )
    .run(`HBMV2-${t}`, centreId, roomId, date);
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await db.prepare(`DELETE FROM games WHERE id = ?`).run(gameId);
  await db.prepare(`DELETE FROM bookings WHERE centre_id = ?`).run(centreId);
  await db.prepare(`DELETE FROM rooms WHERE centre_id = ?`).run(centreId);
  await db.prepare(`DELETE FROM centres WHERE id = ?`).run(centreId);
  await db.prepare(`DELETE FROM users WHERE id = ?`).run(vendorId);
  await db.prepare(`DELETE FROM residents WHERE id IN (?, ?)`).run(host, other);
});

describe("moving an activity with its venue booking", () => {
  it("only the host can move it", async () => {
    expect((await move(other, { date, time: "16:00" })).status).toBe(403);
  });

  it("refuses a taken slot and changes nothing", async () => {
    const r = await move(host, { date, time: "13:00" }); // 13:00–15:00 overlaps 14:00
    expect(r.status).toBe(409);
    expect(await state()).toEqual({ game: { date, time: "10:00" }, booking: { date, time: "10:00" } });
  });

  it("moves both together", async () => {
    const r = await move(host, { date, time: "16:00" });
    expect(r.status).toBe(200);
    expect(await state()).toEqual({ game: { date, time: "16:00" }, booking: { date, time: "16:00" } });
  });
});

describe("host reservations and activity money (OG-16 / OG-28)", () => {
  const get = (path: string, resident: string) => fetch(`${baseUrl}/games${path}`, { headers: { "X-Test-Resident-Id": resident } });

  it("lists the host's own venue bookings with the activity held on each", async () => {
    const rows = (await (await get("/host/reservations", host)).json()) as { ref: string; gameId: string | null; activityLabel: string | null }[];
    const mine = rows.find((r) => r.ref === bookingRef);
    expect(mine).toMatchObject({ gameId, activityLabel: "Move Kickabout" });
    expect(((await (await get("/host/reservations", other)).json()) as { ref: string }[]).some((r) => r.ref === bookingRef)).toBe(false);
  });

  it("shows recorded amounts to the host only, without netting them", async () => {
    expect((await get(`/${gameId}/money`, other)).status).toBe(403);
    const money = await (await get(`/${gameId}/money`, host)).json();
    expect(money).toMatchObject({ ticketPayments: { count: 0, minor: 0 }, refundedMinor: 0, venueBooking: { ref: bookingRef } });
    expect(money).not.toHaveProperty("net");
  });
});
