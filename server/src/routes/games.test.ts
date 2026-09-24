import crypto from "node:crypto";
import http, { type Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../db/index.js";
import { gamesRouter } from "./games.js";

// Real-DB concurrency test (audit's top-stated testing priority: "booking
// row-lock/double-booking prevention"). This exercises the actual
// gamesRouter join handler — including its `FOR UPDATE` transaction and the
// computeCapacity() check — against a real MySQL connection (the same
// hello_circle_dev the rest of local dev already points at; see
// server/TESTING.md). Auth is stubbed at the identity layer only:
// requireResident just checks `req.resident` truthiness (see
// residents.ts), so a tiny test-only middleware sets it from a header
// instead of standing up real magic-link cookie sessions — the thing under
// test is the capacity race, not the auth flow.

let server: Server;
let baseUrl: string;

const testHostId = `test-host-${crypto.randomUUID()}`;
const testResidentAId = `test-res-a-${crypto.randomUUID()}`;
const testResidentBId = `test-res-b-${crypto.randomUUID()}`;
let testGameId: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const residentId = req.header("X-Test-Resident-Id");
    if (residentId) (req as any).resident = { id: residentId };
    next();
  });
  app.use("/", gamesRouter);

  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Failed to bind test server");
  baseUrl = `http://127.0.0.1:${address.port}`;

  await db.prepare(`INSERT INTO residents (id, email, name) VALUES (?, ?, ?)`).run(testHostId, `${testHostId}@example.test`, "Test Host");
  await db.prepare(`INSERT INTO residents (id, email, name) VALUES (?, ?, ?)`).run(testResidentAId, `${testResidentAId}@example.test`, "Test Resident A");
  await db.prepare(`INSERT INTO residents (id, email, name) VALUES (?, ?, ?)`).run(testResidentBId, `${testResidentBId}@example.test`, "Test Resident B");

  testGameId = `test-game-${crypto.randomUUID()}`;
  const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  await db
    .prepare(`INSERT INTO games (id, host_resident_id, activity_label, date, time, capacity, status) VALUES (?, ?, ?, ?, ?, 1, 'open')`)
    .run(testGameId, testHostId, "Test Concurrency Badminton", future, "18:00");
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  // A successful join also fires a "game full" host notification as a side
  // effect — clean that up too, or it lingers in the notifications table
  // (and the seeded admin account's feed, which mirrors every notification).
  await db.prepare(`DELETE FROM notifications WHERE resident_id = ? OR listing_id = ?`).run(testHostId, testGameId);
  await db.prepare(`DELETE FROM favourites WHERE listing_id = ?`).run(testGameId);
  await db.prepare(`DELETE FROM game_participants WHERE game_id = ?`).run(testGameId);
  await db.prepare(`DELETE FROM games WHERE id = ?`).run(testGameId);
  await db.prepare(`DELETE FROM residents WHERE id IN (?, ?, ?)`).run(testHostId, testResidentAId, testResidentBId);
});

describe("POST /:id/join — capacity race", () => {
  it("lets exactly one of two simultaneous joins succeed on a capacity=1 game", async () => {
    const join = (residentId: string) =>
      fetch(`${baseUrl}/${testGameId}/join`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Test-Resident-Id": residentId },
        body: "{}",
      });

    const [resA, resB] = await Promise.all([join(testResidentAId), join(testResidentBId)]);
    const statuses = [resA.status, resB.status].sort();

    // One succeeds (200, free-join path returns { ok: true }), the other is
    // rejected as full (409) — never both succeeding, never both failing.
    expect(statuses).toEqual([200, 409]);

    const { n } = (await db
      .prepare(`SELECT COUNT(*) as n FROM game_participants WHERE game_id = ? AND status = 'joined'`)
      .get(testGameId)) as { n: number };
    expect(n).toBe(1);
  });
});

