import crypto from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db, setSetting } from "../db/index.js";

// Pilot remediation (final-validation/14, DEF-03) — the reminder sweep reaches
// every due order, once. A fixed far-future day (the evening before Ireland's
// 2031 spring clock change) so no other test's data is due, with synthetic
// residents and halls only. Delivery goes through the real notification code;
// the hook below only lets a test fail a delivery or change data mid-run.

const hooks = vi.hoisted(() => ({
  before: null as null | ((ref: string) => Promise<void>),
  fail: new Set<string>(),
  reported: [] as string[],
}));
vi.mock("../notifications.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../notifications.js")>();
  return {
    ...real,
    notifyResidentWithOutcome: async (p: Parameters<typeof real.notifyResidentWithOutcome>[0]) => {
      if (hooks.before) await hooks.before(p.ref ?? "");
      if (hooks.fail.has(p.ref ?? "")) throw new Error("simulated delivery failure");
      return real.notifyResidentWithOutcome(p);
    },
  };
});
vi.mock("../errorReporting.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../errorReporting.js")>();
  return { ...real, reportException: (kind: string) => void hooks.reported.push(kind) };
});
const { sweepBookingRemindersDetailed } = await import("./bookingReminders.js");

const run = crypto.randomUUID().slice(0, 8);
const id = (k: string) => `t-${k}-brr-${run}`;
const TODAY = "2031-03-29";
const DAY = "2031-03-30"; // clocks go forward this morning in Ireland
const N = 450; // more than two pages of 200
const vendor = id("vendor");
const centre = id("centre");
const optedOut = id("resOptOut");
const residents = Array.from({ length: N }, (_, i) => id(`res${i}`));
const refs = Array.from({ length: N }, (_, i) => `HB-BRR-${run}-${String(i).padStart(4, "0")}`);
const expId = id("exp");
const sessMoved = id("sessMoved");
const sessIn = id("sessIn");
const movedRef = `EX-BRR-OUT-${run}`;
const inRef = `EX-BRR-IN-${run}`;

const countsByRef = async () =>
  new Map(
    ((await db.prepare(`SELECT ref, COUNT(*) AS n FROM notifications WHERE kind = 'reminder' AND ref LIKE ? GROUP BY ref`).all(`%BRR%${run}%`)) as { ref: string; n: number }[]).map((r) => [r.ref, Number(r.n)])
  );
const claimRow = (ref: string) => db.prepare(`SELECT status, attempts, sent_at AS sentAt, last_error AS err FROM booking_reminder_sends WHERE order_ref = ? AND remind_for = ?`).get(ref, DAY) as Promise<{ status: string; attempts: number; sentAt: unknown; err: string | null } | undefined>;

beforeAll(async () => {
  await db.prepare(`INSERT INTO users (id, email, password_hash, role, status, name) VALUES (?, ?, 'x', 'vendor', 'approved', 'BRR')`).run(vendor, `${vendor}@example.test`);
  await db.prepare(`INSERT INTO centres (id, name, area, county, rating, reviews, capacity, from_price, managed_by, ph, image_url, blurb, vendor_id, status) VALUES (?, 'BRR Hall', 'Rathmines', 'Dublin', 0, 0, 20, 1000, 'Mgr', '', '', '', ?, 'approved')`).run(centre, vendor);
  for (let i = 0; i < N; i++) {
    await db.prepare(`INSERT INTO residents (id, email, name) VALUES (?, ?, 'BRR')`).run(residents[i], `${residents[i]}@example.test`);
    // Every booking at the same date and time: the order key, not the time, pages through them.
    await db.prepare(`INSERT INTO bookings (ref, client_id, resident_id, centre_id, room_id, date, time, duration, event_type, guests, name, email, phone, notes, total_cents, payment_status, status) VALUES (?, 'c', ?, ?, 'r1', ?, '10:00', 1, 'Party', 2, 'BRR', 'brr@example.test', '0', '', 0, 'paid', 'confirmed')`).run(refs[i], residents[i], centre, DAY);
  }
  await db.prepare(`INSERT INTO residents (id, email, name, notification_prefs) VALUES (?, ?, 'BRR off', '{"bookingReminders":false}')`).run(optedOut, `${optedOut}@example.test`);
  await db.prepare(`INSERT INTO bookings (ref, client_id, resident_id, centre_id, room_id, date, time, duration, event_type, guests, name, email, phone, notes, total_cents, payment_status, status) VALUES (?, 'c', ?, ?, 'r1', ?, '11:00', 1, 'Party', 2, 'BRR', 'brr@example.test', '0', '', 0, 'paid', 'confirmed')`).run(`HB-BRR-OFF-${run}`, optedOut, centre, DAY);
  // An event with one session moved away from DAY and one moved onto it.
  await db.prepare(`INSERT INTO experiences (id, vendor_id, kind, title, blurb, description, fitness_requirements, itinerary, equipment_provided, equipment_required, transport_info, safety_info, weather_policy, eligibility, cancellation_terms, status, capacity, price_cents, payment_method, meeting_point) VALUES (?, ?, 'event', 'BRR Event', 'b', 'd', '', '', '', '', '', '', '', '', '', 'approved', 20, 0, 'cash', 'Gate')`).run(expId, vendor);
  await db.prepare(`INSERT INTO experience_sessions (id, experience_id, date, time) VALUES (?, ?, ?, '09:00'), (?, ?, ?, '09:00')`).run(sessMoved, expId, DAY, sessIn, expId, "2031-04-05");
  for (const [ref, sess] of [[movedRef, sessMoved], [inRef, sessIn]]) {
    await db.prepare(`INSERT INTO experience_bookings (ref, experience_id, session_id, client_id, resident_id, participant_name, email, phone, party_size, total_cents, payment_status) VALUES (?, ?, ?, 'c', ?, 'BRR', 'brr@example.test', '', 1, 0, 'paid')`).run(ref, expId, sess, residents[0]);
  }
  await setSetting("participation.reminders", "true");
});

