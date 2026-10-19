import crypto from "node:crypto";
import http, { type Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db, setSetting } from "../db/index.js";
import { NeedsReviewError } from "../commerce/payments.js";
import { occupiesCapacitySql } from "../bookingIntegrity.js";
import { stubProvider } from "./provider.js";
import { recordCheckoutAgreement } from "./checkoutAgreement.js";
import { beginEvent, failEvent, finishEvent } from "./webhookEvents.js";
import { processStripeEvent } from "../routes/stripeWebhook.js";
import { bookingsRouter } from "../routes/bookings.js";
import { adminRouter } from "../routes/admin.js";
import { customerPaymentCase, getReview, recheckReview, RecheckError, reviewDeadline, reviewForSession, shortenReviewHolds, sweepPaymentReviews } from "./paymentReview.js";

// D-10 / D-11 (2026-10-15) — paid orders under review, review deadlines,
// automatic refunds for cases 4/4b and "Recheck with Stripe". Real isolated
// database; the provider is the network-free stub, which records every call
// (so "the recheck never creates a refund" is asserted on the call log).
// Events are delivered the way the webhook route does it: stored once,
// claimed, processed, and parked on NeedsReviewError.

const run = crypto.randomUUID().slice(0, 8);
const orgId = `t-org-pr-${run}`;
const vendorId = `t-vendor-pr-${run}`;
const financeId = `t-fin-pr-${run}`;
const supportId = `t-sup-pr-${run}`;
const residentId = `t-res-pr-${run}`;
const centreId = `t-centre-pr-${run}`;
const roomId = `t-room-pr-${run}`;
const clubId = `t-club-pr-${run}`;
const programId = `t-prog-pr-${run}`;
const gameId = `t-game-pr-${run}`;
const clientId = `t-client-pr-${run}`;
const refs: { table: string; ref: string }[] = [];
const eventIds: string[] = [];
let server: Server;
let baseUrl: string;
let n = 0;

function stubOn() {
  process.env.QA_E2E_ENABLED = "true";
  process.env.QA_PAYMENT_PROVIDER_STUB = "1";
}
function stubOff() {
  delete process.env.QA_E2E_ENABLED;
  delete process.env.QA_PAYMENT_PROVIDER_STUB;
}

/** Ireland wall-clock date and HH:MM for now + `minutes`. */
function irelandAt(minutes: number) {
  const d = new Date(Date.now() + minutes * 60_000);
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Dublin", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(d).map((p) => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour === "24" ? "00" : parts.hour}:${parts.minute}` };
}

const refundCalls = () => stubProvider.calls.filter((c) => c.method === "createRefund").length;
const one = async <T = Record<string, any>>(sql: string, ...p: unknown[]) => (await db.prepare(sql).get(...p)) as T;
const all = async <T = Record<string, any>>(sql: string, ...p: unknown[]) => (await db.prepare(sql).all(...p)) as T[];

/** A pending paid booking: checkout agreement + what the stub provider will report. */
async function pendingBooking(opts: { date: string; time: string; agreed?: number; charged?: number; agedMinutes?: number; currency?: string }) {
  const ref = `HB-PR${run}${++n}`;
  const sid = `cs_pr_${run}_${n}`;
  const agreed = opts.agreed ?? 5000;
  await db
    .prepare(
      `INSERT INTO bookings (ref, client_id, centre_id, room_id, date, time, duration, event_type, guests, name, email, phone, notes, total_cents, status, payment_status, stripe_session_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, 'Meeting', 4, 'Review Guest', 'qa_review_guest@example.test', '', '', ?, 'confirmed', 'pending', ?, NOW() - INTERVAL ? MINUTE)`
    )
    .run(ref, clientId, centreId, roomId, opts.date, opts.time, agreed, sid, opts.agedMinutes ?? 1);
  refs.push({ table: "bookings", ref });
  await recordCheckoutAgreement({ sessionId: sid, type: "booking", ref, amountMinor: agreed, currency: "EUR" });
  stubProvider.markPaid(sid, opts.charged ?? agreed);
  stubProvider.setSessionCharge(sid, opts.charged ?? agreed, opts.currency ?? "eur", { type: "booking", ref });
  return { ref, sid, agreed, charged: opts.charged ?? agreed };
}

function paidEvent(o: { sid: string; type: string; ref: string; amount: number; currency?: string }) {
  const id = `evt_pr_${crypto.randomUUID().replace(/-/g, "")}`;
  eventIds.push(id);
  return {
    id,
    type: "checkout.session.completed",
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    account: null,
    data: { object: { id: o.sid, object: "checkout.session", payment_status: "paid", amount_total: o.amount, currency: o.currency ?? "eur", payment_intent: `pi_stub_${o.sid}`, metadata: { type: o.type, ref: o.ref } } },
  };
}

/** Same steps as the webhook route: store once, claim, process, park on NeedsReviewError. */
async function deliver(event: ReturnType<typeof paidEvent> | Record<string, any>): Promise<"processed" | "parked" | "failed" | "duplicate" | "busy"> {
  const begin = await beginEvent("stripe", event as never, JSON.stringify(event));
  if (begin.action !== "process") return begin.action;
  try {
    await finishEvent(begin.rowId, await processStripeEvent(event as never));
    return "processed";
  } catch (e) {
    await failEvent(begin.rowId, e, { needsReview: e instanceof NeedsReviewError });
    return e instanceof NeedsReviewError ? "parked" : "failed";
  }
}

const booking = (ref: string) => one(`SELECT status, payment_status AS ps, review_hold_until AS hold FROM bookings WHERE ref = ?`, ref);
const occupies = async (ref: string) => !!(await one(`SELECT ref FROM bookings WHERE ref = ? AND ${occupiesCapacitySql()}`, ref));
const alertsFor = async (reviewId: number) => (await all<{ kind: string }>(`SELECT kind FROM payment_review_alerts WHERE review_id = ? ORDER BY id`, reviewId)).map((a) => a.kind);
const refundsFor = (ref: string) => all(`SELECT id, status, origin, amount_minor AS amount, provider_refund_id AS pid, idempotency_key AS k FROM refunds WHERE source_ref = ? ORDER BY id`, ref);

