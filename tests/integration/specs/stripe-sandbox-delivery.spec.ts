import { spawn, type ChildProcess } from "node:child_process";
import type { APIRequestContext } from "@playwright/test";
import type Stripe from "stripe";
import { env, expect, personas } from "../fixtures";
import { rows, test, withActors } from "../lifecycle-fixture";
import { stripe, stripeProfile } from "../stripe-fixture";
import { attachAccount, createVerifiedRecipient, paidExperienceBooking, record, RUN, setSwitch, sleep, v2core } from "../stripe-sandbox-fixture";

// Revenue & Connect Stage 5e — G: REAL Stripe-generated deliveries. While this
// spec runs, `stripe listen` (test mode, the run's own CLI session) forwards
// Stripe's actual webhook deliveries to the QA backend. Nothing here is
// hand-signed: every assertion waits for the event to arrive by itself.
// (Hand-signed fixture events — negative and ordering tests — are in the
// webhooks spec and are reported separately.)

const SNAPSHOT = ["checkout.session.completed", "charge.refunded", "charge.dispute.created", "transfer.created", "transfer.reversed", "payout.created", "payout.paid", "payout.failed"];
const THIN = ["v2.core.account.updated", "v2.core.account[identity].updated", "v2.core.account[requirements].updated", "v2.core.account[configuration.recipient].capability_status_updated"];

/** One `stripe listen` per destination (the CLI won't send snapshot and thin events to the same URL). */
async function startListener(path: string, events: string[]): Promise<{ stop: () => Promise<void> }> {
  const child: ChildProcess = spawn("stripe", ["listen", "--skip-update", "--forward-to", `${env.E2E_API_URL}${path}`, "--events", events.join(",")], {
    env: { PATH: process.env.PATH, HOME: process.env.HOME, STRIPE_API_KEY: process.env.STRIPE_SECRET_KEY! },
    stdio: ["ignore", "ignore", "pipe"],
  });
  let errText = "";
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`stripe listen (${path}) didn't become ready`)), 60_000);
    child.stderr!.on("data", (d: Buffer) => {
      errText += d.toString();
      if (/Ready!/.test(errText)) {
        clearTimeout(t);
        resolve();
      }
    });
    child.once("exit", () => reject(new Error(`stripe listen (${path}) exited: ${errText.replace(/(sk|rk)_(test|live)_[A-Za-z0-9]+|whsec_[A-Za-z0-9]+/g, "[redacted]").slice(0, 200)}`)));
  });
  return { stop: async () => { child.kill("SIGINT"); await sleep(500); } };
}

async function arrived(f: any, where: string, params: unknown[], label: string, tries = 60) {
  for (let i = 0; i < tries; i++) {
    // Wait for the delivery to finish processing (not just arrive).
    const r = await rows(f, `SELECT provider, event_id AS id, event_type AS type, status FROM webhook_events WHERE ${where} AND status NOT IN ('received', 'processing') ORDER BY id`, params);
    if (r.length) return r;
    await sleep(2_000);
  }
  throw new Error(`no real delivery: ${label}`);
}

