import crypto from "node:crypto";
import http, { type Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, setSetting } from "../db/index.js";
import { stubProvider } from "../payments/provider.js";
import { adminRouter } from "../routes/admin.js";
import { experiencesRouter } from "../routes/experiences.js";
import { processProviderOutcome, processStripeEvent } from "../routes/stripeWebhook.js";
import { vendorInsightsRouter } from "../routes/vendorInsights.js";
import { backfillLegacySnapshots } from "./backfill.js";
import { ledgerIsBalanced } from "./ledger.js";
import { partnerBalances, runSettlement, serviceEnd } from "./settlement.js";

// Revenue & Connect Stage 2d — completion, weekly settlement, thresholds,
// refunds after completion, dispute recovery, fee reconciliation, the legacy
// snapshot backfill and the partner earnings view. Stub provider only.

const run = crypto.randomUUID().slice(0, 8);
const org = `st-org-${run}`;
const vendorId = `st-vendor-${run}`;
const adminId = `st-admin-${run}`;
const exp = `st-exp-${run}`;
const session = `st-s-${run}`;
const client = crypto.randomUUID();
const sessionDate = new Date(Date.now() + 10 * 864e5).toISOString().slice(0, 10);
const later = (days: number) => new Date(Date.now() + days * 864e5);
const party = { partyType: "org", partyId: org };
let server: Server;
let baseUrl: string;

