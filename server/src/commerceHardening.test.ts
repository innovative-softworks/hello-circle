import crypto from "node:crypto";
import http, { type Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LEGACY_PAYMENT_BACKFILL_BEFORE, backfillLegacyPaymentStatus, db, setSetting } from "./db/index.js";
import { couponAmountError, evaluateCoupon } from "./pricing.js";
import { vendorSuspended } from "./bookingIntegrity.js";
import { couponsRouter } from "./routes/coupons.js";
import { gamesRouter } from "./routes/games.js";
import { passesRouter } from "./routes/passes.js";
import { programsRouter } from "./routes/programs.js";

// Commerce Engine Phase 0.5 — regression coverage for the live money-path
// defects found by the Phase 0 audit (docs/commerce-risk-register.md):
//   R3  paid Games limited to verified hosts (admin-switchable)
//   R4  partner coupon scope + amount validation
//   R5  coupon preview: one generic error + rate limit
//   R8  boot backfill never marks a recent unpaid pending row as paid
//   R10 pass checkout bounds + listing gates
//   R14 no new orders for a suspended vendor's listings
// Identity is stubbed via headers, same approach as games.test.ts.

const run = crypto.randomUUID().slice(0, 8);
const orgA = `org-a-${run}`;
const vendorA = `vendor-a-${run}`;
const vendorA2 = `vendor-a2-${run}`; // second user in org A (invited staff)
const vendorB = `vendor-b-${run}`;
const suspendedVendor = `vendor-s-${run}`;
const programA = `prog-a-${run}`;
const programA2 = `prog-a2-${run}`;
const programB = `prog-b-${run}`;
const programS = `prog-s-${run}`;
const clubS = `club-s-${run}`;
const clubOk = `club-ok-${run}`;
const hostVerified = `host-v-${run}`;
const hostNone = `host-n-${run}`;
const codes = {
  vendorUnscoped: `VUNSCOPED${run}`.toUpperCase(),
  hostUnscoped: `HUNSCOPED${run}`.toUpperCase(),
  negative: `NEG${run}`.toUpperCase(),
  expired: `EXPIRED${run}`.toUpperCase(),
};
const bookingRefs = { recent: `HB-R8-NEW-${run}`, legacy: `HB-R8-OLD-${run}` };

let server: Server;
let baseUrl: string;

async function insertVendor(id: string, status: string, orgId: string | null) {
  await db
    .prepare(`INSERT INTO users (id, email, password_hash, role, status, name, org_id, invited_staff) VALUES (?, ?, 'x', 'vendor', ?, 'Test Vendor', ?, 0)`)
    .run(id, `${id}@example.test`, status, orgId);
}

async function insertProgram(id: string, vendorId: string) {
  await db
    .prepare(`INSERT INTO programs (id, listing_type, listing_id, vendor_id, title, description, status, price_cents) VALUES (?, 'centre', 'none', ?, 'Hardening Program', 'desc', 'published', 0)`)
    .run(id, vendorId);
}

async function insertClub(id: string, vendorId: string) {
  await db
    .prepare(`INSERT INTO clubs (id, name, sport, area, county, ages, price, unit, trial, ph, blurb, vendor_id, status) VALUES (?, 'Hardening Club', 'Testball', 'Area', 'Dublin', '5-12', 10, 'session', 0, '', 'blurb', ?, 'approved')`)
    .run(id, vendorId);
}

