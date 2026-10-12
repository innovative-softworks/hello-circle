import crypto from "node:crypto";
import http, { type Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../db/index.js";
import { bankPayoutStatus, payoutsOverview } from "../payments/connect.js";
import { computePricing } from "../pricing.js";
import { residentsRouter } from "./residents.js";
import { passesRouter } from "./passes.js";
import { programsRouter } from "./programs.js";

// Commercial UX R3A:
//   receipts — experiences listed (G1), games show the charged amount (G2),
//     detail = the recorded price (snapshot → stored columns → total only),
//     refunds and credit given back, and nobody can read another resident's
//   payout history — one list from the existing records, scoped to the party
//   pass price — the quote is exactly what checkout stores and charges
//   programme quote — coupon rejections carry the server's reason

let server: Server;
let baseUrl: string;
const tag = crypto.randomUUID().slice(0, 8);
const residentA = `test-res-a-${tag}`;
const residentB = `test-res-b-${tag}`;
const vendorId = `test-vendor-r3a-${tag}`;
const centreId = `test-centre-r3a-${tag}`;
const roomId = `test-room-r3a-${tag}`;
const gameId = `test-game-r3a-${tag}`;
const experienceId = `test-exp-r3a-${tag}`;
const sessionId = `test-exs-r3a-${tag}`;
const clubId = `test-club-r3a-${tag}`;
const programId = `test-prog-r3a-${tag}`;
const orderId = crypto.randomUUID();
const R = {
  bookingA: `HB-R3A1${tag}`,
  bookingB: `HB-R3A2${tag}`,
  cashA: `HB-R3A3${tag}`,
  oldA: `HB-R3A4${tag}`,
  gameA: `GM-R3A${tag}`,
  expA: `EX-R3A${tag}`,
  passA: `PS-R3A${tag}`,
};
const couponCode = `R3AEXP${tag}`.toUpperCase();

const as = (resident: string | null) => (resident ? { "x-test-resident": resident, "Content-Type": "application/json" } : { "Content-Type": "application/json" });
const get = (path: string, resident: string | null = residentA) => fetch(`${baseUrl}${path}`, { headers: as(resident) });

async function booking(ref: string, resident: string, o: { taxable: number; vat: number; fee: number; total: number; session: string | null }) {
  await db
    .prepare(
      `INSERT INTO bookings (ref, client_id, resident_id, centre_id, room_id, date, time, duration, event_type, guests, name, email, phone, notes,
         subtotal_cents, discount_cents, vat_cents, platform_fee_cents, total_cents, payment_status, status, stripe_session_id)
       VALUES (?, 'r3a', ?, ?, ?, '2099-09-01', '10:00', 2, 'Party', 5, 'R3A', 'r3a@example.test', '', '', ?, 0, ?, ?, ?, 'paid', 'confirmed', ?)`
    )
    .run(ref, resident, centreId, roomId, o.taxable, o.vat, o.fee, o.total, o.session);
}

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const id = req.header("x-test-resident");
    if (id) (req as unknown as { resident: object }).resident = { id, email: `${id}@example.test` };
    next();
  });
  app.use("/residents", residentsRouter);
  app.use("/passes", passesRouter);
  app.use("/programs", programsRouter);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Failed to bind test server");
  baseUrl = `http://127.0.0.1:${address.port}`;
  process.env.QA_E2E_ENABLED = "true";
  process.env.QA_PAYMENT_PROVIDER_STUB = "1";

  await db.prepare(`INSERT INTO users (id, email, password_hash, role, status, name) VALUES (?, ?, 'x', 'vendor', 'approved', 'R3A Vendor')`).run(vendorId, `${vendorId}@example.test`);
  await db
    .prepare(`INSERT INTO centres (id, name, area, county, rating, reviews, capacity, from_price, managed_by, ph, image_url, blurb, vendor_id) VALUES (?, 'R3A Centre', 'Area', 'Dublin', 0, 0, 10, 1000, 'Mgr', '', '', '', ?)`)
    .run(centreId, vendorId);
  await db.prepare(`INSERT INTO rooms (id, centre_id, name, cap, rate, \`desc\`, sort_order) VALUES (?, ?, 'Hall', 10, 40, '', 0)`).run(roomId, centreId);

  // Hire 8000 + VAT 1840 + fee 400 + 10000 deposit = 20240, paid online.
  await booking(R.bookingA, residentA, { taxable: 8000, vat: 1840, fee: 400, total: 20240, session: `cs_r3a_${R.bookingA}` });
  await booking(R.bookingB, residentB, { taxable: 8000, vat: 1840, fee: 400, total: 20240, session: `cs_r3a_${R.bookingB}` });
  // Cash: 6000 + 1380 + 300, nothing charged online.
  await booking(R.cashA, residentA, { taxable: 6000, vat: 1380, fee: 300, total: 7680, session: null });
  // Older than the breakdown columns: only the total was recorded.
  await booking(R.oldA, residentA, { taxable: 0, vat: 0, fee: 0, total: 3000, session: `cs_r3a_${R.oldA}` });
  // €5.00 card refund in progress on the first booking.
  await db
    .prepare(`INSERT INTO refunds (source_type, source_ref, idempotency_key, amount_minor, currency, kind, origin, responsible, reason, status) VALUES ('booking', ?, ?, 500, 'EUR', 'partial', 'in_app', 'partner', 'Room swap', 'pending')`)
    .run(R.bookingA, `r3a-${tag}-1`);

  // A €15 game joined with a code: charged €12.
  await db.prepare(`INSERT INTO games (id, host_resident_id, activity_label, date, time, capacity, status, price_cents) VALUES (?, ?, 'R3A Five-a-side', '2099-09-02', '18:00', 10, 'open', 1500)`).run(gameId, residentB);
  await db.prepare(`INSERT INTO game_participants (game_id, resident_id, ref, status, payment_status, coupon_code, total_cents) VALUES (?, ?, ?, 'joined', 'paid', 'TEN', 1200)`).run(gameId, residentA, R.gameA);

  // Engine-priced experience: 2 × €45, WELCOME10 (−€9) and €25 credit, card €56,
  // VAT included; then one place refunded: €28 to the card, €12.50 credit back.
  await db
    .prepare(
      `INSERT INTO experiences (id, vendor_id, title, blurb, description, fitness_requirements, itinerary, equipment_provided, equipment_required, transport_info, safety_info, weather_policy, eligibility, cancellation_terms, price_cents, capacity, county, status)
       VALUES (?, ?, 'R3A Kayaking', '', '', '', '', '', '', '', '', '', '', '', 4500, 8, 'Dublin', 'approved')`
    )
    .run(experienceId, vendorId);
  await db.prepare(`INSERT INTO experience_sessions (id, experience_id, date, time) VALUES (?, ?, '2099-09-03', '09:00')`).run(sessionId, experienceId);
  await db
    .prepare(
      `INSERT INTO experience_bookings (ref, experience_id, session_id, client_id, resident_id, participant_name, email, phone, party_size, subtotal_cents, discount_cents, vat_cents, platform_fee_cents, coupon_code, total_cents, payment_status, stripe_session_id)
       VALUES (?, ?, ?, 'r3a', ?, 'R3A', 'r3a@example.test', '', 2, 5600, 3400, 1047, 0, 'WELCOME10', 5600, 'paid', ?)`
    )
    .run(R.expA, experienceId, sessionId, residentA, `cs_r3a_${R.expA}`);
  await db
    .prepare(
      `INSERT INTO commerce_orders (id, source_type, source_ref, scenario, category, customer_resident_id, partner_kind, partner_id, currency, order_status, payment_status, customer_paid_minor, rule_hash)
       VALUES (?, 'experience', ?, 'experience', 'experience', ?, 'org', ?, 'EUR', 'confirmed', 'paid', 5600, 'r3a')`
    )
    .run(orderId, R.expA, residentA, vendorId);
  await db
    .prepare(
      `INSERT INTO pricing_snapshots (order_id, engine_version, rule_hash, rule_sources, rule_values, currency, list_minor, discount_minor, coupon_code, goods_gross_minor, vat_minor, customer_fee_minor, deposit_minor, customer_paid_minor,
         partner_gross_minor, success_fee_minor, payment_cost_minor, partner_payment_cost_minor, partner_payout_minor, platform_revenue_minor, platform_contribution_minor)
       VALUES (?, 'pe-2', 'r3a', '[]', '{"vatBps":2300}', 'EUR', 9000, 3400, 'WELCOME10', 5600, 1047, 0, 0, 5600, 0, 0, 0, 0, 0, 0, 0)`
    )
    .run(orderId);
  const lot = await db
    .prepare(`INSERT INTO credit_lots (resident_id, kind, amount_minor, remaining_minor, reason, expires_at, created_by) VALUES (?, 'goodwill', 2500, 1250, 'R3A test', '2099-01-01', 'test')`)
    .run(residentA);
  const lotId = Number(lot.lastInsertRowid);
  await db.prepare(`INSERT INTO credit_uses (lot_id, resident_id, source_type, source_ref, amount_minor, status) VALUES (?, ?, 'experience', ?, 1250, 'confirmed')`).run(lotId, residentA, R.expA);
  await db.prepare(`INSERT INTO credit_uses (lot_id, resident_id, source_type, source_ref, amount_minor, status, status_changed_at) VALUES (?, ?, 'experience', ?, 1250, 'reversed', NOW())`).run(lotId, residentA, R.expA);
  await db
    .prepare(`INSERT INTO refunds (source_type, source_ref, idempotency_key, amount_minor, currency, kind, origin, responsible, reason, status) VALUES ('experience', ?, ?, 2800, 'EUR', 'partial', 'in_app', 'partner', 'One place cancelled', 'succeeded')`)
    .run(R.expA, `r3a-${tag}-2`);

  // Club pass checkout that failed.
  await db.prepare(`INSERT INTO clubs (id, name, sport, area, county, ages, price, unit, trial, ph, blurb, vendor_id, status) VALUES (?, 'R3A Club', 'Testball', 'Area', 'Dublin', '5-12', 12, 'session', 0, '', '', ?, 'approved')`).run(clubId, vendorId);
  await db.prepare(`INSERT INTO passes (ref, resident_id, listing_type, listing_id, credits_total, purchased_cents, payment_status) VALUES (?, ?, 'club', ?, 10, 15360, 'failed')`).run(R.passA, residentA, clubId);

  // Programme + an expired code scoped to it.
  await db.prepare(`INSERT INTO programs (id, listing_type, listing_id, vendor_id, title, description, status, price_cents) VALUES (?, 'centre', ?, ?, 'R3A Programme', '', 'published', 6000)`).run(programId, centreId, vendorId);
  await db.prepare(`INSERT INTO coupons (code, kind, amount, expires_at, active) VALUES (?, 'percent', 10, '2020-01-01', 1)`).run(couponCode);
});

