import crypto from "node:crypto";
import http, { type Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../db/index.js";
import { irelandTodayIso } from "../irelandTime.js";
import { gamesRouter } from "./games.js";

// OG-27 — approval activities (free only): a join is a request, never a seat,
// until the host approves it; bookings can be closed before the start.

let server: Server;
let baseUrl: string;
const t = crypto.randomUUID().slice(0, 8);
const host = `test-appr-host-${t}`;
const asker = `test-appr-asker-${t}`;
const second = `test-appr-second-${t}`;
const gameId = `test-appr-game-${t}`;
const date = new Date(Date.parse(`${irelandTodayIso()}T12:00:00Z`) + 10 * 86_400_000).toISOString().slice(0, 10);

const call = (method: string, path: string, resident: string, body?: unknown) =>
  fetch(`${baseUrl}/games/${gameId}${path}`, { method, headers: { "Content-Type": "application/json", "X-Test-Resident-Id": resident }, body: body === undefined ? undefined : JSON.stringify(body) });
const seats = async () => Number(((await db.prepare(`SELECT COUNT(*) as n FROM game_participants WHERE game_id = ? AND status = 'joined'`).get(gameId)) as { n: number }).n);

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const id = req.header("X-Test-Resident-Id");
    if (id) (req as any).resident = { id, name: id, email: `${id}@example.test` };
    next();
  });
  app.use("/games", gamesRouter);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("no port");
  baseUrl = `http://127.0.0.1:${address.port}`;

  for (const id of [host, asker, second]) await db.prepare(`INSERT INTO residents (id, email, name) VALUES (?, ?, ?)`).run(id, `${id}@example.test`, id);
  await db
    .prepare(`INSERT INTO games (id, host_resident_id, activity_label, location_text, date, time, capacity, status, visibility, lifecycle) VALUES (?, ?, 'Approval Walk', 'The Park', ?, '10:00', 2, 'open', 'public', 'active')`)
    .run(gameId, host, date);
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await db.prepare(`DELETE FROM game_join_requests WHERE game_id = ?`).run(gameId);
  await db.prepare(`DELETE FROM game_participants WHERE game_id = ?`).run(gameId);
  await db.prepare(`DELETE FROM notifications WHERE listing_id = ?`).run(gameId);
  await db.prepare(`DELETE FROM games WHERE id = ?`).run(gameId);
  await db.prepare(`DELETE FROM residents WHERE id IN (?, ?, ?)`).run(host, asker, second);
});

describe("join approval", () => {
  it("only the host can switch it on, and never on a paid activity", async () => {
    expect((await call("POST", "/booking-settings", asker, { joinMode: "approval" })).status).toBe(403);
    await db.prepare(`UPDATE games SET price_cents = 500 WHERE id = ?`).run(gameId);
    expect((await call("POST", "/booking-settings", host, { joinMode: "approval" })).status).toBe(409);
    await db.prepare(`UPDATE games SET price_cents = NULL WHERE id = ?`).run(gameId);
    const r = await call("POST", "/booking-settings", host, { joinMode: "approval" });
    expect(r.status).toBe(200);
    expect((await r.json()).joinMode).toBe("approval");
    // …and a price can't be added while it's on.
    const body = { activityLabel: "Approval Walk", locationText: "The Park", date, time: "10:00", capacity: 2, priceCents: 500 };
    expect([403, 409]).toContain((await call("PUT", "", host, body)).status); // 403 when the host can't take payments at all
    expect(((await db.prepare(`SELECT price_cents as p FROM games WHERE id = ?`).get(gameId)) as { p: number | null }).p).toBeNull();
  });

  it("a join becomes a request, not a seat", async () => {
    const r = await call("POST", "/join", asker, { message: "New to the area" });
    expect(r.status).toBe(202);
    expect(await seats()).toBe(0);
    expect((await call("POST", "/join", asker, {})).status).toBe(409);
    expect((await (await call("GET", "", asker)).json()).joinRequestByMe).toBe("requested");
    expect((await call("GET", "/join-requests", asker)).status).toBe(403);
    const list = (await (await call("GET", "/join-requests", host)).json()) as { residentId: string; message: string }[];
    expect(list).toEqual([expect.objectContaining({ residentId: asker, message: "New to the area" })]);
  });

  it("approving takes a seat once; declining doesn't", async () => {
    expect((await call("POST", `/join-requests/${asker}/approve`, asker)).status).toBe(403);
    expect((await call("POST", `/join-requests/${asker}/approve`, host)).status).toBe(200);
    expect(await seats()).toBe(1);
    expect((await call("POST", `/join-requests/${asker}/approve`, host)).status).toBe(409);
    await call("POST", "/join", second, {});
    expect((await call("POST", `/join-requests/${second}/decline`, host)).status).toBe(200);
    expect(await seats()).toBe(1);
    expect((await call("POST", "/join", second, {})).status).toBe(409);
  });

  it("a requester can withdraw a pending request", async () => {
    await db.prepare(`UPDATE game_join_requests SET status = 'withdrawn' WHERE game_id = ? AND resident_id = ?`).run(gameId, second);
    expect((await call("POST", "/join", second, {})).status).toBe(202);
    expect((await call("DELETE", "/join-request", second)).status).toBe(200);
    expect((await call("DELETE", "/join-request", second)).status).toBe(404);
  });
});

describe("closing bookings", () => {
  it("refuses a closing time after the start, and closed bookings refuse joins", async () => {
    expect((await call("POST", "/booking-settings", host, { bookingCloseAt: `${date}T23:00:00Z` })).status).toBe(400);
    await call("POST", "/booking-settings", host, { joinMode: "open" });
    const r = await call("POST", "/booking-settings", host, { bookingCloseAt: new Date(Date.now() - 60_000).toISOString() });
    expect(r.status).toBe(200);
    expect((await call("POST", "/join", second, {})).status).toBe(409);
    expect((await call("POST", "/booking-settings", host, { bookingCloseAt: null })).status).toBe(200);
    expect((await call("POST", "/join", second, {})).status).toBe(200);
  });
});
