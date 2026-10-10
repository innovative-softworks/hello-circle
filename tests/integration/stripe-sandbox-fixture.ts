import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type Stripe from "stripe";
import type { APIRequestContext, Browser, PlaywrightWorkerArgs } from "@playwright/test";
import { expect, env } from "./fixtures";
import { rows } from "./lifecycle-fixture";
import type { Scope } from "./stage-b-fixture";
import { bookableExperience, experienceBody, guest } from "./booking-fixture";
import { payOnHostedCheckout, sessionFor, stripe, stripeUiActor } from "./stripe-fixture";
import { connectedPreflight } from "./runtime";

// Revenue & Connect Stage 5d — shared helpers for the Stripe sandbox suite.
// Every Stripe object created here carries hc_qa_run = this run's tag;
// objects are only ever read, updated or used by id after we created them.
// Evidence records object ids and expected-vs-actual amounts — never keys,
// secrets, card data or personal values.

export const RUN = process.env.HC_QA_STRIPE_RUN ?? "";
export const tagged = (extra: Record<string, string> = {}) => ({ hc_qa_run: RUN, ...extra });
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function assertSandbox(o: { livemode?: boolean | null } | null | undefined, what: string) {
  expect(o?.livemode, `${what} is a test-mode object`).toBe(false);
}

/** Appends safe facts to this run's evidence file (object ids, amounts, statuses). */
export async function record(section: string, facts: Record<string, unknown>, stage: "stage5d" | "stage5e" = "stage5d") {
  if (!/^[a-z0-9-]+$/.test(section)) throw new Error("bad section");
  const checked = await connectedPreflight();
  await checked.connection.end();
  const dir = path.join(checked.manifest.dataDir, "evidence");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, `${stage}-${RUN}.json`);
  const all = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
  const text = JSON.stringify(facts);
  if (/(sk|rk)_(test|live)_|whsec_/.test(text)) throw new Error("QA SAFETY ABORT: secret-looking value in evidence");
  all[section] = [...(all[section] ?? []), { at: new Date().toISOString(), ...facts }];
  writeFileSync(file, JSON.stringify(all, null, 2), { mode: 0o600 });
}

/** Every ledger group nets to zero (the whole QA database, not just this test). */
export async function ledgerBalanced(f: Scope) {
  const bad = await rows(f, "SELECT group_id, SUM(amount_minor) AS s FROM ledger_entries GROUP BY group_id HAVING SUM(amount_minor) <> 0", []);
  expect(bad, "every ledger group balances").toEqual([]);
}

export async function setSwitch(f: Scope, values: Record<string, boolean>) {
  const keys = Object.keys(values);
  const before = await rows(f, `SELECT \`key\`, value FROM app_settings WHERE \`key\` IN (${keys.map(() => "?").join(",")})`, keys);
  for (const [k, v] of Object.entries(values)) await f.connection.execute("INSERT INTO app_settings (`key`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)", [k, v ? "true" : "false"]);
  await sleep(5_500); // backend settings cache
  return async () => {
    for (const k of keys) {
      const p = before.find((b: any) => b.key === k);
      if (p) await f.connection.execute("UPDATE app_settings SET value = ? WHERE `key` = ?", [p.value, k]);
      else await f.connection.execute("DELETE FROM app_settings WHERE `key` = ?", [k]);
    }
  };
}

/** Delivers a REAL Stripe event (its real id, type and object), re-signed with the run's local secret. */
export async function deliverReal(actor: APIRequestContext, event: Stripe.Event, opts: { connect?: boolean; invalid?: boolean } = {}) {
  assertSandbox(event, `event ${event.type}`);
  const payload = JSON.stringify(event);
  const secret = opts.invalid ? `whsec_qa_${"0".repeat(64)}` : opts.connect ? process.env.STRIPE_CONNECT_WEBHOOK_SECRET! : process.env.STRIPE_WEBHOOK_SECRET!;
  const header = stripe.webhooks.generateTestHeaderString({ payload, secret });
  const res = await actor.post("/api/stripe/webhook", { headers: { "Content-Type": "application/json", "Stripe-Signature": header }, data: Buffer.from(payload) });
  return { status: res.status(), body: await res.json().catch(() => ({})) as Record<string, unknown> };
}

/** The real provider events for one object (newest first), e.g. a dispute or a subscription. */
export async function realEvents(objectId: string, types: string[], sinceSec: number, tries = 20): Promise<Stripe.Event[]> {
  for (let i = 0; i < tries; i++) {
    const list = await stripe.events.list({ types, created: { gte: sinceSec - 5 }, limit: 100 });
    const mine = list.data.filter((e) => (e.data.object as { id?: string }).id === objectId);
    if (mine.length) return mine;
    await sleep(2_000);
  }
  return [];
}

