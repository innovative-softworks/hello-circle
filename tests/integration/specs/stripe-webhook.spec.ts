import type { APIRequestContext } from "@playwright/test";
import { expect } from "../fixtures";
import { evidence } from "../authorization-fixture";
import { test, withActors, rows } from "../lifecycle-fixture";
import { deliver, sessionFor, stripeProfile } from "../stripe-fixture";
import { checkout, guests, localRow, paidResource, sleep } from "../stripe-models";

// Phase 9 §7/§29 — signature enforcement and safe handling of signed events
// that do not (or must not) change anything. Real TEST-mode Checkout Session
// objects; events signed with the per-run local secret, verified by the app.

const snapshot = async (f: any, ref: string) => JSON.stringify({
  row: await rows(f, "SELECT status, payment_status FROM registrations WHERE ref = ?", [ref]),
  notes: (await rows(f, "SELECT id FROM notifications WHERE ref = ?", [ref])).length,
  coupons: await rows(f, "SELECT used_count FROM coupons WHERE code LIKE 'QA%' ORDER BY code"),
});

test("STRIPE-WEBHOOK-SIGNATURE: invalid and tampered signatures are rejected with no mutation", async ({ playwright }) => {
  test.skip(!stripeProfile, "qa:stripe only");
  test.setTimeout(90_000);
  await withActors(playwright, ["QA_VENDOR"], async f => {
    const opened: APIRequestContext[] = [];
    try {
      const [a] = await guests(playwright, opened, 1);
      const { listing } = await paidResource(f, "club");
      const res = await checkout("club", listing, a.ctx, a.email);
      expect(res.status()).toBe(201);
      const { ref } = await res.json();
      const row = await localRow(f, "club", ref);
      f.track("audit_log", "object_id", ref);
      const real = await sessionFor(row!.stripe_session_id);
      const forged = { ...real, payment_status: "paid", status: "complete" }; // what an attacker would claim
      const before = await snapshot(f, ref);
      const invalid = await deliver(a.ctx, "checkout.session.completed", forged, "invalid");
      const tampered = await deliver(a.ctx, "checkout.session.completed", forged, "tampered");
      expect([invalid.status, tampered.status]).toEqual([400, 400]);
      await sleep(500);
      expect(await snapshot(f, ref), "rejected events: no booking/payment/capacity/notification change").toBe(before);
      // A validly signed `completed` for a session that is NOT paid (async method) must not confirm.
      const unpaid = await deliver(a.ctx, "checkout.session.completed", real, "valid");
      expect(unpaid.status).toBe(200);
      await sleep(500);
      expect((await localRow(f, "club", ref))!.payment_status, "completed-but-unpaid does not confirm").toBe("pending");
      await evidence("stripe-webhook-signature", { invalid: invalid.status, tampered: tampered.status, completedUnpaid: "pending" });
    } finally { for (const x of opened) await x.dispose(); }
  });
});

test("STRIPE-WEBHOOK-UNKNOWN: signed events for unknown refs / unhandled types change nothing and do not crash", async ({ playwright }) => {
  test.skip(!stripeProfile, "qa:stripe only");
  await withActors(playwright, ["QA_VENDOR"], async f => {
    const actor = f.actors.QA_VENDOR;
    const counts = async () => JSON.stringify(await rows(f, `SELECT (SELECT COUNT(*) FROM bookings) b, (SELECT COUNT(*) FROM registrations) r, (SELECT COUNT(*) FROM program_enrollments) p, (SELECT COUNT(*) FROM experience_bookings) e, (SELECT COUNT(*) FROM game_participants) g, (SELECT COUNT(*) FROM notifications) n, (SELECT COALESCE(SUM(used_count),0) FROM coupons) c`));
    const before = await counts();
    const ghost = (type: string, ref: string) => ({ id: `cs_test_qa_ghost_${ref}`, object: "checkout.session", livemode: false, payment_status: "paid", status: "complete", metadata: { type, ref }, amount_total: 100, currency: "eur" });
    const results = [];
    for (const type of ["booking", "registration", "program", "experience", "game", "pass"]) results.push((await deliver(actor, "checkout.session.completed", ghost(type, `QA-NOPE-${type}`))).status);
    results.push((await deliver(actor, "checkout.session.expired", ghost("booking", "QA-NOPE-x"))).status);
    results.push((await deliver(actor, "checkout.session.completed", { ...ghost("nonsense", "x"), metadata: { type: "nonsense", ref: "x" } })).status);
    results.push((await deliver(actor, "checkout.session.completed", { ...ghost("booking", "x"), metadata: {} })).status);
    results.push((await deliver(actor, "payment_intent.succeeded", { id: "pi_qa_unknown", object: "payment_intent" })).status);
    results.push((await deliver(actor, "charge.refunded", { id: "ch_qa_unknown", object: "charge" })).status);
    expect(results.every(s => s === 200), `statuses ${results}`).toBe(true);
    await sleep(500);
    expect(await counts(), "no mutation").toBe(before);
    expect((await actor.get("/api/__qa/identity")).status(), "server alive").toBe(200);
    await evidence("stripe-webhook-unknown", { statuses: results.join(","), mutation: false });
  });
});
