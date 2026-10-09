import crypto from "node:crypto";
import http, { type Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, setSetting } from "../db/index.js";
import { hireCost } from "../routes/bookings.js";
import { commerceRouter } from "../routes/commerce.js";
import { experiencesRouter } from "../routes/experiences.js";
import { processProviderOutcome } from "../routes/stripeWebhook.js";
import { RULE_KEYS, TARGET_MODEL_DRAFT } from "./catalog.js";
import { engineLineItems, venueHireListMinor } from "./engine.js";
import { priceBreakdown, type PricingValues } from "./money.js";

// Commerce Engine Phase 2 — quotes, orders, snapshots, shadow pricing and
// the Experiences go-live path, end to end through the real routes. Payment
// confirmation uses the existing network-free QA provider seam
// (qaProviderStubEnabled) — no Stripe, no network.

const v1 = RULE_KEYS.pricing.v1 as unknown as PricingValues;
const target = TARGET_MODEL_DRAFT.payload as unknown as PricingValues;
const run = crypto.randomUUID().slice(0, 8);
const vendorId = `eng-vendor-${run}`;
const cashExp = `eng-cash-${run}`;
const onlineExp = `eng-online-${run}`;
const cashSession = `eng-cash-s-${run}`;
const onlineSession = `eng-online-s-${run}`;
const clientA = crypto.randomUUID();
const clientB = crypto.randomUUID();
const adminId = `eng-admin-${run}`;
const SWITCHES = ["commerce.engine_v2", "commerce.engine_v2_experience", "commerce.shadow_pricing"];
let server: Server;
let baseUrl: string;

async function setSwitches(on: Record<string, boolean>) {
  for (const [k, v] of Object.entries(on)) await setSetting(k, v ? "true" : "false");
}

beforeAll(async () => {
  await db.prepare(`INSERT INTO users (id, email, password_hash, role, status, name) VALUES (?, ?, 'x', 'vendor', 'approved', 'Engine Vendor')`).run(vendorId, `${vendorId}@example.test`);
  const insertExp = (id: string, method: string) =>
    db
      .prepare(
        `INSERT INTO experiences (id, vendor_id, title, blurb, description, fitness_requirements, itinerary, equipment_provided, equipment_required, transport_info, safety_info, weather_policy, eligibility, cancellation_terms, status, price_cents, capacity, payment_method)
         VALUES (?, ?, 'Engine Hike', 'b', 'd', '', '', '', '', '', '', '', '', '', 'approved', 2500, 500, ?)`
      )
      .run(id, vendorId, method);
  await insertExp(cashExp, "cash");
  await insertExp(onlineExp, "online");
  const date = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  await db.prepare(`INSERT INTO experience_sessions (id, experience_id, date, time) VALUES (?, ?, ?, '10:00')`).run(cashSession, cashExp, date);
  await db.prepare(`INSERT INTO experience_sessions (id, experience_id, date, time) VALUES (?, ?, ?, '10:00')`).run(onlineSession, onlineExp, date);

  const app = express();
  app.use(express.json());
  app.use("/experiences", experiencesRouter);
  app.use("/commerce", commerceRouter);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Failed to bind test server");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  const orders = (await db.prepare(`SELECT id FROM commerce_orders WHERE vendor_user_id = ?`).all(vendorId)) as { id: string }[];
  for (const o of orders) {
    await db.prepare(`DELETE FROM pricing_snapshots WHERE order_id = ?`).run(o.id);
    await db.prepare(`DELETE FROM commerce_order_lines WHERE order_id = ?`).run(o.id);
  }
  await db.prepare(`DELETE FROM commerce_orders WHERE vendor_user_id = ?`).run(vendorId);
  await db.prepare(`DELETE FROM commerce_quotes WHERE resource_id IN (?, ?)`).run(cashExp, onlineExp);
  const refs = (await db.prepare(`SELECT ref FROM experience_bookings WHERE experience_id IN (?, ?)`).all(cashExp, onlineExp)) as { ref: string }[];
  for (const r of refs) await db.prepare(`DELETE FROM commerce_shadow_diffs WHERE source_ref = ?`).run(r.ref);
  await db.prepare(`DELETE FROM notifications WHERE listing_id IN (?, ?)`).run(cashExp, onlineExp);
  await db.prepare(`DELETE FROM experience_bookings WHERE experience_id IN (?, ?)`).run(cashExp, onlineExp);
  await db.prepare(`DELETE FROM experience_sessions WHERE experience_id IN (?, ?)`).run(cashExp, onlineExp);
  await db.prepare(`DELETE FROM experiences WHERE id IN (?, ?)`).run(cashExp, onlineExp);
  await db.prepare(`DELETE FROM commerce_rule_versions WHERE created_by = ?`).run(adminId);
  await db.prepare(`DELETE FROM audit_log WHERE actor_user_id = ?`).run(adminId);
  await db.prepare(`DELETE FROM users WHERE id = ?`).run(vendorId);
  await setSwitches({ "commerce.engine_v2": false, "commerce.engine_v2_experience": false, "commerce.shadow_pricing": false });
  delete process.env.QA_E2E_ENABLED;
  delete process.env.QA_PAYMENT_PROVIDER_STUB;
});

