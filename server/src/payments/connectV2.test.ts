import crypto from "node:crypto";
import http, { type Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, setSetting } from "../db/index.js";
import { deriveOnboardingState, getConnectedAccount, normalizeConnectEvent, processConnectEvent, startOnboarding, syncConnectedAccount } from "./connect.js";
import { accountStatusFromV2, CONNECT_V1_COMPAT, stubProvider } from "./provider.js";

// Revenue & Connect Stage 5e — Accounts v2: state model, idempotent creation
// (retry, timeout after acceptance, concurrency), sync that never downgrades,
// normalized events, v2 thin-event webhook, payout ordering.

const run = crypto.randomUUID().slice(0, 8);
const hosts = [1, 2, 3, 4].map((i) => `c5e-host-${run}-${i}`);
const SECRET = `whsec_test_${run}`;
let server: Server;
let baseUrl: string;

beforeAll(async () => {
  process.env.QA_E2E_ENABLED = "true";
  process.env.QA_PAYMENT_PROVIDER_STUB = "1";
  process.env.STRIPE_V2_WEBHOOK_SECRET = SECRET;
  await setSetting("commerce.connect_v1", "true");
  for (const h of hosts) await db.prepare(`INSERT INTO residents (id, email, name) VALUES (?, ?, 'Host')`).run(h, `${h}@example.test`);
  // stripe.ts reads the secret at import, so the route module is loaded after setting it.
  const { stripeThinWebhookHandler } = await import("../routes/stripeWebhook.js");
  const app = express();
  app.post("/v2", express.raw({ type: "application/json" }), stripeThinWebhookHandler);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("bind");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await setSetting("commerce.connect_v1", "false");
  for (const h of hosts) {
    const a = (await db.prepare(`SELECT account_id as id FROM connected_accounts WHERE party_id = ?`).get(h)) as { id: string } | undefined;
    if (a) {
      await db.prepare(`DELETE FROM connected_account_syncs WHERE account_id = ?`).run(a.id);
      await db.prepare(`DELETE FROM connected_payouts WHERE account_id = ?`).run(a.id);
    }
    await db.prepare(`DELETE FROM connected_accounts WHERE party_id = ?`).run(h);
    await db.prepare(`DELETE FROM connected_account_creations WHERE party_id = ?`).run(h);
    await db.prepare(`DELETE FROM audit_log WHERE object_id = ?`).run(h);
    await db.prepare(`DELETE FROM residents WHERE id = ?`).run(h);
  }
  await db.prepare(`DELETE FROM webhook_events WHERE event_id LIKE ?`).run(`evt_c5e_${run}%`);
  delete process.env.QA_E2E_ENABLED;
  delete process.env.QA_PAYMENT_PROVIDER_STUB;
  delete process.env.STRIPE_V2_WEBHOOK_SECRET;
});

const onboard = (h: string) => startOnboarding({ partyType: "host", partyId: h }, { email: `${h}@example.test`, country: "IE", returnPath: "/manage?tab=earnings", actorId: h });
const base = { transfersCapability: "active", payoutsCapability: "active", requirementsDue: [] as string[], requirementsPastDue: [] as string[], requirementsPending: [] as string[], disabledReason: null as string | null };

