import { expect } from "../fixtures";
import { rows, test, withActors } from "../lifecycle-fixture";
import { uiActor } from "../lifecycle-ui-fixture";
import { fitsViewport } from "../revenue-fixture";

// Revenue & Connect Stage 5c — public Stage 3–4 journeys at desktop and
// mobile: the pricing page and its live calculators (numbers from the
// published rules), the cookie banner's separate analytics/advertising
// choices, and the Policy Centre + complaints form. No logins.

for (const viewport of ["desktop", "mobile"] as const) {
  test(`REV-PUBLIC-PRICING-${viewport}: plans, live calculators and field help`, async ({ playwright, browser }) => {
    test.setTimeout(60_000);
    await withActors(playwright, [], async () => {
      const ui = await uiActor(browser, null, viewport);
      try {
        const { page } = ui;
        await page.goto("/pricing");
        await expect(page.getByRole("heading", { name: /Simple pricing/ })).toBeVisible();
        await expect(page.getByText(/9% \+ VAT per completed paid booking/)).toBeVisible();
        await expect(page.getByText(/7% \+ VAT per completed paid booking/)).toBeVisible();
        // Test vector 1: €100 on Free → partner earnings €88.93 (fee €9.00 + VAT €2.07).
        const price = page.getByLabel("Price per place (€)");
        await price.fill("100");
        await expect(page.getByText("€88.93").first()).toBeVisible();
        await expect(page.getByText("−€9.00").first()).toBeVisible();
        await expect(page.getByText("−€2.07").first()).toBeVisible();
        // Below the minimum: €5 → the €0.75 minimum fee applies.
        await price.fill("5");
        await expect(page.getByText(/minimum applies/)).toBeVisible();
        // Free vs Pro comparison and break-even.
        await expect(page.getByText(/Pro pays for itself above/).first()).toBeVisible();
        // Field help explains in place.
        await page.getByRole("button", { name: /What is HelloCircle fee\?/ }).first().click();
        await expect(page.getByRole("note").first()).toContainText(/success fee/);
        await fitsViewport(page);
        expect(ui.consoleErrors).toEqual([]);
      } finally {
        await ui.close();
      }
    });
  });

  test(`REV-PUBLIC-COOKIES-${viewport}: analytics and advertising are separate choices, recorded separately`, async ({ playwright, browser }) => {
    test.setTimeout(60_000);
    await withActors(playwright, [], async (f) => {
      const ui = await uiActor(browser, null, viewport, { consent: false });
      let clientId = "";
      try {
        const { page } = ui;
        await page.goto("/pricing");
        const banner = page.getByRole("region", { name: "Cookie preferences" });
        await expect(banner).toBeVisible();
        await expect(banner.getByText(/analytics/i).first()).toBeVisible();
        await expect(banner.getByText(/advertising/i).first()).toBeVisible();
        await banner.getByRole("button", { name: "Choose…" }).click();
        await banner.getByLabel("Analytics").check();
        await expect(banner.getByLabel("Advertising")).not.toBeChecked();
        await banner.getByRole("button", { name: "Save my choices" }).click();
        await expect(banner).toHaveCount(0);
        const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("hello_circle_cookie_consent") ?? "null"));
        expect(stored).toMatchObject({ v: 2, analytics: true, advertising: false });
        // Consent Mode: denied by default, then analytics granted and ads still denied.
        const consent = await page.evaluate(() => ((window as unknown as { dataLayer?: unknown[] }).dataLayer ?? []).filter((e: any) => e && e[0] === "consent").map((e: any) => [e[1], e[2]]));
        expect(consent[0]).toEqual(["default", expect.objectContaining({ analytics_storage: "denied", ad_storage: "denied" })]);
        expect(consent.at(-1)).toEqual(["update", { analytics_storage: "granted", ad_storage: "denied", ad_user_data: "denied", ad_personalization: "denied" }]);
        clientId = await page.evaluate(() => localStorage.getItem("hello_circle_client_id") ?? "");
        await expect.poll(async () => (await rows(f, "SELECT purpose, granted FROM consent_records WHERE subject_type = 'client' AND subject_id = ? ORDER BY purpose", [clientId])).length).toBe(2);
        expect(await rows(f, "SELECT purpose, granted FROM consent_records WHERE subject_type = 'client' AND subject_id = ? ORDER BY purpose", [clientId])).toEqual([
          { purpose: "advertising_cookies", granted: 0 },
          { purpose: "analytics_cookies", granted: 1 },
        ]);
        // The cookie policy shows both choices.
        await page.goto("/cookies");
        await expect(page.getByText("analytics on, advertising off").first()).toBeVisible();
        await fitsViewport(page);
      } finally {
        await ui.close();
        if (clientId) await f.connection.execute("DELETE FROM consent_records WHERE subject_type = 'client' AND subject_id = ?", [clientId]);
      }
    });
  });

  test(`REV-PUBLIC-POLICIES-${viewport}: Policy Centre shows only published text; complaints form records a request`, async ({ playwright, browser }) => {
    test.setTimeout(60_000);
    await withActors(playwright, [], async (f) => {
      const ui = await uiActor(browser, null, viewport);
      const email = `qa-complaint-${viewport}-${Date.now()}@example.test`;
      try {
        const { page } = ui;
        await page.goto("/policies");
        await expect(page.getByRole("heading", { name: "Policy Centre" })).toBeVisible();
        await expect(page.getByRole("link", { name: "General Terms" })).toBeVisible();
        await page.getByRole("link", { name: "General Terms" }).click();
        await expect(page.getByText(/hasn't been published yet/)).toBeVisible();
        await expect(page.getByText(/\[\[LEGAL_ENTITY_NAME\]\]/)).toHaveCount(0); // drafts are never shown
        await page.goto("/complaints");
        await page.getByLabel(/Report illegal content/).check();
        await page.getByLabel("What is it about?").selectOption("listing");
        await page.getByLabel("Your email").fill(email);
        await page.getByLabel(/Where is the content/).fill("This listing advertises an activity that is not allowed. (QA)");
        await page.getByRole("button", { name: "Send" }).click();
        await expect(page.getByRole("status")).toContainText(/received your request/);
        const [row] = await rows(f, "SELECT kind, subject_type, status FROM complaints WHERE email = ?", [email]);
        expect(row).toEqual({ kind: "notice", subject_type: "listing", status: "open" });
        await fitsViewport(page);
      } finally {
        await ui.close();
        await f.connection.execute("DELETE FROM complaints WHERE email = ?", [email]);
      }
    });
  });
}