beforeAll(async () => {
  stubOn();
  await db.prepare(`INSERT INTO organisations (id, name, kind) VALUES (?, 'Review Org', 'vendor')`).run(orgId);
  await db.prepare(`INSERT INTO users (id, email, password_hash, role, status, name, org_id) VALUES (?, ?, 'x', 'vendor', 'approved', 'Review Vendor', ?)`).run(vendorId, `${vendorId}@example.test`, orgId);
  await db.prepare(`INSERT INTO users (id, email, password_hash, role, status, name, admin_role) VALUES (?, ?, 'x', 'admin', 'approved', 'Review Finance', 'finance')`).run(financeId, `${financeId}@example.test`);
  await db.prepare(`INSERT INTO users (id, email, password_hash, role, status, name, admin_role) VALUES (?, ?, 'x', 'admin', 'approved', 'Review Support', 'support')`).run(supportId, `${supportId}@example.test`);
  await db.prepare(`INSERT INTO residents (id, email, name) VALUES (?, ?, 'Review Resident')`).run(residentId, `${residentId}@example.test`);
  await db
    .prepare(`INSERT INTO centres (id, name, area, county, rating, reviews, capacity, from_price, managed_by, ph, image_url, blurb, vendor_id) VALUES (?, 'Review Centre', 'Area', 'Dublin', 0, 0, 20, 1000, 'Mgr', '', '', '', ?)`)
    .run(centreId, vendorId);
  await db.prepare(`INSERT INTO rooms (id, centre_id, name, cap, rate, \`desc\`, sort_order) VALUES (?, ?, 'Hall', 20, 50, '', 0)`).run(roomId, centreId);
  await db
    .prepare(`INSERT INTO clubs (id, name, sport, area, county, ages, price, unit, trial, ph, image_url, blurb, vendor_id, capacity) VALUES (?, 'Review Club', 'Testball', 'Area', 'Dublin', '5-12', 10, 'year', 0, '', '', '', ?, 5)`)
    .run(clubId, vendorId);
  await db.prepare(`INSERT INTO programs (id, listing_type, listing_id, vendor_id, title, description, status, capacity) VALUES (?, 'centre', ?, ?, 'Review Programme', '', 'published', 1)`).run(programId, centreId, vendorId);
  await db.prepare(`INSERT INTO games (id, host_resident_id, activity_label, centre_id, date, time, capacity, price_cents, status) VALUES (?, ?, 'Review Game', NULL, ?, '12:00', 4, 800, 'open')`).run(gameId, residentId, irelandAt(4 * 24 * 60).date);

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const role = req.header("X-Test-Role");
    if (role === "finance") (req as any).user = { id: financeId, role: "admin", status: "approved", adminRole: "finance" };
    if (role === "support") (req as any).user = { id: supportId, role: "admin", status: "approved", adminRole: "support" };
    next();
  });
  app.use("/bookings", bookingsRouter);
  app.use("/admin", adminRouter);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("bind");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

beforeEach(() => {
  stubOn();
  delete process.env.PAYMENT_REFUND_TIMEOUT_MS;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  stubOff();
  await setSetting("commerce.auto_refund_unfulfillable", "true");
  const reviewIds = ((await all<{ id: number }>(`SELECT id FROM payment_reviews WHERE source_ref IN (${refs.map(() => "?").join(",") || "''"}) OR checkout_session_id LIKE ?`, ...refs.map((r) => r.ref), `cs_pr_${run}%`)) as { id: number }[]).map((r) => String(r.id));
  for (const id of reviewIds) {
    await db.prepare(`DELETE FROM payment_review_alerts WHERE review_id = ?`).run(id);
    await db.prepare(`DELETE FROM notifications WHERE kind = 'payment_review' AND listing_id = ?`).run(id);
    await db.prepare(`DELETE FROM audit_log WHERE object_type = 'payment_review' AND object_id = ?`).run(`review-${id}`);
    await db.prepare(`DELETE FROM payment_reviews WHERE id = ?`).run(id);
  }
  for (const { table, ref } of refs) {
    await db.prepare(`DELETE FROM refunds WHERE source_ref = ?`).run(ref);
    await db.prepare(`DELETE FROM payment_records WHERE source_ref = ?`).run(ref);
    await db.prepare(`DELETE FROM checkout_agreements WHERE source_ref = ?`).run(ref);
    await db.prepare(`DELETE FROM audit_log WHERE object_id = ?`).run(ref);
    await db.prepare(`DELETE FROM notifications WHERE ref = ?`).run(ref);
    await db.prepare(`DELETE FROM ${table} WHERE ref = ?`).run(ref);
  }
  for (const id of eventIds) await db.prepare(`DELETE FROM webhook_events WHERE event_id = ?`).run(id);
  await db.prepare(`DELETE FROM program_sessions WHERE program_id = ?`).run(programId);
  await db.prepare(`DELETE FROM programs WHERE id = ?`).run(programId);
  await db.prepare(`DELETE FROM games WHERE id = ?`).run(gameId);
  await db.prepare(`DELETE FROM rooms WHERE centre_id = ?`).run(centreId);
  await db.prepare(`DELETE FROM centres WHERE id = ?`).run(centreId);
  await db.prepare(`DELETE FROM clubs WHERE id = ?`).run(clubId);
  await db.prepare(`DELETE FROM residents WHERE id = ?`).run(residentId);
  await db.prepare(`DELETE FROM notifications WHERE recipient_id IN (?, ?, ?)`).run(financeId, supportId, vendorId);
  await db.prepare(`DELETE FROM users WHERE id IN (?, ?, ?)`).run(vendorId, financeId, supportId);
  await db.prepare(`DELETE FROM organisations WHERE id = ?`).run(orgId);
});

describe("D-10 review deadline (pure)", () => {
  const park = new Date("2026-11-01T10:00:00Z");
  const h = (x: number) => new Date(park.getTime() + x * 3_600_000);
  it("is the earlier of park + 24 h and start − 2 h; no hold within the lead time or after the start; 24 h with no start", () => {
    expect(reviewDeadline(park, h(72), { windowHours: 24, leadHours: 2 })).toEqual({ holdUntil: h(24), urgency: "none" });
    expect(reviewDeadline(park, h(10), { windowHours: 24, leadHours: 2 })).toEqual({ holdUntil: h(8), urgency: "starts_soon" });
    expect(reviewDeadline(park, h(1.5), { windowHours: 24, leadHours: 2 })).toEqual({ holdUntil: null, urgency: "within_lead" });
    expect(reviewDeadline(park, h(-1), { windowHours: 24, leadHours: 2 })).toEqual({ holdUntil: null, urgency: "after_start" });
    expect(reviewDeadline(park, null, { windowHours: 24, leadHours: 2 })).toEqual({ holdUntil: h(24), urgency: "none" });
    expect(reviewDeadline(park, h(72), { windowHours: 0, leadHours: 2 })).toEqual({ holdUntil: null, urgency: "none" }); // W = 0: rollback to no holds
  });
});

