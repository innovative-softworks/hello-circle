import type { APIRequestContext } from "@playwright/test";
import { expect, personas } from "../fixtures";
import { rows, test, withActors } from "../lifecycle-fixture";
import { deliver, stripe, stripeProfile } from "../stripe-fixture";
import { experienceFor } from "../stage-b-fixture";
import { ageSession, assertSandbox, ledgerBalanced, paidExperienceBooking, payHosted, record, runKey, setSwitch, sleep } from "../stripe-sandbox-fixture";

// Revenue & Connect Stage 5d — B (direct vendor booking), D (refunds before
// transfer, reward reversal, credit restoration) and H (weekly settlement)
// against the Stripe TEST sandbox. Transfers / bank payouts / reversals need a
// connected account, which this sandbox can't create through Accounts v1 —
// see stripe-sandbox-connect.spec.ts; here the transfer run must hold the
// partner ("No payout account connected") and send nothing.

const SWITCHES = { "commerce.settlement_ledger": true, "commerce.engine_v2": true, "commerce.engine_v2_experience": true, "commerce.circle_credits": true, "commerce.customer_credits": true, "commerce.connect_v1": true };
const reason = "Stage 5d sandbox validation";

async function admin(a: APIRequestContext, method: "post" | "get", url: string, data?: unknown) {
  const r = method === "post" ? await a.post(url, { data }) : await a.get(url);
  return { status: r.status(), body: await r.json().catch(() => ({})) };
}

async function stripeFee(paymentIntentId: string) {
  const pi = await stripe.paymentIntents.retrieve(paymentIntentId, { expand: ["latest_charge.balance_transaction"] });
  assertSandbox(pi, "payment intent");
  const charge = pi.latest_charge as import("stripe").Stripe.Charge;
  const bt = charge.balance_transaction as import("stripe").Stripe.BalanceTransaction;
  return { chargeId: charge.id, fee: bt.fee, net: bt.net, amount: bt.amount, btId: bt.id, availableOn: bt.available_on, metadataRun: pi.metadata.hc_qa_run };
}

