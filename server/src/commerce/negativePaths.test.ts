import crypto from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, setSetting } from "../db/index.js";
import { openPartnerDebt, payoutReadiness, payoutsOverview, retryDebtRecovery, runTransfers } from "../payments/connect.js";
import { stubProvider } from "../payments/provider.js";
import { beginEvent } from "../payments/webhookEvents.js";
import { processStripeEvent } from "../routes/stripeWebhook.js";
import { CreditError, creditBalance, creditForCheckout, grantCredit, reserveCredit } from "./credits.js";
import { ledgerIsBalanced, postGroup } from "./ledger.js";
import { postRefund, recordDispute } from "./payments.js";
import { assignPlan, currentPlanFor } from "./plans.js";
import { redeemForProMonth, rewardBalance } from "./rewards.js";
import { partnerBalances, runSettlement } from "./settlement.js";
import { GRACE_DAYS, sweepSubscriptions } from "./subscriptions.js";

// Revenue & Connect Stage 5c — the brief's negative paths, one focused test
// each (stub provider only). Two are covered where their feature lives and
// are cross-referenced instead of duplicated:
//   partial refund          → finance.test.ts "partial then remaining refund…"
//                             (+ reward points: billingRewardsCredits.test.ts)
//   policy material change  → policies.test.ts "…asks again only after a material change"

const run = crypto.randomUUID().slice(0, 8);
const org = `neg-org-${run}`;
const vendorId = `neg-vendor-${run}`;
const adminId = `neg-admin-${run}`;
const residentId = `neg-res-${run}`;
const party = { partyType: "org" as const, partyId: org };
const reason = "negative path test";
let seq = 0;

beforeAll(async () => {
  await db.prepare(`INSERT INTO organisations (id, name) VALUES (?, 'Negative Org')`).run(org);
  await db.prepare(`INSERT INTO users (id, email, password_hash, role, status, name, org_id) VALUES (?, ?, 'x', 'vendor', 'approved', 'V', ?)`).run(vendorId, `${vendorId}@example.test`, org);
  await db.prepare(`INSERT INTO users (id, email, password_hash, role, status, name, admin_role) VALUES (?, ?, 'x', 'admin', 'approved', 'A', 'finance')`).run(adminId, `${adminId}@example.test`);
  await db.prepare(`INSERT INTO residents (id, email, name) VALUES (?, ?, 'Neg Resident')`).run(residentId, `${residentId}@example.test`);
  for (const k of ["commerce.settlement_ledger", "commerce.connect_v1", "commerce.customer_credits", "commerce.circle_credits", "commerce.pro_subscriptions"]) await setSetting(k, "true");
  process.env.QA_E2E_ENABLED = "true";
  process.env.QA_PAYMENT_PROVIDER_STUB = "1";
});