const post = (path: string, body: unknown, clientId = clientA) =>
  fetch(`${baseUrl}${path}`, { method: "POST", headers: { "Content-Type": "application/json", "X-Client-Id": clientId }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, body: await r.json() }));
const get = (path: string, clientId = clientA) => fetch(`${baseUrl}${path}`, { headers: { "X-Client-Id": clientId } }).then(async (r) => ({ status: r.status, body: await r.json() }));
const book = (exp: string, session: string, extra: Record<string, unknown> = {}, clientId = clientA) =>
  post(`/experiences/${exp}/sessions/${session}/checkout`, { participantName: "Eng Test", email: "eng@example.test", partySize: 2, ...extra }, clientId);
const quote = (exp: string, session: string, partySize = 2, clientId = clientA) => post(`/experiences/${exp}/sessions/${session}/quote`, { partySize }, clientId);

/** Publishes an experience-scenario pricing override directly (the admin
 * routes are covered by rules.test.ts); returns its id for cleanup. */
async function publishExperienceOverride(payload: Record<string, number | string>) {
  const max = (await db.prepare(`SELECT COALESCE(MAX(version), 0) as v FROM commerce_rule_versions WHERE rule_key = 'pricing' AND scope_type = 'scenario' AND scope_id = 'experience'`).get()) as { v: number };
  const info = await db
    .prepare(
      `INSERT INTO commerce_rule_versions (rule_key, scope_type, scope_id, version, status, effective_from, payload, payload_hash, created_by, change_reason, published_at)
       VALUES ('pricing', 'scenario', 'experience', ?, 'published', NOW(), ?, 'test', ?, 'engine test override', NOW())`
    )
    .run(Number(max.v) + 1, JSON.stringify(payload), adminId);
  return Number(info.lastInsertRowid);
}

describe("unit", () => {
  it("line items always add up to the customer total", () => {
    for (const values of [v1, target, { ...target, customerFeeBps: 300 }])
      for (const list of [0, 1, 999, 2_500, 12_345])
        for (const deposit of [0, 10_000]) {
          const b = priceBreakdown({ listMinor: list, discountMinor: Math.min(300, list), depositMinor: deposit }, values);
          if (b.customerPaidMinor === 0) continue;
          const items = engineLineItems(b, values, { name: "Goods" });
          expect(items.reduce((a, li) => a + li.unitAmountCents, 0)).toBe(b.customerPaidMinor);
        }
  });
  it("under v1 the line items match today's layout (goods, VAT 23%, platform fee)", () => {
    const b = priceBreakdown({ listMinor: 5_000, discountMinor: 0, depositMinor: 0 }, v1);
    expect(engineLineItems(b, v1, { name: "Hike" }).map((l) => [l.name, l.unitAmountCents])).toEqual([["Hike", 5_000], ["VAT (23%)", 1_150], ["Platform fee", 250]]);
  });
  it("under the target model the customer sees one VAT-inclusive line", () => {
    const b = priceBreakdown({ listMinor: 5_000, discountMinor: 0, depositMinor: 0 }, target);
    const items = engineLineItems(b, target, { name: "Hike" });
    expect(items).toHaveLength(1);
    expect(items[0].unitAmountCents).toBe(5_000);
    expect(items[0].description).toContain("incl. VAT 23%");
  });
  it("venue hire under the v1 day-rate rule equals legacy hireCost() for every rate and duration", () => {
    for (let rate = 1; rate <= 300; rate++)
      for (let hours = 1; hours <= 12; hours++) expect(venueHireListMinor(rate, hours, v1 as any)).toBe(hireCost(rate, hours) * 100);
  });
});

