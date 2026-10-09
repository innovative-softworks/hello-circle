import crypto from "node:crypto";
import http, { type Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db, setSetting } from "../db/index.js";
import { refundPaidOnce } from "../checkoutService.js";
import { stubProvider } from "../payments/provider.js";
import { beginEvent, failEvent, MAX_ATTEMPTS, type IncomingEvent } from "../payments/webhookEvents.js";
import { adminRouter } from "../routes/admin.js";
import { experiencesRouter } from "../routes/experiences.js";
import { processProviderOutcome, processStripeEvent } from "../routes/stripeWebhook.js";
import { vendorOperationsRouter } from "../routes/vendorOperations.js";
import { groupLines, ledgerIsBalanced, postGroup, reverseGroup } from "./ledger.js";
import { legacyBreakdownFromTotal } from "./payments.js";

// Revenue & Connect Stage 2c — ledger, webhook event store, payment records,
// refunds (in-app full/partial, provider-side) and disputes, end to end on
// the network-free stub provider.

const run = crypto.randomUUID().slice(0, 8);
const vendorId = `fin-vendor-${run}`;
const adminId = `fin-admin-${run}`;
const exp = `fin-exp-${run}`;
const session = `fin-s-${run}`;
const client = crypto.randomUUID();
let server: Server;
let baseUrl: string;

function stubOn() {
  process.env.QA_E2E_ENABLED = "true";
  process.env.QA_PAYMENT_PROVIDER_STUB = "1";
}
function stubOff() {
  delete process.env.QA_E2E_ENABLED;
  delete process.env.QA_PAYMENT_PROVIDER_STUB;
}

beforeAll(async () => {
  await db.prepare(`INSERT INTO users (id, email, password_hash, role, status, name) VALUES (?, ?, 'x', 'vendor', 'approved', 'V')`).run(vendorId, `${vendorId}@example.test`);
  await db.prepare(`INSERT INTO users (id, email, password_hash, role, status, name, admin_role) VALUES (?, ?, 'x', 'admin', 'approved', 'A', 'finance')`).run(adminId, `${adminId}@example.test`);
  await db
    .prepare(
      `INSERT INTO experiences (id, vendor_id, title, blurb, description, fitness_requirements, itinerary, equipment_provided, equipment_required, transport_info, safety_info, weather_policy, eligibility, cancellation_terms, status, price_cents, capacity, payment_method)
       VALUES (?, ?, 'Ledger Hike', 'b', 'd', '', '', '', '', '', '', '', '', '', 'approved', 5000, 500, 'online')`
    )
    .run(exp, vendorId);
  await db.prepare(`INSERT INTO experience_sessions (id, experience_id, date, time) VALUES (?, ?, ?, '10:00')`).run(session, exp, new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10));
  await setSetting("commerce.settlement_ledger", "true");
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    if (req.header("X-Test-Role") === "admin") (req as any).user = { id: adminId, role: "admin", status: "approved", adminRole: "finance" };
    if (req.header("X-Test-Role") === "vendor") {
      (req as any).user = { id: vendorId, role: "vendor", status: "approved", invitedStaff: false };
      (req as any).vendorIds = [vendorId];
    }
    next();
  });
  app.use("/experiences", experiencesRouter);
  app.use("/admin", adminRouter);
  app.use("/vendor", vendorOperationsRouter);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Failed to bind test server");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  stubOff();
  await setSetting("commerce.settlement_ledger", "false");
  const refs = ((await db.prepare(`SELECT ref FROM experience_bookings WHERE experience_id = ?`).all(exp)) as { ref: string }[]).map((r) => r.ref);
  const keys = [...refs, `t-${run}`];
  for (const k of keys) {
    const groups = (await db.prepare(`SELECT id FROM ledger_entry_groups WHERE source_id = ? OR idempotency_key LIKE ?`).all(k, `%${k}%`)) as { id: string }[];
    for (const g of groups) await db.prepare(`DELETE FROM ledger_entries WHERE group_id = ?`).run(g.id);
    for (const g of groups) await db.prepare(`DELETE FROM ledger_entry_groups WHERE id = ?`).run(g.id);
  }
  const refundGroups = (await db.prepare(`SELECT g.id FROM ledger_entry_groups g JOIN refunds r ON g.source_type = 'refund' AND g.source_id = CAST(r.id AS CHAR) WHERE r.source_ref IN (${refs.map(() => "?").join(",") || "''"})`).all(...refs)) as { id: string }[];
  for (const g of refundGroups) {
    await db.prepare(`DELETE FROM ledger_entries WHERE group_id = ?`).run(g.id);
    await db.prepare(`DELETE FROM ledger_entry_groups WHERE id = ?`).run(g.id);
  }
  const disputeGroups = (await db.prepare(`SELECT id FROM ledger_entry_groups WHERE source_type = 'dispute' AND source_id LIKE ?`).all(`dp_${run}%`)) as { id: string }[];
  for (const g of disputeGroups) {
    await db.prepare(`DELETE FROM ledger_entries WHERE group_id = ?`).run(g.id);
    await db.prepare(`DELETE FROM ledger_entry_groups WHERE id = ?`).run(g.id);
  }
  if (refs.length) {
    await db.prepare(`DELETE FROM refunds WHERE source_ref IN (${refs.map(() => "?").join(",")})`).run(...refs);
    await db.prepare(`DELETE FROM payment_records WHERE source_ref IN (${refs.map(() => "?").join(",")})`).run(...refs);
  }
  await db.prepare(`DELETE FROM disputes WHERE provider_dispute_id LIKE ?`).run(`dp_${run}%`);
  await db.prepare(`DELETE FROM webhook_events WHERE event_id LIKE ?`).run(`evt_${run}%`);
  await db.prepare(`DELETE FROM notifications WHERE listing_id = ?`).run(exp);
  await db.prepare(`DELETE FROM experience_bookings WHERE experience_id = ?`).run(exp);
  await db.prepare(`DELETE FROM experience_sessions WHERE experience_id = ?`).run(exp);
  await db.prepare(`DELETE FROM experiences WHERE id = ?`).run(exp);
  await db.prepare(`DELETE FROM audit_log WHERE actor_user_id IN (?, ?)`).run(adminId, vendorId);
  await db.prepare(`DELETE FROM users WHERE id IN (?, ?)`).run(vendorId, adminId);
});

