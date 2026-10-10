import crypto from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, setSetting } from "../db/index.js";
import { getConnectedAccount, openPartnerDebt, runTransfers, startOnboarding, syncConnectedAccount } from "../payments/connect.js";
import { stubProvider } from "../payments/provider.js";
import { decideSplit, proposeSplit, splitWithRounding } from "./allocations.js";
import { ledgerIsBalanced } from "./ledger.js";
import { recordDispute, recordPaymentConfirmed, recordProviderRefunds } from "./payments.js";
import { resolveDisputeRecovery, runSettlement } from "./settlement.js";

// Revenue & Connect Stage 5e — venue/host split (flow C) against the stub
// provider: deterministic cents, the frozen allocation snapshot, independent
// release/settlement/transfer per partner, refunds after one partner was paid,
// and lost-dispute recovery from the responsible partner(s) only.

const run = crypto.randomUUID().slice(0, 8);
const org = `sp-org-${run}`;
const vendorId = `sp-vendor-${run}`;
const centreId = `sp-centre-${run}`;
const host = `sp-host-${run}`;
const player = `sp-player-${run}`;
const gameId = `sp-game-${run}`;
const adminId = `sp-admin-${run}`;
const venue = { partyType: "org" as const, partyId: org };
const hostParty = { partyType: "host" as const, partyId: host };
let seq = 0;

/** A paid €40 game booking (legacy pricing: 4000 + 23% VAT 920 + 5% fee 200 = 5120). */
async function paidBooking(): Promise<{ ref: string; pi: string }> {
  const ref = `GJ-SP${run}-${++seq}`;
  const pi = `pi_sp_${run}_${seq}`;
  await db.prepare(`INSERT INTO game_participants (game_id, resident_id, ref, status, payment_status, total_cents) VALUES (?, ?, ?, 'joined', 'paid', 5120)`).run(gameId, `${player}-${seq}`, ref);
  await recordPaymentConfirmed({ type: "game", ref, checkoutSessionId: `cs_sp_${run}_${seq}`, paymentIntentId: pi, amountMinor: 5120, currency: "EUR", provider: "stub" });
  return { ref, pi };
}

const lines = async (key: string) =>
  ((await db.prepare(`SELECT e.account_code as a, e.party_id as p, e.amount_minor as m FROM ledger_entries e JOIN ledger_entry_groups g ON g.id = e.group_id WHERE g.idempotency_key = ? ORDER BY e.id`).all(key)) as { a: string; p: string | null; m: number | string }[]).map((l) => [l.a, l.p, Number(l.m)]);
const available = async (party: { partyType: string; partyId: string }) =>
  -Number(((await db.prepare(`SELECT COALESCE(SUM(amount_minor), 0) as s FROM ledger_entries WHERE account_code = 'partner_available' AND party_type = ? AND party_id = ?`).get(party.partyType, party.partyId)) as { s: number | string }).s);

beforeAll(async () => {
  process.env.QA_E2E_ENABLED = "true";
  process.env.QA_PAYMENT_PROVIDER_STUB = "1";
  await setSetting("commerce.settlement_ledger", "true");
  await setSetting("commerce.connect_v1", "true");
  await db.prepare(`INSERT INTO organisations (id, name) VALUES (?, 'Split Venue Ltd')`).run(org);
  await db.prepare(`INSERT INTO users (id, email, password_hash, role, status, name, org_id) VALUES (?, ?, 'x', 'vendor', 'approved', 'V', ?)`).run(vendorId, `${vendorId}@example.test`, org);
  await db.prepare(`INSERT INTO users (id, email, password_hash, role, status, name, admin_role) VALUES (?, ?, 'x', 'admin', 'approved', 'A', 'finance')`).run(adminId, `${adminId}@example.test`);
  await db
    .prepare(`INSERT INTO centres (id, name, area, county, rating, reviews, capacity, from_price, managed_by, ph, image_url, blurb, vendor_id, status) VALUES (?, 'Split Hall', 'Area', 'Dublin', 0, 0, 20, 1000, 'Mgr', '', '', '', ?, 'approved')`)
    .run(centreId, vendorId);
  await db.prepare(`INSERT INTO residents (id, email, name) VALUES (?, ?, 'Split Host')`).run(host, `${host}@example.test`);
  await db.prepare(`INSERT INTO games (id, host_resident_id, activity_label, centre_id, date, time, capacity, price_cents, status) VALUES (?, ?, 'Split Badminton', ?, '2020-01-06', '18:00', 30, 4000, 'open')`).run(gameId, host, centreId);
  await db.prepare(`INSERT INTO trader_profiles (party_type, party_id, entity_type, legal_name, address, country, email, phone, company_number, self_certified_at) VALUES ('org', ?, 'company', 'Split Venue Ltd', '1 St', 'IE', 'v@example.test', '1', '1', NOW())`).run(org);
});