test("SANDBOX-DELIVERY-G: real Stripe deliveries via the CLI — payment, refund, dispute, transfer/reversal, v2 account, bank payout", async ({ playwright, browser }) => {
  test.skip(!stripeProfile || process.env.QA_STRIPE_WEBHOOK_SOURCE !== "stripe-cli", "needs the Stripe CLI test-mode session");
  test.setTimeout(900_000);
  await withActors(playwright, ["QA_ADMIN", "QA_HOST"], async (f) => {
    const restore = await setSwitch(f, { "commerce.settlement_ledger": true, "commerce.connect_v1": true, "commerce.engine_v2": true, "commerce.engine_v2_experience": true });
    const listeners = [await startListener("/api/stripe/webhook", SNAPSHOT), await startListener("/api/stripe/webhook/v2", THIN)];
    const opened: APIRequestContext[] = [];
    const host = { partyType: "host", partyId: personas.QA_HOST.id };
    const facts: Record<string, unknown> = {};
    try {
      // Payment success — no hand delivery: the booking confirms from Stripe's own event.
      const pay = await paidExperienceBooking(playwright, browser, f, opened, { priceCents: 2000 });
      const paidEv = await arrived(f, "event_type = 'checkout.session.completed' AND object_id = ?", [pay.sessionId], "checkout.session.completed");
      expect(paidEv[0].id).toMatch(/^evt_/);
      expect(paidEv[0].status).toBe("processed");
      for (let i = 0; i < 20; i++) {
        if ((await rows(f, "SELECT payment_status AS ps FROM experience_bookings WHERE ref = ?", [pay.ref]))[0].ps === "paid") break;
        await sleep(1_000);
      }
      expect((await rows(f, "SELECT payment_status AS ps FROM experience_bookings WHERE ref = ?", [pay.ref]))[0].ps).toBe("paid");
      facts.payment = { event: paidEv[0].id, session: pay.sessionId };

      // Refund made through the app → Stripe's charge.refunded arrives → recorded once.
      const refund = await f.actors.QA_ADMIN.post("/api/admin/finance/refunds", { data: { sourceType: "experience", ref: pay.ref, amountMinor: 700, reason: "Stage 5e real delivery" } });
      expect(refund.status()).toBe(200);
      const charge = (await stripe.paymentIntents.retrieve(pay.paymentIntentId, { expand: ["latest_charge"] })).latest_charge as Stripe.Charge;
      const refundEv = await arrived(f, "event_type = 'charge.refunded' AND object_id = ?", [charge.id], "charge.refunded");
      expect(refundEv[0].status).toMatch(/processed|ignored/);
      expect((await rows(f, "SELECT COUNT(*) AS n FROM refunds WHERE source_ref = ?", [pay.ref]))[0].n, "the refund is recorded once").toBe(1);
      facts.refund = { event: refundEv[0].id, charge: charge.id };

      // Dispute: Stripe opens it for the 0259 card; the created event arrives by itself.
      const disputed = await paidExperienceBooking(playwright, browser, f, opened, { priceCents: 2100, card: "4000000000000259" });
      let dispute: Stripe.Dispute | undefined;
      for (let i = 0; i < 40 && !dispute; i++) {
        dispute = (await stripe.disputes.list({ payment_intent: disputed.paymentIntentId, limit: 1 })).data[0];
        if (!dispute) await sleep(2_000);
      }
      const dispEv = await arrived(f, "event_type = 'charge.dispute.created' AND object_id = ?", [dispute!.id], "charge.dispute.created");
      expect(dispEv[0].status).toBe("processed");
      expect((await rows(f, "SELECT COUNT(*) AS n FROM disputes WHERE provider_dispute_id = ?", [dispute!.id]))[0].n).toBe(1);
      facts.dispute = { event: dispEv[0].id, dispute: dispute!.id };

      // Connected account (v2 thin events) + a transfer and an outside reversal + a bank payout.
      const acct = await createVerifiedRecipient("individual", "delivery");
      await attachAccount(f, host, acct, "individual");
      await v2core().accounts.update(acct, { display_name: `QA delivery ${RUN.slice(-6)} updated` });
      const thin = await arrived(f, "provider = 'stripe_v2' AND connected_account = ?", [acct], "v2 account event");
      expect(thin.some((e: any) => e.status === "processed"), "a v2 account event was processed (account re-fetched)").toBe(true);
      expect((await rows(f, "SELECT COUNT(*) AS n FROM connected_account_syncs WHERE account_id = ? AND source = 'webhook'", [acct]))[0].n).toBeGreaterThan(0);
      const tr = await stripe.transfers.create({ amount: 300, currency: "eur", destination: acct, metadata: { hc_qa_run: RUN, purpose: "stage5e-delivery" } }, { idempotencyKey: `qa5e:${RUN}:delivery-transfer` });
      const trEv = await arrived(f, "event_type = 'transfer.created' AND object_id = ?", [tr.id], "transfer.created");
      await stripe.transfers.createReversal(tr.id, { amount: 100, metadata: { hc_qa_run: RUN } }, { idempotencyKey: `qa5e:${RUN}:delivery-reversal` });
      const revEv = await arrived(f, "event_type = 'transfer.reversed' AND object_id = ?", [tr.id], "transfer.reversed");
      expect(revEv[0].status, "a reversal made outside HelloCircle goes to manual review").toBe("manual_review");
      const po = await stripe.payouts.create({ amount: 150, currency: "eur", metadata: { hc_qa_run: RUN } }, { stripeAccount: acct });
      const poEv = await arrived(f, "event_type LIKE 'payout.%' AND object_id = ?", [po.id], "payout.*");
      expect(poEv.some((e: any) => e.status === "processed")).toBe(true);
      expect((await rows(f, "SELECT COUNT(*) AS n FROM connected_payouts WHERE provider_payout_id = ?", [po.id]))[0].n).toBe(1);
      facts.connect = { account: acct, v2Events: thin.map((e: any) => [e.type, e.status]), transfer: tr.id, transferEvent: trEv[0].id, reversalEvent: [revEv[0].id, revEv[0].status], payout: po.id, payoutEvents: poEv.map((e: any) => [e.type, e.status]) };

      // Nothing was processed twice (Stripe retries are duplicates).
      const dup = await rows(f, "SELECT event_id, COUNT(*) AS n FROM webhook_events GROUP BY provider, event_id HAVING COUNT(*) > 1", []);
      expect(dup).toEqual([]);
      await record("delivery-g", { source: "stripe listen (Stripe CLI test-mode session)", ...facts }, "stage5e");
    } finally {
      for (const l of listeners) await l.stop();
      for (const x of opened) await x.dispose();
      await f.connection.execute("DELETE FROM connected_account_syncs WHERE account_id IN (SELECT account_id FROM connected_accounts WHERE party_type = 'host' AND party_id = ?)", [host.partyId]);
      await f.connection.execute("DELETE FROM connected_payouts WHERE account_id IN (SELECT account_id FROM connected_accounts WHERE party_type = 'host' AND party_id = ?)", [host.partyId]);
      await f.connection.execute("DELETE FROM connected_accounts WHERE party_type = 'host' AND party_id = ?", [host.partyId]);
      await f.connection.execute("DELETE FROM connected_account_creations WHERE party_type = 'host' AND party_id = ?", [host.partyId]);
      await restore();
    }
  });
});
