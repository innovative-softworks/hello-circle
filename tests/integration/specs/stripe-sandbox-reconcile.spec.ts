import type Stripe from "stripe";
import { expect } from "../fixtures";
import { rows, test, withActors } from "../lifecycle-fixture";
import { stripe, stripeProfile } from "../stripe-fixture";
import { ledgerBalanced, record, RUN, v2core } from "../stripe-sandbox-fixture";

// Revenue & Connect Stage 5d — reconciliation: every payment in the QA
// database whose Stripe PaymentIntent carries a Stage 5d run tag is compared,
// cent for cent, with Stripe: charge amount, refunds (each by id), the actual
// card fee, disputes (amount and fee) and Pro invoices. Read-only on Stripe.

test("SANDBOX-RECONCILE: local records match Stripe to the cent", async ({ playwright }) => {
  test.skip(!stripeProfile, "qa:stripe only");
  test.setTimeout(600_000);
  await withActors(playwright, [], async (f) => {
    const payments = await rows(f, "SELECT id, source_type AS t, source_ref AS ref, payment_intent_id AS pi, amount_minor AS amount FROM payment_records WHERE payment_intent_id LIKE 'pi_%' ORDER BY id", []);
    const report: Record<string, unknown>[] = [];
    const mismatches: Record<string, unknown>[] = [];
    const flaggedExceptions: Record<string, unknown>[] = [];
    const check = (what: string, local: unknown, remote: unknown) => {
      if (JSON.stringify(local) !== JSON.stringify(remote)) mismatches.push({ what, local, stripe: remote });
    };
    let checked = 0;
    for (const p of payments) {
      let pi: Stripe.PaymentIntent;
      try {
        pi = await stripe.paymentIntents.retrieve(p.pi, { expand: ["latest_charge.balance_transaction"] });
      } catch {
        continue; // not a real Stripe object (stub-era row)
      }
      if (!String(pi.metadata?.hc_qa_run ?? "").startsWith("qa_stripe_")) continue; // only what Stage 5d created
      checked++;
      const charge = pi.latest_charge as Stripe.Charge;
      const bt = charge.balance_transaction as Stripe.BalanceTransaction;
      const local = {
        amount: Number(p.amount),
        refunded: Number((await rows(f, "SELECT COALESCE(SUM(amount_minor), 0) AS s FROM refunds WHERE payment_record_id = ? AND status IN ('succeeded','reconciled','pending')", [p.id]))[0].s),
        refundIds: (await rows(f, "SELECT provider_refund_id AS id FROM refunds WHERE payment_record_id = ? AND provider_refund_id IS NOT NULL ORDER BY id", [p.id])).map((r: any) => r.id).sort(),
        actualFee: (await rows(f, "SELECT actual_minor AS a FROM fee_reconciliations WHERE payment_record_id = ?", [p.id]))[0]?.a ?? null,
      };
      const stripeRefunds = (await stripe.refunds.list({ charge: charge.id, limit: 100 })).data.filter((r) => r.status === "succeeded" || r.status === "pending");
      check(`${p.ref}: charged`, local.amount, charge.amount);
      // A refund made at Stripe whose webhook a test deliberately withheld (HC-QA-091-PARTIAL,
      // labelled at Stripe) is reported as a known exception, never hidden or silently accepted.
      const withheld = stripeRefunds.filter((r) => r.metadata?.hc_qa_purpose === "webhook-withheld" && !local.refundIds.includes(r.id));
      if (withheld.length && local.refunded === 0 && withheld.reduce((a, r) => a + r.amount, 0) === charge.amount_refunded) {
        flaggedExceptions.push({ ref: p.ref, stripeRefunds: withheld.map((r) => r.id), stripeRefunded: charge.amount_refunded, localRefunded: 0, reason: "refund made outside HelloCircle; HC-QA-091-PARTIAL withholds its webhook to prove the app refuses to guess" });
      } else {
      check(`${p.ref}: refunded`, local.refunded, charge.amount_refunded);
      // Every recorded refund id exists at Stripe; any refund recorded without an id
      // (several refunds aggregated into one row) is covered exactly by Stripe's unmatched refunds.
      const stripeIds = new Set(stripeRefunds.map((r) => r.id));
      check(`${p.ref}: unknown refund ids`, local.refundIds.filter((id: string) => !stripeIds.has(id)), []);
      const unmatchedStripe = stripeRefunds.filter((r) => !local.refundIds.includes(r.id)).reduce((a, r) => a + r.amount, 0);
      const [{ s: nullIdLocal }] = await rows(f, "SELECT COALESCE(SUM(amount_minor), 0) AS s FROM refunds WHERE payment_record_id = ? AND provider_refund_id IS NULL AND status IN ('succeeded','reconciled','pending')", [p.id]);
      check(`${p.ref}: refunds without an id = Stripe's unmatched refunds`, Number(nullIdLocal), unmatchedStripe);
      }
      if (local.actualFee !== null) check(`${p.ref}: card fee`, Number(local.actualFee), bt.fee);
      const disputes = (await stripe.disputes.list({ payment_intent: pi.id, limit: 10 })).data;
      for (const d of disputes) {
        const [ld] = await rows(f, "SELECT status, amount_minor AS a FROM disputes WHERE provider_dispute_id = ?", [d.id]);
        if (!ld) continue; // a dispute the app was never told about (e.g. a test that didn't deliver it)
        check(`${p.ref}: dispute ${d.id}`, [ld.status, Number(ld.a)], [d.status, d.amount]);
        const fee = d.balance_transactions.reduce((a, b) => a + b.fee, 0);
        const [lf] = await rows(f, "SELECT COALESCE(SUM(e.amount_minor), 0) AS s FROM ledger_entries e JOIN ledger_entry_groups g ON g.id = e.group_id WHERE g.source_id = ? AND e.account_code = 'dispute_fee_expense'", [d.id]);
        check(`${p.ref}: dispute fee`, Number(lf.s), fee);
      }
      report.push({ ref: p.ref, paymentIntent: pi.id, charge: charge.id, amount: charge.amount, refunded: charge.amount_refunded, refunds: stripeRefunds.map((r) => r.id), stripeFee: bt.fee, localFee: local.actualFee, disputes: disputes.map((d) => ({ id: d.id, status: d.status, amount: d.amount })) });
    }
    expect(checked, "at least one Stage 5d payment reconciled").toBeGreaterThan(0);
    // Pro invoices posted to the ledger match Stripe's totals and tax.
    const invoices = await rows(f, "SELECT source_id AS id FROM ledger_entry_groups WHERE idempotency_key LIKE 'invoice:in_%'", []);
    const inv: Record<string, unknown>[] = [];
    for (const g of invoices) {
      let i: Stripe.Invoice;
      try {
        i = await stripe.invoices.retrieve(g.id);
      } catch {
        continue;
      }
      const lines = await rows(f, "SELECT e.account_code AS a, e.amount_minor AS m FROM ledger_entries e JOIN ledger_entry_groups g ON g.id = e.group_id WHERE g.idempotency_key = ?", [`invoice:${g.id}`]);
      const cash = Number(lines.find((l: any) => l.a === "stripe_clearing")?.m ?? 0);
      const vat = -Number(lines.find((l: any) => l.a === "subscription_vat_payable")?.m ?? 0);
      const tax = (i.total_taxes ?? []).reduce((a, t) => a + t.amount, 0);
      check(`invoice ${g.id}`, [cash, vat], [i.amount_paid, tax]);
      inv.push({ invoice: g.id, paid: i.amount_paid, tax, ledgerCash: cash, ledgerVat: vat });
    }
    // Stage 5e — transfers ↔ settlements ↔ allocations ↔ reversals ↔ debts, against Stripe.
    const transfers = await rows(f, "SELECT id, settlement_id AS sid, provider_transfer_id AS tid, amount_minor AS amount, reversed_minor AS reversed, status FROM transfers WHERE provider_transfer_id LIKE 'tr_%'", []);
    const transferReport: Record<string, unknown>[] = [];
    for (const t of transfers) {
      let st: Stripe.Transfer;
      try {
        st = await stripe.transfers.retrieve(t.tid);
      } catch {
        mismatches.push({ what: `transfer ${t.tid}: not found at Stripe`, local: Number(t.amount), stripe: null });
        continue;
      }
      check(`transfer ${t.tid}: amount`, Number(t.amount), st.amount);
      check(`transfer ${t.tid}: reversed`, Number(t.reversed), st.amount_reversed);
      const [{ s: alloc }] = await rows(f, "SELECT COALESCE(SUM(amount_minor), 0) AS s FROM transfer_allocations WHERE transfer_id = ?", [t.id]);
      check(`transfer ${t.tid}: allocations sum`, Number(alloc), Number(t.amount));
      const [settlement] = await rows(f, "SELECT net_minor AS n, transfer_id AS tid FROM settlements WHERE id = ?", [t.sid]);
      if (t.status !== "failed") check(`transfer ${t.tid}: settlement net`, Number(settlement?.n), Number(t.amount));
      const localRevs = await rows(f, "SELECT provider_reversal_id AS id, amount_minor AS a FROM transfer_reversals WHERE transfer_id = ? AND status = 'created'", [t.id]);
      const stripeRevs = (await stripe.transfers.listReversals(t.tid, { limit: 100 })).data;
      check(`transfer ${t.tid}: reversal ids`, localRevs.map((r: any) => r.id).sort(), stripeRevs.map((r) => r.id).sort());
      transferReport.push({ transfer: t.tid, amount: st.amount, reversed: st.amount_reversed, allocations: Number(alloc), settlement: Number(settlement?.n), reversals: stripeRevs.map((r) => [r.id, r.amount]) });
    }
    const debts = await rows(f, "SELECT id, recovered_minor AS rec FROM partner_debts", []);
    for (const d of debts) {
      const [{ s: rev }] = await rows(f, "SELECT COALESCE(SUM(amount_minor), 0) AS s FROM transfer_reversals WHERE debt_id = ? AND status = 'created'", [d.id]);
      check(`debt #${d.id}: recovered = its reversals`, Number(d.rec), Number(rev));
    }
    // Every succeeded Stripe payment tagged for THIS run is represented locally (or explained).
    const tagged: Stripe.PaymentIntent[] = [];
    for await (const pi of stripe.paymentIntents.search({ query: `metadata['hc_qa_run']:'${RUN}' AND status:'succeeded'`, limit: 100 })) tagged.push(pi);
    const unexplained: string[] = [];
    const explained: Record<string, unknown>[] = [];
    for (const pi of tagged) {
      const [local] = await rows(f, "SELECT id FROM payment_records WHERE payment_intent_id = ?", [pi.id]);
      if (local) continue;
      const charge = pi.latest_charge ? await stripe.charges.retrieve(String(pi.latest_charge)) : null;
      // D-10: a payment held for review is recorded on its payment review (not as a payment record) —
      // it must match Stripe to the cent, refunds included.
      const [review] = await rows(f, "SELECT id, source_type AS t, source_ref AS ref, received_minor AS m, received_currency AS c FROM payment_reviews WHERE payment_intent_id = ?", [pi.id]);
      if (review && charge) {
        check(`review #${review.id}: received`, [Number(review.m), String(review.c)], [charge.amount, charge.currency.toUpperCase()]);
        const [{ s: refunded }] = await rows(f, "SELECT COALESCE(SUM(amount_minor), 0) AS s FROM refunds WHERE source_type = ? AND source_ref = ? AND status IN ('succeeded', 'reconciled', 'pending')", [review.t, review.ref]);
        check(`review #${review.id}: refunded`, Number(refunded), charge.amount_refunded);
        explained.push({ paymentIntent: pi.id, reason: `held for finance review (D-10), recorded on payment review #${review.id}` });
        continue;
      }
      if (charge && charge.amount_refunded === charge.amount) explained.push({ paymentIntent: pi.id, reason: "paid after its hold lapsed (STRIPE-LATE-SUCCESS) and fully refunded" });
      else unexplained.push(pi.id);
    }
    check("tagged Stripe payments without a local record", unexplained, []);
    // Every connected account tagged for this run is the app's (linked) or a labelled test double / probe.
    const accts: string[] = [];
    for await (const a of v2core().accounts.list({ limit: 20, applied_configurations: ["recipient"] }) as AsyncIterable<any>) {
      if (a.metadata?.hc_qa_run === RUN) accts.push(a.id);
    }
    const accountReport: Record<string, unknown>[] = [];
    for (const id of accts) {
      const a = await v2core().accounts.retrieve(id);
      const purpose = a.metadata?.purpose ?? (a.metadata?.party_type ? "app-created (Express, onboarding via Stripe-hosted page)" : "unexplained");
      if (purpose === "unexplained") mismatches.push({ what: `account ${id}: no purpose`, local: null, stripe: a.metadata });
      accountReport.push({ account: id, dashboard: a.dashboard, purpose });
    }
    await ledgerBalanced(f);
    await record("reconcile", { paymentsChecked: checked, mismatches, flaggedExceptions, explainedStripePayments: explained, taggedPayments: tagged.length, payments: report, invoices: inv, transfers: transferReport, debtsChecked: debts.length, accounts: accountReport }, "stage5e");
    expect(mismatches, "local records = Stripe, to the cent").toEqual([]);
  });
});
