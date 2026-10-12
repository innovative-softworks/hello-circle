import crypto from "node:crypto";
import http, { type Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, getSetting, setSetting } from "../db/index.js";
import { irelandTodayIso, irelandWallTimeToUtc } from "../irelandTime.js";
import { computePricing } from "../pricing.js";
import { availabilityRouter } from "./availability.js";
import { bookingsRouter, priceBookingRequest } from "./bookings.js";
import { makeItHappenRouter } from "./makeItHappen.js";
import { registrationsRouter } from "./registrations.js";

// Booking audit 2026-10-11, Phase 0 (docs/booking-ux-implementation-plan-2026-10-11.md §4):
//   B1 venue booking quote = checkout price        B2 registration quote
//   B3 manage fields on My Life lists              B4 trial only where offered, once per participant
//   B5 availability ignores cancelled/stale rows   B6 Open Booking / Make It Happen paused by default

let server: Server;
let baseUrl: string;

const tag = crypto.randomUUID();
const vendorId = `test-vendor-p0-${tag}`;
const centreId = `test-centre-p0-${tag}`;
const pendingCentreId = `test-centre-p0-pending-${tag}`;
const cashRoomId = `test-room-p0-cash-${tag}`;
const onlineRoomId = `test-room-p0-online-${tag}`;
const paidClubId = `test-club-p0-paid-${tag}`;
const trialClubId = `test-club-p0-trial-${tag}`;
const pendingClubId = `test-club-p0-pending-${tag}`;
const clubIds = [paidClubId, trialClubId, pendingClubId];
const centreIds = [centreId, pendingCentreId];