afterAll(async () => {
  delete process.env.QA_E2E_ENABLED;
  delete process.env.QA_PAYMENT_PROVIDER_STUB;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await db.prepare(`DELETE FROM refunds WHERE idempotency_key LIKE ?`).run(`r3a-${tag}-%`);
  await db.prepare(`DELETE FROM credit_uses WHERE resident_id = ?`).run(residentA);
  await db.prepare(`DELETE FROM credit_lots WHERE resident_id = ?`).run(residentA);
  await db.prepare(`DELETE FROM pricing_snapshots WHERE order_id = ?`).run(orderId);
  await db.prepare(`DELETE FROM commerce_orders WHERE id = ?`).run(orderId);
  await db.prepare(`DELETE FROM experience_bookings WHERE experience_id = ?`).run(experienceId);
  await db.prepare(`DELETE FROM experience_sessions WHERE experience_id = ?`).run(experienceId);
  await db.prepare(`DELETE FROM experiences WHERE id = ?`).run(experienceId);
  await db.prepare(`DELETE FROM game_participants WHERE game_id = ?`).run(gameId);
  await db.prepare(`DELETE FROM games WHERE id = ?`).run(gameId);
  await db.prepare(`DELETE FROM passes WHERE listing_id = ?`).run(clubId);
  await db.prepare(`DELETE FROM clubs WHERE id = ?`).run(clubId);
  await db.prepare(`DELETE FROM programs WHERE id = ?`).run(programId);
  await db.prepare(`DELETE FROM coupons WHERE code = ?`).run(couponCode);
  await db.prepare(`DELETE FROM bookings WHERE centre_id = ?`).run(centreId);
  await db.prepare(`DELETE FROM rooms WHERE centre_id = ?`).run(centreId);
  await db.prepare(`DELETE FROM centres WHERE id = ?`).run(centreId);
  await db.prepare(`DELETE FROM users WHERE id = ?`).run(vendorId);
});

