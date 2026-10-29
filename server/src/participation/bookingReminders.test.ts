import crypto from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, setSetting } from "../db/index.js";
import { irelandTodayIso } from "../irelandTime.js";
import { sweepBookingReminders } from "./bookingReminders.js";
import { cleanQuestionSet, questionsVersion, replaceQuestions } from "./questions.js";

// Phase K (docs/participation-expansion/20) — day-before reminders: off by
// default, once per order and day, the resident's "Booking reminders" setting,
// cancelled bookings skipped, and a note when answers are still missing.

const run = crypto.randomUUID().slice(0, 8);
const id = (k: string) => `t-${k}-br-${run}`;
const vendor = id("vendor");
const resA = id("resA");
const resOff = id("resOff");
const centreId = id("centre");
const expId = id("exp");
const sessId = id("sess");
const hallRef = `HB-BR-${run}`;
const expRef = `EX-BR-${run}`;
const offRef = `HB-BRO-${run}`;
const cancelledRef = `HB-BRX-${run}`;
const today = irelandTodayIso();
const tomorrow = new Date(Date.parse(`${today}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
const mine = () => db.prepare(`SELECT resident_id AS r, ref, title, body FROM notifications WHERE kind = 'reminder' AND resident_id IN (?, ?) ORDER BY ref`).all(resA, resOff) as Promise<{ r: string; ref: string; title: string; body: string }[]>;

beforeAll(async () => {
  await db.prepare(`INSERT INTO users (id, email, password_hash, role, status, name) VALUES (?, ?, 'x', 'vendor', 'approved', 'BR')`).run(vendor, `${vendor}@example.test`);
  await db.prepare(`INSERT INTO residents (id, email, name) VALUES (?, ?, 'BR A'), (?, ?, 'BR Off')`).run(resA, `${resA}@example.test`, resOff, `${resOff}@example.test`);
  await db.prepare(`UPDATE residents SET notification_prefs = '{"bookingReminders":false}' WHERE id = ?`).run(resOff);
  await db.prepare(`INSERT INTO centres (id, name, area, county, rating, reviews, capacity, from_price, managed_by, ph, image_url, blurb, vendor_id, status) VALUES (?, 'BR Hall', 'Rathmines', 'Dublin', 0, 0, 20, 1000, 'Mgr', '', '', '', ?, 'approved')`).run(centreId, vendor);
  for (const [ref, res, status] of [[hallRef, resA, "confirmed"], [offRef, resOff, "confirmed"], [cancelledRef, resA, "cancelled"]]) {
    await db.prepare(`INSERT INTO bookings (ref, client_id, resident_id, centre_id, room_id, date, time, duration, event_type, guests, name, email, phone, notes, total_cents, payment_status, status) VALUES (?, 'c', ?, ?, 'r1', ?, '18:00', 1, 'Party', 4, 'BR', 'br@example.test', '0', '', 0, 'paid', ?)`).run(ref, res, centreId, tomorrow, status);
  }
  await db.prepare(`INSERT INTO experiences (id, vendor_id, kind, title, blurb, description, fitness_requirements, itinerary, equipment_provided, equipment_required, transport_info, safety_info, weather_policy, eligibility, cancellation_terms, status, capacity, price_cents, payment_method, meeting_point) VALUES (?, ?, 'event', 'BR Festival', 'b', 'd', '', '', '', '', '', '', '', '', '', 'approved', 20, 0, 'cash', 'Main gate')`).run(expId, vendor);
  await db.prepare(`INSERT INTO experience_sessions (id, experience_id, date, time) VALUES (?, ?, ?, '10:00')`).run(sessId, expId, tomorrow);
  await db.prepare(`INSERT INTO experience_bookings (ref, experience_id, session_id, client_id, resident_id, participant_name, email, phone, party_size, total_cents, payment_status) VALUES (?, ?, ?, 'c', ?, 'BR A', 'br@example.test', '', 1, 0, 'paid')`).run(expRef, expId, sessId, resA);
  // The festival asks a required question nobody has answered yet.
  await setSetting("participation.attendees", "true");
  const set = cleanQuestionSet([{ scope: "booking", inputType: "text", label: "Shirt size", purpose: "Shirts", required: true }], false);
  await replaceQuestions(expId, set, await questionsVersion(expId), vendor);
});

afterAll(async () => {
  await setSetting("participation.reminders", "false");
  await setSetting("participation.attendees", "false");
  await db.prepare(`DELETE FROM notifications WHERE resident_id IN (?, ?)`).run(resA, resOff);
  await db.prepare(`DELETE FROM registration_questions WHERE listing_id = ?`).run(expId);
  await db.prepare(`DELETE FROM experience_bookings WHERE ref = ?`).run(expRef);
  await db.prepare(`DELETE FROM experience_sessions WHERE id = ?`).run(sessId);
  await db.prepare(`DELETE FROM experiences WHERE id = ?`).run(expId);
  await db.prepare(`DELETE FROM bookings WHERE centre_id = ?`).run(centreId);
  await db.prepare(`DELETE FROM centres WHERE id = ?`).run(centreId);
  await db.prepare(`DELETE FROM residents WHERE id IN (?, ?)`).run(resA, resOff);
  await db.prepare(`DELETE FROM users WHERE id = ?`).run(vendor);
});

describe("Phase K — booking reminders", () => {
  it("does nothing while the switch is off (the default)", async () => {
    await setSetting("participation.reminders", "false");
    expect(await sweepBookingReminders(today)).toBe(0);
    expect(await mine()).toEqual([]);
  });

  it("reminds once, honours the setting, skips cancelled bookings and flags missing answers", async () => {
    await setSetting("participation.reminders", "true");
    await sweepBookingReminders(today);
    const sent = await mine();
    expect(sent.map((n) => [n.r, n.ref])).toEqual([[resA, `booking/${hallRef}`], [resA, `experience/${expRef}`]]);
    const hall = sent.find((n) => n.ref === `booking/${hallRef}`)!;
    expect(hall.body).toContain("Rathmines, Dublin");
    expect(hall.body).not.toMatch(/waiting/);
    const fest = sent.find((n) => n.ref === `experience/${expRef}`)!;
    expect(fest.title).toBe("Reminder: BR Festival");
    expect(fest.body).toContain("Main gate");
    expect(fest.body).toMatch(/still waiting for some of your answers/);
    // A second sweep the same day sends nothing new.
    await sweepBookingReminders(today);
    expect((await mine()).length).toBe(2);
  });
});