/** An Ireland calendar date `days` ahead — outside the 48h default cut-off, inside the 90-day window. */
function futureDate(days: number): string {
  return new Date(Date.parse(`${irelandTodayIso()}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}
const bookingDate = futureDate(10);

function post(path: string, body: unknown, clientId = `test-client-p0-${crypto.randomUUID()}`) {
  return fetch(`${baseUrl}${path}`, { method: "POST", headers: { "Content-Type": "application/json", "X-Client-Id": clientId }, body: JSON.stringify(body) });
}

function bookingBody(overrides: Record<string, unknown> = {}) {
  return { centreId, roomId: cashRoomId, date: bookingDate, time: "10:00", duration: 2, guests: 5, eventType: "Party", name: "Test Booker", email: `p0-${tag}@example.test`, phone: "0850000000", ...overrides };
}

function registrationBody(clubId: string, overrides: Record<string, unknown> = {}) {
  return {
    clubId, team: "U10", childFirst: "Test", childLast: `Child${tag.slice(0, 6)}`, dob: "2016-03-04",
    gFirst: "Test", gLast: "Guardian", email: `p0-guardian-${tag}@example.test`, phone: "0850000000", address: "",
    ecName: "Contact", ecPhone: "0850000001", ecRel: "Parent", consent: true, trial: false, ...overrides,
  };
}

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/bookings", bookingsRouter);
  app.use("/registrations", registrationsRouter);
  app.use("/availability", availabilityRouter);
  app.use("/make-it-happen", makeItHappenRouter);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Failed to bind test server");
  baseUrl = `http://127.0.0.1:${address.port}`;

  await db.prepare(`INSERT INTO users (id, email, password_hash, role, status, name) VALUES (?, ?, 'x', 'vendor', 'approved', 'P0 Vendor')`).run(vendorId, `${vendorId}@example.test`);
  for (const [id, status] of [[centreId, "approved"], [pendingCentreId, "pending"]]) {
    await db
      .prepare(`INSERT INTO centres (id, name, area, county, rating, reviews, capacity, from_price, managed_by, ph, image_url, blurb, vendor_id, status) VALUES (?, 'P0 Centre', 'Area', 'Dublin', 0, 0, 20, 1000, 'Mgr', '', '', '', ?, ?)`)
      .run(id, vendorId, status);
  }
  await db.prepare(`INSERT INTO rooms (id, centre_id, name, cap, rate, \`desc\`, sort_order, payment_method) VALUES (?, ?, 'Cash Hall', 20, 50, '', 0, 'cash')`).run(cashRoomId, centreId);
  await db.prepare(`INSERT INTO rooms (id, centre_id, name, cap, rate, \`desc\`, sort_order, payment_method) VALUES (?, ?, 'Online Hall', 20, 40, '', 1, 'online')`).run(onlineRoomId, centreId);
  await db.prepare(`INSERT INTO rooms (id, centre_id, name, cap, rate, \`desc\`, sort_order, payment_method) VALUES (?, ?, 'Pending Hall', 20, 50, '', 0, 'cash')`).run(cashRoomId, pendingCentreId);
  // price 10 (euro) on both; only trialClubId offers a free trial. Cash, so a
  // paid registration confirms without Stripe.
  for (const [id, trial, status] of [[paidClubId, 0, "approved"], [trialClubId, 1, "approved"], [pendingClubId, 1, "pending"]] as const) {
    await db
      .prepare(`INSERT INTO clubs (id, name, sport, area, county, ages, price, unit, trial, ph, image_url, blurb, vendor_id, status, payment_method) VALUES (?, 'P0 Club', 'Testball', 'Area', 'Dublin', '5-12', 10, 'year', ?, '', '', '', ?, ?, 'cash')`)
      .run(id, trial, vendorId, status);
  }
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  for (const id of [...centreIds, ...clubIds]) await db.prepare(`DELETE FROM notifications WHERE listing_id = ?`).run(id);
  for (const id of centreIds) {
    await db.prepare(`DELETE FROM bookings WHERE centre_id = ?`).run(id);
    await db.prepare(`DELETE FROM rooms WHERE centre_id = ?`).run(id);
    await db.prepare(`DELETE FROM centres WHERE id = ?`).run(id);
  }
  for (const id of clubIds) {
    await db.prepare(`DELETE FROM registrations WHERE club_id = ?`).run(id);
    await db.prepare(`DELETE FROM clubs WHERE id = ?`).run(id);
  }
  await db.prepare(`DELETE FROM users WHERE id = ?`).run(vendorId);
});

describe("B1 — venue booking quote", () => {
  it("prices exactly what checkout charges (cash room), with the cut-off for that slot", async () => {
    const quoteRes = await post("/bookings/quote", bookingBody({ time: "17:00" }));
    expect(quoteRes.status).toBe(200);
    const quote = await quoteRes.json();
    expect(quote).toMatchObject({ ...computePricing(100 * 100, 0, 0, null), payAtVenue: true, currency: "EUR", cancellationHours: 48 });
    expect(quote.cancelDeadline).toBe(new Date(irelandWallTimeToUtc(bookingDate, 17).getTime() - 48 * 3_600_000).toISOString());

    const checkout = await post("/bookings/checkout", bookingBody({ time: "17:00" }));
    expect(checkout.status).toBe(201);
    const { ref, totalEuro } = await checkout.json();
    expect(totalEuro * 100).toBe(quote.totalCents);
    const row = (await db.prepare(`SELECT total_cents as t FROM bookings WHERE ref = ?`).get(ref)) as { t: number };
    expect(row.t).toBe(quote.totalCents);
  });

  it("includes the refundable deposit for an online room", async () => {
    const quote = await (await post("/bookings/quote", bookingBody({ roomId: onlineRoomId }))).json();
    expect(quote).toMatchObject({ ...computePricing(80 * 100, 100 * 100, 0, null), payAtVenue: false });
  });

  it("refuses a venue that isn't approved, and an off-grid time, like checkout does", async () => {
    expect((await post("/bookings/quote", bookingBody({ centreId: pendingCentreId }))).status).toBe(404);
    expect((await post("/bookings/checkout", bookingBody({ centreId: pendingCentreId }))).status).toBe(404);
    expect((await post("/bookings/quote", bookingBody({ time: "10:30" }))).status).toBe(400);
  });
});

describe("B5 + B3 — availability and manage fields", () => {
  it("frees a cancelled booking's slot and ignores a stale pending hold", async () => {
    const clientId = `test-client-p0-avail-${tag}`;
    const created = await post("/bookings/checkout", bookingBody({ time: "10:00", duration: 1 }), clientId);
    expect(created.status).toBe(201);
    const { ref } = await created.json();

    // An abandoned online checkout from two hours ago (past the 30-minute hold).
    await db
      .prepare(
        `INSERT INTO bookings (ref, client_id, centre_id, room_id, date, time, duration, event_type, guests, name, email, phone, notes, total_cents, payment_status, created_at)
         VALUES (?, 'stale', ?, ?, ?, '14:00', 1, 'Party', 2, 'Stale', 'stale@example.test', '', '', 100, 'pending', NOW() - INTERVAL 2 HOUR)`
      )
      .run(`HB-STALE-${tag.slice(0, 8)}`, centreId, cashRoomId, bookingDate);

    const booked = async () =>
      ((await (await fetch(`${baseUrl}/availability?centreId=${centreId}&roomId=${cashRoomId}&date=${bookingDate}`)).json()) as { bookedTimes: string[] }).bookedTimes;
    let times = await booked();
    expect(times).toContain("10:00");
    expect(times).not.toContain("14:00");

    const mine = async () => (await (await fetch(`${baseUrl}/bookings`, { headers: { "X-Client-Id": clientId } })).json()) as Record<string, unknown>[];
    const before = (await mine()).find((b) => b.ref === ref)!;
    expect(before).toMatchObject({ canCancel: true, canReschedule: true, refundState: "none", paidOnline: false, paymentStatus: "paid" });
    expect(typeof before.cancelDeadline).toBe("string");

    expect((await post(`/bookings/${ref}/cancel`, {}, clientId)).status).toBe(200);
    times = await booked();
    expect(times).not.toContain("10:00");
    expect((await mine()).find((b) => b.ref === ref)).toMatchObject({ status: "cancelled", canCancel: false, canReschedule: false });

    // The cancel route and the list now share one rule — same wording as before.
    const again = await post(`/bookings/${ref}/cancel`, {}, clientId);
    expect(again.status).toBe(409);
    expect((await again.json()).error).toBe("This booking is already cancelled");
  });
});

describe("B4 + B2 — free trials", () => {
  it("refuses a trial at a club that doesn't offer one, and inserts nothing", async () => {
    const res = await post("/registrations/checkout", registrationBody(paidClubId, { trial: true }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("This club doesn't offer a free trial");
    expect((await post("/registrations/quote", { clubId: paidClubId, trial: true })).status).toBe(400);
    const { n } = (await db.prepare(`SELECT COUNT(*) as n FROM registrations WHERE club_id = ?`).get(paidClubId)) as { n: number };
    expect(Number(n)).toBe(0);
  });

  it("allows one trial per participant, across devices, even after cancelling", async () => {
    const first = await post("/registrations/checkout", registrationBody(trialClubId, { trial: true }), `test-client-p0-a-${tag}`);
    expect(first.status).toBe(201);
    const { ref, totalEuro } = await first.json();
    expect(totalEuro).toBe(0);

    // Another device, same guardian email and child.
    const second = await post("/registrations/checkout", registrationBody(trialClubId, { trial: true }), `test-client-p0-b-${tag}`);
    expect(second.status).toBe(409);
    expect(await second.json()).toMatchObject({ trialUsed: true });

    expect((await post(`/registrations/${ref}/cancel`, {}, `test-client-p0-a-${tag}`)).status).toBe(200);
    expect((await post("/registrations/checkout", registrationBody(trialClubId, { trial: true }), `test-client-p0-c-${tag}`)).status).toBe(409);

    // A sibling still gets their own trial.
    expect((await post("/registrations/checkout", registrationBody(trialClubId, { trial: true, childFirst: "Sibling" }), `test-client-p0-a-${tag}`)).status).toBe(201);
  });

  it("refuses a trial combined with a pass, and an unapproved club", async () => {
    expect((await post("/registrations/checkout", registrationBody(trialClubId, { trial: true, passId: 1, childFirst: "Passer" }))).status).toBe(400);
    expect((await post("/registrations/checkout", registrationBody(pendingClubId))).status).toBe(404);
    expect((await post("/registrations/quote", { clubId: pendingClubId })).status).toBe(404);
  });

  it("quotes a paid registration with the same pricing checkout uses, and lists manage fields", async () => {
    const quote = await (await post("/registrations/quote", { clubId: paidClubId })).json();
    expect(quote).toMatchObject({ ...computePricing(10 * 100, 0, 0, null), trial: false, payAtVenue: true });

    const clientId = `test-client-p0-reg-${tag}`;
    const res = await post("/registrations/checkout", registrationBody(paidClubId, { childFirst: "Payer" }), clientId);
    expect(res.status).toBe(201);
    expect((await res.json()).totalEuro * 100).toBe(quote.totalCents);
    const list = (await (await fetch(`${baseUrl}/registrations`, { headers: { "X-Client-Id": clientId } })).json()) as Record<string, unknown>[];
    expect(list[0]).toMatchObject({ canCancel: true, refundState: "none", paidOnline: false, paymentStatus: "paid" });
  });
});

describe("B6 — Open Booking paused by default", () => {
  it("refuses open spots and pauses Make It Happen until the platform switch is on", async () => {
    const input = { centreId, roomId: cashRoomId, date: bookingDate, time: "12:00", duration: 1, guests: 2, openSpots: 2 };
    expect(await priceBookingRequest(input)).toMatchObject({ ok: false, status: 403 });

    const search = await post("/make-it-happen/search", { activityLabel: "Football", date: bookingDate, time: "12:00", duration: 1, partySize: 4 });
    expect(search.status).toBe(503);
    expect(await search.json()).toMatchObject({ paused: true });

    const previous = await getSetting("commerce.open_booking", "false");
    try {
      await setSetting("commerce.open_booking", "true");
      expect(await priceBookingRequest(input)).toMatchObject({ ok: true });
    } finally {
      await setSetting("commerce.open_booking", previous);
    }
  });
});
