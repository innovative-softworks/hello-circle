import crypto from "node:crypto";
import http, { type Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db, setSetting } from "../db/index.js";
import { experiencesRouter } from "../routes/experiences.js";
import { vendorExperiencesRouter } from "../routes/vendorExperiences.js";
import { computePricing } from "../pricing.js";
import { pricingLineItems } from "../checkoutService.js";
import { stubProvider } from "../payments/provider.js";
import { beginEvent, failEvent, finishEvent } from "../payments/webhookEvents.js";
import { processStripeEvent } from "../routes/stripeWebhook.js";
import { NeedsReviewError, recordProviderRefunds } from "../commerce/payments.js";
import { ledgerIsBalanced } from "../commerce/ledger.js";
import { orderFits } from "../payments/orderState.js";
import { LockedFeatureError, setFeature } from "../circleFeatures.js";
import { cleanOptionSet, OptionValidationError } from "./options.js";
import { linesKey } from "./lines.js";
import { lineShareMinor } from "./partialCancel.js";
import { receiptDetail } from "../receipts.js";

// Participation Expansion Phase 1 — release gates S1–S12 and G4
// (docs/participation-expansion/07 §5). Real isolated MySQL; the payment
// provider is the network-free stub. Switches are global settings, so every
// test sets what it needs and afterAll restores them all to off (test files
// run one at a time — vitest.config fileParallelism: false).

const run = crypto.randomUUID().slice(0, 8);
const orgId = `t-org-pp-${run}`;
const vendorId = `t-vendor-pp-${run}`;
const otherVendorId = `t-vendor2-pp-${run}`;
const eventId = `t-event-pp-${run}`;
const plainId = `t-plain-pp-${run}`;
const sessA = `t-sessA-pp-${run}`;
const sessB = `t-sessB-pp-${run}`;
const plainSess = `t-sessP-pp-${run}`;
const clientId = `t-client-pp-${run}`;
const residentId = `t-res-pp-${run}`;
const refs: string[] = [];
const eventIds: string[] = [];
let server: Server;
let base: string;
let optionsVersion = 0;
const opt: Record<string, string> = {};

const SWITCHES = ["participation.events", "participation.options", "participation.partial_cancel", "commerce.engine_v2", "commerce.engine_v2_experience", "commerce.shadow_pricing"];
async function switches(on: Record<string, boolean>) {
  for (const [k, v] of Object.entries(on)) await setSetting(k, v ? "true" : "false");
}
const one = async <T = any>(sql: string, ...p: unknown[]) => (await db.prepare(sql).get(...p)) as T;
const all = async <T = any>(sql: string, ...p: unknown[]) => (await db.prepare(sql).all(...p)) as T[];