describe("shadow pricing (engine off)", () => {
  it("records a matched comparison for a legacy checkout under rule v1", async () => {
    await setSwitches({ "commerce.engine_v2": false, "commerce.shadow_pricing": true });
    const r = await book(cashExp, cashSession);
    expect(r.status).toBe(201);
    await new Promise((resolve) => setTimeout(resolve, 300)); // shadow is fire-and-forget
    const row = (await db.prepare(`SELECT matched, diff_fields as diff FROM commerce_shadow_diffs WHERE source_ref = ?`).get(r.body.ref)) as { matched: number; diff: string };
    expect(row).toMatchObject({ matched: 1, diff: "" });
    const order = await db.prepare(`SELECT id FROM commerce_orders WHERE source_ref = ?`).get(r.body.ref);
    expect(order).toBeUndefined(); // shadow never creates orders
  });
  it("records a mismatch when a published rule would price differently", async () => {
    const id = await publishExperienceOverride({ customerFeeBps: 0 });
    try {
      const r = await book(cashExp, cashSession);
      await new Promise((resolve) => setTimeout(resolve, 300));
      const row = (await db.prepare(`SELECT matched, diff_fields as diff FROM commerce_shadow_diffs WHERE source_ref = ?`).get(r.body.ref)) as { matched: number; diff: string };
      expect(row).toMatchObject({ matched: 0, diff: "total,fee" });
      // …and the customer was still charged the legacy price.
      const booking = (await db.prepare(`SELECT total_cents as t, platform_fee_cents as f FROM experience_bookings WHERE ref = ?`).get(r.body.ref)) as { t: number; f: number };
      expect(booking).toEqual({ t: 6_400, f: 250 });
    } finally {
      await db.prepare(`DELETE FROM commerce_rule_versions WHERE id = ?`).run(id);
    }
  });
  it("legacy quote has no quoteId while the engine is off", async () => {
    const q = await quote(cashExp, cashSession);
    expect(q.status).toBe(200);
    expect(q.body.quoteId).toBeUndefined();
    expect(q.body.totalCents).toBe(6_400);
  });
});

