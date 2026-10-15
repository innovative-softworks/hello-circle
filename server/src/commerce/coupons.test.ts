import crypto from "node:crypto";
import http, { type Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, setSetting } from "../db/index.js";
import { evaluateCoupon } from "../pricing.js";
import { adminRouter } from "../routes/admin.js";
import { experiencesRouter } from "../routes/experiences.js";
import { processProviderOutcome } from "../routes/stripeWebhook.js";
import { vendorExperiencesRouter } from "../routes/vendorExperiences.js";
import { vendorOperationsRouter } from "../routes/vendorOperations.js";
import { RULE_KEYS } from "./catalog.js";
import { syncOrderFromSource } from "./engine.js";
import { priceBreakdown, type PricingValues } from "./money.js";

// Commerce Engine Phase 3 — coupon funding, limits, the redemption ledger,
// admin audit/archive, partner funding rules, and the R28 session-cancel
// coupon release. Payment outcomes use the network-free QA provider stub.

const run = crypto.randomUUID().slice(0, 8);
const adminId = `cp-admin-${run}`;
const vendorId = `cp-vendor-${run}`;
const cashExp = `cp-cash-${run}`;
const onlineExp = `cp-online-${run}`;
const cashSession = `cp-cash-s-${run}`;
const onlineSession = `cp-online-s-${run}`;
const client = crypto.randomUUID();
const code = (name: string) => `${name}${run}`.toUpperCase();
let server: Server;
let baseUrl: string;

beforeAll(async () => {
  await db.prepare(`INSERT INTO users (id, email, password_hash, role, status, name, admin_role) VALUES (?, ?, 'x', 'admin', 'approved', 'A', 'super')`).run(adminId, `${adminId}@example.test`);
  await db.prepare(`INSERT INTO users (id, email, password_hash, role, status, name) VALUES (?, ?, 'x', 'vendor', 'approved', 'V')`).run(vendorId, `${vendorId}@example.test`);
  const insertExp = (id: string, method: string) =>
    db
      .prepare(
        `INSERT INTO experiences (id, vendor_id, title, blurb, description, fitness_requirements, itinerary, equipment_provided, equipment_required, transport_info, safety_info, weather_policy, eligibility, cancellation_terms, status, price_cents, capacity, payment_method)
         VALUES (?, ?, 'Coupon Hike', 'b', 'd', '', '', '', '', '', '', '', '', '', 'approved', 4000, 500, ?)`
      )
      .run(id, vendorId, method);
  await insertExp(cashExp, "cash");
  await insertExp(onlineExp, "online");
  const date = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  await db.prepare(`INSERT INTO experience_sessions (id, experience_id, date, time) VALUES (?, ?, ?, '10:00')`).run(cashSession, cashExp, date);
  await db.prepare(`INSERT INTO experience_sessions (id, experience_id, date, time) VALUES (?, ?, ?, '10:00')`).run(onlineSession, onlineExp, date);

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const role = req.header("X-Test-Role");
    if (role === "admin") (req as any).user = { id: adminId, role: "admin", status: "approved", adminRole: "super" };
    if (role === "vendor") {
      (req as any).user = { id: vendorId, role: "vendor", status: "approved", invitedStaff: false };
      (req as any).vendorIds = [vendorId];
    }
    next();
  });
  app.use("/admin", adminRouter);
  app.use("/vendor", vendorOperationsRouter);
  app.use("/vendor", vendorExperiencesRouter);
  app.use("/experiences", experiencesRouter);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Failed to bind test server");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await setSetting("commerce.coupons_v2", "false");
  await setSetting("commerce.engine_v2", "false");
  await setSetting("commerce.engine_v2_experience", "false");
  const orders = (await db.prepare(`SELECT id FROM commerce_orders WHERE vendor_user_id = ?`).all(vendorId)) as { id: string }[];
  for (const o of orders) {
    await db.prepare(`DELETE FROM pricing_snapshots WHERE order_id = ?`).run(o.id);
    await db.prepare(`DELETE FROM commerce_order_lines WHERE order_id = ?`).run(o.id);
  }
  await db.prepare(`DELETE FROM commerce_orders WHERE vendor_user_id = ?`).run(vendorId);
  await db.prepare(`DELETE FROM commerce_quotes WHERE resource_id IN (?, ?)`).run(cashExp, onlineExp);
  await db.prepare(`DELETE FROM coupon_redemptions WHERE code LIKE ?`).run(`%${run.toUpperCase()}`);
  await db.prepare(`DELETE FROM coupons WHERE code LIKE ?`).run(`%${run.toUpperCase()}`);
  await db.prepare(`DELETE FROM notifications WHERE listing_id IN (?, ?)`).run(cashExp, onlineExp);
  await db.prepare(`DELETE FROM experience_bookings WHERE experience_id IN (?, ?)`).run(cashExp, onlineExp);
  await db.prepare(`DELETE FROM experience_sessions WHERE experience_id IN (?, ?)`).run(cashExp, onlineExp);
  await db.prepare(`DELETE FROM experiences WHERE id IN (?, ?)`).run(cashExp, onlineExp);
  await db.prepare(`DELETE FROM audit_log WHERE actor_user_id IN (?, ?)`).run(adminId, vendorId);
  await db.prepare(`DELETE FROM users WHERE id IN (?, ?)`).run(adminId, vendorId);
  delete process.env.QA_E2E_ENABLED;
  delete process.env.QA_PAYMENT_PROVIDER_STUB;
});

