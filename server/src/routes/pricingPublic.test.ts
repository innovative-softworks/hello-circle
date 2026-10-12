import crypto from "node:crypto";
import http, { type Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../db/index.js";
import { adminRouter } from "./admin.js";
import { pricingPublicRouter } from "./pricingPublic.js";

// Revenue & Connect Stage 2b — the pe-2 engine reached through its APIs:
// public estimate/plans/compare (no margin warnings, no partner ids) and the
// finance-only admin simulator, which resolves partner-specific terms.

const run = crypto.randomUUID().slice(0, 8);
const finance = `pp-fin-${run}`;
const org = `pp-org-${run}`;
let server: Server;
let baseUrl: string;

beforeAll(async () => {
  await db.prepare(`INSERT INTO users (id, email, password_hash, role, status, name, admin_role) VALUES (?, ?, 'x', 'admin', 'approved', 'F', 'finance')`).run(finance, `${finance}@example.test`);
  await db.prepare(`INSERT INTO organisations (id, name) VALUES (?, 'Pricing Test Org')`).run(org);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const role = req.header("X-Test-Admin-Role");
    if (role) (req as any).user = { id: finance, role: "admin", status: "approved", adminRole: role };
    next();
  });
  app.use("/pricing", pricingPublicRouter);
  app.use("/admin", adminRouter);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Failed to bind test server");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await db.prepare(`DELETE FROM partner_plan_assignments WHERE partner_id = ?`).run(org);
  await db.prepare(`DELETE FROM commerce_rule_versions WHERE created_by = ?`).run(finance);
  await db.prepare(`DELETE FROM audit_log WHERE actor_user_id = ?`).run(finance);
  await db.prepare(`DELETE FROM organisations WHERE id = ?`).run(org);
  await db.prepare(`DELETE FROM users WHERE id = ?`).run(finance);
});

const post = (path: string, body: unknown, adminRole?: string) =>
  fetch(`${baseUrl}${path}`, { method: "POST", headers: { "Content-Type": "application/json", ...(adminRole ? { "X-Test-Admin-Role": adminRole } : {}) }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, body: await r.json() }));

describe("public pricing API", () => {
  it("GET /plans shows the published plan terms and the Pro break-even", async () => {
    const r = await fetch(`${baseUrl}/pricing/plans`).then((x) => x.json());
    expect(r).toMatchObject({ currency: "EUR", vatBps: 2_300, free: { successFeeBps: 900, minFeeMinor: 75 }, pro: { successFeeBps: 700, subscriptionMonthlyMinor: 2_900 }, proBreakEvenMonthlyGmvMinor: 145_000 });
  });

  it("POST /estimate reproduces test vector 1 and never exposes the margin warning", async () => {
    const r = await post("/pricing/estimate", { priceMinor: 10_000, planKey: "free" });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ planKey: "free", customerChargeMinor: 10_000, platformFeeNetMinor: 900, platformFeeVatMinor: 207, partnerPoolMinor: 8_893 });
    expect(r.body.marginWarning).toBeUndefined();
    const t7 = await post("/pricing/estimate", { priceMinor: 10_000, planKey: "free", discounts: [{ funder: "helloCircle", amountMinor: 1_000 }] });
    expect(t7.body.marginWarning).toBeUndefined();
  });

  it("ignores partner ids (partner-agnostic) and validates input", async () => {
    const r = await post("/pricing/estimate", { priceMinor: 10_000, partnerKind: "org", partnerId: org });
    expect(r.body.planKey).toBe("free");
    expect((await post("/pricing/estimate", { priceMinor: 10.5 })).status).toBe(400);
    expect((await post("/pricing/estimate", { priceMinor: 100, planKey: "enterprise" })).status).toBe(400);
  });

  it("POST /compare shows the neutral Free vs Pro comparison", async () => {
    const low = await post("/pricing/compare", { monthlyGmvMinor: 50_000, orders: 20 });
    expect(low.body.cheaperPlan).toBe("free");
    const high = await post("/pricing/compare", { monthlyGmvMinor: 500_000, orders: 100 });
    expect(high.body).toMatchObject({ cheaperPlan: "pro", proMonthlySavingMinor: 500_000 * 0.02 - 2_900 });
    expect(high.body.ruleHashes).toBeUndefined();
  });
});

describe("admin simulator (finance)", () => {
  it("is finance-only and includes the margin warning", async () => {
    expect((await post("/admin/commerce/simulate", { priceMinor: 10_000 }, "support")).status).toBe(403);
    const r = await post("/admin/commerce/simulate", { priceMinor: 10_000, discounts: [{ funder: "helloCircle", amountMinor: 1_000 }] }, "finance");
    expect(r.status).toBe(200);
    expect(r.body.result.marginWarning).toBe(true);
    expect(r.body.rules.map((x: any) => x.key)).toEqual(expect.arrayContaining(["plan_free", "tax_vat", "payment_costs", "settlement", "rewards"]));
  });

  it("resolves the partner's own plan and partner-specific overrides", async () => {
    const base = await post("/admin/commerce/simulate", { priceMinor: 10_000, partnerKind: "org", partnerId: org }, "finance");
    expect(base.body).toMatchObject({ planKey: "free", result: { platformFeeNetMinor: 900 } });
    // Partner moves to Pro → 7%.
    await post(`/admin/commerce/partners/org/${org}/plan`, { planKey: "pro", reason: "simulate pro partner" }, "finance");
    const asPro = await post("/admin/commerce/simulate", { priceMinor: 10_000, partnerKind: "org", partnerId: org }, "finance");
    expect(asPro.body).toMatchObject({ planKey: "pro", result: { platformFeeNetMinor: 700, partnerPoolMinor: 9_139 } });
    // A published partner-specific Pro override (6%) wins for this partner only.
    const d = await post("/admin/commerce/rules/drafts", { key: "plan_pro", scopeType: "partner", scopeId: `org:${org}`, payload: { successFeeBps: 600 }, reason: "negotiated partner rate" }, "finance");
    await post(`/admin/commerce/rules/${d.body.id}/publish`, { reason: "publish negotiated rate" }, "finance");
    const negotiated = await post("/admin/commerce/simulate", { priceMinor: 10_000, partnerKind: "org", partnerId: org }, "finance");
    expect(negotiated.body.result.platformFeeNetMinor).toBe(600);
    const others = await post("/admin/commerce/simulate", { priceMinor: 10_000, planKey: "pro" }, "finance");
    expect(others.body.result.platformFeeNetMinor).toBe(700);
  });

  it("venue + host split through the API reconciles to the pool (test vector 5)", async () => {
    const r = await post("/admin/commerce/simulate", { priceMinor: 10_000, planKey: "free", split: { mode: "fixed_venue", venueMinor: 3_500 } }, "finance");
    expect(r.body.result.allocations.map((a: any) => a.amountMinor)).toEqual([3_500, 5_393]);
  });
});