describe("engine on for experiences", () => {
  beforeAll(async () => {
    await setSwitches({ "commerce.engine_v2": true, "commerce.engine_v2_experience": true, "commerce.shadow_pricing": false });
  });

  it("quote → checkout creates an order and an immutable snapshot that matches the charge", async () => {
    const q = await quote(cashExp, cashSession);
    expect(q.status).toBe(200);
    expect(q.body.quoteId).toMatch(/^[0-9a-f-]{36}$/);
    expect(q.body.totalCents).toBe(6_400); // rule v1 = today's price
    const r = await book(cashExp, cashSession, { quoteId: q.body.quoteId });
    expect(r.status).toBe(201);
    const order = (await db.prepare(`SELECT * FROM commerce_orders WHERE source_type = 'experience' AND source_ref = ?`).get(r.body.ref)) as Record<string, any>;
    expect(order).toMatchObject({ order_status: "confirmed", payment_status: "paid", partner_kind: "vendor", partner_id: vendorId, quote_id: q.body.quoteId });
    const snap = (await db.prepare(`SELECT * FROM pricing_snapshots WHERE order_id = ?`).get(order.id)) as Record<string, any>;
    const booking = (await db.prepare(`SELECT total_cents, vat_cents, platform_fee_cents FROM experience_bookings WHERE ref = ?`).get(r.body.ref)) as Record<string, number>;
    expect(Number(snap.customer_paid_minor)).toBe(booking.total_cents);
    expect(Number(snap.vat_minor)).toBe(booking.vat_cents);
    expect(Number(snap.customer_fee_minor)).toBe(booking.platform_fee_cents);
    expect(Number(snap.partner_payout_minor)).toBe(5_000);
    expect(JSON.parse(snap.rule_sources)[0]).toMatchObject({ scopeType: "global", version: 1 });
    const line = (await db.prepare(`SELECT quantity, unit_minor as unit FROM commerce_order_lines WHERE order_id = ?`).get(order.id)) as { quantity: number; unit: number };
    expect({ quantity: line.quantity, unit: Number(line.unit) }).toEqual({ quantity: 2, unit: 2_500 });
  });

  it("a quote can be used once — a duplicate click is refused", async () => {
    const q = await quote(cashExp, cashSession);
    expect((await book(cashExp, cashSession, { quoteId: q.body.quoteId })).status).toBe(201);
    const again = await book(cashExp, cashSession, { quoteId: q.body.quoteId });
    expect(again.status).toBe(409);
    expect(again.body.code).toBe("quote_used");
  });

  it("refuses a quote for a different party size or from another browser", async () => {
    const q = await quote(cashExp, cashSession, 2);
    expect((await book(cashExp, cashSession, { quoteId: q.body.quoteId, partySize: 3 })).body.code).toBe("quote_mismatch");
    expect((await book(cashExp, cashSession, { quoteId: q.body.quoteId }, clientB)).body.code).toBe("quote_mismatch");
  });

  it("refuses an expired quote", async () => {
    const q = await quote(cashExp, cashSession);
    await db.prepare(`UPDATE commerce_quotes SET expires_at = NOW() - INTERVAL 1 MINUTE WHERE id = ?`).run(q.body.quoteId);
    const r = await book(cashExp, cashSession, { quoteId: q.body.quoteId });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe("quote_expired");
  });

  it("refuses to charge a price that changed after the quote; history keeps its price", async () => {
    const before = await book(cashExp, cashSession);
    const q = await quote(cashExp, cashSession);
    const id = await publishExperienceOverride({ customerFeeBps: 0, vatMode: "included_in_price" });
    try {
      const r = await book(cashExp, cashSession, { quoteId: q.body.quoteId });
      expect(r.status).toBe(409);
      expect(r.body.code).toBe("price_changed");
      // No booking, no order was created by the refused attempt.
      const fresh = await quote(cashExp, cashSession);
      expect(fresh.body.totalCents).toBe(5_000);
      expect(fresh.body.vatIncluded).toBe(true);
      const ok = await book(cashExp, cashSession, { quoteId: fresh.body.quoteId });
      expect(ok.status).toBe(201);
      const snap = (await db.prepare(`SELECT s.customer_paid_minor as paid FROM pricing_snapshots s JOIN commerce_orders o ON o.id = s.order_id WHERE o.source_ref = ?`).get(ok.body.ref)) as { paid: number };
      expect(Number(snap.paid)).toBe(5_000);
      // The earlier order's snapshot is untouched by the new rule.
      const old = (await db.prepare(`SELECT s.customer_paid_minor as paid FROM pricing_snapshots s JOIN commerce_orders o ON o.id = s.order_id WHERE o.source_ref = ?`).get(before.body.ref)) as { paid: number };
      expect(Number(old.paid)).toBe(6_400);
    } finally {
      await db.prepare(`DELETE FROM commerce_rule_versions WHERE id = ?`).run(id);
    }
  });

  it("a checkout without a quote is still priced by the engine (older clients)", async () => {
    const r = await book(cashExp, cashSession);
    expect(r.status).toBe(201);
    const order = await db.prepare(`SELECT quote_id FROM commerce_orders WHERE source_ref = ?`).get(r.body.ref);
    expect(order).toMatchObject({ quote_id: null });
  });

  it("cancelling the booking mirrors onto the order", async () => {
    const r = await book(cashExp, cashSession);
    const c = await post(`/experiences/bookings/${r.body.ref}/cancel`, {});
    expect(c.status).toBe(200);
    const order = await db.prepare(`SELECT order_status, fulfilment_status FROM commerce_orders WHERE source_ref = ?`).get(r.body.ref);
    expect(order).toMatchObject({ order_status: "cancelled", fulfilment_status: "cancelled" });
  });

  it("a payment page that can't be created fails the order and frees the quote", async () => {
    const q = await quote(onlineExp, onlineSession);
    const r = await book(onlineExp, onlineSession, { quoteId: q.body.quoteId });
    expect(r.status).toBe(503); // no payment provider in the test profile
    const quoteRow = (await db.prepare(`SELECT used_at, order_id FROM commerce_quotes WHERE id = ?`).get(q.body.quoteId)) as { used_at: string | null; order_id: string | null };
    expect(quoteRow.used_at).toBeNull();
    const order = await db.prepare(`SELECT order_status, payment_status FROM commerce_orders WHERE quote_id = ?`).get(q.body.quoteId);
    expect(order).toMatchObject({ order_status: "failed", payment_status: "failed" });
    // The freed quote can be used for the retry.
    const retry = await book(onlineExp, onlineSession, { quoteId: q.body.quoteId });
    expect(retry.body.code).not.toBe("quote_used");
  });

  it("webhook confirmation moves the order to paid exactly once (provider stub)", async () => {
    process.env.QA_E2E_ENABLED = "true";
    process.env.QA_PAYMENT_PROVIDER_STUB = "1";
    try {
      const q = await quote(onlineExp, onlineSession);
      const r = await book(onlineExp, onlineSession, { quoteId: q.body.quoteId });
      expect(r.status).toBe(201);
      const pending = await db.prepare(`SELECT order_status, payment_status, stripe_session_id FROM commerce_orders WHERE source_ref = ?`).get(r.body.ref);
      expect(pending).toMatchObject({ order_status: "pending_payment", payment_status: "pending", stripe_session_id: `cs_qa_stub_${r.body.ref}` });
      await processProviderOutcome("experience", r.body.ref, "success");
      await processProviderOutcome("experience", r.body.ref, "success"); // duplicate delivery
      const paid = await db.prepare(`SELECT order_status, payment_status FROM commerce_orders WHERE source_ref = ?`).get(r.body.ref);
      expect(paid).toMatchObject({ order_status: "confirmed", payment_status: "paid" });
      const count = (await db.prepare(`SELECT COUNT(*) as n FROM commerce_orders WHERE source_ref = ?`).get(r.body.ref)) as { n: number };
      expect(Number(count.n)).toBe(1);
    } finally {
      delete process.env.QA_E2E_ENABLED;
      delete process.env.QA_PAYMENT_PROVIDER_STUB;
    }
  });

  it("an expired checkout fails the order and releases the seats", async () => {
    process.env.QA_E2E_ENABLED = "true";
    process.env.QA_PAYMENT_PROVIDER_STUB = "1";
    try {
      const r = await book(onlineExp, onlineSession);
      await processProviderOutcome("experience", r.body.ref, "expired");
      const order = await db.prepare(`SELECT order_status, payment_status FROM commerce_orders WHERE source_ref = ?`).get(r.body.ref);
      expect(order).toMatchObject({ order_status: "failed", payment_status: "failed" });
      expect(await db.prepare(`SELECT ref FROM experience_bookings WHERE ref = ?`).get(r.body.ref)).toBeUndefined();
    } finally {
      delete process.env.QA_E2E_ENABLED;
      delete process.env.QA_PAYMENT_PROVIDER_STUB;
    }
  });
});

