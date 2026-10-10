import { randomUUID } from "node:crypto";
import { expect, personas } from "../fixtures";
import { rows, test, withActors } from "../lifecycle-fixture";
import { businessUiActor } from "../product-fixture";
import { fitsViewport, setSwitches } from "../revenue-fixture";

// Revenue & Connect Stage 5c — the rest of the admin Finance / Policies &
// trust screens at desktop and mobile: settlement preview, payment events,
// refunds, disputes, plans & promotions, admin roles, field-help editing,
// and opening a partner debt from the transfers screen (its first reversal
// is refused by the provider stub — the debt stays open, frozen, with the
// unrecovered amount recorded) plus the per-booking allocations view.

async function reason(page: import("@playwright/test").Page, confirm: string) {
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel(/Reason/).fill("QA end-to-end check");
  await dialog.getByRole("button", { name: confirm, exact: true }).click();
}

for (const viewport of ["desktop", "mobile"] as const) {
  test(`REV-ADMIN-B-FINANCE-${viewport}: settlement preview, events, refunds, disputes, plans and roles`, async ({ playwright, browser }) => {
    test.setTimeout(90_000);
    await withActors(playwright, [], async (f) => {
      const restore = await setSwitches(f.connection, { "commerce.settlement_ledger": true });
      const runKey = `qa-week-${viewport}-${randomUUID().slice(0, 6)}`;
      const ui = await businessUiActor(browser, "QA_ADMIN", viewport);
      try {
        const { page } = ui;
        page.setDefaultTimeout(10_000);
        await page.goto("/admin?tab=finance");
        await page.getByRole("tab", { name: "Settlements" }).click();
        await page.getByLabel("Run key").fill(runKey);
        await page.getByRole("button", { name: "Preview (dry run)" }).click();
        await reason(page, "Preview");
        await expect(page.getByText(/^Preview: \d+ orders released/)).toBeVisible();
        expect(await rows(f, "SELECT dry_run FROM settlement_runs WHERE run_key = ?", [runKey])).toEqual([{ dry_run: 1 }]); // a preview never settles
        await page.getByRole("tab", { name: "Payment events" }).click();
        await expect(page.getByRole("heading", { name: "Payment events" })).toBeVisible();
        await page.getByRole("tab", { name: "Refunds" }).click();
        await expect(page.getByRole("button", { name: "Refund…" })).toBeDisabled(); // no order reference yet
        await page.getByRole("tab", { name: "Disputes" }).click();
        await expect(page.getByRole("heading", { name: "Disputes" })).toBeVisible();
        await page.getByRole("tab", { name: "Plans & promotions" }).click();
        await expect(page.getByText(/Free: 9%/)).toBeVisible();
        await page.getByRole("tab", { name: "Admin roles" }).click();
        await expect(page.getByRole("heading", { name: "Admin roles" })).toBeVisible();
        await fitsViewport(page);
      } finally {
        await ui.close();
        await f.connection.execute("DELETE FROM settlement_runs WHERE run_key = ?", [runKey]);
        await restore();
      }
    });
  });

  test(`REV-ADMIN-B-DEBT-${viewport}: opening a partner debt freezes earnings; a refused reversal leaves it open`, async ({ playwright, browser }) => {
    test.setTimeout(90_000);
    await withActors(playwright, [], async (f) => {
      const restore = await setSwitches(f.connection, { "commerce.settlement_ledger": true, "commerce.connect_v1": true });
      const [{ org_id: orgId }] = await rows(f, "SELECT org_id FROM users WHERE id = ?", [personas.QA_VENDOR.id]);
      const tag = randomUUID().slice(0, 8);
      // A combined run leaves this org with real balances from the Stripe suites (e.g. a lost chargeback).
      // Neutralise them with a labelled synthetic group (removed in finally) so this test's €12 is exact.
      const neutralId = randomUUID();
      const [{ s: priorSum }] = await rows(f, "SELECT COALESCE(SUM(amount_minor), 0) AS s FROM ledger_entries WHERE account_code = 'partner_available' AND party_type = 'org' AND party_id = ?", [orgId]);
      if (Number(priorSum) !== 0) {
        await f.connection.execute("INSERT INTO ledger_entry_groups (id, idempotency_key, source_type, source_id, description, basis, currency) VALUES (?, ?, 'test', ?, 'QA neutralise prior balance', 'actual', 'EUR')", [neutralId, `qa-neutral-${tag}`, `qa-neutral-${tag}`]);
        await f.connection.execute("INSERT INTO ledger_entries (group_id, line_no, account_code, party_type, party_id, amount_minor, currency) VALUES (?, 1, 'partner_available', 'org', ?, ?, 'EUR'), (?, 2, 'refund_liability', NULL, NULL, ?, 'EUR')", [neutralId, orgId, -Number(priorSum), neutralId, Number(priorSum)]);
      }
      // Synthetic state: a connected account, one transfer of €40 with its booking allocation, then a €12 refund after transfer.
      await f.connection.execute("INSERT INTO connected_accounts (party_type, party_id, provider, account_id, country, details_submitted, payouts_enabled, transfers_capability) VALUES ('org', ?, 'stub', ?, 'IE', 1, 1, 'active')", [orgId, `acct_qa_${tag}`]);
      const [t] = await f.connection.execute<any>("INSERT INTO transfers (settlement_id, attempt, idempotency_key, party_type, party_id, destination_account, amount_minor, currency, transfer_group, provider_transfer_id, status) VALUES (0, 1, ?, 'org', ?, ?, 4000, 'EUR', 'qa', ?, 'created')", [`qa-${tag}`, orgId, `acct_qa_${tag}`, `tr_qa_${tag}`]);
      const transferId = t.insertId as number;
      await f.connection.execute("INSERT INTO transfer_allocations (transfer_id, settlement_item_id, ledger_group_id, kind, source_type, source_ref, party_type, party_id, amount_minor) VALUES (?, 0, ?, 'booking', 'experience', ?, 'org', ?, 4000)", [transferId, randomUUID(), `QA-${tag}`, orgId]);
      const groupId = randomUUID();
      await f.connection.execute("INSERT INTO ledger_entry_groups (id, idempotency_key, source_type, source_id, description, basis, currency) VALUES (?, ?, 'test', ?, 'QA refund after transfer', 'actual', 'EUR')", [groupId, `qa-owe-${tag}`, tag]);
      await f.connection.execute("INSERT INTO ledger_entries (group_id, line_no, account_code, party_type, party_id, amount_minor, currency) VALUES (?, 1, 'partner_available', 'org', ?, 1200, 'EUR'), (?, 2, 'refund_liability', NULL, NULL, -1200, 'EUR')", [groupId, orgId, groupId]);
      const ui = await businessUiActor(browser, "QA_ADMIN", viewport);
      try {
        const { page } = ui;
        page.setDefaultTimeout(10_000);
        await page.goto("/admin?tab=finance");
        await page.getByRole("tab", { name: "Transfers" }).click();
        // Per-booking allocations of the transfer.
        const transferRow = page.getByRole("row").filter({ hasText: orgId }).filter({ has: page.getByRole("button", { name: "Bookings…" }) }).first();
        const bookings = transferRow.getByRole("button", { name: "Bookings…" });
        await bookings.evaluate((el) => el.scrollIntoView({ block: "center" }));
        await bookings.click();
        const allocations = page.getByRole("dialog");
        await expect(allocations.getByText(`experience QA-${tag}`)).toBeVisible();
        await allocations.getByRole("button", { name: /close/i }).first().click();
        // Open the debt from the connected account row.
        const accountRow = page.getByRole("row").filter({ hasText: `acct_qa_${tag}` });
        const openDebt = accountRow.getByRole("button", { name: "Open partner debt…" });
        await openDebt.evaluate((el) => el.scrollIntoView({ block: "center" }));
        await openDebt.click();
        await reason(page, "Open debt and recover");
        await expect(page.getByText(/recovered €0\.00; €12\.00 still owed \(frozen until recovered or offset\)/)).toBeVisible();
        const [debt] = await rows(f, "SELECT status, opened_minor, recovered_minor FROM partner_debts WHERE party_type = 'org' AND party_id = ?", [orgId]);
        expect(debt).toEqual({ status: "open", opened_minor: 1200, recovered_minor: 0 });
        expect(await rows(f, "SELECT status FROM transfer_reversals WHERE transfer_id = ?", [transferId])).toEqual([{ status: "failed" }]);
        await page.getByRole("tab", { name: "Partner debts" }).click();
        await expect(page.getByRole("row").filter({ hasText: orgId }).getByText("€12.00").first()).toBeVisible();
        await fitsViewport(page);
      } finally {
        await ui.close();
        await f.connection.execute("DELETE FROM transfer_allocation_reversals WHERE allocation_id IN (SELECT id FROM transfer_allocations WHERE transfer_id = ?)", [transferId]);
        await f.connection.execute("DELETE FROM transfer_reversals WHERE transfer_id = ?", [transferId]);
        await f.connection.execute("DELETE FROM transfer_allocations WHERE transfer_id = ?", [transferId]);
        await f.connection.execute("DELETE FROM transfers WHERE id = ?", [transferId]);
        await f.connection.execute("DELETE FROM partner_debts WHERE party_type = 'org' AND party_id = ?", [orgId]);
        await f.connection.execute("DELETE FROM ledger_entries WHERE group_id IN (?, ?)", [groupId, neutralId]);
        await f.connection.execute("DELETE FROM ledger_entry_groups WHERE id IN (?, ?)", [groupId, neutralId]);
        await f.connection.execute("DELETE FROM connected_accounts WHERE account_id = ?", [`acct_qa_${tag}`]);
        await f.connection.execute("DELETE FROM audit_log WHERE object_id = ? AND action LIKE 'partner_debt.%'", [orgId]);
        await restore();
      }
    });
  });

  test(`REV-ADMIN-B-HELP-${viewport}: editing field help adds a version`, async ({ playwright, browser }) => {
    test.setTimeout(60_000);
    await withActors(playwright, [], async (f) => {
      const [{ v }] = await rows(f, "SELECT MAX(version) as v FROM help_entries WHERE help_key = 'fee_base'", []);
      const ui = await businessUiActor(browser, "QA_ADMIN", viewport);
      try {
        const { page } = ui;
        page.setDefaultTimeout(10_000);
        await page.goto("/admin?tab=finance");
        await page.getByRole("tab", { name: "Field help" }).click();
        const row = page.getByRole("row").filter({ has: page.getByRole("cell", { name: "Fee base", exact: true }) });
        const edit = row.getByRole("button", { name: "Edit" });
        await edit.evaluate((el) => el.scrollIntoView({ block: "center" }));
        await edit.click();
        const dialog = page.getByRole("dialog");
        await dialog.getByLabel("example").fill(`€100 with your €10 coupon → €90 (QA ${viewport})`);
        await dialog.getByLabel("Reason (required)").fill("QA wording check");
        await dialog.getByRole("button", { name: "Save new version" }).click();
        await expect(dialog).toHaveCount(0);
        expect(await rows(f, "SELECT version, example FROM help_entries WHERE help_key = 'fee_base' ORDER BY version DESC LIMIT 1", [])).toEqual([{ version: Number(v) + 1, example: `€100 with your €10 coupon → €90 (QA ${viewport})` }]);
        await fitsViewport(page);
      } finally {
        await ui.close();
        await f.connection.execute("DELETE FROM help_entries WHERE help_key = 'fee_base' AND version > ?", [Number(v)]);
        await f.connection.execute("DELETE FROM audit_log WHERE action = 'help.updated' AND object_id = 'fee_base'", []);
      }
    });
  });
}
