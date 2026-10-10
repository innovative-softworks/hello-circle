import crypto from "node:crypto";
import http, { type Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, setSetting } from "../db/index.js";
import { stubProvider } from "../payments/provider.js";
import { adminRouter } from "../routes/admin.js";
import { experiencesRouter } from "../routes/experiences.js";
import { residentCreditsRouter, vendorPlanRouter } from "../routes/partnerPlan.js";
import { processProviderOutcome, processStripeEvent } from "../routes/stripeWebhook.js";
import { creditBalance } from "./credits.js";
import { groupLines, ledgerIsBalanced, postGroup } from "./ledger.js";
import { currentPlanFor } from "./plans.js";
import { awardForSettlement, rewardBalance } from "./rewards.js";
import { postRefund, recordDispute } from "./payments.js";
import { GRACE_DAYS, proPrice, sweepSubscriptions } from "./subscriptions.js";

// Revenue & Connect Stage 5b — Pro on Stripe Billing (checkout → active →
// invoice revenue + VAT → failed payment grace → downgrade; cancel at period
// end), partner reward points (awarded on settled GMV, FIFO redemption for a
// month of Pro), and customer credits (granted by finance, applied as a
// HelloCircle-funded discount at engine-priced checkout, reserved → confirmed
// / released). Stub provider only.

const run = crypto.randomUUID().slice(0, 8);
const org = `brc-org-${run}`;
const vendorId = `brc-vendor-${run}`;
const adminId = `brc-admin-${run}`;
const residentId = `brc-res-${run}`;
const exp = `brc-exp-${run}`;
const session = `brc-s-${run}`;
const client = crypto.randomUUID();
const partner = { kind: "org" as const, id: org };
const SWITCHES = ["commerce.pro_subscriptions", "commerce.circle_credits", "commerce.customer_credits", "commerce.settlement_ledger", "commerce.engine_v2", "commerce.engine_v2_experience"];
let server: Server;
let baseUrl: string;

