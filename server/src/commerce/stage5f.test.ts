import crypto from "node:crypto";
import http, { type Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, setSetting } from "../db/index.js";
import { stubProvider } from "../payments/provider.js";
import { adminRouter } from "../routes/admin.js";
import { residentCreditsRouter, vendorPlanRouter } from "../routes/partnerPlan.js";
import { evaluateCoupon } from "../pricing.js";
import { canonicalHash, switchChangeProblem } from "./catalog.js";
import { grantCredit, residentCreditHistory, restoreCreditForRefund } from "./credits.js";
import { postGroup } from "./ledger.js";
import { assignPlan } from "./plans.js";
import { adjustPoints, rewardHistory, rewardSummary } from "./rewards.js";
import { applySubscriptionCheckout, applySubscriptionDeleted, applySubscriptionUpdate, graceDays } from "./subscriptions.js";

// Revenue & Connect Stage 5f — partner plan states, safe Pro flow, owner-only
// plan changes, reward summary/history/adjustments, customer credit grants,
// history and proportional restoration, coupon rejection reasons, switch
// dependencies. Stub provider only (deterministic).

const run = crypto.randomUUID().slice(0, 8);
const org = `f5-org-${run}`;
const org2 = `f5-org2-${run}`;
const owner = `f5-owner-${run}`;
const fin = `f5-fin-${run}`;
const analyst = `f5-ro-${run}`;
const adminId = `f5-admin-${run}`;
const resident = `f5-res-${run}`;
const SWITCHES = ["commerce.pro_subscriptions", "commerce.circle_credits", "commerce.customer_credits", "commerce.settlement_ledger", "commerce.engine_v2", "commerce.engine_v2_experience"];
const partner = { kind: "org" as const, id: org };
let server: Server;
let baseUrl: string;
const ruleIds: number[] = [];

