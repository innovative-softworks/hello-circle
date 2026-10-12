import { env, expect, personas } from "../fixtures";
import { rows, test, withActors } from "../lifecycle-fixture";
import { businessUiActor } from "../product-fixture";
import { fitsViewport, setSwitches, shot } from "../revenue-fixture";

// Revenue & Connect Stage 5f — the partner Pro flow at desktop and mobile
// (fake provider): Free on the dashboard → Explore Pro → review exact price
// and tax → terms → Continue to Stripe (one checkout even on a double click)
// → back to "Confirming your payment" → webhook → Pro active → cancel →
// cancelling → Keep Pro → failed renewal → "Payment needs attention" →
// billing portal. Keyboard and screen-reader basics checked on the way.

for (const viewport of ["desktop", "mobile"] as const) {
  test(`REV-5F-PRO-${viewport}: Free → Explore Pro → checkout → confirming → active → cancel/keep → payment failed`, async ({ playwright, browser }) => {
    test.setTimeout(180_000);
    await withActors(playwright, [], async (f) => {
      const [{ org_id: orgId }] = await rows(f, "SELECT org_id FROM users WHERE id = ?", [personas.QA_VENDOR.id]);
      const restore = await setSwitches(f.connection, { "commerce.pro_subscriptions": true, "commerce.settlement_ledger": true, "commerce.circle_credits": true });
      const clean = async () => {
        await f.connection.execute("DELETE FROM partner_subscriptions WHERE party_type = 'org' AND party_id = ?", [orgId]);
        await f.connection.execute("DELETE FROM partner_plan_assignments WHERE partner_kind = 'org' AND partner_id = ? AND source = 'subscription'", [orgId]);
      };
      await clean();
      const ui = await businessUiActor(browser, "QA_VENDOR", viewport);
      try {
        const { page } = ui;
        page.setDefaultTimeout(15_000);
        // Dashboard (overview): Free state, dynamic price, no direct Stripe button.
        await page.goto("/vendor");
        const panel = page.getByTestId("plan-rewards").first();
        await expect(panel).toHaveAttribute("data-state", "free");
        await expect(panel.getByRole("heading", { name: "Your plan: Free" })).toBeVisible();
        await expect(panel.getByText(/Pro is €29\.00\/month \+ VAT 23% €6\.67 = €35\.67/)).toBeVisible();
        await expect(panel.getByRole("progressbar", { name: "Progress toward a free Pro month" })).toBeVisible();
        await shot(page, `free-dashboard-${viewport}`);
        await fitsViewport(page);
        // Keyboard: focus "Explore Pro" and press Enter.
        const explore = panel.getByRole("link", { name: "Explore Pro" });
        await explore.focus();
        await page.keyboard.press("Enter");
        await page.waitForURL(/\/vendor\/pro$/);
        // Pro details: comparison, exact price and tax, test-card hint (test mode only), terms gate.
        await expect(page.getByRole("heading", { name: "HelloCircle Pro" })).toBeVisible();
        await expect(page.getByTestId("plan-compare")).toBeVisible();
        // R3B F1 — only the monthly price is compared; no per-booking fee promise.
        await expect(page.getByTestId("fee-model-pending")).toBeVisible();
        await expect(page.getByTestId("plan-compare")).not.toContainText(/Success fee|Minimum fee/);
        const price = page.getByTestId("pro-price").first();
        for (const t of ["Pro subscription", "€29.00", "VAT 23%", "€6.67", "Total due today", "€35.67"]) await expect(price.getByText(t, { exact: true })).toBeVisible();
        await expect(page.getByTestId("test-card-hint")).toBeVisible();
        const go = page.getByRole("button", { name: "Continue to Stripe" });
        await expect(go).toBeDisabled();
        await page.getByLabel(/I agree to the HelloCircle Pro terms/).check();
        await shot(page, `pro-details-${viewport}`);
        await fitsViewport(page);
        const stripe = page.waitForRequest((r) => r.url().startsWith("https://checkout.stub.invalid/pro/"));
        await go.dblclick(); // a double click still makes one checkout
        await stripe;
        const subs = await rows(f, "SELECT checkout_session_id AS sid, status, terms_accepted_at AS t FROM partner_subscriptions WHERE party_type = 'org' AND party_id = ? AND status = 'checkout'", [orgId]);
        expect(subs.length, "one checkout").toBe(1);
        expect(subs[0].t, "terms acknowledgement recorded").toBeTruthy();
        // Back from Stripe before the webhook: "Confirming your payment".
        const page2 = await ui.context.newPage();
        expect((await page2.request.post("/api/__qa/plan", { data: { action: "complete", sessionId: subs[0].sid } })).status()).toBe(200);
        await page2.goto("/vendor?pro=success");
        const panel2 = page2.getByTestId("plan-rewards").first();
        await expect(panel2).toHaveAttribute("data-state", "processing");
        await expect(panel2.getByRole("status").filter({ hasText: /usually takes a few seconds/ })).toBeVisible();
        await shot(page2, `processing-${viewport}`);
        // The webhook arrives; the panel refreshes itself.
        expect((await page2.request.post("/api/__qa/plan", { data: { action: "confirm", sessionId: subs[0].sid } })).status()).toBe(200);
        await expect(panel2).toHaveAttribute("data-state", "paid_active", { timeout: 20_000 });
        await expect(panel2.getByText("Paid subscription")).toBeVisible();
        await shot(page2, `paid-active-${viewport}`);
        // Cancel → cancelling → Keep Pro.
        await page2.goto("/vendor/pro");
        await page2.getByRole("button", { name: "Cancel Pro" }).click();
        await page2.getByRole("alertdialog").getByRole("button", { name: "Cancel Pro" }).click();
        await page2.goto("/vendor");
        const panel3 = page2.getByTestId("plan-rewards").first();
        await expect(panel3).toHaveAttribute("data-state", "cancelling");
        await expect(panel3.getByRole("heading", { name: /^Pro ends on / })).toBeVisible();
        await shot(page2, `cancelling-${viewport}`);
        await panel3.getByRole("button", { name: "Keep Pro" }).click();
        await expect(panel3).toHaveAttribute("data-state", "paid_active");
        // Failed renewal → grace → update payment method (Stripe's billing portal).
        const [live] = await rows(f, "SELECT provider_subscription_id AS id FROM partner_subscriptions WHERE party_type = 'org' AND party_id = ? AND status = 'active'", [orgId]);
        expect((await page2.request.post("/api/__qa/plan", { data: { action: "past_due", subscriptionId: live.id } })).status()).toBe(200);
        await page2.reload();
        const panel4 = page2.getByTestId("plan-rewards").first();
        await expect(panel4).toHaveAttribute("data-state", "payment_failed");
        await expect(panel4.getByText(/You keep Pro until .* \(7 days left\)/)).toBeVisible();
        await shot(page2, `payment-failed-${viewport}`);
        await fitsViewport(page2);
        const portal = page2.waitForRequest((r) => r.url().startsWith("https://billing.stub.invalid/portal/"));
        await panel4.getByRole("button", { name: "Update payment method" }).click();
        await portal;
        await page2.close();
      } finally {
        await ui.close();
        await clean();
        await restore();
      }
    });
  });
}

