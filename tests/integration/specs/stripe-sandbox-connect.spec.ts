import { expect, personas } from "../fixtures";
import { rows, test, withActors } from "../lifecycle-fixture";
import { stripe, stripeProfile, stripeUiActor } from "../stripe-fixture";
import { deliverThin, realThinEvents, record, RUN, setSwitch, sleep, v2core } from "../stripe-sandbox-fixture";

// Revenue & Connect Stage 5e — A: connected accounts through the APP's own
// onboarding, on Stripe Accounts v2 (Express dashboard, recipient
// configuration, Stripe-hosted onboarding). Completing the hosted form needs a
// person (Stripe shows an hCaptcha challenge even in test mode), so this spec
// covers everything up to it; verified accounts for money movement are the
// labelled test doubles used by the split spec.

test("SANDBOX-CONNECT-A: Accounts v2 company vendor + individual host — creation, idempotency, concurrency, state, v2 events, hosted links", async ({ playwright, browser }) => {
  test.skip(!stripeProfile, "qa:stripe only");
  test.setTimeout(420_000);
  await withActors(playwright, ["QA_VENDOR", "QA_HOST"], async (f) => {
    const restore = await setSwitch(f, { "commerce.connect_v1": true });
    const [{ org_id: orgId }] = await rows(f, "SELECT org_id FROM users WHERE id = ?", [personas.QA_VENDOR.id]);
    const parties = [["org", orgId], ["host", personas.QA_HOST.id]] as const;
    const clean = async () => {
      for (const [t, id] of parties) {
        await f.connection.execute("DELETE FROM connected_account_syncs WHERE account_id IN (SELECT account_id FROM connected_accounts WHERE party_type = ? AND party_id = ?)", [t, id]);
        await f.connection.execute("DELETE FROM connected_accounts WHERE party_type = ? AND party_id = ?", [t, id]);
        await f.connection.execute("DELETE FROM connected_account_creations WHERE party_type = ? AND party_id = ?", [t, id]);
      }
    };
    await clean();
    try {
      await f.connection.execute("INSERT INTO trader_profiles (party_type, party_id, entity_type, legal_name, address, country, email, phone, company_number, self_certified_at) VALUES ('org', ?, 'company', 'QA Sandbox Ltd', '1 QA St, Dublin', 'IE', 'qa.vendor@example.test', '0000000000', '123456', NOW()) ON DUPLICATE KEY UPDATE entity_type = 'company'", [orgId]);

      // Company vendor: one Accounts v2 Express recipient account.
      const v1 = await f.actors.QA_VENDOR.post("/api/vendor/payout-account/onboarding", { data: { country: "IE" } });
      expect(v1.status(), "onboarding link created").toBe(200);
      const link = await v1.json();
      expect([new URL(link.url).host, link.purpose]).toEqual(["connect.stripe.com", "onboarding"]);
      expect(new Date(link.expiresAt).getTime()).toBeGreaterThan(Date.now());
      const [row] = await rows(f, "SELECT account_id AS id, api_model AS m, configuration_type AS c, dashboard_type AS d, business_type AS b, onboarding_state AS s, requirements_past_due AS pd, creation_key AS k FROM connected_accounts WHERE party_type = 'org' AND party_id = ?", [orgId]);
      const acct = await v2core().accounts.retrieve(row.id, { include: ["configuration.recipient", "requirements", "identity", "defaults"] });
      expect(acct.livemode, "test-mode account").toBe(false);
      expect([acct.dashboard, String(acct.identity?.country).toUpperCase(), acct.identity?.entity_type, acct.defaults?.responsibilities?.requirements_collector]).toEqual(["express", "IE", "company", "stripe"]);
      expect(Object.keys(acct.configuration?.recipient?.capabilities?.stripe_balance ?? {}).sort(), "only the transfers capability requested (payouts is Stripe's)").toEqual(["payouts", "stripe_transfers"]);
      expect(acct.configuration?.merchant, "no merchant configuration — HelloCircle is the merchant").toBeFalsy();
      expect([acct.defaults?.responsibilities?.fees_collector, acct.defaults?.responsibilities?.losses_collector]).toEqual(["application", "application"]);
      expect(acct.metadata).toMatchObject({ hc_qa_run: RUN, party_type: "org", party_id: orgId, hc_creation_key: row.k });
      expect([row.m, row.c, row.d, row.b, row.s]).toEqual(["v2", "recipient", "express", "company", "onboarding_incomplete"]);
      expect(JSON.parse(row.pd).length, "real requirements from Stripe").toBeGreaterThan(0);
      // Retry: the same account (and a fresh single-use link).
      const v2 = await (await f.actors.QA_VENDOR.post("/api/vendor/payout-account/onboarding", { data: { country: "IE" } })).json();
      expect(new URL(v2.url).host).toBe("connect.stripe.com");
      expect((await rows(f, "SELECT COUNT(*) AS n FROM connected_accounts WHERE party_type = 'org' AND party_id = ?", [orgId]))[0].n).toBe(1);
      // Overview: incomplete onboarding, transfers and bank payouts not yet available.
      const ov = await (await f.actors.QA_VENDOR.get("/api/vendor/payout-account")).json();
      expect([ov.state, ov.account.transfersCapability, ov.account.payoutsCapability]).toEqual(["onboarding_incomplete", "restricted", "restricted"]);
      expect(ov.readiness.join(" ")).toMatch(/can't receive transfers/);
      expect((await f.actors.QA_VENDOR.post("/api/vendor/payout-account/dashboard", { data: {} })).status(), "no dashboard before onboarding").toBe(409);

      // Individual host, three concurrent requests → one account.
      const concurrent = await Promise.all([1, 2, 3].map(() => f.actors.QA_HOST.post("/api/host/payout-account/onboarding", { data: { country: "IE" } })));
      expect(concurrent.map((r) => r.status())).toEqual([200, 200, 200]);
      const hostRows = await rows(f, "SELECT account_id AS id, business_type AS b FROM connected_accounts WHERE party_type = 'host' AND party_id = ?", [personas.QA_HOST.id]);
      expect(hostRows.length, "one account for concurrent requests").toBe(1);
      const hostAcct = await v2core().accounts.retrieve(hostRows[0].id, { include: ["identity"] });
      expect([hostAcct.livemode, hostAcct.identity?.entity_type, hostAcct.metadata?.hc_qa_run]).toEqual([false, "individual", RUN]);

      // Real v2 events for the vendor's account: signature, store once, re-fetch, sync.
      const events = await realThinEvents(row.id);
      expect(events.length, "Stripe recorded v2 events for the account").toBeGreaterThan(0);
      const ev = events[0];
      expect((await deliverThin(f.actors.QA_VENDOR, ev, row.id, { invalid: true })).status, "invalid signature").toBe(400);
      expect((await deliverThin(f.actors.QA_VENDOR, ev, row.id)).status).toBe(200);
      expect((await deliverThin(f.actors.QA_VENDOR, ev, row.id)).body.duplicate, "duplicate").toBe(true);
      const [stored] = await rows(f, "SELECT status FROM webhook_events WHERE provider = 'stripe_v2' AND event_id = ?", [ev.id]);
      expect(stored.status).toBe("processed");
      const syncs = await rows(f, "SELECT normalized_type AS t FROM connected_account_syncs WHERE provider_event_id = ?", [ev.id]);
      expect(syncs.map((s: any) => s.t)).toEqual(["connect.account.changed"]);

      // Hosted links in the browser: refresh mints a new link; return re-syncs.
      const ui = await stripeUiActor(browser, "QA_HOST", "desktop");
      try {
        const minted = ui.page.waitForResponse((r) => r.url().endsWith("/api/host/payout-account/onboarding") && r.request().method() === "POST");
        await ui.page.goto("/manage?tab=earnings&payouts=refresh");
        expect((await minted).status(), "refresh → new onboarding link").toBe(200);
        // Only the navigation to Stripe matters; its page load waits on third-party scripts the harness blocks.
        await ui.page.waitForURL(/connect\.stripe\.com/, { timeout: 30_000, waitUntil: "commit" });
        const page2 = await ui.context.newPage();
        const returned = page2.waitForResponse((r) => r.url().endsWith("/api/host/payout-account/refresh"));
        await page2.goto("/manage?tab=earnings&payouts=return");
        expect((await returned).status()).toBe(200);
        await expect(page2.getByTestId("payout-state")).toHaveAttribute("data-state", "onboarding_incomplete");
      } finally {
        await ui.close();
      }
      await sleep(500);
      const ret = await rows(f, "SELECT normalized_type AS t, source FROM connected_account_syncs WHERE account_id = ? AND source = 'return'", [hostRows[0].id]);
      expect(ret.length, "return re-synced from Stripe").toBeGreaterThan(0);
      await record("connect-a", {
        vendorAccount: row.id, hostAccount: hostRows[0].id, apiModel: "v2", dashboard: acct.dashboard, configuration: "recipient", entityTypes: ["company", "individual"],
        vendorState: ov.state, pastDueCount: JSON.parse(row.pd).length, concurrentRequests: 3, accountsCreatedForHost: hostRows.length, v2EventDelivered: ev.id, v2EventType: ev.type,
        hostedLinkHost: "connect.stripe.com", hostedOnboardingCompletion: "not automatable: Stripe shows an hCaptcha challenge in test mode",
      }, "stage5e");
    } finally {
      await clean();
      await f.connection.execute("DELETE FROM trader_profiles WHERE party_type = 'org' AND party_id = ? AND legal_name = 'QA Sandbox Ltd'", [orgId]);
      await restore();
    }
  });
});
