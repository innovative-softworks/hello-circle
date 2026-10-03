import type { APIRequestContext, Browser } from "@playwright/test";
import { expect, env } from "../fixtures";
import { evidence } from "../authorization-fixture";
import { test, withActors, rows } from "../lifecycle-fixture";
import { deliver, payOnHostedCheckout, sessionFor, stripe, stripeProfile, stripeUiActor } from "../stripe-fixture";
import { checkout, guests, localRow, paidResource, sleep } from "../stripe-models";

// Phase 11B — resident self-cancel of a REAL paid booking (Stripe TEST mode)
// follows Refund Policy A: cancellation reports "refund pending" (no refund
// is invented or claimed), the provider refunds through the existing
// HelloCircle workflow, and My Life then reports "refunded". One provider refund.

async function payAndConfirm(browser: Browser, actor: APIRequestContext, url: string, sessionId: string) {
  const ui = await stripeUiActor(browser, null, "desktop");
  try { await ui.page.goto(url); await payOnHostedCheckout(ui.page); await ui.page.waitForURL(u => u.origin === env.E2E_BASE_URL, { timeout: 60_000 }); } finally { await ui.close(); }
  let s = await sessionFor(sessionId);
  for (let i = 0; i < 20 && s.payment_status !== "paid"; i++) { await sleep(500); s = await sessionFor(sessionId); }
  expect((await deliver(actor, "checkout.session.completed", s)).status).toBe(200);
  await sleep(800);
  return s;
}

for (const model of ["experience", "programme"] as const) {
  test(`HC-GAP-STRIPE-${model.toUpperCase()}: paid self-cancel → refund pending → HelloCircle refund → refunded (one provider refund)`, async ({ playwright, browser }) => {
    test.skip(!stripeProfile, "qa:stripe only");
    test.setTimeout(240_000);
    await withActors(playwright, ["QA_VENDOR"], async (f) => {
      const opened: APIRequestContext[] = [];
      try {
        const [g] = await guests(playwright, opened, 1);
        const { listing } = await paidResource(f, model);
        const { ref, url } = await (await checkout(model, listing, g.ctx, g.email)).json();
        f.track("audit_log", "object_id", ref);
        const s = await payAndConfirm(browser, g.ctx, url, (await localRow(f, model, ref))!.stripe_session_id);
        const minePath = model === "experience" ? "/api/experiences/bookings/mine" : "/api/programs/enrollments/mine";
        const cancelPath = model === "experience" ? `/api/experiences/bookings/${ref}/cancel` : `/api/programs/enrollments/${ref}/cancel`;
        const mine = async () => ((await (await g.ctx.get(minePath)).json()) as any[]).find((r) => r.ref === ref);
        expect(await mine()).toMatchObject({ canCancel: true, paidOnline: true, refundState: "none" });

        const cancel = await g.ctx.post(cancelPath, { data: {} });
        expect(cancel.status()).toBe(200);
        expect((await cancel.json()).refundState, "honest: pending, not refunded").toBe("pending");
        const pi = String(typeof s.payment_intent === "string" ? s.payment_intent : (s.payment_intent as any).id);
        expect((await stripe.refunds.list({ payment_intent: pi })).data.length, "cancel alone moves no money").toBe(0);
        expect(await mine()).toMatchObject({ status: "cancelled", refundState: "pending" });

        const row = (await localRow(f, model, ref))!;
        const listingId = (listing as { id: string }).id;
        const refundUrl = model === "experience" ? `/api/vendor/experiences/${listingId}/bookings/${row.id}/refund` : `/api/vendor/programs/${listingId}/enrollments/${row.id}/refund`;
        expect((await f.actors.QA_VENDOR.post(refundUrl, { data: {} })).status()).toBe(200);
        const refunds = (await stripe.refunds.list({ payment_intent: pi })).data;
        expect(refunds.length, "exactly one provider refund").toBe(1);
        expect(await mine(), "My Life shows refunded only now").toMatchObject({ status: "cancelled", refundState: "refunded", canCancel: false });
        const audits = (await rows(f, "SELECT action FROM audit_log WHERE object_id = ?", [ref])).map((r: any) => r.action);
        await evidence(`hc-gap-stripe-${model}`, { cancel: 200, refundStateAfterCancel: "pending", providerRefunds: refunds.length, audits: audits.join(",") });
      } finally { for (const x of opened) await x.dispose(); }
    });
  });
}
