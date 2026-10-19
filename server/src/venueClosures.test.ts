import crypto from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "./db/index.js";
import { irelandTodayIso } from "./irelandTime.js";
import { affectedBookings, closureInputError, createClosure, type ClosureInput } from "./venueClosures.js";
import { ConflictError } from "./util.js";

// OG-04 — closures never silently close a booked slot.

const tag = crypto.randomUUID().slice(0, 8);
const vendorId = `test-vendor-closure-${tag}`;
const centreId = `test-centre-closure-${tag}`;
const hallId = `hall-${tag}`;
const roomId = `room-${tag}`;
const date = new Date(Date.parse(`${irelandTodayIso()}T12:00:00Z`) + 20 * 86_400_000).toISOString().slice(0, 10);
const actor = `test-actor-closure-${tag}`;

async function booking(room: string, time: string, duration = 1): Promise<string> {
  const ref = `HBCL-${crypto.randomUUID().slice(0, 8)}`;
  await db
    .prepare(
      `INSERT INTO bookings (ref, client_id, centre_id, room_id, date, time, duration, event_type, guests, name, email, phone, notes, total_cents, status, payment_status)
       VALUES (?, 'closure-test', ?, ?, ?, ?, ?, 'Meeting', 4, 'Closure Guest', 'closure_guest@example.test', '', '', 0, 'confirmed', 'paid')`
    )
    .run(ref, centreId, room, date, time, duration);
  return ref;
}

const base = (over: Partial<ClosureInput> = {}): ClosureInput => ({ centreId, roomId: hallId, date, startTime: null, endTime: null, reason: "Maintenance", ...over });

beforeAll(async () => {
  await db.prepare(`INSERT INTO users (id, email, password_hash, role, status, name) VALUES (?, ?, 'x', 'vendor', 'approved', 'Closure Vendor')`).run(vendorId, `${vendorId}@example.test`);
  await db
    .prepare(`INSERT INTO centres (id, name, area, county, rating, reviews, capacity, from_price, managed_by, ph, image_url, blurb, vendor_id, status) VALUES (?, 'Closure Centre', 'Area', 'Dublin', 0, 0, 20, 1000, 'Mgr', '', '', '', ?, 'approved')`)
    .run(centreId, vendorId);
  await db.prepare(`INSERT INTO rooms (id, centre_id, name, cap, rate, \`desc\`, sort_order) VALUES (?, ?, 'Hall', 20, 50, '', 0), (?, ?, 'Room', 10, 30, '', 1)`).run(hallId, centreId, roomId, centreId);
});

afterAll(async () => {
  await db.prepare(`DELETE FROM bookings WHERE centre_id = ?`).run(centreId);
  await db.prepare(`DELETE FROM room_blocks WHERE centre_id = ?`).run(centreId);
  await db.prepare(`DELETE FROM rooms WHERE centre_id = ?`).run(centreId);
  await db.prepare(`DELETE FROM centres WHERE id = ?`).run(centreId);
  await db.prepare(`DELETE FROM users WHERE id = ?`).run(vendorId);
});

describe("closure input", () => {
  it("accepts a whole day or an on-the-hour range, and refuses anything else", () => {
    expect(closureInputError(base())).toBeNull();
    expect(closureInputError(base({ startTime: "14:00", endTime: "16:00" }))).toBeNull();
    expect(closureInputError(base({ startTime: "14:00", endTime: null }))).toMatch(/both a start and an end/);
    expect(closureInputError(base({ startTime: "16:00", endTime: "14:00" }))).toMatch(/after the start/);
    expect(closureInputError(base({ startTime: "14:30", endTime: "16:00" }))).toMatch(/on the hour/);
    expect(closureInputError(base({ date: "2001-01-01" }))).not.toBeNull();
  });
});

describe("affected bookings", () => {
  it("lists only live bookings that overlap the closed room and hours", async () => {
    const morning = await booking(hallId, "10:00", 2); // 10–12
    const afternoon = await booking(hallId, "15:00", 1); // 15–16
    const otherRoom = await booking(roomId, "10:00", 1);
    const refs = (i: ClosureInput) => affectedBookings(db, i).then((rows) => rows.map((r) => r.ref).sort());
    expect(await refs(base())).toEqual([morning, afternoon].sort());
    expect(await refs(base({ startTime: "11:00", endTime: "12:00" }))).toEqual([morning]);
    expect(await refs(base({ startTime: "12:00", endTime: "15:00" }))).toEqual([]);
    // A centre-wide closure covers every room.
    expect(await refs(base({ roomId: null }))).toEqual([morning, afternoon, otherRoom].sort());
    await db.prepare(`DELETE FROM bookings WHERE ref IN (?, ?, ?)`).run(morning, afternoon, otherRoom);
  });
});

describe("creating a closure", () => {
  it("refuses when the bookings differ from what was reviewed, or no choice was made", async () => {
    const ref = await booking(hallId, "10:00");
    await expect(createClosure(base(), { actorUserId: actor, expectedRefs: [], resolution: null })).rejects.toBeInstanceOf(ConflictError);
    await expect(createClosure(base(), { actorUserId: actor, expectedRefs: [ref], resolution: null })).rejects.toThrow(/Choose what happens/);
    const blocks = await db.prepare(`SELECT COUNT(*) as n FROM room_blocks WHERE centre_id = ?`).get(centreId);
    expect(Number((blocks as { n: number }).n)).toBe(0);
    await db.prepare(`DELETE FROM bookings WHERE ref = ?`).run(ref);
  });

  it("stores an hour range as one closure of hourly rows and can keep the bookings", async () => {
    const ref = await booking(hallId, "14:00");
    const result = await createClosure(base({ startTime: "14:00", endTime: "16:00" }), { actorUserId: actor, expectedRefs: [ref], resolution: "keep" });
    const rows = (await db.prepare(`SELECT time, group_id as groupId FROM room_blocks WHERE centre_id = ? ORDER BY time`).all(centreId)) as { time: string; groupId: string }[];
    expect(rows.map((r) => r.time)).toEqual(["14:00", "15:00"]);
    expect(new Set(rows.map((r) => r.groupId))).toEqual(new Set([result.groupId]));
    const kept = (await db.prepare(`SELECT status FROM bookings WHERE ref = ?`).get(ref)) as { status: string };
    expect(kept.status).not.toBe("cancelled");
    expect(result.cancelled).toEqual([]);
    await db.prepare(`DELETE FROM room_blocks WHERE centre_id = ?`).run(centreId);
    await db.prepare(`DELETE FROM bookings WHERE ref = ?`).run(ref);
  });

  it("cancels the covered bookings through the provider-cancel path when asked", async () => {
    const ref = await booking(hallId, "18:00");
    const result = await createClosure(base(), { actorUserId: actor, expectedRefs: [ref], resolution: "cancel_refund" });
    expect(result.cancelled.map((c) => c.ref)).toEqual([ref]);
    const row = (await db.prepare(`SELECT status FROM bookings WHERE ref = ?`).get(ref)) as { status: string };
    expect(row.status).toBe("cancelled");
    const audit = await db.prepare(`SELECT reason FROM audit_log WHERE action = 'booking.cancelled_by_closure' AND object_id = ?`).get(ref);
    expect(audit).toMatchObject({ reason: "Maintenance" });
    // A free day closure with nothing booked needs no choice.
    await db.prepare(`DELETE FROM room_blocks WHERE centre_id = ?`).run(centreId);
    const empty = await createClosure(base({ roomId: roomId }), { actorUserId: actor, expectedRefs: [], resolution: null });
    expect(empty.affected).toEqual([]);
  });
});