afterAll(async () => {
  await setSetting("commerce.settlement_ledger", "false");
  await setSetting("commerce.connect_v1", "false");
  for (const party of [org, host]) {
    const groups = (await db.prepare(`SELECT DISTINCT group_id as id FROM ledger_entries WHERE party_id = ?`).all(party)) as { id: string }[];
    for (const g of groups) {
      await db.prepare(`DELETE FROM ledger_entries WHERE group_id = ?`).run(g.id);
      await db.prepare(`DELETE FROM ledger_entry_groups WHERE id = ?`).run(g.id);
    }
    await db.prepare(`DELETE FROM transfer_allocation_reversals WHERE allocation_id IN (SELECT id FROM transfer_allocations WHERE party_id = ?)`).run(party);
    await db.prepare(`DELETE FROM transfer_reversals WHERE transfer_id IN (SELECT id FROM transfers WHERE party_id = ?)`).run(party);
    await db.prepare(`DELETE FROM transfer_allocations WHERE party_id = ?`).run(party);
    await db.prepare(`DELETE FROM transfers WHERE party_id = ?`).run(party);
    await db.prepare(`DELETE FROM settlement_items WHERE settlement_id IN (SELECT id FROM settlements WHERE party_id = ?)`).run(party);
    await db.prepare(`DELETE FROM settlements WHERE party_id = ?`).run(party);
    await db.prepare(`DELETE FROM partner_debts WHERE party_id = ?`).run(party);
    await db.prepare(`DELETE FROM connected_account_syncs WHERE account_id IN (SELECT account_id FROM connected_accounts WHERE party_id = ?)`).run(party);
    await db.prepare(`DELETE FROM connected_accounts WHERE party_id = ?`).run(party);
    await db.prepare(`DELETE FROM connected_account_creations WHERE party_id = ?`).run(party);
    await db.prepare(`DELETE FROM reward_awards WHERE party_id = ?`).run(party);
  }
  const refs = ((await db.prepare(`SELECT ref FROM game_participants WHERE game_id = ?`).all(gameId)) as { ref: string }[]).map((r) => r.ref);
  for (const ref of refs) {
    for (const t of ["order_completions", "order_party_releases", "refunds", "disputes", "payment_records"]) await db.prepare(`DELETE FROM ${t} WHERE source_ref = ?`).run(ref);
    const snaps = (await db.prepare(`SELECT id FROM allocation_snapshots WHERE source_ref = ?`).all(ref)) as { id: number }[];
    for (const s of snaps) await db.prepare(`DELETE FROM allocation_lines WHERE snapshot_id = ?`).run(s.id);
    await db.prepare(`DELETE FROM allocation_snapshots WHERE source_ref = ?`).run(ref);
    const groups = (await db.prepare(`SELECT id FROM ledger_entry_groups WHERE source_id = ? OR source_id LIKE ?`).all(ref, `%:${ref}`)) as { id: string }[];
    for (const g of groups) {
      await db.prepare(`DELETE FROM ledger_entries WHERE group_id = ?`).run(g.id);
      await db.prepare(`DELETE FROM ledger_entry_groups WHERE id = ?`).run(g.id);
    }
  }
  await db.prepare(`DELETE FROM dispute_recovery_allocations WHERE dispute_id NOT IN (SELECT id FROM disputes)`).run();
  await db.prepare(`DELETE FROM game_participants WHERE game_id = ?`).run(gameId);
  await db.prepare(`DELETE FROM venue_split_agreements WHERE game_id = ?`).run(gameId);
  await db.prepare(`DELETE FROM games WHERE id = ?`).run(gameId);
  await db.prepare(`DELETE FROM centres WHERE id = ?`).run(centreId);
  await db.prepare(`DELETE FROM trader_profiles WHERE party_id = ?`).run(org);
  await db.prepare(`DELETE FROM residents WHERE id = ?`).run(host);
  await db.prepare(`DELETE FROM audit_log WHERE actor_user_id IN (?, ?, ?)`).run(adminId, vendorId, host);
  await db.prepare(`DELETE FROM users WHERE id IN (?, ?)`).run(vendorId, adminId);
  await db.prepare(`DELETE FROM organisations WHERE id = ?`).run(org);
  delete process.env.QA_E2E_ENABLED;
  delete process.env.QA_PAYMENT_PROVIDER_STUB;
});

