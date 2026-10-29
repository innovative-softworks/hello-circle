import crypto from "node:crypto";
import http, { type Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, getSetting, setSetting } from "../db/index.js";
import { createBookingInternal } from "../routes/bookings.js";
import { experiencesRouter } from "../routes/experiences.js";
import { makeItHappenRouter } from "../routes/makeItHappen.js";
import { cleanQuestionSet, questionsVersion, replaceQuestions } from "./questions.js";

// Phase M (docs/participation-expansion/20) — every entry point that can't
// show a listing's registration form is refused rather than letting it be
// bypassed: Make It Happen's booking path (no form) on a hall that asks
// questions, and an older app that sends no form at all. Halls without a
// form keep booking exactly as before.

const run = crypto.randomUUID().slice(0, 8);
const id = (k: string) => `t-${k}-cp-${run}`;
const vendor = id("vendor");
const withForm = id("hallForm");
const noForm = id("hallPlain");
const expId = id("exp");
const sessId = id("sess");
const date = new Date(Date.now() + 25 * 86_400_000).toISOString().slice(0, 10);
let server: Server;
let openBookingBefore = "false";
let base: string;

const book = (centreId: string, time: string, extra: Record<string, unknown> = {}) =>
  createBookingInternal({ centreId, roomId: "r1", date, time, duration: 1, eventType: "Party", guests: 3, name: "CP", email: "cp@example.test", phone: "0", residentId: null, clientId: id("client"), ...extra });

beforeAll(async () => {
  await setSetting("participation.attendees", "true");
  openBookingBefore = (await getSetting("commerce.open_booking", "false")) ?? "false";
  await db.prepare(`INSERT INTO users (id, email, password_hash, role, status, name) VALUES (?, ?, 'x', 'vendor', 'approved', 'CP')`).run(vendor, `${vendor}@example.test`);
  for (const c of [withForm, noForm]) {
    await db.prepare(`INSERT INTO centres (id, name, area, county, rating, reviews, capacity, from_price, managed_by, ph, image_url, blurb, vendor_id, status) VALUES (?, 'CP Hall', 'a', 'Dublin', 0, 0, 20, 1000, 'Mgr', '', '', '', ?, 'approved')`).run(c, vendor);
    await db.prepare(`INSERT INTO rooms (id, centre_id, name, cap, rate, \`desc\`, sort_order, payment_method) VALUES ('r1', ?, 'Main', 20, 50, '', 0, 'cash')`).run(c);
  }
  await replaceQuestions(withForm, cleanQuestionSet([{ scope: "booking", inputType: "text", label: "Kitchen needed?", purpose: "Caretaker" }], false, undefined, "centre"), 0, vendor, "centre");
  await db.prepare(`INSERT INTO experiences (id, vendor_id, kind, title, blurb, description, fitness_requirements, itinerary, equipment_provided, equipment_required, transport_info, safety_info, weather_policy, eligibility, cancellation_terms, status, capacity, price_cents, payment_method) VALUES (?, ?, 'event', 'CP Event', 'b', 'd', '', '', '', '', '', '', '', '', '', 'approved', 20, 0, 'cash')`).run(expId, vendor);
  await db.prepare(`INSERT INTO experience_sessions (id, experience_id, date, time) VALUES (?, ?, ?, '10:00')`).run(sessId, expId, date);
  await replaceQuestions(expId, cleanQuestionSet([{ scope: "booking", inputType: "text", label: "Shirt size", purpose: "Shirts", required: true }], false), await questionsVersion(expId), vendor);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const r = req.header("X-Test-Resident");
    if (r) (req as any).resident = { id: r, email: `${r}@example.test` };
    next();
  });
  app.use("/api/experiences", experiencesRouter);
  app.use("/api/make-it-happen", makeItHappenRouter);
  server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, r));
  const a = server.address();
  if (!a || typeof a === "string") throw new Error("bind");
  base = `http://127.0.0.1:${a.port}`;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  await setSetting("participation.attendees", "false");
  await setSetting("commerce.open_booking", openBookingBefore);
  for (const c of [withForm, noForm]) {
    // A Make It Happen booking opens a game on the hall (Open Booking); remove it with its rows.
    const games = ((await db.prepare(`SELECT id FROM games WHERE centre_id = ?`).all(c)) as { id: string }[]).map((g) => g.id);
    for (const g of games) {
      for (const t of ["game_participants", "listing_attributes", "notifications"]) await db.prepare(`DELETE FROM ${t} WHERE ${t === "game_participants" ? "game_id" : "listing_id"} = ?`).run(g);
      await db.prepare(`DELETE FROM games WHERE id = ?`).run(g);
    }
    await db.prepare(`DELETE FROM notifications WHERE listing_id = ?`).run(c);
    const refs = ((await db.prepare(`SELECT ref FROM bookings WHERE centre_id = ?`).all(c)) as { ref: string }[]).map((r) => r.ref);
    for (const r of refs) await db.prepare(`DELETE FROM order_acknowledgements WHERE source_ref = ?`).run(r);
    await db.prepare(`DELETE FROM bookings WHERE centre_id = ?`).run(c);
    await db.prepare(`DELETE FROM rooms WHERE centre_id = ?`).run(c);
    await db.prepare(`DELETE FROM registration_questions WHERE listing_id = ?`).run(c);
    await db.prepare(`DELETE FROM centres WHERE id = ?`).run(c);
  }
  await db.prepare(`DELETE FROM registration_questions WHERE listing_id = ?`).run(expId);
  await db.prepare(`DELETE FROM experience_sessions WHERE id = ?`).run(sessId);
  await db.prepare(`DELETE FROM experiences WHERE id = ?`).run(expId);
  await db.prepare(`DELETE FROM users WHERE id = ?`).run(vendor);
});

