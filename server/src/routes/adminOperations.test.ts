import crypto from "node:crypto";
import http, { type Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../db/index.js";
import { adminOperationsRouter } from "./adminOperations.js";

// OG-10 / OG-14 / OG-24 — Operations directories page on the server with a
// stable cursor, and admin actions are permission-checked and reuse the
// provider-cancel paths.

let server: Server;
let baseUrl: string;
const t = crypto.randomUUID().slice(0, 8);
const vendorId = `test-ops-vendor-${t}`;
const centreId = `test-ops-centre-${t}`;
const hostId = `test-ops-host-${t}`;
const gameId = `test-ops-game-${t}`;
const refs = Array.from({ length: 5 }, (_, i) => `HBOPS-${t}-${i}`);

const as = (role: string) => ({ "Content-Type": "application/json", "X-Test-Admin-Role": role });
const get = (path: string, role = "super") => fetch(`${baseUrl}${path}`, { headers: as(role) });
const post = (path: string, body: unknown, role = "super") => fetch(`${baseUrl}${path}`, { method: "POST", headers: as(role), body: JSON.stringify(body) });

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const role = req.header("X-Test-Admin-Role");
    if (role) (req as any).user = { id: `test-ops-admin-${role}`, role: "admin", adminRole: role, status: "approved", email: `${role}@example.test`, name: role };
    next();
  });
  app.use("/ops", adminOperationsRouter);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("no port");
  baseUrl = `http://127.0.0.1:${address.port}`;

  await db.prepare(`INSERT INTO users (id, email, password_hash, role, status, name) VALUES (?, ?, 'x', 'vendor', 'approved', 'Ops Vendor')`).run(vendorId, `${vendorId}@example.test`);
  await db
    .prepare(`INSERT INTO centres (id, name, area, county, rating, reviews, capacity, from_price, managed_by, ph, image_url, blurb, vendor_id, status) VALUES (?, 'Ops Centre', 'Area', 'Dublin', 0, 0, 20, 1000, 'Mgr', '', '', '', ?, 'approved')`)
    .run(centreId, vendorId);
  // Five bookings with identical created_at, so paging must break ties by ref.
  for (const ref of refs) {
    await db
      .prepare(
        `INSERT INTO bookings (ref, client_id, centre_id, room_id, date, time, duration, event_type, guests, name, email, phone, notes, total_cents, status, payment_status, created_at)
         VALUES (?, 'ops', ?, 'r', '2099-02-01', '10:00', 1, 'M', 2, 'Ops Guest', 'ops_guest_${t}@example.test', '', '', 0, 'confirmed', 'paid', '2026-01-01 10:00:00')`
      )
      .run(ref, centreId);
  }
  await db.prepare(`INSERT INTO residents (id, email, name) VALUES (?, ?, 'Ops Host')`).run(hostId, `${hostId}@example.test`);
  await db.prepare(`INSERT INTO games (id, host_resident_id, activity_label, date, time, capacity, status) VALUES (?, ?, 'Ops Kickabout ${t}', '2099-01-01', '10:00', 8, 'open')`).run(gameId, hostId);
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await db.prepare(`DELETE FROM bookings WHERE centre_id = ?`).run(centreId);
  await db.prepare(`DELETE FROM centres WHERE id = ?`).run(centreId);
  await db.prepare(`DELETE FROM users WHERE id = ?`).run(vendorId);
  await db.prepare(`DELETE FROM moderation_decisions WHERE object_id = ?`).run(gameId);
  await db.prepare(`DELETE FROM games WHERE id = ?`).run(gameId);
  await db.prepare(`DELETE FROM residents WHERE id = ?`).run(hostId);
});

describe("Orders directory", () => {
  it("pages through every match exactly once, newest first", async () => {
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const r = await get(`/ops/orders?q=ops_guest_${t}&limit=2${cursor ? `&cursor=${cursor}` : ""}`);
      expect(r.status).toBe(200);
      const page = (await r.json()) as { items: { ref: string }[]; nextCursor: string | null };
      expect(page.items.length).toBeLessThanOrEqual(2);
      seen.push(...page.items.map((i) => i.ref));
      cursor = page.nextCursor;
    } while (cursor);
    expect([...seen].sort()).toEqual([...refs].sort());
    expect(new Set(seen).size).toBe(refs.length);
  });

  it("filters by kind", async () => {
    const page = await (await get(`/ops/orders?q=ops_guest_${t}&kind=registration`)).json();
    expect(page.items).toEqual([]);
  });
});

describe("Activities directory", () => {
  it("finds the activity with its host and opens its record", async () => {
    const page = await (await get(`/ops/activities?q=${encodeURIComponent(`Ops Kickabout ${t}`)}`)).json();
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({ id: gameId, hostName: "Ops Host", joined: 0 });
    const rec = await (await get(`/ops/activities/${gameId}`)).json();
    expect(rec.activity).toMatchObject({ id: gameId });
  });

  it("only super and support admins may cancel it, with a reason, and only once", async () => {
    const reason = { reasonCategory: "safety", explanation: "Reported as unsafe and the host didn't respond to us." };
    expect((await post(`/ops/activities/${gameId}/cancel`, reason, "finance")).status).toBe(403);
    expect((await post(`/ops/activities/${gameId}/cancel`, { reasonCategory: "safety" }, "support")).status).toBe(400);
    expect((await post(`/ops/activities/${gameId}/cancel`, reason, "support")).status).toBe(200);
    expect((await post(`/ops/activities/${gameId}/cancel`, reason, "support")).status).toBe(409);
  });
});

describe("cancel on behalf", () => {
  it("is refused to legal admins and without a reason, and cancels once otherwise", async () => {
    const ref = refs[0];
    expect((await post(`/ops/orders/booking/${ref}/cancel`, { reason: "Venue double-booked by phone" }, "legal")).status).toBe(403);
    expect((await post(`/ops/orders/booking/${ref}/cancel`, { reason: "short" }, "support")).status).toBe(400);
    const ok = await post(`/ops/orders/booking/${ref}/cancel`, { reason: "Venue double-booked by phone" }, "support");
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ ok: true, refund: "none" });
    expect((await post(`/ops/orders/booking/${ref}/cancel`, { reason: "Venue double-booked by phone" }, "support")).status).toBe(409);
    const audit = await db.prepare(`SELECT reason FROM audit_log WHERE action = 'booking.cancelled_by_admin' AND object_id = ?`).get(ref);
    expect(audit).toMatchObject({ reason: "Venue double-booked by phone" });
  });
});