beforeAll(async () => {
  await db.prepare(`INSERT INTO organisations (id, name) VALUES (?, 'Billing Org')`).run(org);
  await db.prepare(`INSERT INTO users (id, email, password_hash, role, status, name, org_id) VALUES (?, ?, 'x', 'vendor', 'approved', 'V', ?)`).run(vendorId, `${vendorId}@example.test`, org);
  await db.prepare(`INSERT INTO users (id, email, password_hash, role, status, name, admin_role) VALUES (?, ?, 'x', 'admin', 'approved', 'A', 'finance')`).run(adminId, `${adminId}@example.test`);
  await db.prepare(`INSERT INTO residents (id, email, name) VALUES (?, ?, 'Credit Resident')`).run(residentId, `${residentId}@example.test`);
  await db
    .prepare(
      `INSERT INTO experiences (id, vendor_id, title, blurb, description, fitness_requirements, itinerary, equipment_provided, equipment_required, transport_info, safety_info, weather_policy, eligibility, cancellation_terms, status, price_cents, capacity, payment_method)
       VALUES (?, ?, 'Credit Hike', 'b', 'd', '', '', '', '', '', '', '', '', '', 'approved', 5000, 500, 'online')`
    )
    .run(exp, vendorId);
  await db.prepare(`INSERT INTO experience_sessions (id, experience_id, date, time) VALUES (?, ?, ?, '10:00')`).run(session, exp, new Date(Date.now() + 20 * 864e5).toISOString().slice(0, 10));
  process.env.QA_E2E_ENABLED = "true";
  process.env.QA_PAYMENT_PROVIDER_STUB = "1";
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    if (req.header("X-Test-Role") === "admin") (req as any).user = { id: adminId, email: `${adminId}@example.test`, role: "admin", status: "approved", adminRole: "finance" };
    if (req.header("X-Test-Role") === "vendor") (req as any).user = { id: vendorId, email: `${vendorId}@example.test`, role: "vendor", status: "approved", orgId: org, invitedStaff: false };
    if (req.header("X-Test-Resident")) (req as any).resident = { id: residentId, email: `${residentId}@example.test`, name: "Credit Resident" };
    next();
  });
  app.use("/vendor/plan", vendorPlanRouter);
  app.use("/credits", residentCreditsRouter);
  app.use("/experiences", experiencesRouter);
  app.use("/admin", adminRouter);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Failed to bind test server");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  delete process.env.QA_E2E_ENABLED;
  delete process.env.QA_PAYMENT_PROVIDER_STUB;
  for (const k of SWITCHES) await setSetting(k, "false");
  const refs = ((await db.prepare(`SELECT ref FROM experience_bookings WHERE experience_id = ?`).all(exp)) as { ref: string }[]).map((r) => r.ref);
  const keys = [`invoice:in_brc_${run}`, ...refs.map((r) => `payment:experience:${r}`), `brc-release:${run}`, `brc-releaseB:${run}`];
  for (const k of keys) {
    const g = (await db.prepare(`SELECT id FROM ledger_entry_groups WHERE idempotency_key = ?`).get(k)) as { id: string } | undefined;
    if (!g) continue;
    await db.prepare(`DELETE FROM settlement_items WHERE ledger_group_id = ?`).run(g.id);
    await db.prepare(`DELETE FROM ledger_entries WHERE group_id = ?`).run(g.id);
    await db.prepare(`DELETE FROM ledger_entry_groups WHERE id = ?`).run(g.id);
  }
  if (refs.length) {
    const marks = refs.map(() => "?").join(",");
    await db.prepare(`DELETE FROM payment_records WHERE source_ref IN (${marks})`).run(...refs);
    const orders = (await db.prepare(`SELECT id FROM commerce_orders WHERE source_ref IN (${marks})`).all(...refs)) as { id: string }[];
    for (const o of orders) {
      await db.prepare(`DELETE FROM pricing_snapshots WHERE order_id = ?`).run(o.id);
      await db.prepare(`DELETE FROM commerce_order_lines WHERE order_id = ?`).run(o.id);
    }
    await db.prepare(`DELETE FROM commerce_orders WHERE source_ref IN (${marks})`).run(...refs);
  }
  await db.prepare(`DELETE FROM payment_records WHERE source_ref = ?`).run(`brc-pay-${run}`);
  await db.prepare(`DELETE FROM commerce_quotes WHERE resource_id = ?`).run(exp);
  await db.prepare(`DELETE FROM notifications WHERE listing_id = ?`).run(exp);
  await db.prepare(`DELETE FROM experience_bookings WHERE experience_id = ?`).run(exp);
  await db.prepare(`DELETE FROM experience_sessions WHERE experience_id = ?`).run(exp);
  await db.prepare(`DELETE FROM experiences WHERE id = ?`).run(exp);
  await db.prepare(`DELETE FROM credit_uses WHERE resident_id = ?`).run(residentId);
  await db.prepare(`DELETE FROM credit_lots WHERE resident_id = ?`).run(residentId);
  await db.prepare(`DELETE FROM reward_reversals WHERE award_id IN (SELECT id FROM reward_awards WHERE party_id = ?)`).run(org);
  await db.prepare(`DELETE FROM reward_awards WHERE party_id = ?`).run(org);
  await db.prepare(`DELETE FROM reward_debts WHERE party_id = ?`).run(org);
  await db.prepare(`DELETE FROM refunds WHERE idempotency_key LIKE ?`).run(`brc-rf%-${run}`);
  await db.prepare(`DELETE FROM disputes WHERE provider_dispute_id = ?`).run(`dp_brc_${run}`);
  await db.prepare(`DELETE FROM payment_records WHERE source_ref = ?`).run(`brc-payB-${run}`);
  await db.prepare(`DELETE FROM settlement_items WHERE settlement_id IN (SELECT id FROM settlements WHERE party_id = ?)`).run(org);
  await db.prepare(`DELETE FROM commerce_rule_versions WHERE created_by = ?`).run(adminId);
  await db.prepare(`DELETE FROM settlement_runs WHERE run_key = ?`).run(`brc-${run}-b`);
  await db.prepare(`DELETE FROM reward_redemptions WHERE party_id = ?`).run(org);
  await db.prepare(`DELETE FROM reward_lots WHERE party_id = ?`).run(org);
  await db.prepare(`DELETE FROM settlements WHERE party_id = ?`).run(org);
  await db.prepare(`DELETE FROM settlement_runs WHERE run_key = ?`).run(`brc-${run}`);
  await db.prepare(`DELETE FROM partner_subscriptions WHERE party_id = ?`).run(org);
  await db.prepare(`DELETE FROM partner_plan_assignments WHERE partner_id = ?`).run(org);
  await db.prepare(`DELETE FROM audit_log WHERE actor_user_id IN (?, ?) OR object_id = ?`).run(adminId, vendorId, org);
  await db.prepare(`DELETE FROM residents WHERE id = ?`).run(residentId);
  await db.prepare(`DELETE FROM users WHERE id IN (?, ?)`).run(vendorId, adminId);
  await db.prepare(`DELETE FROM organisations WHERE id = ?`).run(org);
});

