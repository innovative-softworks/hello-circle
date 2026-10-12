import { randomUUID } from "node:crypto";
import { expect, personas } from "../fixtures";
import { rows, test, withActors } from "../lifecycle-fixture";
import { uiActor } from "../lifecycle-ui-fixture";
import { bookableExperience } from "../booking-fixture";
import { fitsViewport, setSwitches, shot } from "../revenue-fixture";

// Revenue & Connect Stage 5f — customer credit and coupons at desktop and
// mobile (fake provider): the resident's credit wallet; experience checkout
// with an invalid coupon (reason shown), a valid HelloCircle-funded coupon,
// then credit covering the rest — card payment due "none needed", booked
// without Stripe — and the wallet history showing the credit used.

for (const viewport of ["desktop", "mobile"] as const) {
  test(`REV-5F-CREDIT-${viewport}: wallet → coupon (invalid, valid) + credit → zero card payment → history`, async ({ playwright, browser }) => {
    test.setTimeout(150_000);
    await withActors(playwright, ["QA_VENDOR"], async (f) => {
      const user = personas.QA_USER.id;
      const restore = await setSwitches(f.connection, { "commerce.engine_v2": true, "commerce.engine_v2_experience": true, "commerce.customer_credits": true });
      const tag = randomUUID().slice(0, 6).toUpperCase();
      const code = `QA5F${tag}`;
      const exp = await bookableExperience(f, { price: 2000, capacity: 6, payment: "online" });
      await f.connection.execute("INSERT INTO coupons (code, kind, amount, max_uses, used_count, expires_at, active, funding, platform_share_bps) VALUES (?, 'fixed', 500, NULL, 0, NULL, 1, 'platform', 10000)", [code]);
      await f.connection.execute("INSERT INTO credit_lots (resident_id, kind, amount_minor, remaining_minor, reason, expires_at, created_by, currency, funding_owner) VALUES (?, 'goodwill', 1500, 1500, 'QA 5f wallet', DATE_ADD(NOW(), INTERVAL 6 MONTH), 'qa', 'EUR', 'helloCircle')", [user]);
      const ui = await uiActor(browser, "QA_USER", viewport);
      try {
        const { page } = ui;
        page.setDefaultTimeout(15_000);
        // Wallet: balance and the grant.
        await page.goto("/profile?tab=credit");
        await expect(page.getByTestId("credit-balance")).toHaveText("€15.00");
        await expect(page.getByTestId("credit-history").locator('li[data-kind="granted"]').first()).toContainText("Credit added");
        await shot(page, `credit-wallet-${viewport}`);
        await fitsViewport(page);
        // Experience checkout.
        await page.goto(`/experiences/${exp.id}`);
        await page.waitForTimeout(600);
        const cta = viewport === "mobile" ? page.locator(".mobile-join-bar").getByRole("button", { name: "Book this adventure" }) : page.getByRole("button", { name: "Book this adventure" }).filter({ visible: true }).first();
        await cta.click();
        const dialog = page.getByRole("dialog");
        await page.waitForTimeout(500);
        const sessionButton = dialog.getByRole("button", { name: /left$/ });
        if (await sessionButton.count()) await sessionButton.first().click();
        await dialog.locator('input[autocomplete="name"]').fill("QA credit booker");
        const email = dialog.locator('input[type="email"]');
        if (!(await email.inputValue())) await email.fill("qa.credit@example.test");
        // Invalid coupon: the reason, not a generic error.
        await dialog.getByLabel("Coupon code (optional)").fill("NOPE5F");
        await dialog.getByRole("button", { name: "Apply" }).click();
        await expect(dialog.getByTestId("coupon-error")).toHaveText("That code isn't valid.");
        // Valid HelloCircle-funded coupon, then credit for the rest.
        await dialog.getByLabel("Coupon code (optional)").fill(code);
        await dialog.getByRole("button", { name: "Apply" }).click();
        await expect(dialog.getByTestId("breakdown-coupon")).toContainText("− €5.00");
        await dialog.getByLabel(/Use my HelloCircle credit/).check();
        await expect(dialog.getByTestId("breakdown-credit")).toContainText("− €15.00");
        await expect(dialog.getByTestId("breakdown-card")).toContainText("nothing to pay"); // R3A shared wording
        await expect(dialog.getByTestId("breakdown-card")).toContainText("€0.00");
        await shot(page, `checkout-coupon-credit-${viewport}`);
        // Booking UX Phase 4 — tick the acknowledgements the listing asks for.
        for (const label of [/^Everyone taking part is at least/, /^I've read the safety information/, /^I agree to the booking terms/]) {
          const box = dialog.getByRole("checkbox", { name: label });
          if (await box.count()) await box.check();
        }
        await dialog.getByRole("button", { name: /^(Book|Confirm|Reserve)/ }).click();
        await expect(page.getByRole("heading", { name: "You're booked." })).toBeVisible();
        const [booked] = await rows(f, "SELECT ref, payment_status AS ps FROM experience_bookings WHERE session_id = ? ORDER BY created_at DESC LIMIT 1", [exp.session]);
        expect(booked.ps, "no card payment needed").not.toBe("pending");
        // Wallet: the credit used against the booking.
        await page.goto("/profile?tab=credit");
        await expect(page.getByTestId("credit-balance")).toHaveText("€0.00");
        await expect(page.getByTestId("credit-history").locator('li[data-kind="used"]').first()).toContainText(booked.ref);
        await shot(page, `credit-used-${viewport}`);
      } finally {
        await ui.close();
        await f.connection.execute("DELETE FROM credit_uses WHERE resident_id = ?", [user]);
        await f.connection.execute("DELETE FROM credit_lots WHERE resident_id = ? AND reason = 'QA 5f wallet'", [user]);
        await f.connection.execute("DELETE FROM coupon_redemptions WHERE code = ?", [code]);
        await f.connection.execute("DELETE FROM coupons WHERE code = ?", [code]);
        await restore();
      }
    });
  });
}