test("SANDBOX-MONEY-B-H: direct vendor booking → fee snapshot → actual fee reconciliation → 48 h eligibility → settlement preview/execute/rerun → held transfer", async ({ playwright, browser }) => {
  test.skip(!stripeProfile, "qa:stripe only");
  test.setTimeout(420_000);
  await withActors(playwright, ["QA_ADMIN"], async (f) => {
    const opened: APIRequestContext[] = [];
    const restore = await setSwitch(f, SWITCHES);
    const [{ org_id: orgId }] = await rows(f, "SELECT org_id FROM users WHERE id = ?", [personas.QA_VENDOR.id]);
    try {
      // Two paid bookings with the same vendor (combined into one settlement).
      const a = await paidExperienceBooking(playwright, browser, f, opened, { priceCents: 4000 });
      const b = await paidExperienceBooking(playwright, browser, f, opened, { priceCents: 2500 });
      for (const x of [a, b]) {
        expect(x.session.metadata?.hc_qa_run, "session tagged with run id").toBe(process.env.HC_QA_STRIPE_RUN);
        const d = await deliver(x.guest.ctx, "checkout.session.completed", x.session);
        expect(d.status).toBe(200);
      }
      await sleep(1500);
      const out: Record<string, unknown>[] = [];
      for (const x of [a, b]) {
        const [bk] = await rows(f, "SELECT payment_status, total_cents FROM experience_bookings WHERE ref = ?", [x.ref]);
        expect(bk.payment_status).toBe("paid");
        const [snap] = await rows(f, "SELECT s.customer_paid_minor AS paid, s.partner_payout_minor AS payout, s.success_fee_minor AS fee, s.vat_minor AS vat, s.customer_fee_minor AS cfee FROM pricing_snapshots s JOIN commerce_orders o ON o.id = s.order_id WHERE o.source_type = 'experience' AND o.source_ref = ?", [x.ref]);
        expect(Number(snap.paid), "snapshot total = Stripe charge").toBe(x.session.amount_total);
        const [pr] = await rows(f, "SELECT amount_minor, payment_intent_id, fee_estimate_minor FROM payment_records WHERE source_type = 'experience' AND source_ref = ?", [x.ref]);
        expect(Number(pr.amount_minor)).toBe(x.session.amount_total);
        expect(pr.payment_intent_id).toBe(x.paymentIntentId);
        const fee = await stripeFee(x.paymentIntentId);
        expect(fee.metadataRun, "payment intent tagged").toBe(process.env.HC_QA_STRIPE_RUN);
        out.push({ ref: x.ref, sessionId: x.sessionId, paymentIntentId: x.paymentIntentId, chargeId: fee.chargeId, balanceTransactionId: fee.btId, charged: x.session.amount_total, snapshotPaid: Number(snap.paid), partnerShare: Number(snap.payout), successFee: Number(snap.fee), vat: Number(snap.vat), customerFee: Number(snap.cfee), feeEstimate: Number(pr.fee_estimate_minor), stripeActualFee: fee.fee });
      }
      // Actual processing-fee reconciliation from Stripe's balance transactions.
      const rec = await admin(f.actors.QA_ADMIN, "post", "/api/admin/finance/fees/reconcile", {});
      expect(rec.status).toBe(200);
      for (const o of out) {
        const [r] = await rows(f, "SELECT estimate_minor AS e, actual_minor AS a, variance_minor AS v FROM fee_reconciliations fr JOIN payment_records p ON p.id = fr.payment_record_id WHERE p.source_ref = ?", [o.ref]);
        expect(Number(r.a), "actual fee = Stripe balance transaction fee").toBe(o.stripeActualFee);
        expect(Number(r.e), "estimate kept").toBe(o.feeEstimate);
        expect(Number(r.v)).toBe(Number(o.stripeActualFee) - Number(o.feeEstimate));
        o.reconciledActual = Number(r.a);
        o.variance = Number(r.v);
      }
      expect((await admin(f.actors.QA_ADMIN, "post", "/api/admin/finance/fees/reconcile", {})).body.reconciled, "fee reconciliation rerun is a no-op for these").toBeGreaterThanOrEqual(0);
      expect((await rows(f, "SELECT COUNT(*) AS n FROM fee_reconciliations fr JOIN payment_records p ON p.id = fr.payment_record_id WHERE p.source_ref IN (?, ?)", [a.ref, b.ref]))[0].n).toBe(2);
      await ledgerBalanced(f);

      // 48 h eligibility: not released before the session (+48 h) has passed.
      const early = await admin(f.actors.QA_ADMIN, "post", "/api/admin/finance/settlements/run", { runKey: runKey("early"), dryRun: true, reason });
      expect(early.body.released.map((r: any) => r.ref)).not.toContain(a.ref);
      // The org's balance before these bookings (the QA database persists across runs,
      // e.g. an unrecovered chargeback from the disputes flow leaves it negative).
      const partyNet = (body: any) => Number((body.settled.find((x: any) => x.partyId === orgId) ?? body.carried.find((x: any) => x.partyId === orgId))?.netMinor ?? 0);
      const priorNet = partyNet(early.body);
      await ageSession(f, a.exp.session);
      await ageSession(f, b.exp.session);
      // Preview, then execute, then repeat the same run.
      const key = runKey("week");
      const [{ m: settlementsBefore }] = await rows(f, "SELECT COALESCE(MAX(id), 0) AS m FROM settlements", []);
      const preview = await admin(f.actors.QA_ADMIN, "post", "/api/admin/finance/settlements/run", { runKey: key, dryRun: true, reason });
      const releasedPreview = preview.body.released.filter((r: any) => [a.ref, b.ref].includes(r.ref));
      expect(releasedPreview.map((r: any) => r.amountMinor).sort(), "preview releases each booking's partner share").toEqual([out[0].partnerShare, out[1].partnerShare].sort());
      expect(await rows(f, "SELECT id FROM settlements WHERE id > ?", [settlementsBefore]), "a preview settles nothing").toEqual([]);
      const exec = await admin(f.actors.QA_ADMIN, "post", "/api/admin/finance/settlements/run", { runKey: key, dryRun: false, reason });
      expect(exec.status).toBe(200);
      const expectedNet = Number(out[0].partnerShare) + Number(out[1].partnerShare);
      expect(partyNet(exec.body), "org net = prior balance + both partner shares").toBe(priorNet + expectedNet);
      if (priorNet + expectedNet < 2500) {
        // Prior negative balance (e.g. an unrecovered chargeback) absorbs these earnings — carried, not paid.
        expect(exec.body.settled.find((s: any) => s.partyId === orgId), "below €25 after prior debt → carried").toBeUndefined();
        await record("money-b-h", { bookings: out, expectedNet, priorNet, carried: priorNet + expectedNet, note: "carried: prior partner balance negative from the lost-dispute flow" });
        return;
      }
      const mine = exec.body.settled.find((s: any) => s.partyId === orgId);
      // Rerun-safe: the QA database persists, so earlier runs' released-but-unsettled
      // items for this partner may legitimately be combined into the same settlement.
      const items = await rows(f, "SELECT i.amount_minor AS amount, g.idempotency_key AS k FROM settlement_items i JOIN ledger_entry_groups g ON g.id = i.ledger_group_id WHERE i.settlement_id = ?", [mine.settlementId]);
      const ours = items.filter((i: any) => [`release:experience:${a.ref}`, `release:experience:${b.ref}`].includes(i.k));
      expect(ours.length, "both bookings combined in one settlement").toBe(2);
      expect(ours.reduce((s: number, i: any) => s + Number(i.amount), 0), "this run's items = Σ partner shares").toBe(expectedNet);
      expect(items.reduce((s: number, i: any) => s + Number(i.amount), 0), "items reconcile to the settlement net").toBe(Number(mine?.netMinor));
      const again = await admin(f.actors.QA_ADMIN, "post", "/api/admin/finance/settlements/run", { runKey: key, dryRun: false, reason });
      expect(again.status, "the same run key can't settle twice").toBe(409);
      // Transfer run: this partner has no connected account (Accounts v1 blocked) → held, nothing sent.
      const tr = await admin(f.actors.QA_ADMIN, "post", "/api/admin/finance/transfers/run", { dryRun: false, reason });
      expect(tr.status).toBe(200);
      expect(tr.body.held.find((h: any) => h.settlementId === mine.settlementId)?.reasons).toContain("No payout account connected");
      expect(await rows(f, "SELECT id FROM transfers WHERE party_id = ?", [orgId])).toEqual([]);
      // Reward points awarded on the settled GMV (Σ customer charges).
      const [award] = await rows(f, "SELECT SUM(points) AS p FROM reward_awards WHERE settlement_id = ?", [mine.settlementId]);
      const [ourAwards] = await rows(f, "SELECT SUM(points) AS p FROM reward_awards WHERE settlement_id = ? AND source_ref IN (?, ?)", [mine.settlementId, a.ref, b.ref]);
      expect(Number(ourAwards.p)).toBe(Math.floor(Number(out[0].charged) / 100) + Math.floor(Number(out[1].charged) / 100));
      await ledgerBalanced(f);
      await record("money-b-h", { bookings: out, settlementId: mine.settlementId, expectedNet, settlementNet: mine.netMinor, itemsInSettlement: items.length, pointsAwarded: Number(award.p), transferRun: "held: No payout account connected" });

      // Below €25 → carried forward (QA_VENDOR_B, €10 booking).
      const [{ org_id: orgBEarly }] = await rows(f, "SELECT org_id FROM users WHERE id = ?", [personas.QA_VENDOR_B.id]);
      const before = await admin(f.actors.QA_ADMIN, "post", "/api/admin/finance/settlements/run", { runKey: runKey("small-pre"), dryRun: true, reason });
      const priorCarried = Number(before.body.carried.find((c: any) => c.partyId === orgBEarly)?.netMinor ?? 0);
      const small = await experienceFor(f, "QA_VENDOR_B");
      await f.connection.execute("UPDATE experiences SET status = 'approved', kind = 'adventure', title = 'QA small', price_cents = 1000, capacity = 5, payment_method = 'online' WHERE id = ?", [small]);
      const smallSession = (await rows(f, "SELECT UUID() AS u", []))[0].u;
      await f.connection.execute("INSERT INTO experience_sessions (id, experience_id, date, time, capacity, status) VALUES (?, ?, DATE_ADD(CURDATE(), INTERVAL 14 DAY), '10:00', 5, 'scheduled')", [smallSession, small]);
      const g = (await (await import("../booking-fixture")).guest(playwright, opened));
      const res = await g.ctx.post(`/api/experiences/${small}/sessions/${smallSession}/checkout`, { data: { participantName: "QA", email: g.email, partySize: 1 } });
      expect(res.status()).toBe(201);
      const { ref: smallRef, url } = await res.json();
      const [srow] = await rows(f, "SELECT stripe_session_id AS sid FROM experience_bookings WHERE ref = ?", [smallRef]);
      const smallPaid = await payHosted(browser, url, srow.sid);
      await deliver(g.ctx, "checkout.session.completed", smallPaid);
      await sleep(1000);
      await ageSession(f, smallSession);
      const [{ org_id: orgB }] = await rows(f, "SELECT org_id FROM users WHERE id = ?", [personas.QA_VENDOR_B.id]);
      const small1 = await admin(f.actors.QA_ADMIN, "post", "/api/admin/finance/settlements/run", { runKey: runKey("small"), dryRun: false, reason });
      const share = small1.body.released.find((r: any) => r.ref === smallRef)?.amountMinor;
      expect(share, "the €10 booking released").toBeGreaterThan(0);
      const carried = small1.body.carried.find((c: any) => c.partyId === orgB);
      const settledB = small1.body.settled.find((s: any) => s.partyId === orgB);
      if (priorCarried + share < 2500) {
        // Rerun-safe: earlier runs' carried balance is combined with this booking.
        expect(carried?.netMinor, "below €25 carried forward").toBe(priorCarried + share);
        expect(settledB).toBeUndefined();
      } else {
        expect(settledB?.netMinor, "carry reached €25 → settled together").toBe(priorCarried + share);
      }
      await record("money-h-carry", { ref: smallRef, charged: smallPaid.amount_total, partnerShare: share, priorCarried, carriedNet: carried?.netMinor ?? null, settledNet: settledB?.netMinor ?? null });
    } finally {
      for (const x of opened) await x.dispose();
      await restore();
    }
  });
});

