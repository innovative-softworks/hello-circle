import crypto from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../db/index.js";
import { stubProvider } from "../payments/provider.js";
import { cancelGameAndNotify } from "./games.js";

// A host (or the venue under it) cancelling a paid event refunds every paid
// participant in full, once — the same rule vendor cancellations already
// follow (providerCancelRefund.ts). Found missing in the R3B audit.

const tag = crypto.randomUUID().slice(0, 8);
const host = `test-gcr-host-${tag}`;
const paid = `test-gcr-paid-${tag}`;
const free = `test-gcr-free-${tag}`;
const gameId = `test-gcr-game-${tag}`;
const session = `cs_gcr_${tag}`;

beforeAll(async () => {
  process.env.QA_E2E_ENABLED = "true";
  process.env.QA_PAYMENT_PROVIDER_STUB = "1";
  await db.prepare(`INSERT INTO games (id, host_resident_id, activity_label, date, time, capacity, status, price_cents) VALUES (?, ?, 'GCR Five-a-side', '2099-09-02', '18:00', 10, 'open', 800)`).run(gameId, host);
  await db
    .prepare(`INSERT INTO game_participants (game_id, resident_id, ref, status, payment_status, stripe_session_id, total_cents) VALUES (?, ?, ?, 'joined', 'paid', ?, 1024)`)
    .run(gameId, paid, `GM-GCR1${tag}`, session);
  await db.prepare(`INSERT INTO game_participants (game_id, resident_id, ref, status, payment_status) VALUES (?, ?, ?, 'joined', 'pending')`).run(gameId, free, `GM-GCR2${tag}`);
  stubProvider.markPaid(session, 1024);
});

afterAll(async () => {
  delete process.env.QA_E2E_ENABLED;
  delete process.env.QA_PAYMENT_PROVIDER_STUB;
  await db.prepare(`DELETE FROM refunds WHERE source_ref IN (?, ?)`).run(`GM-GCR1${tag}`, `GM-GCR2${tag}`);
  await db.prepare(`DELETE FROM audit_log WHERE object_id LIKE ?`).run(`${gameId}%`);
  await db.prepare(`DELETE FROM notifications WHERE listing_id = ?`).run(gameId);
  await db.prepare(`DELETE FROM game_participants WHERE game_id = ?`).run(gameId);
  await db.prepare(`DELETE FROM games WHERE id = ?`).run(gameId);
});

const status = async (resident: string) =>
  ((await db.prepare(`SELECT payment_status as s FROM game_participants WHERE game_id = ? AND resident_id = ?`).get(gameId, resident)) as { s: string }).s;

describe("host cancels a paid event", () => {
  it("refunds the paid participant in full and tells them", async () => {
    expect(await cancelGameAndNotify(gameId, { by: "host", actorId: host })).toBe(true);
    expect(await status(paid)).toBe("refunded");
    const note = (await db.prepare(`SELECT body FROM notifications WHERE listing_id = ? AND resident_id = ?`).get(gameId, paid)) as { body: string };
    expect(note.body).toContain("A full refund of €10.24 has been issued");
    const audit = await db.prepare(`SELECT action FROM audit_log WHERE object_id = ? AND action = 'game_participant.refunded_on_cancel'`).get(`${gameId}:${paid}`);
    expect(audit).toBeTruthy();
  });

  it("leaves an unpaid participant alone", async () => {
    expect(await status(free)).toBe("pending");
  });

  it("a second cancel does nothing (no second refund)", async () => {
    expect(await cancelGameAndNotify(gameId, { by: "host", actorId: host })).toBe(false);
    expect(await status(paid)).toBe("refunded");
  });
});