const call = (method: string, path: string, body?: unknown, role?: "admin" | "vendor") =>
  fetch(`${baseUrl}${path}`, { method, headers: { "Content-Type": "application/json", "X-Client-Id": client, ...(role ? { "X-Test-Role": role } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) }).then(async (r) => ({ status: r.status, body: await r.json() }));

/** Books and pays one online experience (party of 1 = €50 → €64 with legacy VAT + fee). */
async function paidBooking(): Promise<{ ref: string; sessionId: string }> {
  stubOn();
  const r = await call("POST", `/experiences/${exp}/sessions/${session}/checkout`, { participantName: "Ledger", email: "l@example.test", partySize: 1 });
  expect(r.status).toBe(201);
  const row = (await db.prepare(`SELECT stripe_session_id as sid FROM experience_bookings WHERE ref = ?`).get(r.body.ref)) as { sid: string };
  stubProvider.markPaid(row.sid, 6_400);
  await processProviderOutcome("experience", r.body.ref, "success");
  return { ref: r.body.ref, sessionId: row.sid };
}

async function accountNet(ref: string, account: string): Promise<number> {
  const { n } = (await db
    .prepare(
      `SELECT COALESCE(SUM(e.amount_minor), 0) as n FROM ledger_entries e JOIN ledger_entry_groups g ON g.id = e.group_id
       WHERE e.account_code = ? AND (g.idempotency_key = ? OR (g.source_type = 'refund' AND g.source_id IN (SELECT CAST(id AS CHAR) FROM refunds WHERE source_ref = ?)))`
    )
    .get(account, `payment:experience:${ref}`, ref)) as { n: number | string };
  return Number(n);
}

describe("ledger primitives", () => {
  it("refuses unbalanced groups and posts a key once", async () => {
    await expect(db.transaction((tx) => postGroup(tx, { idempotencyKey: `t-${run}-bad`, sourceType: "test", sourceId: `t-${run}`, description: "x", basis: "actual", currency: "EUR", lines: [{ account: "stripe_clearing", amountMinor: 100 }, { account: "platform_fee_revenue", amountMinor: -99 }] }))).rejects.toThrow(/balance/);
    const post = () => db.transaction((tx) => postGroup(tx, { idempotencyKey: `t-${run}-ok`, sourceType: "test", sourceId: `t-${run}`, description: "x", basis: "actual", currency: "EUR", lines: [{ account: "stripe_clearing", amountMinor: 1_000 }, { account: "platform_fee_revenue", amountMinor: -1_000 }] }));
    const a = await post();
    const b = await post();
    expect(a.created).toBe(true);
    expect(b).toEqual({ groupId: a.groupId, created: false });
  });

  it("proportional reversal balances exactly even with awkward ratios", async () => {
    const g = await db.transaction((tx) =>
      postGroup(tx, {
        idempotencyKey: `t-${run}-prop`,
        sourceType: "test",
        sourceId: `t-${run}`,
        description: "x",
        basis: "actual",
        currency: "EUR",
        lines: [
          { account: "stripe_clearing", amountMinor: 6_401 },
          { account: "partner_payable", amountMinor: -5_001 },
          { account: "underlying_tax_payable", amountMinor: -1_150 },
          { account: "platform_fee_revenue", amountMinor: -250 },
        ],
      })
    );
    const rev = await db.transaction((tx) => reverseGroup(tx, g.groupId, { idempotencyKey: `t-${run}-prop-r`, sourceType: "test", sourceId: `t-${run}`, description: "partial", ratio: { numerator: 1_000, denominator: 6_401 } }));
    const lines = await groupLines(db, rev.groupId);
    expect(lines.reduce((a, l) => a + l.amountMinor, 0)).toBe(0);
    expect(lines.find((l) => l.account === "stripe_clearing")?.amountMinor).toBe(-1_000);
  });

  it("the whole ledger always nets to zero", async () => {
    expect(await ledgerIsBalanced()).toBe(true);
  });
});

describe("legacy breakdown recovery", () => {
  it("finds the unique taxable amount behind a legacy total, or refuses", () => {
    expect(legacyBreakdownFromTotal(6_400, 2_300, 500)).toEqual({ taxable: 5_000, vat: 1_150, fee: 250 });
    for (let t = 1; t < 20_000; t += 37) {
      const total = t + Math.round(t * 0.23) + Math.round(t * 0.05);
      expect(legacyBreakdownFromTotal(total, 2_300, 500)?.taxable).toBe(t);
    }
  });
});

describe("payments → ledger", () => {
  beforeEach(() => stubProvider.reset());

  it("a confirmed payment is recorded once and posted as a balanced group", async () => {
    const { ref, sessionId } = await paidBooking();
    await processProviderOutcome("experience", ref, "success"); // duplicate delivery
    const records = (await db.prepare(`SELECT payment_intent_id as pi, amount_minor as amount FROM payment_records WHERE source_type = 'experience' AND source_ref = ?`).all(ref)) as { pi: string; amount: number }[];
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ pi: `pi_stub_${sessionId}` });
    const g = (await db.prepare(`SELECT id FROM ledger_entry_groups WHERE idempotency_key = ?`).get(`payment:experience:${ref}`)) as { id: string };
    const lines = await groupLines(db, g.id);
    expect(Object.fromEntries(lines.map((l) => [l.account, l.amountMinor]))).toEqual({
      stripe_clearing: 6_400,
      partner_payable: -5_000,
      platform_fee_revenue: -250,
      underlying_tax_payable: -1_150,
    });
    expect(lines.find((l) => l.account === "partner_payable")).toMatchObject({ partyType: "vendor", partyId: vendorId });
  });

  it("partial then remaining refund: exact amounts, order stays paid until the end, ledger fully reversed", async () => {
    const { ref } = await paidBooking();
    const p1 = await call("POST", "/vendor/refunds", { sourceType: "experience", ref, amountMinor: 1_000, reason: "deposit returned early" }, "vendor");
    expect(p1.status).toBe(200);
    expect(p1.body).toMatchObject({ amountMinor: 1_000, full: false });
    expect(((await db.prepare(`SELECT payment_status as ps FROM experience_bookings WHERE ref = ?`).get(ref)) as { ps: string }).ps).toBe("paid");
    expect((await call("POST", "/vendor/refunds", { sourceType: "experience", ref, amountMinor: 9_999, reason: "too much" }, "vendor")).status).toBe(409);
    const rest = await call("POST", "/admin/finance/refunds", { sourceType: "experience", ref, reason: "customer cancelled", responsible: "customer" }, "admin");
    expect(rest.body).toMatchObject({ amountMinor: 5_400, full: true });
    expect(((await db.prepare(`SELECT payment_status as ps FROM experience_bookings WHERE ref = ?`).get(ref)) as { ps: string }).ps).toBe("refunded");
    expect(await accountNet(ref, "stripe_clearing")).toBe(0);
    expect(await accountNet(ref, "partner_payable")).toBe(0);
    expect(await ledgerIsBalanced()).toBe(true);
  });

  it("a vendor can't refund another organisation's order", async () => {
    const { ref } = await paidBooking();
    await db.prepare(`UPDATE experiences SET vendor_id = 'someone-else' WHERE id = ?`).run(exp);
    try {
      expect((await call("POST", "/vendor/refunds", { sourceType: "experience", ref, amountMinor: 100, reason: "not mine" }, "vendor")).status).toBe(404);
    } finally {
      await db.prepare(`UPDATE experiences SET vendor_id = ? WHERE id = ?`).run(vendorId, exp);
    }
  });

  it("refundPaidOnce (vendor/host full refund) records the refund and reverses the ledger", async () => {
    const { ref, sessionId } = await paidBooking();
    const r = await refundPaidOnce("experience_bookings", "ref = ?", [ref], sessionId, "already refunded", { actorUserId: vendorId, objectType: "experience_booking", objectId: ref });
    expect(r).toMatchObject({ ok: true, amountCents: 6_400 });
    const refunds = (await db.prepare(`SELECT kind, status, amount_minor as amount FROM refunds WHERE source_ref = ?`).all(ref)) as { amount: number }[];
    expect(refunds).toEqual([{ kind: "full", status: "succeeded", amount: 6_400 }]);
    expect(await accountNet(ref, "stripe_clearing")).toBe(0);
  });

  it("charge.refunded for a refund we already made records nothing new; a Dashboard refund is recorded once", async () => {
    const { ref, sessionId } = await paidBooking();
    await call("POST", "/admin/finance/refunds", { sourceType: "experience", ref, amountMinor: 2_000, reason: "goodwill partial" }, "admin");
    const event = (amountRefunded: number): IncomingEvent => ({ id: `evt_${run}_${amountRefunded}_${ref}`, type: "charge.refunded", created: 0, livemode: false, data: { object: { id: `ch_${ref}`, object: "charge", payment_intent: `pi_stub_${sessionId}`, amount: 6_400, amount_refunded: amountRefunded, currency: "eur" } } });
    await processStripeEvent(event(2_000));
    expect(((await db.prepare(`SELECT COUNT(*) as n FROM refunds WHERE source_ref = ?`).get(ref)) as { n: number }).n).toBe(1);
    // Someone refunds the rest from the Stripe Dashboard.
    await processStripeEvent(event(6_400));
    await processStripeEvent(event(6_400)); // replayed
    const rows = (await db.prepare(`SELECT origin, amount_minor as amount FROM refunds WHERE source_ref = ? ORDER BY id`).all(ref)) as { origin: string; amount: number }[];
    expect(rows.map((r) => [r.origin, Number(r.amount)])).toEqual([["in_app", 2_000], ["provider", 4_400]]);
    expect(((await db.prepare(`SELECT payment_status as ps FROM experience_bookings WHERE ref = ?`).get(ref)) as { ps: string }).ps).toBe("refunded");
    expect(await accountNet(ref, "stripe_clearing")).toBe(0);
  });

  it("a refund for an unknown payment needs manual review", async () => {
    await expect(processStripeEvent({ id: `evt_${run}_unknown`, type: "charge.refunded", created: 0, livemode: false, data: { object: { id: "ch_x", payment_intent: "pi_unknown", amount: 100, amount_refunded: 100, currency: "eur" } } })).rejects.toThrow(/manual/);
  });
});

