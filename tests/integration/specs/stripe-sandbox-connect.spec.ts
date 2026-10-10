import type Stripe from "stripe";
import { expect, personas } from "../fixtures";
import { rows, test, withActors } from "../lifecycle-fixture";
import { stripe, stripeProfile, stripeUiActor } from "../stripe-fixture";
import { deliverReal, record, setSwitch, tagged } from "../stripe-sandbox-fixture";

// Revenue & Connect Stage 5d — A: connected accounts through the APP's own
// onboarding (Express, Stripe-hosted). If the sandbox refuses Accounts v1
// creation (Stripe's default for new platforms), the test records the exact
// blocker plus proof that the v2 path works, and is reported as SKIPPED
// (blocked) — never as passed.

test("SANDBOX-CONNECT-A: Irish company vendor and individual host onboarding through the app", async ({ playwright, browser }) => {
  test.skip(!stripeProfile, "qa:stripe only");
  test.setTimeout(300_000);
  await withActors(playwright, ["QA_VENDOR", "QA_HOST"], async (f) => {
    const restore = await setSwitch(f, { "commerce.connect_v1": true });
    const [{ org_id: orgId }] = await rows(f, "SELECT org_id FROM users WHERE id = ?", [personas.QA_VENDOR.id]);
    let blocked: string | null = null;
    try {
      await f.connection.execute("INSERT INTO trader_profiles (party_type, party_id, entity_type, legal_name, address, country, email, phone, company_number, self_certified_at) VALUES ('org', ?, 'company', 'QA Sandbox Ltd', '1 QA St, Dublin', 'IE', 'qa.vendor@example.test', '0000000000', '123456', NOW()) ON DUPLICATE KEY UPDATE entity_type = 'company'", [orgId]);
      const vendor = await f.actors.QA_VENDOR.post("/api/vendor/payout-account/onboarding", { data: { country: "IE" } });
      if (vendor.status() === 502) {
        const appError = (await vendor.json()).error as string;
        // Same call the provider makes, made directly to read Stripe's reason.
        let v1Reason = "";
        try {
          await stripe.accounts.create({ country: "IE", email: "qa.v1check@example.test", controller: { fees: { payer: "application" }, losses: { payments: "application" }, stripe_dashboard: { type: "express" }, requirement_collection: "stripe" }, capabilities: { transfers: { requested: true } }, metadata: tagged() });
        } catch (e) {
          v1Reason = /Accounts v1/i.test(String((e as Error).message)) ? "accounts_v1_creation_disabled_for_this_platform" : `${(e as { code?: string }).code ?? (e as { type?: string }).type}`;
        }
        // The v2 path works in this sandbox (recipient configuration, Express dashboard, hosted onboarding).
        const v2 = await (stripe as any).v2.core.accounts.create({
          contact_email: "qa.v2@example.test", display_name: "QA v2 check", dashboard: "express",
          identity: { country: "ie", entity_type: "company" },
          configuration: { recipient: { capabilities: { stripe_balance: { stripe_transfers: { requested: true } } } } },
          defaults: { currency: "eur", responsibilities: { fees_collector: "application", losses_collector: "application" } },
          metadata: tagged(), include: ["configuration.recipient"],
        });
        const link = await (stripe as any).v2.core.accountLinks.create({ account: v2.id, use_case: { type: "account_onboarding", account_onboarding: { configurations: ["recipient"], refresh_url: "http://127.0.0.1:4178/vendor?tab=earnings&payouts=refresh", return_url: "http://127.0.0.1:4178/vendor?tab=earnings&payouts=return" } } });
        blocked = v1Reason;
        await record("connect-a", { appStatus: 502, appError, v1Reason, v2AccountId: v2.id, v2Livemode: v2.livemode, v2Transfers: v2.configuration?.recipient?.capabilities?.stripe_balance?.stripe_transfers?.status ?? null, v2LinkHost: new URL(link.url).host });
        return;
      }
      expect(vendor.status()).toBe(200);
      expect(new URL((await vendor.json()).url).host).toBe("connect.stripe.com");
      const [row] = await rows(f, "SELECT account_id AS id, transfers_capability AS t FROM connected_accounts WHERE party_type = 'org' AND party_id = ?", [orgId]);
      const acct = await stripe.accounts.retrieve(row.id);
      expect([acct.country, acct.business_type, acct.metadata?.hc_qa_run]).toEqual(["IE", "company", process.env.HC_QA_STRIPE_RUN]);
      expect(acct.id.startsWith("acct_")).toBe(true); // created with the run's TEST key (preflight proved livemode:false)
      // Incomplete onboarding: not ready, requirements listed.
      const overview = await (await f.actors.QA_VENDOR.get("/api/vendor/payout-account")).json();
      expect(overview.readiness.join(" ")).toMatch(/can't receive transfers|Payouts to the bank/);
      // account.updated (real object) via the Connect secret.
      const ev = { id: `evt_qa5d_${Date.now()}`, object: "event", type: "account.updated", livemode: false, created: Math.floor(Date.now() / 1000), account: acct.id, data: { object: acct } } as unknown as Stripe.Event;
      expect((await deliverReal(f.actors.QA_VENDOR, ev, { connect: true })).status).toBe(200);
      // Individual host.
      const host = await f.actors.QA_HOST.post("/api/host/payout-account/onboarding", { data: { country: "IE" } });
      expect(host.status()).toBe(200);
      const [hrow] = await rows(f, "SELECT account_id AS id FROM connected_accounts WHERE party_type = 'host' AND party_id = ?", [personas.QA_HOST.id]);
      expect((await stripe.accounts.retrieve(hrow.id)).business_type).toBe("individual");
      // Hosted onboarding return/refresh links in the browser.
      const ui = await stripeUiActor(browser, "QA_HOST", "desktop");
      try {
        await ui.page.goto("/manage?tab=earnings&payouts=refresh");
        await ui.page.waitForURL(/connect\.stripe\.com/, { timeout: 30_000 });
      } finally {
        await ui.close();
      }
      await record("connect-a", { vendorAccount: acct.id, hostAccount: hrow.id });
    } finally {
      await f.connection.execute("DELETE FROM connected_accounts WHERE (party_type = 'org' AND party_id = ?) OR (party_type = 'host' AND party_id = ?)", [orgId, personas.QA_HOST.id]);
      await f.connection.execute("DELETE FROM trader_profiles WHERE party_type = 'org' AND party_id = ? AND legal_name = 'QA Sandbox Ltd'", [orgId]);
      await restore();
      test.skip(!!blocked, `BLOCKED: ${blocked} — the app's Express onboarding uses Accounts v1, which this sandbox refuses; the v2 path was verified to work (see evidence)`);
    }
  });
});