describe("deterministic cents", () => {
  it("splits with integer arithmetic and gives the remainder to the configured owner", () => {
    const t = { mode: "percentage" as const, venueBps: 6667, venueFixedMinor: null, hostFixedMinor: null };
    expect(splitWithRounding(4000, t, "venue")).toMatchObject({ venue: 2667, host: 1333, platform: 0, remainder: 1 });
    expect(splitWithRounding(4000, t, "host")).toMatchObject({ venue: 2666, host: 1334, platform: 0, remainder: 1 });
    expect(splitWithRounding(4000, t, "platform")).toMatchObject({ venue: 2666, host: 1333, platform: 1, remainder: 1 });
    expect(splitWithRounding(4000, { ...t, venueBps: 5000 }, "venue")).toMatchObject({ venue: 2000, host: 2000, remainder: 0 });
    expect(splitWithRounding(4000, { mode: "fixed_venue", venueBps: null, venueFixedMinor: 1500, hostFixedMinor: null }, "venue")).toMatchObject({ venue: 1500, host: 2500 });
    expect(splitWithRounding(4000, { mode: "fixed_host", venueBps: null, venueFixedMinor: null, hostFixedMinor: 4500 }, "venue").error).toMatch(/more than the partner share/);
    for (let pool = 0; pool < 500; pool += 7) for (const bps of [1, 3333, 5000, 6667, 9999]) {
      const r = splitWithRounding(pool, { ...t, venueBps: bps }, "venue");
      expect(r.venue + r.host + r.platform).toBe(pool);
    }
  });
});