beforeAll(async () => {
  await db.prepare(`INSERT INTO organisations (id, name) VALUES (?, 'Plan Org'), (?, 'Plan Org 2')`).run(org, org2);
  for (const [id, staff, role] of [[owner, 0, null], [fin, 1, "finance"], [analyst, 1, "read_only_analyst"]] as const) {
    await db.prepare(`INSERT INTO users (id, email, password_hash, role, status, name, org_id) VALUES (?, ?, 'x', 'vendor', 'approved', 'V', ?)`).run(id, `${id}@example.test`, org);
    void staff;
    void role;
  }
  await db.prepare(`INSERT INTO users (id, email, password_hash, role, status, name, admin_role) VALUES (?, ?, 'x', 'admin', 'approved', 'A', 'finance')`).run(adminId, `${adminId}@example.test`);
  await db.prepare(`INSERT INTO residents (id, email, name) VALUES (?, ?, 'Wallet Resident')`).run(resident, `${resident}@example.test`);
  for (const k of SWITCHES) await setSetting(k, "true");
  process.env.QA_E2E_ENABLED = "true";
  process.env.QA_PAYMENT_PROVIDER_STUB = "1";
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const role = req.header("X-Test-Role");
    if (role === "owner") (req as any).user = { id: owner, email: `${owner}@example.test`, role: "vendor", status: "approved", orgId: org, invitedStaff: false };
    if (role === "finance-staff") (req as any).user = { id: fin, email: `${fin}@example.test`, role: "vendor", status: "approved", orgId: org, invitedStaff: true, platformRole: "finance" };
    if (role === "analyst-staff") (req as any).user = { id: analyst, email: `${analyst}@example.test`, role: "vendor", status: "approved", orgId: org, invitedStaff: true, platformRole: "read_only_analyst" };
    if (role === "admin") (req as any).user = { id: adminId, email: `${adminId}@example.test`, role: "admin", status: "approved", adminRole: "finance" };
    if (req.header("X-Test-Resident")) (req as any).resident = { id: resident, email: `${resident}@example.test`, name: "Wallet Resident" };
    next();
  });
  app.use("/vendor/plan", vendorPlanRouter);
  app.use("/credits", residentCreditsRouter);
  app.use("/admin", adminRouter);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("bind");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  for (const k of SWITCHES) await setSetting(k, "false");
  for (const id of ruleIds) await db.prepare(`DELETE FROM commerce_rule_versions WHERE id = ?`).run(id);
  for (const p of [org, org2]) {
    await db.prepare(`DELETE FROM partner_subscriptions WHERE party_id = ?`).run(p);
    await db.prepare(`DELETE FROM partner_plan_assignments WHERE partner_kind = 'org' AND partner_id = ?`).run(p);
    await db.prepare(`DELETE FROM reward_redemptions WHERE party_id = ?`).run(p);
    await db.prepare(`DELETE FROM reward_adjustments WHERE party_id = ?`).run(p);
    await db.prepare(`DELETE FROM reward_lots WHERE party_id = ?`).run(p);
    await db.prepare(`DELETE FROM reward_debts WHERE party_id = ?`).run(p);
  }
  const groups = (await db.prepare(`SELECT DISTINCT group_id as id FROM ledger_entries WHERE party_id = ?`).all(org)) as { id: string }[];
  for (const g of groups) {
    await db.prepare(`DELETE FROM ledger_entries WHERE group_id = ?`).run(g.id);
    await db.prepare(`DELETE FROM ledger_entry_groups WHERE id = ?`).run(g.id);
  }
  await db.prepare(`DELETE FROM payment_records WHERE source_ref LIKE ?`).run(`F5-${run}%`);
  await db.prepare(`DELETE FROM credit_uses WHERE resident_id = ?`).run(resident);
  await db.prepare(`DELETE FROM credit_lots WHERE resident_id = ?`).run(resident);
  await db.prepare(`DELETE FROM coupons WHERE code LIKE ?`).run(`F5${run.toUpperCase()}%`);
  await db.prepare(`DELETE FROM audit_log WHERE actor_user_id IN (?, ?, ?, ?)`).run(owner, fin, analyst, adminId);
  await db.prepare(`DELETE FROM users WHERE id IN (?, ?, ?, ?)`).run(owner, fin, analyst, adminId);
  await db.prepare(`DELETE FROM residents WHERE id = ?`).run(resident);
  await db.prepare(`DELETE FROM organisations WHERE id IN (?, ?)`).run(org, org2);
  delete process.env.QA_E2E_ENABLED;
  delete process.env.QA_PAYMENT_PROVIDER_STUB;
});

