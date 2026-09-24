import crypto from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../db/index.js";
import { confirmGameJoin, confirmPass } from "./stripeWebhook.js";

// Webhook idempotency (audit's #4 testing priority) — a retried Stripe
// webhook delivery for the same ref must be a safe no-op. Calls the
// confirm* functions directly (exported for this purpose) against a real
// DB, rather than reconstructing a full signed Stripe event — the thing
// under test is the guarded `UPDATE ... WHERE payment_status = 'pending'`
// pattern each one shares, not Stripe's own signature verification.

const testResidentId = `test-res-webhook-${crypto.randomUUID()}`;
const testHostId = `test-host-webhook-${crypto.randomUUID()}`;
let testGameId: string;
let testGameJoinRef: string;
let testPassRef: string;

beforeAll(async () => {
  await db.prepare(`INSERT INTO residents (id, email, name) VALUES (?, ?, ?)`).run(testResidentId, `${testResidentId}@example.test`, "Test Resident");
  await db.prepare(`INSERT INTO residents (id, email, name) VALUES (?, ?, ?)`).run(testHostId, `${testHostId}@example.test`, "Test Host");

  testGameId = `test-game-webhook-${crypto.randomUUID()}`;
  const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  await db
    .prepare(`INSERT INTO games (id, host_resident_id, activity_label, date, time, capacity, status, price_cents) VALUES (?, ?, ?, ?, ?, 4, 'open', 500)`)
    .run(testGameId, testHostId, "Test Webhook Padel", future, "18:00");

  testGameJoinRef = `test-gj-${crypto.randomUUID()}`;
  await db
    .prepare(`INSERT INTO game_participants (game_id, resident_id, ref, status, payment_status) VALUES (?, ?, ?, 'pending_payment', 'pending')`)
    .run(testGameId, testResidentId, testGameJoinRef);

  testPassRef = `test-pass-${crypto.randomUUID()}`;
  await db
    .prepare(`INSERT INTO passes (ref, resident_id, listing_type, listing_id, credits_total, purchased_cents, payment_status) VALUES (?, ?, 'club', 'test-listing', 5, 5000, 'pending')`)
    .run(testPassRef, testResidentId);
});

afterAll(async () => {
  await db.prepare(`DELETE FROM notifications WHERE resident_id = ? OR listing_id = ?`).run(testHostId, testGameId);
  await db.prepare(`DELETE FROM favourites WHERE listing_id = ?`).run(testGameId);
  await db.prepare(`DELETE FROM game_participants WHERE game_id = ?`).run(testGameId);
  await db.prepare(`DELETE FROM games WHERE id = ?`).run(testGameId);
  await db.prepare(`DELETE FROM passes WHERE ref = ?`).run(testPassRef);
  await db.prepare(`DELETE FROM residents WHERE id IN (?, ?)`).run(testResidentId, testHostId);
});

describe("webhook confirm* idempotency", () => {
  it("confirmPass only flips payment_status once — a retried delivery is a no-op", async () => {
    await confirmPass(testPassRef);
    const afterFirst = (await db.prepare(`SELECT payment_status as paymentStatus FROM passes WHERE ref = ?`).get(testPassRef)) as { paymentStatus: string };
    expect(afterFirst.paymentStatus).toBe("paid");

    // Second delivery of the same event — must not throw, must not change anything further.
    await confirmPass(testPassRef);
    const afterSecond = (await db.prepare(`SELECT payment_status as paymentStatus FROM passes WHERE ref = ?`).get(testPassRef)) as { paymentStatus: string };
    expect(afterSecond.paymentStatus).toBe("paid");
  });

  it("confirmGameJoin only flips the participant to joined once, and never double-counts the notify/threshold side effects", async () => {
    await confirmGameJoin(testGameJoinRef);
    const afterFirst = (await db
      .prepare(`SELECT status, payment_status as paymentStatus FROM game_participants WHERE ref = ?`)
      .get(testGameJoinRef)) as { status: string; paymentStatus: string };
    expect(afterFirst.status).toBe("joined");
    expect(afterFirst.paymentStatus).toBe("paid");

    const { n: joinedCountAfterFirst } = (await db
      .prepare(`SELECT COUNT(*) as n FROM game_participants WHERE game_id = ? AND status = 'joined'`)
      .get(testGameId)) as { n: number };
    expect(joinedCountAfterFirst).toBe(1);

    // Retried delivery — the guarded UPDATE's WHERE payment_status='pending'
    // no longer matches, so this must return early without re-counting or
    // re-notifying.
    await confirmGameJoin(testGameJoinRef);
    const { n: joinedCountAfterSecond } = (await db
      .prepare(`SELECT COUNT(*) as n FROM game_participants WHERE game_id = ? AND status = 'joined'`)
      .get(testGameId)) as { n: number };
    expect(joinedCountAfterSecond).toBe(1);
  });
});

