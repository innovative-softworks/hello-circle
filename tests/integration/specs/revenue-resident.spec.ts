import { expect, personas } from "../fixtures";
import { rows, test, withActors } from "../lifecycle-fixture";
import { uiActor } from "../lifecycle-ui-fixture";
import { bookableExperience } from "../booking-fixture";
import { fitsViewport, publishForTest, setSwitches } from "../revenue-fixture";

// Revenue & Connect Stage 5c — resident/host Stage 4–5 journeys at desktop
// and mobile: the policy gate (terms *accepted* and the privacy notice
// *acknowledged* — two checkboxes, two different records), host earnings
// (payout account + trader details) and HelloCircle credit at checkout.

for (const viewport of ["desktop", "mobile"] as const) {
  test(`REV-GATE-${viewport}: terms are accepted and the privacy notice acknowledged — separately`, async ({ playwright, browser }) => {
    test.setTimeout(60_000);
    await withActors(playwright, [], async (f) => {
      const restoreTerms = await publishForTest(f.connection, "general-terms");
      const restorePrivacy = await publishForTest(f.connection, "privacy-policy");
      const ui = await uiActor(browser, "QA_USER", viewport);
      try {
        const { page } = ui;
        await page.goto("/");
        const dialog = page.getByRole("dialog", { name: /review our terms/ });
        await expect(dialog).toBeVisible();
        await expect(dialog.getByRole("heading", { name: "Terms to accept" })).toBeVisible();
        await expect(dialog.getByRole("heading", { name: "Privacy notice" })).toBeVisible();
        const go = dialog.getByRole("button", { name: "Continue" });
        await expect(go).toBeDisabled();
        await dialog.getByLabel(/I accept/).check();
        await expect(go).toBeDisabled(); // accepting the terms isn't reading the privacy notice
        await dialog.getByLabel("I have read the privacy notice.").check();
        await go.click();
        await expect(dialog).toHaveCount(0);
        expect(await rows(f, "SELECT doc_key, version FROM policy_acceptances WHERE subject_type = 'resident' AND subject_id = ?", [personas.QA_USER.id])).toEqual([{ doc_key: "general-terms", version: 1 }]);
        expect(await rows(f, "SELECT purpose, policy_doc_key FROM consent_records WHERE subject_type = 'resident' AND subject_id = ? AND purpose = 'privacy_notice_ack'", [personas.QA_USER.id])).toEqual([{ purpose: "privacy_notice_ack", policy_doc_key: "privacy-policy" }]);
        // Neither grants marketing.
        expect(await rows(f, "SELECT granted FROM consent_records WHERE subject_type = 'resident' AND subject_id = ? AND purpose = 'marketing_email' AND source = 'policy_gate'", [personas.QA_USER.id])).toEqual([]);
        await page.reload();
        await expect(page.getByRole("dialog", { name: /review our terms/ })).toHaveCount(0);
        await fitsViewport(page);
      } finally {
        await ui.close();
        await f.connection.execute("DELETE FROM policy_acceptances WHERE subject_type = 'resident' AND subject_id = ? AND doc_key = 'general-terms'", [personas.QA_USER.id]);
        await f.connection.execute("DELETE FROM consent_records WHERE subject_type = 'resident' AND subject_id = ? AND purpose = 'privacy_notice_ack'", [personas.QA_USER.id]);
        await restorePrivacy();
        await restoreTerms();
      }
    });
  });

  test(`REV-HOST-EARNINGS-${viewport}: host sees the payout account and trader details`, async ({ playwright, browser }) => {
    test.setTimeout(60_000);
    await withActors(playwright, [], async (f) => {
      const restore = await setSwitches(f.connection, { "commerce.connect_v1": true });
      const ui = await uiActor(browser, "QA_HOST", viewport);
      try {
        const { page } = ui;
        await page.goto("/manage?tab=earnings");
        await expect(page.getByRole("heading", { name: "Your balance" })).toBeVisible();
        await expect(page.getByRole("heading", { name: "Payout account" })).toBeVisible();
        await expect(page.getByRole("heading", { name: "Trader details" })).toBeVisible();
        await expect(page.getByLabel("Selling as")).toHaveValue("individual");
        await expect(page.getByLabel("Date of birth")).toBeVisible();
        await fitsViewport(page);
      } finally {
        await ui.close();
        await restore();
      }
    });
  });

  test(`REV-CREDIT-${viewport}: a resident applies HelloCircle credit at checkout`, async ({ playwright, browser }) => {
    test.setTimeout(90_000);
    await withActors(playwright, ["QA_VENDOR"], async (f) => {
      const restore = await setSwitches(f.connection, { "commerce.engine_v2": true, "commerce.engine_v2_experience": true, "commerce.customer_credits": true });
      const exp = await bookableExperience(f, { price: 2500, capacity: 6, payment: "online" });
      const lot = await f.connection.execute<any>(
        "INSERT INTO credit_lots (resident_id, kind, amount_minor, remaining_minor, reason, expires_at, created_by) VALUES (?, 'goodwill', 500, 500, 'QA credit', DATE_ADD(NOW(), INTERVAL 30 DAY), 'qa')",
        [personas.QA_USER.id]
      );
      const lotId = (lot[0] as { insertId: number }).insertId;
      const ui = await uiActor(browser, "QA_USER", viewport);
      try {
        const { page } = ui;
        await page.goto(`/experiences/${exp.id}`);
        await page.waitForTimeout(600);
        const cta = viewport === "mobile"
          ? page.locator(".mobile-join-bar").getByRole("button", { name: "Book this adventure" })
          : page.getByRole("button", { name: "Book this adventure" }).filter({ visible: true }).first();
        await cta.click();
        const dialog = page.getByRole("dialog");
        const sessionButton = dialog.getByRole("button", { name: /left$/ });
        if (await sessionButton.count()) await sessionButton.first().click();
        await dialog.locator('input[autocomplete="name"]').fill("QA credit booker");
        const credit = dialog.getByLabel(/Use my HelloCircle credit \(€5\.00 available\)/);
        await expect(credit).toBeVisible();
        const before = (await dialog.locator("text=/^€\\d/").first().textContent())?.trim();
        await credit.check();
        await expect(dialog.getByText(/€5\.00 off/)).toBeVisible();
        await expect.poll(async () => (await dialog.locator("text=/^€\\d/").first().textContent())?.trim()).not.toBe(before);
        await dialog.getByRole("button", { name: /^(Book|Continue to pay)$/ }).click();
        await expect.poll(async () => (await rows(f, "SELECT amount_minor, status FROM credit_uses WHERE lot_id = ?", [lotId])).length).toBe(1);
        expect(await rows(f, "SELECT amount_minor, status FROM credit_uses WHERE lot_id = ?", [lotId])).toEqual([{ amount_minor: 500, status: "reserved" }]);
        await fitsViewport(page);
      } finally {
        await ui.close();
        await f.connection.execute("DELETE FROM credit_uses WHERE lot_id = ?", [lotId]);
        await f.connection.execute("DELETE FROM credit_lots WHERE id = ?", [lotId]);
        await f.connection.execute("DELETE FROM commerce_quotes WHERE resource_id = ?", [exp.id]);
        const orders = await rows(f, "SELECT o.id FROM commerce_orders o JOIN experience_bookings b ON b.ref = o.source_ref WHERE b.experience_id = ?", [exp.id]);
        for (const o of orders) {
          await f.connection.execute("DELETE FROM pricing_snapshots WHERE order_id = ?", [o.id]);
          await f.connection.execute("DELETE FROM commerce_order_lines WHERE order_id = ?", [o.id]);
          await f.connection.execute("DELETE FROM commerce_orders WHERE id = ?", [o.id]);
        }
        await restore();
      }
    });
  });
}