afterAll(async () => {
  delete process.env.QA_E2E_ENABLED;
  delete process.env.QA_PAYMENT_PROVIDER_STUB;
  for (const k of ["commerce.settlement_ledger", "commerce.connect_v1", "commerce.customer_credits", "commerce.circle_credits", "commerce.pro_subscriptions"]) await setSetting(k, "false");
  const groups = (await db.prepare(`SELECT DISTINCT group_id as id FROM ledger_entries WHERE party_id = ?`).all(org)) as { id: string }[];
  for (const g of groups) {
    await db.prepare(`DELETE FROM settlement_items WHERE ledger_group_id = ?`).run(g.id);
    await db.prepare(`DELETE FROM ledger_entries WHERE group_id = ?`).run(g.id);
    await db.prepare(`DELETE FROM ledger_entry_groups WHERE id = ?`).run(g.id);
  }
  await db.prepare(`DELETE FROM transfer_allocation_reversals WHERE allocation_id IN (SELECT id FROM transfer_allocations WHERE party_id = ?)`).run(org);
  await db.prepare(`DELETE FROM transfer_allocations WHERE party_id = ?`).run(org);
  await db.prepare(`DELETE FROM transfer_reversals WHERE transfer_id IN (SELECT id FROM transfers WHERE party_id = ?)`).run(org);
  await db.prepare(`DELETE FROM transfers WHERE party_id = ?`).run(org);
  await db.prepare(`DELETE FROM partner_debts WHERE party_id = ?`).run(org);
  await db.prepare(`DELETE FROM settlements WHERE party_id = ?`).run(org);
  // By the account the stub actually created (not a guessed id), before the account row itself goes.
  await db.prepare(`DELETE FROM connected_payouts WHERE account_id IN (SELECT account_id FROM connected_accounts WHERE party_id = ?)`).run(org);
  await db.prepare(`DELETE FROM connected_accounts WHERE party_id = ?`).run(org);
  await db.prepare(`DELETE FROM trader_profiles WHERE party_id = ?`).run(org);
  await db.prepare(`DELETE FROM reward_reversals WHERE award_id IN (SELECT id FROM reward_awards WHERE party_id = ?)`).run(org);
  await db.prepare(`DELETE FROM reward_awards WHERE party_id = ?`).run(org);
  await db.prepare(`DELETE FROM reward_lots WHERE party_id = ?`).run(org);
  await db.prepare(`DELETE FROM reward_debts WHERE party_id = ?`).run(org);
  await db.prepare(`DELETE FROM reward_redemptions WHERE party_id = ?`).run(org);
  await db.prepare(`DELETE FROM partner_subscriptions WHERE party_id = ?`).run(org);
  await db.prepare(`DELETE FROM partner_plan_assignments WHERE partner_id = ?`).run(org);
  await db.prepare(`DELETE FROM refunds WHERE idempotency_key LIKE ?`).run(`neg-${run}%`);
  await db.prepare(`DELETE FROM payment_records WHERE source_ref LIKE ?`).run(`NEG-${run}%`);
  await db.prepare(`DELETE FROM disputes WHERE provider_dispute_id LIKE ?`).run(`dp_neg_${run}%`);
  await db.prepare(`DELETE FROM webhook_events WHERE event_id LIKE ?`).run(`evt_neg_${run}%`);
  await db.prepare(`DELETE FROM credit_uses WHERE resident_id = ?`).run(residentId);
  await db.prepare(`DELETE FROM credit_lots WHERE resident_id = ?`).run(residentId);
  await db.prepare(`DELETE FROM audit_log WHERE actor_user_id IN (?, ?) OR object_id = ?`).run(adminId, vendorId, org);
  await db.prepare(`DELETE FROM residents WHERE id = ?`).run(residentId);
  await db.prepare(`DELETE FROM users WHERE id IN (?, ?)`).run(vendorId, adminId);
  await db.prepare(`DELETE FROM organisations WHERE id = ?`).run(org);
});

const post = (key: string, lines: { account: string; amountMinor: number; partyType?: string; partyId?: string }[], sourceType = "test", sourceId = run) =>
  db.transaction((tx) => postGroup(tx, { idempotencyKey: key, sourceType, sourceId, description: key, basis: "actual", currency: "EUR", lines }));

/** A released booking settled into a due settlement, with its item (as runSettlement does it). */
async function dueSettlement(netMinor: number): Promise<{ id: number; ref: string }> {
  const ref = `NEG-${run}-${++seq}`;
  const release = await post(`release:experience:${ref}`, [
    { account: "stripe_clearing", amountMinor: netMinor },
    { account: "partner_available", amountMinor: -netMinor, ...party },
  ], "experience", ref);
  const r = await db.prepare(`INSERT INTO settlement_runs (run_key, dry_run, status, started_by, reason) VALUES (?, 0, 'completed', ?, 'neg')`).run(`neg-${run}-${seq}`, adminId);
  const s = await db.prepare(`INSERT INTO settlements (run_id, party_type, party_id, currency, net_minor, status) VALUES (?, 'org', ?, 'EUR', ?, 'due')`).run(Number(r.lastInsertRowid), org, netMinor);
  const id = Number(s.lastInsertRowid);
  await db.prepare(`INSERT INTO settlement_items (settlement_id, ledger_group_id, description, amount_minor) VALUES (?, ?, ?, ?)`).run(id, release.groupId, ref, netMinor);
  await post(`settlement:${id}`, [
    { account: "partner_available", amountMinor: netMinor, ...party },
    { account: "settlement_payable", amountMinor: -netMinor, ...party },
  ], "settlement", String(id));
  return { id, ref };
}