// Phase 0 protect: DELETE /:id/join previously hard-deleted a paid
// participant row with zero signal to the host — this confirms the fix
// (notifying the host on a *paid* leave) without changing the underlying
// off-platform-refund convention (no refund is issued, none is expected).
describe("DELETE /:id/join — paid leave notifies the host", () => {
  const paidLeaveGameId = `test-game-paid-leave-${crypto.randomUUID()}`;
  const freeLeaveGameId = `test-game-free-leave-${crypto.randomUUID()}`;

  beforeAll(async () => {
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    await db
      .prepare(`INSERT INTO games (id, host_resident_id, activity_label, date, time, capacity, status) VALUES (?, ?, ?, ?, ?, 10, 'open')`)
      .run(paidLeaveGameId, testHostId, "Test Paid Leave Badminton", future, "18:00");
    await db
      .prepare(`INSERT INTO games (id, host_resident_id, activity_label, date, time, capacity, status) VALUES (?, ?, ?, ?, ?, 10, 'open')`)
      .run(freeLeaveGameId, testHostId, "Test Free Leave Badminton", future, "18:00");
    await db
      .prepare(`INSERT INTO game_participants (game_id, resident_id, ref, status, payment_status) VALUES (?, ?, ?, 'joined', 'paid')`)
      .run(paidLeaveGameId, testResidentAId, `test-ref-a-${crypto.randomUUID()}`);
    await db
      .prepare(`INSERT INTO game_participants (game_id, resident_id, ref, status, payment_status) VALUES (?, ?, ?, 'joined', 'paid')`)
      .run(freeLeaveGameId, testResidentBId, `test-ref-b-${crypto.randomUUID()}`);
  });

  afterAll(async () => {
    await db.prepare(`DELETE FROM notifications WHERE listing_id IN (?, ?)`).run(paidLeaveGameId, freeLeaveGameId);
    await db.prepare(`DELETE FROM game_participants WHERE game_id IN (?, ?)`).run(paidLeaveGameId, freeLeaveGameId);
    await db.prepare(`DELETE FROM games WHERE id IN (?, ?)`).run(paidLeaveGameId, freeLeaveGameId);
  });

  it("notifies the host when a paid participant leaves", async () => {
    const res = await fetch(`${baseUrl}/${paidLeaveGameId}/join`, {
      method: "DELETE",
      headers: { "X-Test-Resident-Id": testResidentAId },
    });
    expect(res.status).toBe(200);

    const { n } = (await db
      .prepare(`SELECT COUNT(*) as n FROM notifications WHERE resident_id = ? AND listing_id = ? AND kind = 'game'`)
      .get(testHostId, paidLeaveGameId)) as { n: number };
    expect(n).toBe(1);

    // Platform Pre-Launch Polish — Changeset 4A: self-leave now soft-cancels
    // (status='cancelled') instead of hard-deleting — a paid transaction
    // must stay auditable/refundable, not disappear. The row survives, with
    // its payment_status untouched (still 'paid', not silently mutated).
    const row = (await db
      .prepare(`SELECT status, payment_status as paymentStatus FROM game_participants WHERE game_id = ? AND resident_id = ?`)
      .get(paidLeaveGameId, testResidentAId)) as { status: string; paymentStatus: string } | undefined;
    expect(row?.status).toBe("cancelled");
    expect(row?.paymentStatus).toBe("paid");
  });
});

