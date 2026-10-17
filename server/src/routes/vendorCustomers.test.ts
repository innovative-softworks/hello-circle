import crypto from "node:crypto";
import http, { type Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../db/index.js";
import { vendorInsightsRouter } from "./vendorInsights.js";

// OG-20 — a partner's customers are only the people with orders at that
// organisation's listings, grouped by email, with their own orders only.

let server: Server;
let baseUrl: string;
const t = crypto.randomUUID().slice(0, 8);
const mine = `test-cust-vendor-${t}`;
const theirs = `test-cust-other-${t}`;
const email = `cust-${t}@example.test`;
const stranger = `stranger-${t}@example.test`;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const staffRole = req.header("X-Staff-Role");
    (req as any).user = { id: req.header("X-Vendor") ?? mine, role: "vendor", status: "approved", invitedStaff: !!staffRole, platformRole: staffRole ?? null };
    (req as any).vendorIds = [req.header("X-Vendor") ?? mine];
    next();
  });
  app.use("/vendor", vendorInsightsRouter);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("no port");
  baseUrl = `http://127.0.0.1:${address.port}`;
  for (const [vid, cid] of [[mine, `c-${mine}`], [theirs, `c-${theirs}`]]) {
    await db.prepare(`INSERT INTO users (id, email, password_hash, role, status, name) VALUES (?, ?, 'x', 'vendor', 'approved', 'V')`).run(vid, `${vid}@example.test`);
    await db.prepare(`INSERT INTO centres (id, name, area, county, rating, reviews, capacity, from_price, managed_by, ph, image_url, blurb, vendor_id, status) VALUES (?, ?, 'A', 'Dublin', 0, 0, 1, 1, 'M', '', '', '', ?, 'approved')`).run(cid, `Centre ${vid}`, vid);
  }
  const ins = (ref: string, centre: string, who: string, status = "confirmed") =>
    db
      .prepare(`INSERT INTO bookings (ref, client_id, centre_id, room_id, date, time, duration, event_type, guests, name, email, phone, notes, total_cents, status, payment_status) VALUES (?, 'c', ?, 'r', '2099-03-01', '10:00', 1, 'M', 2, 'Cust Name', ?, '0851234567', '', 2500, ?, 'paid')`)
      .run(ref, centre, who, status);
  await ins(`HBCU1-${t}`, `c-${mine}`, email);
  await ins(`HBCU2-${t}`, `c-${mine}`, email.toUpperCase(), "cancelled");
  await ins(`HBCU3-${t}`, `c-${theirs}`, stranger);
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await db.prepare(`DELETE FROM bookings WHERE centre_id IN (?, ?)`).run(`c-${mine}`, `c-${theirs}`);
  await db.prepare(`DELETE FROM centres WHERE id IN (?, ?)`).run(`c-${mine}`, `c-${theirs}`);
  await db.prepare(`DELETE FROM users WHERE id IN (?, ?)`).run(mine, theirs);
});

describe("customers", () => {
  it("groups one customer's orders by email and shows only this organisation's customers", async () => {
    const list = (await (await fetch(`${baseUrl}/vendor/customers`)).json()) as { email: string; orders: number; upcoming: number; cancelled: number; spentCents: number }[];
    const c = list.find((x) => x.email === email);
    expect(c).toMatchObject({ orders: 2, upcoming: 1, cancelled: 1, spentCents: 2500 });
    expect(list.some((x) => x.email === stranger)).toBe(false);
  });

  it("opens a customer's own orders, and refuses someone else's customer", async () => {
    const rec = await (await fetch(`${baseUrl}/vendor/customers/${encodeURIComponent(email)}`)).json();
    expect(rec.orders).toHaveLength(2);
    expect((await fetch(`${baseUrl}/vendor/customers/${encodeURIComponent(stranger)}`)).status).toBe(404);
  });

  it("is limited to staff who serve customers (a read-only analyst can't see contact details)", async () => {
    const as = (role: string) => ({ headers: { "X-Staff-Role": role } });
    expect((await fetch(`${baseUrl}/vendor/customers`, as("read_only_analyst"))).status).toBe(403);
    expect((await fetch(`${baseUrl}/vendor/customers/${encodeURIComponent(email)}`, as("read_only_analyst"))).status).toBe(403);
    expect((await fetch(`${baseUrl}/vendor/customers`, as("communications"))).status).toBe(200);
  });
});