afterAll(async () => {
  await setSetting("participation.reminders", "false");
  await db.prepare(`DELETE FROM notifications WHERE kind = 'reminder' AND ref LIKE ?`).run(`%BRR%${run}%`);
  await db.prepare(`DELETE FROM booking_reminder_sends WHERE order_ref LIKE ?`).run(`%BRR%${run}%`);
  await db.prepare(`DELETE FROM experience_bookings WHERE experience_id = ?`).run(expId);
  await db.prepare(`DELETE FROM experience_sessions WHERE experience_id = ?`).run(expId);
  await db.prepare(`DELETE FROM experiences WHERE id = ?`).run(expId);
  await db.prepare(`DELETE FROM bookings WHERE centre_id = ?`).run(centre);
  await db.prepare(`DELETE FROM centres WHERE id = ?`).run(centre);
  await db.prepare(`DELETE FROM residents WHERE id LIKE ?`).run(`t-%-brr-${run}`);
  await db.prepare(`DELETE FROM users WHERE id = ?`).run(vendor);
});

beforeEach(() => {
  hooks.before = null;
  hooks.fail.clear();
  hooks.reported.length = 0;
});

describe("Day-before reminders: every due order, exactly once", () => {
  it("does nothing while the switch is off", async () => {
    await setSetting("participation.reminders", "false");
    expect(await sweepBookingRemindersDetailed(TODAY)).toEqual({ sent: 0, skipped: 0, failed: 0, claimedElsewhere: 0 });
    await setSetting("participation.reminders", "true");
  });

  it("first run: a cancellation and a session move during the run are honoured; two deliveries fail and are reported", async () => {
    // Move one event session off DAY and another onto it before the run.
    await db.prepare(`UPDATE experience_sessions SET date = '2031-04-02' WHERE id = ?`).run(sessMoved);
    await db.prepare(`UPDATE experience_sessions SET date = ? WHERE id = ?`).run(DAY, sessIn);
    // Two hall deliveries fail. During the first delivery, two bookings are cancelled: refs[150]
    // is already in the page being sent (re-checked before sending), refs[420] is on a later page.
    hooks.fail.add(`booking/${refs[10]}`).add(`booking/${refs[300]}`);
    let cancelled = false;
    hooks.before = async () => {
      if (cancelled) return;
      cancelled = true;
      await db.prepare(`UPDATE bookings SET status = 'cancelled' WHERE ref IN (?, ?)`).run(refs[150], refs[420]);
    };
    const r = await sweepBookingRemindersDetailed(TODAY);
    // 450 halls + the opted-out one + the event moved in = 452 due. refs[420] is no longer due when
    // its page is read; refs[150] is claimed, re-checked and released (skipped); the opted-out one
    // is skipped; two fail: 452 - 1 - 2 - 2 = 447 sent.
    expect(r).toEqual({ sent: 447, skipped: 2, failed: 2, claimedElsewhere: 0 });
    const counts = await countsByRef();
    expect(counts.get(`booking/${refs[0]}`)).toBe(1);
    expect(counts.get(`booking/${refs[449]}`)).toBe(1); // past the second page
    expect(counts.has(`booking/${refs[420]}`)).toBe(false); // cancelled before its page was read
    expect(counts.has(`booking/${refs[150]}`)).toBe(false); // cancelled after its page was read, before delivery
    expect(counts.has(`booking/${refs[10]}`)).toBe(false);
    expect(counts.has(`booking/HB-BRR-OFF-${run}`)).toBe(false); // opted out
    expect(counts.get(`experience/${inRef}`)).toBe(1); // moved onto DAY
    expect(counts.has(`experience/${movedRef}`)).toBe(false); // moved off DAY
    expect(await claimRow(refs[10])).toMatchObject({ status: "failed", attempts: 1, sentAt: null, err: "simulated delivery failure" });
    expect(await claimRow(refs[0])).toMatchObject({ status: "sent", attempts: 1 });
    expect(await claimRow(`HB-BRR-OFF-${run}`)).toMatchObject({ status: "skipped_preference" });
    expect(await claimRow(refs[150])).toBeUndefined(); // claim released, nothing sent
    expect(await claimRow(refs[420])).toBeUndefined();
    expect(hooks.reported.filter((k) => k === "job.booking-reminders.delivery")).toHaveLength(2);
    const body = (await db.prepare(`SELECT body FROM notifications WHERE ref = ?`).get(`booking/${refs[0]}`)) as { body: string };
    expect(body.body).toContain(`Tomorrow (${DAY}) at 10:00`);
  });

  it("retry: only the failed deliveries are sent; nothing else twice", async () => {
    const r = await sweepBookingRemindersDetailed(TODAY);
    expect(r).toEqual({ sent: 2, skipped: 0, failed: 0, claimedElsewhere: 0 });
    expect(await claimRow(refs[10])).toMatchObject({ status: "sent", attempts: 2 });
    const counts = await countsByRef();
    expect([...counts.values()].every((n) => n === 1)).toBe(true);
    expect(counts.size).toBe(449); // 448 halls still booked + 1 event
  });

  it("a delivery that keeps failing stops after three attempts", async () => {
    const ref = `HB-BRR-X-${run}`;
    await db.prepare(`INSERT INTO bookings (ref, client_id, resident_id, centre_id, room_id, date, time, duration, event_type, guests, name, email, phone, notes, total_cents, payment_status, status) VALUES (?, 'c', ?, ?, 'r1', ?, '12:00', 1, 'Party', 2, 'BRR', 'brr@example.test', '0', '', 0, 'paid', 'confirmed')`).run(ref, residents[1], centre, DAY);
    hooks.fail.add(`booking/${ref}`);
    for (let i = 0; i < 4; i++) await sweepBookingRemindersDetailed(TODAY);
    expect(await claimRow(ref)).toMatchObject({ status: "failed", attempts: 3 });
    expect((await countsByRef()).has(`booking/${ref}`)).toBe(false);
  });

  it("overlapping runs and a restart: each order is sent by exactly one run", async () => {
    const extra = Array.from({ length: 60 }, (_, i) => `HB-BRR-P-${run}-${String(i).padStart(3, "0")}`);
    for (const [i, ref] of extra.entries()) {
      await db.prepare(`INSERT INTO bookings (ref, client_id, resident_id, centre_id, room_id, date, time, duration, event_type, guests, name, email, phone, notes, total_cents, payment_status, status) VALUES (?, 'c', ?, ?, 'r1', ?, '10:00', 1, 'Party', 2, 'BRR', 'brr@example.test', '0', '', 0, 'paid', 'confirmed')`).run(ref, residents[i + 2], centre, DAY);
    }
    // A run that crashed 20 minutes ago left one claim behind; a live run holds another.
    await db.prepare(`INSERT INTO booking_reminder_sends (source_type, order_ref, remind_for, resident_id, status, claimed_at) VALUES ('booking', ?, ?, ?, 'sending', DATE_SUB(NOW(), INTERVAL 20 MINUTE))`).run(extra[0], DAY, residents[2]);
    await db.prepare(`INSERT INTO booking_reminder_sends (source_type, order_ref, remind_for, resident_id, status) VALUES ('booking', ?, ?, ?, 'sending')`).run(extra[1], DAY, residents[3]);
    const [a, b, c] = await Promise.all([sweepBookingRemindersDetailed(TODAY), sweepBookingRemindersDetailed(TODAY), sweepBookingRemindersDetailed(TODAY)]);
    expect(a.sent + b.sent + c.sent).toBe(59); // all but the one a live run holds
    const counts = await countsByRef();
    for (const ref of extra.slice(2)) expect(counts.get(`booking/${ref}`)).toBe(1);
    expect(counts.get(`booking/${extra[0]}`)).toBe(1); // the abandoned claim was taken over
    expect(counts.has(`booking/${extra[1]}`)).toBe(false); // the live claim was left alone
    expect([...counts.values()].every((n) => n === 1)).toBe(true);
  });
});