function future(days: number) {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

async function call(method: string, path: string, body?: unknown, who: "owner" | "finance" | "comms" | "other" | null = null) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { "Content-Type": "application/json", "X-Client-Id": clientId, ...(who ? { "X-Test-User": who } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json };
}

async function book(experienceId: string, sessionId: string, extra: Record<string, unknown>) {
  const r = await call("POST", `/experiences/${experienceId}/sessions/${sessionId}/checkout`, { participantName: "QA Booker", email: "qa_pp@example.test", acceptedTerms: true, ...extra });
  if (r.body?.ref) refs.push(r.body.ref);
  return r;
}

function paidEvent(ref: string, sid: string, amount: number) {
  const id = `evt_pp_${crypto.randomUUID().replace(/-/g, "")}`;
  eventIds.push(id);
  return {
    id, type: "checkout.session.completed", created: Math.floor(Date.now() / 1000), livemode: false, account: null,
    data: { object: { id: sid, object: "checkout.session", payment_status: "paid", amount_total: amount, currency: "eur", payment_intent: `pi_stub_${sid}`, metadata: { type: "experience", ref } } },
  };
}
async function deliver(event: ReturnType<typeof paidEvent>) {
  const begin = await beginEvent("stripe", event as never, JSON.stringify(event));
  if (begin.action !== "process") return begin.action;
  try {
    await finishEvent(begin.rowId, await processStripeEvent(event as never));
    return "processed";
  } catch (e) {
    await failEvent(begin.rowId, e, { needsReview: e instanceof NeedsReviewError });
    return e instanceof NeedsReviewError ? "parked" : "failed";
  }
}
/** Pays a pending card booking through the real webhook path. */
async function pay(ref: string) {
  const row = await one<{ total: number }>(`SELECT total_cents AS total FROM experience_bookings WHERE ref = ?`, ref);
  const sid = `cs_qa_stub_${ref}`;
  stubProvider.markPaid(sid, Number(row.total));
  stubProvider.setSessionCharge(sid, Number(row.total), "eur", { type: "experience", ref });
  return deliver(paidEvent(ref, sid, Number(row.total)));
}

const KNOTS_OPTIONS = () => [
  { kind: "option", label: "Participate in Pooja", description: "Pooja kit and lunch included", priceMinor: 7100, priceBasis: "per_booking", headsPerUnit: 5 },
  { kind: "option", label: "Individual Darshan", description: "Lunch included", priceMinor: 1100, priceBasis: "per_person", capacity: 3 },
  { kind: "addon", label: "Flowers", description: "", priceMinor: 500, priceBasis: "per_booking", maxPerOrder: 1 },
];

beforeAll(async () => {
  process.env.QA_E2E_ENABLED = "true";
  process.env.QA_PAYMENT_PROVIDER_STUB = "1";
  process.env.PAID_CHECKOUT = "open";
  await switches(Object.fromEntries(SWITCHES.map((k) => [k, false])));
  await db.prepare(`INSERT INTO organisations (id, name, kind) VALUES (?, 'KNOTS QA', 'vendor')`).run(orgId);
  await db.prepare(`INSERT INTO users (id, email, password_hash, role, status, name, org_id) VALUES (?, ?, 'x', 'vendor', 'approved', 'KNOTS QA', ?)`).run(vendorId, `${vendorId}@example.test`, orgId);
  await db.prepare(`INSERT INTO users (id, email, password_hash, role, status, name) VALUES (?, ?, 'x', 'vendor', 'approved', 'Other QA')`).run(otherVendorId, `${otherVendorId}@example.test`);
  const insertExp = `INSERT INTO experiences (id, vendor_id, kind, title, blurb, description, fitness_requirements, itinerary, equipment_provided, equipment_required, transport_info, safety_info, weather_policy, eligibility, cancellation_terms, status, capacity, price_cents, payment_method)
                     VALUES (?, ?, ?, ?, 'Blurb', 'Description', '', '', '', '', '', '', '', '', '', 'approved', ?, ?, 'online')`;
  await db.prepare(insertExp).run(eventId, vendorId, "event", "Satyanarayana Swamy Vratham QA", 200, 0);
  await db.prepare(insertExp).run(plainId, vendorId, "adventure", "Plain Kayak QA", 20, 2500);
  for (const [id, exp] of [[sessA, eventId], [sessB, eventId], [plainSess, plainId]]) {
    await db.prepare(`INSERT INTO experience_sessions (id, experience_id, date, time) VALUES (?, ?, ?, '10:00')`).run(id, exp, future(30));
  }

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const who = req.header("X-Test-User");
    if (who === "owner") (req as any).user = { id: vendorId, role: "vendor", status: "approved", orgId };
    if (who === "finance") (req as any).user = { id: vendorId, role: "vendor", status: "approved", orgId, invitedStaff: true, platformRole: "finance" };
    if (who === "comms") (req as any).user = { id: vendorId, role: "vendor", status: "approved", orgId, invitedStaff: true, platformRole: "communications" };
    if (who === "other") (req as any).user = { id: otherVendorId, role: "vendor", status: "approved" };
    if ((req as any).user) (req as any).vendorIds = [(req as any).user.id];
    next();
  });
  app.use("/experiences", experiencesRouter);
  app.use("/vendor", vendorExperiencesRouter);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("bind");
  base = `http://127.0.0.1:${address.port}`;
});