// Platform Pre-Launch Polish — Changeset 3/6. Paid Game joins and Pass
// purchases previously had zero payer-facing confirmation — this proves the
// fix directly: no notification while pending, exactly one after
// confirmation (for the correct resident/game/ref), and no duplicate on a
// replayed webhook.
describe("Changeset 3 — resident confirmation on paid Game join", () => {
  const residentId = `test-res-gameconfirm-${crypto.randomUUID()}`;
  const hostId = `test-host-gameconfirm-${crypto.randomUUID()}`;
  const gameId = `test-game-gameconfirm-${crypto.randomUUID()}`;
  const ref = `test-gj-confirm-${crypto.randomUUID()}`;

  beforeAll(async () => {
    await db.prepare(`INSERT INTO residents (id, email, name) VALUES (?, ?, 'Confirm Resident')`).run(residentId, `${residentId}@example.test`);
    await db.prepare(`INSERT INTO residents (id, email, name) VALUES (?, ?, 'Confirm Host')`).run(hostId, `${hostId}@example.test`);
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    await db
      .prepare(`INSERT INTO games (id, host_resident_id, activity_label, date, time, capacity, status, price_cents) VALUES (?, ?, 'Confirm Badminton', ?, '18:00', 10, 'open', 1500)`)
      .run(gameId, hostId, future);
    await db
      .prepare(`INSERT INTO game_participants (game_id, resident_id, ref, status, payment_status) VALUES (?, ?, ?, 'pending_payment', 'pending')`)
      .run(gameId, residentId, ref);
  });

  afterAll(async () => {
    await db.prepare(`DELETE FROM notifications WHERE resident_id = ?`).run(residentId);
    await db.prepare(`DELETE FROM game_participants WHERE game_id = ?`).run(gameId);
    await db.prepare(`DELETE FROM games WHERE id = ?`).run(gameId);
    await db.prepare(`DELETE FROM residents WHERE id IN (?, ?)`).run(residentId, hostId);
  });

  it("sends no confirmation while the payment is still pending", async () => {
    const { n } = (await db.prepare(`SELECT COUNT(*) as n FROM notifications WHERE resident_id = ? AND ref = ?`).get(residentId, gameId)) as { n: number };
    expect(n).toBe(0);
  });

  it("sends exactly one confirmation, to the right resident, for the right game, once paid", async () => {
    await confirmGameJoin(ref);
    const rows = (await db
      .prepare(`SELECT kind, listing_type as listingType, listing_id as listingId, ref, title FROM notifications WHERE resident_id = ? AND ref = ?`)
      .all(residentId, gameId)) as { kind: string; listingType: string; listingId: string; ref: string; title: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "game", listingType: "game", listingId: gameId, ref: gameId });
    expect(rows[0].title).toContain("Confirm Badminton");
  });

  it("does not send a second confirmation on a replayed webhook", async () => {
    await confirmGameJoin(ref); // already 'paid' from the previous test — idempotency guard no-ops
    const { n } = (await db.prepare(`SELECT COUNT(*) as n FROM notifications WHERE resident_id = ? AND ref = ?`).get(residentId, gameId)) as { n: number };
    expect(n).toBe(1);
  });
});

describe("Changeset 3 — resident confirmation on Pass purchase", () => {
  const residentId = `test-res-passconfirm-${crypto.randomUUID()}`;
  const clubId = `test-club-passconfirm-${crypto.randomUUID()}`;
  const ref = `test-pass-confirm-${crypto.randomUUID()}`;

  beforeAll(async () => {
    await db.prepare(`INSERT INTO residents (id, email, name) VALUES (?, ?, 'Pass Confirm Resident')`).run(residentId, `${residentId}@example.test`);
    await db
      .prepare(`INSERT INTO clubs (id, name, sport, area, county, ages, price, unit, trial, ph, image_url, blurb) VALUES (?, 'Confirm Club', 'Testball', 'Area', 'Dublin', '5-12', 10, 'year', 0, '', '', '')`)
      .run(clubId);
    await db
      .prepare(`INSERT INTO passes (ref, resident_id, listing_type, listing_id, credits_total, purchased_cents, payment_status) VALUES (?, ?, 'club', ?, 10, 9000, 'pending')`)
      .run(ref, residentId, clubId);
  });

  afterAll(async () => {
    await db.prepare(`DELETE FROM notifications WHERE resident_id = ?`).run(residentId);
    await db.prepare(`DELETE FROM passes WHERE ref = ?`).run(ref);
    await db.prepare(`DELETE FROM clubs WHERE id = ?`).run(clubId);
    await db.prepare(`DELETE FROM residents WHERE id = ?`).run(residentId);
  });

  it("sends no confirmation while pending, exactly one once paid, none on replay", async () => {
    const before = (await db.prepare(`SELECT COUNT(*) as n FROM notifications WHERE resident_id = ?`).get(residentId)) as { n: number };
    expect(before.n).toBe(0);

    await confirmPass(ref);
    const after = (await db
      .prepare(`SELECT kind, listing_type as listingType, listing_id as listingId FROM notifications WHERE resident_id = ?`)
      .all(residentId)) as { kind: string; listingType: string; listingId: string }[];
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ listingType: "club", listingId: clubId });

    await confirmPass(ref); // already paid — idempotency guard no-ops
    const final = (await db.prepare(`SELECT COUNT(*) as n FROM notifications WHERE resident_id = ?`).get(residentId)) as { n: number };
    expect(final.n).toBe(1);
  });
});