async function makeReady() {
  const created = await stubProvider.createConnectedAccount({ country: "IE", email: "neg@example.test", idempotencyKey: `acct:org:${org}`, metadata: {} });
  stubProvider.setAccount(created.id, { detailsSubmitted: true, payoutsEnabled: true, transfersCapability: "active", requirementsDue: [] });
  await db
    .prepare(`INSERT IGNORE INTO connected_accounts (party_type, party_id, provider, account_id, country, details_submitted, payouts_enabled, transfers_capability) VALUES ('org', ?, 'stub', ?, 'IE', 1, 1, 'active')`)
    .run(org, created.id);
  return created.id;
}

describe("incomplete seller verification", () => {
  it("holds transfers until trader details are complete and not rejected", async () => {
    await makeReady();
    expect(await payoutReadiness(party)).toEqual([expect.stringMatching(/Trader details not completed/)]);
    const { id } = await dueSettlement(3_000);
    const r = await runTransfers({ dryRun: false, actorId: adminId, reason });
    expect(r.held).toEqual(expect.arrayContaining([expect.objectContaining({ settlementId: id })]));
    expect(stubProvider.calls.filter((c) => c.method === "createTransfer")).toHaveLength(0);
    await db
      .prepare(`INSERT INTO trader_profiles (party_type, party_id, entity_type, legal_name, address, country, email, phone, company_number, self_certified_at, verification_status) VALUES ('org', ?, 'company', 'Neg Ltd', '1 St', 'IE', 'n@example.test', '1', '9', NOW(), 'rejected')`)
      .run(org);
    expect(await payoutReadiness(party)).toEqual([expect.stringMatching(/need changes/)]);
    await db.prepare(`UPDATE trader_profiles SET verification_status = 'verified' WHERE party_id = ?`).run(org);
    expect(await payoutReadiness(party)).toEqual([]);
    const ok = await runTransfers({ dryRun: false, actorId: adminId, reason });
    expect(ok.transferred).toEqual(expect.arrayContaining([expect.objectContaining({ settlementId: id })]));
  });
});

describe("duplicate weekly run", () => {
  it("a run key completes once; the second real run is refused and settles nothing", async () => {
    await runSettlement({ runKey: `neg-week-${run}`, dryRun: false, actorId: adminId, reason });
    await expect(runSettlement({ runKey: `neg-week-${run}`, dryRun: false, actorId: adminId, reason })).rejects.toThrow(/already been completed/);
    // And a second transfer run sends nothing new.
    const before = stubProvider.calls.filter((c) => c.method === "createTransfer").length;
    await runTransfers({ dryRun: false, actorId: adminId, reason });
    expect(stubProvider.calls.filter((c) => c.method === "createTransfer").length).toBe(before);
  });
});

describe("duplicate webhook", () => {
  it("the same provider event is stored once; a second delivery is acknowledged as a duplicate", async () => {
    const ev = { id: `evt_neg_${run}_dup`, type: "payout.paid", created: 0, livemode: false, account: "acct_x", data: { object: { id: "po_x" } } };
    expect((await beginEvent("stripe", ev, "{}")).action).toBe("process");
    expect((await beginEvent("stripe", ev, "{}")).action).not.toBe("process");
  });
});

describe("out-of-order webhook", () => {
  it("a closed dispute isn't reopened by a late 'needs_response' event", async () => {
    const d = `dp_neg_${run}_ooo`;
    await recordDispute({ disputeId: d, paymentIntentId: null, amountMinor: 1_000, currency: "eur", reason: "fraudulent", status: "lost", evidenceDueBy: null });
    await recordDispute({ disputeId: d, paymentIntentId: null, amountMinor: 1_000, currency: "eur", reason: "fraudulent", status: "needs_response", evidenceDueBy: null });
    expect(((await db.prepare(`SELECT status FROM disputes WHERE provider_dispute_id = ?`).get(d)) as { status: string }).status).toBe("lost");
  });

  it("a subscription update arriving after its deletion is ignored", async () => {
    const sub = `sub_neg_${run}_ooo`;
    await db.prepare(`INSERT INTO partner_subscriptions (party_type, party_id, provider_subscription_id, status, gross_minor, created_by) VALUES ('org', ?, ?, 'canceled', 3567, ?)`).run(org, sub, adminId);
    expect(await processStripeEvent({ id: `evt_neg_${run}_late`, type: "customer.subscription.updated", created: 0, livemode: false, data: { object: { id: sub, status: "active" } } })).toBe("ignored");
    expect(((await db.prepare(`SELECT status FROM partner_subscriptions WHERE provider_subscription_id = ?`).get(sub)) as { status: string }).status).toBe("canceled");
  });
});

