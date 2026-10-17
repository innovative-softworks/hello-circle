import type { APIRequestContext } from "@playwright/test";
import type Stripe from "stripe";
import { expect, personas } from "../fixtures";
import { createActivity, rows, test, withActors } from "../lifecycle-fixture";
import { bookableCentre } from "../booking-fixture";
import { deliver, stripe, stripeProfile } from "../stripe-fixture";
import { attachAccount, createVerifiedRecipient, deliverReal, IBAN, ledgerBalanced, noteServerFailure, payHosted, realEvents, record, RUN, runKey, setSwitch, sleep } from "../stripe-sandbox-fixture";

// Revenue & Connect Stage 5e — B/C/D/E/H on real Stripe TEST money with two
// connected accounts: a company venue (QA_VENDOR_B's organisation — QA_VENDOR's
// carries earlier specs' chargeback balance in a combined run) and an
// individual host (QA_HOST), both verified Accounts v2 test doubles (see
// createVerifiedRecipient). Reward points are on (each partner earns on its own
// settled allocation). Each booking is a €40 game at the venue hosted
// by the host, with an accepted 66.67 % venue split:
//   charge 5120 = HelloCircle 200 + venue 2667 (incl. 1c rounding) + host 1333 + VAT 920.

const SWITCHES = { "commerce.settlement_ledger": true, "commerce.connect_v1": true, "commerce.circle_credits": true, "commerce.venue_host_split_payout": true };
const reason = "Stage 5e split sandbox validation";
const ev5e = (section: string, facts: Record<string, unknown>) => record(section, facts, "stage5e");

