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
import { payoutReadiness, recoverByReversal, runTransfers } from "./connect.js";
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
  app.use("/vendor/payouts", vendorPayoutsRouter);
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

/** A settlement that's due: available → settlement_payable, exactly as runSettlement posts it. */
async function dueSettlement(netMinor: number): Promise<number> {
  // Fund partner_available first (as a release would), balanced against cash.
  await db.transaction((tx) =>
    postGroup(tx, {
      idempotencyKey: `cx-fund:${run}:${crypto.randomUUID()}`,
      sourceType: "test",
      sourceId: run,
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
    expect((await call("POST", "/vendor/payouts/onboarding", {}, "vendor")).status).toBe(409);
  });

  it("creates one Express account per organisation and returns a hosted onboarding link", async () => {
    expect((await call("POST", "/vendor/payouts/onboarding", { country: "FR" }, "vendor")).status).toBe(409);
    const a = await call("POST", "/vendor/payouts/onboarding", {}, "vendor");
    expect(a.status).toBe(200);
    expect(a.body.url).toMatch(/^https:\/\/connect\.stub\.invalid\/onboarding\/acct_stub_/);
    const b = await call("POST", "/vendor/payouts/onboarding", {}, "vendor");
    expect(b.body.url).toBe(a.body.url);
    const rows = (await db.prepare(`SELECT COUNT(*) as n FROM connected_accounts WHERE party_id = ?`).get(org)) as { n: number };
    expect(Number(rows.n)).toBe(1);
    const created = stubProvider.calls.filter((c) => c.method === "createConnectedAccount");
    expect(created.at(-1)?.args).toMatchObject({ country: "IE", idempotencyKey: `acct:org:${org}` });
  });

  it("holds transfers until the account is verified and trader details are self-certified", async () => {
    const reasons = await payoutReadiness(party);
    expect(reasons).toEqual(expect.arrayContaining([expect.stringMatching(/can't receive transfers/), expect.stringMatching(/Trader details/)]));

    const acct = (await db.prepare(`SELECT account_id as id FROM connected_accounts WHERE party_id = ?`).get(org)) as { id: string };
    // account.updated from Stripe flips the mirrored status.
    await processStripeEvent({
      id: `evt_cx_${run}_acct`,
      type: "account.updated",
      created: 0,
      livemode: false,
      account: acct.id,
      data: { object: { id: acct.id, country: "IE", details_submitted: true, charges_enabled: false, payouts_enabled: true, capabilities: { transfers: "active" }, requirements: { currently_due: [], past_due: [], disabled_reason: null } } },
    });
    expect(await payoutReadiness(party)).toEqual([expect.stringMatching(/Trader details/)]);
    await db
      .prepare(`INSERT INTO trader_profiles (party_type, party_id, entity_type, legal_name, address, country, email, phone, company_number, self_certified_at) VALUES ('org', ?, 'company', 'Connect Org Ltd', '1 St', 'IE', 'c@example.test', '1', '123', NOW())`)
      .run(org);
    expect(await payoutReadiness(party)).toEqual([]);
    stubProvider.setAccount(acct.id, { detailsSubmitted: true, payoutsEnabled: true, transfersCapability: "active", requirementsDue: [], disabledReason: null });
    const overview = await call("POST", "/vendor/payouts/refresh", {}, "vendor");
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
    expect((await partnerBalances(party)).settledDueMinor).toBe(0);
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

describe("recovery by transfer reversal", () => {
  it("reverses the most recent transfers up to what the partner owes, and balances the ledger", async () => {
    expect((await call("POST", `/admin/finance/partners/org/${org}/recover`, { reason: "dispute lost" }, "admin")).status).toBe(409);
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
    const r = await call("POST", `/admin/finance/partners/org/${org}/recover`, { reason: "dispute lost" }, "admin");
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ recoveredMinor: 3_000, unrecoveredMinor: 0 });
    expect(r.body.reversals).toEqual([{ reversalId: expect.any(Number), amountMinor: 2_500, status: "created" }, { reversalId: expect.any(Number), amountMinor: 500, status: "created" }]);
    expect((await partnerBalances(party)).availableMinor).toBe(0);
    const t = (await db.prepare(`SELECT amount_minor as a, reversed_minor as r, status FROM transfers WHERE party_id = ? AND status <> 'failed' ORDER BY id`).all(org)) as { a: number; r: number; status: string }[];
    expect(t.map((x) => [Number(x.a), Number(x.r), x.status])).toEqual([
      [8_893, 500, "partially_reversed"],
      [2_500, 2_500, "reversed"],
    ]);
    expect(await ledgerIsBalanced()).toBe(true);
    expect((await call("POST", `/admin/finance/partners/org/${org}/recover`, { reason: "dispute lost" }, "admin")).status).toBe(409);
  });

  it("a reversal made in the Stripe Dashboard goes to manual review; ours are ignored", async () => {
    const ours = (await db.prepare(`SELECT provider_reversal_id as id FROM transfer_reversals r JOIN transfers t ON t.id = r.transfer_id WHERE t.party_id = ? LIMIT 1`).get(org)) as { id: string };
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
    const overview = await call("GET", "/vendor/payouts", undefined, "vendor");
    expect(overview.body.payouts).toEqual([expect.objectContaining({ id: `po_cx_${run}`, amountMinor: 8_393, status: "paid" })]);
    expect(overview.body.transfers.length).toBeGreaterThanOrEqual(2);
  });
});
