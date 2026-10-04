import crypto from "node:crypto";
import http, { type Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../db/index.js";
import { irelandTodayIso } from "../irelandTime.js";
import { circlesRouter } from "./circles.js";
import { gamesRouter } from "./games.js";
import { residentsRouter } from "./residents.js";

// HC-QA-073 — server-side keyset pagination with a large synthetic dataset:
// no duplicates, no missing records, stable order, correct end condition,
// filters/search applied, visibility preserved, per-user isolation, and an
// insertion between page requests causes no duplicate/skip.

const run = crypto.randomUUID().slice(0, 8);
const TAG = `PAGT${run}`;
const hostId = `test-pag-host-${run}`;
const residentA = `test-pag-a-${run}`;
const residentB = `test-pag-b-${run}`;
let server: Server;
let base: string;
let viewer: string | null = null;

const dayIso = (offset: number) => { const d = new Date(`${irelandTodayIso()}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + offset); return d.toISOString().slice(0, 10); };
const publicIds: string[] = [];
const hiddenIds: string[] = [];
const circleIds: { open: string[]; restricted: string[] } = { open: [], restricted: [] };

async function bulk(table: string, cols: string[], rows: unknown[][]) {
  for (let i = 0; i < rows.length; i += 400) {
    const chunk = rows.slice(i, i + 400);
    await db.prepare(`INSERT INTO ${table} (${cols.join(", ")}) VALUES ${chunk.map(() => `(${cols.map(() => "?").join(", ")})`).join(", ")}`).run(...chunk.flat());
  }
}

async function walk(path: string, limit: number) {
  const ids: string[] = [];
  const pages: number[] = [];
  let cursor: string | null = null;
  for (let guard = 0; guard < 200; guard++) {
    const sep = path.includes("?") ? "&" : "?";
    const res = await fetch(`${base}${path}${sep}limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string | number }[];
    pages.push(body.length);
    ids.push(...body.map((r) => String(r.id)));
    cursor = res.headers.get("x-next-cursor");
    if (!cursor) break;
  }
  return { ids, pages };
}

beforeAll(async () => {
  for (const id of [hostId, residentA, residentB]) await db.prepare(`INSERT INTO residents (id, email, name) VALUES (?, ?, ?)`).run(id, `${id}@example.test`, id);
  const cols = ["id", "host_resident_id", "activity_label", "location_text", "date", "time", "capacity", "price_cents", "visibility", "status", "lifecycle", "publish_at"];
  const rows: unknown[][] = [];
  for (let i = 0; i < 2000; i++) {
    const id = `${TAG}-g-${String(i).padStart(4, "0")}`;
    publicIds.push(id);
    // Many identical (date, time) pairs on purpose — the id tie-breaker must keep order total.
    rows.push([id, hostId, `${TAG} ${i % 3 === 0 ? "Badminton" : "Football"}`, "QA park", dayIso(1 + (i % 40)), i % 2 ? "18:00" : "10:00", 10, i % 5 === 0 ? 0 : 800, "public", "open", "active", null]);
  }
  const hidden: [string, Partial<Record<"visibility" | "status" | "lifecycle" | "publish_at" | "date", unknown>>][] = [];
  for (let i = 0; i < 40; i++) {
    hidden.push([`${TAG}-inv-${i}`, { visibility: "invite" }], [`${TAG}-cir-${i}`, { visibility: "circle" }], [`${TAG}-draft-${i}`, { lifecycle: "draft" }],
      [`${TAG}-sched-${i}`, { publish_at: new Date(Date.now() + 7 * 86_400_000) }], [`${TAG}-canc-${i}`, { status: "cancelled" }], [`${TAG}-past-${i}`, { date: dayIso(-3) }]);
  }
  for (const [id, o] of hidden) {
    hiddenIds.push(id);
    rows.push([id, hostId, `${TAG} Hidden`, "QA park", o.date ?? dayIso(5), "12:00", 10, 0, o.visibility ?? "public", o.status ?? "open", o.lifecycle ?? "active", o.publish_at ?? null]);
  }
  await bulk("games", cols, rows);

  const crows: unknown[][] = [];
  for (let i = 0; i < 300; i++) {
    const id = `${TAG}-c-${String(i).padStart(3, "0")}`;
    const mode = i < 200 ? "open" : i < 250 ? "approval" : "invite";
    (mode === "open" ? circleIds.open : circleIds.restricted).push(id);
    crows.push([id, `${TAG} Circle ${String(i % 60).padStart(2, "0")}`, `${TAG} ${i % 2 ? "Running" : "Books"}`, "QA Area", "Dublin", "Synthetic", hostId, mode, "active"]);
  }
  await bulk("circles", ["id", "name", "activity_label", "area", "county", "about", "created_by_resident_id", "join_mode", "status"], crows);

  const nrows: unknown[][] = [];
  for (let i = 0; i < 2000; i++) nrows.push(["", residentA, "game", `${TAG} n${i}`, "b", "game", "x", "x", i % 3 === 0 ? 0 : 1]);
  for (let i = 0; i < 50; i++) nrows.push(["", residentB, "game", `${TAG} other${i}`, "b", "game", "x", "x", 0]);
  await bulk("notifications", ["recipient_id", "resident_id", "kind", "title", "body", "listing_type", "listing_id", "ref", "`read`"], nrows);

  const app = express();
  app.use((req, _res, next) => { if (viewer) (req as any).resident = { id: viewer, name: viewer }; next(); });
  app.use("/games", gamesRouter);
  app.use("/circles", circlesRouter);
  app.use("/residents", residentsRouter);
  server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
}, 120_000);