describe("receipts list", () => {
  it("lists experiences (G1) and the amount a discounted game join was charged (G2)", async () => {
    const res = await get("/residents/me/receipts");
    expect(res.status).toBe(200);
    const rows = (await res.json()) as { ref: string; kind: string; totalCents: number }[];
    expect(rows.find((r) => r.ref === R.expA)).toMatchObject({ kind: "experience", totalCents: 5600 });
    expect(rows.find((r) => r.ref === R.gameA)).toMatchObject({ kind: "game", totalCents: 1200 });
  });

  it("never lists another resident's receipts", async () => {
    const rows = (await (await get("/residents/me/receipts")).json()) as { ref: string }[];
    expect(rows.map((r) => r.ref)).not.toContain(R.bookingB);
    const theirs = (await (await get("/residents/me/receipts", residentB)).json()) as { ref: string }[];
    expect(theirs.map((r) => r.ref)).toEqual([R.bookingB]);
  });

  it("requires a signed-in resident", async () => {
    expect((await get("/residents/me/receipts", null)).status).toBe(401);
    expect((await get(`/residents/me/receipts/${R.bookingA}`, null)).status).toBe(401);
  });
});

describe("receipt detail", () => {
  it("cross-tenant: someone else's ref is the same 404 as an unknown one", async () => {
    const other = await get(`/residents/me/receipts/${R.bookingB}`);
    const unknown = await get(`/residents/me/receipts/HB-NOPE${tag}`);
    expect(other.status).toBe(404);
    expect(unknown.status).toBe(404);
    expect(await other.json()).toEqual(await unknown.json());
    expect((await get(`/residents/me/receipts/${R.bookingB}`, residentB)).status).toBe(200);
  });

  it("stored columns: price, VAT, fee and deposit as recorded; a pending card refund", async () => {
    const d = await (await get(`/residents/me/receipts/${R.bookingA}`)).json();
    expect(d).toMatchObject({ kind: "booking", breakdownSource: "stored", status: "part_refunded", paidOnline: true, isTaxInvoice: false, refundedCardCents: 500, netPaidCents: 19740 });
    expect(d.breakdown).toMatchObject({ subtotalCents: 8000, discountCents: 0, vatCents: 1840, vatIncluded: false, vatLabel: "VAT", platformFeeCents: 400, depositCents: 10000, totalCents: 20240, creditCents: 0 });
    expect(d.refunds).toEqual([expect.objectContaining({ cardCents: 500, creditCents: 0, status: "processing", reason: "Room swap" })]);
  });

  it("frozen snapshot: coupon and credit split, VAT included at the recorded rate, card and credit refunds", async () => {
    const d = await (await get(`/residents/me/receipts/${R.expA}`)).json();
    expect(d).toMatchObject({ kind: "experience", breakdownSource: "snapshot", status: "part_refunded", refundedCardCents: 2800, restoredCreditCents: 1250 });
    expect(d.breakdown).toMatchObject({ subtotalCents: 9000, discountCents: 3400, couponDiscountCents: 900, couponCode: "WELCOME10", creditCents: 2500, vatCents: 1047, vatIncluded: true, vatLabel: "VAT (23%)", totalCents: 5600 });
    // Paid €56 card + €25 credit, back €28 card + €12.50 credit.
    expect(d.netPaidCents).toBe(4050);
    expect(d.refunds.map((r: { cardCents: number; creditCents: number }) => [r.cardCents, r.creditCents]).sort()).toEqual([[0, 1250], [2800, 0]]);
  });

  it("the snapshot wins over the row's own columns (never re-priced)", async () => {
    // The row stores the engine's legacy-shaped columns; the receipt shows the snapshot's list price.
    const d = await (await get(`/residents/me/receipts/${R.expA}`)).json();
    expect(d.breakdown.subtotalCents).toBe(9000);
  });

  it("total only when no breakdown was recorded — no invented deposit", async () => {
    const d = await (await get(`/residents/me/receipts/${R.oldA}`)).json();
    expect(d).toMatchObject({ breakdownSource: "total_only", breakdown: null, totalCents: 3000, status: "paid" });
    const g = await (await get(`/residents/me/receipts/${R.gameA}`)).json();
    expect(g).toMatchObject({ kind: "game", breakdownSource: "total_only", totalCents: 1200 });
  });

  it("cash and failed payments are named, not shown as paid by card", async () => {
    expect(await (await get(`/residents/me/receipts/${R.cashA}`)).json()).toMatchObject({ status: "pay_at_venue", paidOnline: false });
    expect(await (await get(`/residents/me/receipts/${R.passA}`)).json()).toMatchObject({ kind: "pass", status: "failed", netPaidCents: null });
  });
});