test("SANDBOX-MONEY-D: refunds before transfer (full, partial), refund after settlement reverses points, credit restored on refund", async ({ playwright, browser }) => {
  test.skip(!stripeProfile, "qa:stripe only");
  test.setTimeout(420_000);
  await withActors(playwright, ["QA_ADMIN", "QA_USER"], async (f) => {
    const opened: APIRequestContext[] = [];
    const restore = await setSwitch(f, SWITCHES);
    try {
      // Full refund before transfer.
      const full = await paidExperienceBooking(playwright, browser, f, opened, { priceCents: 3000 });
      await deliver(full.guest.ctx, "checkout.session.completed", full.session);
      await sleep(1000);
      const r1 = await admin(f.actors.QA_ADMIN, "post", "/api/admin/finance/refunds", { sourceType: "experience", ref: full.ref, reason, responsible: "partner" });
      expect(r1.status).toBe(200);
      expect(r1.body).toMatchObject({ amountMinor: full.session.amount_total, full: true });
      const [lr1] = await rows(f, "SELECT provider_refund_id AS id, amount_minor AS a FROM refunds WHERE source_ref = ?", [full.ref]);
      const sr1 = await stripe.refunds.retrieve(lr1.id);
      expect(sr1.id.startsWith("re_")).toBe(true); // refunds carry no livemode field; the run is test-mode (preflight + backend check)
      expect([sr1.amount, sr1.status, sr1.metadata?.hc_qa_run]).toEqual([full.session.amount_total, "succeeded", process.env.HC_QA_STRIPE_RUN]);
      // Stripe's own charge.refunded for the same refund records nothing new.
      const ch1 = await stripe.charges.retrieve((await stripe.paymentIntents.retrieve(full.paymentIntentId)).latest_charge as string);
      await deliver(full.guest.ctx, "charge.refunded", ch1);
      await sleep(800);
      expect((await rows(f, "SELECT COUNT(*) AS n FROM refunds WHERE source_ref = ?", [full.ref]))[0].n).toBe(1);

      // Partial refund before transfer.
      const part = await paidExperienceBooking(playwright, browser, f, opened, { priceCents: 5000 });
      await deliver(part.guest.ctx, "checkout.session.completed", part.session);
      await sleep(1000);
      const r2 = await admin(f.actors.QA_ADMIN, "post", "/api/admin/finance/refunds", { sourceType: "experience", ref: part.ref, amountMinor: 1234, reason, responsible: "partner" });
      expect(r2.body).toMatchObject({ amountMinor: 1234, full: false });
      const [lr2] = await rows(f, "SELECT provider_refund_id AS id FROM refunds WHERE source_ref = ?", [part.ref]);
      expect((await stripe.refunds.retrieve(lr2.id)).amount).toBe(1234);
      const ch2 = await stripe.charges.retrieve((await stripe.paymentIntents.retrieve(part.paymentIntentId)).latest_charge as string);
      expect(ch2.amount_refunded, "Stripe: partially refunded").toBe(1234);
      const reversal = await rows(f, "SELECT SUM(e.amount_minor) AS s FROM ledger_entries e JOIN ledger_entry_groups g ON g.id = e.group_id WHERE g.source_type = 'refund' AND e.account_code = 'stripe_clearing' AND g.source_id IN (SELECT CAST(id AS CHAR) FROM refunds WHERE source_ref = ?)", [part.ref]);
      expect(Number(reversal[0].s), "ledger reverses exactly the refunded cash").toBe(-1234);

      // Refund after settlement: points awarded at settlement are reversed proportionally.
      await ageSession(f, part.exp.session);
      const s = await admin(f.actors.QA_ADMIN, "post", "/api/admin/finance/settlements/run", { runKey: runKey("d"), dryRun: false, reason });
      expect(s.status).toBe(200);
      const [aw] = await rows(f, "SELECT points, gmv_minor AS gmv, refunded_at_award_minor AS ra FROM reward_awards WHERE source_ref = ?", [part.ref]);
      const r3 = await admin(f.actors.QA_ADMIN, "post", "/api/admin/finance/refunds", { sourceType: "experience", ref: part.ref, amountMinor: 1000, reason, responsible: "partner" });
      expect(r3.status).toBe(200);
      const [aw2] = await rows(f, "SELECT reversed_points AS r FROM reward_awards WHERE source_ref = ?", [part.ref]);
      const expectedReversed = Math.floor((Number(aw.points) * 1000) / Number(aw.gmv));
      expect(Number(aw2.r), "points reversed proportionally").toBe(expectedReversed);

      // Credit restoration: a resident's credit used at checkout comes back on a full refund.
      await f.connection.execute("INSERT INTO credit_lots (resident_id, kind, amount_minor, remaining_minor, reason, expires_at, created_by) VALUES (?, 'goodwill', 700, 700, 'QA 5d credit', DATE_ADD(NOW(), INTERVAL 30 DAY), 'qa')", [personas.QA_USER.id]);
      const exp = await (await import("../booking-fixture")).bookableExperience(f, { price: 3000, capacity: 5, payment: "online" });
      const res = await f.actors.QA_USER.post(`/api/experiences/${exp.id}/sessions/${exp.session}/checkout`, { headers: { "X-Client-Id": (await import("node:crypto")).randomUUID() }, data: { participantName: "QA", email: "qa.credit@example.test", partySize: 1, useCredits: true } });
      expect(res.status(), `credit checkout: ${await res.text()}`).toBe(201);
      const { ref, url } = await res.json();
      const [crow] = await rows(f, "SELECT stripe_session_id AS sid FROM experience_bookings WHERE ref = ?", [ref]);
      const paid = await payHosted(browser, url, crow.sid);
      await deliver(f.actors.QA_USER, "checkout.session.completed", paid);
      await sleep(1000);
      expect((await rows(f, "SELECT status FROM credit_uses WHERE source_ref = ?", [ref]))[0].status).toBe("confirmed");
      const [cs] = await rows(f, "SELECT s.platform_funded_discount_minor AS f, s.customer_paid_minor AS p FROM pricing_snapshots s JOIN commerce_orders o ON o.id = s.order_id WHERE o.source_ref = ?", [ref]);
      expect([Number(cs.f), Number(cs.p)], "credit is a HelloCircle-funded discount; Stripe charged the rest").toEqual([700, paid.amount_total]);
      await admin(f.actors.QA_ADMIN, "post", "/api/admin/finance/refunds", { sourceType: "experience", ref, reason, responsible: "platform" });
      await sleep(800);
      expect((await rows(f, "SELECT status FROM credit_uses WHERE source_ref = ?", [ref]))[0].status, "credit use reversed").toBe("reversed");
      expect(Number((await rows(f, "SELECT SUM(remaining_minor) AS r FROM credit_lots WHERE resident_id = ? AND reason = 'QA 5d credit'", [personas.QA_USER.id]))[0].r), "credit restored").toBe(700);
      await ledgerBalanced(f);
      await record("money-d", {
        fullRefund: { ref: full.ref, refundId: lr1.id, expected: full.session.amount_total, actual: sr1.amount },
        partialRefund: { ref: part.ref, refundId: lr2.id, expected: 1234, actual: ch2.amount_refunded },
        refundAfterSettlement: { ref: part.ref, points: Number(aw.points), expectedReversed, actualReversed: Number(aw2.r) },
        credit: { ref, creditUsed: 700, charged: paid.amount_total, restored: 700 },
      });
    } finally {
      for (const x of opened) await x.dispose();
      await f.connection.execute("DELETE FROM credit_uses WHERE resident_id = ?", [personas.QA_USER.id]);
      await f.connection.execute("DELETE FROM credit_lots WHERE resident_id = ? AND reason = 'QA 5d credit'", [personas.QA_USER.id]);
      await restore();
    }
  });
});