afterAll(async () => {
  await db.prepare(`DELETE FROM games WHERE id LIKE ?`).run(`${TAG}-%`);
  await db.prepare(`DELETE FROM circles WHERE id LIKE ?`).run(`${TAG}-%`);
  await db.prepare(`DELETE FROM notifications WHERE resident_id IN (?, ?)`).run(residentA, residentB);
  await db.prepare(`DELETE FROM residents WHERE id IN (?, ?, ?)`).run(hostId, residentA, residentB);
  await new Promise<void>((r) => server.close(() => r()));
});

describe("pagination contract (HC-QA-073)", () => {
  it("bounds the default page and clamps an oversized limit; rejects malformed values", async () => {
    viewer = null;
    const def = await fetch(`${base}/games?q=${TAG}`);
    expect(((await def.json()) as unknown[]).length).toBe(50);
    expect(def.headers.get("x-next-cursor")).toBeTruthy();
    const huge = await fetch(`${base}/games?q=${TAG}&limit=1000000`);
    expect(((await huge.json()) as unknown[]).length).toBe(100);
    for (const bad of ["limit=abc", "limit=0", "limit=-5", "cursor=not-a-cursor", `cursor=${Buffer.from("[1]").toString("base64url")}`]) {
      expect((await fetch(`${base}/games?${bad}`)).status, bad).toBe(400);
    }
    expect((await fetch(`${base}/circles?limit=xyz`)).status).toBe(400);
    viewer = residentA;
    expect((await fetch(`${base}/residents/me/notifications?cursor=%%%`)).status).toBe(400);
  });
});