beforeAll(async () => {
  await insertVendor(vendorA, "approved", orgA);
  await insertVendor(vendorA2, "approved", orgA);
  await insertVendor(vendorB, "approved", null);
  await insertVendor(suspendedVendor, "suspended", null);
  await insertProgram(programA, vendorA);
  await insertProgram(programA2, vendorA2);
  await insertProgram(programB, vendorB);
  await insertProgram(programS, suspendedVendor);
  await insertClub(clubS, suspendedVendor);
  await insertClub(clubOk, vendorB);
  await db.prepare(`INSERT INTO residents (id, email, name, host_status) VALUES (?, ?, 'Verified Host', 'verified')`).run(hostVerified, `${hostVerified}@example.test`);
  await db.prepare(`INSERT INTO residents (id, email, name) VALUES (?, ?, 'New Resident')`).run(hostNone, `${hostNone}@example.test`);

  await db.prepare(`INSERT INTO coupons (code, kind, amount, created_by_vendor_id) VALUES (?, 'percent', 10, ?)`).run(codes.vendorUnscoped, vendorA);
  await db.prepare(`INSERT INTO coupons (code, kind, amount, created_by_resident_id) VALUES (?, 'percent', 10, ?)`).run(codes.hostUnscoped, hostVerified);
  await db.prepare(`INSERT INTO coupons (code, kind, amount) VALUES (?, 'fixed', -500)`).run(codes.negative);
  await db.prepare(`INSERT INTO coupons (code, kind, amount, expires_at) VALUES (?, 'percent', 10, '2020-01-01 00:00:00')`).run(codes.expired);

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const residentId = req.header("X-Test-Resident-Id");
    if (residentId) (req as any).resident = { id: residentId, email: `${residentId}@example.test` };
    next();
  });
  app.use("/coupons", couponsRouter);
  app.use("/games", gamesRouter);
  app.use("/passes", passesRouter);
  app.use("/programs", programsRouter);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Failed to bind test server");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await db.prepare(`DELETE FROM coupons WHERE code IN (?, ?, ?, ?)`).run(codes.vendorUnscoped, codes.hostUnscoped, codes.negative, codes.expired);
  await db.prepare(`DELETE FROM program_enrollments WHERE program_id IN (?, ?, ?, ?)`).run(programA, programA2, programB, programS);
  await db.prepare(`DELETE FROM programs WHERE id IN (?, ?, ?, ?)`).run(programA, programA2, programB, programS);
  await db.prepare(`DELETE FROM passes WHERE listing_id IN (?, ?)`).run(clubS, clubOk);
  await db.prepare(`DELETE FROM clubs WHERE id IN (?, ?)`).run(clubS, clubOk);
  await db.prepare(`DELETE FROM game_participants WHERE resident_id IN (?, ?)`).run(hostVerified, hostNone);
  await db.prepare(`DELETE FROM games WHERE host_resident_id IN (?, ?)`).run(hostVerified, hostNone);
  await db.prepare(`DELETE FROM residents WHERE id IN (?, ?)`).run(hostVerified, hostNone);
  await db.prepare(`DELETE FROM users WHERE id IN (?, ?, ?, ?)`).run(vendorA, vendorA2, vendorB, suspendedVendor);
  await db.prepare(`DELETE FROM bookings WHERE ref IN (?, ?)`).run(bookingRefs.recent, bookingRefs.legacy);
  await db.prepare(`DELETE FROM app_settings WHERE \`key\` = 'commerce.paid_games_require_verified_host'`).run();
});

const post = (path: string, body: unknown, residentId?: string) =>
  fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Client-Id": `client-${run}`, ...(residentId ? { "X-Test-Resident-Id": residentId } : {}) },
    body: JSON.stringify(body),
  });

describe("R4 — coupon amount validation", () => {
  it("accepts sane percent and fixed amounts", () => {
    expect(couponAmountError("percent", 1)).toBeNull();
    expect(couponAmountError("percent", 100)).toBeNull();
    expect(couponAmountError("fixed", 500)).toBeNull();
  });
  it("rejects zero, negative, fractional, >100% and unknown kinds", () => {
    expect(couponAmountError("percent", 0)).not.toBeNull();
    expect(couponAmountError("fixed", -500)).not.toBeNull();
    expect(couponAmountError("fixed", 2.5)).not.toBeNull();
    expect(couponAmountError("percent", 150)).not.toBeNull();
    expect(couponAmountError("bogus", 10)).not.toBeNull();
    expect(couponAmountError("fixed", "10")).not.toBeNull();
  });
});

describe("R4 — coupon scope at evaluation", () => {
  it("a vendor's unscoped coupon applies to its own listings", async () => {
    const r = await evaluateCoupon(codes.vendorUnscoped, 10_000, { listingType: "program", listingId: programA });
    expect(r).toMatchObject({ valid: true, discountCents: 1000 });
  });
  it("…and to listings of other vendors in the same organisation", async () => {
    const r = await evaluateCoupon(codes.vendorUnscoped, 10_000, { listingType: "program", listingId: programA2 });
    expect(r.valid).toBe(true);
  });
  it("…but never to another vendor's listing", async () => {
    const r = await evaluateCoupon(codes.vendorUnscoped, 10_000, { listingType: "program", listingId: programB });
    expect(r.valid).toBe(false);
  });
  it("…nor to a host's game", async () => {
    const r = await evaluateCoupon(codes.vendorUnscoped, 10_000, { listingType: "game", listingId: "any-game" });
    expect(r.valid).toBe(false);
  });
  it("a host coupon with no game scope never applies", async () => {
    const r = await evaluateCoupon(codes.hostUnscoped, 10_000, { listingType: "program", listingId: programB });
    expect(r.valid).toBe(false);
  });
  it("a stored negative-amount coupon never applies (it would raise the price)", async () => {
    const r = await evaluateCoupon(codes.negative, 10_000, { listingType: "program", listingId: programB });
    expect(r.valid).toBe(false);
  });
});