describe("negative partner balance", () => {
  it("is carried forward (never settled or transferred), and a debt needs an admin reason", async () => {
    await post(`neg-owes-${run}`, [
      { account: "partner_available", amountMinor: 1_200, ...party },
      { account: "chargeback_loss", amountMinor: -1_200 },
    ]);
    expect((await partnerBalances(party)).availableMinor).toBe(-1_200);
    const s = await runSettlement({ runKey: `neg-week2-${run}`, dryRun: false, actorId: adminId, reason });
    expect(s.settled.find((x) => x.partyId === org)).toBeUndefined();
    expect(s.carried.find((x) => x.partyId === org)?.netMinor).toBe(-1_200);
    await expect(openPartnerDebt(party, { actorId: adminId, reason: "short" })).rejects.toThrow(/reason/);
  });
});

describe("refund after transfer + reversal failure", () => {
  it("a failed reversal leaves the debt open (frozen, unrecovered recorded); a retry recovers it from this partner only", async () => {
    stubProvider.failNextReversal = Object.assign(new Error("Insufficient funds in the connected account"), { code: "insufficient_funds", type: "StripeInvalidRequestError" });
    const d = await openPartnerDebt(party, { actorId: adminId, reason: "Refund issued after the transfer was sent" });
    expect(d).toMatchObject({ recoveredMinor: 0, unrecoveredMinor: 1_200, status: "open" });
    expect(d.reversals[0]).toMatchObject({ status: "failed" });
    expect(await payoutReadiness(party)).toEqual([expect.stringMatching(/Earnings frozen/)]);
    const retried = await retryDebtRecovery(d.debtId, { actorId: adminId, reason: "retry after refusal" });
    expect(retried).toMatchObject({ recoveredMinor: 1_200, unrecoveredMinor: 0, status: "recovered" });
    // Every reversal is against this partner's own transfers.
    const foreign = (await db
      .prepare(`SELECT COUNT(*) as n FROM transfer_reversals r JOIN transfers t ON t.id = r.transfer_id WHERE r.debt_id = ? AND (t.party_type <> 'org' OR t.party_id <> ?)`)
      .get(d.debtId, org)) as { n: number };
    expect(Number(foreign.n)).toBe(0);
    expect(await ledgerIsBalanced()).toBe(true);
  });
});

describe("failed payout", () => {
  it("a failed bank payout is mirrored with its reason and shown to the partner (transfers unaffected)", async () => {
    const acct = (await db.prepare(`SELECT account_id as a FROM connected_accounts WHERE party_id = ?`).get(org)) as { a: string };
    await processStripeEvent({ id: `evt_neg_${run}_pf`, type: "payout.failed", created: 0, livemode: false, account: acct.a, data: { object: { id: `po_neg_${run}`, amount: 2_500, currency: "eur", status: "failed", failure_code: "account_closed", failure_message: "The bank account has been closed" } } });
    const o = await payoutsOverview(party);
    expect(o.bankPayouts).toEqual([expect.objectContaining({ id: `po_neg_${run}`, status: "failed", failureMessage: "The bank account has been closed" })]);
    expect(o.transfers.length).toBeGreaterThan(0);
  });
});