describe("activities", () => {
  it("walks 2,000+ public activities with no duplicates, no missing records, stable total order — and never a private/draft/scheduled/cancelled/past one", async () => {
    viewer = null;
    const { ids, pages } = await walk(`/games?q=${TAG}`, 100);
    const mine = ids.filter((id) => id.startsWith(TAG));
    expect(new Set(mine).size, "no duplicates").toBe(mine.length);
    expect(new Set(mine)).toEqual(new Set(publicIds));
    for (const h of hiddenIds) expect(mine, `${h} must never leak through pagination`).not.toContain(h);
    expect(pages.at(-1)!).toBeLessThanOrEqual(100);
    // Same walk again → identical order (stable).
    expect((await walk(`/games?q=${TAG}`, 100)).ids).toEqual(ids);
  }, 120_000);

  it("keeps filters and search applied across pages", async () => {
    viewer = null;
    const free = await walk(`/games?q=${TAG}%20badminton&priceMax=0`, 37);
    const expected = publicIds.filter((_, i) => i % 3 === 0 && i % 5 === 0);
    expect(new Set(free.ids)).toEqual(new Set(expected));
    expect(new Set(free.ids).size).toBe(free.ids.length);
  }, 120_000);

  it("HC-QA-101: centreId filters in the query — a venue's activities are found even behind 2,000 earlier ones, and a hidden one never leaks", async () => {
    viewer = null;
    const centre = `${TAG}-centre`;
    const mine = publicIds.filter((_, i) => i % 40 === 39).slice(0, 3); // the latest dates in the set
    const draft = hiddenIds.find((id) => id.includes("-draft-"))!;
    await db.prepare(`UPDATE games SET centre_id = ? WHERE id IN (?, ?, ?, ?)`).run(centre, ...mine, draft);
    const res = await fetch(`${base}/games?centreId=${encodeURIComponent(centre)}`);
    expect(res.status).toBe(200);
    const ids = ((await res.json()) as { id: string }[]).map((g) => g.id);
    expect(new Set(ids)).toEqual(new Set(mine));
    expect(res.headers.get("x-next-cursor"), "single short page").toBeNull();
  });

  it("an activity inserted between page requests causes no duplicate or skip", async () => {
    viewer = null;
    const first = await fetch(`${base}/games?q=${TAG}&limit=100`);
    const page1 = ((await first.json()) as { id: string }[]).map((g) => g.id);
    const late = `${TAG}-late`;
    const early = `${TAG}-early`;
    await db.prepare(`INSERT INTO games (id, host_resident_id, activity_label, location_text, date, time, capacity, price_cents, visibility, status, lifecycle) VALUES (?, ?, ?, 'QA', ?, '23:00', 5, 0, 'public', 'open', 'active'), (?, ?, ?, 'QA', ?, '00:00', 5, 0, 'public', 'open', 'active')`)
      .run(late, hostId, `${TAG} Late`, dayIso(39), early, hostId, `${TAG} Early`, dayIso(1));
    let cursor = first.headers.get("x-next-cursor");
    const rest: string[] = [];
    while (cursor) {
      const r = await fetch(`${base}/games?q=${TAG}&limit=100&cursor=${encodeURIComponent(cursor)}`);
      rest.push(...((await r.json()) as { id: string }[]).map((g) => g.id));
      cursor = r.headers.get("x-next-cursor");
    }
    const all = [...page1, ...rest];
    expect(new Set(all).size, "no duplicates after an insert").toBe(all.length);
    expect(rest, "an item after the cursor is picked up").toContain(late);
    for (const id of publicIds) expect(all).toContain(id);
  }, 120_000);
});

describe("Circles", () => {
  it("walks all 300 Circles exactly once; restricted Circles stay teasers for an unrelated user and a guest; activity filter applied", async () => {
    for (const who of [null, residentB]) {
      viewer = who;
      const { ids } = await walk(`/circles?q=${TAG}`, 41);
      expect(new Set(ids).size).toBe(ids.length);
      expect(new Set(ids)).toEqual(new Set([...circleIds.open, ...circleIds.restricted]));
    }
    viewer = residentB;
    const page = (await (await fetch(`${base}/circles?q=${TAG}&limit=100&activity=${encodeURIComponent(`${TAG} Running`)}`)).json()) as { id: string; activityLabel: string; createdByResidentId?: string }[];
    expect(page.every((c) => c.activityLabel === `${TAG} Running`), "activity filter applied").toBe(true);
    const restricted = page.filter((c) => circleIds.restricted.includes(c.id));
    expect(restricted.length).toBeGreaterThan(0);
    expect(restricted.every((c) => !c.createdByResidentId), "teaser hides organiser identity").toBe(true);
  }, 120_000);
});

describe("notifications", () => {
  it("walks 2,000 of one resident's notifications newest-first with no duplicates, never another resident's, and a true unread total", async () => {
    viewer = residentA;
    const { ids } = await walk(`/residents/me/notifications`, 100);
    const own = (await db.prepare(`SELECT id FROM notifications WHERE resident_id = ? ORDER BY created_at DESC, id DESC`).all(residentA)) as { id: number }[];
    expect(ids).toEqual(own.map((r) => String(r.id)));
    const others = (await db.prepare(`SELECT id FROM notifications WHERE resident_id = ?`).all(residentB)) as { id: number }[];
    for (const o of others) expect(ids).not.toContain(String(o.id));
    const res = await fetch(`${base}/residents/me/notifications?limit=10`);
    const unread = (await db.prepare("SELECT COUNT(*) as n FROM notifications WHERE resident_id = ? AND `read` = 0").get(residentA)) as { n: number };
    expect(Number(res.headers.get("x-unread-count"))).toBe(Number(unread.n));
    // A forged cursor pointing anywhere still only ever returns the caller's own rows.
    const forged = Buffer.from(JSON.stringify(["2999-01-01 00:00:00", 2147483647])).toString("base64url");
    const f = (await (await fetch(`${base}/residents/me/notifications?limit=100&cursor=${forged}`)).json()) as { id: number }[];
    const ownSet = new Set(own.map((r) => String(r.id)));
    expect(f.every((n) => ownSet.has(String(n.id))), "cursor can't reach another user's notifications").toBe(true);
  }, 120_000);
});
