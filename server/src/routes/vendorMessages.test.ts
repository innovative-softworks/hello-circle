import crypto from "node:crypto";
import http, { type Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../db/index.js";
import { vendorMessagesRouter } from "./vendorMessages.js";
import { sweepMessageDeliveries } from "../participation/partnerMessages.js";

// Phase K (docs/participation-expansion/22) — partner messages: audience
// resolved on the server from the organisation's own listing (never another
// organisation's people), roles, one message per person, preview without
// addresses, idempotent sends, in-app delivery for residents, email held back
// outside production for non-test addresses, "send me a test" to the sender
// only, retries, and an audit row without the text or recipients.

const run = crypto.randomUUID().slice(0, 8);
const id = (k: string) => `t-${k}-pm-${run}`;
const vendorA = id("vendorA");
const vendorB = id("vendorB");
const expId = id("exp");
const s1 = id("s1");
const s2 = id("s2");
const resident = id("res");
const refs = { a: `EX-PMA-${run}`, a2: `EX-PMA2-${run}`, b: `EX-PMB-${run}`, real: `EX-PMR-${run}`, cancelled: `EX-PMX-${run}`, unpaid: `EX-PMU-${run}`, other: `EX-PMO-${run}` };
let server: Server;
let base: string;

const as = async (method: string, path: string, who: { vendorIds: string[]; role: string | null }, body?: unknown) => {
  const r = await fetch(`${base}${path}`, { method, headers: { "Content-Type": "application/json", "X-Test": JSON.stringify(who) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: (await r.json()) as any };
};
const OWNER = { vendorIds: [vendorA], role: null };
const staff = (role: string) => ({ vendorIds: [vendorA], role });
const audience = (extra: Record<string, unknown> = {}) => ({ listingType: "experience", listingId: expId, ...extra });
const message = (extra: Record<string, unknown> = {}) => ({ audience: audience(), templateKey: "event_update", subject: "Update: {listing}", body: "Hello {name}, doors open at 9.", ...extra });

beforeAll(async () => {
  for (const v of [vendorA, vendorB]) await db.prepare(`INSERT INTO users (id, email, password_hash, role, status, name) VALUES (?, ?, 'x', 'vendor', 'approved', 'PM Sender')`).run(v, `${v}@example.test`);
  await db.prepare(`INSERT INTO residents (id, email, name) VALUES (?, ?, 'PM Res')`).run(resident, `${resident}@example.test`);
  await db.prepare(`INSERT INTO experiences (id, vendor_id, kind, title, blurb, description, fitness_requirements, itinerary, equipment_provided, equipment_required, transport_info, safety_info, weather_policy, eligibility, cancellation_terms, status, capacity, price_cents, payment_method) VALUES (?, ?, 'event', 'PM Festival', 'b', 'd', '', '', '', '', '', '', '', '', '', 'approved', 50, 0, 'cash')`).run(expId, vendorA);
  await db.prepare(`INSERT INTO experience_sessions (id, experience_id, date, time) VALUES (?, ?, '2099-01-01', '10:00'), (?, ?, '2099-01-02', '10:00')`).run(s1, expId, s2, expId);
  const book = (ref: string, session: string, name: string, email: string, res: string | null, pay = "paid", status = "confirmed") =>
    db.prepare(`INSERT INTO experience_bookings (ref, experience_id, session_id, client_id, resident_id, participant_name, email, phone, party_size, total_cents, payment_status, status) VALUES (?, ?, ?, 'c', ?, ?, ?, '', 1, 0, ?, ?)`).run(ref, expId, session, res, name, email, pay, status);
  await book(refs.a, s1, "Aoife Byrne", "aoife@example.test", resident);
  await book(refs.a2, s2, "Aoife Byrne", "AOIFE@example.test", resident); // same person twice: one message
  await book(refs.b, s1, "Cian Murphy", "cian@example.test", null);
  await book(refs.real, s1, "Real Person", "real.person@gmail.com", null);
  await book(refs.cancelled, s1, "Gone", "gone@example.test", null, "paid", "cancelled");
  await book(refs.unpaid, s1, "Unpaid", "unpaid@example.test", null, "pending");
  await db.prepare(`INSERT INTO attendee_checkins (source_type, source_ref, attendee_no, session_id, checked_in_by) VALUES ('experience', ?, 1, ?, ?)`).run(refs.b, s1, vendorA);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const who = JSON.parse(req.header("X-Test") ?? "{}") as { vendorIds: string[]; role: string | null };
    (req as any).user = { id: who.vendorIds[0], orgId: null, role: "vendor", status: "approved", invitedStaff: !!who.role, platformRole: who.role };
    (req as any).vendorIds = who.vendorIds;
    next();
  });
  app.use("/vendor", vendorMessagesRouter);
  server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, r));
  const a = server.address();
  if (!a || typeof a === "string") throw new Error("bind");
  base = `http://127.0.0.1:${a.port}`;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  const msgIds = ((await db.prepare(`SELECT id FROM vendor_messages WHERE vendor_id IN (?, ?)`).all(vendorA, vendorB)) as { id: number }[]).map((m) => m.id);
  for (const m of msgIds) await db.prepare(`DELETE FROM vendor_message_deliveries WHERE message_id = ?`).run(m);
  await db.prepare(`DELETE FROM vendor_message_requests WHERE vendor_id IN (?, ?)`).run(vendorA, vendorB);
  await db.prepare(`DELETE FROM vendor_messages WHERE vendor_id IN (?, ?)`).run(vendorA, vendorB);
  await db.prepare(`DELETE FROM notifications WHERE resident_id = ?`).run(resident);
  await db.prepare(`DELETE FROM audit_log WHERE actor_user_id IN (?, ?)`).run(vendorA, vendorB);
  await db.prepare(`DELETE FROM attendee_checkins WHERE source_ref = ?`).run(refs.b);
  await db.prepare(`DELETE FROM experience_bookings WHERE experience_id = ?`).run(expId);
  await db.prepare(`DELETE FROM experience_sessions WHERE experience_id = ?`).run(expId);
  await db.prepare(`DELETE FROM experiences WHERE id = ?`).run(expId);
  await db.prepare(`DELETE FROM residents WHERE id = ?`).run(resident);
  await db.prepare(`DELETE FROM users WHERE id IN (?, ?)`).run(vendorA, vendorB);
});