describe("state model", () => {
  it("maps Stripe's state to the seven partner-facing states", () => {
    expect(deriveOnboardingState(base, true)).toBe("enabled");
    expect(deriveOnboardingState({ ...base, transfersCapability: "restricted", payoutsCapability: "restricted", requirementsPastDue: ["external_account"], disabledReason: "requirements_past_due" }, false)).toBe("onboarding_incomplete");
    expect(deriveOnboardingState({ ...base, requirementsDue: ["identity.individual.verification.document"] }, true)).toBe("more_information_required");
    expect(deriveOnboardingState({ ...base, transfersCapability: "pending", payoutsCapability: "pending", requirementsPending: ["identity.individual.verification.document"] }, true)).toBe("under_review");
    expect(deriveOnboardingState({ ...base, transfersCapability: "restricted", payoutsCapability: "restricted", disabledReason: "restricted_other" }, true)).toBe("transfers_unavailable");
    expect(deriveOnboardingState({ ...base, payoutsCapability: "restricted", disabledReason: "requirements_past_due" }, true)).toBe("payouts_unavailable");
  });

  it("reads an Accounts v2 recipient account (shape observed in the IE sandbox)", () => {
    const st = accountStatusFromV2({
      id: "acct_x", dashboard: "express", applied_configurations: ["recipient"], identity: { country: "ie", entity_type: "company" },
      configuration: { recipient: { capabilities: { stripe_balance: { stripe_transfers: { status: "restricted", status_details: [{ code: "requirements_past_due", resolution: "provide_info" }] }, payouts: { status: "restricted", status_details: [{ code: "requirements_past_due" }] } } } } },
      requirements: { entries: [
        { description: "external_account", awaiting_action_from: "user", minimum_deadline: { status: "past_due" } },
        { description: "identity.business_details.registered_name", awaiting_action_from: "user", minimum_deadline: { status: "currently_due" } },
        { description: "identity.individual.verification.document", awaiting_action_from: "stripe", minimum_deadline: { status: "currently_due" } },
        { description: "defaults.profile.product_description", awaiting_action_from: "user", minimum_deadline: { status: "eventually_due" } },
      ] },
    });
    expect(st).toMatchObject({
      apiModel: "v2", country: "IE", configurationType: "recipient", dashboardType: "express", businessType: "company",
      transfersCapability: "restricted", payoutsCapability: "restricted", chargesCapability: "not_requested", chargesEnabled: false, payoutsEnabled: false,
      requirementsPastDue: ["external_account"], requirementsDue: ["identity.business_details.registered_name"], requirementsPending: ["identity.individual.verification.document"],
      disabledReason: "requirements_past_due", detailsSubmitted: false,
    });
  });

  it("names every Accounts v1 compatibility endpoint with a reason, a doc and a removal test", () => {
    for (const c of CONNECT_V1_COMPAT) expect(c.reason.length && c.doc.startsWith("https://docs.stripe.com/") && c.detect.length).toBeTruthy();
  });

  it("normalizes v1 and v2 provider event names", () => {
    expect(normalizeConnectEvent("account.updated")).toBe("connect.account.changed");
    expect(normalizeConnectEvent("v2.core.account[requirements].updated")).toBe("connect.account.changed");
    expect(normalizeConnectEvent("v2.core.account[configuration.recipient].capability_status_updated")).toBe("connect.account.changed");
    expect(normalizeConnectEvent("v2.core.account_link.returned")).toBe("connect.onboarding.returned");
    expect(normalizeConnectEvent("payout.paid")).toBe("connect.bank_payout.changed");
    expect(normalizeConnectEvent("transfer.reversed")).toBe("connect.transfer.reversed_externally");
    expect(normalizeConnectEvent("v2.core.account_person.created")).toBe("connect.ignored");
  });
});