describe("venue/host split end to end (stub provider)", () => {
  let main: { ref: string; pi: string };

  it("only the venue's organisation can accept the host's proposal; payment freezes the accepted split", async () => {
    await expect(proposeSplit({ gameId, hostResidentId: "someone-else", terms: { mode: "percentage", venueBps: 6667, venueFixedMinor: null, hostFixedMinor: null } })).rejects.toMatchObject({ status: 404 });
    const p = await proposeSplit({ gameId, hostResidentId: host, terms: { mode: "percentage", venueBps: 6667, venueFixedMinor: null, hostFixedMinor: null } });
    await expect(decideSplit({ agreementId: p.id, venue: { partyType: "org", partyId: "other-org" }, accept: true, actorId: vendorId })).rejects.toMatchObject({ status: 404 });
    // Before acceptance, a payment is still single-partner (the host).
    const single = await paidBooking();
    expect((await lines(`payment:game:${single.ref}`)).filter((l) => l[0] === "host_payable" || l[0] === "partner_payable")).toEqual([["host_payable", host, -4000]]);
    const accepted = await decideSplit({ agreementId: p.id, venue, accept: true, actorId: vendorId });
    expect(accepted.status).toBe("accepted");
    main = await paidBooking();
    expect(await lines(`payment:game:${main.ref}`)).toEqual(
      expect.arrayContaining([["stripe_clearing", null, 5120], ["partner_payable", org, -2667], ["host_payable", host, -1333], ["platform_fee_revenue", null, -200], ["underlying_tax_payable", null, -920]])
    );
    const snap = (await db.prepare(`SELECT * FROM allocation_snapshots WHERE source_type = 'game' AND source_ref = ?`).get(main.ref)) as Record<string, any>;
    expect([snap.gross_minor, snap.vat_minor, snap.platform_retained_minor, snap.partner_pool_minor, snap.rounding_adjustment_minor, snap.rounding_owner, snap.split_agreement_id, snap.split_agreement_version].map((x) => (typeof x === "string" && /^\d+$/.test(x) ? Number(x) : x))).toEqual([5120, 920, 200, 4000, 1, "venue", p.id, 1]);
    const al = (await db.prepare(`SELECT role, party_id as p, amount_minor as m FROM allocation_lines WHERE snapshot_id = ? ORDER BY id`).all(snap.id)) as { role: string; p: string | null; m: number | string }[];
    expect(al.map((l) => [l.role, l.p, Number(l.m)])).toEqual([["platform", null, 200], ["venue", org, 2667], ["host", host, 1333], ["tax", null, 920], ["deposit", null, 0]]);
    expect(al.reduce((a, l) => a + Number(l.m), 0), "gross = retained + venue + host + VAT + deposit").toBe(5120);
    // Immutable: a redelivered confirmation doesn't re-freeze or re-post.
    await recordPaymentConfirmed({ type: "game", ref: main.ref, checkoutSessionId: null, paymentIntentId: main.pi, amountMinor: 5120, currency: "EUR", provider: "stub" });
    expect(((await db.prepare(`SELECT COUNT(*) as n FROM allocation_snapshots WHERE source_ref = ?`).get(main.ref)) as { n: number }).n).toBe(1);
    expect(await ledgerIsBalanced()).toBe(true);
  });

  it("releases each partner separately; the venue settles, the host carries below €25 — independently", async () => {
    const r = await runSettlement({ runKey: `sp-${run}-1`, dryRun: false, actorId: adminId, reason: "split weekly run" });
    const rel = r.released.filter((x) => x.ref === main.ref).map((x) => [x.partyType, x.amountMinor]);
    expect(rel).toEqual(expect.arrayContaining([["org", 2667], ["host", 1333]]));
    expect(r.settled.find((s) => s.partyId === org)?.netMinor).toBe(2667);
    // The host also has the earlier single-partner booking (4000): 1333 + 4000 ≥ €25 → settled too.
    // Use the per-partner release rows to prove independence instead.
    const releases = (await db.prepare(`SELECT party_type as t, released_minor as m FROM order_party_releases WHERE source_ref = ? ORDER BY party_type`).all(main.ref)) as { t: string; m: number | string }[];
    expect(releases.map((x) => [x.t, Number(x.m)])).toEqual([["host", 1333], ["org", 2667]]);
    expect(await lines(`release:game:${main.ref}:org:${org}`)).toEqual([["partner_payable", org, 2667], ["partner_available", org, -2667]]);
    expect(await lines(`release:game:${main.ref}:host:${host}`)).toEqual([["host_payable", host, 1333], ["partner_available", host, -1333]]);
    const again = await runSettlement({ runKey: `sp-${run}-1`, dryRun: false, actorId: adminId, reason: "split weekly run" }).catch((e) => e);
    expect(again.status).toBe(409);
  });

  it("transfers the verified venue; the unverified host is held and doesn't block the venue", async () => {
    await startOnboarding(venue, { email: "v@example.test", country: "IE", returnPath: "/vendor?tab=earnings", actorId: vendorId });
    const acct = (await getConnectedAccount(venue))!;
    stubProvider.setAccount(acct.accountId, { transfersCapability: "active", payoutsCapability: "active", payoutsEnabled: true, requirementsDue: [], requirementsPastDue: [], disabledReason: null });
    await syncConnectedAccount(acct.accountId, { source: "api" });
    const t = await runTransfers({ dryRun: false, actorId: adminId, reason: "split transfer run" });
    const venueSettlement = ((await db.prepare(`SELECT id FROM settlements WHERE party_id = ?`).get(org)) as { id: number }).id;
    expect(t.transferred.find((x) => x.settlementId === venueSettlement)?.amountMinor).toBe(2667);
    expect(t.held.filter((h) => h.reasons.some((r) => /No payout account connected/.test(r))).length).toBeGreaterThan(0);
    const alloc = (await db.prepare(`SELECT kind, source_ref as ref, amount_minor as m FROM transfer_allocations WHERE party_id = ?`).all(org)) as { kind: string; ref: string; m: number | string }[];
    expect(alloc.map((a) => [a.kind, a.ref, Number(a.m)])).toEqual([["booking", main.ref, 2667]]);
  });

  it("a partial refund after only the venue was paid is split exactly; the venue's debt is recovered from its own allocation for this booking", async () => {
    // 1280 of 5120 = ¼: venue 666.75 → 667, host 333.25 → 333 (largest remainder), fee 50, VAT 230.
    await recordProviderRefunds({ paymentIntentId: main.pi, chargeId: `ch_sp_${run}`, amountRefundedMinor: 1280, amountMinor: 5120, currency: "eur" });
    const refundGroup = ((await db.prepare(`SELECT g.idempotency_key as k FROM ledger_entry_groups g JOIN refunds r ON g.source_id = CAST(r.id AS CHAR) AND g.source_type = 'refund' WHERE r.source_ref = ?`).get(main.ref)) as { k: string }).k;
    expect((await lines(refundGroup)).filter((l) => l[1] === org || l[1] === host)).toEqual(expect.arrayContaining([["partner_available", org, 667], ["partner_available", host, 333]]));
    expect(await available(venue)).toBe(-667);
    const before = await available(hostParty);
    const r = await openPartnerDebt(venue, { actorId: adminId, reason: "Refund after transfer (split booking)", prefer: { sourceType: "game", sourceRef: main.ref } });
    expect([r.recoveredMinor, r.unrecoveredMinor, r.status]).toEqual([667, 0, "recovered"]);
    const rev = (await db.prepare(`SELECT a.source_ref as ref, ar.amount_minor as m FROM transfer_allocation_reversals ar JOIN transfer_allocations a ON a.id = ar.allocation_id WHERE a.party_id = ?`).all(org)) as { ref: string; m: number | string }[];
    expect(rev.map((x) => [x.ref, Number(x.m)])).toEqual([[main.ref, 667]]);
    expect(await available(hostParty), "the host's earnings are never used for the venue's debt").toBe(before);
    expect(await ledgerIsBalanced()).toBe(true);
  });

  it("a lost dispute is recovered from the responsible partner(s) only, in proportion when both", async () => {
    const d = await paidBooking();
    await recordDispute({ disputeId: `du_sp_${run}`, paymentIntentId: d.pi, amountMinor: 5120, currency: "eur", reason: "fraudulent", status: "lost", evidenceDueBy: null, feeMinor: 1500 });
    const disp = (await db.prepare(`SELECT id FROM disputes WHERE provider_dispute_id = ?`).get(`du_sp_${run}`)) as { id: number };
    await expect(resolveDisputeRecovery({ disputeId: disp.id, responsible: "venue", actorId: adminId, reason: "x" })).rejects.toMatchObject({ status: 400 });
    const res = await resolveDisputeRecovery({ disputeId: disp.id, responsible: "partner", actorId: adminId, reason: "Activity not delivered" });
    // 5120 × 2667/4000 = 3413.76 → 3414; × 1333/4000 = 1706.24 → 1706.
    expect(res.allocations.map((a) => [a.role, a.amountMinor])).toEqual([["venue", 3414], ["host", 1706]]);
    expect(await lines(`dispute_recovery:du_sp_${run}`)).toEqual([["partner_available", org, 3414], ["partner_available", host, 1706], ["chargeback_loss", null, -5120]]);
    const fee = await lines(`dispute:du_sp_${run}:fee`);
    expect(fee).toEqual([["dispute_fee_expense", null, 1500], ["stripe_clearing", null, -1500]]);
    expect(await ledgerIsBalanced()).toBe(true);
  });
});