describe("payout history (read-only over existing records)", () => {
  const partyA = { partyType: "host" as const, partyId: `test-host-a-${tag}` };
  const partyB = { partyType: "host" as const, partyId: `test-host-b-${tag}` };
  let runId = 0;
  let settlementId = 0;

  beforeAll(async () => {
    const run = await db.prepare(`INSERT INTO settlement_runs (run_key, dry_run, status, started_by, reason) VALUES (?, 0, 'completed', 'test', 'r3a')`).run(`R3A-${tag}`);
    runId = Number(run.lastInsertRowid);
    const s = await db.prepare(`INSERT INTO settlements (run_id, party_type, party_id, currency, net_minor, status) VALUES (?, 'host', ?, 'EUR', 9810, 'transferred')`).run(runId, partyA.partyId);
    settlementId = Number(s.lastInsertRowid);
    await db
      .prepare(`INSERT INTO transfers (settlement_id, idempotency_key, party_type, party_id, destination_account, amount_minor, currency, transfer_group, status, reversed_minor) VALUES (?, ?, 'host', ?, 'acct_test', 9810, 'EUR', 'g', 'partially_reversed', 1200)`)
      .run(settlementId, `r3a-tr-${tag}`, partyA.partyId);
  });
  afterAll(async () => {
    await db.prepare(`DELETE FROM transfers WHERE idempotency_key = ?`).run(`r3a-tr-${tag}`);
    await db.prepare(`DELETE FROM settlements WHERE id = ?`).run(settlementId);
    await db.prepare(`DELETE FROM settlement_runs WHERE id = ?`).run(runId);
  });

  it("lists the party's transfers with settlement ref and recoveries", async () => {
    const o = await payoutsOverview(partyA);
    expect(o.history).toEqual([
      expect.objectContaining({ type: "transfer", amountCents: 9810, status: "partly_reversed", settlementRef: `R3A-${tag}`, recoveredCents: 1200, bookings: 0 }),
    ]);
    // The original two lists are unchanged (backward compatible).
    expect(o.transfers).toHaveLength(1);
    expect(o.bankPayouts).toEqual([]);
    expect(typeof o.minimumPayoutCents === "number" || o.minimumPayoutCents === null).toBe(true);
  });

  it("cross-tenant: another party sees none of it", async () => {
    const o = await payoutsOverview(partyB);
    expect(o.history).toEqual([]);
    expect(o.transfers).toEqual([]);
  });

  it("maps Stripe payout statuses to the partner vocabulary", () => {
    expect(bankPayoutStatus("paid")).toBe("paid");
    expect(bankPayoutStatus("in_transit")).toBe("in_transit");
    expect(bankPayoutStatus("pending")).toBe("in_transit");
    expect(bankPayoutStatus("failed")).toBe("failed");
    expect(bankPayoutStatus("canceled")).toBe("failed");
  });

  it("creates nothing", async () => {
    const before = await db.prepare(`SELECT (SELECT COUNT(*) FROM transfers) t, (SELECT COUNT(*) FROM settlements) s, (SELECT COUNT(*) FROM connected_payouts) p`).get();
    await payoutsOverview(partyA);
    await payoutsOverview(partyB);
    expect(await db.prepare(`SELECT (SELECT COUNT(*) FROM transfers) t, (SELECT COUNT(*) FROM settlements) s, (SELECT COUNT(*) FROM connected_payouts) p`).get()).toEqual(before);
  });
});

