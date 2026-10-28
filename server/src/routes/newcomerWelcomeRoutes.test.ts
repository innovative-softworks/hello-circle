import crypto from "node:crypto";
import http, { type Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../db/index.js";
import { gamesRouter } from "./games.js";
import { vendorParticipationRouter } from "./vendorParticipation.js";
import { vendorListingsRouter } from "./vendorListings.js";
import { centresRouter } from "./centres.js";

// Trust & Retention — "Who welcomes newcomers" saves and reloads through each
// listing type's own editor path, clears with "", and refuses contact details.

const u = crypto.randomUUID().slice(0, 8);
const host = `test-nw-host-${u}`;
const vendor = `test-nw-vendor-${u}`;
const other = `test-nw-other-${u}`;
const org = `test-nw-org-${u}`;
const centreId = `test-nw-centre-${u}`;
const programId = `test-nw-prog-${u}`;
let server: Server;
let base = "";

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use(async (req, _res, next) => {
    const r = req.header("x-test-resident");
    if (r) (req as any).resident = { id: r, email: `${r}@example.test`, name: "Host" };
    const v = req.header("x-test-vendor");
    if (v) {
      (req as any).user = { id: v, role: "vendor", status: "approved", orgId: v === vendor ? org : null, invitedStaff: false };
      (req as any).vendorIds = [v];
    }
    next();
  });
  app.use("/games", gamesRouter);
  app.use("/vendor", vendorParticipationRouter);
  app.use("/vendor", vendorListingsRouter);
  app.use("/centres", centresRouter);
  server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, r));
  const a = server.address();
  if (!a || typeof a === "string") throw new Error("bind");
  base = `http://127.0.0.1:${a.port}`;
  await db.prepare(`INSERT INTO residents (id, email, name) VALUES (?, ?, 'Host')`).run(host, `${host}@example.test`);
  await db.prepare(`INSERT INTO organisations (id, name, kind, status) VALUES (?, 'NW Org', 'vendor', 'active')`).run(org);
  for (const v of [vendor, other]) {
    await db.prepare(`INSERT INTO users (id, email, password_hash, role, status, name, org_id) VALUES (?, ?, 'x', 'vendor', 'approved', 'V', ?)`).run(v, `${v}@example.test`, v === vendor ? org : null);
  }
  await db
    .prepare(`INSERT INTO centres (id, name, area, county, rating, reviews, capacity, from_price, managed_by, ph, image_url, blurb, vendor_id, status) VALUES (?, 'NW Hall', 'A', 'Dublin', 0, 0, 20, 1000, 'M', '', '', '', ?, 'approved')`)
    .run(centreId, vendor);
  await db.prepare(`INSERT INTO programs (id, listing_type, listing_id, vendor_id, title, description, status) VALUES (?, 'centre', ?, ?, 'NW Course', '', 'published')`).run(programId, centreId, vendor);
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  await db.prepare(`DELETE FROM game_participants WHERE resident_id = ?`).run(host);
  await db.prepare(`DELETE FROM games WHERE host_resident_id = ?`).run(host);
  await db.prepare(`DELETE FROM programs WHERE id = ?`).run(programId);
  await db.prepare(`DELETE FROM centres WHERE id = ?`).run(centreId);
  await db.prepare(`DELETE FROM users WHERE id IN (?, ?)`).run(vendor, other);
  await db.prepare(`DELETE FROM organisations WHERE id = ?`).run(org);
  await db.prepare(`DELETE FROM residents WHERE id = ?`).run(host);
});

const call = (method: string, path: string, headers: Record<string, string>, body?: unknown) =>
  fetch(`${base}${path}`, { method, headers: { "Content-Type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });

describe("who welcomes newcomers", () => {
  it("Sessions: saved on create, shown publicly, changed and cleared on edit, contact details refused", async () => {
    const h = { "x-test-resident": host };
    const game = { activityLabel: "NW Walk", locationText: "Phoenix Park gate", date: "2099-05-01", time: "10:00", capacity: 8, priceCents: 0 };
    expect((await call("POST", "/games", h, { ...game, newcomerWelcome: "Ring me on 087 123 4567" })).status).toBe(400);
    const created = await call("POST", "/games", h, { ...game, newcomerWelcome: "Aoife (host) meets first-timers at the gate" });
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };
    expect(((await (await call("GET", `/games/${id}`, {})).json()) as any).newcomerWelcome).toBe("Aoife (host) meets first-timers at the gate");
    expect((await call("PUT", `/games/${id}`, h, { ...game, newcomerWelcome: "aoife@example.com" })).status).toBe(400);
    expect((await call("PUT", `/games/${id}`, h, { ...game, newcomerWelcome: "Look for the red flag" })).status).toBe(200);
    expect(((await (await call("GET", `/games/${id}`, {})).json()) as any).newcomerWelcome).toBe("Look for the red flag");
    // Omitted leaves it; "" clears it.
    await call("PUT", `/games/${id}`, h, game);
    expect(((await (await call("GET", `/games/${id}`, {})).json()) as any).newcomerWelcome).toBe("Look for the red flag");
    await call("PUT", `/games/${id}`, h, { ...game, newcomerWelcome: "" });
    expect(((await (await call("GET", `/games/${id}`, {})).json()) as any).newcomerWelcome).toBeNull();
  });

  it("programmes (participation editor): only the owning organisation can set it; it reloads", async () => {
    expect((await call("PUT", `/vendor/participation/program/${programId}`, { "x-test-vendor": other }, { newcomerWelcome: "Hi" })).status).toBe(403);
    expect((await call("PUT", `/vendor/participation/program/${programId}`, { "x-test-vendor": vendor }, { newcomerWelcome: "Text 0871234567" })).status).toBe(400);
    const saved = await call("PUT", `/vendor/participation/program/${programId}`, { "x-test-vendor": vendor }, { newcomerWelcome: "Coach Ciara at reception" });
    expect(((await saved.json()) as any).newcomerWelcome).toBe("Coach Ciara at reception");
    expect(((await (await call("GET", `/vendor/participation/program/${programId}`, { "x-test-vendor": vendor })).json()) as any).newcomerWelcome).toBe("Coach Ciara at reception");
  });

  it("venues: set through the venue editor and shown on the public venue", async () => {
    const r = await call("PUT", `/vendor/centres/${centreId}`, { "x-test-vendor": vendor }, { newcomerWelcome: "The caretaker, Pat, opens up" });
    expect(r.status).toBe(200);
    expect(((await (await call("GET", `/centres/${centreId}`, {})).json()) as any).newcomerWelcome).toBe("The caretaker, Pat, opens up");
    expect((await call("PUT", `/vendor/centres/${centreId}`, { "x-test-vendor": vendor }, { newcomerWelcome: "pat@hall.ie" })).status).toBe(400);
  });
});
