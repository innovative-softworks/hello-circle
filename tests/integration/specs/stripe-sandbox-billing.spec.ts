import type Stripe from "stripe";
import { expect, personas } from "../fixtures";
import { rows, test, withActors } from "../lifecycle-fixture";
import { deliver, stripe, stripeProfile } from "../stripe-fixture";
import { assertSandbox, deliverReal, ledgerBalanced, payHosted, realEvents, record, setSwitch, sleep, tagged } from "../stripe-sandbox-fixture";

// Revenue & Connect Stage 5d — F: HelloCircle Pro on Stripe Billing (TEST).
// The app's own checkout path is paid on hosted Checkout (IE 23% VAT, and a
// partner on an exempt tax rule). Renewal, failed renewal, grace and
// cancellation at period end need time to pass, so they run on subscriptions
// this suite creates on Stripe TEST CLOCKS (same price, tax rate and metadata
// contract as the app's checkout), delivered to the app as the real events.

const reason = "Stage 5d sandbox validation";

async function advance(clockId: string, to: number) {
  await stripe.testHelpers.testClocks.advance(clockId, { frozen_time: to });
  for (let i = 0; i < 90; i++) {
    const c = await stripe.testHelpers.testClocks.retrieve(clockId);
    if (c.status === "ready") return c;
    await sleep(2_000);
  }
  throw new Error("test clock did not settle");
}

async function invoicesOf(subId: string) {
  return (await stripe.invoices.list({ subscription: subId, limit: 10 })).data;
}

async function planOf(f: any, orgId: string) {
  const [r] = await rows(f, "SELECT plan_key AS p FROM partner_plan_assignments WHERE partner_kind = 'org' AND partner_id = ? AND effective_from <= NOW() AND (effective_to IS NULL OR effective_to > NOW()) ORDER BY id DESC LIMIT 1", [orgId]);
  return r?.p ?? "free";
}

