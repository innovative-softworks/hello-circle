import type { APIRequestContext } from "@playwright/test";
import type Stripe from "stripe";
import { expect, personas } from "../fixtures";
import { rows, test, withActors } from "../lifecycle-fixture";
import { deliver, stripe, stripeProfile } from "../stripe-fixture";
import { ageSession, assertSandbox, deliverReal, ledgerBalanced, paidExperienceBooking, realEvents, record, runKey, setSwitch, sleep } from "../stripe-sandbox-fixture";

// Revenue & Connect Stage 5d — E: real TEST-mode disputes (card
// 4000000000000259 → fraudulent dispute), won and lost with Stripe's
// documented evidence values, delivered as the real provider events
// (re-signed locally). Transfer reversal for a lost dispute needs a connected
// account (blocked: Accounts v1) — the partner debt therefore stays fully
// unrecovered and the partner frozen, which is asserted.

const SWITCHES = { "commerce.settlement_ledger": true, "commerce.engine_v2": true, "commerce.engine_v2_experience": true, "commerce.circle_credits": true, "commerce.connect_v1": true };
const reason = "Stage 5d sandbox validation";
const DISPUTE_CARD = "4000000000000259";

async function disputeFor(paymentIntentId: string): Promise<Stripe.Dispute> {
  for (let i = 0; i < 40; i++) {
    const list = await stripe.disputes.list({ payment_intent: paymentIntentId, limit: 1 });
    if (list.data[0]) return list.data[0];
    await sleep(2_000);
  }
  throw new Error("no dispute appeared for the test payment");
}

async function closeDispute(id: string, evidence: "winning_evidence" | "losing_evidence") {
  await stripe.disputes.update(id, { evidence: { uncategorized_text: evidence }, metadata: { hc_qa_run: process.env.HC_QA_STRIPE_RUN! } });
  for (let i = 0; i < 60; i++) {
    const d = await stripe.disputes.retrieve(id);
    if (d.status === "won" || d.status === "lost") return d;
    await sleep(3_000);
  }
  throw new Error("dispute did not close");
}

