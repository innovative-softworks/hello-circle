import crypto from "node:crypto";
import http, { type Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, getSetting, setSetting } from "../db/index.js";
import { DEPOSIT_CENTS } from "../routes/bookings.js";
import { createCheckoutSession } from "../checkoutService.js";
import { PLATFORM_FEE_RATE, VAT_RATE } from "../pricing.js";
import { hostPlanRouter } from "../routes/partnerPlan.js";
import { passesRouter } from "../routes/passes.js";
import { FEE_MODEL_NOTICE, pricingPublicRouter } from "../routes/pricingPublic.js";
import { RULE_KEYS, switchChangeProblem } from "./catalog.js";
import { FEE_MODEL_SWITCHES, PAID_CHECKOUT_CLOSED_ERROR, PARTNER_FEE_MODEL_STATUS, paidCheckoutOpen, partnerFeeModelApproved, proPurchaseAllowed } from "./releaseGates.js";
import { redeemForProMonth } from "./rewards.js";
import { startProCheckout } from "./subscriptions.js";

// Commercial claims safety audit — server-side gates, not hidden buttons:
//   paid customer checkout fails closed in production
//   the public pricing API marks its (proposed) figures as not in force
//   Pro can't be bought, redeemed or switched on while the fee model is unapproved
//   and none of this changed a pricing, VAT, fee or plan figure.

let server: Server;
let baseUrl: string;
const tag = crypto.randomUUID().slice(0, 8);
const resident = `test-rg-res-${tag}`;
const vendorId = `test-rg-vendor-${tag}`;
const clubId = `test-rg-club-${tag}`;

function withEnv<T>(vars: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
  const saved = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(vars)) v === undefined ? delete process.env[k] : (process.env[k] = v);
  return fn().finally(() => {
    for (const [k, v] of Object.entries(saved)) v === undefined ? delete process.env[k] : (process.env[k] = v);
  });
}

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { resident: object }).resident = { id: resident, email: `${resident}@example.test` };
    next();
  });
  app.use("/pricing", pricingPublicRouter);
  app.use("/passes", passesRouter);
  app.use("/host/plan", hostPlanRouter);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Failed to bind test server");
  baseUrl = `http://127.0.0.1:${address.port}`;
  process.env.QA_E2E_ENABLED = "true";
  process.env.QA_PAYMENT_PROVIDER_STUB = "1";
  await db.prepare(`INSERT INTO users (id, email, password_hash, role, status, name) VALUES (?, ?, 'x', 'vendor', 'approved', 'RG Vendor')`).run(vendorId, `${vendorId}@example.test`);
  await db.prepare(`INSERT INTO clubs (id, name, sport, area, county, ages, price, unit, trial, ph, blurb, vendor_id, status) VALUES (?, 'RG Club', 'Testball', 'Area', 'Dublin', '5-12', 12, 'session', 0, '', '', ?, 'approved')`).run(clubId, vendorId);
});

afterAll(async () => {
  delete process.env.QA_E2E_ENABLED;
  delete process.env.QA_PAYMENT_PROVIDER_STUB;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await db.prepare(`DELETE FROM passes WHERE listing_id = ?`).run(clubId);
  await db.prepare(`DELETE FROM clubs WHERE id = ?`).run(clubId);
  await db.prepare(`DELETE FROM users WHERE id = ?`).run(vendorId);
});

describe("paid customer checkout gate (server-side)", () => {
  it("fails closed in production, opens only when explicitly configured", () => {
    expect(paidCheckoutOpen({ NODE_ENV: "production" })).toBe(false);
    expect(paidCheckoutOpen({ NODE_ENV: "production", PAID_CHECKOUT: "open" })).toBe(true);
    expect(paidCheckoutOpen({ NODE_ENV: "production", PAID_CHECKOUT: "OPEN " })).toBe(true);
    expect(paidCheckoutOpen({ NODE_ENV: "production", PAID_CHECKOUT: "yes" })).toBe(false); // only the exact word opens it
    expect(paidCheckoutOpen({ NODE_ENV: "development", PAID_CHECKOUT: "closed" })).toBe(false);
    expect(paidCheckoutOpen({ NODE_ENV: "test" })).toBe(true); // isolated QA/test profiles keep exercising paid flows
  });

  it("the shared checkout service refuses before any provider call", async () => {
    const r = await withEnv({ PAID_CHECKOUT: "closed" }, () => createCheckoutSession({ ref: `RG-${tag}`, type: "pass", customerEmail: "x@example.test", lineItems: [{ name: "x", unitAmountCents: 100 }] }));
    expect(r).toEqual({ ok: false, status: 503, error: PAID_CHECKOUT_CLOSED_ERROR });
  });

  it("a real paid route (pass checkout) is refused and leaves no pending row", async () => {
    const res = await withEnv({ NODE_ENV: "production", PAID_CHECKOUT: undefined }, () =>
      fetch(`${baseUrl}/passes/checkout`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ listingType: "club", listingId: clubId, creditsTotal: 10 }) })
    );
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe(PAID_CHECKOUT_CLOSED_ERROR);
    expect(await db.prepare(`SELECT COUNT(*) as n FROM passes WHERE listing_id = ?`).get(clubId)).toEqual({ n: 0 });
  });

  it("read-only quotes stay available (they charge nothing)", async () => {
    const res = await withEnv({ NODE_ENV: "production", PAID_CHECKOUT: undefined }, () => fetch(`${baseUrl}/passes/quote?listingId=${clubId}&creditsTotal=10`));
    expect(res.status).toBe(200);
  });
});