const call = (method: string, path: string, body: unknown, headers: Record<string, string>) =>
  fetch(`${baseUrl}${path}`, { method, headers: { "Content-Type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) }).then(async (r) => ({ status: r.status, body: await r.json() }));
const asOwner = { "X-Test-Role": "owner" };
const plan = async () => (await call("GET", "/vendor/plan", undefined, asOwner)).body;

/** A published partner-scoped tax rule for org2 (test only; removed after). */
async function partnerTax(vatMode: "exempt" | "reverse_charge") {
  const payload = { vatBps: 2300, vatMode, feeDisplay: "exclusive_of_vat" };
  const v = (await db.prepare(`SELECT COALESCE(MAX(version), 0) + 1 as v FROM commerce_rule_versions WHERE rule_key = 'tax_vat' AND scope_type = 'partner' AND scope_id = ?`).get(`org:${org2}`)) as { v: number };
  const r = await db
    .prepare(
      `INSERT INTO commerce_rule_versions (rule_key, scope_type, scope_id, version, status, effective_from, payload, payload_hash, created_by, approved_by, published_by, published_at, change_reason)
       VALUES ('tax_vat', 'partner', ?, ?, 'published', DATE_SUB(NOW(), INTERVAL 1 MINUTE), ?, ?, 'test', 'test', 'test', NOW(), 'stage 5f test')`
    )
    .run(`org:${org2}`, Number(v.v), JSON.stringify(payload), canonicalHash(payload));
  ruleIds.push(Number(r.lastInsertRowid));
}

describe("plan states and the Pro flow", () => {
  it("free: dynamic price and tax label, owner can manage, test mode flagged", async () => {
    const p = await plan();
    expect(p.state).toBe("free");
    expect([p.price.netMinor, p.price.vatMinor, p.price.grossMinor, p.price.taxLabel]).toEqual([2900, 667, 3567, "VAT 23%"]);
    expect([p.canManage, p.testMode, p.graceDaysPolicy]).toEqual([true, true, await graceDays()]);
    expect(p.rewards.redemption).toBe("not_enough");
  });

  it("exempt and reverse-charge partners get their own tax row", async () => {
    const { proPrice } = await import("./subscriptions.js");
    await partnerTax("exempt");
    expect(await proPrice({ kind: "org", id: org2 })).toMatchObject({ vatMinor: 0, grossMinor: 2900, taxLabel: "VAT exempt" });
    await new Promise((r) => setTimeout(r, 1100));
    await partnerTax("reverse_charge");
    expect(await proPrice({ kind: "org", id: org2 })).toMatchObject({ vatMinor: 0, grossMinor: 2900, taxLabel: "Reverse charge — no VAT charged" });
  });

  it("requires the terms; a second click reuses the same checkout (never two sessions)", async () => {
    expect((await call("POST", "/vendor/plan/pro/checkout", {}, asOwner)).status).toBe(400);
    const a = await call("POST", "/vendor/plan/pro/checkout", { termsAccepted: true }, asOwner);
    const b = await call("POST", "/vendor/plan/pro/checkout", { termsAccepted: true }, asOwner);
    expect(a.status).toBe(200);
    expect([b.body.id, b.body.reused]).toEqual([a.body.id, true]);
    expect(((await db.prepare(`SELECT COUNT(*) as n FROM partner_subscriptions WHERE party_id = ? AND status = 'checkout'`).get(org)) as { n: number }).n).toBe(1);
  });

  it("processing while Stripe reports the checkout complete but no webhook yet; then active; a second completion is cancelled", async () => {
    const row = (await db.prepare(`SELECT checkout_session_id as sid FROM partner_subscriptions WHERE party_id = ? AND status = 'checkout'`).get(org)) as { sid: string };
    stubProvider.checkoutStatuses.set(row.sid, "complete");
    expect((await plan()).state).toBe("processing");
    expect((await call("GET", "/vendor/plan/checkout-status", undefined, asOwner)).body.state).toBe("processing");
    expect((await call("POST", "/vendor/plan/pro/checkout", { termsAccepted: true }, asOwner)).status, "no new checkout while confirming").toBe(409);
    await applySubscriptionCheckout({ id: row.sid, subscription: `sub_f5_${run}`, payment_status: "paid" });
    expect((await plan()).state).toBe("paid_active");
    // A second paid checkout (e.g. another tab) is cancelled on arrival.
    const dupSession = `cs_f5dup_${run}`;
    await db.prepare(`INSERT INTO partner_subscriptions (party_type, party_id, checkout_session_id, status, gross_minor, net_minor, vat_minor, vat_bps, vat_mode, created_by) VALUES ('org', ?, ?, 'checkout', 3567, 2900, 667, 2300, 'standard', ?)`).run(org, dupSession, owner);
    await applySubscriptionCheckout({ id: dupSession, subscription: `sub_f5dup_${run}`, payment_status: "paid" });
    expect(((await db.prepare(`SELECT status FROM partner_subscriptions WHERE checkout_session_id = ?`).get(dupSession)) as { status: string }).status).toBe("duplicate");
    expect(stubProvider.calls.some((c) => c.method === "cancelSubscription" && (c.args as any).subscriptionId === `sub_f5dup_${run}` && (c.args as any).atPeriodEnd === false)).toBe(true);
  });

  it("cancel → cancelling → keep; payment failed → grace from the rule (frozen), billing portal", async () => {
    expect((await call("POST", "/vendor/plan/pro/cancel", {}, asOwner)).status).toBe(200);
    expect((await plan()).state).toBe("cancelling");
    expect((await call("POST", "/vendor/plan/pro/resume", {}, asOwner)).status).toBe(200);
    expect((await plan()).state).toBe("paid_active");
    await applySubscriptionUpdate({ id: `sub_f5_${run}`, status: "past_due" });
    const p = await plan();
    expect([p.state, p.subscription.graceDays, p.subscription.graceDaysRemaining]).toEqual(["payment_failed", await graceDays(), await graceDays()]);
    expect(p.rewards.redemption).toBe("paid_active");
    const portal = await call("POST", "/vendor/plan/billing-portal", {}, asOwner);
    expect(portal.body.url).toMatch(/^https:\/\/billing\.stub\.invalid\/portal\/sub_f5_/);
    await applySubscriptionDeleted({ id: `sub_f5_${run}` });
    expect((await plan()).state).toBe("free");
  });

  it("only the owner changes the plan; finance staff view only; other staff can't see it", async () => {
    const asFin = { "X-Test-Role": "finance-staff" };
    const view = await call("GET", "/vendor/plan", undefined, asFin);
    expect([view.status, view.body.canManage]).toEqual([200, false]);
    for (const path of ["/vendor/plan/pro/checkout", "/vendor/plan/pro/cancel", "/vendor/plan/pro/resume", "/vendor/plan/billing-portal", "/vendor/plan/rewards/redeem"]) {
      expect((await call("POST", path, { termsAccepted: true }, asFin)).status, path).toBe(403);
    }
    expect((await call("GET", "/vendor/plan", undefined, { "X-Test-Role": "analyst-staff" })).status).toBe(403);
  });

  it("reward-funded Pro: redeem, then paid Pro bills from the end of the reward month", async () => {
    await db.prepare(`INSERT INTO reward_lots (party_type, party_id, source_ref, points_earned, points_remaining, expires_at) VALUES ('org', ?, 'f5-test', 10000, 10000, DATE_ADD(NOW(), INTERVAL 1 YEAR))`).run(org);
    expect((await plan()).rewards.redemption).toBe("available");
    const red = await call("POST", "/vendor/plan/rewards/redeem", {}, asOwner);
    expect(red.status).toBe(200);
    const p = await plan();
    expect([p.state, p.plan.rewardFunded]).toEqual(["reward_active", true]);
    const co = await call("POST", "/vendor/plan/pro/checkout", { termsAccepted: true }, asOwner);
    expect(co.status).toBe(200);
    const sent = stubProvider.calls.filter((c) => c.method === "createSubscriptionCheckout").at(-1)!.args as { trialEndSec: number | null };
    expect(Math.abs(sent.trialEndSec! * 1000 - new Date(p.plan.effectiveTo).getTime())).toBeLessThan(2000);
    expect(co.body.billingStartsAt).toBeTruthy();
  });

  it("pro_granted (a promotion that isn't a reward month) and unavailable (both switches off)", async () => {
    await assignPlan({ partner: { kind: "org", id: org2 }, planKey: "pro", source: "promotion", sourceRef: "campaign:f5", effectiveFrom: new Date(), effectiveTo: new Date(Date.now() + 30 * 864e5), reason: "test promotion", actorId: adminId });
    const { subscriptionOverview } = await import("./subscriptions.js");
    expect((await subscriptionOverview({ kind: "org", id: org2 })).state).toBe("pro_granted");
    await setSetting("commerce.pro_subscriptions", "false");
    await setSetting("commerce.circle_credits", "false");
    expect((await subscriptionOverview({ kind: "org", id: org2 })).state).toBe("unavailable");
    await setSetting("commerce.pro_subscriptions", "true");
    await setSetting("commerce.circle_credits", "true");
  });
});

describe("reward points summary, history, adjustments", () => {
  it("pending points on unsettled bookings; adjustments are idempotent; negative adjustments become debt; history labels every kind", async () => {
    const ref = `F5-${run}-1`;
    await db.prepare(`INSERT INTO payment_records (source_type, source_ref, provider, amount_minor, currency, status) VALUES ('experience', ?, 'stub', 4600, 'EUR', 'paid')`).run(ref);
    await db.transaction((tx) =>
      postGroup(tx, {
        idempotencyKey: `payment:experience:${ref}`, sourceType: "experience", sourceId: ref, description: "test payment", basis: "actual", currency: "EUR",
        lines: [{ account: "stripe_clearing", amountMinor: 4600 }, { account: "partner_payable", amountMinor: -4600, partyType: "org", partyId: org }],
      })
    );
    expect((await rewardSummary(partner)).pendingPoints, "⌊4600/100⌋ at 1 point per €1").toBe(46);
    const key = `f5-adj-${run}`;
    const a1 = await adjustPoints({ partner, points: 25, reason: "goodwill correction", idempotencyKey: key, actorId: adminId });
    const a2 = await adjustPoints({ partner, points: 25, reason: "goodwill correction", idempotencyKey: key, actorId: adminId });
    expect([a2.duplicate, a2.id]).toEqual([true, a1.id]);
    await adjustPoints({ partner, points: -500, reason: "manual correction", idempotencyKey: `${key}-neg`, actorId: adminId });
    const s = await rewardSummary(partner);
    expect(s.debtPoints).toBe(475); // 25 available, 500 taken → 475 owed
    expect((await plan()).rewards.redemption).toBe("debt");
    const kinds = (await rewardHistory(partner)).map((e) => e.kind);
    expect(kinds).toEqual(expect.arrayContaining(["adjustment", "redemption"]));
    const page1 = await rewardHistory(partner, { limit: 1 });
    const page2 = await rewardHistory(partner, { limit: 5, before: page1[0].at, beforeId: page1[0].id });
    expect(page2.find((e) => e.id === page1[0].id), "no repeats across pages").toBeUndefined();
  });
});

describe("reward history shows reversals", () => {
  it("refund and dispute reversals are labelled, with the points-debt note", async () => {
    const p2 = { kind: "org" as const, id: org2 };
    const a = await db.prepare(`INSERT INTO reward_awards (settlement_id, party_type, party_id, source_type, source_ref, gmv_minor, refunded_at_award_minor, points) VALUES (0, 'org', ?, 'experience', ?, 5000, 0, 50)`).run(org2, `F5-${run}-rev`);
    const awardId = Number(a.lastInsertRowid);
    await db.prepare(`INSERT INTO reward_reversals (award_id, points, from_lots, to_debt, reason) VALUES (?, 20, 20, 0, 'refund'), (?, 30, 10, 20, 'dispute_lost')`).run(awardId, awardId);
    const h = await rewardHistory(p2);
    const refund = h.find((e) => e.kind === "refund_reversal")!;
    const dispute = h.find((e) => e.kind === "dispute_reversal")!;
    expect([refund.points, refund.note]).toEqual([-20, null]);
    expect([dispute.points, dispute.note, dispute.sourceRef]).toEqual([-30, "20 added to points debt", `F5-${run}-rev`]);
    await db.prepare(`DELETE FROM reward_reversals WHERE award_id = ?`).run(awardId);
    await db.prepare(`DELETE FROM reward_awards WHERE id = ?`).run(awardId);
  });
});

describe("split points use the frozen rate", () => {
  it("a later rate change never recalculates historical split points", async () => {
    const ref = `F5-${run}-split`;
    const snap = await db
      .prepare(
        `INSERT INTO allocation_snapshots (source_type, source_ref, currency, gross_minor, vat_minor, credits_used_minor, discount_minor, discount_funder, platform_funded_discount_minor, customer_fee_minor, success_fee_minor, est_processing_fee_minor, deposit_minor, platform_retained_minor, partner_pool_minor, rounding_adjustment_minor, rounding_owner)
         VALUES ('game', ?, 'EUR', 5120, 920, 0, 0, 'none', 0, 200, 0, 0, 0, 200, 4000, 1, 'venue')`
      )
      .run(ref);
    const sid = Number(snap.lastInsertRowid);
    await db.prepare(`INSERT INTO allocation_lines (snapshot_id, role, party_type, party_id, amount_minor) VALUES (?, 'venue', 'org', ?, 2667), (?, 'host', 'host', ?, 1333)`).run(sid, org, sid, resident);
    // Awarded when the rate was 2 points per €1: ⌊4000×2/100⌋ = 80 → 53 / 27.
    await db.prepare(`INSERT INTO reward_split_awards (settlement_id, party_type, party_id, source_type, source_ref, eligible_minor, points, rate_per_euro) VALUES (0, 'org', ?, 'game', ?, 2667, 53, 2), (0, 'host', ?, 'game', ?, 1333, 27, 2)`).run(org, ref, resident, ref);
    const { reverseRewardsForOrder } = await import("./rewards.js");
    // Nothing was refunded: with the frozen rate nothing is reversed (today's rule of 1/€ would wrongly take back 26 + 14).
    expect(await db.transaction((tx) => reverseRewardsForOrder(tx, "game", ref, "refund"))).toBe(0);
    await db.prepare(`DELETE FROM reward_split_awards WHERE source_ref = ?`).run(ref);
    await db.prepare(`DELETE FROM allocation_lines WHERE snapshot_id = ?`).run(sid);
    await db.prepare(`DELETE FROM allocation_snapshots WHERE id = ?`).run(sid);
  });
});

describe("customer credit", () => {
  it("grants are idempotent and capped by the rule; history and proportional restoration on partial refund (D1)", async () => {
    const key = `f5-grant-${run}`;
    const g1 = await grantCredit({ residentId: resident, amountMinor: 1000, kind: "goodwill", reason: "sorry for the wait", actorId: adminId, fundingOwner: "partner", idempotencyKey: key });
    const g2 = await grantCredit({ residentId: resident, amountMinor: 1000, kind: "goodwill", reason: "sorry for the wait", actorId: adminId, fundingOwner: "partner", idempotencyKey: key });
    expect([g2.duplicate, g2.id]).toEqual([true, g1.id]);
    await expect(grantCredit({ residentId: resident, amountMinor: 50_001, kind: "goodwill", reason: "too much credit", actorId: adminId })).rejects.toThrow(/€500\.00/);
    const lot = (await db.prepare(`SELECT funding_owner as f, currency as c FROM credit_lots WHERE id = ?`).get(g1.id)) as { f: string; c: string };
    expect([lot.f, lot.c]).toEqual(["partner", "EUR"]);
    // Admin form sends a date only: expiry is the end of that day in Ireland (IST in summer → 22:59:59 UTC).
    const dated = await call("POST", "/admin/finance/credits", { email: `${resident}@example.test`, amountMinor: 100, kind: "goodwill", reason: "dated expiry check", expiresAt: "2027-07-31", idempotencyKey: `f5-dated-${run}` }, { "X-Test-Role": "admin" });
    expect(dated.status).toBe(200);
    expect(new Date(dated.body.expiresAt).toISOString()).toBe("2027-07-31T22:59:59.999Z");
    await db.prepare(`DELETE FROM credit_lots WHERE id = ?`).run(dated.body.id);
    // €10 credit used on an order whose card payment was €20.
    const ref = `F5-${run}-c`;
    await db.prepare(`UPDATE credit_lots SET remaining_minor = 0 WHERE id = ?`).run(g1.id);
    await db.prepare(`INSERT INTO credit_uses (lot_id, resident_id, source_type, source_ref, amount_minor, status) VALUES (?, ?, 'experience', ?, 1000, 'confirmed')`).run(g1.id, resident, ref);
    const bal = async () => Number(((await db.prepare(`SELECT remaining_minor as r FROM credit_lots WHERE id = ?`).get(g1.id)) as { r: number }).r);
    await db.transaction((tx) => restoreCreditForRefund(tx, "experience", ref, 500, 2000));
    expect(await bal(), "¼ refunded → ¼ of the credit back").toBe(250);
    await db.transaction((tx) => restoreCreditForRefund(tx, "experience", ref, 500, 2000));
    expect(await bal(), "idempotent").toBe(250);
    await db.transaction((tx) => restoreCreditForRefund(tx, "experience", ref, 1000, 2000));
    expect(await bal()).toBe(500);
    await db.transaction((tx) => restoreCreditForRefund(tx, "experience", ref, 2000, 2000));
    expect(await bal(), "full refund → all credit back").toBe(1000);
    const kinds = (await residentCreditHistory(resident)).map((e) => e.kind);
    expect(kinds).toEqual(expect.arrayContaining(["granted", "used", "restored"]));
    const own = await call("GET", "/credits/me/history", undefined, { "X-Test-Resident": "1" });
    expect(own.status).toBe(200);
    expect(own.body.length).toBeGreaterThan(0);
  });
});

describe("coupons and switches", () => {
  it("coupon rejections carry a reason", async () => {
    const code = `F5${run.toUpperCase()}`;
    await db.prepare(`INSERT INTO coupons (code, kind, amount, max_uses, used_count, expires_at, active) VALUES (?, 'fixed', 500, NULL, 0, DATE_SUB(NOW(), INTERVAL 1 DAY), 1), (?, 'fixed', 500, 1, 1, NULL, 1)`).run(`${code}X`, `${code}L`);
    expect((await evaluateCoupon(`${code}X`, 5000)).reason).toBe("expired");
    expect((await evaluateCoupon(`${code}L`, 5000)).reason).toBe("limit");
    expect((await evaluateCoupon(`${code}NOPE`, 5000)).reason).toBe("invalid");
  });

  it("refuses invalid switch combinations (server-side)", async () => {
    const all = (on: string[]) => Object.fromEntries(SWITCHES.concat(["commerce.connect_v1", "commerce.venue_host_split_payout"]).map((k) => [k, on.includes(k)]));
    expect(switchChangeProblem("commerce.circle_credits", true, all([]))).toMatch(/Turn on .*ledger/i);
    // Commercial release gate: with its prerequisite on, rewards still wait for the approved fee model.
    expect(switchChangeProblem("commerce.circle_credits", true, all(["commerce.settlement_ledger"]))).toMatch(/fee model is approved/);
    expect(switchChangeProblem("commerce.customer_credits", true, all(["commerce.engine_v2", "commerce.engine_v2_experience"]))).toBeNull();
    expect(switchChangeProblem("commerce.settlement_ledger", false, all(["commerce.settlement_ledger", "commerce.circle_credits"]))).toMatch(/Turn off/);
    expect(switchChangeProblem("commerce.customer_credits", true, all(["commerce.engine_v2"]))).toMatch(/experience/i);
    await setSetting("commerce.settlement_ledger", "false");
    await setSetting("commerce.circle_credits", "false");
    const r = await call("PUT", "/admin/commerce/switches/commerce.circle_credits", { enabled: true, reason: "try without the ledger" }, { "X-Test-Role": "admin" });
    expect([r.status, r.body.code]).toEqual([409, "switch_dependency"]);
    await setSetting("commerce.settlement_ledger", "true");
    await setSetting("commerce.circle_credits", "true");
  });
});