describe("Phase K — partner messages", () => {
  it("another organisation can't preview or message these participants; finance can't send", async () => {
    expect((await as("POST", "/vendor/messages/preview", { vendorIds: [vendorB], role: null }, { audience: audience() })).status).toBe(403);
    expect((await as("POST", "/vendor/messages", { vendorIds: [vendorB], role: null }, message())).status).toBe(403);
    expect((await as("POST", "/vendor/messages/preview", staff("finance"), { audience: audience() })).status).toBe(403);
    expect((await as("POST", "/vendor/messages", staff("centre_manager"), message())).status).toBe(403);
    expect((await as("POST", "/vendor/messages/preview", staff("communications"), { audience: audience() })).status).toBe(200);
    expect((await as("POST", "/vendor/messages/preview", OWNER, { audience: { listingType: "game", listingId: expId } })).status).toBe(400);
  });

  it("previews confirmed people once each, by session and attendance — first names only, no addresses", async () => {
    const all = (await as("POST", "/vendor/messages/preview", OWNER, { audience: audience() })).body;
    expect(all).toMatchObject({ recipients: 3, inApp: 1, email: 3, emailHeldBack: 1 });
    expect(all.sample.sort()).toEqual(["Aoife", "Cian", "Real"]);
    expect(JSON.stringify(all)).not.toMatch(/@/);
    expect((await as("POST", "/vendor/messages/preview", OWNER, { audience: audience({ sessionId: s2 }) })).body.recipients).toBe(1);
    expect((await as("POST", "/vendor/messages/preview", OWNER, { audience: audience({ filter: "checked_in" }) })).body.sample).toEqual(["Cian"]);
    expect((await as("POST", "/vendor/messages/preview", OWNER, { audience: audience({ filter: "not_checked_in" }) })).body.recipients).toBe(2);
  });

  it("an audience with nobody in it is recorded and sends nothing (as before)", async () => {
    const r = await as("POST", "/vendor/messages", OWNER, message({ audience: audience({ sessionId: "no-such-session" }) }));
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ recipientCount: 0, delivery: {} });
  });

  it("refuses an unfinished template", async () => {
    const r = await as("POST", "/vendor/messages", OWNER, message({ body: "Hello {name},\n\n[Write your update here]" }));
    expect([r.status, r.body.error]).toEqual([400, expect.stringMatching(/bracketed/)]);
  });

  it("sends once per idempotency key: in-app for the resident, email held back for a real address outside production", async () => {
    const key = `pm-${run}-send1`;
    const first = await as("POST", "/vendor/messages", OWNER, message({ idempotencyKey: key }));
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({ duplicate: false, recipientCount: 3 });
    expect(first.body.delivery.in_app).toEqual({ sent: 1 });
    // No mail transport in tests: test addresses are "no transport"; the real one is held back.
    expect(first.body.delivery.email).toEqual({ skipped_no_transport: 2, held_test_environment: 1 });
    const again = await as("POST", "/vendor/messages", OWNER, message({ idempotencyKey: key }));
    expect(again.body).toMatchObject({ duplicate: true, messageId: first.body.messageId });
    const n = (await db.prepare(`SELECT COUNT(*) AS n FROM vendor_message_deliveries WHERE message_id = ?`).get(first.body.messageId)) as { n: number };
    expect(Number(n.n)).toBe(4);
    const note = (await db.prepare(`SELECT title, body, ref FROM notifications WHERE resident_id = ? AND kind = 'organiser_message'`).all(resident)) as { title: string; body: string; ref: string }[];
    expect(note).toHaveLength(1);
    expect(note[0]).toMatchObject({ title: "Update: PM Festival", body: "Hello Aoife, doors open at 9." });
    const audit = (await db.prepare(`SELECT new_value AS v FROM audit_log WHERE actor_user_id = ? AND action = 'vendor_message.sent'`).get(vendorA)) as { v: string };
    expect(audit.v).not.toMatch(/doors|@/);
  });

  it("history shows delivery status; other organisations see none of it", async () => {
    const mine = (await as("GET", "/vendor/messages", OWNER)).body;
    expect(mine[0]).toMatchObject({ subject: "Update: {listing}", recipientCount: 3, delivery: { in_app: { sent: 1 } } });
    expect((await as("GET", "/vendor/messages", { vendorIds: [vendorB], role: null })).body).toEqual([]);
  });

  it("'send me a test' reaches only the sender", async () => {
    const r = await as("POST", "/vendor/messages/test", OWNER, message());
    expect(r.status).toBe(200);
    expect(r.body.to).toMatch(/^t…@example\.test$/);
    const before = (await db.prepare(`SELECT COUNT(*) AS n FROM notifications WHERE resident_id = ?`).get(resident)) as { n: number };
    expect(Number(before.n)).toBe(1);
  });

  it("retries a failed delivery, at most three attempts", async () => {
    const msg = (await db.prepare(`SELECT id FROM vendor_messages WHERE vendor_id = ? ORDER BY id DESC LIMIT 1`).get(vendorA)) as { id: number };
    await db.prepare(`UPDATE vendor_message_deliveries SET status = 'failed', attempts = 1 WHERE message_id = ? AND channel = 'email' AND status = 'skipped_no_transport' LIMIT 1`).run(msg.id);
    await db.prepare(`UPDATE vendor_message_deliveries SET status = 'failed', attempts = 3 WHERE message_id = ? AND channel = 'email' AND status = 'skipped_no_transport' LIMIT 1`).run(msg.id);
    await sweepMessageDeliveries();
    const rows = (await db.prepare(`SELECT status, attempts FROM vendor_message_deliveries WHERE message_id = ? AND channel = 'email' AND status <> 'held_test_environment' ORDER BY attempts`).all(msg.id)) as { status: string; attempts: number }[];
    expect(rows).toEqual([{ status: "skipped_no_transport", attempts: 2 }, { status: "failed", attempts: 3 }]);
  });
});