// Host Experience Polish — GET /host/insights. Dedicated host/resident/game
// fixtures (not the shared testHostId above) so this suite's totals aren't
// perturbed by, or don't perturb, the capacity-race/paid-leave tests above.
describe("GET /host/insights", () => {
  const insightsHostId = `test-insights-host-${crypto.randomUUID()}`;
  const participantAId = `test-insights-a-${crypto.randomUUID()}`;
  const participantBId = `test-insights-b-${crypto.randomUUID()}`;
  const gameOneId = `test-insights-game-1-${crypto.randomUUID()}`;
  const gameTwoId = `test-insights-game-2-${crypto.randomUUID()}`;

  beforeAll(async () => {
    await db.prepare(`INSERT INTO residents (id, email, name) VALUES (?, ?, 'Insights Host')`).run(insightsHostId, `${insightsHostId}@example.test`);
    await db.prepare(`INSERT INTO residents (id, email, name) VALUES (?, ?, 'Participant A')`).run(participantAId, `${participantAId}@example.test`);
    await db.prepare(`INSERT INTO residents (id, email, name) VALUES (?, ?, 'Participant B')`).run(participantBId, `${participantBId}@example.test`);

    const future1 = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const future2 = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString().slice(0, 10);
    await db.prepare(`INSERT INTO games (id, host_resident_id, activity_label, date, time, capacity, status) VALUES (?, ?, 'Insights Game 1', ?, '18:00', 10, 'open')`).run(gameOneId, insightsHostId, future1);
    await db.prepare(`INSERT INTO games (id, host_resident_id, activity_label, date, time, capacity, status) VALUES (?, ?, 'Insights Game 2', ?, '18:00', 10, 'open')`).run(gameTwoId, insightsHostId, future2);

    // A joined and attended both games (repeat participant); B joined only one and was confirmed not-attended.
    await db.prepare(`INSERT INTO game_participants (game_id, resident_id, ref, status, attended) VALUES (?, ?, ?, 'joined', 1)`).run(gameOneId, participantAId, `test-ref-a1-${crypto.randomUUID()}`);
    await db.prepare(`INSERT INTO game_participants (game_id, resident_id, ref, status, attended) VALUES (?, ?, ?, 'joined', 1)`).run(gameTwoId, participantAId, `test-ref-a2-${crypto.randomUUID()}`);
    await db.prepare(`INSERT INTO game_participants (game_id, resident_id, ref, status, attended) VALUES (?, ?, ?, 'joined', 0)`).run(gameOneId, participantBId, `test-ref-b1-${crypto.randomUUID()}`);
  });

  afterAll(async () => {
    await db.prepare(`DELETE FROM game_participants WHERE game_id IN (?, ?)`).run(gameOneId, gameTwoId);
    await db.prepare(`DELETE FROM games WHERE id IN (?, ?)`).run(gameOneId, gameTwoId);
    await db.prepare(`DELETE FROM residents WHERE id IN (?, ?, ?)`).run(insightsHostId, participantAId, participantBId);
  });

  it("computes real totals, repeat-participant %, and attendance rate from confirmed data only", async () => {
    const res = await fetch(`${baseUrl}/host/insights`, { headers: { "X-Test-Resident-Id": insightsHostId } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      totals: { totalSessions: number; cancelledSessions: number; uniqueParticipants: number };
      repeatParticipantPercent: number | null;
      attendanceRatePercent: number | null;
    };
    expect(body.totals.totalSessions).toBe(2);
    expect(body.totals.cancelledSessions).toBe(0);
    expect(body.totals.uniqueParticipants).toBe(2);
    // A joined both (repeat), B joined only one -> 1 of 2 unique participants is a repeat = 50%.
    expect(body.repeatParticipantPercent).toBe(50);
    // 3 confirmed-attendance rows (2 attended, 1 not) -> 2/3 rounded = 67%.
    expect(body.attendanceRatePercent).toBe(67);
  });

  it("returns null (not a fabricated number) for a host with no confirmed attendance data", async () => {
    const emptyHostId = `test-insights-empty-${crypto.randomUUID()}`;
    await db.prepare(`INSERT INTO residents (id, email, name) VALUES (?, ?, 'Empty Host')`).run(emptyHostId, `${emptyHostId}@example.test`);
    try {
      const res = await fetch(`${baseUrl}/host/insights`, { headers: { "X-Test-Resident-Id": emptyHostId } });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { repeatParticipantPercent: number | null; attendanceRatePercent: number | null; narrative: string | null };
      expect(body.repeatParticipantPercent).toBeNull();
      expect(body.attendanceRatePercent).toBeNull();
      expect(body.narrative).toBeNull();
    } finally {
      await db.prepare(`DELETE FROM residents WHERE id = ?`).run(emptyHostId);
    }
  });
});

// Platform Pre-Launch Polish — Changeset 4/6. Self-leave previously
// hard-deleted the participant row and had no time guard; there was no
// refund path at all. These prove the fixes directly against the real
// routes.
describe("Changeset 4A/4B — cancellation integrity", () => {
  const hostId = `test-cancel-host-${crypto.randomUUID()}`;
  const residentAId = `test-cancel-res-a-${crypto.randomUUID()}`;
  const residentBId = `test-cancel-res-b-${crypto.randomUUID()}`;
  const futureGameId = `test-cancel-future-${crypto.randomUUID()}`;
  const pastGameId = `test-cancel-past-${crypto.randomUUID()}`;

  beforeAll(async () => {
    await db.prepare(`INSERT INTO residents (id, email, name) VALUES (?, ?, 'Cancel Host')`).run(hostId, `${hostId}@example.test`);
    await db.prepare(`INSERT INTO residents (id, email, name) VALUES (?, ?, 'Cancel Resident A')`).run(residentAId, `${residentAId}@example.test`);
    await db.prepare(`INSERT INTO residents (id, email, name) VALUES (?, ?, 'Cancel Resident B')`).run(residentBId, `${residentBId}@example.test`);

    const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    await db.prepare(`INSERT INTO games (id, host_resident_id, activity_label, date, time, capacity, status) VALUES (?, ?, 'Cancel Test Free', ?, '18:00', 10, 'open')`).run(futureGameId, hostId, future);
    await db.prepare(`INSERT INTO game_participants (game_id, resident_id, status, payment_status) VALUES (?, ?, 'joined', 'paid')`).run(futureGameId, residentAId);

    const past = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    await db.prepare(`INSERT INTO games (id, host_resident_id, activity_label, date, time, capacity, status) VALUES (?, ?, 'Cancel Test Past', ?, '18:00', 10, 'open')`).run(pastGameId, hostId, past);
    // Directly inserted with real check-in/attendance data to prove the
    // time-guard-blocked path never touches it — a resident can't normally
    // reach this state (check-in only opens ~1h before a game), but this
    // proves the guard fires before any mutation could occur either way.
    await db
      .prepare(`INSERT INTO game_participants (game_id, resident_id, status, payment_status, checked_in_at, attended) VALUES (?, ?, 'joined', 'paid', NOW(), 1)`)
      .run(pastGameId, residentBId);
  });

  afterAll(async () => {
    await db.prepare(`DELETE FROM notifications WHERE listing_id IN (?, ?)`).run(futureGameId, pastGameId);
    await db.prepare(`DELETE FROM game_participants WHERE game_id IN (?, ?)`).run(futureGameId, pastGameId);
    await db.prepare(`DELETE FROM games WHERE id IN (?, ?)`).run(futureGameId, pastGameId);
    await db.prepare(`DELETE FROM residents WHERE id IN (?, ?, ?)`).run(hostId, residentAId, residentBId);
  });

  it("a future session can be cancelled — the row is soft-cancelled, not deleted", async () => {
    const res = await fetch(`${baseUrl}/${futureGameId}/join`, { method: "DELETE", headers: { "X-Test-Resident-Id": residentAId } });
    expect(res.status).toBe(200);
    const row = (await db.prepare(`SELECT status, payment_status as paymentStatus FROM game_participants WHERE game_id = ? AND resident_id = ?`).get(futureGameId, residentAId)) as
      | { status: string; paymentStatus: string }
      | undefined;
    expect(row?.status).toBe("cancelled");
    expect(row?.paymentStatus).toBe("paid"); // untouched — cancellation never implies refund
  });

  it("a past session's participation cannot be cancelled through the normal self-leave route", async () => {
    const res = await fetch(`${baseUrl}/${pastGameId}/join`, { method: "DELETE", headers: { "X-Test-Resident-Id": residentBId } });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/already taken place/i);

    // Untouched — status, payment, and attendance history all survive exactly as they were.
    const row = (await db
      .prepare(`SELECT status, payment_status as paymentStatus, attended, checked_in_at as checkedInAt FROM game_participants WHERE game_id = ? AND resident_id = ?`)
      .get(pastGameId, residentBId)) as { status: string; paymentStatus: string; attended: number; checkedInAt: string | null } | undefined;
    expect(row?.status).toBe("joined");
    expect(row?.paymentStatus).toBe("paid");
    expect(row?.attended).toBe(1);
    expect(row?.checkedInAt).toBeTruthy();
  });
});

