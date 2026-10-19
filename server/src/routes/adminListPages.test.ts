import crypto from "node:crypto";
import http, { type Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../db/index.js";
import { adminRouter } from "./admin.js";

// OG-24 — the Vendors and All listings pages as numbered server pages: the
// status-tab counts, filters, search, every sort and record lookup survive the
// move off "load everything into the browser".

let server: Server;
let baseUrl: string;
const t = crypto.randomUUID().slice(0, 8);
const tag = `Lp${t}`;
// 5 partners: 2 pending (one newer), 2 approved, 1 suspended; one sports club.
const vendors = [
  { id: `test-lp-${t}-a`, status: "approved", type: "community", at: "2026-01-01 09:00:00" },
  { id: `test-lp-${t}-b`, status: "pending", type: "community", at: "2026-01-02 09:00:00" },
  { id: `test-lp-${t}-c`, status: "approved", type: "sports", at: "2026-01-03 09:00:00" },
  { id: `test-lp-${t}-d`, status: "pending", type: "community", at: "2026-01-04 09:00:00" },
  { id: `test-lp-${t}-e`, status: "suspended", type: "community", at: "2026-01-05 09:00:00" },
];
const orgId = `test-lp-org-${t}`;

const get = async (path: string, admin = true) => {
  const r = await fetch(`${baseUrl}${path}`, { headers: admin ? { "X-Test-Admin": "1" } : {} });
  return { status: r.status, body: (await r.json()) as any };
};

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    if (req.header("X-Test-Admin")) (req as any).user = { id: `test-lp-admin-${t}`, role: "admin", adminRole: "super", status: "approved", email: "a@example.test", name: "A" };
    next();
  });
  app.use("/admin", adminRouter);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("no port");
  baseUrl = `http://127.0.0.1:${address.port}`;
  for (const v of vendors) {
    await db
      .prepare(`INSERT INTO users (id, email, password_hash, role, status, name, business_name, vendor_type, county, org_id, created_at) VALUES (?, ?, 'x', 'vendor', ?, 'LP Person', ?, ?, 'Cork', ?, ?)`)
      .run(v.id, `${v.id}@example.test`, v.status, `${tag} Biz ${v.id.slice(-1)}`, v.type, v.id.endsWith("a") || v.id.endsWith("c") ? orgId : null, v.at);
  }
  // Listings: 3 centres (A's), 1 club (C's), 1 experience (unclaimed); mixed statuses, one featured, one deleted.
  // Delta is an unclaimed (no partner), deleted centre with no creation date.
  const centre = (id: string, name: string, status: string, at: string | null, featured = 0, county = "Cork", vendor: string | null = vendors[0].id) =>
    db
      .prepare(`INSERT INTO centres (id, name, area, county, rating, reviews, capacity, from_price, managed_by, ph, image_url, blurb, vendor_id, status, featured, created_at) VALUES (?, ?, 'Area', ?, 0, 0, 1, 1, 'M', '', '', '', ?, ?, ?, ?)`)
      .run(id, name, county, vendor, status, featured, at);
  await centre(`test-lp-c1-${t}`, `${tag} Bravo`, "approved", "2026-02-01 09:00:00", 1);
  await centre(`test-lp-c2-${t}`, `${tag} Alpha`, "pending", "2026-02-03 09:00:00", 0, "Kerry");
  await centre(`test-lp-c3-${t}`, `${tag} Delta`, "deleted", null, 0, "Cork", null);
  await db
    .prepare(`INSERT INTO clubs (id, name, sport, area, county, ages, price, unit, trial, ph, blurb, vendor_id, status, created_at) VALUES (?, ?, 'Football', 'Area', 'Cork', 'All', 10, 'month', 0, '', 'b', ?, 'rejected', '2026-02-02 09:00:00')`)
    .run(`test-lp-k1-${t}`, `${tag} Charlie`, vendors[2].id);
  await db
    .prepare(`INSERT INTO experiences (id, vendor_id, title, area, county, blurb, description, fitness_requirements, itinerary, equipment_provided, equipment_required, transport_info, safety_info, weather_policy, eligibility, cancellation_terms, status, created_at) VALUES (?, ?, ?, 'Area', 'Cork', 'b', 'd', '', '', '', '', '', '', '', '', '', 'pending', '2026-02-04 09:00:00')`)
    .run(`test-lp-x1-${t}`, vendors[2].id, `${tag} Echo`);
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  for (const id of [`test-lp-c1-${t}`, `test-lp-c2-${t}`, `test-lp-c3-${t}`]) await db.prepare(`DELETE FROM centres WHERE id = ?`).run(id);
  await db.prepare(`DELETE FROM clubs WHERE id = ?`).run(`test-lp-k1-${t}`);
  await db.prepare(`DELETE FROM experiences WHERE id = ?`).run(`test-lp-x1-${t}`);
  for (const v of vendors) await db.prepare(`DELETE FROM users WHERE id = ?`).run(v.id);
});

