import crypto from "node:crypto";
import http, { type Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../db/index.js";
import { vendorExperiencesRouter } from "./vendorExperiences.js";

// OG-19 — repeating departures, a booking cut-off per departure, capacity
// that can't drop below what's booked, and moving a booking the customer
// asked to move.

let server: Server;
let baseUrl: string;
const vendorId = `test-dep-vendor-${crypto.randomUUID()}`;
const experienceId = `test-dep-exp-${crypto.randomUUID()}`;
const start = new Date(Date.now() + 40 * 86_400_000).toISOString().slice(0, 10);
const post = (path: string, body: unknown) => fetch(`${baseUrl}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const put = (path: string, body: unknown) => fetch(`${baseUrl}${path}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).user = { id: vendorId, role: "vendor", status: "approved", invitedStaff: false };
    (req as any).vendorIds = [vendorId];
    next();
  });
  app.use("/", vendorExperiencesRouter);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("no port");
  baseUrl = `http://127.0.0.1:${address.port}`;
  await db.prepare(`INSERT INTO users (id, email, password_hash, role, status, name) VALUES (?, ?, 'x', 'vendor', 'approved', 'Dep Vendor')`).run(vendorId, `${vendorId}@example.test`);
  await db
    .prepare(`INSERT INTO experiences (id, vendor_id, title, blurb, description, fitness_requirements, itinerary, equipment_provided, equipment_required, transport_info, safety_info, weather_policy, eligibility, cancellation_terms, status, capacity) VALUES (?, ?, 'Dep Walk', 'b', 'd', '', '', '', '', '', '', '', '', '', 'approved', 10)`)
    .run(experienceId, vendorId);
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await db.prepare(`DELETE FROM experience_bookings WHERE experience_id = ?`).run(experienceId);
  await db.prepare(`DELETE FROM experience_sessions WHERE experience_id = ?`).run(experienceId);
  await db.prepare(`DELETE FROM experiences WHERE id = ?`).run(experienceId);
  await db.prepare(`DELETE FROM users WHERE id = ?`).run(vendorId);
});

describe("departures", () => {
  let ids: string[] = [];
  it("creates a weekly series with a booking cut-off on each", async () => {
    const r = await post(`/experiences/${experienceId}/sessions`, { date: start, time: "10:00", repeatWeeks: 3, salesCloseHours: 24, capacity: 2 });
    expect(r.status).toBe(201);
    ids = (await r.json()).ids;
    expect(ids).toHaveLength(3);
    const rows = (await db.prepare(`SELECT date, series_id as seriesId, sales_close_at as closeAt FROM experience_sessions WHERE experience_id = ? ORDER BY date`).all(experienceId)) as { date: string; seriesId: string; closeAt: Date }[];
    const days = rows.map((r) => (Date.parse(r.date) - Date.parse(start)) / 86_400_000);
    expect(days).toEqual([0, 7, 14]);
    expect(new Set(rows.map((r) => r.seriesId)).size).toBe(1);
    expect(rows.every((r) => r.closeAt instanceof Date || typeof r.closeAt === "string")).toBe(true);
    expect((await post(`/experiences/${experienceId}/sessions`, { date: start, time: "10:00", repeatWeeks: 40 })).status).toBe(400);
  });

  it("won't lower capacity below what's booked", async () => {
    await db
      .prepare(`INSERT INTO experience_bookings (ref, experience_id, session_id, client_id, participant_name, email, payment_status, party_size) VALUES (?, ?, ?, 'c', 'G', 'g@example.test', 'paid', 2)`)
      .run(`EXD-${crypto.randomUUID().slice(0, 8)}`, experienceId, ids[0]);
    expect((await put(`/experiences/${experienceId}/sessions/${ids[0]}`, { capacity: 1 })).status).toBe(409);
    expect((await put(`/experiences/${experienceId}/sessions/${ids[0]}`, { capacity: 4 })).status).toBe(200);
  });

  it("changes or clears one departure's cut-off, given as hours before the start", async () => {
    const closeAt = async () => ((await db.prepare(`SELECT sales_close_at as c FROM experience_sessions WHERE id = ?`).get(ids[1])) as { c: Date | null }).c;
    const before = await closeAt();
    expect((await put(`/experiences/${experienceId}/sessions/${ids[1]}`, { salesCloseHours: 2 })).status).toBe(200);
    const after = await closeAt();
    expect(new Date(after!).getTime() - new Date(before!).getTime()).toBe(22 * 3_600_000);
    expect((await put(`/experiences/${experienceId}/sessions/${ids[1]}`, { salesCloseHours: 1000 })).status).toBe(400);
    expect((await put(`/experiences/${experienceId}/sessions/${ids[1]}`, { salesCloseHours: null })).status).toBe(200);
    expect(await closeAt()).toBeNull();
  });

  it("moves a booking only when the customer asked, and only into free places", async () => {
    const b = (await db.prepare(`SELECT id FROM experience_bookings WHERE session_id = ?`).get(ids[0])) as { id: number };
    expect((await post(`/experiences/${experienceId}/bookings/${b.id}/move`, { sessionId: ids[1] })).status).toBe(400);
    await db.prepare(`UPDATE experience_sessions SET capacity = 1 WHERE id = ?`).run(ids[1]);
    expect((await post(`/experiences/${experienceId}/bookings/${b.id}/move`, { sessionId: ids[1], customerAsked: true })).status).toBe(409);
    const ok = await post(`/experiences/${experienceId}/bookings/${b.id}/move`, { sessionId: ids[2], customerAsked: true, note: "Asked by email" });
    expect(ok.status).toBe(200);
    expect(((await db.prepare(`SELECT session_id as s FROM experience_bookings WHERE id = ?`).get(b.id)) as { s: string }).s).toBe(ids[2]);
  });
});