/** Pays a hosted Checkout URL with a Stripe test card and returns the paid session. */
export async function payHosted(browser: Browser, url: string, sessionId: string, card = "4000000000000077") {
  const ui = await stripeUiActor(browser, null, "desktop");
  try {
    await ui.page.goto(url);
    await payOnHostedCheckout(ui.page, card);
    await ui.page.waitForURL((u) => u.origin === env.E2E_BASE_URL, { timeout: 90_000 });
    let s = await sessionFor(sessionId);
    for (let i = 0; i < 30 && s.payment_status !== "paid"; i++) {
      await sleep(1_000);
      s = await sessionFor(sessionId);
    }
    expect(s.payment_status, "provider reports paid").toBe("paid");
    return s;
  } finally {
    await ui.close();
  }
}

/** A guest books a paid online experience of QA_VENDOR, pays on hosted Checkout, and the
 * signed completion event is delivered. Returns the local ref and the provider ids/amounts. */
export async function paidExperienceBooking(playwright: PlaywrightWorkerArgs["playwright"], browser: Browser, f: Scope, opened: APIRequestContext[], opts: { priceCents?: number; card?: string } = {}) {
  const exp = await bookableExperience(f, { price: opts.priceCents ?? 4000, capacity: 10, payment: "online" });
  const g = await guest(playwright, opened);
  const res = await g.ctx.post(`/api/experiences/${exp.id}/sessions/${exp.session}/checkout`, { data: experienceBody(g.email) });
  expect(res.status(), "checkout created").toBe(201);
  const { ref, url } = await res.json();
  const [row] = await rows(f, "SELECT stripe_session_id AS sid, total_cents AS total FROM experience_bookings WHERE ref = ?", [ref]);
  const session = await payHosted(browser, url, row.sid, opts.card);
  assertSandbox(session, "checkout session");
  const pi = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id ?? "";
  return { exp, ref, sessionId: row.sid as string, session, paymentIntentId: pi, localTotal: Number(row.total), guest: g };
}

/** Moves a booked experience session into the past so completion + 48 h has passed. */
export async function ageSession(f: Scope, sessionId: string, daysAgo = 5) {
  await f.connection.execute("UPDATE experience_sessions SET date = DATE_SUB(CURDATE(), INTERVAL ? DAY) WHERE id = ?", [daysAgo, sessionId]);
}

export const runKey = (label: string) => `qa5d-${label}-${randomUUID().slice(0, 6)}`;

// --- Stage 5e: Accounts v2 test doubles, v2 events, split bookings ----------------------

export const v2core = () => (stripe as unknown as { v2: { core: { accounts: any; accountLinks: any; events: any } } }).v2.core;
const IE_ADDRESS = { line1: "address_full_match", city: "Dublin", state: "Co. Dublin", postal_code: "D02 X285", country: "ie" };
export const IBAN = { ok: "IE29AIBK93115212345678", closed: "IE89370400440532013002" };

/**
 * A *verified* Accounts v2 recipient for money-movement tests. Express
 * onboarding can't be completed by automation (Stripe's hosted page shows an
 * hCaptcha challenge even in test mode), so this double differs from the
 * app's accounts in exactly two settings — dashboard "none" and
 * requirements collected by the platform — which let the harness accept the
 * test ToS and supply Stripe's documented test identity. Transfers,
 * reversals and bank payouts behave the same. Labelled stage5e-test-double.
 */