beforeEach(() => {
  process.env.QA_E2E_ENABLED = "true";
  process.env.QA_PAYMENT_PROVIDER_STUB = "1";
  process.env.PAID_CHECKOUT = "open";
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await switches(Object.fromEntries(SWITCHES.map((k) => [k, false])));
  delete process.env.QA_E2E_ENABLED;
  delete process.env.QA_PAYMENT_PROVIDER_STUB;
  delete process.env.PAID_CHECKOUT;
  const ph = refs.map(() => "?").join(",") || "''";
  for (const t of ["order_lines", "order_acknowledgements", "refunds", "payment_records", "checkout_agreements"]) {
    const col = t === "checkout_agreements" ? "source_ref" : "source_ref";
    await db.prepare(`DELETE FROM ${t} WHERE ${col} IN (${ph})`).run(...refs);
  }
  await db.prepare(`DELETE FROM commerce_order_lines WHERE order_id IN (SELECT id FROM commerce_orders WHERE source_ref IN (${ph}))`).run(...refs);
  await db.prepare(`DELETE FROM pricing_snapshots WHERE order_id IN (SELECT id FROM commerce_orders WHERE source_ref IN (${ph}))`).run(...refs);
  await db.prepare(`DELETE FROM commerce_orders WHERE source_ref IN (${ph})`).run(...refs);
  await db.prepare(`DELETE FROM commerce_quotes WHERE resource_id IN (?, ?)`).run(eventId, plainId);
  await db.prepare(`DELETE FROM notifications WHERE listing_id IN (?, ?)`).run(eventId, plainId);
  await db.prepare(`DELETE FROM experience_bookings WHERE experience_id IN (?, ?)`).run(eventId, plainId);
  await db.prepare(`DELETE FROM offering_options WHERE listing_id IN (?, ?)`).run(eventId, plainId);
  await db.prepare(`DELETE FROM experience_sessions WHERE experience_id IN (?, ?)`).run(eventId, plainId);
  await db.prepare(`DELETE FROM experiences WHERE id IN (?, ?) OR vendor_id IN (?, ?)`).run(eventId, plainId, vendorId, otherVendorId);
  await db.prepare(`DELETE FROM users WHERE id IN (?, ?)`).run(vendorId, otherVendorId);
  await db.prepare(`DELETE FROM organisations WHERE id = ?`).run(orgId);
  await db.prepare(`DELETE FROM residents WHERE id = ?`).run(residentId);
});

// --- unit-level rules ------------------------------------------------------------

describe("option validation (U3) and helpers", () => {
  it("refuses bad prices, a free listing's prices, add-on heads, mixed VAT and an add-on-only set", () => {
    const bad = (raw: unknown, free = false) => {
      try { cleanOptionSet(raw, { free }); return null; } catch (e) { return e instanceof OptionValidationError ? e.message : String(e); }
    };
    expect(bad([{ label: "A", priceMinor: -1 }])).toMatch(/price/);
    expect(bad([{ label: "A", priceMinor: 10.5 }])).toMatch(/price/);
    expect(bad([{ label: "A", priceMinor: 100 }], true)).toMatch(/free/);
    expect(bad([{ label: "A", kind: "addon", priceMinor: 100, headsPerUnit: 1 }])).toMatch(/add-on/);
    expect(bad([{ label: "A", priceMinor: 100, taxTreatment: "reduced" }])).toMatch(/VAT/);
    expect(bad([{ label: "Only extras", kind: "addon", priceMinor: 100 }])).toMatch(/at least one option/);
    expect(bad([{ label: "", priceMinor: 100 }])).toMatch(/name/);
    expect(bad([{ label: "A", priceMinor: 100, saleStartsAt: "2026-12-02T00:00:00Z", saleEndsAt: "2026-12-01T00:00:00Z" }])).toMatch(/start before/);
    expect(cleanOptionSet(KNOTS_OPTIONS(), { free: false })).toHaveLength(3);
  });
  it("linesKey is order-independent and lineShareMinor never exceeds what is refundable", () => {
    expect(linesKey([{ optionId: "b", quantity: 2 }, { optionId: "a", quantity: 1 }])).toBe(linesKey([{ optionId: "a", quantity: 1 }, { optionId: "b", quantity: 2 }]));
    expect(lineShareMinor(12544, 12544, 1100, 1, 9800)).toBe(1408);
    expect(lineShareMinor(12544, 100, 1100, 1, 9800)).toBe(100);
    expect(lineShareMinor(0, 0, 1100, 1, 9800)).toBe(0);
  });
  it("a locked switch can't be switched on from settings", async () => {
    await expect(setFeature("participation.partial_cancel", true)).rejects.toBeInstanceOf(LockedFeatureError);
    await expect(setFeature("participation.partial_cancel", false)).resolves.toBeUndefined();
  });
});

// --- S1/S2: compatibility -----------------------------------------------------------