describe("Phase M — no entry point bypasses a published form", () => {
  it("Make It Happen's booking path (no form) is refused for a hall that asks questions", async () => {
    const r = await book(withForm, "10:00");
    expect(r).toMatchObject({ ok: false, status: 409, code: "form_required" });
    expect(await db.prepare(`SELECT ref FROM bookings WHERE centre_id = ?`).get(withForm)).toBeUndefined();
  });

  it("a hall without a form books through that path exactly as before", async () => {
    expect(await book(noForm, "11:00")).toMatchObject({ ok: true });
  });

  it("the checkout path with the form still works for the hall that asks questions", async () => {
    const v = await questionsVersion(withForm, db, "centre");
    expect(await book(withForm, "12:00", { form: { questionsVersion: v, answers: { booking: {} } } })).toMatchObject({ ok: true });
  });

  it("an app that sends no form gets a clear refusal; an old form version is told it changed", async () => {
    const post = (body: Record<string, unknown>) =>
      fetch(`${base}/api/experiences/${expId}/sessions/${sessId}/checkout`, { method: "POST", headers: { "Content-Type": "application/json", "X-Client-Id": id("app") }, body: JSON.stringify({ participantName: "CP", email: "cp@example.test", partySize: 1, ...body }) }).then(async (r) => ({ status: r.status, body: (await r.json()) as { code?: string } }));
    expect(await post({})).toMatchObject({ status: 409, body: { code: "form_required" } });
    expect(await post({ questionsVersion: 0 })).toMatchObject({ status: 409, body: { code: "questions_changed" } });
    expect((await post({ questionsVersion: await questionsVersion(expId) })).body.code).toBe("answer_required");
  });

  it("Make It Happen's confirm validates and stores the venue's answers when it sends them, and still refuses without", async () => {
    await setSetting("commerce.open_booking", "true");
    const confirm = (time: string, extra: Record<string, unknown>) =>
      fetch(`${base}/api/make-it-happen/confirm`, { method: "POST", headers: { "Content-Type": "application/json", "X-Client-Id": id("mih"), "X-Test-Resident": id("res") }, body: JSON.stringify({ county: "Dublin", date, time, duration: 1, partySize: 3, centreId: withForm, roomId: "r1", name: "CP", email: "cp@example.test", phone: "0", ...extra }) }).then(async (r) => ({ status: r.status, body: (await r.json()) as { code?: string; ref?: string; error?: string } }));
    expect((await confirm("14:00", {})).body.code).toBe("form_required");
    const v = await questionsVersion(withForm, db, "centre");
    const key = ((await db.prepare(`SELECT qkey FROM registration_questions WHERE listing_id = ? AND active = 1`).get(withForm)) as { qkey: string }).qkey;
    const ok = await confirm("15:00", { questionsVersion: v, answers: { booking: { [key]: "Yes please" } } });
    expect(ok.status, ok.body.error).toBe(201);
    expect(await db.prepare(`SELECT value_text FROM registration_answers WHERE source_type = 'booking' AND source_ref = ?`).get(ok.body.ref)).toEqual({ value_text: "Yes please" });
    await db.prepare(`DELETE FROM registration_answers WHERE source_ref = ?`).run(ok.body.ref!);
  });
});
