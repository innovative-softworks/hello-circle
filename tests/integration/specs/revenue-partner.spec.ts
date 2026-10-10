import { expect, env, personas } from "../fixtures";
import { rows, test, withActors } from "../lifecycle-fixture";
import { businessUiActor } from "../product-fixture";
import { fitsViewport, setSwitches } from "../revenue-fixture";

// Revenue & Connect Stage 5c — vendor Stage 3/5 journeys at desktop and
// mobile: ledger balances with transfers and bank payouts named apart, the
// Stripe-hosted payout-account onboarding (provider stub: the redirect
// target is a non-routable stub host, aborted by the harness), the Pro plan
// card (net price + the partner's VAT), and trader details (masked TIN).

for (const viewport of ["desktop", "mobile"] as const) {
  test(`REV-VENDOR-EARNINGS-${viewport}: balances, payout account onboarding and plan card`, async ({ playwright, browser }) => {
    test.setTimeout(90_000);
    await withActors(playwright, [], async (f) => {
      const [{ org_id: orgId }] = await rows(f, "SELECT org_id FROM users WHERE id = ?", [personas.QA_VENDOR.id]);
      const restore = await setSwitches(f.connection, { "commerce.connect_v1": true, "commerce.pro_subscriptions": true, "commerce.circle_credits": true });
      const ui = await businessUiActor(browser, "QA_VENDOR", viewport);
      try {
        const { page } = ui;
        await page.goto("/vendor?tab=earnings");
        await expect(page.getByRole("heading", { name: "Your balance" })).toBeVisible();
        const balance = page.locator("div").filter({ has: page.getByRole("heading", { name: "Your balance" }) }).last();
        for (const label of ["Pending", "Available", "Settled — transfer due", "Transferred to your Stripe account"]) await expect(balance.getByText(label).first()).toBeVisible();
        await expect(page.getByText(/transferred weekly to your Stripe account; Stripe then pays out to your bank/)).toBeVisible();
        // Payout account: what blocks payouts, then Stripe-hosted onboarding.
        // The card = the innermost div holding both its heading and its action (the heading sits in a header row).
        const card = page.locator("div").filter({ has: page.getByRole("heading", { name: "Payout account" }) }).filter({ has: page.getByRole("button", { name: "Set up payouts with Stripe" }) }).last();
        await expect(card.getByText("No payout account connected")).toBeVisible();
        // Stage 5e — the explicit account state, named by editable help content.
        await expect(card.getByTestId("payout-state")).toHaveAttribute("data-state", "not_started");
        await expect(card.getByTestId("payout-state")).toHaveText(/not started/i);
        await expect(card.getByText(/Trader details not completed/)).toBeVisible();
        const redirect = page.waitForRequest((r) => r.url().startsWith("https://connect.stub.invalid/onboarding/"));
        await card.getByRole("button", { name: "Set up payouts with Stripe" }).click();
        await redirect;
        const [acct] = await rows(f, "SELECT provider, country, transfers_capability, api_model, configuration_type, dashboard_type, onboarding_state FROM connected_accounts WHERE party_type = 'org' AND party_id = ?", [orgId]);
        expect(acct).toEqual({ provider: "stub", country: "IE", transfers_capability: "restricted", api_model: "v2", configuration_type: "recipient", dashboard_type: "express", onboarding_state: "onboarding_incomplete" });
        // Plan card: Pro is the net price; this partner's VAT is shown separately.
        // (A fresh page in the same session: the first one was sent to the blocked Stripe-hosted URL.)
        const plan = await ui.context.newPage();
        await plan.goto("/vendor?tab=earnings");
        await expect(plan.getByRole("heading", { name: "Your plan: Free" })).toBeVisible();
        await expect(plan.getByText(/Pro is €29\.00\/month excluding VAT/)).toBeVisible();
        await expect(plan.getByText(/\+ VAT €6\.67 for you/)).toBeVisible();
        await expect(plan.getByRole("button", { name: "Upgrade to Pro" })).toBeVisible();
        await expect(plan.getByText(/reward points/).first()).toBeVisible();
        await fitsViewport(plan);
      } finally {
        await ui.close();
        await f.connection.execute("DELETE FROM connected_accounts WHERE party_type = 'org' AND party_id = ?", [orgId]);
        await f.connection.execute("DELETE FROM connected_account_creations WHERE party_type = 'org' AND party_id = ?", [orgId]);
        await restore();
      }
    });
  });

  test(`REV-VENDOR-TRADER-${viewport}: trader details save with a masked tax number`, async ({ playwright, browser }) => {
    test.setTimeout(60_000);
    await withActors(playwright, [], async (f) => {
      const [{ org_id: orgId }] = await rows(f, "SELECT org_id FROM users WHERE id = ?", [personas.QA_VENDOR.id]);
      const ui = await businessUiActor(browser, "QA_VENDOR", viewport);
      try {
        const { page } = ui;
        await page.goto("/vendor?tab=org");
        await page.getByRole("button", { name: "Trader details", exact: true }).click(); // the org sub-tabs are plain buttons
        await expect(page.getByRole("heading", { name: "Trader details" })).toBeVisible();
        await page.getByLabel("Legal name").fill("QA Trader Ltd");
        await page.getByLabel("Address").fill("1 QA Street, Dublin");
        await page.getByLabel("Contact email").fill(env.QA_VENDOR_EMAIL);
        await page.getByLabel("Phone").fill("+353 1 555 0000");
        await page.getByLabel("Company registration number").fill("QA123456");
        await page.getByLabel(/Tax number/).fill("9876543QA");
        await page.getByLabel(/I certify that I only offer/).check();
        await page.getByRole("button", { name: "Save trader details" }).click();
        await expect(page.getByRole("status").filter({ hasText: "Saved." })).toBeVisible();
        await expect(page.getByLabel(/Tax number/)).toHaveValue("•••••43QA");
        await expect(page.getByText("Saved — leave as is to keep it")).toBeVisible();
        const [t] = await rows(f, "SELECT legal_name, tin, self_certified_at IS NOT NULL as certified FROM trader_profiles WHERE party_type = 'org' AND party_id = ?", [orgId]);
        expect(t).toEqual({ legal_name: "QA Trader Ltd", tin: "9876543QA", certified: 1 });
        await fitsViewport(page);
      } finally {
        await ui.close();
        await f.connection.execute("DELETE FROM trader_profiles WHERE party_type = 'org' AND party_id = ?", [orgId]);
      }
    });
  });
}

