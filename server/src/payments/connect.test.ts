import crypto from "node:crypto";
import http, { type Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db, setSetting } from "../db/index.js";
import { ledgerIsBalanced, postGroup } from "../commerce/ledger.js";
import { partnerBalances } from "../commerce/settlement.js";
import { adminRouter } from "../routes/admin.js";
import { vendorPayoutsRouter } from "../routes/payouts.js";
import { processStripeEvent } from "../routes/stripeWebhook.js";
import { payoutReadiness, runTransfers } from "./connect.js";
import { stubProvider } from "./provider.js";

// Revenue & Connect Stage 5a — Stripe Connect against the stub provider:
// onboarding, readiness gates (account + trader details), transfers of due
// settlements (idempotent, failure vs unknown outcome), ledger postings,
// recovery of a negative balance by transfer reversal, and connected-account
// webhooks (account.updated, payout.*, transfer.reversed outside the app).

const run = crypto.randomUUID().slice(0, 8);
const org = `cx-org-${run}`;
const vendorId = `cx-vendor-${run}`;
const adminId = `cx-admin-${run}`;
const party = { partyType: "org" as const, partyId: org };
let server: Server;
let baseUrl: string;
let runId: number;

beforeAll(async () => {
  await db.prepare(`INSERT INTO organisations (id, name) VALUES (?, 'Connect Org')`).run(org);
  await db.prepare(`INSERT INTO users (id, email, password_hash, role, status, name, org_id) VALUES (?, ?, 'x', 'vendor', 'approved', 'V', ?)`).run(vendorId, `${vendorId}@example.test`, org);
  await db.prepare(`INSERT INTO users (id, email, password_hash, role, status, name, admin_role) VALUES (?, ?, 'x', 'admin', 'approved', 'A', 'finance')`).run(adminId, `${adminId}@example.test`);
  const r = await db.prepare(`INSERT INTO settlement_runs (run_key, dry_run, status, started_by, reason) VALUES (?, 0, 'completed', ?, 'connect test')`).run(`cx-${run}`, adminId);
  runId = Number(r.lastInsertRowid);
  await setSetting("commerce.settlement_ledger", "true");
  process.env.QA_E2E_ENABLED = "true";
  process.env.QA_PAYMENT_PROVIDER_STUB = "1";
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    if (req.header("X-Test-Role") === "admin") (req as any).user = { id: adminId, email: `${adminId}@example.test`, role: "admin", status: "approved", adminRole: "finance" };
    if (req.header("X-Test-Role") === "vendor") (req as any).user = { id: vendorId, email: `${vendorId}@example.test`, role: "vendor", status: "approved", orgId: org, invitedStaff: false };
    next();
  });
  app.use("/vendor/payout-account", vendorPayoutsRouter);
  app.use("/admin", adminRouter);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Failed to bind test server");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

beforeEach(async () => {
  await setSetting("commerce.connect_v1", "true");
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  delete process.env.QA_E2E_ENABLED;
  delete process.env.QA_PAYMENT_PROVIDER_STUB;
  await setSetting("commerce.settlement_ledger", "false");
  await setSetting("commerce.connect_v1", "false");
  const groups = (await db.prepare(`SELECT DISTINCT group_id as id FROM ledger_entries WHERE party_id = ?`).all(org)) as { id: string }[];
  for (const g of groups) {
    await db.prepare(`DELETE FROM ledger_entries WHERE group_id = ?`).run(g.id);
    await db.prepare(`DELETE FROM ledger_entry_groups WHERE id = ?`).run(g.id);
  }
  await db.prepare(`DELETE FROM transfer_allocation_reversals WHERE allocation_id IN (SELECT id FROM transfer_allocations WHERE party_id = ?)`).run(org);
  await db.prepare(`DELETE FROM transfer_allocations WHERE party_id = ?`).run(org);
  await db.prepare(`DELETE FROM partner_debts WHERE party_id = ?`).run(org);
  await db.prepare(`DELETE FROM settlement_items WHERE settlement_id IN (SELECT id FROM settlements WHERE party_id = ?)`).run(org);
  await db.prepare(`DELETE FROM transfer_reversals WHERE transfer_id IN (SELECT id FROM transfers WHERE party_id = ?)`).run(org);
  await db.prepare(`DELETE FROM transfers WHERE party_id = ?`).run(org);
  await db.prepare(`DELETE FROM connected_payouts WHERE account_id IN (SELECT account_id FROM connected_accounts WHERE party_id = ?)`).run(org);
  await db.prepare(`DELETE FROM connected_accounts WHERE party_id = ?`).run(org);
  await db.prepare(`DELETE FROM settlements WHERE party_id = ?`).run(org);
  await db.prepare(`DELETE FROM settlement_runs WHERE id = ?`).run(runId);
  await db.prepare(`DELETE FROM trader_profiles WHERE party_id = ?`).run(org);
  await db.prepare(`DELETE FROM webhook_events WHERE event_id LIKE ?`).run(`evt_cx_${run}%`);
  await db.prepare(`DELETE FROM audit_log WHERE actor_user_id IN (?, ?)`).run(adminId, vendorId);
  await db.prepare(`DELETE FROM users WHERE id IN (?, ?)`).run(vendorId, adminId);
  await db.prepare(`DELETE FROM organisations WHERE id = ?`).run(org);
});

