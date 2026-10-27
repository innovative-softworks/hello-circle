import crypto from "node:crypto";
import http, { type Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../db/index.js";
import { circleLinksRouter } from "./circleLinks.js";
import { gamesRouter } from "./games.js";

// Circles 3.1 — listings linked to a Circle (circle_listing_links): organiser
// links show at once, member links wait for an organiser, one link per Circle
// + listing (also under concurrency), the same listing in several Circles,
// removal ends only the link, privacy of approval/invite Circles, forged ids,
// and "create an activity for this Circle" (link after create).

let server: Server;
let baseUrl: string;
const t = crypto.randomUUID().slice(0, 8);
const org = `t31-org-${t}`;
const mem = `t31-mem-${t}`;
const out = `t31-out-${t}`;
const A = `t31-a-${t}`;
const B = `t31-b-${t}`;
const C = `t31-c-${t}`;
const P = `t31-private-${t}`;
const vendor = `t31-v-${t}`;
const exp = `t31-exp-${t}`;
const game = `t31-game-${t}`;

const as = (r: string) => ({ "Content-Type": "application/json", "X-Test-Resident-Id": r });
const call = (method: string, path: string, who: string | null, body?: unknown) =>
  fetch(`${baseUrl}${path}`, { method, headers: who ? as(who) : { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const id = req.header("X-Test-Resident-Id");
    if (id) (req as any).resident = { id, name: `R ${id.slice(-4)}` };
    next();
  });
  app.use("/circles", circleLinksRouter);
  app.use("/games", gamesRouter);
  server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, r));
  const a = server.address();
  if (!a || typeof a === "string") throw new Error("no port");
  baseUrl = `http://127.0.0.1:${a.port}`;

  for (const id of [org, mem, out]) await db.prepare(`INSERT INTO residents (id, email, name) VALUES (?, ?, 'T31')`).run(id, `${id}@example.test`);
  for (const [id, mode] of [[A, "open"], [B, "open"], [C, "open"], [P, "approval"]]) {
    await db.prepare(`INSERT INTO circles (id, name, activity_label, area, county, about, created_by_resident_id, join_mode) VALUES (?, ?, 'Hiking', 'Howth', 'Dublin', '', ?, ?)`).run(id, `T31 ${id.slice(4, 5)}`, org, mode);
    await db.prepare(`INSERT INTO circle_members (circle_id, resident_id, role) VALUES (?, ?, 'organiser'), (?, ?, 'member')`).run(id, org, id, mem);
  }
  await db.prepare(`INSERT INTO users (id, email, password_hash, role, status, name) VALUES (?, ?, 'x', 'vendor', 'approved', 'T31 Vendor')`).run(vendor, `${vendor}@example.test`);
  await db
    .prepare(`INSERT INTO experiences (id, vendor_id, kind, title, blurb, description, fitness_requirements, itinerary, equipment_provided, equipment_required, transport_info, safety_info, weather_policy, eligibility, cancellation_terms, status, price_cents, capacity) VALUES (?, ?, 'adventure', 'T31 Hill Walk', 'b', 'd', '', '', '', '', '', '', '', '', '', 'approved', 3000, 10)`)
    .run(exp, vendor);
  await db.prepare(`INSERT INTO games (id, host_resident_id, activity_label, date, time, capacity, status, visibility) VALUES (?, ?, 'T31 Kickabout', '2099-05-01', '10:00', 8, 'open', 'public')`).run(game, out);
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  const created = (await db.prepare(`SELECT listing_id FROM circle_listing_links WHERE circle_id IN (?, ?, ?, ?) AND listing_type = 'game'`).all(A, B, C, P)) as { listing_id: string }[];
  await db.prepare(`DELETE FROM circle_listing_links WHERE circle_id IN (?, ?, ?, ?)`).run(A, B, C, P);
  for (const g of created) if (g.listing_id !== game) await db.prepare(`DELETE FROM games WHERE id = ?`).run(g.listing_id);
  for (const id of [A, B, C, P]) {
    await db.prepare(`DELETE FROM circle_members WHERE circle_id = ?`).run(id);
    await db.prepare(`DELETE FROM notifications WHERE listing_id = ?`).run(id);
    await db.prepare(`DELETE FROM audit_log WHERE object_id = ?`).run(id);
    await db.prepare(`DELETE FROM circles WHERE id = ?`).run(id);
  }
  await db.prepare(`DELETE FROM games WHERE id = ? OR host_resident_id = ?`).run(game, mem);
  await db.prepare(`DELETE FROM experiences WHERE id = ?`).run(exp);
  await db.prepare(`DELETE FROM users WHERE id = ?`).run(vendor);
  for (const id of [org, mem, out]) await db.prepare(`DELETE FROM residents WHERE id = ?`).run(id);
});

