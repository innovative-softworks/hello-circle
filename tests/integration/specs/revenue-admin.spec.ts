import { expect, env, personas } from "../fixtures";
import { rows, test, withActors } from "../lifecycle-fixture";
import { businessUiActor } from "../product-fixture";
import { fitsViewport, setSwitches } from "../revenue-fixture";

// Revenue & Connect Stage 5c — admin Stage 3–5 journeys at desktop and
// mobile: Finance (simulator, transfer preview, partner debts, credits) and
// Policies & trust (drafts carry "legal review required" and can't be
// published; complaint decisions need a statement of reasons).

async function reason(page: import("@playwright/test").Page, confirm: string) {
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel(/Reason/).fill("QA end-to-end check");
  await dialog.getByRole("button", { name: confirm, exact: true }).click();
}

for (const viewport of ["desktop", "mobile"] as const) {
  test(`REV-ADMIN-FINANCE-${viewport}: simulator, transfer preview, partner debts and credits`, async ({ playwright, browser }) => {
    test.setTimeout(90_000);
    await withActors(playwright, [], async (f) => {
      const restore = await setSwitches(f.connection, { "commerce.connect_v1": true, "commerce.customer_credits": true });
      const ui = await businessUiActor(browser, "QA_ADMIN", viewport);
      try {
        const { page } = ui;
        page.setDefaultTimeout(15_000); // a missing control fails at its step, not at the test timeout
        await page.goto("/admin?tab=plansCredit");
        await page.getByRole("tab", { name: "Simulator" }).click();
        // R3B F1 — the simulator is labelled hypothetical (plan model, not what checkout charges).
        await expect(page.getByTestId("simulator-hypothetical")).toContainText(/Hypothetical/);
        await page.getByLabel("Price (€)").fill("100");
        await page.getByRole("button", { name: "Simulate" }).click();
        await expect(page.getByText("€88.93").first()).toBeVisible(); // partner pool, test vector 1
        // Transfers and partner debts live on the Finance page since the admin redesign (2026-10-14).
        await page.goto("/admin?tab=finance&section=transfers");
        await expect(page.getByRole("heading", { name: /Transfers to partners/ })).toBeVisible();
        await page.getByRole("button", { name: "Preview transfers" }).click();
        await reason(page, "Preview");
        await expect(page.getByText(/^Preview: \d+ transfer/)).toBeVisible();
        await page.goto("/admin?tab=finance&section=debts");
        await expect(page.getByRole("heading", { name: "Partner debts" })).toBeVisible();
        await page.goto("/admin?tab=plansCredit&section=credits");
        // The grant form is a popup since the admin redesign.
        await page.getByRole("button", { name: "New credit grant" }).click();
        await page.getByRole("dialog").getByLabel("Resident email").fill(env.QA_USER_EMAIL);
        await page.getByRole("dialog").getByLabel("Amount (€)").fill("5");
        await page.getByRole("button", { name: "Grant credit…" }).click();
        await reason(page, "Grant");
        await expect(page.getByText(/^Granted\. Expires/)).toBeVisible();
        expect(await rows(f, "SELECT amount_minor, kind FROM credit_lots WHERE resident_id = ? AND created_by = ? AND reason = 'QA end-to-end check'", [personas.QA_USER.id, personas.QA_ADMIN.id])).toEqual([{ amount_minor: 500, kind: "goodwill" }]);
        await fitsViewport(page);
      } finally {
        await ui.close();
        await f.connection.execute("DELETE FROM credit_lots WHERE resident_id = ? AND created_by = ? AND reason = 'QA end-to-end check'", [personas.QA_USER.id, personas.QA_ADMIN.id]);
        await restore();
      }
    });
  });

  test(`REV-ADMIN-TRUST-${viewport}: drafts are marked and blocked; complaint decisions need reasons`, async ({ playwright, browser }) => {
    test.setTimeout(90_000);
    await withActors(playwright, [], async (f) => {
      const email = `qa-trust-${viewport}-${Date.now()}@example.test`;
      await f.connection.execute("INSERT INTO complaints (kind, subject_type, submitter_type, email, body) VALUES ('complaint', 'booking', 'anonymous', ?, 'The session never took place and nobody replied. (QA)')", [email]);
      const ui = await businessUiActor(browser, "QA_ADMIN", viewport);
      try {
        const { page } = ui;
        page.setDefaultTimeout(10_000); // a stuck step fails with its line, not a whole-test timeout
        await page.goto("/admin?tab=policies");
        await expect(page.getByRole("heading", { name: "Policy documents" })).toBeVisible();
        const terms = page.getByRole("row").filter({ hasText: "General Terms" }).first();
        await terms.getByRole("button", { name: "Versions" }).click();
        await expect(page.getByRole("button", { name: "Open", exact: true }).first()).toBeVisible();
        await fitsViewport(page); // the versions table must not widen the page on a phone
        // A person scrolls the row up from under the fixed mobile bottom bar before tapping it
        // (same as booking-ui.spec.ts); "Open" exactly — not the mobile header's "Open menu".
        const open = page.getByRole("button", { name: "Open", exact: true }).first();
        await open.evaluate((el) => el.scrollIntoView({ block: "center" }));
        await open.click();
        const editor = page.getByRole("dialog");
        await expect(editor.getByText("Draft — legal review required")).toBeVisible();
        await expect(editor.getByText("Legal sign-off not yet recorded")).toBeVisible();
        await expect(editor.getByText(/Placeholders without a value: .*LEGAL_ENTITY_NAME/)).toBeVisible();
        await editor.getByRole("button", { name: /close/i }).first().click();
        await page.getByRole("tab", { name: "Complaints & appeals" }).click();
        const item = page.locator("div").filter({ hasText: email }).filter({ has: page.getByRole("button", { name: "Decide…" }) }).last();
        const decideButton = item.getByRole("button", { name: "Decide…" });
        await decideButton.evaluate((el) => el.scrollIntoView({ block: "center" }));
        await decideButton.click();
        const decide = page.getByRole("dialog");
        const send = decide.getByRole("button", { name: "Send decision" });
        await decide.getByLabel(/Statement of reasons/).fill("Too short");
        await expect(send).toBeDisabled();
        await decide.getByLabel(/Statement of reasons/).fill("The provider confirmed the cancellation; a full refund has been issued. (QA)");
        await send.click();
        await expect.poll(async () => (await rows(f, "SELECT status, decision FROM complaints WHERE email = ?", [email]))[0]).toEqual({ status: "closed", decision: "resolved" });
        await fitsViewport(page);
      } finally {
        await ui.close();
        await f.connection.execute("DELETE FROM complaints WHERE email = ?", [email]);
        await f.connection.execute("DELETE FROM audit_log WHERE action = 'complaint.decided' AND actor_user_id = ?", [personas.QA_ADMIN.id]);
      }
    });
  });
}