beforeAll(async () => {
  await db.prepare(`INSERT INTO organisations (id, name) VALUES (?, 'Settlement Org')`).run(org);
  await db.prepare(`INSERT INTO users (id, email, password_hash, role, status, name, org_id) VALUES (?, ?, 'x', 'vendor', 'approved', 'V', ?)`).run(vendorId, `${vendorId}@example.test`, org);
  await db.prepare(`INSERT INTO users (id, email, password_hash, role, status, name, admin_role) VALUES (?, ?, 'x', 'admin', 'approved', 'A', 'finance')`).run(adminId, `${adminId}@example.test`);
  await db
    .prepare(
      `INSERT INTO experiences (id, vendor_id, title, blurb, description, fitness_requirements, itinerary, equipment_provided, equipment_required, transport_info, safety_info, weather_policy, eligibility, cancellation_terms, status, price_cents, capacity, payment_method, duration_minutes)
       VALUES (?, ?, 'Settle Hike', 'b', 'd', '', '', '', '', '', '', '', '', '', 'approved', 5000, 500, 'online', 180)`
    )
    .run(exp, vendorId);
  await db.prepare(`INSERT INTO experience_sessions (id, experience_id, date, time) VALUES (?, ?, ?, '10:00')`).run(session, exp, sessionDate);
  await setSetting("commerce.settlement_ledger", "true");
  process.env.QA_E2E_ENABLED = "true";
  process.env.QA_PAYMENT_PROVIDER_STUB = "1";
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    if (req.header("X-Test-Role") === "admin") (req as any).user = { id: adminId, role: "admin", status: "approved", adminRole: "finance" };
    if (req.header("X-Test-Role") === "vendor") {
      (req as any).user = { id: vendorId, role: "vendor", status: "approved", orgId: org, invitedStaff: false };
      (req as any).vendorIds = [vendorId];
    }
    next();
  });
  app.use("/experiences", experiencesRouter);
  app.use("/admin", adminRouter);
  app.use("/vendor", vendorInsightsRouter);
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
  await setSetting("commerce.settlement_ledger", "false");
  // Ledger rows for this run's party / orders.
  const groups = (await db
    .prepare(
      `SELECT DISTINCT g.id FROM ledger_entry_groups g LEFT JOIN ledger_entries e ON e.group_id = g.id
       WHERE e.party_id = ? OR g.source_id LIKE ? OR g.source_id LIKE ? OR g.idempotency_key LIKE ?`
    )
    .all(org, `%${run}%`, `EX-%`, `%dp_st_${run}%`)) as { id: string }[];
  const refs = ((await db.prepare(`SELECT ref FROM experience_bookings WHERE experience_id = ?`).all(exp)) as { ref: string }[]).map((r) => r.ref);
  const mine = (await db
    .prepare(`SELECT id FROM ledger_entry_groups WHERE source_id IN (${refs.map(() => "?").join(",") || "''"}) OR idempotency_key IN (${refs.map(() => "?").join(",") || "''"})`)
    .all(...refs, ...refs.map((r) => `payment:experience:${r}`))) as { id: string }[];
  const refundGroups = (await db.prepare(`SELECT g.id FROM ledger_entry_groups g JOIN refunds r ON g.source_type = 'refund' AND g.source_id = CAST(r.id AS CHAR) WHERE r.source_ref IN (${refs.map(() => "?").join(",") || "''"})`).all(...refs)) as { id: string }[];
  const feeGroups = (await db.prepare(`SELECT id FROM ledger_entry_groups WHERE source_type = 'payment_fee' AND source_id IN (${refs.map(() => "?").join(",") || "''"})`).all(...refs.map((r) => `experience:${r}`))) as { id: string }[];
  const all = new Set([...groups, ...mine, ...refundGroups, ...feeGroups].map((g) => g.id));
  // Only delete groups that touch this test's party or orders.
  for (const id of all) {
    const touches = (await db.prepare(`SELECT 1 as ok FROM ledger_entry_groups g LEFT JOIN ledger_entries e ON e.group_id = g.id WHERE g.id = ? AND (e.party_id = ? OR g.source_id IN (${refs.map(() => "?").join(",") || "''"}) OR g.source_id IN (${refs.map(() => "?").join(",") || "''"}) OR g.source_type IN ('refund', 'settlement', 'dispute', 'payment_fee')) LIMIT 1`).get(id, org, ...refs, ...refs.map((r) => `experience:${r}`))) as { ok: number } | undefined;
    if (!touches) continue;
    await db.prepare(`DELETE FROM settlement_items WHERE ledger_group_id = ?`).run(id);
    await db.prepare(`DELETE FROM ledger_entries WHERE group_id = ?`).run(id);
    await db.prepare(`DELETE FROM ledger_entry_groups WHERE id = ?`).run(id);
  }
  await db.prepare(`DELETE FROM settlements WHERE party_id = ?`).run(org);
  await db.prepare(`DELETE FROM settlement_runs WHERE run_key LIKE ?`).run(`%${run}%`);
  if (refs.length) {
    const marks = refs.map(() => "?").join(",");
    await db.prepare(`DELETE FROM order_completions WHERE source_ref IN (${marks})`).run(...refs);
    await db.prepare(`DELETE FROM fee_reconciliations WHERE payment_record_id IN (SELECT id FROM payment_records WHERE source_ref IN (${marks}))`).run(...refs);
    await db.prepare(`DELETE FROM refunds WHERE source_ref IN (${marks})`).run(...refs);
    await db.prepare(`DELETE FROM payment_records WHERE source_ref IN (${marks})`).run(...refs);
    const orders = (await db.prepare(`SELECT id FROM commerce_orders WHERE source_ref IN (${marks})`).all(...refs)) as { id: string }[];
    for (const o of orders) await db.prepare(`DELETE FROM pricing_snapshots WHERE order_id = ?`).run(o.id);
    await db.prepare(`DELETE FROM commerce_orders WHERE source_ref IN (${marks})`).run(...refs);
  }
  await db.prepare(`DELETE FROM disputes WHERE provider_dispute_id LIKE ?`).run(`dp_st_${run}%`);
  await db.prepare(`DELETE FROM commerce_rule_versions WHERE created_by = ?`).run(adminId);
  await db.prepare(`DELETE FROM audit_log WHERE actor_user_id IN (?, ?)`).run(adminId, vendorId);
  await db.prepare(`DELETE FROM notifications WHERE listing_id = ?`).run(exp);
  await db.prepare(`DELETE FROM experience_bookings WHERE experience_id = ?`).run(exp);
  await db.prepare(`DELETE FROM experience_sessions WHERE experience_id = ?`).run(exp);
  await db.prepare(`DELETE FROM experiences WHERE id = ?`).run(exp);
  await db.prepare(`DELETE FROM users WHERE id IN (?, ?)`).run(vendorId, adminId);
  await db.prepare(`DELETE FROM organisations WHERE id = ?`).run(org);
});