describe("linking a listing to a Circle", () => {
  let pendingId = "";
  it("a member's link waits for an organiser; visitors don't see it yet", async () => {
    const r = await call("POST", `/circles/${A}/links`, mem, { listing: { type: "experience", id: exp }, note: "Looks great" });
    expect(r.status).toBe(201);
    const body = await r.json();
    expect(body.status).toBe("pending");
    pendingId = body.id;
    const visitor = await (await call("GET", `/circles/${A}/links`, null)).json();
    expect(visitor.find((l: any) => l.id === pendingId)).toBeUndefined();
    const organiser = await (await call("GET", `/circles/${A}/links`, org)).json();
    expect(organiser.find((l: any) => l.id === pendingId).canDecide).toBe(true);
  });

  it("only an organiser approves; then everyone sees it, with live listing state", async () => {
    expect((await call("POST", `/circles/${A}/links/${pendingId}/approve`, mem)).status).toBe(403);
    expect((await call("POST", `/circles/${A}/links/${pendingId}/approve`, org)).status).toBe(200);
    expect((await call("POST", `/circles/${A}/links/${pendingId}/approve`, org)).status).toBe(409);
    const visitor = await (await call("GET", `/circles/${A}/links`, null)).json();
    const l = visitor.find((x: any) => x.id === pendingId);
    expect(l.listing).toMatchObject({ kind: "adventure", title: "T31 Hill Walk" });
    expect(l.linkedByName).toBeNull();
  });

  it("the same listing can't be linked twice to one Circle, even at once", async () => {
    const [x, y] = await Promise.all([
      call("POST", `/circles/${B}/links`, org, { listing: { type: "game", id: game } }),
      call("POST", `/circles/${B}/links`, mem, { listing: { type: "game", id: game } }),
    ]);
    expect([x.status, y.status].sort()).toEqual([201, 409]);
    const { n } = (await db.prepare(`SELECT COUNT(*) as n FROM circle_listing_links WHERE circle_id = ? AND listing_id = ?`).get(B, game)) as { n: number };
    expect(Number(n)).toBe(1);
  });

  it("one listing in three Circles: three links, one listing, nothing copied", async () => {
    await call("POST", `/circles/${B}/links`, org, { listing: { type: "experience", id: exp } });
    await call("POST", `/circles/${C}/links`, org, { listing: { type: "experience", id: exp } });
    const { n } = (await db.prepare(`SELECT COUNT(*) as n FROM circle_listing_links WHERE listing_id = ? AND status = 'approved'`).get(exp)) as { n: number };
    expect(Number(n)).toBe(3);
    const { e } = (await db.prepare(`SELECT COUNT(*) as e FROM experiences WHERE title = 'T31 Hill Walk'`).get()) as { e: number };
    expect(Number(e)).toBe(1);
  });

  it("removing ends only that link: the listing and the other Circles' links stay", async () => {
    const link = (await db.prepare(`SELECT id FROM circle_listing_links WHERE circle_id = ? AND listing_id = ?`).get(C, exp)) as { id: string };
    expect((await call("DELETE", `/circles/${C}/links/${link.id}`, out)).status).toBe(403);
    expect((await call("DELETE", `/circles/${C}/links/${link.id}`, org)).status).toBe(200);
    expect(((await db.prepare(`SELECT status FROM experiences WHERE id = ?`).get(exp)) as { status: string }).status).toBe("approved");
    const { n } = (await db.prepare(`SELECT COUNT(*) as n FROM circle_listing_links WHERE listing_id = ? AND status = 'approved'`).get(exp)) as { n: number };
    expect(Number(n)).toBe(2);
    // Linking again reopens the same row, not a second one.
    expect((await call("POST", `/circles/${C}/links`, org, { listing: { type: "experience", id: exp } })).status).toBe(201);
    const { r } = (await db.prepare(`SELECT COUNT(*) as r FROM circle_listing_links WHERE circle_id = ? AND listing_id = ?`).get(C, exp)) as { r: number };
    expect(Number(r)).toBe(1);
  });
});