describe("D-10 case 1 — verified payment that differs from the agreement", () => {
  it("start 3 days away: parked, place held for 24 h after its own 30-minute hold lapses; the deadline releases it with one alert and no refund", async () => {
    const at = irelandAt(3 * 24 * 60);
    const b = await pendingBooking({ date: at.date, time: "12:00", agreed: 5000, charged: 4800, agedMinutes: 45 });
    expect(await deliver(paidEvent({ sid: b.sid, type: "booking", ref: b.ref, amount: 4800 }))).toBe("parked");
    const review = (await reviewForSession(b.sid))!;
    expect(review).toMatchObject({ reason: "amount_mismatch", holdStatus: "held", receivedMinor: 4800, agreedMinor: 5000, providerPayment: "verified_paid", status: "open" });
    const held = new Date(review.reviewHoldUntil!).getTime() - new Date(review.flaggedAt).getTime();
    expect(Math.abs(held - 24 * 3_600_000)).toBeLessThan(5_000);
    expect(await booking(b.ref)).toMatchObject({ status: "confirmed", ps: "pending" }); // not confirmed, not "unpaid"
    expect(await occupies(b.ref), "the 30-minute hold lapsed but the review keeps the place").toBe(true);
    expect(await alertsFor(review.id)).toEqual(["parked"]);
    expect((await customerPaymentCase("booking", b.ref))?.state).toBe("review");

    // Replay can't confirm a mismatch and doesn't recompute the deadline.
    expect(await deliver(paidEvent({ sid: b.sid, type: "booking", ref: b.ref, amount: 4800 }))).toBe("parked");
    expect((await reviewForSession(b.sid))!.reviewHoldUntil).toEqual(review.reviewHoldUntil);
    expect((await booking(b.ref)).ps).toBe("pending");

    // Controlled clock: the deadline is due.
    await db.prepare(`UPDATE payment_reviews SET review_hold_until = NOW() - INTERVAL 1 SECOND, flagged_at = NOW() - INTERVAL 1 DAY WHERE id = ?`).run(review.id);
    await db.prepare(`UPDATE bookings SET review_hold_until = NOW() - INTERVAL 1 SECOND WHERE ref = ?`).run(b.ref);
    const calls = refundCalls();
    await sweepPaymentReviews();
    await sweepPaymentReviews(); // repeated sweeps …
    await sweepPaymentReviews(); // … and a "restart" (the state is in the database) send nothing twice
    const after = (await getReview(review.id))!;
    expect(after).toMatchObject({ holdStatus: "expired", status: "open" }); // the financial case stays open
    expect(await occupies(b.ref), "expiry releases the place").toBe(false);
    expect(await alertsFor(review.id)).toEqual(["parked", "expired"]);
    expect(await refundsFor(b.ref), "expiry never refunds").toEqual([]);
    expect(refundCalls(), "no provider call on expiry").toBe(calls);
    expect((await customerPaymentCase("booking", b.ref))?.state).toBe("review_expired");
    const notes = await all(`SELECT id FROM notifications WHERE kind = 'payment_review' AND listing_id = ? AND recipient_id = ?`, String(review.id), financeId);
    expect(notes).toHaveLength(2); // one per alert kind, across three sweeps
  });

  it("halfway alert: exactly once across repeated sweeps", async () => {
    const at = irelandAt(5 * 24 * 60);
    const b = await pendingBooking({ date: at.date, time: "12:00", charged: 4900 });
    await deliver(paidEvent({ sid: b.sid, type: "booking", ref: b.ref, amount: 4900 }));
    const review = (await reviewForSession(b.sid))!;
    await db.prepare(`UPDATE payment_reviews SET flagged_at = NOW() - INTERVAL 13 HOUR, review_hold_until = NOW() + INTERVAL 11 HOUR WHERE id = ?`).run(review.id);
    for (let i = 0; i < 3; i++) await sweepPaymentReviews();
    expect(await alertsFor(review.id)).toEqual(["parked", "halfway"]);
  });

  it("starts in 90 minutes: no hold, urgent, one urgent alert; the customer is told it couldn't be confirmed in time", async () => {
    const at = irelandAt(90);
    const b = await pendingBooking({ date: at.date, time: at.time, charged: 4000 });
    expect(await deliver(paidEvent({ sid: b.sid, type: "booking", ref: b.ref, amount: 4000 }))).toBe("parked");
    const review = (await reviewForSession(b.sid))!;
    expect(review).toMatchObject({ holdStatus: "none", urgency: "within_lead", reviewHoldUntil: null });
    expect((await booking(b.ref)).hold).toBeNull();
    expect(await alertsFor(review.id)).toEqual(["urgent"]);
    expect((await customerPaymentCase("booking", b.ref))?.state).toBe("review_urgent");
  });

  it("already started: no hold, after_start, and a later replay still can't confirm it", async () => {
    const at = irelandAt(-60);
    const b = await pendingBooking({ date: at.date, time: at.time, charged: 4000 });
    await deliver(paidEvent({ sid: b.sid, type: "booking", ref: b.ref, amount: 4000 }));
    expect((await reviewForSession(b.sid))!).toMatchObject({ holdStatus: "none", urgency: "after_start" });
    await deliver(paidEvent({ sid: b.sid, type: "booking", ref: b.ref, amount: 4000 }));
    expect((await booking(b.ref)).ps).toBe("pending");
  });

  it("club registration (no start): held for exactly 24 hours", async () => {
    const ref = `CR-PR${run}${++n}`;
    const sid = `cs_pr_${run}_${n}`;
    refs.push({ table: "registrations", ref });
    await db
      .prepare(
        `INSERT INTO registrations (ref, client_id, club_id, team, child_first, child_last, dob, g_first, g_last, email, phone, address, ec_name, ec_phone, ec_rel, medical, consent, trial, total_cents, status, payment_status, stripe_session_id)
         VALUES (?, ?, ?, 'U10', 'T', 'C', '2016-01-01', 'G', 'P', 'qa_review_g@example.test', '', '', '', '', '', '', 1, 0, 3000, 'confirmed', 'pending', ?)`
      )
      .run(ref, clientId, clubId, sid);
    await recordCheckoutAgreement({ sessionId: sid, type: "registration", ref, amountMinor: 3000, currency: "EUR" });
    stubProvider.markPaid(sid, 3100);
    await deliver(paidEvent({ sid, type: "registration", ref, amount: 3100 }));
    const review = (await reviewForSession(sid))!;
    expect(review).toMatchObject({ holdStatus: "held", urgency: "none", startAt: null });
    expect(Math.abs(new Date(review.reviewHoldUntil!).getTime() - new Date(review.flaggedAt).getTime() - 24 * 3_600_000)).toBeLessThan(5_000);
  });

  it("programme: S is the earliest future session of the enrolment; part-way is flagged; none left → after_start", async () => {
    await db.prepare(`INSERT INTO program_sessions (id, program_id, date, time, status) VALUES (UUID(), ?, ?, '10:00', 'scheduled'), (UUID(), ?, ?, '10:00', 'scheduled')`).run(programId, irelandAt(-3 * 24 * 60).date, programId, irelandAt(2 * 24 * 60).date);
    const ref = `PR-PR${run}${++n}`;
    const sid = `cs_pr_${run}_${n}`;
    refs.push({ table: "program_enrollments", ref });
    await db.prepare(`INSERT INTO program_enrollments (ref, program_id, client_id, participant_name, email, total_cents, payment_status, stripe_session_id) VALUES (?, ?, ?, 'P', 'qa_review_p@example.test', 2500, 'pending', ?)`).run(ref, programId, clientId, sid);
    await recordCheckoutAgreement({ sessionId: sid, type: "program", ref, amountMinor: 2500, currency: "EUR" });
    stubProvider.markPaid(sid, 2600);
    await deliver(paidEvent({ sid, type: "program", ref, amount: 2600 }));
    const review = (await reviewForSession(sid))!;
    const nextSession = new Date(review.startAt!).getTime();
    expect(nextSession).toBeGreaterThan(Date.now()); // the future session, not the past one
    expect(review.detail).toMatch(/already started; joining part-way/);
    expect(review.holdStatus).toBe("held");

    // Every session in the past → treated as already started.
    await db.prepare(`DELETE FROM program_sessions WHERE program_id = ? AND date >= ?`).run(programId, irelandAt(0).date);
    const ref2 = `PR-PR${run}${++n}`;
    const sid2 = `cs_pr_${run}_${n}`;
    refs.push({ table: "program_enrollments", ref: ref2 });
    await db.prepare(`INSERT INTO program_enrollments (ref, program_id, client_id, participant_name, email, total_cents, payment_status, stripe_session_id) VALUES (?, ?, ?, 'P', 'qa_review_p@example.test', 2500, 'pending', ?)`).run(ref2, programId, clientId, sid2);
    await recordCheckoutAgreement({ sessionId: sid2, type: "program", ref: ref2, amountMinor: 2500, currency: "EUR" });
    stubProvider.markPaid(sid2, 2600);
    await deliver(paidEvent({ sid: sid2, type: "program", ref: ref2, amount: 2600 }));
    expect((await reviewForSession(sid2))!).toMatchObject({ holdStatus: "none", urgency: "after_start" });
    await db.prepare(`DELETE FROM program_sessions WHERE program_id = ?`).run(programId);
  });

  it("rescheduling only shortens: an activity moved later keeps the deadline; moved earlier it shrinks; moved inside the lead time the hold ends with one urgent alert", async () => {
    const date = irelandAt(4 * 24 * 60).date;
    await db.prepare(`UPDATE games SET date = ?, time = '12:00' WHERE id = ?`).run(date, gameId);
    const ref = `GJ-PR${run}${++n}`;
    const sid = `cs_pr_${run}_${n}`;
    refs.push({ table: "game_participants", ref });
    await db.prepare(`INSERT INTO game_participants (game_id, resident_id, ref, status, payment_status, total_cents, stripe_session_id) VALUES (?, ?, ?, 'pending_payment', 'pending', 800, ?)`).run(gameId, residentId, ref, sid);
    await recordCheckoutAgreement({ sessionId: sid, type: "game", ref, amountMinor: 800, currency: "EUR" });
    stubProvider.markPaid(sid, 900);
    await deliver(paidEvent({ sid, type: "game", ref, amount: 900 }));
    const first = (await reviewForSession(sid))!;
    expect(first.holdStatus).toBe("held");

    await db.prepare(`UPDATE games SET date = ? WHERE id = ?`).run(irelandAt(9 * 24 * 60).date, gameId);
    await shortenReviewHolds("game", [ref]);
    expect((await reviewForSession(sid))!.reviewHoldUntil, "moved later: unchanged").toEqual(first.reviewHoldUntil);

    const soon = irelandAt(10 * 60);
    await db.prepare(`UPDATE games SET date = ?, time = ? WHERE id = ?`).run(soon.date, soon.time, gameId);
    await shortenReviewHolds("game", [ref]);
    const shorter = (await reviewForSession(sid))!;
    expect(new Date(shorter.reviewHoldUntil!).getTime()).toBeLessThan(new Date(first.reviewHoldUntil!).getTime());
    expect(Math.abs(new Date(shorter.reviewHoldUntil!).getTime() - (Date.now() + 8 * 3_600_000))).toBeLessThan(120_000);

    const now = irelandAt(60);
    await db.prepare(`UPDATE games SET date = ?, time = ? WHERE id = ?`).run(now.date, now.time, gameId);
    await shortenReviewHolds("game", [ref]);
    await shortenReviewHolds("game", [ref]);
    const ended = (await reviewForSession(sid))!;
    expect(ended).toMatchObject({ holdStatus: "released", urgency: "within_lead", status: "open" });
    expect((await one(`SELECT review_hold_until AS h FROM game_participants WHERE ref = ?`, ref)).h).toBeNull();
    expect(await alertsFor(ended.id)).toEqual(["parked", "shortened"]);
  });

  it("a customer can't reschedule a booking whose payment is under review (409)", async () => {
    const at = irelandAt(6 * 24 * 60);
    const b = await pendingBooking({ date: at.date, time: "12:00", charged: 4500 });
    await deliver(paidEvent({ sid: b.sid, type: "booking", ref: b.ref, amount: 4500 }));
    const res = await fetch(`${baseUrl}/bookings/${b.ref}/reschedule`, { method: "POST", headers: { "Content-Type": "application/json", "X-Client-Id": clientId }, body: JSON.stringify({ date: irelandAt(7 * 24 * 60).date, time: "14:00" }) });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/still being checked/);
  });

  it("a last-place checkout racing a case-1 park: exactly one of them holds the place", async () => {
    await db.prepare(`DELETE FROM program_sessions WHERE program_id = ?`).run(programId);
    await db.prepare(`INSERT INTO program_sessions (id, program_id, date, time, status) VALUES (UUID(), ?, ?, '10:00', 'scheduled')`).run(programId, irelandAt(5 * 24 * 60).date);
    await db.prepare(`UPDATE program_enrollments SET status = 'cancelled' WHERE program_id = ?`).run(programId);
    const ref = `PR-PR${run}${++n}`;
    const sid = `cs_pr_${run}_${n}`;
    refs.push({ table: "program_enrollments", ref });
    // Its own 30-minute hold has lapsed: the last place is free for anyone.
    await db.prepare(`INSERT INTO program_enrollments (ref, program_id, client_id, participant_name, email, total_cents, payment_status, stripe_session_id, created_at) VALUES (?, ?, ?, 'P', 'qa_review_p@example.test', 2500, 'pending', ?, NOW() - INTERVAL 40 MINUTE)`).run(ref, programId, clientId, sid);
    await recordCheckoutAgreement({ sessionId: sid, type: "program", ref, amountMinor: 2500, currency: "EUR" });
    stubProvider.markPaid(sid, 2700);
    const rival = `PR-PR${run}${++n}`;
    refs.push({ table: "program_enrollments", ref: rival });
    const checkout = db.transaction(async (tx) => {
      await tx.prepare(`SELECT id FROM programs WHERE id = ? FOR UPDATE`).get(programId);
      const { c } = (await tx.prepare(`SELECT COUNT(*) AS c FROM program_enrollments WHERE program_id = ? AND ${occupiesCapacitySql()}`).get(programId)) as { c: number };
      if (Number(c) >= 1) return false;
      await tx.prepare(`INSERT INTO program_enrollments (ref, program_id, client_id, participant_name, email, total_cents, payment_status) VALUES (?, ?, ?, 'R', 'qa_review_r@example.test', 2500, 'pending')`).run(rival, programId, clientId);
      return true;
    });
    const [, rivalWon] = await Promise.all([deliver(paidEvent({ sid, type: "program", ref, amount: 2700 })), checkout]);
    const held = (await reviewForSession(sid))!.holdStatus === "held";
    expect(Number(held) + Number(rivalWon), "exactly one success").toBe(1);
    const { c } = await one<{ c: number }>(`SELECT COUNT(*) AS c FROM program_enrollments WHERE program_id = ? AND ${occupiesCapacitySql()}`, programId);
    expect(Number(c)).toBe(1);
  });
});