describe("S1/S2 — a listing without options sells exactly as before", () => {
  it("quote and checkout match legacy pricing; lines are refused for it", async () => {
    await switches({ "participation.options": true });
    const q = await call("POST", `/experiences/${plainId}/sessions/${plainSess}/quote`, { partySize: 2 });
    const legacy = computePricing(5000, 0, 0, null);
    expect(q.status).toBe(200);
    expect(q.body).toMatchObject({ partySize: 2, totalCents: legacy.totalCents, vatCents: legacy.vatCents, platformFeeCents: legacy.platformFeeCents });
    expect(q.body.lines).toBeUndefined();
    const before = stubProvider.calls.length;
    const b = await book(plainId, plainSess, { partySize: 2 });
    expect(b.status).toBe(201);
    const row = await one(`SELECT pricing_mode AS mode, total_cents AS total, party_size AS party FROM experience_bookings WHERE ref = ?`, b.body.ref);
    expect(row).toMatchObject({ mode: "single", total: legacy.totalCents, party: 2 });
    expect(await all(`SELECT id FROM order_lines WHERE source_ref = ?`, b.body.ref)).toHaveLength(0);
    const session = stubProvider.calls.slice(before).find((c) => c.method === "createCheckoutSession")!.args as { lineItems: { unitAmountMinor: number; name: string }[] };
    expect(session.lineItems.map((l) => l.unitAmountMinor)).toEqual(pricingLineItems(legacy, { name: "Plain Kayak QA" }).map((l) => l.unitAmountCents));
    const sent = await call("POST", `/experiences/${plainId}/sessions/${plainSess}/quote`, { lines: [{ optionId: "x", quantity: 1 }] });
    expect(sent.status).toBe(400);
  });
});

// --- partner options ---------------------------------------------------------------

describe("S11 — partner options: permissions, versions, switch", () => {
  it("is refused while the options switch is off, for the wrong role, another organisation and a stale version", async () => {
    await switches({ "participation.options": false });
    const off = await call("PUT", `/vendor/experiences/${eventId}/options`, { options: KNOTS_OPTIONS(), version: 0 }, "owner");
    expect(off.status).toBe(404);
    await switches({ "participation.options": true });
    expect((await call("PUT", `/vendor/experiences/${eventId}/options`, { options: KNOTS_OPTIONS(), version: 0 }, "finance")).status).toBe(403);
    expect((await call("PUT", `/vendor/experiences/${eventId}/options`, { options: KNOTS_OPTIONS(), version: 0 }, "comms")).status).toBe(403);
    expect((await call("PUT", `/vendor/experiences/${eventId}/options`, { options: KNOTS_OPTIONS(), version: 0 }, "other")).status).toBe(403);
    expect((await call("PUT", `/vendor/experiences/${eventId}/options`, { options: KNOTS_OPTIONS(), version: 5 }, "owner")).status).toBe(409);
    const mixed = await call("PUT", `/vendor/experiences/${eventId}/options`, { options: [{ ...KNOTS_OPTIONS()[0], taxTreatment: "exempt" }], version: 0 }, "owner");
    expect(mixed.status).toBe(400);
  });
  it("saves the KNOTS options, rolls the cheapest up as the 'from' price, and bumps the version", async () => {
    const r = await call("PUT", `/vendor/experiences/${eventId}/options`, { options: KNOTS_OPTIONS(), version: 0 }, "owner");
    expect(r.status).toBe(200);
    optionsVersion = r.body.version;
    expect(optionsVersion).toBe(1);
    for (const o of r.body.options) opt[o.label] = o.id;
    expect(Object.keys(opt)).toEqual(["Participate in Pooja", "Individual Darshan", "Flowers"]);
    expect((await one(`SELECT price_cents AS p FROM experiences WHERE id = ?`, eventId)).p).toBe(1100);
  });
  it("refuses the event kind while participation.events is off", async () => {
    await switches({ "participation.events": false });
    expect((await call("POST", `/vendor/experiences`, { title: "No events yet", kind: "event" }, "owner")).status).toBe(403);
    await switches({ "participation.events": true });
    const created = await call("POST", `/vendor/experiences`, { title: "Diwali QA", kind: "event", difficulty: "hard", terrainType: "trail" }, "owner");
    expect(created.status).toBe(201);
    expect(await one(`SELECT kind, difficulty, terrain_type AS terrain FROM experiences WHERE id = ?`, created.body.id)).toEqual({ kind: "event", difficulty: "", terrain: "" });
  });
});

// --- S3/S4: multi-line pricing ---------------------------------------------------------

let knotsRef = "";
const KNOTS_LINES = () => [{ optionId: opt["Participate in Pooja"], quantity: 1 }, { optionId: opt["Individual Darshan"], quantity: 2 }, { optionId: opt["Flowers"], quantity: 1 }];
const KNOTS_TOTAL = computePricing(7100 + 2 * 1100 + 500, 0, 0, null);