describe("permissions and privacy", () => {
  it("a non-member can't link, and forged ids are refused without details", async () => {
    expect((await call("POST", `/circles/${A}/links`, out, { listing: { type: "game", id: game } })).status).toBe(403);
    expect((await call("POST", `/circles/${A}/links`, mem, { listing: { type: "experience", id: "no-such-listing" } })).status).toBe(404);
    expect((await call("POST", `/circles/not-a-circle/links`, mem, { listing: { type: "game", id: game } })).status).toBe(404);
    expect((await call("POST", `/circles/${A}/links`, mem, { listing: { type: "space", id: "x" } })).status).toBe(400);
  });

  it("an approval Circle's links are members-only", async () => {
    await call("POST", `/circles/${P}/links`, org, { listing: { type: "game", id: game } });
    expect((await call("GET", `/circles/${P}/links`, out)).status).toBe(403);
    expect((await call("GET", `/circles/${P}/links`, null)).status).toBe(403);
    expect((await call("GET", `/circles/${P}/links`, mem)).status).toBe(200);
  });

  it("a cancelled listing reads as cancelled on the Circle", async () => {
    await db.prepare(`UPDATE games SET status = 'cancelled' WHERE id = ?`).run(game);
    const list = await (await call("GET", `/circles/${B}/links`, mem)).json();
    expect(list.find((l: any) => l.listing.id === game).listing.availability).toBe("cancelled");
    await db.prepare(`UPDATE games SET status = 'open' WHERE id = ?`).run(game);
  });
});

describe("create an activity for this Circle (member)", () => {
  it("creates the activity, then links it for an organiser to approve", async () => {
    const r = await call("POST", `/games`, mem, { activityLabel: "T31 Member walk", date: "2099-06-01", time: "10:00", capacity: 6, locationText: "Howth", shareToCircleId: A });
    expect(r.status).toBe(201);
    const g = await r.json();
    expect(g.circleLink).toEqual({ ok: true, status: "pending" });
    const link = (await db.prepare(`SELECT relationship, status FROM circle_listing_links WHERE circle_id = ? AND listing_id = ?`).get(A, g.id)) as { relationship: string; status: string };
    expect(link).toEqual({ relationship: "created_for", status: "pending" });
    // The activity itself isn't the Circle's official activity.
    expect(((await db.prepare(`SELECT circle_id FROM games WHERE id = ?`).get(g.id)) as { circle_id: string | null }).circle_id).toBeNull();
  });

  it("a forged or foreign Circle creates nothing at all", async () => {
    const before = ((await db.prepare(`SELECT COUNT(*) as n FROM games WHERE host_resident_id = ?`).get(out)) as { n: number }).n;
    expect((await call("POST", `/games`, out, { activityLabel: "T31 Sneaky", date: "2099-06-01", time: "10:00", capacity: 6, locationText: "Howth", shareToCircleId: A })).status).toBe(403);
    const after = ((await db.prepare(`SELECT COUNT(*) as n FROM games WHERE host_resident_id = ?`).get(out)) as { n: number }).n;
    expect(Number(after)).toBe(Number(before));
  });
});