describe("idempotent creation", () => {
  it("creates an Accounts v2 Express recipient account once; retries reuse it", async () => {
    const a = await onboard(hosts[0]);
    const b = await onboard(hosts[0]);
    expect(a.url).toMatch(/connect\.stub\.invalid\/onboarding\/acct_stub_/);
    expect(a.expiresAt).toBeTruthy();
    expect(b.url).toBe(a.url);
    const row = (await getConnectedAccount({ partyType: "host", partyId: hosts[0] }))!;
    expect([row.apiModel, row.configurationType, row.dashboardType, row.businessType, row.onboardingState]).toEqual(["v2", "recipient", "express", "individual", "onboarding_incomplete"]);
    expect(stubProvider.calls.filter((c) => c.method === "createConnectedAccount" && String((c.args as any).idempotencyKey).startsWith(`hc-acct-v2:host:${hosts[0]}:`))).toHaveLength(1);
  });

  it("a timeout after Stripe accepted the request doesn't create a second account", async () => {
    stubProvider.timeoutAfterNextCreate = true;
    await expect(onboard(hosts[1])).rejects.toMatchObject({ status: 502 });
    const res = (await db.prepare(`SELECT status, attempts FROM connected_account_creations WHERE party_id = ?`).get(hosts[1])) as { status: string; attempts: number };
    expect([res.status, Number(res.attempts)]).toEqual(["pending", 1]);
    await onboard(hosts[1]);
    const calls = stubProvider.calls.filter((c) => c.method === "createConnectedAccount" && String((c.args as any).idempotencyKey).startsWith(`hc-acct-v2:host:${hosts[1]}:`));
    expect(calls).toHaveLength(2);
    expect((calls[1].args as any).idempotencyKey).toBe((calls[0].args as any).idempotencyKey); // the retry reused the same key…
    const n = (await db.prepare(`SELECT COUNT(*) as n FROM connected_accounts WHERE party_id = ?`).get(hosts[1])) as { n: number };
    expect(Number(n.n)).toBe(1); // …so the provider returned the same account
  });

  it("concurrent requests for the same partner create one account", async () => {
    const results = await Promise.all([onboard(hosts[2]), onboard(hosts[2]), onboard(hosts[2])]);
    expect(new Set(results.map((r) => r.url)).size).toBe(1);
    const n = (await db.prepare(`SELECT COUNT(*) as n FROM connected_accounts WHERE party_id = ?`).get(hosts[2])) as { n: number };
    expect(Number(n.n)).toBe(1);
  });

  it("asks an onboarded partner for more information with an update link", async () => {
    const row = (await getConnectedAccount({ partyType: "host", partyId: hosts[0] }))!;
    stubProvider.setAccount(row.accountId, { ...base, requirementsDue: [], requirementsPastDue: [] });
    await syncConnectedAccount(row.accountId, { source: "api" });
    expect((await getConnectedAccount({ partyType: "host", partyId: hosts[0] }))!.onboardingState).toBe("enabled");
    stubProvider.setAccount(row.accountId, { requirementsDue: ["identity.individual.verification.document"] });
    await syncConnectedAccount(row.accountId, { source: "api" });
    expect((await getConnectedAccount({ partyType: "host", partyId: hosts[0] }))!.onboardingState).toBe("more_information_required");
    const link = await onboard(hosts[0]);
    expect([link.purpose, link.url]).toEqual(["update", expect.stringContaining("/update/")]);
  });
});

describe("sync never downgrades", () => {
  it("an older fetch can't overwrite a newer one, and an old event only triggers a fresh fetch", async () => {
    const row = (await getConnectedAccount({ partyType: "host", partyId: hosts[2] }))!;
    stubProvider.setAccount(row.accountId, { ...base });
    await syncConnectedAccount(row.accountId, { source: "api" });
    // A newer sync already landed (simulated): this slower one must not apply.
    await db.prepare(`UPDATE connected_accounts SET last_synced_at = DATE_ADD(NOW(3), INTERVAL 1 HOUR) WHERE account_id = ?`).run(row.accountId);
    stubProvider.setAccount(row.accountId, { transfersCapability: "restricted", payoutsCapability: "restricted", requirementsPastDue: ["x"] });
    expect((await syncConnectedAccount(row.accountId, { source: "api" })).applied).toBe(false);
    expect((await getConnectedAccount({ partyType: "host", partyId: hosts[2] }))!.onboardingState).toBe("enabled");
    await db.prepare(`UPDATE connected_accounts SET last_synced_at = NULL WHERE account_id = ?`).run(row.accountId);
    // An old account.updated whose payload says "enabled" arrives late — the
    // current state (restricted) is fetched instead of trusting the payload.
    await processConnectEvent({ id: `evt_c5e_${run}_old`, type: "account.updated", created: 1, livemode: false, account: row.accountId, data: { object: { id: row.accountId, capabilities: { transfers: "active" }, payouts_enabled: true } } });
    expect((await getConnectedAccount({ partyType: "host", partyId: hosts[2] }))!.onboardingState).toBe("more_information_required");
    const syncs = (await db.prepare(`SELECT applied FROM connected_account_syncs WHERE account_id = ? ORDER BY id`).all(row.accountId)) as { applied: number }[];
    expect(syncs.some((s) => Number(s.applied) === 0)).toBe(true);
  });

  it("a bank payout never moves backwards when an older event arrives later", async () => {
    const row = (await getConnectedAccount({ partyType: "host", partyId: hosts[2] }))!;
    const po = (status: string, n: number) => processConnectEvent({ id: `evt_c5e_${run}_po${n}`, type: `payout.${status === "pending" ? "created" : status}`, created: n, livemode: false, account: row.accountId, data: { object: { id: `po_c5e_${run}`, amount: 1200, currency: "eur", status } } });
    await po("pending", 1);
    await po("paid", 3);
    await po("pending", 2); // late
    const p = (await db.prepare(`SELECT status FROM connected_payouts WHERE provider_payout_id = ?`).get(`po_c5e_${run}`)) as { status: string };
    expect(p.status).toBe("paid");
    await po("failed", 4); // paid → failed is a real transition
    expect(((await db.prepare(`SELECT status FROM connected_payouts WHERE provider_payout_id = ?`).get(`po_c5e_${run}`)) as { status: string }).status).toBe("failed");
  });
});