export async function createVerifiedRecipient(entity: "company" | "individual", label: string, iban = IBAN.ok): Promise<string> {
  const now = new Date().toISOString();
  const a = await v2core().accounts.create({
    contact_email: `qa.${label}.${RUN}@example.test`, display_name: `QA ${label} ${RUN.slice(-6)}`, dashboard: "none",
    identity: entity === "company"
      ? { country: "ie", entity_type: "company", attestations: { terms_of_service: { account: { date: now, ip: "127.0.0.1" } }, persons_provided: { owners: true, directors: true, executives: true } },
          business_details: { registered_name: `QA ${label} Ltd`, phone: "+35310000000", address: IE_ADDRESS, id_numbers: [{ type: "ie_crn", value: "123456" }] } }
      : { country: "ie", entity_type: "individual", attestations: { terms_of_service: { account: { date: now, ip: "127.0.0.1" } } },
          individual: { given_name: "Jenny", surname: "Rosen", email: `qa.${label}.${RUN}@example.test`, date_of_birth: { day: 1, month: 1, year: 1901 }, address: IE_ADDRESS } },
    configuration: { recipient: { capabilities: { stripe_balance: { stripe_transfers: { requested: true } } } } },
    defaults: { currency: "eur", profile: { business_url: "https://hellocircle.ie", product_description: "Community activities" }, responsibilities: { fees_collector: "application", losses_collector: "application" } },
    metadata: tagged({ purpose: "stage5e-test-double", label }),
  }, { idempotencyKey: `qa5e:${RUN}:${label}` });
  expect(a.livemode, "test-mode account").toBe(false);
  if (entity === "company") {
    await v2core().accounts.persons.create(a.id, {
      given_name: "Jenny", surname: "Rosen", email: `qa.rep.${label}.${RUN}@example.test`, phone: "+35310000000", date_of_birth: { day: 1, month: 1, year: 1901 }, address: IE_ADDRESS,
      relationship: { representative: true, owner: true, director: true, executive: true, percent_ownership: "100", title: "Director" }, metadata: tagged(),
    });
  }
  // Accounts v1 compatibility (CONNECT_V1_COMPAT): bank account + manual payout schedule, harness only.
  await stripe.accounts.createExternalAccount(a.id, { external_account: { object: "bank_account", country: "IE", currency: "eur", account_number: iban } as any, metadata: tagged() });
  await stripe.accounts.update(a.id, { settings: { payouts: { schedule: { interval: "manual" } } } });
  for (let i = 0; i < 20; i++) {
    const x = await v2core().accounts.retrieve(a.id, { include: ["configuration.recipient"] });
    if (x.configuration?.recipient?.capabilities?.stripe_balance?.stripe_transfers?.status === "active") return a.id as string;
    await sleep(2_000);
  }
  throw new Error(`test double ${label} never became able to receive transfers`);
}

/** Links a test double to a QA partner in the disposable database (as a completed creation). */
export async function attachAccount(f: Scope, party: { partyType: string; partyId: string }, accountId: string, businessType: "company" | "individual") {
  await f.connection.execute("DELETE FROM connected_accounts WHERE party_type = ? AND party_id = ?", [party.partyType, party.partyId]);
  await f.connection.execute("DELETE FROM connected_account_creations WHERE party_type = ? AND party_id = ?", [party.partyType, party.partyId]);
  const key = `qa-double:${RUN}:${party.partyType}:${party.partyId}`;
  await f.connection.execute("INSERT INTO connected_account_creations (party_type, party_id, idempotency_key, api_model, status, account_id, attempts) VALUES (?, ?, ?, 'v2', 'created', ?, 1)", [party.partyType, party.partyId, key, accountId]);
  await f.connection.execute("INSERT INTO connected_accounts (party_type, party_id, provider, account_id, country, api_model, business_type, creation_key, onboarding_state, onboarding_completed_at) VALUES (?, ?, 'stripe', ?, 'IE', 'v2', ?, ?, 'onboarding_incomplete', NOW())", [party.partyType, party.partyId, accountId, businessType, key]);
}

/** Real v2 events Stripe recorded for an object (newest first). */
export async function realThinEvents(objectId: string, types: string[] = [], tries = 15): Promise<{ id: string; type: string; created: string }[]> {
  for (let i = 0; i < tries; i++) {
    const list = await v2core().events.list({ object_id: objectId, limit: 50 });
    const mine = (list.data as any[]).filter((e) => !types.length || types.includes(e.type));
    if (mine.length) return mine.map((e) => ({ id: e.id, type: e.type, created: e.created }));
    await sleep(2_000);
  }
  return [];
}

/** Delivers a v2 event notification for a REAL v2 event id, signed with the run's secret (the app re-fetches it). */
export async function deliverThin(actor: APIRequestContext, e: { id: string; type: string; created: string }, relatedId: string, opts: { invalid?: boolean } = {}) {
  const payload = JSON.stringify({ id: e.id, object: "v2.core.event", type: e.type, created: e.created, livemode: false, related_object: { id: relatedId, type: "v2.core.account", url: `/v2/core/accounts/${relatedId}` } });
  const secret = opts.invalid ? `whsec_qa_${"0".repeat(64)}` : process.env.STRIPE_V2_WEBHOOK_SECRET!;
  const header = stripe.webhooks.generateTestHeaderString({ payload, secret });
  const res = await actor.post("/api/stripe/webhook/v2", { headers: { "Content-Type": "application/json", "Stripe-Signature": header }, data: Buffer.from(payload) });
  return { status: res.status(), body: (await res.json().catch(() => ({}))) as Record<string, unknown> };
}
