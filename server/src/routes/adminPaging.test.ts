import crypto from "node:crypto";
import http, { type Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../db/index.js";
import { adminRouter } from "./admin.js";

// OG-24 — the audit log, partners and listings page on the server: every row
// is reachable (no fixed 200 cap), each exactly once.

let server: Server;
let baseUrl: string;
const t = crypto.randomUUID().slice(0, 8);
const vendorIds = Array.from({ length: 4 }, (_, i) => `test-page-vendor-${t}-${i}`);
const objectId = `test-page-object-${t}`;

async function all(path: string, pageSize: number) {
  const seen: { id: string | number }[] = [];
  let cursor: string | null = null;
  let pages = 0;
  do {
    const sep = path.includes("?") ? "&" : "?";
    const r = await fetch(`${baseUrl}${path}${sep}limit=${pageSize}${cursor ? `&cursor=${cursor}` : ""}`, { headers: { "X-Test-Admin": "1" } });
    expect(r.status).toBe(200);
    const page = (await r.json()) as { items: { id: string | number }[]; nextCursor: string | null };
    seen.push(...page.items);
    cursor = page.nextCursor;
    pages += 1;
  } while (cursor && pages < 50);
  return seen;
}

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    if (req.header("X-Test-Admin")) (req as any).user = { id: `test-page-admin-${t}`, role: "admin", adminRole: "super", status: "approved", email: "a@example.test", name: "A" };
    next();
  });
  app.use("/admin", adminRouter);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("no port");
  baseUrl = `http://127.0.0.1:${address.port}`;

  for (const id of vendorIds) {
    await db.prepare(`INSERT INTO users (id, email, password_hash, role, status, name, business_name, created_at) VALUES (?, ?, 'x', 'vendor', 'approved', 'Paging Vendor', ?, '2026-01-02 09:00:00')`).run(id, `${id}@example.test`, `Paging Biz ${t}`);
    await db
      .prepare(`INSERT INTO centres (id, name, area, county, rating, reviews, capacity, from_price, managed_by, ph, image_url, blurb, vendor_id, status, created_at) VALUES (?, ?, 'A', 'Dublin', 0, 0, 1, 1, 'M', '', '', '', ?, 'approved', '2026-01-02 09:00:00')`)
      .run(`c-${id}`, `Paging Centre ${t}`, id);
  }
  for (let i = 0; i < 230; i++) {
    await db.prepare(`INSERT INTO audit_log (actor_user_id, action, object_type, object_id) VALUES (NULL, 'test.paging', 'test', ?)`).run(objectId);
  }
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await db.prepare(`DELETE FROM audit_log WHERE object_id = ?`).run(objectId);
  for (const id of vendorIds) {
    await db.prepare(`DELETE FROM centres WHERE id = ?`).run(`c-${id}`);
    await db.prepare(`DELETE FROM users WHERE id = ?`).run(id);
  }
});

describe("server paging", () => {
  it("reaches every audit row past the old 200 limit, once each", async () => {
    const rows = await all(`/admin/audit?objectId=${objectId}`, 100);
    expect(rows).toHaveLength(230);
    expect(new Set(rows.map((r) => r.id)).size).toBe(230);
  });

  it("pages partners and listings with ties on created_at", async () => {
    const partners = await all(`/admin/vendors?q=${encodeURIComponent(`Paging Biz ${t}`)}`, 3);
    expect(partners.map((p) => p.id).sort()).toEqual([...vendorIds].sort());
    const listings = await all(`/admin/listings?type=centre&q=${encodeURIComponent(`Paging Centre ${t}`)}`, 3);
    expect(listings.map((l) => l.id).sort()).toEqual(vendorIds.map((id) => `c-${id}`).sort());
  });

  it("still answers the old unpaged calls the same way", async () => {
    const r = await fetch(`${baseUrl}/admin/audit`, { headers: { "X-Test-Admin": "1" } });
    const body = await r.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeLessThanOrEqual(200);
  });
});