test("SANDBOX-BILLING-F: Pro €29 net + IE 23% VAT, exempt partner, renewal, failed renewal + 7-day grace, cancel at period end, points month and points debt", async ({ playwright, browser }) => {
  test.skip(!stripeProfile, "qa:stripe only");
  test.setTimeout(900_000);
  await withActors(playwright, ["QA_ADMIN", "QA_VENDOR", "QA_VENDOR_B"], async (f) => {
    const restore = await setSwitch(f, { "commerce.pro_subscriptions": true, "commerce.settlement_ledger": true, "commerce.circle_credits": true });
    const [{ org_id: orgA }] = await rows(f, "SELECT org_id FROM users WHERE id = ?", [personas.QA_VENDOR.id]);
    const [{ org_id: orgB }] = await rows(f, "SELECT org_id FROM users WHERE id = ?", [personas.QA_VENDOR_B.id]);
    const clocks: string[] = [];
    let f1Sub = "";
    const since = Math.floor(Date.now() / 1000);
    try {
      // F1 — the app's checkout: €29.00 net + VAT 23% = €35.67, paid on hosted Checkout.
      const co = await f.actors.QA_VENDOR.post("/api/vendor/plan/pro/checkout");
      expect(co.status()).toBe(200);
      const { id: sessionId, url } = await co.json();
      const paid = await payHosted(browser, url, sessionId, "4242424242424242");
      const s = await stripe.checkout.sessions.retrieve(sessionId, { expand: ["subscription", "invoice"] });
      assertSandbox(s, "subscription checkout");
      expect([s.amount_subtotal, s.total_details?.amount_tax, s.amount_total]).toEqual([2900, 667, 3567]);
      expect(s.metadata?.hc_qa_run).toBe(process.env.HC_QA_STRIPE_RUN);
      const sub = s.subscription as Stripe.Subscription;
      f1Sub = sub.id;
      expect(sub.metadata.hc_qa_run, "subscription tagged").toBe(process.env.HC_QA_STRIPE_RUN);
      const taxRate = sub.items.data[0].tax_rates?.[0] as Stripe.TaxRate;
      expect([taxRate.percentage, taxRate.inclusive, taxRate.country, taxRate.livemode]).toEqual([23, false, "IE", false]);
      expect((await deliver(f.actors.QA_VENDOR, "checkout.session.completed", paid)).status).toBe(200);
      await sleep(800);
      expect(await planOf(f, orgA), "Pro starts on the paid checkout").toBe("pro");
      const inv = s.invoice as Stripe.Invoice;
      const [invPaid] = await realEvents(inv.id!, ["invoice.paid"], since);
      expect((await deliverReal(f.actors.QA_VENDOR, invPaid)).status).toBe(200);
      const lines = await rows(f, "SELECT e.account_code AS a, e.amount_minor AS m FROM ledger_entries e JOIN ledger_entry_groups g ON g.id = e.group_id WHERE g.idempotency_key = ? ORDER BY e.line_no", [`invoice:${inv.id}`]);
      expect(lines.map((l: any) => [l.a, Number(l.m)])).toEqual([["stripe_clearing", 3567], ["subscription_revenue", -2900], ["subscription_vat_payable", -667]]);
      expect((await deliverReal(f.actors.QA_VENDOR, invPaid)).body.duplicate, "invoice event replay").toBe(true);
      // Cancel at period end and undo, on the real subscription.
      expect((await f.actors.QA_VENDOR.post("/api/vendor/plan/pro/cancel")).status()).toBe(200);
      expect((await stripe.subscriptions.retrieve(sub.id)).cancel_at_period_end).toBe(true);
      expect((await f.actors.QA_VENDOR.post("/api/vendor/plan/pro/resume")).status()).toBe(200);
      expect((await stripe.subscriptions.retrieve(sub.id)).cancel_at_period_end).toBe(false);
      await record("billing-f1", { sessionId, subscriptionId: sub.id, invoiceId: inv.id, taxRateId: taxRate.id, expected: { net: 2900, vat: 667, gross: 3567 }, actual: { net: s.amount_subtotal, vat: s.total_details?.amount_tax, gross: s.amount_total }, ledger: lines });

      // F2 — exempt partner (partner-scoped tax rule): €29.00, no VAT line.
      const d = await f.actors.QA_ADMIN.post("/api/admin/commerce/rules/drafts", { data: { key: "tax_vat", scopeType: "partner", scopeId: `org:${orgB}`, payload: { vatMode: "exempt" }, reason } });
      const ruleId = (await d.json()).id;
      await f.actors.QA_ADMIN.post(`/api/admin/commerce/rules/${ruleId}/publish`, { data: { reason } });
      const ex = await f.actors.QA_VENDOR_B.post("/api/vendor/plan/pro/checkout");
      const exS = await stripe.checkout.sessions.retrieve((await ex.json()).id, { expand: ["line_items.data.taxes"] });
      expect([exS.amount_subtotal, exS.total_details?.amount_tax, exS.amount_total], "exempt: no VAT").toEqual([2900, 0, 2900]);
      await stripe.checkout.sessions.expire(exS.id); // our own session, tidied
      await f.connection.execute("UPDATE partner_subscriptions SET status = 'abandoned' WHERE checkout_session_id = ?", [exS.id]);
      await f.actors.QA_ADMIN.post(`/api/admin/commerce/rules/${ruleId}/retire`, { data: { reason } });
      await record("billing-f2", { sessionId: exS.id, expected: { net: 2900, vat: 0, gross: 2900 }, actual: { net: exS.amount_subtotal, vat: exS.total_details?.amount_tax, gross: exS.amount_total } });
      // Stage 5e — F2b: reverse charge (partner-scoped rule, where configured): €29.00, VAT 0, same as exempt.
      const rcD = await f.actors.QA_ADMIN.post("/api/admin/commerce/rules/drafts", { data: { key: "tax_vat", scopeType: "partner", scopeId: `org:${orgB}`, payload: { vatMode: "reverse_charge" }, reason } });
      const rcId = (await rcD.json()).id;
      await f.actors.QA_ADMIN.post(`/api/admin/commerce/rules/${rcId}/publish`, { data: { reason } });
      const rc = await f.actors.QA_VENDOR_B.post("/api/vendor/plan/pro/checkout");
      const rcS = await stripe.checkout.sessions.retrieve((await rc.json()).id, { expand: ["line_items.data.taxes"] });
      expect([rcS.amount_subtotal, rcS.total_details?.amount_tax, rcS.amount_total], "reverse charge: no VAT charged").toEqual([2900, 0, 2900]);
      await stripe.checkout.sessions.expire(rcS.id);
      await f.connection.execute("UPDATE partner_subscriptions SET status = 'abandoned' WHERE checkout_session_id = ?", [rcS.id]);
      await f.actors.QA_ADMIN.post(`/api/admin/commerce/rules/${rcId}/retire`, { data: { reason } });
      await record("billing-f2b", { sessionId: rcS.id, vatMode: "reverse_charge", expected: { net: 2900, vat: 0, gross: 2900 }, actual: { net: rcS.amount_subtotal, vat: rcS.total_details?.amount_tax, gross: rcS.amount_total } }, "stage5e");

      // Test-clock subscriptions for org B (same price, tax rate and metadata contract as the app's).
      const product = await stripe.products.create({ name: "HelloCircle Pro (QA sandbox)", metadata: tagged() });
      async function clockSubscription(label: string) {
        const now = Math.floor(Date.now() / 1000);
        const clock = await stripe.testHelpers.testClocks.create({ frozen_time: now, name: `${process.env.HC_QA_STRIPE_RUN}-${label}` });
        clocks.push(clock.id);
        const customer = await stripe.customers.create({ test_clock: clock.id, email: `qa.${label}@example.test`, payment_method: "pm_card_visa", invoice_settings: { default_payment_method: "pm_card_visa" }, metadata: tagged() });
        const sub = await stripe.subscriptions.create({
          customer: customer.id,
          items: [{ price_data: { currency: "eur", product: product.id, unit_amount: 2900, recurring: { interval: "month" } }, tax_rates: [taxRate.id] }],
          metadata: tagged({ type: "subscription", party_type: "org", party_id: orgB }),
        });
        // The app's side of a paid checkout for it.
        const cs = `cs_qa5d_${label}_${Date.now()}`;
        await f.connection.execute("INSERT INTO partner_subscriptions (party_type, party_id, checkout_session_id, status, gross_minor, net_minor, vat_minor, vat_bps, vat_mode, created_by) VALUES ('org', ?, ?, 'checkout', 3567, 2900, 667, 2300, 'standard', ?)", [orgB, cs, personas.QA_VENDOR_B.id]);
        expect((await deliver(f.actors.QA_VENDOR_B, "checkout.session.completed", { id: cs, object: "checkout.session", payment_status: "paid", subscription: sub.id, metadata: { type: "subscription" } })).status).toBe(200);
        const first = (await invoicesOf(sub.id))[0];
        const ev = await realEvents(first.id!, ["invoice.paid"], now);
        expect((await deliverReal(f.actors.QA_VENDOR_B, ev[0])).status).toBe(200);
        return { clock, customer, sub, start: now };
      }

      // F3a — successful renewal, then cancellation at the end of the period.
      const A = await clockSubscription("renew");
      expect(await planOf(f, orgB)).toBe("pro");
      await advance(A.clock.id, A.start + 32 * 86_400);
      const renewal = (await invoicesOf(A.sub.id)).find((i) => i.billing_reason === "subscription_cycle")!;
      expect([renewal.status, renewal.total], "renewal invoice paid at €35.67").toEqual(["paid", 3567]);
      const [renewPaid] = await realEvents(renewal.id!, ["invoice.paid"], A.start);
      expect((await deliverReal(f.actors.QA_VENDOR_B, renewPaid)).status).toBe(200);
      expect((await rows(f, "SELECT COUNT(*) AS n FROM ledger_entry_groups WHERE idempotency_key LIKE 'invoice:%' AND source_id IN (?, ?)", [renewal.id, (await invoicesOf(A.sub.id)).at(-1)!.id]))[0].n).toBe(2);
      expect((await f.actors.QA_VENDOR_B.post("/api/vendor/plan/pro/cancel")).status()).toBe(200);
      const atEnd = await stripe.subscriptions.retrieve(A.sub.id);
      expect(atEnd.cancel_at_period_end).toBe(true);
      expect(await planOf(f, orgB), "Pro until the period ends").toBe("pro");
      await advance(A.clock.id, A.start + 70 * 86_400);
      expect((await stripe.subscriptions.retrieve(A.sub.id)).status).toBe("canceled");
      const [deleted] = await realEvents(A.sub.id, ["customer.subscription.deleted"], A.start);
      expect((await deliverReal(f.actors.QA_VENDOR_B, deleted)).status).toBe(200);
      expect(await planOf(f, orgB), "Free after the period").toBe("free");
      await record("billing-f3a", { clockId: A.clock.id, subscriptionId: A.sub.id, renewalInvoice: renewal.id, renewalTotal: renewal.total, deletedEvent: deleted.id });

      // F3b — failed renewal → past_due → 7-day grace → Pro ends, Stripe subscription cancelled by the app.
      const B = await clockSubscription("fail");
      const failing = await stripe.paymentMethods.attach("pm_card_chargeCustomerFail", { customer: B.customer.id });
      await stripe.customers.update(B.customer.id, { invoice_settings: { default_payment_method: failing.id } });
      await advance(B.clock.id, B.start + 32 * 86_400);
      const failedInv = (await invoicesOf(B.sub.id)).find((i) => i.billing_reason === "subscription_cycle")!;
      const [payFailed] = await realEvents(failedInv.id!, ["invoice.payment_failed"], B.start);
      expect(payFailed, "Stripe emitted invoice.payment_failed").toBeTruthy();
      expect((await deliverReal(f.actors.QA_VENDOR_B, payFailed)).status).toBe(200);
      // Times are stored in UTC; compare in the database, not via this machine's local timezone.
      const [ps] = await rows(f, "SELECT status, TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(), grace_until) AS secs FROM partner_subscriptions WHERE provider_subscription_id = ?", [B.sub.id]);
      expect(ps.status).toBe("past_due");
      const graceDays = Number(ps.secs) / 86_400;
      expect(graceDays).toBeGreaterThan(6.9);
      expect(graceDays).toBeLessThan(7.1);
      expect(await planOf(f, orgB), "Pro kept during grace").toBe("pro");
      const subUpd = (await realEvents(B.sub.id, ["customer.subscription.updated"], B.start)).find((e) => (e.data.object as Stripe.Subscription).status === "past_due");
      if (subUpd) expect((await deliverReal(f.actors.QA_VENDOR_B, subUpd)).status).toBe(200);
      await f.connection.execute("UPDATE partner_subscriptions SET grace_until = DATE_SUB(NOW(), INTERVAL 1 MINUTE) WHERE provider_subscription_id = ?", [B.sub.id]);
      const sweep = await (await f.actors.QA_ADMIN.post("/api/admin/finance/subscriptions/sweep")).json();
      expect(sweep.ended).toBeGreaterThanOrEqual(1);
      expect((await stripe.subscriptions.retrieve(B.sub.id)).status, "the app cancelled it at Stripe").toBe("canceled");
      expect(await planOf(f, orgB)).toBe("free");
      const [delB] = await realEvents(B.sub.id, ["customer.subscription.deleted"], B.start);
      expect((await deliverReal(f.actors.QA_VENDOR_B, delB)).status, "late deletion event is harmless").toBe(200);
      await record("billing-f3b", { clockId: B.clock.id, subscriptionId: B.sub.id, failedInvoice: failedInv.id, failedEvent: payFailed.id, graceDays: Math.round(graceDays * 100) / 100 });

      // F4 — a free month for 10,000 points; a points debt blocks redemption.
      await f.connection.execute("INSERT INTO reward_lots (party_type, party_id, source_ref, points_earned, points_remaining, expires_at) VALUES ('org', ?, ?, 10000, 10000, DATE_ADD(NOW(), INTERVAL 90 DAY))", [orgB, `qa5d-lot-${Date.now()}`]);
      const red = await f.actors.QA_VENDOR_B.post("/api/vendor/plan/rewards/redeem");
      expect(red.status()).toBe(200);
      expect(await planOf(f, orgB), "10,000 points → a month of Pro").toBe("pro");
      await f.connection.execute("INSERT INTO reward_debts (party_type, party_id, points_owed) VALUES ('org', ?, 50) ON DUPLICATE KEY UPDATE points_owed = 50", [orgB]);
      await f.connection.execute("INSERT INTO reward_lots (party_type, party_id, source_ref, points_earned, points_remaining, expires_at) VALUES ('org', ?, ?, 20000, 20000, DATE_ADD(NOW(), INTERVAL 90 DAY))", [orgB, `qa5d-lot2-${Date.now()}`]);
      const blocked = await f.actors.QA_VENDOR_B.post("/api/vendor/plan/rewards/redeem");
      expect(blocked.status(), "points debt blocks redemption").toBe(409);
      await ledgerBalanced(f);
    } finally {
      // Tidy only what this run created: its own F1 subscription and its own test clocks.
      if (f1Sub) await stripe.subscriptions.cancel(f1Sub).catch(() => undefined);
      for (const c of clocks) await stripe.testHelpers.testClocks.del(c).catch(() => undefined);
      await f.connection.execute("DELETE FROM reward_lots WHERE party_type = 'org' AND party_id = ? AND source_ref LIKE 'qa5d-lot%'", [orgB]);
      await f.connection.execute("DELETE FROM reward_debts WHERE party_type = 'org' AND party_id = ?", [orgB]);
      await f.connection.execute("DELETE FROM reward_redemptions WHERE party_type = 'org' AND party_id = ?", [orgB]);
      await f.connection.execute("DELETE FROM partner_plan_assignments WHERE partner_kind = 'org' AND partner_id IN (?, ?)", [orgA, orgB]);
      await f.connection.execute("UPDATE partner_subscriptions SET status = 'canceled' WHERE party_type = 'org' AND party_id IN (?, ?) AND status IN ('checkout','active','past_due')", [orgA, orgB]);
      await restore();
    }
  });
});