describe("public pricing API: proposed figures are labelled, compatible and unchanged", () => {
  it("GET /plans keeps every field and figure, and adds the not-in-force status", async () => {
    const r = await fetch(`${baseUrl}/pricing/plans`);
    expect(r.headers.get("x-hellocircle-fee-model")).toBe("proposed");
    expect(await r.json()).toMatchObject({
      currency: "EUR",
      vatBps: 2_300,
      free: { successFeeBps: 900, minFeeMinor: 75 },
      pro: { successFeeBps: 700, subscriptionMonthlyMinor: 2_900 },
      proBreakEvenMonthlyGmvMinor: 145_000,
      status: "proposed",
      inForce: false,
      notice: FEE_MODEL_NOTICE,
    });
  });

  it("POST /estimate and /compare carry the same status", async () => {
    const post = (p: string, body: unknown) => fetch(`${baseUrl}/pricing${p}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const e = await post("/estimate", { priceMinor: 10_000, planKey: "free" });
    expect(e.headers.get("x-hellocircle-fee-model")).toBe("proposed");
    expect(await e.json()).toMatchObject({ partnerPoolMinor: 8_893, status: "proposed", inForce: false });
    const c = await post("/compare", { monthlyGmvMinor: 150_000, orders: 40 });
    expect(await c.json()).toMatchObject({ status: "proposed", inForce: false });
  });

  it("the notice never claims the fees are charged", () => {
    expect(FEE_MODEL_NOTICE).toMatch(/not in force/);
    expect(FEE_MODEL_NOTICE).toMatch(/doesn't charge these fees today/);
  });
});

describe("Pro can't be bought, redeemed or switched on while the fee model is unapproved", () => {
  it("the model is a proposal; Pro purchase is allowed only in the isolated test profile", () => {
    expect(PARTNER_FEE_MODEL_STATUS).toBe("proposed");
    expect(partnerFeeModelApproved()).toBe(false);
    expect(proPurchaseAllowed({ NODE_ENV: "production" })).toBe(false);
    expect(proPurchaseAllowed({ NODE_ENV: "development" })).toBe(false);
    expect(proPurchaseAllowed({ NODE_ENV: "test" })).toBe(true);
  });

  it("an admin can't switch Pro or partner rewards on (even with prerequisites on)", () => {
    const all = Object.fromEntries(["commerce.settlement_ledger", "commerce.connect_v1", "commerce.engine_v2", "commerce.engine_v2_experience"].map((k) => [k, true]));
    for (const key of FEE_MODEL_SWITCHES) expect(switchChangeProblem(key, true, all), key).toMatch(/fee model is approved/);
    // Turning them off is always allowed.
    for (const key of FEE_MODEL_SWITCHES) expect(switchChangeProblem(key, false, all), key).toBeNull();
  });

  it("the Pro switch is off by default", async () => {
    expect(RULE_KEYS && (await getSetting("commerce.pro_subscriptions", "false"))).toBe("false");
  });

  it("even if the switch were on, purchase and redemption are refused outside the test profile", async () => {
    const before = await getSetting("commerce.pro_subscriptions", "false");
    const beforeRewards = await getSetting("commerce.circle_credits", "false");
    await setSetting("commerce.pro_subscriptions", "true");
    await setSetting("commerce.circle_credits", "true");
    try {
      await withEnv({ NODE_ENV: "development" }, async () => {
        await expect(startProCheckout({ kind: "host", id: resident }, { email: "x@example.test", actorId: resident, returnPath: "/manage", termsAccepted: true })).rejects.toThrow(/aren't available yet/);
        await expect(redeemForProMonth({ kind: "host", id: resident }, resident)).rejects.toThrow(/aren't available yet/);
        const res = await fetch(`${baseUrl}/host/plan/pro/checkout`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ termsAccepted: true }) });
        expect(res.status).toBe(409);
      });
    } finally {
      await setSetting("commerce.pro_subscriptions", before);
      await setSetting("commerce.circle_credits", beforeRewards);
    }
  });
});

describe("no pricing, VAT, fee, deposit or plan figure changed", () => {
  it("legacy checkout pricing", () => {
    expect([VAT_RATE, PLATFORM_FEE_RATE, DEPOSIT_CENTS]).toEqual([0.23, 0.05, 10_000]);
  });
  it("seeded rule defaults (v1)", () => {
    expect(RULE_KEYS.pricing.v1).toMatchObject({ customerFeeBps: 500, successFeeBps: 0, vatBps: 2300, vatMode: "added_on_top", venueDepositMinor: 10_000 });
    expect(RULE_KEYS.plan_free.v1).toMatchObject({ successFeeBps: 900, minFeeMinor: 75, subscriptionMonthlyMinor: 0 });
    expect(RULE_KEYS.plan_pro.v1).toMatchObject({ successFeeBps: 700, minFeeMinor: 50, subscriptionMonthlyMinor: 2_900 });
    expect(RULE_KEYS.tax_vat.v1).toMatchObject({ vatBps: 2_300 });
    expect(RULE_KEYS.settlement.v1).toMatchObject({ reviewHours: 48, minPayoutMinor: 2_500 });
  });
});
