import { randomUUID } from "node:crypto";
import { expect, personas } from "../fixtures";
import { rows, test, withActors } from "../lifecycle-fixture";
import { uiActor } from "../lifecycle-ui-fixture";
import { businessUiActor } from "../product-fixture";
import { fitsViewport, setSwitches, shot } from "../revenue-fixture";

// Revenue & Connect Stage 5f — partner reward points at desktop and mobile
// (fake provider): zero points and pending points, a split-booking entry in
// the history, redeeming a reward-funded Pro month (confirmation, then the
// reward state), points debt blocking redemption with its reason, and a
// reverse-charge partner's Pro price (no VAT row amount, total = net).

for (const viewport of ["desktop", "mobile"] as const) {
  test(`REV-5F-REWARDS-${viewport}: pending → redeem a reward month → history → points debt; reverse-charge price`, async ({ playwright, browser }) => {
    test.setTimeout(150_000);
    await withActors(playwright, [], async (f) => {
      const host = personas.QA_HOST.id;
      const [{ org_id: orgB }] = await rows(f, "SELECT org_id FROM users WHERE id = ?", [personas.QA_VENDOR_B.id]);
      const restore = await setSwitches(f.connection, { "commerce.pro_subscriptions": true, "commerce.settlement_ledger": true, "commerce.circle_credits": true });
      const tag = randomUUID().slice(0, 8);
      const payRef = `QA5F-${tag}`;
      const groupId = randomUUID();
      const clean = async () => {
        await f.connection.execute("DELETE FROM reward_redemptions WHERE party_type = 'host' AND party_id = ?", [host]);
        await f.connection.execute("DELETE FROM reward_split_awards WHERE party_type = 'host' AND party_id = ? AND source_ref = ?", [host, payRef]);
        await f.connection.execute("DELETE FROM reward_lots WHERE party_type = 'host' AND party_id = ?", [host]);
        await f.connection.execute("DELETE FROM reward_debts WHERE party_type = 'host' AND party_id = ?", [host]);
        await f.connection.execute("DELETE FROM partner_plan_assignments WHERE partner_kind = 'host' AND partner_id = ? AND source = 'promotion'", [host]);
        await f.connection.execute("DELETE FROM ledger_entries WHERE group_id = ?", [groupId]);
        await f.connection.execute("DELETE FROM ledger_entry_groups WHERE id = ?", [groupId]);
        await f.connection.execute("DELETE FROM payment_records WHERE source_ref = ?", [payRef]);
        await f.connection.execute("DELETE FROM commerce_rule_versions WHERE rule_key = 'tax_vat' AND scope_type = 'partner' AND scope_id = ? AND change_reason = 'qa 5f'", [`org:${orgB}`]);
      };
      await clean();
      const ui = await uiActor(browser, "QA_HOST", viewport);
      const vendorB = await businessUiActor(browser, "QA_VENDOR_B", viewport);
      try {
        const { page } = ui;
        page.setDefaultTimeout(15_000);
        // Zero points: redemption explains what's missing. (QA_HOST may already have split
        // history from the 5e specs, so pending/history are checked relative to the start.)
        await page.goto("/manage");
        const panel = page.getByTestId("plan-rewards").first();
        await expect(panel.getByTestId("points-available")).toHaveText("0");
        await expect(panel.getByTestId("redeem")).toHaveAttribute("data-redemption", "not_enough");
        await expect(panel.getByText("10,000 more points needed")).toBeVisible();
        const pendingBefore = Number(((await panel.getByTestId("stat-pending").textContent()) ?? "0").replace(/\D/g, ""));
        await page.goto("/manage/rewards");
        await expect(page.getByTestId("history-empty").or(page.getByTestId("history"))).toBeVisible();
        // A paid, not-yet-settled booking shows as pending points (⌊€46 × 1⌋).
        await f.connection.execute("INSERT INTO payment_records (source_type, source_ref, provider, amount_minor, currency, status) VALUES ('experience', ?, 'stub', 4600, 'EUR', 'paid')", [payRef]);
        await f.connection.execute("INSERT INTO ledger_entry_groups (id, idempotency_key, source_type, source_id, description, basis, currency) VALUES (?, ?, 'experience', ?, 'QA 5f payment', 'actual', 'EUR')", [groupId, `payment:experience:${payRef}`, payRef]);
        await f.connection.execute("INSERT INTO ledger_entries (group_id, line_no, account_code, party_type, party_id, amount_minor, currency) VALUES (?, 1, 'stripe_clearing', NULL, NULL, 4600, 'EUR'), (?, 2, 'host_payable', 'host', ?, -4600, 'EUR')", [groupId, groupId, host]);
        // Points available for a free month, plus a split-booking share in the history.
        await f.connection.execute("INSERT INTO reward_lots (party_type, party_id, source_ref, points_earned, points_remaining, expires_at) VALUES ('host', ?, 'qa-5f', 10000, 10000, DATE_ADD(NOW(), INTERVAL 1 YEAR))", [host]);
        await f.connection.execute("INSERT INTO reward_split_awards (settlement_id, party_type, party_id, source_type, source_ref, eligible_minor, points, rate_per_euro) VALUES (0, 'host', ?, 'game', ?, 1333, 13, 1)", [host, payRef]);
        await page.goto("/manage");
        const p2 = page.getByTestId("plan-rewards").first();
        await expect(p2.getByTestId("points-available")).toHaveText("10,000");
        await expect(p2.getByTestId("stat-pending")).toHaveText((pendingBefore + 46).toLocaleString("en-IE")); // ⌊€46 × 1⌋ more pending
        await expect(p2.getByTestId("redeem")).toHaveAttribute("data-redemption", "available");
        await shot(page, `rewards-eligible-${viewport}`);
        await p2.getByRole("button", { name: /Redeem 10,000 points for a month of Pro/ }).click();
        await expect(p2.getByTestId("redeemed")).toContainText("No paid subscription was created");
        await page.reload();
        const p3 = page.getByTestId("plan-rewards").first();
        await expect(p3).toHaveAttribute("data-state", "reward_active");
        await expect(p3.getByRole("heading", { name: "Pro — reward month" })).toBeVisible();
        await shot(page, `reward-month-${viewport}`);
        await fitsViewport(page);
        // History: redemption and the host's split share, newest first.
        await page.goto("/manage/rewards");
        const table = page.getByTestId("history");
        await expect(table.locator('tr[data-kind="redemption"]').first()).toContainText("Pro redemption"); // newest first
        await expect(table.locator('tr[data-kind="host_share"]').filter({ hasText: payRef })).toContainText("Host split share");
        await shot(page, `rewards-history-${viewport}`);
        await fitsViewport(page);
        // Points debt blocks redemption, with the reason; not presented as money owed.
        await f.connection.execute("INSERT INTO reward_debts (party_type, party_id, points_owed) VALUES ('host', ?, 50) ON DUPLICATE KEY UPDATE points_owed = 50", [host]);
        await page.goto("/manage");
        const p4 = page.getByTestId("plan-rewards").first();
        await expect(p4.getByTestId("points-debt")).toContainText("50 points are being repaid");
        await expect(p4.getByTestId("redeem")).toHaveAttribute("data-redemption", "debt");
        await shot(page, `points-debt-${viewport}`);
        // Reverse-charge partner: the tax row says so and adds nothing.
        await f.connection.execute(
          "INSERT INTO commerce_rule_versions (rule_key, scope_type, scope_id, version, status, effective_from, payload, payload_hash, created_by, approved_by, published_by, published_at, change_reason) VALUES ('tax_vat', 'partner', ?, 9001, 'published', DATE_SUB(NOW(), INTERVAL 1 MINUTE), ?, SHA2(?, 256), 'qa', 'qa', 'qa', NOW(), 'qa 5f')",
          [`org:${orgB}`, JSON.stringify({ vatBps: 2300, vatMode: "reverse_charge", feeDisplay: "exclusive_of_vat" }), `rc-${tag}`]
        );
        await vendorB.page.goto("/vendor/pro");
        const price = vendorB.page.getByTestId("pro-price").first();
        await expect(price.getByText("Reverse charge — no VAT charged")).toBeVisible();
        await expect(price.getByText("€29.00").last()).toBeVisible();
        await shot(vendorB.page, `reverse-charge-${viewport}`);
        await fitsViewport(vendorB.page);
      } finally {
        await ui.close();
        await vendorB.close();
        await clean();
        await restore();
      }
    });
  });
}