describe("disputes", () => {
  it("opened → lost posts the loss and marks recovery pending; out-of-order events can't reopen it", async () => {
    const { sessionId } = await paidBooking();
    const ev = (status: string, type = "charge.dispute.updated"): IncomingEvent => ({ id: `evt_${run}_dp_${status}`, type, created: 0, livemode: false, data: { object: { id: `dp_${run}_1`, payment_intent: `pi_stub_${sessionId}`, amount: 6_400, currency: "eur", reason: "fraudulent", status, evidence_details: { due_by: Math.floor(Date.now() / 1000) + 7 * 86400 } } } });
    await processStripeEvent(ev("needs_response", "charge.dispute.created"));
    await processStripeEvent(ev("lost", "charge.dispute.closed"));
    await processStripeEvent(ev("needs_response")); // late, out-of-order update
    const d = (await db.prepare(`SELECT status, recovery_status as recovery, source_type as type FROM disputes WHERE provider_dispute_id = ?`).get(`dp_${run}_1`)) as Record<string, string>;
    expect(d).toEqual({ status: "lost", recovery: "pending", type: "experience" });
    const groups = ((await db.prepare(`SELECT idempotency_key as k FROM ledger_entry_groups WHERE source_type = 'dispute' AND source_id = ? ORDER BY k`).all(`dp_${run}_1`)) as { k: string }[]).map((g) => g.k);
    expect(groups).toEqual([`dispute:dp_${run}_1:lost`, `dispute:dp_${run}_1:opened`]);
    expect(await ledgerIsBalanced()).toBe(true);
  });
});