const call = (method: string, path: string, body?: unknown, role?: "admin" | "vendor") =>
  fetch(`${baseUrl}${path}`, { method, headers: { "Content-Type": "application/json", "X-Client-Id": client, ...(role ? { "X-Test-Role": role } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) }).then(async (r) => ({ status: r.status, body: await r.json() }));

async function paidBooking(): Promise<{ ref: string; sessionId: string }> {
  const r = await call("POST", `/experiences/${exp}/sessions/${session}/checkout`, { participantName: "S", email: "s@example.test", partySize: 1 });
  expect(r.status).toBe(201);
  const row = (await db.prepare(`SELECT stripe_session_id as sid FROM experience_bookings WHERE ref = ?`).get(r.body.ref)) as { sid: string };
  stubProvider.markPaid(row.sid, 6_400);
  await processProviderOutcome("experience", r.body.ref, "success");
  return { ref: r.body.ref, sessionId: row.sid };
}

describe("completion", () => {
  it("service end = session start + duration, in Ireland time", async () => {
    const { ref } = await paidBooking();
    const end = await serviceEnd("experience", ref);
    expect(end).not.toBeNull();
    const startUtc = new Date(`${sessionDate}T10:00:00Z`).getTime();
    const diffHours = (end!.getTime() - startUtc) / 3_600_000;
    expect([2, 3]).toContain(diffHours); // 13:00 Dublin = 12:00 UTC (summer) or 13:00 UTC (winter)
  });
});

describe("weekly settlement", () => {
  it("before completion + 48h nothing is released or settled", async () => {
    const r = await runSettlement({ runKey: `early-${run}`, dryRun: true, actorId: adminId, reason: "too early to settle" });
    expect(r.released.find((x) => x.ref.startsWith("EX-"))).toBeUndefined();
  });

  it("a dry run previews without changing anything; the real run releases and settles once", async () => {
    const preview = await call("POST", "/admin/finance/settlements/run", { runKey: `w1-${run}`, dryRun: true, reason: "weekly preview" }, "admin");
    expect(preview.status).toBe(200);
    const preRuns = await runSettlement({ runKey: `w1-${run}`, dryRun: true, actorId: adminId, reason: "preview after completion", now: later(15) });
    expect(preRuns.settled.find((s) => s.partyId === org)?.netMinor).toBe(5_000);
    expect(await db.prepare(`SELECT id FROM order_completions WHERE party_id = ?`).get(org)).toBeUndefined();

    const real = await runSettlement({ runKey: `w1-${run}`, dryRun: false, actorId: adminId, reason: "weekly settlement", now: later(15) });
    const mine = real.settled.find((s) => s.partyId === org)!;
    expect(mine.netMinor).toBe(5_000);
    expect(await partnerBalances(party)).toMatchObject({ pendingMinor: 0, availableMinor: 0, transferDueMinor: 5_000 });
    await expect(runSettlement({ runKey: `w1-${run}`, dryRun: false, actorId: adminId, reason: "run it twice", now: later(15) })).rejects.toThrow(/already/);
    const again = await runSettlement({ runKey: `w2-${run}`, dryRun: false, actorId: adminId, reason: "next week, nothing new", now: later(15) });
    expect(again.settled.find((s) => s.partyId === org)).toBeUndefined();
    expect(await ledgerIsBalanced()).toBe(true);
  });

  it("balances under the minimum payout carry forward (partner override)", async () => {
    const d = await call("POST", "/admin/commerce/rules/drafts", { key: "settlement", scopeType: "partner", scopeId: `org:${org}`, payload: { minPayoutMinor: 100_000 }, reason: "high threshold for test" }, "admin");
    await call("POST", `/admin/commerce/rules/${d.body.id}/publish`, { reason: "publish threshold" }, "admin");
    await paidBooking();
    const r = await runSettlement({ runKey: `w3-${run}`, dryRun: false, actorId: adminId, reason: "below threshold week", now: later(15) });
    expect(r.carried.find((c) => c.partyId === org)?.netMinor).toBe(5_000);
    expect(r.settled.find((s) => s.partyId === org)).toBeUndefined();
    expect((await partnerBalances(party)).availableMinor).toBe(5_000);
    await call("POST", `/admin/commerce/rules/${d.body.id}/retire`, { reason: "back to default threshold" }, "admin");
  });

  it("a refund after completion comes out of the available balance", async () => {
    const before = (await partnerBalances(party)).availableMinor;
    const { ref } = (await db.prepare(`SELECT c.source_ref as ref FROM order_completions c WHERE c.party_id = ? ORDER BY c.id DESC LIMIT 1`).get(org)) as { ref: string };
    const r = await call("POST", "/admin/finance/refunds", { sourceType: "experience", ref, amountMinor: 1_280, reason: "partial goodwill after event" }, "admin");
    expect(r.status).toBe(200);
    // 1,280 of 6,400 = 20% → partner share falls by 1,000.
    expect((await partnerBalances(party)).availableMinor).toBe(before - 1_000);
    expect(await ledgerIsBalanced()).toBe(true);
  });

  it("an open dispute blocks release; a partner-caused lost dispute is recovered from available", async () => {
    const { ref, sessionId } = await paidBooking();
    const dispute = (status: string, type: string) => processStripeEvent({ id: `evt_st_${run}_${status}`, type, created: 0, livemode: false, data: { object: { id: `dp_st_${run}`, payment_intent: `pi_stub_${sessionId}`, amount: 6_400, currency: "eur", reason: "product_not_received", status } } });
    await dispute("needs_response", "charge.dispute.created");
    const blocked = await runSettlement({ runKey: `w4-${run}`, dryRun: true, actorId: adminId, reason: "dispute open preview", now: later(15) });
    expect(blocked.released.find((x) => x.ref === ref)).toBeUndefined();
    await dispute("lost", "charge.dispute.closed");
    const d = (await db.prepare(`SELECT id FROM disputes WHERE provider_dispute_id = ?`).get(`dp_st_${run}`)) as { id: number };
    expect((await call("POST", `/admin/finance/disputes/${d.id}/recovery`, { responsible: "partner" }, "admin")).status).toBe(400);
    const before = (await partnerBalances(party)).availableMinor;
    const rec = await call("POST", `/admin/finance/disputes/${d.id}/recovery`, { responsible: "partner", reason: "service not delivered by partner" }, "admin");
    expect(rec.body).toEqual({ recovered: 6_400, allocations: [{ role: "vendor", partyType: "org", partyId: org, amountMinor: 6_400 }] }); // Stage 5e breakdown
    expect((await partnerBalances(party)).availableMinor).toBe(before - 6_400);
    expect((await call("POST", `/admin/finance/disputes/${d.id}/recovery`, { responsible: "platform", reason: "decide twice" }, "admin")).status).toBe(409);
    expect(await ledgerIsBalanced()).toBe(true);
  });
});

describe("fee reconciliation", () => {
  it("keeps the estimate fixed at payment, stores the actual fee beside it, and posts only the variance", async () => {
    const { id, ref, est, hash } = (await db
      .prepare(`SELECT id, source_ref as ref, fee_estimate_minor as est, fee_estimate_rule_hash as hash FROM payment_records WHERE source_type = 'experience' AND source_ref LIKE 'EX-%' ORDER BY id DESC LIMIT 1`)
      .get()) as { id: number; ref: string; est: number; hash: string };
    expect(Number(est)).toBe(121); // 1.5% + €0.25 of €64, fixed when the payment was confirmed
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    const r = await call("POST", "/admin/finance/fees/reconcile", {}, "admin");
    expect(r.status).toBe(200);
    expect(r.body.reconciled).toBeGreaterThan(0);
    const sum = async (account: string, basis?: string) =>
      Number(
        ((await db
          .prepare(
            `SELECT COALESCE(SUM(e.amount_minor), 0) as s FROM ledger_entries e JOIN ledger_entry_groups g ON g.id = e.group_id
             WHERE g.source_type = 'payment_fee' AND g.source_id = ? AND e.account_code = ? ${basis ? "AND g.basis = ?" : ""}`
          )
          .get(`experience:${ref}`, account, ...(basis ? [basis] : []))) as { s: number | string }).s
      );
    expect(await sum("processing_fee_expense", "estimate")).toBe(121); // the estimate is never reversed
    expect(await sum("processing_fee_variance")).toBe(-6); // actual 115 (1.4% + €0.25 from the stub) − 121
    expect(await sum("accrued_payment_costs")).toBe(0); // accrual cleared at the estimate
    expect(await sum("stripe_clearing")).toBe(-115); // what the provider actually took
    const rec = (await db.prepare(`SELECT estimate_minor as e, actual_minor as a, variance_minor as v, estimate_source as src FROM fee_reconciliations WHERE payment_record_id = ?`).get(id)) as Record<string, number | string>;
    expect([Number(rec.e), Number(rec.a), Number(rec.v), rec.src]).toEqual([121, 115, -6, "at_payment"]);
    expect(Number(((await db.prepare(`SELECT fee_estimate_minor as e FROM payment_records WHERE id = ?`).get(id)) as { e: number }).e)).toBe(121);
    const again = await call("POST", "/admin/finance/fees/reconcile", {}, "admin");
    expect(again.body.reconciled).toBe(0);
    expect(await ledgerIsBalanced()).toBe(true);
  });
});

describe("legacy snapshot backfill", () => {
  it("dry-run counts, apply creates once, original rows untouched", async () => {
    const legacyRef = `EX-LEG-${run}`;
    await db
      .prepare(
        `INSERT INTO experience_bookings (ref, experience_id, session_id, client_id, participant_name, email, party_size, subtotal_cents, discount_cents, vat_cents, platform_fee_cents, total_cents, payment_status, stripe_session_id)
         VALUES (?, ?, ?, ?, 'Legacy', 'leg@example.test', 1, 5000, 0, 1150, 250, 6400, 'paid', 'cs_legacy')`
      )
      .run(legacyRef, exp, session, client);
    const dry = await backfillLegacySnapshots({ dryRun: true });
    expect(dry.created).toBeGreaterThanOrEqual(1);
    expect(await db.prepare(`SELECT id FROM commerce_orders WHERE source_ref = ?`).get(legacyRef)).toBeUndefined();
    await backfillLegacySnapshots({ dryRun: false });
    const snap = (await db.prepare(`SELECT s.engine_version as v, s.partner_payout_minor as payout, s.customer_paid_minor as paid FROM pricing_snapshots s JOIN commerce_orders o ON o.id = s.order_id WHERE o.source_ref = ?`).get(legacyRef)) as Record<string, string | number>;
    expect({ v: snap.v, payout: Number(snap.payout), paid: Number(snap.paid) }).toEqual({ v: "legacy-backfill", payout: 5_000, paid: 6_400 });
    const second = await backfillLegacySnapshots({ dryRun: false });
    expect(Number(((await db.prepare(`SELECT COUNT(*) as n FROM commerce_orders WHERE source_ref = ?`).get(legacyRef)) as { n: number }).n)).toBe(1);
    expect(second.unrecoverable.find((u) => u.ref === legacyRef)).toBeUndefined();
  });
});

describe("partner earnings view", () => {
  it("vendor finance sees the organisation's pending, available and settled amounts", async () => {
    const r = await call("GET", "/vendor/earnings", undefined, "vendor");
    expect(r.status).toBe(200);
    expect(r.body.party).toEqual({ partyType: "org", partyId: org });
    expect(r.body.transferDueMinor).toBe(5_000);
    expect(r.body.settlements.length).toBeGreaterThan(0);
  });
});