describe("OG-24 Vendors page on the server", () => {
  it("counts every status over the search and type, sorts pending first then newest, and pages", async () => {
    const p1 = await get(`/admin/vendors?page=1&pageSize=2&q=${tag}`);
    expect(p1.status).toBe(200);
    expect(p1.body.counts).toEqual({ all: 5, pending: 2, approved: 2, suspended: 1 });
    expect([p1.body.total, p1.body.pageCount]).toEqual([5, 3]);
    expect(p1.body.items.map((v: any) => v.id)).toEqual([vendors[3].id, vendors[1].id]);
    const p2 = await get(`/admin/vendors?page=2&pageSize=2&q=${tag}`);
    expect(p2.body.items.map((v: any) => v.id)).toEqual([vendors[4].id, vendors[2].id]);
    const approved = await get(`/admin/vendors?page=1&q=${tag}&view=approved`);
    expect(approved.body.items.map((v: any) => v.id)).toEqual([vendors[2].id, vendors[0].id]);
    const sports = await get(`/admin/vendors?page=1&q=${tag}&type=sports`);
    expect([sports.body.counts.all, sports.body.items[0].id]).toEqual([1, vendors[2].id]);
    // A page past the end lands on the last page instead of an empty one.
    expect((await get(`/admin/vendors?page=9&pageSize=2&q=${tag}`)).body.page).toBe(3);
    // Search is literal: "%" matches nothing here.
    expect((await get(`/admin/vendors?page=1&q=${encodeURIComponent(`${tag}%`)}`)).body.total).toBe(0);
  });

  it("opens one partner's record with its listings and organisation size", async () => {
    const rec = await get(`/admin/vendors/${vendors[0].id}/summary`);
    expect([rec.status, rec.body.orgMemberCount, Number(rec.body.listingCount)]).toEqual([200, 2, 2]);
    const own = await get(`/admin/vendors/${vendors[0].id}/listings`);
    expect(own.body.map((r: any) => `${r.type}:${r.item.id}`).sort()).toEqual([`centre:test-lp-c1-${t}`, `centre:test-lp-c2-${t}`].sort());
    const c = await get(`/admin/vendors/${vendors[2].id}/listings`);
    expect(c.body.map((r: any) => r.type).sort()).toEqual(["club", "experience"]);
    expect((await get(`/admin/vendors/nope-${t}/summary`)).status).toBe(404);
    expect((await get(`/admin/vendors/${vendors[0].id}/summary`, false)).status).toBe(401);
  });
});

describe("OG-24 All listings page on the server", () => {
  const list = (extra: string) => get(`/admin/listings?page=1&q=${tag}${extra}`);
  it("keeps the status counts, type counts and county list", async () => {
    const r = await list("");
    expect(r.body.counts).toEqual({ all: 5, pending: 2, approved: 1, rejected: 1, other: 1 });
    expect(r.body.counties).toEqual(expect.arrayContaining(["Cork", "Kerry"]));
    expect(r.body.typeCounts.centre).toBeGreaterThanOrEqual(3);
    // Default (triage) order: pending first, then name.
    expect(r.body.items.map((x: any) => x.item.name)).toEqual([`${tag} Alpha`, `${tag} Echo`, `${tag} Bravo`, `${tag} Charlie`, `${tag} Delta`]);
    expect(r.body.items[0]).toMatchObject({ type: "centre", item: { vendorEmail: `${vendors[0].id}@example.test`, vendorStatus: "approved" } });
  });

  it("filters by status tab, type, county and show, and sorts every way", async () => {
    const names = async (extra: string) => (await list(extra)).body.items.map((x: any) => x.item.name.replace(`${tag} `, ""));
    expect(await names("&view=pending")).toEqual(["Alpha", "Echo"]);
    expect(await names("&view=other")).toEqual(["Delta"]);
    expect(await names("&type=club")).toEqual(["Charlie"]);
    expect(await names("&county=Kerry")).toEqual(["Alpha"]);
    expect(await names("&show=featured")).toEqual(["Bravo"]);
    expect(await names("&show=unclaimed")).toEqual(["Delta"]);
    expect(await names("&sort=name")).toEqual(["Alpha", "Bravo", "Charlie", "Delta", "Echo"]);
    expect(await names("&sort=nameDesc")).toEqual(["Echo", "Delta", "Charlie", "Bravo", "Alpha"]);
    expect(await names("&sort=oldest")).toEqual(["Bravo", "Charlie", "Alpha", "Echo", "Delta"]);
    expect(await names("&sort=newest")).toEqual(["Delta", "Echo", "Alpha", "Charlie", "Bravo"]);
    expect((await names("&sort=partner")).at(-1)).toBe("Delta");
    // Counts follow the non-status filters.
    expect((await list("&type=centre")).body.counts).toEqual({ all: 3, pending: 1, approved: 1, rejected: 0, other: 1 });
  });

  it("pages without repeats and opens a record by type and id", async () => {
    const seen: string[] = [];
    for (let page = 1; page <= 3; page++) seen.push(...(await get(`/admin/listings?page=${page}&pageSize=2&q=${tag}&sort=name`)).body.items.map((x: any) => x.item.id));
    expect(new Set(seen).size).toBe(5);
    const rec = await get(`/admin/listings/experience/test-lp-x1-${t}/summary`);
    expect([rec.status, rec.body.type, rec.body.item.name]).toEqual([200, "experience", `${tag} Echo`]);
    expect((await get(`/admin/listings/hall/test-lp-x1-${t}/summary`)).status).toBe(404);
  });
});