describe("D-10 case 2 — association unverified", () => {
  it("never holds, never refunds; recorded for finance", async () => {
    const at = irelandAt(3 * 24 * 60);
    const b = await pendingBooking({ date: at.date, time: "15:00" });
    const stray = `cs_pr_${run}_stray${++n}`;
    stubProvider.markPaid(stray, b.agreed);
    const calls = refundCalls();
    expect(await deliver(paidEvent({ sid: stray, type: "booking", ref: b.ref, amount: b.agreed }))).toBe("parked");
    const review = (await reviewForSession(stray))!;
    expect(review).toMatchObject({ reason: "association_unverified", holdStatus: "none", autoRefund: "not_applicable" });
    expect((await booking(b.ref)).hold).toBeNull();
    expect(refundCalls()).toBe(calls);
    expect(await customerPaymentCase("booking", b.ref), "the order's customer isn't shown someone else's payment").toBeNull();
  });
});

describe("D-10 cases 4 / 4b — automatic refunds", () => {
  /** A booking whose hold lapsed and whose slot was then sold to someone else. */
  async function lostPlace(time: string) {
    const at = irelandAt(8 * 24 * 60);
    const b = await pendingBooking({ date: at.date, time, agedMinutes: 45 });
    const other = `HB-PR${run}${++n}`;
    refs.push({ table: "bookings", ref: other });
    await db
      .prepare(`INSERT INTO bookings (ref, client_id, centre_id, room_id, date, time, duration, event_type, guests, name, email, phone, notes, total_cents, status, payment_status) VALUES (?, 'other', ?, ?, ?, ?, 1, 'M', 2, 'Other', 'qa_other@example.test', '', '', 5000, 'confirmed', 'paid')`)
      .run(other, centreId, roomId, at.date, time);
    return { ...b, other };
  }

  it("case 4: a matching payment after the place was sold → paid, cancelled, refunded in full once; replays and a concurrent delivery add nothing", async () => {
    const b = await lostPlace("09:00");
    const calls = refundCalls();
    const [r1, r2] = await Promise.all([deliver(paidEvent({ sid: b.sid, type: "booking", ref: b.ref, amount: b.agreed })), deliver(paidEvent({ sid: b.sid, type: "booking", ref: b.ref, amount: b.agreed }))]);
    expect([r1, r2]).toEqual(["processed", "processed"]);
    expect(await booking(b.ref)).toMatchObject({ status: "cancelled", ps: "refunded" });
    const refunds = await refundsFor(b.ref);
    expect(refunds).toHaveLength(1);
    expect(refunds[0]).toMatchObject({ status: "succeeded", origin: "auto", amount: b.agreed, k: expect.stringMatching(/^auto-refund:ch_stub_/) });
    expect(refundCalls() - calls, "one provider refund call").toBe(1);
    expect((await one(`SELECT COUNT(*) AS c FROM payment_records WHERE source_ref = ?`, b.ref)).c).toBe(1); // received, recorded once
    const review = (await reviewForSession(b.sid))!;
    expect(review).toMatchObject({ reason: "capacity_unavailable", status: "resolved", resolution: "auto_refunded", autoRefund: "succeeded" });
    expect((await booking(b.other)).ps, "the other customer's place is untouched").toBe("paid");
    // Out-of-order / replayed deliveries can't resurrect it or refund twice.
    await deliver(paidEvent({ sid: b.sid, type: "booking", ref: b.ref, amount: b.agreed }));
    expect(await booking(b.ref)).toMatchObject({ status: "cancelled", ps: "refunded" });
    expect(await refundsFor(b.ref)).toHaveLength(1);
    expect(refundCalls() - calls).toBe(1);
    expect((await customerPaymentCase("booking", b.ref))).toMatchObject({ state: "refunded", refundedMinor: b.agreed });
  });

  it("case 4 with an earlier partial refund at the provider → no automatic refund, finance item", async () => {
    const b = await lostPlace("10:00");
    stubProvider.addExternalRefund(b.sid, 500);
    const calls = refundCalls();
    await deliver(paidEvent({ sid: b.sid, type: "booking", ref: b.ref, amount: b.agreed }));
    const review = (await reviewForSession(b.sid))!;
    expect(review).toMatchObject({ status: "open", autoRefund: "ineligible" });
    expect(review.autoRefundNote).toMatch(/already shows a refund/);
    expect(refundCalls()).toBe(calls);
    expect(await alertsFor(review.id)).toEqual(["auto_refund_ineligible"]);
    expect((await customerPaymentCase("booking", b.ref))?.state).toBe("not_fulfilled");
  });

  it("case 4 with a dispute → no automatic refund", async () => {
    const b = await lostPlace("11:00");
    stubProvider.addDispute(b.sid);
    const calls = refundCalls();
    await deliver(paidEvent({ sid: b.sid, type: "booking", ref: b.ref, amount: b.agreed }));
    expect((await reviewForSession(b.sid))!).toMatchObject({ autoRefund: "ineligible", autoRefundNote: "The payment is disputed" });
    expect(refundCalls()).toBe(calls);
  });

  it("an amount that differs from the agreement is case 1, never an automatic refund", async () => {
    const b = await lostPlace("12:00");
    const calls = refundCalls();
    stubProvider.setSessionCharge(b.sid, b.agreed + 100, "eur", { type: "booking", ref: b.ref });
    expect(await deliver(paidEvent({ sid: b.sid, type: "booking", ref: b.ref, amount: b.agreed + 100 }))).toBe("parked");
    expect((await reviewForSession(b.sid))!).toMatchObject({ reason: "amount_mismatch", holdStatus: "none", autoRefund: "not_applicable" });
    expect(refundCalls()).toBe(calls);
  });

  it("provider refuses the refund → refund row failed with the error, finance alert, never retried", async () => {
    const b = await lostPlace("13:00");
    stubProvider.nextRefundFailure = "reject";
    await deliver(paidEvent({ sid: b.sid, type: "booking", ref: b.ref, amount: b.agreed }));
    const calls = refundCalls();
    expect(await refundsFor(b.ref)).toMatchObject([{ status: "failed", origin: "auto" }]);
    const review = (await reviewForSession(b.sid))!;
    expect(review).toMatchObject({ autoRefund: "failed", status: "open" });
    expect(await alertsFor(review.id)).toEqual(["refund_failed"]);
    await deliver(paidEvent({ sid: b.sid, type: "booking", ref: b.ref, amount: b.agreed }));
    expect(refundCalls(), "no second attempt").toBe(calls);
    expect(await booking(b.ref)).toMatchObject({ status: "cancelled", ps: "paid" }); // received, not refunded, not "unpaid"
  });

  it("provider timeout → refund 'unknown', uncertain, alert; a redelivery doesn't send it again", async () => {
    process.env.PAYMENT_REFUND_TIMEOUT_MS = "200";
    const b = await lostPlace("14:00");
    stubProvider.nextRefundFailure = "timeout";
    await deliver(paidEvent({ sid: b.sid, type: "booking", ref: b.ref, amount: b.agreed }));
    const calls = refundCalls();
    expect(await refundsFor(b.ref)).toMatchObject([{ status: "unknown", pid: null }]);
    const review = (await reviewForSession(b.sid))!;
    expect(review.autoRefund).toBe("uncertain");
    expect(await alertsFor(review.id)).toEqual(["refund_uncertain"]);
    await deliver(paidEvent({ sid: b.sid, type: "booking", ref: b.ref, amount: b.agreed }));
    expect(refundCalls()).toBe(calls);
    expect((await customerPaymentCase("booking", b.ref))?.state).toBe("refund_pending");
  });

  it("response lost after the provider refunded → 'unknown'; Recheck with Stripe finds it by its key and closes, with zero refund calls", async () => {
    const b = await lostPlace("15:00");
    stubProvider.nextRefundFailure = "lost_response";
    await deliver(paidEvent({ sid: b.sid, type: "booking", ref: b.ref, amount: b.agreed }));
    expect(await refundsFor(b.ref)).toMatchObject([{ status: "unknown" }]);
    const review = (await reviewForSession(b.sid))!;
    const calls = refundCalls();
    const result = await recheckReview(review.id, financeId, "Reconcile the lost refund answer");
    expect(result).toMatchObject({ outcome: "closed", succeededMinor: b.agreed });
    expect(refundCalls(), "the recheck never creates a refund").toBe(calls);
    const refunds = await refundsFor(b.ref);
    expect(refunds).toHaveLength(1);
    expect(refunds[0]).toMatchObject({ status: "succeeded", pid: expect.stringMatching(/^re_stub_/) });
    expect(await booking(b.ref)).toMatchObject({ status: "cancelled", ps: "refunded" });
  });

  it("switching automatic refunds off stops new ones only: an unknown refund is still marked by the sweep and reconciled by Recheck", async () => {
    const b = await lostPlace("17:00");
    stubProvider.nextRefundFailure = "lost_response";
    await deliver(paidEvent({ sid: b.sid, type: "booking", ref: b.ref, amount: b.agreed }));
    expect(await refundsFor(b.ref)).toMatchObject([{ status: "unknown" }]);
    await setSetting("commerce.auto_refund_unfulfillable", "false");
    try {
      const calls = refundCalls();
      // A new unfulfillable payment is not refunded automatically …
      const c = await lostPlace("18:00");
      await deliver(paidEvent({ sid: c.sid, type: "booking", ref: c.ref, amount: c.agreed }));
      expect((await reviewForSession(c.sid))!.autoRefund).toBe("disabled");
      expect(refundCalls(), "no new automatic refund").toBe(calls);
      // … but the earlier in-flight one is still reconciled and closed.
      const r = await recheckReview((await reviewForSession(b.sid))!.id, financeId, "Reconcile while switched off");
      expect(r.outcome).toBe("closed");
      expect(await refundsFor(b.ref)).toMatchObject([{ status: "succeeded" }]);
      expect(await booking(b.ref)).toMatchObject({ status: "cancelled", ps: "refunded" });
      expect(refundCalls()).toBe(calls);
    } finally {
      await setSetting("commerce.auto_refund_unfulfillable", "true");
    }
  });

  it("a process that stopped after claiming the refund: the sweep marks it unknown once, never re-sends it", async () => {
    const b = await lostPlace("16:00");
    await setSetting("commerce.auto_refund_unfulfillable", "false");
    await deliver(paidEvent({ sid: b.sid, type: "booking", ref: b.ref, amount: b.agreed }));
    await setSetting("commerce.auto_refund_unfulfillable", "true");
    const review = (await reviewForSession(b.sid))!;
    // Simulate the crash window: claimed and committed, no provider answer recorded.
    await db.prepare(`INSERT INTO refunds (source_type, source_ref, idempotency_key, amount_minor, currency, kind, origin, responsible, reason, status, created_at) VALUES ('booking', ?, ?, ?, 'EUR', 'full', 'auto', 'platform', 'crash test', 'pending', NOW() - INTERVAL 11 MINUTE)`).run(b.ref, `auto-refund:ch_stub_${b.sid}`, b.agreed);
    await db.prepare(`UPDATE payment_reviews SET auto_refund = 'requested' WHERE id = ?`).run(review.id);
    const calls = refundCalls();
    await sweepPaymentReviews();
    await sweepPaymentReviews();
    expect(await refundsFor(b.ref)).toMatchObject([{ status: "unknown" }]);
    expect((await getReview(review.id))!.autoRefund).toBe("uncertain");
    expect((await alertsFor(review.id)).filter((k) => k === "refund_uncertain")).toHaveLength(1);
    expect(refundCalls()).toBe(calls);
  });

  it("case 4b: paid after the organisation was suspended → refunded automatically; reinstatement + redelivery can't resurrect it", async () => {
    const at = irelandAt(10 * 24 * 60);
    const b = await pendingBooking({ date: at.date, time: "09:00" });
    await db.prepare(`UPDATE organisations SET status = 'suspended' WHERE id = ?`).run(orgId);
    try {
      expect(await deliver(paidEvent({ sid: b.sid, type: "booking", ref: b.ref, amount: b.agreed }))).toBe("processed");
    } finally {
      await db.prepare(`UPDATE organisations SET status = 'active' WHERE id = ?`).run(orgId);
    }
    expect(await booking(b.ref)).toMatchObject({ status: "cancelled", ps: "refunded" });
    expect(await refundsFor(b.ref)).toMatchObject([{ status: "succeeded", origin: "auto" }]);
    expect((await one(`SELECT COUNT(*) AS c FROM payment_records WHERE source_ref = ?`, b.ref)).c).toBe(1);
    expect((await reviewForSession(b.sid))!).toMatchObject({ reason: "org_suspended", resolution: "auto_refunded" });
    await deliver(paidEvent({ sid: b.sid, type: "booking", ref: b.ref, amount: b.agreed }));
    expect(await booking(b.ref)).toMatchObject({ status: "cancelled", ps: "refunded" });
  });

  it("case 4b with automatic refunds off: held (pending, parked); after reinstatement a redelivery confirms once — or, if the place was resold, never reclaims it", async () => {
    await setSetting("commerce.auto_refund_unfulfillable", "false");
    const at = irelandAt(11 * 24 * 60);
    const ok = await pendingBooking({ date: at.date, time: "09:00" });
    const lost = await pendingBooking({ date: at.date, time: "11:00", agedMinutes: 45 });
    await db.prepare(`UPDATE organisations SET status = 'suspended' WHERE id = ?`).run(orgId);
    try {
      expect(await deliver(paidEvent({ sid: ok.sid, type: "booking", ref: ok.ref, amount: ok.agreed }))).toBe("parked");
      expect(await deliver(paidEvent({ sid: lost.sid, type: "booking", ref: lost.ref, amount: lost.agreed }))).toBe("parked");
    } finally {
      await db.prepare(`UPDATE organisations SET status = 'active' WHERE id = ?`).run(orgId);
    }
    expect((await booking(ok.ref)).ps).toBe("pending");
    const held = (await reviewForSession(ok.sid))!;
    expect(held).toMatchObject({ reason: "org_suspended", autoRefund: "disabled", status: "open" });
    expect(await alertsFor(held.id)).toEqual(["parked"]);
    // While held, the "lost" booking's slot is sold to someone else.
    const other = `HB-PR${run}${++n}`;
    refs.push({ table: "bookings", ref: other });
    await db.prepare(`INSERT INTO bookings (ref, client_id, centre_id, room_id, date, time, duration, event_type, guests, name, email, phone, notes, total_cents, status, payment_status) VALUES (?, 'other', ?, ?, ?, '11:00', 1, 'M', 2, 'Other', 'qa_other@example.test', '', '', 5000, 'confirmed', 'paid')`).run(other, centreId, roomId, at.date);

    // Reinstated (still with automatic refunds off): redelivery re-checks everything at this moment.
    expect(await deliver(paidEvent({ sid: ok.sid, type: "booking", ref: ok.ref, amount: ok.agreed }))).toBe("processed");
    expect(await booking(ok.ref)).toMatchObject({ status: "confirmed", ps: "paid" });
    expect((await one(`SELECT COUNT(*) AS c FROM payment_records WHERE source_ref = ?`, ok.ref)).c).toBe(1);
    expect((await reviewForSession(ok.sid))!).toMatchObject({ status: "resolved", resolution: "confirmed" });
    const parked = await all(`SELECT status FROM webhook_events WHERE object_id = ? ORDER BY id`, ok.sid);
    expect(parked.map((e) => e.status)).toEqual(["resolved", "processed"]);
    // A second redelivery changes nothing.
    await deliver(paidEvent({ sid: ok.sid, type: "booking", ref: ok.ref, amount: ok.agreed }));
    expect((await one(`SELECT COUNT(*) AS c FROM payment_records WHERE source_ref = ?`, ok.ref)).c).toBe(1);

    await deliver(paidEvent({ sid: lost.sid, type: "booking", ref: lost.ref, amount: lost.agreed }));
    expect(await booking(lost.ref)).toMatchObject({ status: "cancelled", ps: "paid" });
    expect((await booking(other)).ps, "the resold place stays with its new customer").toBe("paid");
    expect((await reviewForSession(lost.sid))!).toMatchObject({ reason: "capacity_unavailable", status: "open", autoRefund: "disabled" });
    await setSetting("commerce.auto_refund_unfulfillable", "true");
  });
});

