import type { APIRequestContext, Browser } from "@playwright/test";
import { expect, env, personas } from "../fixtures";
import { evidence } from "../authorization-fixture";
import { test, withActors, rows } from "../lifecycle-fixture";
import { deliver, payOnHostedCheckout, sessionFor, stripe, stripeProfile, stripeUiActor } from "../stripe-fixture";
import { MODELS, checkout, guests, localRow, paidResource, sleep, type Model } from "../stripe-models";

// HC-QA-091 (Phase 11A) — Policy A: refunds originate in HelloCircle, but a
// payment already fully refunded at Stripe (Dashboard/manual) must reconcile
// instead of failing forever: no second provider refund, one transition, one
// audit, one notification set, repeat/concurrent attempts are no-ops. A partial
// external refund is not supported → fail safely with operational evidence.

async function payAndConfirm(browser: Browser, actor: APIRequestContext, url: string, sessionId: string) {
  const ui = await stripeUiActor(browser, null, "desktop");
  try { await ui.page.goto(url); await payOnHostedCheckout(ui.page); await ui.page.waitForURL(u => u.origin === env.E2E_BASE_URL, { timeout: 60_000 }); } finally { await ui.close(); }
  let s = await sessionFor(sessionId);
  for (let i = 0; i < 20 && s.payment_status !== "paid"; i++) { await sleep(500); s = await sessionFor(sessionId); }
  expect((await deliver(actor, "checkout.session.completed", s)).status).toBe(200);
  await sleep(800);
  return s;
}
const paymentIntentOf = (s: { payment_intent: unknown }) => String(typeof s.payment_intent === "string" ? s.payment_intent : (s.payment_intent as any).id);
const refundsFor = async (s: { payment_intent: unknown }) => (await stripe.refunds.list({ payment_intent: paymentIntentOf(s), limit: 10 })).data;

const AUDIT_PREFIX: Record<Model, string> = { hall: "booking", club: "registration", programme: "program_enrollment", experience: "experience_booking", activity: "game_participant" };

function refundCall(f: any, model: Model, listing: any, row: Record<string, any>) {
  if (model === "hall") return () => f.actors.QA_VENDOR.post(`/api/vendor/bookings/${row.ref}/refund`, { data: {} });
  if (model === "club") return () => f.actors.QA_VENDOR.post(`/api/vendor/registrations/${row.ref}/refund`, { data: {} });
  if (model === "programme") return () => f.actors.QA_VENDOR.post(`/api/vendor/programs/${listing.id}/enrollments/${row.id}/refund`, { data: {} });
  if (model === "experience") return () => f.actors.QA_VENDOR.post(`/api/vendor/experiences/${listing.id}/bookings/${row.id}/refund`, { data: {} });
  return () => f.actors.QA_HOST.post(`/api/games/${listing.id}/participants/${personas.QA_USER.id}/refund`, { data: {} });
}
const auditObject = (model: Model, listing: any, ref: string) => model === "activity" ? `${listing.id}:${personas.QA_USER.id}` : ref;
const notificationCount = async (f: any, model: Model, listing: any, ref: string) => model === "activity"
  ? (await rows(f, "SELECT id FROM notifications WHERE resident_id = ? AND listing_id = ? AND title LIKE 'Refunded:%'", [personas.QA_USER.id, listing.id])).length
  : (await rows(f, "SELECT id FROM notifications WHERE ref = ? AND title LIKE 'Refund issued:%'", [ref])).length;

async function paidRow(f: any, browser: Browser, playwright: any, opened: APIRequestContext[], model: Model) {
  const [g] = await guests(playwright, opened, 1);
  const actor = model === "activity" ? f.actors.QA_USER : g.ctx;
  const { listing } = await paidResource(f, model);
  const res = await checkout(model, listing, actor, g.email);
  expect(res.status()).toBe(201);
  const { ref, url } = await res.json();
  f.track("audit_log", "object_id", ref);
  if (model === "activity") f.track("audit_log", "object_id", `${(listing as any).id}:${personas.QA_USER.id}`);
  const s = await payAndConfirm(browser, actor, url, (await localRow(f, model, ref))!.stripe_session_id);
  const row = (await localRow(f, model, ref))!;
  expect(row.payment_status).toBe("paid");
  return { listing, ref, s, row };
}