test("SANDBOX-SPLIT: venue/host split — snapshot, independent settlement and transfers, refunds and dispute after transfer, bank payouts", async ({ playwright, browser }) => {
  test.skip(!stripeProfile, "qa:stripe only");
  test.setTimeout(1_500_000);
  await withActors(playwright, ["QA_ADMIN", "QA_VENDOR_B", "QA_HOST", "QA_USER", "QA_USER_B"], async (f) => {
    const restore = await setSwitch(f, SWITCHES);
    const [{ org_id: orgId }] = await rows(f, "SELECT org_id FROM users WHERE id = ?", [personas.QA_VENDOR_B.id]);
    const venue = { partyType: "org", partyId: orgId as string };
    const host = { partyType: "host", partyId: personas.QA_HOST.id };
    const admin = (path: string, data: Record<string, unknown>) =>
      f.actors.QA_ADMIN.post(`/api/admin/finance${path}`, { data: { reason, ...data } }).then(async (r) => {
        const out = { status: r.status(), body: await r.json().catch(() => ({})) };
        await noteServerFailure(`split ${path}`, out.status, out.body);
        return out;
      });
    const available = async (p: { partyType: string; partyId: string }) => -Number((await rows(f, "SELECT COALESCE(SUM(amount_minor), 0) AS s FROM ledger_entries WHERE account_code = 'partner_available' AND party_type = ? AND party_id = ?", [p.partyType, p.partyId]))[0].s);
    const cleanParty = async (p: { partyType: string; partyId: string }) => {
      await f.connection.execute("DELETE FROM partner_debts WHERE party_type = ? AND party_id = ?", [p.partyType, p.partyId]);
      await f.connection.execute("DELETE FROM connected_account_syncs WHERE account_id IN (SELECT account_id FROM connected_accounts WHERE party_type = ? AND party_id = ?)", [p.partyType, p.partyId]);
      await f.connection.execute("DELETE FROM connected_accounts WHERE party_type = ? AND party_id = ?", [p.partyType, p.partyId]);
      await f.connection.execute("DELETE FROM connected_account_creations WHERE party_type = ? AND party_id = ?", [p.partyType, p.partyId]);
    };
    const opened: APIRequestContext[] = [];
    // Restore the venue org's trader profile exactly as it was (other specs rely on it).
    const [traderBefore] = await rows(f, "SELECT * FROM trader_profiles WHERE party_type = 'org' AND party_id = ?", [orgId]);
    try {
      // Isolation: the debt assertions below ("host had no transfer", one venue reversal) only hold when
      // neither partner has transfers from an earlier run. cleanParty never deletes money rows, so this spec
      // passes once per disposable QA database — refuse up front instead of failing deep in the run.
      const prior = await rows(f, "SELECT party_type AS t, COUNT(*) AS n FROM transfers WHERE (party_type = 'org' AND party_id = ?) OR (party_type = 'host' AND party_id = ?) GROUP BY party_type", [venue.partyId, host.partyId]);
      expect(prior.map((p: any) => `${p.t}:${p.n}`), "split partners start with no transfers (provision a fresh QA database: npm run qa:db:reset && npm run qa:db:seed)").toEqual([]);
      // --- connected accounts (verified v2 test doubles) ---------------------------------
      const venueAcct = await createVerifiedRecipient("company", "venue", IBAN.ok);
      const hostAcct = await createVerifiedRecipient("individual", "host", IBAN.closed);
      await attachAccount(f, venue, venueAcct, "company");
      await attachAccount(f, host, hostAcct, "individual");
      const states: Record<string, string> = {};
      for (let i = 0; i < 15; i++) {
        states.venue = (await (await f.actors.QA_VENDOR_B.post("/api/vendor/payout-account/refresh", { data: {} })).json()).state;
        states.host = (await (await f.actors.QA_HOST.post("/api/host/payout-account/refresh", { data: {} })).json()).state;
        if (states.venue === "enabled" && states.host === "enabled") break;
        await sleep(3_000);
      }
      const ov = await (await f.actors.QA_VENDOR_B.get("/api/vendor/payout-account")).json();
      expect(ov.account.transfersCapability, "venue can receive transfers").toBe("active");
      // Trader details: the venue's are self-certified; the host's aren't yet (holds the host only).
      await f.connection.execute("INSERT INTO trader_profiles (party_type, party_id, entity_type, legal_name, address, country, email, phone, company_number, self_certified_at) VALUES ('org', ?, 'company', 'QA Venue Ltd', '1 QA St, Dublin', 'IE', 'qa.venue@example.test', '0', '123456', NOW()) ON DUPLICATE KEY UPDATE self_certified_at = NOW()", [orgId]);
      await f.connection.execute("DELETE FROM trader_profiles WHERE party_type = 'host' AND party_id = ?", [host.partyId]);

      // --- split bookings --------------------------------------------------------------
      const centre = await bookableCentre(f, { rate: 20, cap: 20, payment: "online", owner: "QA_VENDOR_B" });
      const bookings: Record<string, { ref: string; game: string; session: Stripe.Checkout.Session; pi: string; snapshot: any; lines: any[] }> = {};
      const splitBooking = async (label: string, payer: "QA_USER" | "QA_USER_B", card?: string) => {
        const game = await createActivity(f, "QA_HOST", { capacity: 3, priceCents: 4000 });
        await f.connection.execute("UPDATE games SET centre_id = ? WHERE id = ?", [centre.id, game.id]);
        const proposed = await f.actors.QA_HOST.post(`/api/host/game-splits/${game.id}`, { data: { mode: "percentage", venueBps: 6667 } });
        expect(proposed.status(), "host proposes").toBe(201);
        const agreement = await proposed.json();
        expect((await f.actors.QA_VENDOR_B.post(`/api/vendor/splits/${agreement.id}/decision`, { data: { accept: true } })).status(), "venue accepts").toBe(200);
        const join = await f.actors[payer].post(`/api/games/${game.id}/join`, { data: {} });
        expect(join.status(), "paid join").toBe(201);
        const { ref, url } = await join.json();
        const [p] = await rows(f, "SELECT stripe_session_id AS sid FROM game_participants WHERE ref = ?", [ref]);
        const session = await payHosted(browser, url, p.sid, card);
        expect((await deliver(f.actors[payer], "checkout.session.completed", session)).status).toBe(200);
        await sleep(800);
        const pi = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent!.id;
        const [snapshot] = await rows(f, "SELECT * FROM allocation_snapshots WHERE source_type = 'game' AND source_ref = ?", [ref]);
        const lines = await rows(f, "SELECT role, party_id AS p, amount_minor AS m FROM allocation_lines WHERE snapshot_id = ? ORDER BY id", [snapshot.id]);
        bookings[label] = { ref, game: game.id, session, pi, snapshot, lines };
        return bookings[label];
      };
      const age = (label: string) => f.connection.execute("UPDATE games SET date = DATE_SUB(CURDATE(), INTERVAL 5 DAY) WHERE id = ?", [bookings[label].game]);

      // B1, B2: snapshot = Stripe charge, exact cents, rounding recorded.
      await splitBooking("B1", "QA_USER");
      await splitBooking("B2", "QA_USER_B");
      for (const b of [bookings.B1, bookings.B2]) {
        const charge = (await stripe.paymentIntents.retrieve(b.pi, { expand: ["latest_charge"] })).latest_charge as Stripe.Charge;
        expect(charge.livemode).toBe(false);
        expect(Number(b.snapshot.gross_minor), "snapshot gross = Stripe charge").toBe(charge.amount);
        expect(b.lines.map((l: any) => [l.role, Number(l.m)])).toEqual([["platform", 200], ["venue", 2667], ["host", 1333], ["tax", 920], ["deposit", 0]]);
        expect([Number(b.snapshot.rounding_adjustment_minor), b.snapshot.rounding_owner]).toEqual([1, "venue"]);
        expect(b.lines.reduce((a: number, l: any) => a + Number(l.m), 0)).toBe(charge.amount);
      }

      // --- H: weekly settlement + transfers; host held, venue paid --------------------
      age("B1");
      age("B2");
      // Balances from earlier specs in the same run (e.g. a carried amount) are netted in; compare against them.
      const priorVenue = await available(venue);
      const priorHost = await available(host);
      const prev1 = await admin("/settlements/run", { runKey: runKey("s1p"), dryRun: true });
      const s1Key = runKey("s1x");
      const s1 = await admin("/settlements/run", { runKey: s1Key, dryRun: false });
      expect(s1.status).toBe(200);
      const vS1 = s1.body.settled.find((s: any) => s.partyId === venue.partyId);
      const hS1 = s1.body.settled.find((s: any) => s.partyId === host.partyId);
      // Each partner's settlement holds this test's per-booking release items (exact cents) and nets to its items
      // (a combined run may add other earlier items for the same partner).
      const itemsOf = async (settlementId: number) => rows(f, "SELECT g.idempotency_key AS k, i.amount_minor AS m FROM settlement_items i JOIN ledger_entry_groups g ON g.id = i.ledger_group_id WHERE i.settlement_id = ?", [settlementId]);
      const vItems = await itemsOf(vS1.settlementId);
      const hItems = await itemsOf(hS1.settlementId);
      for (const b of [bookings.B1, bookings.B2]) {
        expect(Number(vItems.find((i: any) => i.k === `release:game:${b.ref}:org:${venue.partyId}`)?.m), `venue item ${b.ref}`).toBe(2667);
        expect(Number(hItems.find((i: any) => i.k === `release:game:${b.ref}:host:${host.partyId}`)?.m), `host item ${b.ref}`).toBe(1333);
      }
      expect([vS1.netMinor, hS1.netMinor], "settlement = Σ its items").toEqual([vItems.reduce((a: number, i: any) => a + Number(i.m), 0), hItems.reduce((a: number, i: any) => a + Number(i.m), 0)]);
      void priorVenue;
      void priorHost;
      expect(prev1.body.settled.find((s: any) => s.partyId === venue.partyId)?.netMinor, "preview = execution").toBe(vS1.netMinor);
      expect((await admin("/settlements/run", { runKey: s1Key, dryRun: false })).status, "same run key refused").toBe(409);
      const t1 = await admin("/transfers/run", { dryRun: false });
      const vT1 = t1.body.transferred.find((t: any) => t.settlementId === vS1.settlementId);
      expect(vT1?.amountMinor, "venue transferred").toBe(vS1.netMinor);
      expect(t1.body.held.find((h: any) => h.settlementId === hS1.settlementId)?.reasons.join(" "), "unverified host held — venue not blocked").toMatch(/Trader details/);
      const stripeT1 = await stripe.transfers.retrieve(vT1.transferId);
      expect([stripeT1.amount, stripeT1.destination, stripeT1.metadata.hc_qa_run, stripeT1.metadata.settlement_id, stripeT1.transfer_group]).toEqual([vS1.netMinor, venueAcct, RUN, String(vS1.settlementId), `settlement:${vS1.settlementId}`]);
      const allocT1 = await rows(f, "SELECT a.source_ref AS ref, a.amount_minor AS m FROM transfer_allocations a JOIN transfers t ON t.id = a.transfer_id WHERE t.provider_transfer_id = ? ORDER BY a.id", [vT1.transferId]);
      expect(allocT1.filter((a: any) => [bookings.B1.ref, bookings.B2.ref].includes(a.ref)).map((a: any) => [a.ref, Number(a.m)]).sort(), "per-booking allocations").toEqual([[bookings.B1.ref, 2667], [bookings.B2.ref, 2667]].sort());
      expect(allocT1.reduce((a: number, x: any) => a + Number(x.m), 0), "allocations add up to the transfer").toBe(vS1.netMinor);
      expect((await admin("/transfers/run", { dryRun: false })).body.transferred.length, "re-run transfers nothing twice").toBe(0);
      // Points after settlement: each partner on its own allocation; together ⌊4000 × 1/€⌋ = 40 per booking.
      const splitPoints = async (label: string) =>
        Object.fromEntries((await rows(f, "SELECT party_type AS t, points, reversed_points AS r, eligible_minor AS e FROM reward_split_awards WHERE source_ref = ?", [bookings[label].ref])).map((x: any) => [x.t === "host" ? "host" : "venue", { points: Number(x.points), reversed: Number(x.r), eligible: Number(x.e) }]));
      for (const label of ["B1", "B2"]) {
        const p = await splitPoints(label);
        expect([p.venue?.points, p.host?.points, p.venue?.eligible, p.host?.eligible], `${label} points per partner`).toEqual([27, 13, 2667, 1333]);
        expect(await rows(f, "SELECT id FROM reward_awards WHERE source_ref = ?", [bookings[label].ref]), "no whole-booking award").toEqual([]);
      }

      // --- D: partial refund of B1 after only the venue was transferred ----------------
      const r1 = await admin("/refunds", { sourceType: "game", ref: bookings.B1.ref, amountMinor: 1280, responsible: "partner" });
      expect(r1.status).toBe(200);
      expect([await available(venue), await available(host)], "¼ refund: venue 667, host 333 (exact cents)").toEqual([-667, -333]);
      const pB1 = await splitPoints("B1");
      expect([pB1.venue.reversed, pB1.host.reversed], "points re-derived on 2000/1000 → 20/10").toEqual([7, 3]);
      const vDebt1 = await admin(`/partners/org/${venue.partyId}/debts`, { reason: "Refund after transfer (split booking B1)", sourceType: "game", sourceRef: bookings.B1.ref });
      expect([vDebt1.status, vDebt1.body.recoveredMinor, vDebt1.body.unrecoveredMinor, vDebt1.body.status]).toEqual([200, 667, 0, "recovered"]);
      const trr1 = vDebt1.body.reversals[0];
      const stripeRev1 = (await stripe.transfers.listReversals(vT1.transferId)).data;
      expect(stripeRev1.map((r) => [r.amount, r.metadata?.hc_qa_run])).toEqual([[667, RUN]]);
      const hDebt1 = await admin(`/partners/host/${host.partyId}/debts`, { reason: "Refund after settlement (split booking B1)", sourceType: "game", sourceRef: bookings.B1.ref });
      expect([hDebt1.body.recoveredMinor, hDebt1.body.unrecoveredMinor, hDebt1.body.status], "host had no transfer: nothing reversed, debt stays open").toEqual([0, 333, "open"]);
      expect((await rows(f, "SELECT COUNT(*) AS n FROM transfer_reversals r JOIN transfers t ON t.id = r.transfer_id WHERE t.party_id = ?", [venue.partyId]))[0].n, "host's debt never touches the venue's transfers").toBe(1);

      // Host verified now — still frozen by its open debt.
      await f.connection.execute("INSERT INTO trader_profiles (party_type, party_id, entity_type, legal_name, address, country, email, phone, company_number, self_certified_at) VALUES ('host', ?, 'individual', 'QA Host', '1 QA St, Dublin', 'IE', 'qa.host@example.test', '0', NULL, NOW())", [host.partyId]);
      const t2a = await admin("/transfers/run", { dryRun: true });
      expect(t2a.body.held.find((h: any) => h.settlementId === hS1.settlementId)?.reasons.join(" "), "frozen partner excluded").toMatch(/Earnings frozen/);

      // --- B3: debt offset by the host's own new earnings; host carries below €25 -----
      await splitBooking("B3", "QA_USER");
      age("B3");
      const s2 = await admin("/settlements/run", { runKey: runKey("s2"), dryRun: false });
      const vS2 = s2.body.settled.find((s: any) => s.partyId === venue.partyId);
      expect(vS2?.netMinor).toBe(2667);
      const hC2 = s2.body.carried.find((c: any) => c.partyId === host.partyId);
      expect([hC2?.netMinor, hC2?.frozenByDebtId ?? null], "host: 1333 − 333 = 1000 carried (< €25), debt offset").toEqual([1000, null]);
      expect((await rows(f, "SELECT status FROM partner_debts WHERE id = ?", [hDebt1.body.debtId]))[0].status).toBe("offset");
      const t2 = await admin("/transfers/run", { dryRun: false });
      const hT1 = t2.body.transferred.find((t: any) => t.settlementId === hS1.settlementId);
      const vT2 = t2.body.transferred.find((t: any) => t.settlementId === vS2.settlementId);
      expect([hT1?.amountMinor, vT2?.amountMinor], "host's earlier settlement now transferred; venue's new one too").toEqual([hS1.netMinor, 2667]);
      expect((await stripe.transfers.retrieve(hT1.transferId)).destination).toBe(hostAcct);

      // --- D: full refund of B2 after BOTH partners were transferred -------------------
      const r2 = await admin("/refunds", { sourceType: "game", ref: bookings.B2.ref, responsible: "partner" });
      expect(r2.status).toBe(200);
      expect([await available(venue), await available(host)]).toEqual([-2667, -333]);
      const vDebt2 = await admin(`/partners/org/${venue.partyId}/debts`, { reason: "Full refund after transfer (split booking B2)", sourceType: "game", sourceRef: bookings.B2.ref });
      const hDebt2 = await admin(`/partners/host/${host.partyId}/debts`, { reason: "Full refund after transfer (split booking B2)", sourceType: "game", sourceRef: bookings.B2.ref });
      expect([vDebt2.body.recoveredMinor, vDebt2.body.status, hDebt2.body.recoveredMinor, hDebt2.body.status]).toEqual([2667, "recovered", 333, "recovered"]);
      const revB2 = await rows(f, "SELECT a.party_id AS p, a.source_ref AS ref, ar.amount_minor AS m FROM transfer_allocation_reversals ar JOIN transfer_allocations a ON a.id = ar.allocation_id JOIN transfer_reversals r ON r.id = ar.reversal_id WHERE r.debt_id IN (?, ?)", [vDebt2.body.debtId, hDebt2.body.debtId]);
      expect(revB2.map((x: any) => [x.p, x.ref, Number(x.m)]).sort(), "each partner's own B2 allocation reversed").toEqual([[host.partyId, bookings.B2.ref, 333], [venue.partyId, bookings.B2.ref, 2667]].sort());
      expect((await stripe.transfers.listReversals(hT1.transferId)).data.map((r) => r.amount)).toEqual([333]);
      const pB2 = await splitPoints("B2");
      expect([pB2.venue.reversed, pB2.host.reversed], "full refund: all points reversed, per partner").toEqual([27, 13]);

      // --- E: lost dispute after settlement on a split booking -------------------------
      const since = Math.floor(Date.now() / 1000);
      await splitBooking("B4", "QA_USER_B", "4000000000000259");
      age("B4");
      const s3 = await admin("/settlements/run", { runKey: runKey("s3"), dryRun: false });
      const vS3 = s3.body.settled.find((s: any) => s.partyId === venue.partyId);
      expect(vS3?.netMinor).toBe(2667);
      const t3 = await admin("/transfers/run", { dryRun: false });
      const vT3 = t3.body.transferred.find((t: any) => t.settlementId === vS3.settlementId);
      expect(vT3?.amountMinor).toBe(2667);
      let dispute: Stripe.Dispute | undefined;
      for (let i = 0; i < 40 && !dispute; i++) {
        dispute = (await stripe.disputes.list({ payment_intent: bookings.B4.pi, limit: 1 })).data[0];
        if (!dispute) await sleep(2_000);
      }
      expect(dispute, "Stripe opened the test dispute").toBeTruthy();
      const created = (await realEvents(dispute!.id, ["charge.dispute.created"], since))[0];
      expect((await deliverReal(f.actors.QA_USER_B, created)).status).toBe(200);
      await stripe.disputes.update(dispute!.id, { evidence: { uncategorized_text: "losing_evidence" }, metadata: { hc_qa_run: RUN } });
      let lost = dispute!;
      for (let i = 0; i < 60 && lost.status !== "lost"; i++) {
        await sleep(3_000);
        lost = await stripe.disputes.retrieve(dispute!.id);
      }
      expect(lost.status).toBe("lost");
      const closed = (await realEvents(dispute!.id, ["charge.dispute.closed"], since))[0];
      expect((await deliverReal(f.actors.QA_USER_B, closed)).status).toBe(200);
      expect((await deliverReal(f.actors.QA_USER_B, closed)).body.duplicate, "duplicate dispute webhook").toBe(true);
      const [disp] = await rows(f, "SELECT id, amount_minor AS a FROM disputes WHERE provider_dispute_id = ?", [lost.id]);
      const rec = await admin(`/disputes/${disp.id}/recovery`, { responsible: "partner" });
      expect(rec.status).toBe(200);
      const vShare = Math.floor((lost.amount * 2667) / 4000);
      const hShare = Math.floor((lost.amount * 1333) / 4000);
      const extra = lost.amount - vShare - hShare; // largest remainder goes to the bigger fraction
      const recMap = Object.fromEntries(rec.body.allocations.map((a: any) => [a.role, a.amountMinor]));
      expect(recMap.venue + recMap.host, "recovered = disputed amount").toBe(lost.amount);
      expect([recMap.venue - vShare, recMap.host - hShare].sort(), "proportional split, ≤1c remainder").toEqual([0, extra].sort());
      const stripeFee = (await stripe.disputes.retrieve(lost.id)).balance_transactions.reduce((a, b) => a + b.fee, 0);
      const [fee] = await rows(f, "SELECT COALESCE(SUM(e.amount_minor), 0) AS s FROM ledger_entries e JOIN ledger_entry_groups g ON g.id = e.group_id WHERE g.source_id = ? AND e.account_code = 'dispute_fee_expense'", [lost.id]);
      expect(Number(fee.s), "Stripe's actual dispute fee").toBe(stripeFee);
      const vDebt3 = await admin(`/partners/org/${venue.partyId}/debts`, { reason: "Lost chargeback after transfer (split booking B4)", sourceType: "game", sourceRef: bookings.B4.ref });
      expect(vDebt3.status).toBe(200);
      const pB4 = await splitPoints("B4");
      // Venue settled B4 before the dispute (27 points); lost 4923 of 5120 leaves eligible 103 / 51 → ⌊154/100⌋ = 1 → venue keeps 1.
      const lr = (total: number, w: number[]) => { const sum = w.reduce((a, b) => a + b, 0); const base = w.map((x) => Math.floor((total * x) / sum)); let left = total - base.reduce((a, b) => a + b, 0); w.map((x, i) => ({ i, r: (total * x) % sum })).sort((a, b) => b.r - a.r || a.i - b.i).forEach(({ i }) => { if (left-- > 0) base[i]++; }); return base; };
      const [dv, dh] = lr(lost.amount, [2667, 1333, 5120 - 4000]);
      const eligibleB4 = [2667 - dv, 1333 - dh];
      const keepB4 = Math.floor((eligibleB4[0] + eligibleB4[1]) / 100);
      const venueKeeps = keepB4 > 0 ? lr(keepB4, eligibleB4)[0] : 0;
      expect([pB4.venue?.points, pB4.venue?.reversed, pB4.host], "dispute reverses the venue's points proportionally; host not yet awarded").toEqual([27, 27 - venueKeeps, undefined]);
      const awardB4 = pB4;

      // --- B: bank payouts are Stripe's, separate from transfers ------------------------
      const payouts: Record<string, Stripe.Payout> = {};
      for (const [label, acctId] of [["venue", venueAcct], ["host", hostAcct]] as const) {
        payouts[label] = await stripe.payouts.create({ amount: 500, currency: "eur", metadata: { hc_qa_run: RUN } }, { stripeAccount: acctId });
      }
      const payoutOutcome: Record<string, string> = {};
      for (const [label, acctId] of [["venue", venueAcct], ["host", hostAcct]] as const) {
        let final: Stripe.Event | undefined;
        for (let i = 0; i < 40 && !final; i++) {
          const evs = await stripe.events.list({ types: ["payout.paid", "payout.failed"], limit: 20 }, { stripeAccount: acctId });
          final = evs.data.find((e) => (e.data.object as Stripe.Payout).id === payouts[label].id);
          if (!final) await sleep(3_000);
        }
        expect(final, `${label} payout settled at Stripe`).toBeTruthy();
        const created = (await stripe.events.list({ types: ["payout.created"], limit: 20 }, { stripeAccount: acctId })).data.find((e) => (e.data.object as Stripe.Payout).id === payouts[label].id);
        const actor = label === "venue" ? f.actors.QA_VENDOR_B : f.actors.QA_HOST;
        // Out of order: the final event first, then the older "created".
        expect((await deliverReal(actor, { ...final!, account: acctId } as Stripe.Event, { connect: true })).status).toBe(200);
        if (created) expect((await deliverReal(actor, { ...created, account: acctId } as Stripe.Event, { connect: true })).status).toBe(200);
        const [p] = await rows(f, "SELECT status, amount_minor AS a FROM connected_payouts WHERE provider_payout_id = ?", [payouts[label].id]);
        payoutOutcome[label] = p.status;
        expect([p.status, Number(p.a)]).toEqual([final!.type === "payout.paid" ? "paid" : "failed", 500]);
      }
      expect([payoutOutcome.venue, payoutOutcome.host], "IE29… pays out; IE89… (account_closed) fails").toEqual(["paid", "failed"]);
      const hostTransfers = await rows(f, "SELECT status FROM transfers WHERE party_id = ? AND provider_transfer_id = ?", [host.partyId, hT1.transferId]);
      expect(hostTransfers[0].status, "a failed bank payout doesn't change the HelloCircle transfer").toBe("partially_reversed");
      const hostView = await (await f.actors.QA_HOST.get("/api/host/payout-account")).json();
      expect(hostView.bankPayouts.find((b: any) => b.id === payouts.host.id)?.status).toBe("failed");
      expect(hostView.transfers.some((t: any) => t.id && String(t.id) !== payouts.host.id)).toBe(true);

      await ledgerBalanced(f);
      await ev5e("split", {
        venueAccount: venueAcct, hostAccount: hostAcct, accountStates: states,
        bookings: Object.fromEntries(Object.entries(bookings).map(([k, b]) => [k, { ref: b.ref, paymentIntent: b.pi, gross: Number(b.snapshot.gross_minor), lines: b.lines.map((l: any) => [l.role, Number(l.m)]), rounding: [Number(b.snapshot.rounding_adjustment_minor), b.snapshot.rounding_owner], splitAgreement: b.snapshot.split_agreement_id }])),
        settlement1: { venue: vS1.netMinor, host: hS1.netMinor }, transfer1: { venue: vT1.transferId, amount: vT1.amountMinor, allocations: allocT1.map((a: any) => [a.ref, Number(a.m)]), hostHeld: "Trader details" },
        refundB1Partial: { amount: 1280, venuePart: 667, hostPart: 333, venueReversal: { id: stripeRev1[0]?.id, amount: 667 }, hostDebt: { id: hDebt1.body.debtId, unrecovered: 333, then: "offset by own earnings" } },
        settlement2: { venue: vS2.netMinor, hostCarried: hC2.netMinor }, transfer2: { host: hT1.transferId, hostAmount: hT1.amountMinor, venue: vT2.transferId, venueAmount: vT2.amountMinor },
        refundB2Full: { venueRecovered: 2667, hostRecovered: 333, reversals: revB2.map((x: any) => [x.p === host.partyId ? "host" : "venue", Number(x.m)]) },
        points: { B1: await splitPoints("B1"), B2: await splitPoints("B2"), B3: await splitPoints("B3"), B4: pB4 },
        disputeB4: { id: lost.id, charged: Number(bookings.B4.snapshot.gross_minor), disputed: lost.amount, recovery: recMap, stripeFee, ledgerFee: Number(fee.s), venueDebt: { id: vDebt3.body.debtId, recovered: vDebt3.body.recoveredMinor, unrecovered: vDebt3.body.unrecoveredMinor }, pointsB4: awardB4 },
        bankPayouts: { venue: { id: payouts.venue.id, outcome: payoutOutcome.venue }, host: { id: payouts.host.id, outcome: payoutOutcome.host } },
      });
    } finally {
      for (const x of opened) await x.dispose();
      await cleanParty(venue);
      await cleanParty(host);
      await f.connection.execute("DELETE FROM trader_profiles WHERE party_type = 'host' AND party_id = ?", [host.partyId]);
      if (!traderBefore) await f.connection.execute("DELETE FROM trader_profiles WHERE party_type = 'org' AND party_id = ?", [orgId]);
      else await f.connection.execute("UPDATE trader_profiles SET self_certified_at = ? WHERE party_type = 'org' AND party_id = ?", [traderBefore.self_certified_at, orgId]);
      await restore();
    }
  });
});