const call = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
  fetch(`${baseUrl}${path}`, { method, headers: { "Content-Type": "application/json", "X-Client-Id": client, ...headers }, body: body === undefined ? undefined : JSON.stringify(body) }).then(async (r) => ({ status: r.status, body: await r.json() }));
const asVendor = { "X-Test-Role": "vendor" };
const asAdmin = { "X-Test-Role": "admin" };
const asResident = { "X-Test-Resident": "1" };
const subId = `sub_brc_${run}`;

describe("Pro on Stripe Billing", () => {
  it("is unavailable while the switch is off", async () => {
    await setSetting("commerce.pro_subscriptions", "false");
    expect((await call("POST", "/vendor/plan/pro/checkout", {}, asVendor)).status).toBe(409);
  });

  it("charges the published price plus VAT, and Pro starts only when the checkout is paid", async () => {
    await setSetting("commerce.pro_subscriptions", "true");
    await setSetting("commerce.settlement_ledger", "true");
    const price = await proPrice();
    expect(price).toMatchObject({ netMinor: 2_900, vatMinor: 667, grossMinor: 3_567 });
    const r = await call("POST", "/vendor/plan/pro/checkout", {}, asVendor);
    expect(r.status).toBe(200);
    const sent = stubProvider.calls.filter((c) => c.method === "createSubscriptionCheckout").at(-1)!.args as Record<string, any>;
    // Stage 5c — Stripe gets the net price and the VAT rate separately (an exclusive tax rate), never one gross figure.
    expect(sent).toMatchObject({ netAmountMinor: 2_900, vatBps: 2_300, currency: "EUR", metadata: { type: "subscription", party_type: "org", party_id: org } });
    expect(sent.unitAmountMinor).toBeUndefined();
    const row = (await db.prepare(`SELECT net_minor as n, vat_minor as v, gross_minor as g, vat_mode as m, tax_rule_hash as h FROM partner_subscriptions WHERE checkout_session_id = ?`).get(r.body.id)) as Record<string, string | number>;
    expect([Number(row.n), Number(row.v), Number(row.g), row.m]).toEqual([2_900, 667, 3_567, "standard"]);
    expect(String(row.h)).toMatch(/^[0-9a-f]{64}$/);
    expect((await currentPlanFor(partner)).planKey).toBe("free");

    const completed = { id: `evt_brc_${run}_c`, type: "checkout.session.completed", created: 0, livemode: false, data: { object: { id: r.body.id, mode: "subscription", payment_status: "paid", subscription: subId, metadata: { type: "subscription" } } } };
    expect(await processStripeEvent(completed)).toBe("processed");
    expect(await processStripeEvent(completed)).toBe("processed"); // replay is a no-op
    expect(await currentPlanFor(partner)).toMatchObject({ planKey: "pro", source: "subscription", sourceRef: subId });
    expect((await call("POST", "/vendor/plan/pro/checkout", {}, asVendor)).status).toBe(409);
  });

  it("a partner on reverse charge (partner-scoped tax rule) is charged no VAT; the net price is unchanged", async () => {
    const d = await call("POST", "/admin/commerce/rules/drafts", { key: "tax_vat", scopeType: "partner", scopeId: `org:${org}`, payload: { vatMode: "reverse_charge" }, reason: "EU B2B reverse charge (test)" }, asAdmin);
    expect(d.status).toBe(200);
    await call("POST", `/admin/commerce/rules/${d.body.id}/publish`, { reason: "publish tax override" }, asAdmin);
    expect(await proPrice({ kind: "org", id: org })).toMatchObject({ netMinor: 2_900, vatMinor: 0, grossMinor: 2_900, vatMode: "reverse_charge" });
    expect(await proPrice()).toMatchObject({ netMinor: 2_900, vatMinor: 667 }); // everyone else unchanged
    const overview = await call("GET", "/vendor/plan", undefined, asVendor);
    expect(overview.body.price).toMatchObject({ netMinor: 2_900, vatMinor: 0 });
    await call("POST", `/admin/commerce/rules/${d.body.id}/retire`, { reason: "back to standard" }, asAdmin);
  });

  it("books each paid invoice as subscription revenue plus VAT", async () => {
    // The VAT Stripe reports on the invoice is what's booked (here none reported → the rate frozen on the subscription).
    expect(await processStripeEvent({ id: `evt_brc_${run}_i`, type: "invoice.paid", created: 0, livemode: false, data: { object: { id: `in_brc_${run}`, amount_paid: 3_567, currency: "eur", subscription: subId } } })).toBe("processed");
    const g = (await db.prepare(`SELECT id FROM ledger_entry_groups WHERE idempotency_key = ?`).get(`invoice:in_brc_${run}`)) as { id: string };
    const lines = (await groupLines(db, g.id)).map((l) => [l.account, Number(l.amountMinor)]);
    expect(lines).toEqual(expect.arrayContaining([["stripe_clearing", 3_567], ["subscription_revenue", -2_900], ["subscription_vat_payable", -667]]));
    expect(await ledgerIsBalanced()).toBe(true);
  });

  it("a failed payment starts a 7-day grace; Pro ends only after it runs out", async () => {
    expect(await processStripeEvent({ id: `evt_brc_${run}_f`, type: "invoice.payment_failed", created: 0, livemode: false, data: { object: { id: `in_brc_${run}_2`, subscription: subId } } })).toBe("processed");
    const row = (await db.prepare(`SELECT status, grace_until as g FROM partner_subscriptions WHERE provider_subscription_id = ?`).get(subId)) as { status: string; g: string };
    expect(row.status).toBe("past_due");
    expect((await sweepSubscriptions(new Date())).ended).toBe(0);
    expect((await currentPlanFor(partner)).planKey).toBe("pro");
    expect((await sweepSubscriptions(new Date(Date.now() + (GRACE_DAYS + 1) * 864e5))).ended).toBe(1);
    expect((await currentPlanFor(partner)).planKey).toBe("free");
    expect(stubProvider.calls.filter((c) => c.method === "cancelSubscription").at(-1)!.args).toEqual({ subscriptionId: subId, atPeriodEnd: false });
  });

  it("cancelling stops renewal; Pro lasts until Stripe ends the subscription", async () => {
    const r = await call("POST", "/vendor/plan/pro/checkout", {}, asVendor);
    const sub2 = `${subId}_2`;
    await processStripeEvent({ id: `evt_brc_${run}_c2`, type: "checkout.session.completed", created: 0, livemode: false, data: { object: { id: r.body.id, payment_status: "paid", subscription: sub2, metadata: { type: "subscription" } } } });
    expect((await call("POST", "/vendor/plan/pro/cancel", {}, asVendor)).status).toBe(200);
    expect(stubProvider.calls.filter((c) => c.method === "cancelSubscription").at(-1)!.args).toEqual({ subscriptionId: sub2, atPeriodEnd: true });
    expect((await currentPlanFor(partner)).planKey).toBe("pro");
    const overview = await call("GET", "/vendor/plan", undefined, asVendor);
    expect(overview.body.subscription).toMatchObject({ status: "active", cancelAtPeriodEnd: true });
    expect(await processStripeEvent({ id: `evt_brc_${run}_d`, type: "customer.subscription.deleted", created: 0, livemode: false, data: { object: { id: sub2 } } })).toBe("processed");
    expect((await currentPlanFor(partner)).planKey).toBe("free");
  });
});