describe("customer commerce API", () => {
  it("POST /commerce/quotes prices an experience and refuses types not on the engine", async () => {
    const ok = await post("/commerce/quotes", { sourceType: "experience", resourceId: cashExp, sessionId: cashSession, quantity: 1 });
    expect(ok.status).toBe(200);
    expect(ok.body.totalCents).toBe(3_200);
    const no = await post("/commerce/quotes", { sourceType: "booking", resourceId: "x", sessionId: "y" });
    expect(no.status).toBe(409);
    expect(no.body.code).toBe("engine_not_enabled");
  });

  it("GET /commerce/orders/:id shows the owner what they paid — and nothing internal", async () => {
    const r = await book(cashExp, cashSession);
    const order = (await db.prepare(`SELECT id FROM commerce_orders WHERE source_ref = ?`).get(r.body.ref)) as { id: string };
    const mine = await get(`/commerce/orders/${order.id}`);
    expect(mine.status).toBe(200);
    expect(mine.body).toMatchObject({ customerPaidMinor: 6_400, sourceRef: r.body.ref });
    expect(mine.body.partnerPayoutMinor).toBeUndefined();
    expect(mine.body.successFeeMinor).toBeUndefined();
    expect(mine.body.clientId).toBeUndefined();
    expect((await get(`/commerce/orders/${order.id}`, clientB)).status).toBe(404);
  });

  it("with the engine switched off again, checkout is legacy and creates no order", async () => {
    await setSwitches({ "commerce.engine_v2": false });
    const r = await book(cashExp, cashSession);
    expect(r.status).toBe(201);
    expect(await db.prepare(`SELECT id FROM commerce_orders WHERE source_ref = ?`).get(r.body.ref)).toBeUndefined();
  });
});