test("SANDBOX-DISPUTES-E: created → earnings frozen → won; delayed dispute after settlement → lost → points reversed → unrecovered partner debt; duplicates are no-ops", async ({ playwright, browser }) => {
  test.skip(!stripeProfile, "qa:stripe only");
  test.setTimeout(600_000);
  await withActors(playwright, ["QA_ADMIN"], async (f) => {
    const opened: APIRequestContext[] = [];
    const restore = await setSwitch(f, SWITCHES);
    const [{ org_id: orgId }] = await rows(f, "SELECT org_id FROM users WHERE id = ?", [personas.QA_VENDOR.id]);
    try {
      const since = Math.floor(Date.now() / 1000);
      // 1) Dispute opened promptly → the order is not released; won → released.
      const w = await paidExperienceBooking(playwright, browser, f, opened, { priceCents: 3500, card: DISPUTE_CARD });
      await deliver(w.guest.ctx, "checkout.session.completed", w.session);
      const dw = await disputeFor(w.paymentIntentId);
      assertSandbox(dw as any, "dispute");
      const [created] = await realEvents(dw.id, ["charge.dispute.created"], since);
      expect(created, "Stripe emitted charge.dispute.created").toBeTruthy();
      expect((await deliverReal(w.guest.ctx, created)).status).toBe(200);
      const dup = await deliverReal(w.guest.ctx, created);
      expect([dup.status, dup.body.duplicate]).toEqual([200, true]);
      expect((await rows(f, "SELECT COUNT(*) AS n FROM disputes WHERE provider_dispute_id = ?", [dw.id]))[0].n).toBe(1);
      await ageSession(f, w.exp.session);
      const frozen = await f.actors.QA_ADMIN.post("/api/admin/finance/settlements/run", { data: { runKey: runKey("dw"), dryRun: true, reason } });
      expect((await frozen.json()).released.map((r: any) => r.ref), "open dispute: earnings frozen").not.toContain(w.ref);
      const wonDispute = await closeDispute(dw.id, "winning_evidence");
      expect(wonDispute.status).toBe("won");
      const closedW = (await realEvents(dw.id, ["charge.dispute.closed"], since))[0];
      expect((await deliverReal(w.guest.ctx, closedW)).status).toBe(200);
      expect((await rows(f, "SELECT status FROM disputes WHERE provider_dispute_id = ?", [dw.id]))[0].status).toBe("won");
      const after = await f.actors.QA_ADMIN.post("/api/admin/finance/settlements/run", { data: { runKey: runKey("dw2"), dryRun: true, reason } });
      expect((await after.json()).released.map((r: any) => r.ref), "won dispute: released").toContain(w.ref);
      // Out of order: a late "created" after "closed" can't reopen it.
      await deliverReal(w.guest.ctx, (await realEvents(dw.id, ["charge.dispute.created"], since))[0]);
      expect((await rows(f, "SELECT status FROM disputes WHERE provider_dispute_id = ?", [dw.id]))[0].status).toBe("won");

      // 2) A dispute whose event arrives only after the order was settled (delayed) → lost.
      const l = await paidExperienceBooking(playwright, browser, f, opened, { priceCents: 4500, card: DISPUTE_CARD });
      await deliver(l.guest.ctx, "checkout.session.completed", l.session);
      await ageSession(f, l.exp.session);
      const settled = await (await f.actors.QA_ADMIN.post("/api/admin/finance/settlements/run", { data: { runKey: runKey("dl"), dryRun: false, reason } })).json();
      const [award] = await rows(f, "SELECT points FROM reward_awards WHERE source_ref = ?", [l.ref]);
      expect(Number(award.points), "points awarded at settlement").toBeGreaterThan(0);
      const dl = await disputeFor(l.paymentIntentId);
      const createdL = (await realEvents(dl.id, ["charge.dispute.created"], since))[0];
      expect((await deliverReal(l.guest.ctx, createdL)).status, "delayed event accepted").toBe(200);
      const lost = await closeDispute(dl.id, "losing_evidence");
      expect(lost.status).toBe("lost");
      const closedL = (await realEvents(dl.id, ["charge.dispute.closed"], since))[0];
      expect((await deliverReal(l.guest.ctx, closedL)).status).toBe(200);
      expect((await deliverReal(l.guest.ctx, closedL)).body.duplicate, "duplicate dispute webhook").toBe(true);
      const [disp] = await rows(f, "SELECT id, status, recovery_status AS rs, amount_minor AS a FROM disputes WHERE provider_dispute_id = ?", [dl.id]);
      expect([disp.status, disp.rs, Number(disp.a)]).toEqual(["lost", "pending", lost.amount]);
      const [aw2] = await rows(f, "SELECT points, reversed_points AS r FROM reward_awards WHERE source_ref = ?", [l.ref]);
      expect(Number(aw2.r), "all points reversed (full chargeback)").toBe(Number(aw2.points));
      // Partner responsible → recovered from their available balance → negative → partner debt.
      const dec = await f.actors.QA_ADMIN.post(`/api/admin/finance/disputes/${disp.id}/recovery`, { data: { responsible: "partner", reason } });
      expect(dec.status()).toBe(200);
      const debt = await f.actors.QA_ADMIN.post(`/api/admin/finance/partners/org/${orgId}/debts`, { data: { reason: "Chargeback lost: activity not delivered (sandbox)" } });
      const debtBody = await debt.json();
      expect(debt.status()).toBe(200);
      expect(debtBody.status, "no transfers to reverse (no connected account) → stays open").toBe("open");
      expect(debtBody.recoveredMinor).toBe(0);
      expect(debtBody.unrecoveredMinor).toBeGreaterThan(0);
      const frozenRun = await (await f.actors.QA_ADMIN.post("/api/admin/finance/settlements/run", { data: { runKey: runKey("dl2"), dryRun: true, reason } })).json();
      expect(frozenRun.carried.find((c: any) => c.partyId === orgId)?.frozenByDebtId, "frozen partner excluded from settlement").toBe(debtBody.debtId);
      await ledgerBalanced(f);
      await record("disputes-e", {
        won: { disputeId: dw.id, paymentIntentId: w.paymentIntentId, amount: wonDispute.amount, events: [created.id, closedW.id] },
        lost: { disputeId: dl.id, paymentIntentId: l.paymentIntentId, expectedAmount: l.session.amount_total, actualAmount: lost.amount, events: [createdL.id, closedL.id], pointsReversed: Number(aw2.r), debt: { id: debtBody.debtId, recovered: 0, unrecovered: debtBody.unrecoveredMinor } },
        settlementForDelayed: settled.settled?.find((s: any) => s.partyId === orgId)?.settlementId ?? null,
      });
    } finally {
      for (const x of opened) await x.dispose();
      await f.connection.execute("DELETE FROM partner_debts WHERE party_type = 'org' AND party_id = ?", [orgId]);
      await restore();
    }
  });
});