describe("Changeset 4C/4D — Game refund", () => {
  const hostId = `test-refund-host-${crypto.randomUUID()}`;
  const otherHostId = `test-refund-other-host-${crypto.randomUUID()}`;
  const paidResidentId = `test-refund-paid-res-${crypto.randomUUID()}`;
  const freeResidentId = `test-refund-free-res-${crypto.randomUUID()}`;
  const pendingResidentId = `test-refund-pending-res-${crypto.randomUUID()}`;
  const refundedResidentId = `test-refund-refunded-res-${crypto.randomUUID()}`;
  const gameId = `test-refund-game-${crypto.randomUUID()}`;

  beforeAll(async () => {
    for (const [id, name] of [
      [hostId, "Refund Host"],
      [otherHostId, "Other Host"],
      [paidResidentId, "Paid Resident"],
      [freeResidentId, "Free Resident"],
      [pendingResidentId, "Pending Resident"],
      [refundedResidentId, "Refunded Resident"],
    ] as const) {
      await db.prepare(`INSERT INTO residents (id, email, name) VALUES (?, ?, ?)`).run(id, `${id}@example.test`, name);
    }
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    await db
      .prepare(`INSERT INTO games (id, host_resident_id, activity_label, date, time, capacity, status, price_cents) VALUES (?, ?, 'Refund Test Game', ?, '18:00', 10, 'open', 1845)`)
      .run(gameId, hostId, future);

    // A real paid participant with a stripe_session_id — the only shape
    // that's actually eligible for a refund. The session id is fake (no
    // real Stripe call will ever succeed against it in this environment,
    // since STRIPE_SECRET_KEY isn't configured — see the "Stripe not
    // configured" tests below), which is exactly what lets this suite prove
    // "Stripe failure does not mark refunded" without needing real
    // credentials.
    await db
      .prepare(`INSERT INTO game_participants (game_id, resident_id, ref, status, payment_status, stripe_session_id) VALUES (?, ?, ?, 'joined', 'paid', ?)`)
      .run(gameId, paidResidentId, `test-gj-refund-${crypto.randomUUID()}`, `cs_test_fake_${crypto.randomUUID()}`);
    // Free join — no ref, no stripe_session_id (payment_status defaults 'paid', but there's nothing to refund).
    await db.prepare(`INSERT INTO game_participants (game_id, resident_id, status, payment_status) VALUES (?, ?, 'joined', 'paid')`).run(gameId, freeResidentId);
    // Mid-checkout, never completed.
    await db
      .prepare(`INSERT INTO game_participants (game_id, resident_id, ref, status, payment_status) VALUES (?, ?, ?, 'pending_payment', 'pending')`)
      .run(gameId, pendingResidentId, `test-gj-pending-${crypto.randomUUID()}`);
    // Already refunded.
    await db
      .prepare(`INSERT INTO game_participants (game_id, resident_id, ref, status, payment_status, stripe_session_id) VALUES (?, ?, ?, 'cancelled', 'refunded', ?)`)
      .run(gameId, refundedResidentId, `test-gj-refunded-${crypto.randomUUID()}`, `cs_test_fake_${crypto.randomUUID()}`);
  });

  afterAll(async () => {
    await db.prepare(`DELETE FROM audit_log WHERE object_type = 'game_participant' AND object_id LIKE ?`).run(`${gameId}:%`);
    await db.prepare(`DELETE FROM notifications WHERE listing_id = ?`).run(gameId);
    await db.prepare(`DELETE FROM game_participants WHERE game_id = ?`).run(gameId);
    await db.prepare(`DELETE FROM games WHERE id = ?`).run(gameId);
    await db.prepare(`DELETE FROM residents WHERE id IN (?, ?, ?, ?, ?, ?)`).run(hostId, otherHostId, paidResidentId, freeResidentId, pendingResidentId, refundedResidentId);
  });

  it("a different host cannot refund — blocked before Stripe is ever involved", async () => {
    const res = await fetch(`${baseUrl}/${gameId}/participants/${paidResidentId}/refund`, { method: "POST", headers: { "X-Test-Resident-Id": otherHostId } });
    expect(res.status).toBe(403);
    const row = await db.prepare(`SELECT payment_status as paymentStatus FROM game_participants WHERE game_id = ? AND resident_id = ?`).get(gameId, paidResidentId);
    expect((row as { paymentStatus: string }).paymentStatus).toBe("paid");
  });

  it("free participation cannot be refunded — no payment record to refund", async () => {
    const res = await fetch(`${baseUrl}/${gameId}/participants/${freeResidentId}/refund`, { method: "POST", headers: { "X-Test-Resident-Id": hostId } });
    expect(res.status).toBe(400);
  });

  it("still-pending (never completed) payment cannot be refunded", async () => {
    const res = await fetch(`${baseUrl}/${gameId}/participants/${pendingResidentId}/refund`, { method: "POST", headers: { "X-Test-Resident-Id": hostId } });
    expect(res.status).toBe(400);
  });

  it("an already-refunded participant cannot be refunded again", async () => {
    const res = await fetch(`${baseUrl}/${gameId}/participants/${refundedResidentId}/refund`, { method: "POST", headers: { "X-Test-Resident-Id": hostId } });
    expect(res.status).toBe(409);
  });

  it("the owning host CAN reach the refund attempt for a genuinely eligible paid participant — Stripe not being configured in this test environment fails safely without marking it refunded", async () => {
    // This environment has no STRIPE_SECRET_KEY (confirmed by every other
    // Stripe-adjacent test in this suite), so issueStripeRefund() always
    // returns {ok:false}. Reaching that specific failure (502), rather than
    // a 403/400/409, proves every ownership/eligibility gate ahead of it
    // passed correctly for a legitimately-refundable participant — and the
    // failure path is exactly what proves "Stripe failure does not mark
    // refunded" (the actual point of this test).
    const res = await fetch(`${baseUrl}/${gameId}/participants/${paidResidentId}/refund`, { method: "POST", headers: { "X-Test-Resident-Id": hostId } });
    expect(res.status).toBe(502);

    const row = await db.prepare(`SELECT payment_status as paymentStatus FROM game_participants WHERE game_id = ? AND resident_id = ?`).get(gameId, paidResidentId);
    expect((row as { paymentStatus: string }).paymentStatus).toBe("paid");

    const { n } = (await db.prepare(`SELECT COUNT(*) as n FROM notifications WHERE resident_id = ? AND listing_id = ?`).get(paidResidentId, gameId)) as { n: number };
    expect(n).toBe(0); // no refund notification sent for a failed refund
  });
});