for (const model of MODELS) {
  test(`HC-QA-091-${model.toUpperCase()}: payment already fully refunded at Stripe → HelloCircle refund reconciles once (no second refund, concurrent + repeat are no-ops)`, async ({ playwright, browser }) => {
    test.skip(!stripeProfile, "qa:stripe only");
    test.setTimeout(300_000);
    await withActors(playwright, model === "activity" ? ["QA_HOST", "QA_USER"] : ["QA_VENDOR"], async f => {
      const opened: APIRequestContext[] = [];
      try {
        const { listing, ref, s, row } = await paidRow(f, browser, playwright, opened, model);
        const statusBefore = row.status;
        const notesBefore = await notificationCount(f, model, listing, ref);
        // Accidental refund outside HelloCircle (what a Stripe Dashboard refund produces).
        const external = await stripe.refunds.create({ payment_intent: paymentIntentOf(s) });
        expect(["succeeded", "pending"]).toContain(external.status);
        // Three simultaneous HelloCircle refund attempts.
        const call = refundCall(f, model, listing, row);
        const results = await Promise.all([1, 2, 3].map(() => call()));
        const statuses = results.map(r => r.status()).sort();
        await sleep(1500);
        const replay = await call();
        const after = (await localRow(f, model, ref))!;
        const refunds = await refundsFor(s);
        const obj = auditObject(model, listing, ref);
        const reconciled = (await rows(f, "SELECT id FROM audit_log WHERE action = ? AND object_id = ?", [`${AUDIT_PREFIX[model]}.refund_reconciled_external`, obj])).length;
        const normal = (await rows(f, "SELECT id FROM audit_log WHERE action LIKE ? AND object_id = ?", [`${AUDIT_PREFIX[model]}.refunded_by_%`, obj])).length;
        const notesAdded = (await notificationCount(f, model, listing, ref)) - notesBefore;
        await evidence(`hc-qa-091-${model}`, { statuses: statuses.join(","), replay: replay.status(), providerRefunds: refunds.length, payment: after.payment_status, status: `${statusBefore}->${after.status}`, reconciledAudits: reconciled, normalAudits: normal, notificationsAdded: notesAdded });
        expect(statuses, "one reconciliation, the rest refused cleanly (no 5xx, no 'try again')").toEqual([200, 409, 409]);
        expect(replay.status(), "repeat reconciliation is a no-op").toBe(409);
        expect(refunds.length, "never a second provider refund").toBe(1);
        expect(refunds[0].id).toBe(external.id);
        expect(after.payment_status).toBe("refunded");
        expect(after.status, "status follows the existing refund rule (refund alone does not cancel/release)").toBe(statusBefore);
        expect(reconciled, "one reconciliation audit").toBe(1);
        expect(normal, "not recorded as a HelloCircle-issued refund").toBe(0);
        expect(notesAdded, "one notification set, not repeated").toBeGreaterThanOrEqual(1);
        const notesAfterReplay = (await notificationCount(f, model, listing, ref)) - notesBefore;
        expect(notesAfterReplay, "replay adds no notification").toBe(notesAdded);
      } finally { for (const x of opened) await x.dispose(); }
    });
  });
}

test("HC-QA-091-PARTIAL: a partial refund made outside HelloCircle is not guessed at — refused safely, state unchanged, operational evidence recorded", async ({ playwright, browser }) => {
  test.skip(!stripeProfile, "qa:stripe only");
  test.setTimeout(300_000);
  await withActors(playwright, ["QA_VENDOR"], async f => {
    const opened: APIRequestContext[] = [];
    try {
      const { listing, ref, s, row } = await paidRow(f, browser, playwright, opened, "hall");
      await stripe.refunds.create({ payment_intent: paymentIntentOf(s), amount: 100 });
      const res = await refundCall(f, "hall", listing, row)();
      const body = await res.json().catch(() => ({}));
      const after = (await localRow(f, "hall", ref))!;
      const refunds = await refundsFor(s);
      const ops = (await rows(f, "SELECT id FROM audit_log WHERE action = 'payment.refund_reconciliation_blocked' AND object_id = ?", [ref])).length;
      await evidence("hc-qa-091-partial", { status: res.status(), payment: after.payment_status, providerRefunds: refunds.length, operationalAudits: ops });
      expect(res.status(), "safe refusal, not a retryable 502").toBe(409);
      expect(String(body.error ?? "")).not.toMatch(/try again/i);
      expect(after.payment_status, "no guess: stays paid").toBe("paid");
      expect(refunds.length, "no additional provider refund").toBe(1);
      expect(refunds[0].amount).toBe(100);
      expect(ops, "operational evidence recorded").toBe(1);
    } finally { for (const x of opened) await x.dispose(); }
  });
});