describe("S3/S4 — KNOTS: several options priced on the server", () => {
  it("quotes the server sum of the lines with today's VAT and fee", async () => {
    const q = await call("POST", `/experiences/${eventId}/sessions/${sessA}/quote`, { lines: KNOTS_LINES(), partySize: 99 });
    expect(q.status).toBe(200);
    expect(q.body.partySize).toBe(7); // 5 (Pooja family) + 2 Darshan; partySize from the client is ignored
    expect(q.body.totalCents).toBe(KNOTS_TOTAL.totalCents);
    expect(q.body.lines.map((l: any) => [l.label, l.quantity, l.unitMinor, l.totalMinor])).toEqual([
      ["Participate in Pooja", 1, 7100, 7100],
      ["Individual Darshan", 2, 1100, 2200],
      ["Flowers", 1, 500, 500],
    ]);
  });
  it("checkout stores the same total as the agreement and the Stripe line items, ignoring any client amounts", async () => {
    const before = stubProvider.calls.length;
    const b = await book(eventId, sessA, { lines: KNOTS_LINES(), totalCents: 1, priceCents: 1, subtotalCents: 1, unitMinor: 1, partySize: 1 });
    expect(b.status).toBe(201);
    knotsRef = b.body.ref;
    const row = await one(`SELECT pricing_mode AS mode, total_cents AS total, party_size AS party, subtotal_cents AS sub, vat_cents AS vat, platform_fee_cents AS fee FROM experience_bookings WHERE ref = ?`, knotsRef);
    expect(row).toMatchObject({ mode: "lines", total: KNOTS_TOTAL.totalCents, party: 7, sub: 9800, vat: KNOTS_TOTAL.vatCents, fee: KNOTS_TOTAL.platformFeeCents });
    const agreement = await one(`SELECT amount_minor AS amount FROM checkout_agreements WHERE source_ref = ?`, knotsRef);
    expect(Number(agreement.amount)).toBe(KNOTS_TOTAL.totalCents);
    const session = stubProvider.calls.slice(before).find((c) => c.method === "createCheckoutSession")!.args as { lineItems: { unitAmountMinor: number; description?: string }[]; metadata: Record<string, string> };
    expect(session.lineItems.reduce((s, l) => s + l.unitAmountMinor, 0)).toBe(KNOTS_TOTAL.totalCents);
    expect(session.metadata).toEqual({ type: "experience", ref: knotsRef });
    expect(session.lineItems[0].description).toContain("Individual Darshan × 2");
    const lines = await all(`SELECT line_no AS n, label_snapshot AS label, unit_minor AS unit, quantity, heads, vat_bps_snapshot AS vat, fee_bps_snapshot AS fee, pricing_source AS src, tax_treatment_snapshot AS tax FROM order_lines WHERE source_ref = ? ORDER BY line_no`, knotsRef);
    expect(lines.map((l) => [l.label, l.unit, l.quantity, l.heads])).toEqual([["Participate in Pooja", 7100, 1, 5], ["Individual Darshan", 1100, 2, 2], ["Flowers", 500, 1, 0]]);
    expect(lines.every((l) => l.vat === 2300 && l.fee === 500 && l.src === "legacy:pricing.ts" && l.tax === "standard")).toBe(true);
  });
  it("refuses unknown options, over-limit quantities and add-on-only orders", async () => {
    expect((await call("POST", `/experiences/${eventId}/sessions/${sessA}/quote`, { lines: [{ optionId: "nope", quantity: 1 }] })).status).toBe(400);
    expect((await call("POST", `/experiences/${eventId}/sessions/${sessA}/quote`, { lines: [{ optionId: opt["Participate in Pooja"], quantity: 1 }, { optionId: opt["Flowers"], quantity: 2 }] })).status).toBe(400);
    expect((await call("POST", `/experiences/${eventId}/sessions/${sessA}/quote`, { lines: [{ optionId: opt["Flowers"], quantity: 1 }] })).status).toBe(400);
    expect((await call("POST", `/experiences/${eventId}/sessions/${sessA}/quote`, {})).status).toBe(400);
  });
  it("pays through the real webhook and shows the lines in the customer's list and status", async () => {
    expect(await pay(knotsRef)).toBe("processed");
    expect((await one(`SELECT payment_status AS ps FROM experience_bookings WHERE ref = ?`, knotsRef)).ps).toBe("paid");
    const mine = await call("GET", `/experiences/bookings/mine`);
    const mineRow = mine.body.find((r: any) => r.ref === knotsRef);
    expect(mineRow.linesSummary).toBe("Participate in Pooja × 1 · Individual Darshan × 2 · Flowers × 1");
    const status = await call("GET", `/experiences/bookings/status/${knotsRef}`);
    expect(status.body.lines).toHaveLength(3);
  });
  it("the resident's receipt lists the purchased lines with their frozen prices", async () => {
    await db.prepare(`INSERT INTO residents (id, email, name) VALUES (?, ?, 'PP Resident')`).run(residentId, `${residentId}@example.test`);
    await db.prepare(`UPDATE experience_bookings SET resident_id = ? WHERE ref = ?`).run(residentId, knotsRef);
    const r = await receiptDetail(residentId, knotsRef);
    expect(r?.totalCents).toBe(KNOTS_TOTAL.totalCents);
    expect(r?.lines.map((l) => [l.label, l.quantityPurchased, l.totalMinor])).toEqual([["Participate in Pooja", 1, 7100], ["Individual Darshan", 2, 2200], ["Flowers", 1, 500]]);
  });
});