describe("partner reward points", () => {
  it("awards points on the settled GMV once per settlement", async () => {
    await setSetting("commerce.circle_credits", "true");
    // One released order of €123.45 in a settlement.
    const ref = `brc-pay-${run}`;
    await db.prepare(`INSERT INTO payment_records (source_type, source_ref, provider, amount_minor, currency, status) VALUES ('experience', ?, 'stub', 12345, 'EUR', 'succeeded')`).run(ref);
    const g = await db.transaction((tx) =>
      postGroup(tx, {
        idempotencyKey: `release:experience:${ref}`,
        sourceType: "experience",
        sourceId: ref,
        description: "test release",
        basis: "actual",
        currency: "EUR",
        lines: [
          { account: "partner_payable", amountMinor: 100, partyType: "org", partyId: org },
          { account: "partner_available", amountMinor: -100, partyType: "org", partyId: org },
        ],
      })
    );
    const runRow = await db.prepare(`INSERT INTO settlement_runs (run_key, dry_run, status, started_by, reason) VALUES (?, 0, 'completed', ?, 'rewards test')`).run(`brc-${run}`, adminId);
    const st = await db.prepare(`INSERT INTO settlements (run_id, party_type, party_id, currency, net_minor, status) VALUES (?, 'org', ?, 'EUR', 100, 'due')`).run(Number(runRow.lastInsertRowid), org);
    const settlementId = Number(st.lastInsertRowid);
    await db.prepare(`INSERT INTO settlement_items (settlement_id, ledger_group_id, description, amount_minor) VALUES (?, ?, 'release', 100)`).run(settlementId, g.groupId);
    expect(await awardForSettlement(settlementId)).toBe(123);
    expect(await awardForSettlement(settlementId)).toBe(0);
    expect((await rewardBalance(partner)).points).toBe(123);
    // Clean the release group with the rest.
    await db.prepare(`UPDATE ledger_entry_groups SET idempotency_key = ? WHERE id = ?`).run(`brc-release:${run}`, g.groupId);
  });

  it("a refund after settlement reverses that order's points proportionally", async () => {
    const ref = `brc-pay-${run}`;
    await db.transaction(async (tx) => {
      const rf = await tx.prepare(`INSERT INTO refunds (source_type, source_ref, amount_minor, currency, kind, origin, responsible, reason, status, idempotency_key) VALUES ('experience', ?, 6172, 'EUR', 'partial', 'admin', 'partner', 'half refunded', 'succeeded', ?)`).run(ref, `brc-rf1-${run}`);
      await postRefund(tx, "experience", ref, Number(rf.lastInsertRowid), 6_172, 12_345, adminId);
    });
    // floor(123 × 6,172 / 12,345) = 61 points reversed from the order's own lot.
    expect((await rewardBalance(partner)).points).toBe(62);
    const rev = (await db.prepare(`SELECT r.points, r.from_lots as l, r.to_debt as d, r.reason FROM reward_reversals r JOIN reward_awards a ON a.id = r.award_id WHERE a.source_ref = ?`).all(ref)) as Record<string, number | string>[];
    expect(rev.map((x) => [Number(x.points), Number(x.l), Number(x.d), x.reason])).toEqual([[61, 61, 0, "refund"]]);
  });

  it("redeems the published points (oldest first) for one month of Pro, and refuses too few", async () => {
    const short = await call("POST", "/vendor/plan/rewards/redeem", {}, asVendor);
    expect(short.status).toBe(409);
    expect(short.body.error).toMatch(/10,000 points/);
    await db.prepare(`INSERT INTO reward_lots (party_type, party_id, source_ref, points_earned, points_remaining, expires_at) VALUES ('org', ?, ?, 9940, 9940, ?)`).run(org, `test:${run}:a`, new Date(Date.now() + 30 * 864e5));
    const r = await call("POST", "/vendor/plan/rewards/redeem", {}, asVendor);
    expect(r.status).toBe(200);
    const cur = await currentPlanFor(partner);
    expect(cur).toMatchObject({ planKey: "pro", source: "promotion", sourceRef: `reward:${r.body.redemptionId}` });
    const days = (new Date(cur.effectiveTo!).getTime() - Date.now()) / 864e5;
    expect(days).toBeGreaterThan(27);
    expect(days).toBeLessThan(32);
    expect((await rewardBalance(partner)).points).toBe(2); // 62 + 9,940 − 10,000
  });

  it("points already redeemed when the rest is refunded become a points debt that blocks redemption and is repaid first", async () => {
    const ref = `brc-pay-${run}`;
    await db.transaction(async (tx) => {
      const rf = await tx.prepare(`INSERT INTO refunds (source_type, source_ref, amount_minor, currency, kind, origin, responsible, reason, status, idempotency_key) VALUES ('experience', ?, 6173, 'EUR', 'remaining', 'admin', 'partner', 'rest refunded', 'succeeded', ?)`).run(ref, `brc-rf2-${run}`);
      await postRefund(tx, "experience", ref, Number(rf.lastInsertRowid), 6_173, 12_345, adminId);
    });
    // Fully refunded → all 123 reversed: 62 more, of which only 2 were still unspent.
    expect(await rewardBalance(partner)).toMatchObject({ availablePoints: 0, debtPoints: 60, points: -60 });
    await db.prepare(`INSERT INTO reward_lots (party_type, party_id, source_ref, points_earned, points_remaining, expires_at) VALUES ('org', ?, ?, 20000, 20000, ?)`).run(org, `test:${run}:b`, new Date(Date.now() + 30 * 864e5));
    const blocked = await call("POST", "/vendor/plan/rewards/redeem", {}, asVendor);
    expect(blocked.status).toBe(409);
    expect(blocked.body.error).toMatch(/60 points are owed/);
    await db.prepare(`UPDATE reward_lots SET points_remaining = 0 WHERE source_ref = ?`).run(`test:${run}:b`);
  });

  it("new awards repay the debt first; a lost dispute reverses points too", async () => {
    // A second settled order of €50 → 50 points, all of which repay the 60-point debt.
    const refB = `brc-payB-${run}`;
    await db.prepare(`INSERT INTO payment_records (source_type, source_ref, provider, payment_intent_id, amount_minor, currency, status) VALUES ('experience', ?, 'stub', ?, 5000, 'EUR', 'succeeded')`).run(refB, `pi_brc_${run}`);
    const g = await db.transaction((tx) =>
      postGroup(tx, {
        idempotencyKey: `release:experience:${refB}`,
        sourceType: "experience",
        sourceId: refB,
        description: "test release B",
        basis: "actual",
        currency: "EUR",
        lines: [
          { account: "partner_payable", amountMinor: 100, partyType: "org", partyId: org },
          { account: "partner_available", amountMinor: -100, partyType: "org", partyId: org },
        ],
      })
    );
    const r2 = await db.prepare(`INSERT INTO settlement_runs (run_key, dry_run, status, started_by, reason) VALUES (?, 0, 'completed', ?, 'rewards test B')`).run(`brc-${run}-b`, adminId);
    const st = await db.prepare(`INSERT INTO settlements (run_id, party_type, party_id, currency, net_minor, status) VALUES (?, 'org', ?, 'EUR', 100, 'due')`).run(Number(r2.lastInsertRowid), org);
    await db.prepare(`INSERT INTO settlement_items (settlement_id, ledger_group_id, description, amount_minor) VALUES (?, ?, 'release B', 100)`).run(Number(st.lastInsertRowid), g.groupId);
    expect(await awardForSettlement(Number(st.lastInsertRowid))).toBe(50);
    expect(await rewardBalance(partner)).toMatchObject({ availablePoints: 0, debtPoints: 10 });
    // The customer wins a chargeback on order B: its 50 points are reversed (none left to take → debt).
    await recordDispute({ disputeId: `dp_brc_${run}`, paymentIntentId: `pi_brc_${run}`, amountMinor: 5_000, currency: "eur", reason: "product_not_received", status: "needs_response", evidenceDueBy: null });
    await recordDispute({ disputeId: `dp_brc_${run}`, paymentIntentId: `pi_brc_${run}`, amountMinor: 5_000, currency: "eur", reason: "product_not_received", status: "lost", evidenceDueBy: null });
    await recordDispute({ disputeId: `dp_brc_${run}`, paymentIntentId: `pi_brc_${run}`, amountMinor: 5_000, currency: "eur", reason: "product_not_received", status: "lost", evidenceDueBy: null }); // replay
    expect(await rewardBalance(partner)).toMatchObject({ availablePoints: 0, debtPoints: 60 });
    await db.prepare(`UPDATE ledger_entry_groups SET idempotency_key = ? WHERE id = ?`).run(`brc-releaseB:${run}`, g.groupId);
  });
});

