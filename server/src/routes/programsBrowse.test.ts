import crypto from "node:crypto";
import http, { type Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../db/index.js";
import { irelandTodayIso } from "../irelandTime.js";
import { programsRouter } from "./programs.js";

// /programs browse page — GET /programs with no venue lists every published
// program at an approved venue that still has an upcoming session (real
// hello_circle_dev, temporary sessions removed afterwards).

let server: Server;
let baseUrl: string;
const run = crypto.randomUUID().slice(0, 8);
let published: { id: string; county: string };
let archivedId: string;
let upcomingBefore = 0;

beforeAll(async () => {
  const app = express();
  app.use("/programs", programsRouter);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Failed to bind test server");
  baseUrl = `http://127.0.0.1:${address.port}`;

  published = (await db
    .prepare(
      `SELECT p.id, c.county FROM programs p JOIN centres c ON c.id = p.listing_id
       WHERE p.status = 'published' AND p.listing_type = 'centre' AND c.status = 'approved' LIMIT 1`
    )
    .get()) as typeof published;
  archivedId = ((await db.prepare(`SELECT id FROM programs WHERE status != 'published' LIMIT 1`).get()) as { id: string }).id;
  upcomingBefore = Number(
    ((await db.prepare(`SELECT COUNT(*) as n FROM program_sessions WHERE program_id = ? AND status != 'cancelled' AND date >= ?`).get(published.id, irelandTodayIso())) as { n: number }).n
  );
  const future = (days: number) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
  await db
    .prepare(`INSERT INTO program_sessions (id, program_id, date, time) VALUES (?, ?, ?, '18:00'), (?, ?, ?, '18:00'), (?, ?, ?, '10:00')`)
    .run(`tmp-a-${run}`, published.id, future(5), `tmp-b-${run}`, published.id, future(12), `tmp-c-${run}`, archivedId, future(2));
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await db.prepare(`DELETE FROM program_sessions WHERE id LIKE ?`).run(`tmp-%-${run}`);
});

describe("GET /programs (browse)", () => {
  it("lists published programs with their next session, never unpublished ones", async () => {
    const list = (await (await fetch(`${baseUrl}/programs`)).json()) as { id: string; upcomingSessions: number; nextSessionDate: string; county: string }[];
    const mine = list.find((p) => p.id === published.id);
    // Relative to what the seed already had — the two temporary sessions add exactly 2.
    expect(mine).toMatchObject({ upcomingSessions: upcomingBefore + 2, county: published.county });
    expect(list.some((p) => p.id === archivedId)).toBe(false);
    const dates = list.map((p) => p.nextSessionDate);
    expect(dates).toEqual([...dates].sort());
  });

  it("filters by county, and a venue query still returns that venue's programs", async () => {
    const other = (await (await fetch(`${baseUrl}/programs?county=Nowhere-${run}`)).json()) as unknown[];
    expect(other).toEqual([]);
    const inCounty = (await (await fetch(`${baseUrl}/programs?county=${encodeURIComponent(published.county)}`)).json()) as { id: string }[];
    expect(inCounty.some((p) => p.id === published.id)).toBe(true);
  });
});