const call = (method: string, path: string, body?: unknown, role?: "admin" | "vendor") =>
  fetch(`${baseUrl}${path}`, {
    method,
    headers: { "Content-Type": "application/json", "X-Client-Id": client, ...(role ? { "X-Test-Role": role } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).then(async (r) => ({ status: r.status, body: await r.json() }));
const book = (exp: string, session: string, couponCode: string) =>
  call("POST", `/experiences/${exp}/sessions/${session}/checkout`, { participantName: "Coupon Test", email: "c@example.test", partySize: 1, couponCode });
const redemption = (ref: string) => db.prepare(`SELECT status, discount_minor as d, platform_funded_minor as pf FROM coupon_redemptions WHERE source_type = 'experience' AND source_ref = ?`).get(ref) as Promise<{ status: string; d: number; pf: number } | undefined>;
const usedCount = async (c: string) => Number(((await db.prepare(`SELECT used_count as n FROM coupons WHERE code = ?`).get(c)) as { n: number }).n);

describe("evaluateCoupon — limits and funding", () => {
  beforeAll(async () => {
    const ins = (c: string, extra: string, values: unknown[]) =>
      db.prepare(`INSERT INTO coupons (code, kind, amount${extra ? `, ${extra}` : ""}) VALUES (?, 'percent', 50${values.map(() => ", ?").join("")})`).run(c, ...values);
    await ins(code("ARCH"), "archived_at", ["2026-01-01 00:00:00"]);
    await ins(code("LATER"), "starts_at", ["2099-01-01 00:00:00"]);
    await ins(code("MIN"), "min_spend_cents", [5_000]);
    await ins(code("CAP"), "max_discount_cents", [700]);
    await ins(code("SPLIT"), "funding, platform_share_bps", ["split", 2_500]);
    await ins(code("OWNED"), "funding, platform_share_bps, created_by_vendor_id", ["platform", 10_000, vendorId]);
  });

  it("refuses archived and not-yet-started codes", async () => {
    expect((await evaluateCoupon(code("ARCH"), 1_000)).valid).toBe(false);
    expect(await evaluateCoupon(code("LATER"), 1_000)).toMatchObject({ valid: false, error: "That code isn't active yet" });
  });
  it("enforces minimum spend", async () => {
    expect((await evaluateCoupon(code("MIN"), 4_999)).valid).toBe(false);
    expect((await evaluateCoupon(code("MIN"), 5_000)).valid).toBe(true);
  });
  it("caps the discount at the maximum", async () => {
    expect(await evaluateCoupon(code("CAP"), 10_000)).toMatchObject({ valid: true, discountCents: 700 });
  });
  it("reports funding: admin default platform, split share, partner-owned always partner", async () => {
    expect(await evaluateCoupon(code("MIN"), 6_000)).toMatchObject({ funding: "platform", platformShareBps: 10_000 });
    expect(await evaluateCoupon(code("SPLIT"), 1_000)).toMatchObject({ funding: "split", platformShareBps: 2_500 });
    // A partner-created row can never be platform-funded, whatever is stored.
    expect(await evaluateCoupon(code("OWNED"), 1_000, { listingType: "experience", listingId: cashExp })).toMatchObject({ funding: "partner", platformShareBps: 0 });
  });
});

describe("money — platform-funded discounts (prompt §21)", () => {
  const v1 = RULE_KEYS.pricing.v1 as unknown as PricingValues;
  it("the partner is made whole for the HelloCircle-funded part", () => {
    const partnerFunded = priceBreakdown({ listMinor: 10_000, discountMinor: 2_000, depositMinor: 0 }, v1);
    const platformFunded = priceBreakdown({ listMinor: 10_000, discountMinor: 2_000, depositMinor: 0, platformFundedDiscountMinor: 2_000 }, v1);
    expect(partnerFunded.partnerPayoutMinor).toBe(8_000);
    expect(platformFunded.partnerPayoutMinor).toBe(10_000);
    expect(platformFunded.customerPaidMinor).toBe(partnerFunded.customerPaidMinor);
    expect(platformFunded.platformContributionMinor).toBe(partnerFunded.platformContributionMinor - 2_000);
  });
  it("customer_paid + platform_funded = every allocation, for any split", () => {
    for (const funded of [0, 1, 500, 999, 1_000])
      for (const list of [1_000, 3_333, 10_000]) {
        const b = priceBreakdown({ listMinor: list, discountMinor: 1_000, depositMinor: 10_000, platformFundedDiscountMinor: funded }, v1);
        expect(b.customerPaidMinor + b.platformFundedDiscountMinor).toBe(b.partnerPayoutMinor + b.successFeeMinor + b.partnerPaymentCostMinor + b.customerFeeMinor + b.vatMinor + b.depositMinor);
      }
  });
  it("funding can never exceed the discount", () => {
    expect(priceBreakdown({ listMinor: 1_000, discountMinor: 100, depositMinor: 0, platformFundedDiscountMinor: 5_000 }, v1).platformFundedDiscountMinor).toBe(100);
  });
});

describe("admin coupon routes", () => {
  it("require a reason, record it in the audit log, and only allow platform/split funding", async () => {
    expect((await call("POST", "/admin/coupons", { code: code("NOREASON"), kind: "percent", amount: 10 }, "admin")).status).toBe(400);
    expect((await call("POST", "/admin/coupons", { code: code("PARTNER"), kind: "percent", amount: 10, funding: "partner", reason: "should not work" }, "admin")).status).toBe(400);
    expect((await call("POST", "/admin/coupons", { code: code("BADSPLIT"), kind: "percent", amount: 10, funding: "split", platformShareBps: 10_000, reason: "full share is not a split" }, "admin")).status).toBe(400);
    const ok = await call("POST", "/admin/coupons", { code: code("ADMIN"), kind: "percent", amount: 10, funding: "split", platformShareBps: 5_000, perCustomerLimit: 1, reason: "Autumn campaign" }, "admin");
    expect(ok.status).toBe(201);
    const audit = (await db.prepare(`SELECT reason, actor_kind as kind FROM audit_log WHERE action = 'coupon.created' AND object_id = ?`).get(code("ADMIN"))) as { reason: string; kind: string };
    expect(audit).toEqual({ reason: "Autumn campaign", kind: "user" });
  });

  it("pausing needs a reason; removing archives instead of deleting", async () => {
    const row = (await db.prepare(`SELECT id FROM coupons WHERE code = ?`).get(code("ADMIN"))) as { id: number };
    expect((await call("PUT", `/admin/coupons/${row.id}/active`, { active: false }, "admin")).status).toBe(400);
    expect((await call("PUT", `/admin/coupons/${row.id}/active`, { active: false, reason: "pause for review" }, "admin")).status).toBe(200);
    expect((await call("DELETE", `/admin/coupons/${row.id}`, { reason: "campaign over" }, "admin")).status).toBe(200);
    const after = (await db.prepare(`SELECT active, archived_at as archivedAt FROM coupons WHERE id = ?`).get(row.id)) as { active: number; archivedAt: string | null };
    expect(after.active).toBe(0);
    expect(after.archivedAt).not.toBeNull();
    expect((await evaluateCoupon(code("ADMIN"), 5_000)).valid).toBe(false);
    expect((await call("DELETE", `/admin/coupons/${row.id}`, { reason: "archive twice" }, "admin")).status).toBe(404);
  });

  it("vendor coupons are stored partner-funded whatever the request says", async () => {
    const r = await call("POST", "/vendor/coupons", { code: code("VEND"), kind: "percent", amount: 20, funding: "platform", platformShareBps: 10_000, maxDiscountCents: 500 }, "vendor");
    expect(r.status).toBe(201);
    const row = await db.prepare(`SELECT funding, platform_share_bps as share, max_discount_cents as cap FROM coupons WHERE code = ?`).get(code("VEND"));
    expect(row).toEqual({ funding: "partner", share: 0, cap: 500 });
    expect((await call("POST", "/vendor/coupons", { code: code("VBAD"), kind: "percent", amount: 20, perCustomerLimit: 0 }, "vendor")).status).toBe(400);
  });
});

describe("redemption ledger (coupons_v2)", () => {
  beforeAll(async () => {
    await db.prepare(`INSERT INTO coupons (code, kind, amount, funding, platform_share_bps) VALUES (?, 'fixed', 1000, 'split', 3000)`).run(code("LEDGER"));
    await db.prepare(`INSERT INTO coupons (code, kind, amount, per_customer_limit) VALUES (?, 'percent', 10, 1)`).run(code("ONCE"));
  });

  it("with the switch off nothing is recorded and per-customer limits aren't enforced (legacy)", async () => {
    await setSetting("commerce.coupons_v2", "false");
    const a = await book(cashExp, cashSession, code("ONCE"));
    const b = await book(cashExp, cashSession, code("ONCE"));
    expect([a.status, b.status]).toEqual([201, 201]);
    expect(await redemption(a.body.ref)).toBeUndefined();
  });

  it("records a confirmed redemption with the exact funding split for an immediately-paid booking", async () => {
    await setSetting("commerce.coupons_v2", "true");
    const r = await book(cashExp, cashSession, code("LEDGER"));
    expect(r.status).toBe(201);
    expect(await redemption(r.body.ref)).toEqual({ status: "confirmed", d: 1_000, pf: 300 });
  });

  it("enforces uses-per-customer with a clear message", async () => {
    await db.prepare(`UPDATE coupons SET per_customer_limit = 1 WHERE code = ?`).run(code("ONCE"));
    await db.prepare(`DELETE FROM coupon_redemptions WHERE code = ?`).run(code("ONCE"));
    expect((await book(cashExp, cashSession, code("ONCE"))).status).toBe(201);
    const second = await book(cashExp, cashSession, code("ONCE"));
    expect(second.status).toBe(400);
    expect(second.body.error).toBe("You've already used this code");
  });

  it("pending → confirmed on payment, → reversed on refund (provider stub)", async () => {
    process.env.QA_E2E_ENABLED = "true";
    process.env.QA_PAYMENT_PROVIDER_STUB = "1";
    try {
      const r = await book(onlineExp, onlineSession, code("LEDGER"));
      expect(r.status).toBe(201);
      expect((await redemption(r.body.ref))?.status).toBe("reserved");
      await processProviderOutcome("experience", r.body.ref, "success");
      expect((await redemption(r.body.ref))?.status).toBe("confirmed");
      // Refunds go through refundPaidOnce (needs real Stripe); simulate its
      // committed state change and the sync it triggers.
      await db.prepare(`UPDATE experience_bookings SET payment_status = 'refunded' WHERE ref = ?`).run(r.body.ref);
      await syncOrderFromSource("experience", r.body.ref);
      expect((await redemption(r.body.ref))?.status).toBe("reversed");
    } finally {
      delete process.env.QA_E2E_ENABLED;
      delete process.env.QA_PAYMENT_PROVIDER_STUB;
    }
  });

  it("an expired checkout releases both the coupon use and the redemption", async () => {
    process.env.QA_E2E_ENABLED = "true";
    process.env.QA_PAYMENT_PROVIDER_STUB = "1";
    try {
      const before = await usedCount(code("LEDGER"));
      const r = await book(onlineExp, onlineSession, code("LEDGER"));
      expect(await usedCount(code("LEDGER"))).toBe(before + 1);
      await processProviderOutcome("experience", r.body.ref, "expired");
      expect(await usedCount(code("LEDGER"))).toBe(before);
      expect((await redemption(r.body.ref))?.status).toBe("released");
    } finally {
      delete process.env.QA_E2E_ENABLED;
      delete process.env.QA_PAYMENT_PROVIDER_STUB;
    }
  });
});

describe("R28 — cancelling a session hands back reserved coupon uses", () => {
  it("releases the coupon use and the redemption of every pending checkout", async () => {
    process.env.QA_E2E_ENABLED = "true";
    process.env.QA_PAYMENT_PROVIDER_STUB = "1";
    try {
      await db.prepare(`INSERT INTO coupons (code, kind, amount, max_uses) VALUES (?, 'percent', 10, 5)`).run(code("R28"));
      const r = await book(onlineExp, onlineSession, code("R28"));
      expect(r.status).toBe(201);
      expect(await usedCount(code("R28"))).toBe(1);
      const del = await call("DELETE", `/vendor/experiences/${onlineExp}/sessions/${onlineSession}`, undefined, "vendor");
      expect(del.status).toBeLessThan(300);
      expect(await usedCount(code("R28"))).toBe(0);
      expect((await redemption(r.body.ref))?.status).toBe("released");
    } finally {
      delete process.env.QA_E2E_ENABLED;
      delete process.env.QA_PAYMENT_PROVIDER_STUB;
    }
  });
});

describe("engine snapshot records coupon funding", () => {
  it("a HelloCircle-funded coupon keeps the partner whole in the order snapshot", async () => {
    await setSetting("commerce.engine_v2", "true");
    await setSetting("commerce.engine_v2_experience", "true");
    try {
      await db.prepare(`INSERT INTO coupons (code, kind, amount) VALUES (?, 'fixed', 1000)`).run(code("SNAP"));
      const r = await book(cashExp, cashSession, code("SNAP"));
      expect(r.status).toBe(201);
      const snap = (await db
        .prepare(`SELECT s.platform_funded_discount_minor as pf, s.partner_payout_minor as payout, s.customer_paid_minor as paid FROM pricing_snapshots s JOIN commerce_orders o ON o.id = s.order_id WHERE o.source_ref = ?`)
        .get(r.body.ref)) as { pf: number; payout: number; paid: number };
      expect(Number(snap.pf)).toBe(1_000);
      expect(Number(snap.payout)).toBe(4_000); // full list price despite the €10 discount
      expect(Number(snap.paid)).toBe(3_000 + 690 + 150); // (4000-1000) + 23% VAT + 5% fee
    } finally {
      await setSetting("commerce.engine_v2", "false");
      await setSetting("commerce.engine_v2_experience", "false");
    }
  });
});