describe("R5 — coupon preview endpoint", () => {
  it("returns the same message for unknown, expired and malformed codes", async () => {
    const messages = [];
    for (const code of ["NO-SUCH-CODE", codes.expired, codes.negative]) {
      const res = await post("/coupons/validate", { code, subtotalCents: 1000 });
      expect(res.status).toBe(400);
      messages.push((await res.json()).error);
    }
    expect(new Set(messages).size).toBe(1);
  });
  it("checks listing scope when the client sends listing context", async () => {
    const own = await post("/coupons/validate", { code: codes.vendorUnscoped, subtotalCents: 1000, listingType: "program", listingId: programA });
    expect(own.status).toBe(200);
    const other = await post("/coupons/validate", { code: codes.vendorUnscoped, subtotalCents: 1000, listingType: "program", listingId: programB });
    expect(other.status).toBe(400);
  });
  it("rate-limits repeated guesses from one client", async () => {
    let limited = false;
    for (let i = 0; i < 40 && !limited; i++) {
      const res = await post("/coupons/validate", { code: `GUESS${i}`, subtotalCents: 1000 });
      if (res.status === 429) limited = true;
    }
    expect(limited).toBe(true);
  });
});

describe("R14 — suspended vendors take no new orders", () => {
  it("vendorSuspended reflects users.status", async () => {
    expect(await vendorSuspended(suspendedVendor)).toBe(true);
    expect(await vendorSuspended(vendorB)).toBe(false);
    expect(await vendorSuspended(null)).toBe(false);
  });
  it("programme enrolment is refused for a suspended vendor's programme", async () => {
    const res = await post(`/programs/${programS}/enroll`, { participantName: "Test", email: "guest@example.test" });
    expect(res.status).toBe(409);
  });
  it("…but still works for an active vendor's free programme", async () => {
    const res = await post(`/programs/${programB}/enroll`, { participantName: "Test", email: "guest@example.test" });
    expect(res.status).toBeLessThan(300);
  });
});

describe("R10 — pass checkout gates", () => {
  it("rejects an unbounded credit count", async () => {
    const res = await post("/passes/checkout", { listingType: "club", listingId: clubOk, creditsTotal: 1000 }, hostNone);
    expect(res.status).toBe(400);
  });
  it("rejects a fractional credit count", async () => {
    const res = await post("/passes/checkout", { listingType: "club", listingId: clubOk, creditsTotal: 2.5 }, hostNone);
    expect(res.status).toBe(400);
  });
  it("refuses a suspended vendor's club", async () => {
    const res = await post("/passes/checkout", { listingType: "club", listingId: clubS, creditsTotal: 10 }, hostNone);
    expect(res.status).toBe(409);
  });
  it("a valid request reaches checkout (503 here: no payment provider in the test profile)", async () => {
    const res = await post("/passes/checkout", { listingType: "club", listingId: clubOk, creditsTotal: 10 }, hostNone);
    expect(res.status).toBe(503);
    const left = (await db.prepare(`SELECT COUNT(*) as n FROM passes WHERE listing_id = ?`).get(clubOk)) as { n: number };
    expect(Number(left.n)).toBe(0); // the pending row is cleaned up on failure
  });
});

describe("R3 — paid Games need a verified host", () => {
  const game = (priceCents: number) => ({ activityLabel: "Hardening 5-a-side", date: "2099-06-01", time: "18:00", capacity: 6, locationText: "Test pitch", priceCents });

  it("an unverified resident can't create a priced game", async () => {
    const res = await post("/games", game(800), hostNone);
    expect(res.status).toBe(403);
  });
  it("…but can still create a free one", async () => {
    const res = await post("/games", game(0), hostNone);
    expect(res.status).toBeLessThan(300);
  });
  it("a verified host can create a priced game", async () => {
    const res = await post("/games", game(800), hostVerified);
    expect(res.status).toBeLessThan(300);
  });
  it("the admin switch restores the previous open behaviour", async () => {
    await setSetting("commerce.paid_games_require_verified_host", "false");
    try {
      const res = await post("/games", game(800), hostNone);
      expect(res.status).toBeLessThan(300);
    } finally {
      await setSetting("commerce.paid_games_require_verified_host", "true");
    }
  });
});

describe("R8 — boot backfill is bounded to legacy rows", () => {
  const insertPendingBooking = (ref: string, createdAt: string | null) =>
    db
      .prepare(
        `INSERT INTO bookings (ref, client_id, centre_id, room_id, date, time, duration, event_type, guests, name, email, phone, notes, total_cents, payment_status, created_at)
         VALUES (?, 'c', 'centre', 'room', '2099-01-01', '10:00', 1, 'Party', 1, 'N', 'n@example.test', '', '', 1000, 'pending', COALESCE(?, NOW()))`
      )
      .run(ref, createdAt);

  it("leaves a recent unpaid pending booking (crash before session id was saved) pending", async () => {
    await insertPendingBooking(bookingRefs.recent, null);
    await insertPendingBooking(bookingRefs.legacy, "2026-01-01 00:00:00");
    expect(new Date(`${LEGACY_PAYMENT_BACKFILL_BEFORE}Z`) > new Date("2026-01-01T00:00:00Z")).toBe(true);

    await backfillLegacyPaymentStatus();

    const status = async (ref: string) => ((await db.prepare(`SELECT payment_status as s FROM bookings WHERE ref = ?`).get(ref)) as { s: string }).s;
    expect(await status(bookingRefs.recent)).toBe("pending");
    expect(await status(bookingRefs.legacy)).toBe("paid");
  });
});