// Cloudflare R2 Media System — Changeset 4. games.ts's PUT /:id does a
// full-row overwrite for most columns (not COALESCE) — a real data-wipe
// bug class this codebase has hit before (see mobile app Phase 5's PUT
// routes). image_url is deliberately the one COALESCE'd column in that
// statement specifically so adding cover-photo support here couldn't wipe
// an existing photo on an edit that doesn't touch it — this proves that.
describe("PUT /:id — image_url COALESCE safety", () => {
  const editHostId = `test-edit-host-${crypto.randomUUID()}`;
  let editGameId: string;
  const future = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString().slice(0, 10);

  beforeAll(async () => {
    await db.prepare(`INSERT INTO residents (id, email, name) VALUES (?, ?, ?)`).run(editHostId, `${editHostId}@example.test`, "Edit Host");
    editGameId = `test-edit-game-${crypto.randomUUID()}`;
    await db
      .prepare(`INSERT INTO games (id, host_resident_id, activity_label, location_text, date, time, capacity, image_url) VALUES (?, ?, 'Test Edit Badminton', 'Test Location', ?, '18:00', 4, '/uploads/original.jpg')`)
      .run(editGameId, editHostId, future);
  });

  afterAll(async () => {
    await db.prepare(`DELETE FROM game_participants WHERE game_id = ?`).run(editGameId);
    await db.prepare(`DELETE FROM games WHERE id = ?`).run(editGameId);
    await db.prepare(`DELETE FROM residents WHERE id = ?`).run(editHostId);
  });

  const basePayload = { activityLabel: "Test Edit Badminton", locationText: "Test Location", date: future, time: "18:00", capacity: 4 };

  it("editing unrelated fields WITHOUT imageUrl in the payload leaves the existing cover untouched", async () => {
    const res = await fetch(`${baseUrl}/${editGameId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "X-Test-Resident-Id": editHostId },
      body: JSON.stringify({ ...basePayload, capacity: 5 }),
    });
    expect(res.status).toBe(200);
    const row = (await db.prepare(`SELECT image_url as imageUrl FROM games WHERE id = ?`).get(editGameId)) as { imageUrl: string };
    expect(row.imageUrl).toBe("/uploads/original.jpg");
  });

  it("explicitly sending a new imageUrl replaces it", async () => {
    const res = await fetch(`${baseUrl}/${editGameId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "X-Test-Resident-Id": editHostId },
      body: JSON.stringify({ ...basePayload, imageUrl: "https://media.hellocircle.ie/activities/x/cover/new.jpg" }),
    });
    expect(res.status).toBe(200);
    const row = (await db.prepare(`SELECT image_url as imageUrl FROM games WHERE id = ?`).get(editGameId)) as { imageUrl: string };
    expect(row.imageUrl).toBe("https://media.hellocircle.ie/activities/x/cover/new.jpg");
  });

  it("explicitly sending an empty string clears it", async () => {
    const res = await fetch(`${baseUrl}/${editGameId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "X-Test-Resident-Id": editHostId },
      body: JSON.stringify({ ...basePayload, imageUrl: "" }),
    });
    expect(res.status).toBe(200);
    const row = (await db.prepare(`SELECT image_url as imageUrl FROM games WHERE id = ?`).get(editGameId)) as { imageUrl: string };
    expect(row.imageUrl).toBe("");
  });
});

// Lifecycle-audit privacy fix — GET /:id, GET /:id/ics, GET /, and
// listScheduledActivities (db/queries.ts, exercised indirectly via GET /)
// previously had no `visibility` check/filter at all, so a circle-only or
// invite-only game's full detail was reachable by id regardless of who
// asked. This locks in the fix: unauthorized viewers get a 404 (not 403,
// so existence itself isn't confirmed), the host/an invited resident/a
// joined participant/a linked-circle member still see it, and neither
// restricted game ever appears in the public list.
describe("GET /:id, /:id/ics, / — visibility enforcement", () => {
  const invitedResidentId = `test-invited-${crypto.randomUUID()}`;
  const outsiderResidentId = `test-outsider-${crypto.randomUUID()}`;
  const inviteGameId = `test-game-invite-${crypto.randomUUID()}`;
  const circleGameId = `test-game-circle-${crypto.randomUUID()}`;
  const circleId = `test-circle-${crypto.randomUUID()}`;
  const publicGameId = `test-game-public-vis-${crypto.randomUUID()}`;

  beforeAll(async () => {
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    await db.prepare(`INSERT INTO residents (id, email, name) VALUES (?, ?, ?)`).run(invitedResidentId, `${invitedResidentId}@example.test`, "Invited Resident");
    await db.prepare(`INSERT INTO residents (id, email, name) VALUES (?, ?, ?)`).run(outsiderResidentId, `${outsiderResidentId}@example.test`, "Outsider Resident");

    await db
      .prepare(`INSERT INTO games (id, host_resident_id, activity_label, date, time, capacity, status, visibility) VALUES (?, ?, 'Invite Only Session', ?, '18:00', 10, 'open', 'invite')`)
      .run(inviteGameId, testHostId, future);
    await db
      .prepare(
        `INSERT INTO invitations (id, token, entity_type, entity_id, inviter_resident_id, invitee_resident_id, expires_at) VALUES (?, ?, 'game', ?, ?, ?, DATE_ADD(NOW(), INTERVAL 7 DAY))`
      )
      .run(crypto.randomUUID(), crypto.randomUUID(), inviteGameId, testHostId, invitedResidentId);

    await db
      .prepare(
        `INSERT INTO circles (id, name, activity_label, area, county, about, created_by_resident_id, join_mode, status) VALUES (?, 'Test Circle', 'Testball', 'Area', 'Dublin', 'about', ?, 'invite', 'active')`
      )
      .run(circleId, testHostId);
    await db.prepare(`INSERT INTO circle_members (circle_id, resident_id, role) VALUES (?, ?, 'member')`).run(circleId, invitedResidentId);
    await db
      .prepare(`INSERT INTO games (id, host_resident_id, circle_id, activity_label, date, time, capacity, status, visibility) VALUES (?, ?, ?, 'Circle Only Session', ?, '18:00', 10, 'open', 'circle')`)
      .run(circleGameId, testHostId, circleId, future);

    await db
      .prepare(`INSERT INTO games (id, host_resident_id, activity_label, date, time, capacity, status, visibility) VALUES (?, ?, 'Public Vis Session', ?, '18:00', 10, 'open', 'public')`)
      .run(publicGameId, testHostId, future);
  });

  afterAll(async () => {
    await db.prepare(`DELETE FROM invitations WHERE entity_id = ?`).run(inviteGameId);
    await db.prepare(`DELETE FROM games WHERE id IN (?, ?, ?)`).run(inviteGameId, circleGameId, publicGameId);
    await db.prepare(`DELETE FROM circle_members WHERE circle_id = ?`).run(circleId);
    await db.prepare(`DELETE FROM circles WHERE id = ?`).run(circleId);
    await db.prepare(`DELETE FROM residents WHERE id IN (?, ?)`).run(invitedResidentId, outsiderResidentId);
  });

  it("GET /:id: an unauthenticated request to an invite-only game gets 404, not the real data", async () => {
    const res = await fetch(`${baseUrl}/${inviteGameId}`);
    expect(res.status).toBe(404);
  });

  it("GET /:id: an outsider resident (not host, not invited, not a participant) gets 404 for an invite-only game", async () => {
    const res = await fetch(`${baseUrl}/${inviteGameId}`, { headers: { "X-Test-Resident-Id": outsiderResidentId } });
    expect(res.status).toBe(404);
  });

  it("GET /:id: the actual invited resident sees the real game", async () => {
    const res = await fetch(`${baseUrl}/${inviteGameId}`, { headers: { "X-Test-Resident-Id": invitedResidentId } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.activityLabel).toBe("Invite Only Session");
  });

  it("GET /:id: the host always sees their own restricted game", async () => {
    const res = await fetch(`${baseUrl}/${inviteGameId}`, { headers: { "X-Test-Resident-Id": testHostId } });
    expect(res.status).toBe(200);
  });

  it("GET /:id: an outsider gets 404 for a circle-only game", async () => {
    const res = await fetch(`${baseUrl}/${circleGameId}`, { headers: { "X-Test-Resident-Id": outsiderResidentId } });
    expect(res.status).toBe(404);
  });

  it("GET /:id: a member of the linked circle sees the circle-only game", async () => {
    const res = await fetch(`${baseUrl}/${circleGameId}`, { headers: { "X-Test-Resident-Id": invitedResidentId } });
    expect(res.status).toBe(200);
  });

  it("GET /:id/ics: an unauthenticated request to an invite-only game gets 404, not a downloadable calendar file", async () => {
    const res = await fetch(`${baseUrl}/${inviteGameId}/ics`);
    expect(res.status).toBe(404);
  });

  it("GET /: the public list never includes an invite-only or circle-only game, but does include a public one", async () => {
    const res = await fetch(`${baseUrl}/`);
    const rows = (await res.json()) as { id: string }[];
    const ids = rows.map((r) => r.id);
    expect(ids).not.toContain(inviteGameId);
    expect(ids).not.toContain(circleGameId);
    expect(ids).toContain(publicGameId);
  });
});

// Universal Publishing, Lifecycle & Availability System, Phase D —
// Activities. Exercises the real HTTP layer (create → draft/coming_soon
// gating → GET visibility → join rejection → manual "open now" transition
// → notify-me firing once) against the real DB, same pattern as the rest
// of this file.
describe("Activity lifecycle — draft/coming_soon/active, notify-me, transitions", () => {
  const lifecycleHostId = `test-lc-host-${crypto.randomUUID()}`;
  const subscriberId = `test-lc-subscriber-${crypto.randomUUID()}`;
  const outsiderId = `test-lc-outsider-${crypto.randomUUID()}`;
  const createdGameIds: string[] = [];
  const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  beforeAll(async () => {
    await db.prepare(`INSERT INTO residents (id, email, name) VALUES (?, ?, ?)`).run(lifecycleHostId, `${lifecycleHostId}@example.test`, "Lifecycle Host");
    await db.prepare(`INSERT INTO residents (id, email, name) VALUES (?, ?, ?)`).run(subscriberId, `${subscriberId}@example.test`, "Subscriber");
    await db.prepare(`INSERT INTO residents (id, email, name) VALUES (?, ?, ?)`).run(outsiderId, `${outsiderId}@example.test`, "Outsider");
  });

  afterAll(async () => {
    await db.prepare(`DELETE FROM notify_me_subscriptions WHERE resident_id IN (?, ?)`).run(subscriberId, outsiderId);
    await db.prepare(`DELETE FROM notifications WHERE resident_id = ?`).run(subscriberId);
    if (createdGameIds.length) {
      await db.prepare(`DELETE FROM game_participants WHERE game_id IN (${createdGameIds.map(() => "?").join(",")})`).run(...createdGameIds);
      await db.prepare(`DELETE FROM games WHERE id IN (${createdGameIds.map(() => "?").join(",")})`).run(...createdGameIds);
    }
    await db.prepare(`DELETE FROM residents WHERE id IN (?, ?, ?)`).run(lifecycleHostId, subscriberId, outsiderId);
  });

  const createGame = async (lifecycle: "draft" | "coming_soon" | "active") => {
    const res = await fetch(`${baseUrl}/`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Test-Resident-Id": lifecycleHostId },
      body: JSON.stringify({ activityLabel: `Lifecycle Test (${lifecycle})`, locationText: "Test Venue", date: future, time: "18:00", capacity: 10, lifecycle }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    createdGameIds.push(body.id);
    return body as { id: string; lifecycle: string; effectiveLifecycle: string };
  };

  it("a draft game is invisible to the public list and 404s for a non-host GET /:id", async () => {
    const game = await createGame("draft");
    expect(game.effectiveLifecycle).toBe("draft");

    const listRes = await fetch(`${baseUrl}/`);
    const ids = ((await listRes.json()) as { id: string }[]).map((r) => r.id);
    expect(ids).not.toContain(game.id);

    const outsiderGet = await fetch(`${baseUrl}/${game.id}`, { headers: { "X-Test-Resident-Id": outsiderId } });
    expect(outsiderGet.status).toBe(404);

    const hostGet = await fetch(`${baseUrl}/${game.id}`, { headers: { "X-Test-Resident-Id": lifecycleHostId } });
    expect(hostGet.status).toBe(200);
  });

  it("a coming_soon game is publicly visible and viewable, but rejects a join attempt", async () => {
    const game = await createGame("coming_soon");
    expect(game.effectiveLifecycle).toBe("coming_soon");

    const listRes = await fetch(`${baseUrl}/`);
    const ids = ((await listRes.json()) as { id: string }[]).map((r) => r.id);
    expect(ids).toContain(game.id);

    const outsiderGet = await fetch(`${baseUrl}/${game.id}`, { headers: { "X-Test-Resident-Id": outsiderId } });
    expect(outsiderGet.status).toBe(200);

    const joinRes = await fetch(`${baseUrl}/${game.id}/join`, { method: "POST", headers: { "Content-Type": "application/json", "X-Test-Resident-Id": outsiderId }, body: "{}" });
    expect(joinRes.status).toBe(409);

    const waitlistRes = await fetch(`${baseUrl}/${game.id}/waitlist`, { method: "POST", headers: { "Content-Type": "application/json", "X-Test-Resident-Id": outsiderId }, body: "{}" });
    expect(waitlistRes.status).toBe(409);
  });

  it("rejects an invalid lifecycle transition (active back to draft) and a non-host's attempt", async () => {
    const game = await createGame("active");

    const invalidTransition = await fetch(`${baseUrl}/${game.id}/lifecycle`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Test-Resident-Id": lifecycleHostId },
      body: JSON.stringify({ lifecycle: "draft" }),
    });
    expect(invalidTransition.status).toBe(409);

    const notHost = await fetch(`${baseUrl}/${game.id}/lifecycle`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Test-Resident-Id": outsiderId },
      body: JSON.stringify({ lifecycle: "paused" }),
    });
    expect(notHost.status).toBe(403);
  });

  it("subscribing to notify-me is idempotent, and coming_soon → active fires the notification exactly once", async () => {
    const game = await createGame("coming_soon");

    const firstSub = await fetch(`${baseUrl}/${game.id}/notify-me`, { method: "POST", headers: { "X-Test-Resident-Id": subscriberId } });
    expect(firstSub.status).toBe(201);
    const dupeSub = await fetch(`${baseUrl}/${game.id}/notify-me`, { method: "POST", headers: { "X-Test-Resident-Id": subscriberId } });
    expect(dupeSub.status).toBe(200);
    expect((await dupeSub.json()).alreadySubscribed).toBe(true);

    const { n: subCount } = (await db.prepare(`SELECT COUNT(*) as n FROM notify_me_subscriptions WHERE entity_type = 'game' AND entity_id = ? AND resident_id = ?`).get(game.id, subscriberId)) as {
      n: number;
    };
    expect(subCount).toBe(1);

    const openNow = await fetch(`${baseUrl}/${game.id}/lifecycle`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Test-Resident-Id": lifecycleHostId },
      body: JSON.stringify({ lifecycle: "active" }),
    });
    expect(openNow.status).toBe(200);
    expect((await openNow.json()).effectiveLifecycle).toBe("active");

    const { n: notifCount } = (await db
      .prepare(`SELECT COUNT(*) as n FROM notifications WHERE resident_id = ? AND kind = 'game' AND listing_id = ? AND title = 'Bookings are now open'`)
      .get(subscriberId, game.id)) as { n: number };
    expect(notifCount).toBe(1);

    const { notified_at: notifiedAt } = (await db.prepare(`SELECT notified_at FROM notify_me_subscriptions WHERE entity_type = 'game' AND entity_id = ? AND resident_id = ?`).get(game.id, subscriberId)) as {
      notified_at: string | null;
    };
    expect(notifiedAt).not.toBeNull();
  });

  it("unsubscribe removes the row", async () => {
    const game = await createGame("coming_soon");
    await fetch(`${baseUrl}/${game.id}/notify-me`, { method: "POST", headers: { "X-Test-Resident-Id": subscriberId } });
    const del = await fetch(`${baseUrl}/${game.id}/notify-me`, { method: "DELETE", headers: { "X-Test-Resident-Id": subscriberId } });
    expect(del.status).toBe(200);
    const row = await db.prepare(`SELECT 1 FROM notify_me_subscriptions WHERE entity_type = 'game' AND entity_id = ? AND resident_id = ?`).get(game.id, subscriberId);
    expect(row).toBeUndefined();
  });
});