describe("customer credits", () => {
  it("finance grants credit (switch on, reason required); the resident sees it", async () => {
    await setSetting("commerce.customer_credits", "true");
    expect((await call("POST", "/admin/finance/credits", { residentId, amountMinor: 1_000, reason: "x" }, asAdmin)).status).toBe(400);
    expect((await call("POST", "/admin/finance/credits", { email: `${residentId}@example.test`, amountMinor: 1_000, reason: "Sorry about the cancelled hike" }, asAdmin)).status).toBe(200);
    const mine = await call("GET", "/credits/me", undefined, asResident);
    expect(mine.body).toMatchObject({ enabled: true, balanceMinor: 1_000 });
  });

  it("applies at engine-priced checkout as a HelloCircle-funded discount, reserved then confirmed on payment", async () => {
    await setSetting("commerce.engine_v2", "true");
    await setSetting("commerce.engine_v2_experience", "true");
    const plain = await call("POST", `/experiences/${exp}/sessions/${session}/quote`, { partySize: 1 }, asResident);
    const quote = await call("POST", `/experiences/${exp}/sessions/${session}/quote`, { partySize: 1, useCredits: true }, asResident);
    expect(quote.body.creditCents).toBe(1_000);
    expect(quote.body.totalCents).toBeLessThan(plain.body.totalCents);

    const r = await call("POST", `/experiences/${exp}/sessions/${session}/checkout`, { participantName: "C", email: "c@example.test", partySize: 1, useCredits: true, quoteId: quote.body.quoteId }, asResident);
    expect(r.status).toBe(201);
    expect(await creditBalance(residentId)).toBe(0);
    const use = (await db.prepare(`SELECT amount_minor as a, status FROM credit_uses WHERE source_ref = ?`).get(r.body.ref)) as { a: number; status: string };
    expect([Number(use.a), use.status]).toEqual([1_000, "reserved"]);
    const snap = (await db
      .prepare(`SELECT s.platform_funded_discount_minor as f, s.customer_paid_minor as paid FROM pricing_snapshots s JOIN commerce_orders o ON o.id = s.order_id WHERE o.source_ref = ?`)
      .get(r.body.ref)) as { f: number; paid: number };
    expect(Number(snap.f)).toBe(1_000);
    expect(Number(snap.paid)).toBe(quote.body.totalCents);

    const row = (await db.prepare(`SELECT stripe_session_id as sid FROM experience_bookings WHERE ref = ?`).get(r.body.ref)) as { sid: string };
    stubProvider.markPaid(row.sid, Number(snap.paid));
    await processProviderOutcome("experience", r.body.ref, "success");
    expect(((await db.prepare(`SELECT status FROM credit_uses WHERE source_ref = ?`).get(r.body.ref)) as { status: string }).status).toBe("confirmed");
    expect(await ledgerIsBalanced()).toBe(true);
  });

  it("a checkout that fails gives the credit back", async () => {
    await call("POST", "/admin/finance/credits", { residentId, amountMinor: 700, reason: "Goodwill for the delay" }, asAdmin);
    const r = await call("POST", `/experiences/${exp}/sessions/${session}/checkout`, { participantName: "C", email: "c@example.test", partySize: 1, useCredits: true }, asResident);
    expect(r.status).toBe(201);
    expect(await creditBalance(residentId)).toBe(0);
    await processProviderOutcome("experience", r.body.ref, "failure");
    expect(await creditBalance(residentId)).toBe(700);
    expect(((await db.prepare(`SELECT status FROM credit_uses WHERE source_ref = ?`).get(r.body.ref)) as { status: string }).status).toBe("released");
  });

  it("without useCredits, or while the switch is off, nothing is applied", async () => {
    const q1 = await call("POST", `/experiences/${exp}/sessions/${session}/quote`, { partySize: 1 }, asResident);
    expect(q1.body.creditCents).toBe(0);
    await setSetting("commerce.customer_credits", "false");
    const q2 = await call("POST", `/experiences/${exp}/sessions/${session}/quote`, { partySize: 1, useCredits: true }, asResident);
    expect(q2.body.creditCents).toBe(0);
  });
});
