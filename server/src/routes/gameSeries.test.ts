import crypto from "node:crypto";
import http, { type Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../db/index.js";
import { irelandTodayIso } from "../irelandTime.js";
import { gamesRouter } from "./games.js";

// OG-26 / DEC-13 — a weekly series is a set of ordinary activities sharing a
// series id; each keeps its own seats, and cancelling the rest of a series
// cancels only the dates still to come.

let server: Server;
let baseUrl: string;
const t = crypto.randomUUID().slice(0, 8);
const host = `test-series-host-${t}`;
const other = `test-series-other-${t}`;
const start = new Date(Date.parse(`${irelandTodayIso()}T12:00:00Z`) + 3 * 86_400_000).toISOString().slice(0, 10);

const call = (method: string, path: string, resident: string, body?: unknown) =>
  fetch(`${baseUrl}/games${path}`, { method, headers: { "Content-Type": "application/json", "X-Test-Resident-Id": resident }, body: body === undefined ? undefined : JSON.stringify(body) });
const base = { activityLabel: "Series Run", locationText: "The Pier", date: start, time: "19:00", capacity: 6 };

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
  for (const id of [host, other]) await db.prepare(`INSERT INTO residents (id, email, name) VALUES (?, ?, ?)`).run(id, `${id}@example.test`, id);
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  const ids = ((await db.prepare(`SELECT id FROM games WHERE host_resident_id = ?`).all(host)) as { id: string }[]).map((g) => g.id);
  for (const id of ids) {
    await db.prepare(`DELETE FROM game_participants WHERE game_id = ?`).run(id);
    await db.prepare(`DELETE FROM notifications WHERE listing_id = ?`).run(id);
  }
  await db.prepare(`DELETE FROM games WHERE host_resident_id = ?`).run(host);
  await db.prepare(`DELETE FROM game_series WHERE host_resident_id = ?`).run(host);
  await db.prepare(`DELETE FROM residents WHERE id IN (?, ?)`).run(host, other);
});

describe("weekly series", () => {
  let seriesId = "";
  let gameIds: string[] = [];

  it("refuses venue activities and out-of-range lengths", async () => {
    expect((await call("POST", "/series", host, { ...base, repeatWeeks: 1 })).status).toBe(400);
    expect((await call("POST", "/series", host, { ...base, repeatWeeks: 13 })).status).toBe(400);
    expect((await call("POST", "/series", host, { ...base, centreId: "c", locationText: "", repeatWeeks: 3 })).status).toBe(400);
  });

  it("creates one ordinary activity per week, each with its own seats", async () => {
    const r = await call("POST", "/series", host, { ...base, repeatWeeks: 3 });
    expect(r.status).toBe(201);
    const body = (await r.json()) as { seriesId: string; games: { id: string; date: string; seriesId: string; joined: number }[] };
    seriesId = body.seriesId;
    gameIds = body.games.map((g) => g.id);
    expect(body.games.map((g) => (Date.parse(g.date) - Date.parse(start)) / 86_400_000)).toEqual([0, 7, 14]);
    expect(body.games.every((g) => g.seriesId === seriesId && g.joined === 1)).toBe(true); // the host holds a seat on each
  });

  it("is visible to its host only", async () => {
    expect((await call("GET", `/series/${seriesId}`, other)).status).toBe(403);
    expect(((await (await call("GET", `/series/${seriesId}`, host)).json()) as { games: unknown[] }).games).toHaveLength(3);
  });

  it("cancels only the dates still to come", async () => {
    // Make the first occurrence a past one.
    const past = new Date(Date.parse(`${irelandTodayIso()}T12:00:00Z`) - 2 * 86_400_000).toISOString().slice(0, 10);
    await db.prepare(`UPDATE games SET date = ? WHERE id = ?`).run(past, gameIds[0]);
    expect((await call("POST", `/series/${seriesId}/cancel-remaining`, other, {})).status).toBe(403);
    const r = await call("POST", `/series/${seriesId}/cancel-remaining`, host, {});
    expect(await r.json()).toMatchObject({ ok: true, cancelled: 2 });
    const statuses = (await db.prepare(`SELECT id, status FROM games WHERE series_id = ? ORDER BY date`).all(seriesId)) as { id: string; status: string }[];
    expect(statuses.map((s) => s.status)).toEqual(["open", "cancelled", "cancelled"]);
  });
});

describe("series dates", async () => {
  const { seriesDates } = await import("./games.js");
  it("picks the chosen weekdays between the start and end dates", () => {
    // 2030-01-07 is a Monday.
    expect(seriesDates("2030-01-07", { weekdays: [1, 3], endDate: "2030-01-16" })).toEqual(["2030-01-07", "2030-01-09", "2030-01-14", "2030-01-16"]);
  });
  it("refuses an empty, backwards, too-long or single-date series", () => {
    expect(seriesDates("2030-01-07", { weekdays: [], endDate: "2030-01-20" })).toMatch(/weekday/);
    expect(seriesDates("2030-01-07", { weekdays: [1], endDate: "2030-01-01" })).toMatch(/end date/);
    expect(seriesDates("2030-01-07", { weekdays: [1], endDate: "2030-06-01" })).toMatch(/up to 12 weeks/);
    expect(seriesDates("2030-01-07", { weekdays: [1], endDate: "2030-01-08" })).toMatch(/at least two/);
  });
});