describe("D-11 Recheck with Stripe", () => {
  async function parkedMismatch(time: string) {
    const at = irelandAt(12 * 24 * 60);
    const b = await pendingBooking({ date: at.date, time, agreed: 5000, charged: 5200 });
    await deliver(paidEvent({ sid: b.sid, type: "booking", ref: b.ref, amount: 5200 }));
    return { ...b, review: (await reviewForSession(b.sid))! };
  }

  it("full refund at the provider → closed; order refunded and cancelled (not 'failed'); place released; parked event resolved; second recheck is a no-op; zero refund calls", async () => {
    const b = await parkedMismatch("09:00");
    stubProvider.addExternalRefund(b.sid, 5200);
    const calls = refundCalls();
    const r = await recheckReview(b.review.id, financeId, "Refunded in the Stripe Dashboard");
    expect(r).toMatchObject({ outcome: "closed", association: true, chargedMinor: 5200, succeededMinor: 5200, recordedRefunds: 1 });
    expect(await booking(b.ref)).toMatchObject({ status: "cancelled", ps: "refunded", hold: null });
    expect((await getReview(b.review.id))!).toMatchObject({ status: "resolved", resolution: "refunded", holdStatus: "released", resolvedBy: financeId });
    expect((await all(`SELECT status FROM webhook_events WHERE object_id = ?`, b.sid)).map((e) => e.status)).toEqual(["resolved"]);
    const again = await recheckReview(b.review.id, financeId, "Second look, nothing should change");
    expect(again).toMatchObject({ recordedRefunds: 0, updatedRefunds: 0 });
    expect(await refundsFor(b.ref)).toHaveLength(1);
    expect(refundCalls()).toBe(calls);
    const audits = await all(`SELECT action FROM audit_log WHERE object_type = 'payment_review' AND object_id = ? AND action = 'payment.review_resolved'`, `review-${b.review.id}`);
    expect(audits).toHaveLength(1); // one resolution record
    expect((await customerPaymentCase("booking", b.ref))).toMatchObject({ state: "refunded", refundedMinor: 5200 });
  });

  it("partial refunds stay open until they add up to the charge; a third recheck changes nothing", async () => {
    const b = await parkedMismatch("10:00");
    stubProvider.addExternalRefund(b.sid, 2000);
    expect(await recheckReview(b.review.id, financeId, "First partial refund")).toMatchObject({ outcome: "open", succeededMinor: 2000 });
    expect((await booking(b.ref)).ps).toBe("pending");
    stubProvider.addExternalRefund(b.sid, 3200);
    expect(await recheckReview(b.review.id, financeId, "Second partial refund")).toMatchObject({ outcome: "closed", succeededMinor: 5200 });
    await recheckReview(b.review.id, financeId, "Third look");
    expect(await refundsFor(b.ref)).toHaveLength(2);
  });

  it("a pending refund keeps it open; it closes once the refund succeeds; a failed refund is recorded and stays open", async () => {
    const b = await parkedMismatch("11:00");
    const pending = stubProvider.addExternalRefund(b.sid, 5200, "pending");
    expect(await recheckReview(b.review.id, financeId, "Refund still pending")).toMatchObject({ outcome: "open", pendingMinor: 5200 });
    expect(await refundsFor(b.ref)).toMatchObject([{ status: "pending" }]);
    stubProvider.setRefundStatus(pending.id, "succeeded");
    expect(await recheckReview(b.review.id, financeId, "Refund has now succeeded")).toMatchObject({ outcome: "closed" });
    expect(await refundsFor(b.ref)).toMatchObject([{ status: "succeeded" }]);

    const f = await parkedMismatch("12:00");
    stubProvider.addExternalRefund(f.sid, 5200, "failed");
    expect(await recheckReview(f.review.id, financeId, "Refund failed at Stripe")).toMatchObject({ outcome: "open", failedMinor: 5200 });
    expect(await refundsFor(f.ref)).toMatchObject([{ status: "failed" }]);
  });

  it("disputed (even if refunded) stays open; association unverified stays open with nothing recorded", async () => {
    const b = await parkedMismatch("13:00");
    stubProvider.addExternalRefund(b.sid, 5200);
    stubProvider.addDispute(b.sid);
    expect(await recheckReview(b.review.id, financeId, "Disputed and refunded")).toMatchObject({ outcome: "open", disputed: true });

    const at = irelandAt(12 * 24 * 60);
    const c = await pendingBooking({ date: at.date, time: "14:00" });
    const stray = `cs_pr_${run}_stray${++n}`;
    stubProvider.markPaid(stray, 5000);
    await deliver(paidEvent({ sid: stray, type: "booking", ref: c.ref, amount: 5000 }));
    stubProvider.addExternalRefund(stray, 5000);
    const r = await recheckReview((await reviewForSession(stray))!.id, financeId, "Unmatched payment");
    expect(r).toMatchObject({ outcome: "open", association: false, recordedRefunds: 0 });
    expect(await refundsFor(c.ref)).toEqual([]);
  });

  it("two finance users at once: one runs, the other gets 409; a provider error writes nothing", async () => {
    const b = await parkedMismatch("15:00");
    stubProvider.addExternalRefund(b.sid, 5200);
    const results = await Promise.allSettled([recheckReview(b.review.id, financeId, "Concurrent A"), recheckReview(b.review.id, financeId, "Concurrent B")]);
    const rejected = results.filter((x) => x.status === "rejected") as PromiseRejectedResult[];
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toBeInstanceOf(RecheckError);
    expect((rejected[0].reason as RecheckError).status).toBe(409);
    expect(await refundsFor(b.ref)).toHaveLength(1);

    const e = await parkedMismatch("16:00");
    stubProvider.addExternalRefund(e.sid, 5200);
    stubProvider.failNextSnapshot = true;
    const before = await getReview(e.review.id);
    await expect(recheckReview(e.review.id, financeId, "Provider down")).rejects.toMatchObject({ status: 502 });
    expect(await refundsFor(e.ref)).toEqual([]);
    expect({ ...(await getReview(e.review.id))!, updatedAt: undefined }).toMatchObject({ ...before!, updatedAt: undefined });
    expect((await recheckReview(e.review.id, financeId, "Provider back")).outcome, "the claim was released").toBe("closed");
  });

  it("charge.refunded arriving before the recheck records the refund once; the recheck then closes without a second row", async () => {
    const b = await parkedMismatch("17:00");
    stubProvider.addExternalRefund(b.sid, 5200);
    const id = `evt_pr_${crypto.randomUUID().replace(/-/g, "")}`;
    eventIds.push(id);
    const refunded = { id, type: "charge.refunded", created: Math.floor(Date.now() / 1000), livemode: false, account: null, data: { object: { id: `ch_stub_${b.sid}`, object: "charge", amount: 5200, amount_refunded: 5200, currency: "eur", payment_intent: `pi_stub_${b.sid}` } } };
    expect(await deliver(refunded)).toBe("processed");
    expect(await refundsFor(b.ref)).toMatchObject([{ status: "succeeded" }]);
    expect(await recheckReview(b.review.id, financeId, "After the webhook")).toMatchObject({ outcome: "closed", recordedRefunds: 0 });
    expect(await refundsFor(b.ref)).toHaveLength(1);
  });

  it("route: finance or super only — unauthenticated 401, support 403, finance runs it; a reason is required", async () => {
    const b = await parkedMismatch("18:00");
    const post = (role: string | null, body: unknown) =>
      fetch(`${baseUrl}/admin/finance/payment-reviews/${b.review.id}/recheck`, { method: "POST", headers: { "Content-Type": "application/json", ...(role ? { "X-Test-Role": role } : {}) }, body: JSON.stringify(body) });
    expect((await post(null, { reason: "No session at all" })).status).toBe(401);
    expect((await post("support", { reason: "Support tries it" })).status).toBe(403);
    expect((await post("finance", {})).status).toBe(400);
    const ok = await post("finance", { reason: "Finance checks it" });
    expect(ok.status).toBe(200);
    expect((await ok.json()).outcome).toBe("open");
    const detail = await fetch(`${baseUrl}/admin/finance/payment-reviews/${b.review.id}`, { headers: { "X-Test-Role": "finance" } });
    const body = await detail.json();
    expect(body.review).toMatchObject({ id: b.review.id, receivedMinor: 5200, agreedMinor: 5000 });
    expect(body.order).toMatchObject({ status: "confirmed", paymentStatus: "pending", totalMinor: 5000 });
    expect(body.events.map((e: { status: string }) => e.status)).toEqual(["manual_review"]);
  });
});