describe("pass price is server-authoritative", () => {
  it("quotes exactly what checkout stores and sends to the provider", async () => {
    const q = await (await get(`/passes/quote?listingId=${clubId}&creditsTotal=10`, null)).json();
    // €12 × 10 under today's unchanged pricing (pricing.ts), never a client estimate.
    expect(q).toMatchObject(computePricing(12000, 0, 0, null));
    const res = await fetch(`${baseUrl}/passes/checkout`, { method: "POST", headers: as(residentA), body: JSON.stringify({ listingType: "club", listingId: clubId, creditsTotal: 10 }) });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { ref: string; totalEuro: number };
    expect(body.totalEuro * 100).toBe(q.totalCents);
    const stored = (await db.prepare(`SELECT purchased_cents as c FROM passes WHERE ref = ?`).get(body.ref)) as { c: number };
    expect(Number(stored.c)).toBe(q.totalCents);
  });

  it("refuses the same things checkout refuses", async () => {
    expect((await get(`/passes/quote?listingId=${clubId}&creditsTotal=0`, null)).status).toBe(400);
    expect((await get(`/passes/quote?listingId=${clubId}&creditsTotal=51`, null)).status).toBe(400);
    expect((await get(`/passes/quote?listingId=nope-${tag}&creditsTotal=10`, null)).status).toBe(404);
  });
});

describe("programme coupons", () => {
  it("quote with a code: the server's reason, not just a message", async () => {
    const expired = await get(`/programs/${programId}/quote?couponCode=${couponCode}`, null);
    expect(expired.status).toBe(400);
    expect(await expired.json()).toMatchObject({ code: "coupon_expired" });
    const unknown = await get(`/programs/${programId}/quote?couponCode=NOPE${tag}`, null);
    expect(await unknown.json()).toMatchObject({ code: "coupon_invalid" });
  });

  it("enrolment refuses the same code with the same reason", async () => {
    const res = await fetch(`${baseUrl}/programs/${programId}/enroll`, {
      method: "POST",
      headers: { ...as(null), "X-Client-Id": `r3a-${tag}` },
      body: JSON.stringify({ participantName: "R3A", email: "r3a@example.test", couponCode, acceptedTerms: true }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "coupon_expired" });
  });
});
