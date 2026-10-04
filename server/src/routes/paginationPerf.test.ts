import crypto from "node:crypto";
import http, { type Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, expect, it } from "vitest";
import { db } from "../db/index.js";
import { irelandTodayIso } from "../irelandTime.js";
import { circlesRouter } from "./circles.js";
import { gamesRouter } from "./games.js";
import { residentsRouter } from "./residents.js";

// HC-QA-073 — measurement only (prints a JSON line; asserts nothing about
// speed). Same dataset size as the Phase 10 finding: ~2,000 activities,
// 300 Circles, 2,000 notifications. Run on the code before and after.

const run = crypto.randomUUID().slice(0, 8);
const TAG = `PERF${run}`;
const host = `test-perf-host-${run}`;
let server: Server; let base: string;
let viewer: string | null = null;
let queries = 0;

async function bulk(table: string, cols: string[], rows: unknown[][]) {
  for (let i = 0; i < rows.length; i += 400) {
    const chunk = rows.slice(i, i + 400);
    await db.prepare(`INSERT INTO ${table} (${cols.join(", ")}) VALUES ${chunk.map(() => `(${cols.map(() => "?").join(", ")})`).join(", ")}`).run(...chunk.flat());
  }
}

beforeAll(async () => {
  await db.prepare(`INSERT INTO residents (id, email, name) VALUES (?, ?, ?)`).run(host, `${host}@example.test`, host);
  const d = (o: number) => { const x = new Date(`${irelandTodayIso()}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + o); return x.toISOString().slice(0, 10); };
  await bulk("games", ["id", "host_resident_id", "activity_label", "location_text", "date", "time", "capacity", "price_cents", "visibility", "status"],
    Array.from({ length: 2000 }, (_, i) => [`${TAG}-g-${i}`, host, `${TAG} Football`, "QA", d(1 + (i % 40)), "18:00", 10, 0, "public", "open"]));
  await bulk("circles", ["id", "name", "activity_label", "area", "county", "about", "created_by_resident_id", "join_mode", "status"],
    Array.from({ length: 300 }, (_, i) => [`${TAG}-c-${i}`, `${TAG} Circle ${i}`, `${TAG} Run`, "A", "Dublin", "x", host, "open", "active"]));
  await bulk("notifications", ["recipient_id", "resident_id", "kind", "title", "body", "listing_type", "listing_id", "ref"],
    Array.from({ length: 2000 }, (_, i) => ["", host, "game", `${TAG} n${i}`, "b", "game", "x", "x"]));
  const orig = db.prepare.bind(db);
  (db as any).prepare = (sql: string) => { queries++; return orig(sql); };
  const app = express();
  app.use((req, _res, next) => { if (viewer) (req as any).resident = { id: viewer, name: viewer }; next(); });
  app.use("/games", gamesRouter); app.use("/circles", circlesRouter); app.use("/residents", residentsRouter);
  server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
}, 120_000);

afterAll(async () => {
  await db.prepare(`DELETE FROM games WHERE id LIKE ?`).run(`${TAG}-%`);
  await db.prepare(`DELETE FROM circles WHERE id LIKE ?`).run(`${TAG}-%`);
  await db.prepare(`DELETE FROM notifications WHERE resident_id = ?`).run(host);
  await db.prepare(`DELETE FROM residents WHERE id = ?`).run(host);
  await new Promise<void>((r) => server.close(() => r()));
});

it("measures list endpoints (default request)", async () => {
  const out: Record<string, unknown> = {};
  for (const [name, path, who] of [["games", "/games", null], ["circles", "/circles", null], ["notifications", "/residents/me/notifications", host]] as const) {
    viewer = who;
    const times: number[] = []; let bytes = 0; let count = 0; let q = 0;
    for (let i = 0; i < 5; i++) {
      queries = 0;
      const t = performance.now();
      const res = await fetch(base + path);
      const text = await res.text();
      times.push(performance.now() - t);
      bytes = text.length; count = (JSON.parse(text) as unknown[]).length; q = queries;
    }
    times.sort((a, b) => a - b);
    out[name] = { records: count, bytes, medianMs: Math.round(times[2]), queries: q };
  }
  console.log(`PERF_RESULT ${JSON.stringify(out)}`);
  expect(true).toBe(true);
}, 180_000);