describe("failed Pro renewal", () => {
  it("past_due keeps Pro during the grace period; a later successful payment clears the grace; only an unpaid grace ends Pro", async () => {
    const sub = `sub_neg_${run}_renew`;
    await db.prepare(`INSERT INTO partner_subscriptions (party_type, party_id, provider_subscription_id, status, gross_minor, created_by) VALUES ('org', ?, ?, 'active', 3567, ?)`).run(org, sub, adminId);
    await assignPlan({ partner: { kind: "org", id: org }, planKey: "pro", source: "subscription", sourceRef: sub, reason: "test Pro", actorId: adminId });
    await processStripeEvent({ id: `evt_neg_${run}_pf1`, type: "invoice.payment_failed", created: 0, livemode: false, data: { object: { id: "in_neg_1", subscription: sub } } });
    expect(((await db.prepare(`SELECT status FROM partner_subscriptions WHERE provider_subscription_id = ?`).get(sub)) as { status: string }).status).toBe("past_due");
    expect((await currentPlanFor({ kind: "org", id: org })).planKey).toBe("pro");
    // The retry succeeds → active again, grace cleared, and the sweep ends nothing.
    await processStripeEvent({ id: `evt_neg_${run}_ok`, type: "customer.subscription.updated", created: 0, livemode: false, data: { object: { id: sub, status: "active" } } });
    expect((await sweepSubscriptions(new Date(Date.now() + (GRACE_DAYS + 1) * 864e5))).ended).toBe(0);
    expect((await currentPlanFor({ kind: "org", id: org })).planKey).toBe("pro");
    // Fails again and stays unpaid past the grace → Free.
    await processStripeEvent({ id: `evt_neg_${run}_pf2`, type: "invoice.payment_failed", created: 0, livemode: false, data: { object: { id: "in_neg_2", subscription: sub } } });
    expect((await sweepSubscriptions(new Date(Date.now() + (GRACE_DAYS + 1) * 864e5))).ended).toBe(1);
    expect((await currentPlanFor({ kind: "org", id: org })).planKey).toBe("free");
  });
});

describe("points redeemed before refund", () => {
  it("the reversal becomes a points debt that blocks the next redemption", async () => {
    const ref = `NEG-${run}-pts`;
    await db.prepare(`INSERT INTO payment_records (source_type, source_ref, provider, amount_minor, currency, status) VALUES ('experience', ?, 'stub', 10000, 'EUR', 'succeeded')`).run(ref);
    const lot = await db.prepare(`INSERT INTO reward_lots (party_type, party_id, source_ref, points_earned, points_remaining, expires_at) VALUES ('org', ?, ?, 100, 0, ?)`).run(org, `neg-lot-${run}`, new Date(Date.now() + 864e5 * 300));
    await db.prepare(`INSERT INTO reward_awards (settlement_id, party_type, party_id, source_type, source_ref, gmv_minor, refunded_at_award_minor, points, lot_id) VALUES (0, 'org', ?, 'experience', ?, 10000, 0, 100, ?)`).run(org, ref, Number(lot.lastInsertRowid)); // its 100 points were already spent
    await db.transaction(async (tx) => {
      const rf = await tx.prepare(`INSERT INTO refunds (source_type, source_ref, amount_minor, currency, kind, origin, responsible, reason, status, idempotency_key) VALUES ('experience', ?, 10000, 'EUR', 'full', 'admin', 'partner', 'refund', 'succeeded', ?)`).run(ref, `neg-${run}-rf`);
      await postRefund(tx, "experience", ref, Number(rf.lastInsertRowid), 10_000, 10_000, adminId);
    });
    expect(await rewardBalance({ kind: "org", id: org })).toMatchObject({ debtPoints: 100, points: -100 });
    await db.prepare(`DELETE FROM partner_subscriptions WHERE party_id = ? AND status IN ('active','past_due')`).run(org);
    await expect(redeemForProMonth({ kind: "org", id: org }, adminId)).rejects.toThrow(/100 points are owed/);
  });
});

describe("expired and insufficient credit", () => {
  it("expired credit can't be used", async () => {
    await db.prepare(`INSERT INTO credit_lots (resident_id, kind, amount_minor, remaining_minor, reason, expires_at, created_by) VALUES (?, 'goodwill', 1000, 1000, 'old', ?, ?)`).run(residentId, new Date(Date.now() - 864e5), adminId);
    expect(await creditBalance(residentId)).toBe(0);
    expect(await creditForCheckout(residentId, true, 5_000)).toBe(0);
  });

  it("checkout refuses to use more credit than the resident has (e.g. spent in another tab)", async () => {
    await grantCredit({ residentId, amountMinor: 500, kind: "goodwill", reason: "goodwill credit", actorId: adminId });
    await expect(db.transaction((tx) => reserveCredit(tx, { residentId, sourceType: "experience", ref: `NEG-${run}-cr`, amountMinor: 600, confirmed: false }))).rejects.toBeInstanceOf(CreditError);
    expect(await creditBalance(residentId)).toBe(500); // nothing half-reserved
  });
});