for (const viewport of ["desktop", "mobile"] as const) {
  test(`REV-VENDOR-PRO-${viewport}: upgrading starts a Stripe Billing checkout; points below the threshold can't be redeemed`, async ({ playwright, browser }) => {
    test.setTimeout(60_000);
    await withActors(playwright, [], async (f) => {
      const [{ org_id: orgId }] = await rows(f, "SELECT org_id FROM users WHERE id = ?", [personas.QA_VENDOR.id]);
      const restore = await setSwitches(f.connection, { "commerce.pro_subscriptions": true, "commerce.circle_credits": true });
      const ui = await businessUiActor(browser, "QA_VENDOR", viewport);
      try {
        const { page } = ui;
        page.setDefaultTimeout(10_000);
        await page.goto("/vendor?tab=earnings");
        const upgrade = page.getByRole("button", { name: "Upgrade to Pro" });
        await upgrade.evaluate((el) => el.scrollIntoView({ block: "center" }));
        await upgrade.click();
        // The provider stub returns no hosted URL, so the page stays; the checkout is recorded at the net price + this partner's VAT.
        await expect.poll(async () => (await rows(f, "SELECT status, net_minor, vat_minor, gross_minor FROM partner_subscriptions WHERE party_type = 'org' AND party_id = ?", [orgId]))[0]).toEqual({ status: "checkout", net_minor: 2900, vat_minor: 667, gross_minor: 3567 });
        await expect(page.getByRole("heading", { name: "Your plan: Free" })).toBeVisible(); // Pro starts only when the payment is confirmed
        await expect(page.getByRole("button", { name: /Redeem 10,000 points/ })).toBeDisabled();
        await fitsViewport(page);
      } finally {
        await ui.close();
        await f.connection.execute("DELETE FROM partner_subscriptions WHERE party_type = 'org' AND party_id = ?", [orgId]);
        await restore();
      }
    });
  });
}