// --- S5/S6: capacity -------------------------------------------------------------------

describe("S5/S6 — per-option limits never oversell", () => {
  it("two checkouts racing for the last Darshan places: exactly one wins", async () => {
    const darshan2 = [{ optionId: opt["Individual Darshan"], quantity: 2 }];
    const [a, b] = await Promise.all([book(eventId, sessB, { lines: darshan2 }), book(eventId, sessB, { lines: darshan2 })]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    const loser = a.status === 409 ? a : b;
    expect(loser.body.error).toMatch(/Individual Darshan/);
  });
  it("the webhook's capacity re-check refuses an order whose hold lapsed while its option filled up", async () => {
    const held = refs[refs.length - 1];
    const winner = (await one<{ ref: string }>(`SELECT ref FROM experience_bookings WHERE session_id = ? AND payment_status = 'pending' ORDER BY id LIMIT 1`, sessB)).ref;
    // The winner's 30-minute hold lapses; someone else takes the places.
    await db.prepare(`UPDATE experience_bookings SET created_at = NOW() - INTERVAL 2 HOUR WHERE ref = ?`).run(winner);
    const other = await book(eventId, sessB, { lines: [{ optionId: opt["Individual Darshan"], quantity: 2 }] });
    expect(other.status).toBe(201);
    const row = await one(`SELECT * FROM experience_bookings WHERE ref = ?`, winner);
    const fits = await db.transaction(async (tx) => orderFits(tx, "experience", row));
    expect(fits).toBe(false);
    expect(held).toBeTruthy();
  });
});

// --- S7: engine path ---------------------------------------------------------------------

describe("S7 — commerce engine with lines", () => {
  it("a quote is bound to its lines, and the order's commerce lines reconcile to the snapshot", async () => {
    await switches({ "commerce.engine_v2": true, "commerce.engine_v2_experience": true });
    try {
      const lines = [{ optionId: opt["Participate in Pooja"], quantity: 1 }, { optionId: opt["Individual Darshan"], quantity: 1 }];
      const q = await call("POST", `/experiences/${eventId}/sessions/${sessA}/quote`, { lines });
      expect(q.status).toBe(200);
      expect(q.body.quoteId).toBeTruthy();
      const mismatch = await book(eventId, sessA, { lines: [{ optionId: opt["Participate in Pooja"], quantity: 1 }], quoteId: q.body.quoteId });
      expect(mismatch.status).toBe(409);
      expect(mismatch.body.code).toBe("quote_mismatch");
      const ok = await book(eventId, sessA, { lines, quoteId: q.body.quoteId });
      expect(ok.status).toBe(201);
      const order = await one(`SELECT o.id, s.list_minor AS list, s.discount_minor AS disc, s.vat_minor AS vat, s.goods_gross_minor AS gross FROM commerce_orders o JOIN pricing_snapshots s ON s.order_id = o.id WHERE o.source_ref = ?`, ok.body.ref);
      const cl = await all(`SELECT item_type AS t, quantity, unit_minor AS unit, line_subtotal_minor AS sub, tax_minor AS tax, final_minor AS fin FROM commerce_order_lines WHERE order_id = ? ORDER BY id`, order.id);
      expect(cl.map((l) => [l.t, l.quantity, Number(l.unit)])).toEqual([["experience_option", 1, 7100], ["experience_option", 1, 1100]]);
      expect(cl.reduce((s, l) => s + Number(l.sub), 0)).toBe(Number(order.list));
      expect(cl.reduce((s, l) => s + Number(l.tax), 0)).toBe(Number(order.vat));
      expect(cl.reduce((s, l) => s + Number(l.fin), 0)).toBe(Number(order.gross));
      const snap = await one(`SELECT pricing_source AS src FROM order_lines WHERE source_ref = ? AND line_no = 1`, ok.body.ref);
      expect(snap.src).toMatch(/^engine:/);
      expect((await one(`SELECT total_cents AS t FROM experience_bookings WHERE ref = ?`, ok.body.ref)).t).toBe(q.body.totalCents);
    } finally {
      await switches({ "commerce.engine_v2": false, "commerce.engine_v2_experience": false });
    }
  });
});

// --- S8: snapshots ----------------------------------------------------------------------

describe("S8 — what was bought is frozen at purchase", () => {
  it("renaming and repricing an option changes future orders only", async () => {
    const current = (await call("GET", `/vendor/experiences/${eventId}/options`, undefined, "owner")).body;
    const edited = current.options.map((o: any) => (o.label === "Individual Darshan" ? { ...o, label: "Darshan (new name)", priceMinor: 1300 } : o));
    const r = await call("PUT", `/vendor/experiences/${eventId}/options`, { options: edited, version: current.version }, "owner");
    expect(r.status).toBe(200);
    const line = await one(`SELECT label_snapshot AS label, unit_minor AS unit FROM order_lines WHERE source_ref = ? AND line_no = 2`, knotsRef);
    expect(line).toEqual({ label: "Individual Darshan", unit: 1100 });
    const status = await call("GET", `/experiences/bookings/status/${knotsRef}`);
    expect(status.body.lines[1]).toMatchObject({ label: "Individual Darshan", unitMinor: 1100 });
    // Put the original back for the tests below.
    const back = await call("PUT", `/vendor/experiences/${eventId}/options`, { options: current.options, version: r.body.version }, "owner");
    expect(back.status).toBe(200);
  });
});

// --- S10: events visibility ----------------------------------------------------------------

describe("S10 — community events in public lists", () => {
  it("are hidden from lists while participation.events is off, but a direct link still opens", async () => {
    await switches({ "participation.events": false });
    const list = await call("GET", `/experiences`);
    expect(list.body.some((e: any) => e.id === eventId)).toBe(false);
    const detail = await call("GET", `/experiences/${eventId}`);
    expect(detail.status).toBe(200);
    expect(detail.body.kind).toBe("event");
    expect(detail.body.registration.mode).toBe("options");
    await switches({ "participation.events": true });
    expect((await call("GET", `/experiences`)).body.some((e: any) => e.id === eventId)).toBe(true);
    expect((await call("GET", `/experiences?kind=event`)).body.map((e: any) => e.id)).toContain(eventId);
    expect((await call("GET", `/experiences?kind=adventure`)).body.some((e: any) => e.id === eventId)).toBe(false);
  });
});

// --- G4: partial cancellation proof (switch stays locked off in product) ------------------

describe("G4 — removing a person refunds exactly their share, once", () => {
  it("doesn't exist while the switch is off", async () => {
    await switches({ "participation.partial_cancel": false });
    expect((await call("POST", `/experiences/bookings/${knotsRef}/remove`, { lineNo: 2, quantity: 1, expectedRefunded: 0 })).status).toBe(404);
  });
  it("refunds one Darshan share, refuses a repeat, survives a provider failure and reconciles", async () => {
    await setSetting("participation.partial_cancel", "true"); // test-only: bypasses the lock on purpose
    try {
      const refundCalls = () => stubProvider.calls.filter((c) => c.method === "createRefund").length;
      const paid = KNOTS_TOTAL.totalCents;
      const share = Math.floor((paid * 1100) / 9800);
      const callsBefore = refundCalls();
      // (a) one removal → one refund, even when sent twice at once.
      const [r1, r2] = await Promise.all([
        call("POST", `/experiences/bookings/${knotsRef}/remove`, { lineNo: 2, quantity: 1, expectedRefunded: 0 }),
        call("POST", `/experiences/bookings/${knotsRef}/remove`, { lineNo: 2, quantity: 1, expectedRefunded: 0 }),
      ]);
      expect([r1.status, r2.status].sort()).toEqual([200, 409]);
      expect(refundCalls() - callsBefore).toBe(1);
      const won = r1.status === 200 ? r1 : r2;
      expect(won.body.refundedMinor).toBe(share);
      expect((await one(`SELECT party_size AS p FROM experience_bookings WHERE ref = ?`, knotsRef)).p).toBe(6);
      const line = await one(`SELECT quantity, heads, refunded_quantity AS rq, refunded_minor AS rm FROM order_lines WHERE source_ref = ? AND line_no = 2`, knotsRef);
      expect(line).toEqual({ quantity: 1, heads: 1, rq: 1, rm: share });
      // (b) the provider refuses: nothing is refunded and the person stays booked.
      stubProvider.nextRefundFailure = "reject";
      const failed = await call("POST", `/experiences/bookings/${knotsRef}/remove`, { lineNo: 2, quantity: 1, expectedRefunded: 1 });
      expect(failed.status).toBeGreaterThanOrEqual(400);
      expect(await one(`SELECT quantity, refunded_quantity AS rq FROM order_lines WHERE source_ref = ? AND line_no = 2`, knotsRef)).toEqual({ quantity: 1, rq: 1 });
      expect((await one(`SELECT party_size AS p FROM experience_bookings WHERE ref = ?`, knotsRef)).p).toBe(6);
      const refunds = await all(`SELECT amount_minor AS a, status FROM refunds WHERE source_ref = ?`, knotsRef);
      expect(refunds).toHaveLength(1);
      // (c) the provider's own charge.refunded report isn't counted twice.
      const rec = await recordProviderRefunds({ paymentIntentId: `pi_stub_cs_qa_stub_${knotsRef}`, chargeId: `ch_stub_cs_qa_stub_${knotsRef}`, amountRefundedMinor: share, amountMinor: paid, currency: "eur" });
      expect(rec.recordedMinor).toBe(0);
      // (d) Σ refunds ≤ paid; (f) the line reconciles to the refund records.
      const total = await one(`SELECT COALESCE(SUM(amount_minor), 0) AS s FROM refunds WHERE source_ref = ? AND status IN ('pending', 'succeeded', 'reconciled')`, knotsRef);
      expect(Number(total.s)).toBe(share);
      expect(Number(total.s)).toBeLessThanOrEqual(paid);
      const lineSum = await one(`SELECT COALESCE(SUM(refunded_minor), 0) AS s FROM order_lines WHERE source_ref = ?`, knotsRef);
      expect(Number(lineSum.s)).toBe(Number(total.s));
      // (e) the ledger still balances.
      expect(await ledgerIsBalanced()).toBe(true);
      // Can't empty a booking this way, or leave a per-person add-on on more people than remain.
      const pooja = await call("POST", `/experiences/bookings/${knotsRef}/remove`, { lineNo: 1, quantity: 1, expectedRefunded: 0 });
      expect(pooja.status).toBe(200);
      const last = await call("POST", `/experiences/bookings/${knotsRef}/remove`, { lineNo: 2, quantity: 1, expectedRefunded: 1 });
      expect(last.status).toBe(409);
      expect(last.body.error).toMatch(/cancel the whole booking/);
    } finally {
      await setSetting("participation.partial_cancel", "false");
    }
  });
});

// --- S9: switch off after orders exist ------------------------------------------------------

describe("S9 — switching options off keeps existing orders manageable", () => {
  it("new registration pauses; existing orders still show lines and can be cancelled", async () => {
    await switches({ "participation.options": false });
    const paused = await call("POST", `/experiences/${eventId}/sessions/${sessA}/quote`, { lines: KNOTS_LINES() });
    expect(paused.status).toBe(409);
    expect(paused.body.code).toBe("registration_paused");
    const noLines = await call("POST", `/experiences/${eventId}/sessions/${sessA}/quote`, { partySize: 2 });
    expect(noLines.status).toBe(409); // never falls back to one price × party
    const detail = await call("GET", `/experiences/${eventId}`);
    expect(detail.body.registration).toMatchObject({ mode: "options", open: false });
    const status = await call("GET", `/experiences/bookings/status/${knotsRef}`);
    expect(status.body.lines.length).toBe(3);
    const pending = (await one<{ ref: string }>(`SELECT ref FROM experience_bookings WHERE session_id = ? AND pricing_mode = 'lines' AND status != 'cancelled' ORDER BY id DESC LIMIT 1`, sessB)).ref;
    await db.prepare(`UPDATE experience_bookings SET payment_status = 'paid' WHERE ref = ?`).run(pending);
    const cancel = await call("POST", `/experiences/bookings/${pending}/cancel`, {});
    expect(cancel.status).toBe(200);
  });
});
