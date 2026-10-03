import type { APIRequestContext, Page } from "@playwright/test";
import { expect, env } from "../fixtures";
import { evidence } from "../authorization-fixture";
import { test, withActors, rows } from "../lifecycle-fixture";
import { bookableExperience, expectedTotal } from "../booking-fixture";
import { deliver, payOnHostedCheckout, sessionFor, stripeProfile, stripeUiActor } from "../stripe-fixture";
import { checkout, guests, localRow, paidResource, sleep } from "../stripe-models";

// Phase 9 §32-§35 — real browser journeys through Stripe-hosted Checkout
// (TEST mode, test card numbers), return pages and delayed webhook delivery.

const reachable = (page: Page, locator: ReturnType<Page["getByRole"]>) =>
  locator.evaluate((el) => { const r = el.getBoundingClientRect(); const t = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!t && (t === el || el.contains(t)); });

for (const viewport of ["desktop", "mobile"] as const) {
  test(`STRIPE-UI-${viewport.toUpperCase()}: paid adventure → quote → hosted test checkout → return (pending until webhook) → confirmed → My Life`, async ({ playwright, browser }) => {
    test.skip(!stripeProfile, "qa:stripe only");
    test.setTimeout(240_000);
    await withActors(playwright, ["QA_VENDOR"], async f => {
      const exp = await bookableExperience(f, { price: 1500, capacity: 6, payment: "online" });
      const ui = await stripeUiActor(browser, null, viewport, { consent: viewport === "desktop" });
      try {
        const { page } = ui;
        await page.goto(`/experiences/${exp.id}`);
        await expect(page.getByRole("heading", { name: exp.title }).first()).toBeVisible();
        await page.waitForTimeout(600);
        const cta = viewport === "mobile"
          ? page.locator(".mobile-join-bar").getByRole("button", { name: "Book this adventure" })
          : page.getByRole("button", { name: "Book this adventure" }).filter({ visible: true }).first();
        if (viewport === "mobile") {
          await expect(page.getByRole("button", { name: "Necessary only", exact: true })).toBeVisible();
          expect(await reachable(page, cta), "HC-QA-001: CTA reachable with consent banner + tab bar").toBe(true);
        }
        await cta.click();
        const dialog = page.getByRole("dialog");
        await page.waitForTimeout(500);
        await dialog.locator('input[autocomplete="name"]').fill(`QA ${viewport} payer`);
        await dialog.locator('input[type="email"]').fill(`qa_pay_${viewport}@example.test`);
        await dialog.getByRole("button", { name: "Increase", exact: true }).click(); // party of 2
        await expect(dialog.getByText(`€${(expectedTotal(3000) / 100).toFixed(2)}`, { exact: true })).toBeVisible();
        await expect(dialog.getByText(/2 × €15\.00 \+ VAT €6\.90 \+ fee €1\.50/)).toBeVisible();
        const submit = dialog.getByRole("button", { name: "Continue to pay" });
        expect(await reachable(page, submit), "pay CTA not obscured").toBe(true);
        await submit.click();
        await page.waitForURL(/checkout\.stripe\.com/, { timeout: 30_000 });
        const [row] = await rows(f, "SELECT ref, total_cents, stripe_session_id, payment_status FROM experience_bookings WHERE session_id = ? ORDER BY created_at DESC LIMIT 1", [exp.session]);
        f.track("audit_log", "object_id", row.ref);
        expect(row.payment_status).toBe("pending");
        expect(row.total_cents).toBe(expectedTotal(3000));
        await payOnHostedCheckout(page);
        await page.waitForURL(u => u.origin === env.E2E_BASE_URL && u.pathname === "/payment/success", { timeout: 60_000 });
        // Delayed webhook: the return page must not claim success on the redirect alone.
        await page.waitForTimeout(3000);
        await expect(page.getByRole("heading", { name: "You're all set!" })).toHaveCount(0);
        await page.reload();
        await page.waitForTimeout(2500);
        await expect(page.getByRole("heading", { name: "You're all set!" }), "refresh before webhook still not confirmed").toHaveCount(0);
        expect((await localRow(f, "experience", row.ref))!.payment_status).toBe("pending");
        const s = await sessionFor(row.stripe_session_id);
        expect(s.amount_total).toBe(row.total_cents);
        expect((await deliver(page.request, "checkout.session.completed", s)).status).toBe(200);
        await page.reload();
        await expect(page.getByRole("heading", { name: "You're all set!" })).toBeVisible({ timeout: 20_000 });
        await expect(page.getByText(new RegExp(`€${(expectedTotal(3000) / 100).toFixed(2)}`)).first()).toBeVisible();
        await page.goto("/bookings");
        await expect(page.getByText(exp.title).first()).toBeVisible();
        if (viewport === "mobile") {
          const tab = page.locator(".mobile-tab-bar, nav[aria-label*='Primary' i]").first();
          if (await tab.count()) expect(await tab.isVisible()).toBe(true);
        }
        await evidence(`stripe-ui-${viewport}`, { shown: `€${(expectedTotal(3000) / 100).toFixed(2)}`, charged: s.amount_total ?? 0, beforeWebhook: "not confirmed", afterWebhook: "confirmed", blockedHosts: ui.blocked.length });
      } finally { await ui.close(); }
    });
  });
}

test("STRIPE-RETURN-URL: manually visiting / refreshing the success URL never marks an unpaid booking paid", async ({ playwright, browser }) => {
  test.skip(!stripeProfile, "qa:stripe only");
  test.setTimeout(90_000);
  await withActors(playwright, ["QA_VENDOR"], async f => {
    const opened: APIRequestContext[] = [];
    try {
      const [g] = await guests(playwright, opened, 1);
      const { listing } = await paidResource(f, "club");
      const { ref } = await (await checkout("club", listing, g.ctx, g.email)).json();
      f.track("audit_log", "object_id", ref);
      const ui = await stripeUiActor(browser, null, "desktop");
      try {
        for (const path of [`/payment/success?ref=${ref}`, `/payment/success?ref=${ref}&session_id=cs_test_forged`, `/payment/cancel?ref=${ref}`, `/payment/success?ref=${ref}`]) {
          await ui.page.goto(path);
          await ui.page.waitForTimeout(2000);
          await expect(ui.page.getByRole("heading", { name: "You're all set!" })).toHaveCount(0);
        }
      } finally { await ui.close(); }
      await sleep(300);
      expect((await localRow(f, "club", ref))!.payment_status, "return URLs are never payment authority").toBe("pending");
      await evidence("stripe-return-url", { visits: 4, local: "pending" });
    } finally { for (const x of opened) await x.dispose(); }
  });
});
