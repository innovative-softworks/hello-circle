import type { APIRequestContext } from "@playwright/test";
import { expect, env, personas } from "../fixtures";
import { evidence } from "../authorization-fixture";
import { test, withActors, rows } from "../lifecycle-fixture";
import { synthCoupon } from "../booking-fixture";
import { deliver, payOnHostedCheckout, sessionFor, stripeProfile, stripeUiActor } from "../stripe-fixture";
import { checkout, guests, localRow, paidResource, sleep } from "../stripe-models";

// Phase 9 preserved payment findings (HC-QA-048+). Each was red before its fix.

test("HC-QA-048: a webhook without a Stripe-Signature header is rejected even outside production", async ({ playwright }) => {
  test.skip(!stripeProfile, "qa:stripe only");
  test.setTimeout(90_000);
  await withActors(playwright, ["QA_VENDOR"], async f => {
    const opened: APIRequestContext[] = [];
    try {
      const [a] = await guests(playwright, opened, 1);
      const { listing } = await paidResource(f, "club");
      const { ref } = await (await checkout("club", listing, a.ctx, a.email)).json();
      f.track("audit_log", "object_id", ref);
      const real = await sessionFor((await localRow(f, "club", ref))!.stripe_session_id);
      const forged = await deliver(a.ctx, "checkout.session.completed", { ...real, payment_status: "paid", status: "complete" }, "missing");
      await sleep(500);
      const after = (await localRow(f, "club", ref))!.payment_status;
      await evidence("hc-qa-048", { status: forged.status, paymentStatusAfter: after });
      expect(after, "unsigned forged success must not mark a booking paid").toBe("pending");
      expect(forged.status).toBe(400);
    } finally { for (const x of opened) await x.dispose(); }
  });
});

test("HC-QA-049: a paid activity's payer confirmation states the amount actually charged", async ({ playwright, browser }) => {
  test.skip(!stripeProfile, "qa:stripe only");
  test.setTimeout(240_000);
  await withActors(playwright, ["QA_HOST", "QA_USER"], async f => {
    const { listing } = await paidResource(f, "activity");
    const coupon = await synthCoupon(f, { kind: "percent", amount: 10, maxUses: 1 });
    const res = await checkout("activity", listing, f.actors.QA_USER, "", { couponCode: coupon });
    expect(res.status()).toBe(201);
    const { ref, url } = await res.json();
    f.track("audit_log", "object_id", ref);
    const ui = await stripeUiActor(browser, null, "desktop");
    try { await ui.page.goto(url); await payOnHostedCheckout(ui.page); await ui.page.waitForURL(u => u.origin === env.E2E_BASE_URL, { timeout: 60_000 }); } finally { await ui.close(); }
    const sid = (await localRow(f, "activity", ref))!.stripe_session_id;
    let s = await sessionFor(sid);
    for (let i = 0; i < 20 && s.payment_status !== "paid"; i++) { await sleep(500); s = await sessionFor(sid); }
    expect((await deliver(f.actors.QA_USER, "checkout.session.completed", s)).status).toBe(200);
    await sleep(1500);
    const [note] = await rows(f, "SELECT body FROM notifications WHERE resident_id = ? AND listing_id = ? AND title LIKE 'You''re in%' ORDER BY created_at DESC LIMIT 1", [personas.QA_USER.id, (listing as any).id]);
    const charged = `€${((s.amount_total ?? 0) / 100).toFixed(2)}`;
    await evidence("hc-qa-049", { charged, notification: String(note?.body ?? "").replace(/^.*· /, "") });
    expect(note?.body, "payer confirmation states the charged amount").toContain(`${charged} paid`);
  });
});