// Admin: invalid switch combinations are refused (with the prerequisite named),
// commercial rules are sectioned, and Finance shows reward points, coupon usage,
// bank payouts and a credit grant carrying currency, funding owner and expiry.
for (const viewport of ["desktop", "mobile"] as const) {
  test(`REV-5F-ADMIN-${viewport}: switch dependency refused; finance rewards, coupons, payouts, credit grant`, async ({ playwright, browser }) => {
    test.setTimeout(120_000);
    await withActors(playwright, [], async (f) => {
      const restore = await setSwitches(f.connection, { "commerce.settlement_ledger": false, "commerce.circle_credits": false, "commerce.customer_credits": true });
      const ui = await businessUiActor(browser, "QA_ADMIN", viewport);
      const note = `QA 5f grant ${viewport} ${Date.now()}`;
      try {
        const { page } = ui;
        page.setDefaultTimeout(15_000);
        await page.goto("/admin?tab=commerce");
        const sections = page.getByRole("navigation", { name: "Commercial rules sections" });
        for (const name of ["Feature switches", "Pro pricing", "Reward points", "Customer credit", "Coupons", "VAT and tax"]) await expect(sections.getByRole("link", { name })).toBeVisible();
        await expect(page.getByTestId("switch-needs-commerce.circle_credits")).toContainText("Needs:");
        await page.getByRole("checkbox", { name: "Partner reward points" }).click(); // controlled: changes only after the reason is confirmed
        const dialog = page.getByRole("dialog");
        await dialog.getByLabel(/Reason/).fill("QA 5f dependency check");
        await dialog.getByRole("button", { name: "Confirm", exact: true }).click();
        await expect(dialog.getByText(/Turn on .* first/)).toBeVisible();
        await shot(page, `admin-switch-refused-${viewport}`);
        expect(await rows(f, "SELECT value FROM app_settings WHERE `key` = 'commerce.circle_credits'", [])).toEqual([{ value: "false" }]);
        await dialog.getByRole("button", { name: "Cancel" }).click();
        await page.goto("/admin?tab=finance");
        for (const tab of ["Reward points", "Coupons", "Bank payouts"]) {
          await page.getByRole("tab", { name: tab }).click();
          await expect(page.getByRole("heading", { name: tab === "Reward points" ? "Partner reward points" : tab === "Coupons" ? "Coupon usage" : "Bank payouts" })).toBeVisible();
        }
        await page.getByRole("tab", { name: "Credits & Pro" }).click();
        await page.getByLabel("Resident email").fill(env.QA_USER_EMAIL);
        await page.getByLabel("Amount (€)").fill("4");
        await expect(page.getByLabel("Currency")).toHaveValue("EUR");
        await page.getByLabel("Funded by").selectOption("partner");
        await page.getByLabel("Expires (optional)").fill("2027-03-31");
        await page.getByRole("button", { name: "Grant credit…" }).click();
        const grant = page.getByRole("dialog");
        await expect(grant).toContainText("funded by the partner, expiring 2027-03-31");
        await grant.getByLabel(/Reason/).fill(note);
        await grant.getByRole("button", { name: "Grant", exact: true }).click();
        await expect(page.getByText(/^Granted\. Expires 31 Mar 2027, 23:59/)).toBeVisible(); // end of the chosen day in Ireland
        const lots = await rows(f, "SELECT amount_minor, funding_owner, currency, idempotency_key IS NOT NULL AS keyed, DATE(expires_at) AS d FROM credit_lots WHERE resident_id = ? AND reason = ?", [personas.QA_USER.id, note]);
        expect(lots.map((l: any) => [l.amount_minor, l.funding_owner, l.currency, Number(l.keyed)])).toEqual([[400, "partner", "EUR", 1]]);
        await expect(page.getByTestId("credit-outstanding")).toBeVisible();
        await shot(page, `admin-credit-grant-${viewport}`);
        await fitsViewport(page);
      } finally {
        await ui.close();
        await f.connection.execute("DELETE FROM credit_lots WHERE resident_id = ? AND reason = ?", [personas.QA_USER.id, note]);
        await restore();
      }
    });
  });
}