describe("webhook event store", () => {
  const ev = (id: string): IncomingEvent => ({ id, type: "payment_intent.succeeded", created: 1_700_000_000, livemode: false, data: { object: { id: "pi_1", object: "payment_intent", amount: 100, currency: "eur", metadata: { type: "booking", ref: "X" }, customer_email: "secret@example.test" } } });

  it("stores each event once and treats redelivery as a duplicate", async () => {
    const id = `evt_${run}_dup`;
    const first = await beginEvent("stripe", ev(id), "{}");
    expect(first.action).toBe("process");
    const busy = await beginEvent("stripe", ev(id), "{}");
    expect(busy.action).toBe("busy");
    await db.prepare(`UPDATE webhook_events SET status = 'processed' WHERE event_id = ?`).run(id);
    expect(await beginEvent("stripe", ev(id), "{}")).toEqual({ action: "duplicate", status: "processed" });
  });

  it("keeps only a minimal summary (no personal data)", async () => {
    const id = `evt_${run}_pii`;
    await beginEvent("stripe", ev(id), "{}");
    const row = (await db.prepare(`SELECT summary FROM webhook_events WHERE event_id = ?`).get(id)) as { summary: string };
    expect(row.summary).not.toContain("secret@example.test");
    expect(JSON.parse(row.summary)).toMatchObject({ id: "pi_1", amount: 100, metadata: { type: "booking", ref: "X" } });
  });

  it("retries failures, then parks the event for manual review", async () => {
    const id = `evt_${run}_fail`;
    let retry = true;
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      const b = await beginEvent("stripe", ev(id), "{}");
      expect(b.action).toBe("process");
      retry = await failEvent((b as { rowId: number }).rowId, new Error("boom"));
    }
    expect(retry).toBe(false);
    expect(((await db.prepare(`SELECT status FROM webhook_events WHERE event_id = ?`).get(id)) as { status: string }).status).toBe("manual_review");
    expect((await beginEvent("stripe", ev(id), "{}")).action).toBe("duplicate");
  });

  it("a finance admin replays a parked event (re-fetched from the provider), with a reason", async () => {
    stubOn();
    const id = `evt_${run}_fail`;
    stubProvider.publishEvent(ev(id));
    const row = (await db.prepare(`SELECT id FROM webhook_events WHERE event_id = ?`).get(id)) as { id: number };
    expect((await call("POST", `/admin/finance/webhooks/${row.id}/replay`, {}, "admin")).status).toBe(400);
    const r = await call("POST", `/admin/finance/webhooks/${row.id}/replay`, { reason: "handler fixed, replaying" }, "admin");
    expect(r.body).toEqual({ ok: true, outcome: "ignored" });
    expect(((await db.prepare(`SELECT status FROM webhook_events WHERE event_id = ?`).get(id)) as { status: string }).status).toBe("ignored");
  });

  it("finance views list balances and confirm the ledger nets to zero", async () => {
    const r = await call("GET", "/admin/finance/ledger/balances", undefined, "admin");
    expect(r.body.balanced).toBe(true);
    expect(r.body.accounts.length).toBeGreaterThan(0);
  });
});