describe("v2 thin-event webhook", () => {
  const post = (body: unknown, sig: string | null) =>
    fetch(`${baseUrl}/v2`, { method: "POST", headers: { "Content-Type": "application/json", ...(sig ? { "Stripe-Signature": sig } : {}) }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, text: await r.text() }));

  it("verifies the signature, stores once, re-fetches the event and the account", async () => {
    await onboard(hosts[3]);
    const row = (await getConnectedAccount({ partyType: "host", partyId: hosts[3] }))!;
    const ev = { id: `evt_c5e_${run}_thin1`, type: "v2.core.account[requirements].updated", related_object: { id: row.accountId, type: "v2.core.account" }, created: new Date().toISOString() };
    expect((await post(ev, null)).status).toBe(400);
    expect((await post(ev, "stub=wrong")).status).toBe(400);
    expect(await db.prepare(`SELECT 1 FROM webhook_events WHERE event_id = ?`).get(ev.id)).toBeUndefined();
    // Not retrievable from the provider → parked (never processed from the notification alone).
    const parked = await post(ev, `stub=${SECRET}`);
    expect(parked.status).toBe(200);
    expect(((await db.prepare(`SELECT status FROM webhook_events WHERE event_id = ?`).get(ev.id)) as { status: string }).status).toBe("manual_review");
    // A retrievable event is processed: the account is synced from the provider.
    stubProvider.setAccount(row.accountId, { ...base });
    const ev2 = { ...ev, id: `evt_c5e_${run}_thin2` };
    stubProvider.publishThinEvent({ id: ev2.id, type: ev2.type, relatedObjectId: row.accountId, created: ev2.created });
    expect((await post(ev2, `stub=${SECRET}`)).status).toBe(200);
    expect(((await db.prepare(`SELECT status FROM webhook_events WHERE event_id = ?`).get(ev2.id)) as { status: string }).status).toBe("processed");
    expect((await getConnectedAccount({ partyType: "host", partyId: hosts[3] }))!.onboardingState).toBe("enabled");
    const dup = await post(ev2, `stub=${SECRET}`);
    expect(JSON.parse(dup.text)).toMatchObject({ duplicate: true });
    const syncs = (await db.prepare(`SELECT normalized_type as t, provider_event_id as e FROM connected_account_syncs WHERE account_id = ? AND provider_event_id = ?`).all(row.accountId, ev2.id)) as { t: string }[];
    expect(syncs).toHaveLength(1);
    expect(syncs[0].t).toBe("connect.account.changed");
  });
});