const call = (method: string, path: string, body?: unknown, role?: "admin" | "vendor") =>
  fetch(`${baseUrl}${path}`, { method, headers: { "Content-Type": "application/json", ...(role ? { "X-Test-Role": role } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) }).then(async (r) => ({ status: r.status, body: await r.json() }));

/** A settlement that's due: one released booking (available) settled into
 * settlement_payable, with its settlement item — exactly as runSettlement does it. */
let bookingSeq = 0;
async function dueSettlement(netMinor: number): Promise<number> {
  const ref = `CX-${run}-${++bookingSeq}`;
  // Fund partner_available first (as a release would), balanced against cash.
  const release = await db.transaction((tx) =>
    postGroup(tx, {
      idempotencyKey: `release:experience:${ref}`,
      sourceType: "experience",
      sourceId: ref,
      description: "test release",
      basis: "actual",
      currency: "EUR",
      lines: [
        { account: "stripe_clearing", amountMinor: netMinor },
        { account: "partner_available", amountMinor: -netMinor, partyType: party.partyType, partyId: party.partyId },
      ],
    })
  );
  const r = await db.prepare(`INSERT INTO settlements (run_id, party_type, party_id, currency, net_minor, status) VALUES (?, ?, ?, 'EUR', ?, 'due')`).run(runId, party.partyType, `${party.partyId}`, netMinor);
  const id = Number(r.lastInsertRowid);
  await db.prepare(`INSERT INTO settlement_items (settlement_id, ledger_group_id, description, amount_minor) VALUES (?, ?, ?, ?)`).run(id, release.groupId, `Completed experience ${ref}`, netMinor);
  await db.transaction((tx) =>
    postGroup(tx, {
      idempotencyKey: `settlement:${id}`,
      sourceType: "settlement",
      sourceId: String(id),
      description: "test settlement",
      basis: "actual",
      currency: "EUR",
      lines: [
        { account: "partner_available", amountMinor: netMinor, partyType: party.partyType, partyId: party.partyId },
        { account: "settlement_payable", amountMinor: -netMinor, partyType: party.partyType, partyId: party.partyId },
      ],
    })
  );
  return id;
}

async function newRun(): Promise<void> {
  const r = await db.prepare(`INSERT INTO settlement_runs (run_key, dry_run, status, started_by, reason) VALUES (?, 0, 'completed', ?, 'connect test')`).run(`cx-${run}-${crypto.randomUUID().slice(0, 6)}`, adminId);
  runId = Number(r.lastInsertRowid);
}

const reason = "weekly payout run";

describe("onboarding and readiness", () => {
  it("is refused while the Connect switch is off", async () => {
    await setSetting("commerce.connect_v1", "false");
    expect((await call("POST", "/vendor/payout-account/onboarding", {}, "vendor")).status).toBe(409);
  });

  it("creates one Express account per organisation and returns a hosted onboarding link", async () => {
    expect((await call("POST", "/vendor/payout-account/onboarding", { country: "FR" }, "vendor")).status).toBe(409);
    const a = await call("POST", "/vendor/payout-account/onboarding", {}, "vendor");
    expect(a.status).toBe(200);
    expect(a.body.url).toMatch(/^https:\/\/connect\.stub\.invalid\/onboarding\/acct_stub_/);
    const b = await call("POST", "/vendor/payout-account/onboarding", {}, "vendor");
    expect(b.body.url).toBe(a.body.url);
    const rows = (await db.prepare(`SELECT COUNT(*) as n FROM connected_accounts WHERE party_id = ?`).get(org)) as { n: number };
    expect(Number(rows.n)).toBe(1);
    const created = stubProvider.calls.filter((c) => c.method === "createConnectedAccount");
    // Stage 5e — one reservation per partner; its key is reused on every retry.
    expect(created.at(-1)?.args).toMatchObject({ country: "IE", idempotencyKey: `hc-acct-v2:org:${org}` });
    expect(created).toHaveLength(1);
  });

  it("holds transfers until the account is verified and trader details are self-certified", async () => {
    const reasons = await payoutReadiness(party);
    expect(reasons).toEqual(expect.arrayContaining([expect.stringMatching(/can't receive transfers/), expect.stringMatching(/Trader details/)]));

    const acct = (await db.prepare(`SELECT account_id as id FROM connected_accounts WHERE party_id = ?`).get(org)) as { id: string };
    // Stage 5e — the account changes at Stripe; account.updated only triggers a
    // re-fetch (its payload is never trusted for state).
    stubProvider.setAccount(acct.id, { detailsSubmitted: true, payoutsEnabled: true, transfersCapability: "active", requirementsDue: [], disabledReason: null });
    await processStripeEvent({
      id: `evt_cx_${run}_acct`,
      type: "account.updated",
      created: 0,
      livemode: false,
      account: acct.id,
      data: { object: { id: acct.id, country: "IE", details_submitted: false, charges_enabled: false, payouts_enabled: false, capabilities: { transfers: "inactive" }, requirements: { currently_due: ["stale"], past_due: [], disabled_reason: null } } },
    });
    expect(await payoutReadiness(party)).toEqual([expect.stringMatching(/Trader details/)]);
    await db
      .prepare(`INSERT INTO trader_profiles (party_type, party_id, entity_type, legal_name, address, country, email, phone, company_number, self_certified_at) VALUES ('org', ?, 'company', 'Connect Org Ltd', '1 St', 'IE', 'c@example.test', '1', '123', NOW())`)
      .run(org);
    expect(await payoutReadiness(party)).toEqual([]);
    stubProvider.setAccount(acct.id, { detailsSubmitted: true, payoutsEnabled: true, transfersCapability: "active", requirementsDue: [], disabledReason: null });
    const overview = await call("POST", "/vendor/payout-account/refresh", {}, "vendor");
    expect(overview.body).toMatchObject({ enabled: true, readiness: [], account: { transfersActive: true, payoutsEnabled: true } });
  });
});

describe("transfers", () => {
  it("dry run reports, the real run transfers once, posts the ledger and is idempotent", async () => {
    const id = await dueSettlement(8_893);
    const dry = await call("POST", "/admin/finance/transfers/run", { reason }, "admin");
    expect(dry.body).toMatchObject({ dryRun: true, transferred: [{ settlementId: id, amountMinor: 8_893 }] });
    expect(stubProvider.calls.filter((c) => c.method === "createTransfer")).toHaveLength(0);

    const real = await call("POST", "/admin/finance/transfers/run", { reason, dryRun: false }, "admin");
    expect(real.body.transferred).toEqual([{ settlementId: id, amountMinor: 8_893, transferId: expect.stringMatching(/^tr_stub_/) }]);
    const sent = stubProvider.calls.filter((c) => c.method === "createTransfer").at(-1)!.args as Record<string, unknown>;
    expect(sent).toMatchObject({ amountMinor: 8_893, currency: "EUR", transferGroup: `settlement:${id}`, idempotencyKey: `settlement:${id}:1` });

    const s = (await db.prepare(`SELECT status, transfer_id as t FROM settlements WHERE id = ?`).get(id)) as { status: string; t: string };
    expect(s.status).toBe("transferred");
    expect((await partnerBalances(party)).transferDueMinor).toBe(0);
    expect(await ledgerIsBalanced()).toBe(true);

    const again = await call("POST", "/admin/finance/transfers/run", { reason, dryRun: false }, "admin");
    expect(again.body.transferred).toEqual([]);
    expect(stubProvider.calls.filter((c) => c.method === "createTransfer")).toHaveLength(1);
  });

  it("a definitive refusal fails the attempt (next run uses a new key); an unseen outcome retries with the same key", async () => {
    await newRun();
    const id = await dueSettlement(2_500);
    stubProvider.failNextTransfer = Object.assign(new Error("Insufficient funds in your Stripe balance"), { code: "balance_insufficient", type: "StripeInvalidRequestError" });
    const r1 = await runTransfers({ dryRun: false, actorId: adminId, reason });
    expect(r1.failed).toEqual([{ settlementId: id, status: "failed", error: expect.stringMatching(/Insufficient/) }]);

    stubProvider.failNextTransfer = Object.assign(new Error("socket hang up"), { type: "StripeConnectionError" });
    const r2 = await runTransfers({ dryRun: false, actorId: adminId, reason });
    expect(r2.failed[0]).toMatchObject({ status: "unknown" });

    const r3 = await runTransfers({ dryRun: false, actorId: adminId, reason });
    expect(r3.transferred).toHaveLength(1);
    const attempts = (await db.prepare(`SELECT attempt, status, idempotency_key as k FROM transfers WHERE settlement_id = ? ORDER BY attempt`).all(id)) as { attempt: number; status: string; k: string }[];
    expect(attempts).toEqual([
      { attempt: 1, status: "failed", k: `settlement:${id}:1` },
      { attempt: 2, status: "created", k: `settlement:${id}:2` },
    ]);
  });

  it("needs the finance role and a reason", async () => {
    expect((await call("POST", "/admin/finance/transfers/run", { reason: "x" }, "admin")).status).toBe(400);
    expect((await call("POST", "/admin/finance/transfers/run", { reason })).status).toBe(401);
  });
});

describe("transfer allocations", () => {
  it("every transfer is split into immutable per-booking allocations that sum to it", async () => {
    const t = (await db.prepare(`SELECT id, amount_minor as a FROM transfers WHERE party_id = ? AND status = 'created' ORDER BY id`).all(org)) as { id: number; a: number }[];
    expect(t.length).toBe(2);
    for (const x of t) {
      const r = await call("GET", `/admin/finance/transfers/${x.id}/allocations`, undefined, "admin");
      expect(r.body).toEqual([expect.objectContaining({ kind: "booking", sourceType: "experience", sourceRef: expect.stringMatching(/^CX-/), amountMinor: Number(x.a) })]);
    }
  });
});

describe("partner debt", () => {
  it("needs a reason and something owed", async () => {
    expect((await call("POST", `/admin/finance/partners/org/${org}/debts`, { reason: "short" }, "admin")).status).toBe(400);
    expect((await call("POST", `/admin/finance/partners/org/${org}/debts`, { reason: "nothing is owed yet here" }, "admin")).status).toBe(409);
  });

  it("freezes earnings, reverses the partner's own newest allocations, and records recovered vs unrecovered", async () => {
    // A lost dispute the partner is responsible for: €30 recovered from available (Stage 2d posting shape).
    await db.transaction((tx) =>
      postGroup(tx, {
        idempotencyKey: `cx-dispute:${run}`,
        sourceType: "test",
        sourceId: run,
        description: "partner-responsible dispute",
        basis: "actual",
        currency: "EUR",
        lines: [
          { account: "partner_available", amountMinor: 3_000, partyType: party.partyType, partyId: party.partyId },
          { account: "chargeback_loss", amountMinor: -3_000 },
        ],
      })
    );
    expect((await partnerBalances(party)).availableMinor).toBe(-3_000);
    // First attempt: the provider refuses the first reversal → part recovered, part still owed, still frozen.
    stubProvider.failNextReversal = Object.assign(new Error("Transfer already paid out"), { code: "insufficient_funds", type: "StripeInvalidRequestError" });
    const r = await call("POST", `/admin/finance/partners/org/${org}/debts`, { reason: "Chargeback lost: activity did not take place" }, "admin");
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ recoveredMinor: 500, unrecoveredMinor: 2_500, status: "open" });
    expect(r.body.reversals).toEqual([
      expect.objectContaining({ amountMinor: 2_500, status: "failed" }),
      expect.objectContaining({ amountMinor: 500, status: "created" }),
    ]);
    expect(await payoutReadiness(party)).toEqual([expect.stringMatching(/Earnings frozen: open partner debt/)]);
    // A new due settlement for this partner is held, not transferred, while frozen.
    await newRun();
    const held = await dueSettlement(1_000);
    const run2 = await runTransfers({ dryRun: false, actorId: adminId, reason });
    expect(run2.held).toEqual([expect.objectContaining({ settlementId: held, reasons: [expect.stringMatching(/frozen/)] })]);

    // Retry recovers the rest from the (now free again) newest allocation.
    const retry = await call("POST", `/admin/finance/debts/${r.body.debtId}/retry`, { reason: "retry after refusal" }, "admin");
    expect(retry.body).toMatchObject({ recoveredMinor: 2_500, unrecoveredMinor: 0, status: "recovered" });
    expect((await partnerBalances(party)).availableMinor).toBe(0);
    const t = (await db.prepare(`SELECT amount_minor as a, reversed_minor as r, status FROM transfers WHERE party_id = ? AND status <> 'failed' ORDER BY id`).all(org)) as { a: number; r: number; status: string }[];
    expect(t.map((x) => [Number(x.a), Number(x.r), x.status])).toEqual([
      [8_893, 500, "partially_reversed"],
      [2_500, 2_500, "reversed"],
    ]);
    // Allocation rows themselves are never changed; reversals sit beside them.
    const allocs = (await db.prepare(`SELECT a.amount_minor as a FROM transfer_allocations a WHERE a.party_id = ? ORDER BY a.id`).all(org)) as { a: number }[];
    expect(allocs.map((x) => Number(x.a))).toEqual([8_893, 2_500]);
    expect(await ledgerIsBalanced()).toBe(true);
    // Debt closed → the held settlement can go now.
    expect(await payoutReadiness(party)).toEqual([]);
    expect((await runTransfers({ dryRun: false, actorId: adminId, reason })).transferred).toEqual([expect.objectContaining({ settlementId: held })]);
  });

  it("reverses part of a single booking's allocation, never beyond what the partner owes", async () => {
    await db.transaction((tx) =>
      postGroup(tx, {
        idempotencyKey: `cx-refund-after-transfer:${run}`,
        sourceType: "test",
        sourceId: run,
        description: "refund after transfer",
        basis: "actual",
        currency: "EUR",
        lines: [
          { account: "partner_available", amountMinor: 400, partyType: party.partyType, partyId: party.partyId },
          { account: "refund_liability", amountMinor: -400 },
        ],
      })
    );
    const alloc = (await db.prepare(`SELECT a.id FROM transfer_allocations a JOIN transfers t ON t.id = a.transfer_id WHERE a.party_id = ? AND t.status = 'created' ORDER BY a.id DESC LIMIT 1`).get(org)) as { id: number };
    expect((await call("POST", `/admin/finance/allocations/${alloc.id}/reverse`, { reason: "refund after transfer", amountMinor: 100 }, "admin")).status).toBe(409); // no debt open yet
    // Open the debt but make the automatic attempt fail, then reverse just this booking's allocation by hand.
    stubProvider.failNextReversal = Object.assign(new Error("refused"), { code: "x", type: "StripeInvalidRequestError" });
    const d = await call("POST", `/admin/finance/partners/org/${org}/debts`, { reason: "Refund issued after the transfer" }, "admin");
    expect(d.body).toMatchObject({ recoveredMinor: 0, unrecoveredMinor: 400 });
    expect((await call("POST", `/admin/finance/allocations/${alloc.id}/reverse`, { reason: "refund after transfer", amountMinor: 401 }, "admin")).status).toBe(409);
    const part = await call("POST", `/admin/finance/allocations/${alloc.id}/reverse`, { reason: "refund after transfer", amountMinor: 150 }, "admin");
    expect(part.body).toMatchObject({ recoveredMinor: 150, unrecoveredMinor: 250, status: "open" });
    expect(part.body.reversals[0].allocations).toEqual([{ allocationId: alloc.id, amount: 150 }]);
  });

  it("an unrecovered debt is offset by the partner's own next earnings, then the freeze lifts", async () => {
    const open = (await call("GET", "/admin/finance/debts?status=open", undefined, "admin")).body.find((x: { partyId: string }) => x.partyId === org);
    expect(open.outstandingMinor).toBe(250);
    // New earnings of €10 for this partner (a release) — the settlement run nets them against the debt.
    await db.transaction((tx) =>
      postGroup(tx, {
        idempotencyKey: `release:experience:CX-${run}-offset`,
        sourceType: "experience",
        sourceId: `CX-${run}-offset`,
        description: "new earnings",
        basis: "actual",
        currency: "EUR",
        lines: [
          { account: "stripe_clearing", amountMinor: 1_000 },
          { account: "partner_available", amountMinor: -1_000, partyType: party.partyType, partyId: party.partyId },
        ],
      })
    );
    const { runSettlement } = await import("../commerce/settlement.js");
    const s = await runSettlement({ runKey: `cx-off-${run}`, dryRun: false, actorId: adminId, reason: "weekly settlement" });
    // €10 − the €2.50 still owed = €7.50: no longer frozen, but under the €25 minimum, so it carries forward.
    expect(s.carried.find((x) => x.partyId === org)).toEqual({ partyType: "org", partyId: org, netMinor: 750 });
    const closed = (await call("GET", "/admin/finance/debts?status=offset", undefined, "admin")).body.find((x: { id: number }) => x.id === open.id);
    expect(closed).toMatchObject({ status: "offset", offsetMinor: 250, recoveredMinor: 150 });
  });

  it("a reversal made in the Stripe Dashboard goes to manual review; ours are ignored", async () => {
    const ours = (await db.prepare(`SELECT provider_reversal_id as id FROM transfer_reversals r JOIN transfers t ON t.id = r.transfer_id WHERE t.party_id = ? AND r.status = 'created' LIMIT 1`).get(org)) as { id: string };
    expect(await processStripeEvent({ id: `evt_cx_${run}_r1`, type: "transfer.reversed", created: 0, livemode: false, data: { object: { id: "tr_x", reversals: { data: [{ id: ours.id }] } } } })).toBe("ignored");
    await expect(processStripeEvent({ id: `evt_cx_${run}_r2`, type: "transfer.reversed", created: 0, livemode: false, data: { object: { id: "tr_x", reversals: { data: [{ id: "trr_dashboard" }] } } } })).rejects.toThrow(/outside HelloCircle/);
  });
});

describe("payout mirroring", () => {
  it("records payouts from the partner's connected account and shows them to the partner", async () => {
    const acct = (await db.prepare(`SELECT account_id as id FROM connected_accounts WHERE party_id = ?`).get(org)) as { id: string };
    const ev = (type: string, status: string) => ({ id: `evt_cx_${run}_${type}`, type, created: 0, livemode: false, account: acct.id, data: { object: { id: `po_cx_${run}`, amount: 8_393, currency: "eur", status, arrival_date: 1_900_000_000 } } });
    expect(await processStripeEvent(ev("payout.created", "pending"))).toBe("processed");
    expect(await processStripeEvent(ev("payout.paid", "paid"))).toBe("processed");
    expect(await processStripeEvent({ ...ev("payout.paid", "paid"), account: "acct_someone_else" })).toBe("ignored");
    const overview = await call("GET", "/vendor/payout-account", undefined, "vendor");
    // Bank payouts (Stripe → bank) and transfers (HelloCircle → Stripe account) are reported separately.
    expect(overview.body.payouts).toBeUndefined();
    expect(overview.body.bankPayouts).toEqual([expect.objectContaining({ id: `po_cx_${run}`, amountMinor: 8_393, status: "paid" })]);
    expect(overview.body.transfers.length).toBeGreaterThanOrEqual(2);
    expect(overview.body.transfers[0]).toEqual(expect.objectContaining({ bookings: expect.any(Number) }));
  });
});
