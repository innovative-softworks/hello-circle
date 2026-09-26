import crypto from "node:crypto";
import http, { type Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../db/index.js";
import { bookingsRouter } from "./bookings.js";
import { gamesRouter } from "./games.js";
import { participationIntentsRouter } from "./participationIntents.js";

// Community participation upgrade, Release 1 — real-DB tests (same
// hello_circle_dev + stubbed-identity approach as games.test.ts) for the
// post-game next steps, the "I'm interested too" count/event, and the
// attendance field on "my bookings". Every row uses a unique run id so seed
// data can't collide, and everything is deleted afterwards.

let server: Server;
let baseUrl: string;

const run = crypto.randomUUID().slice(0, 8);
const LABEL = `Test Next Steps ${run}`;
const hostId = `test-ns-host-${run}`;
const playerId = `test-ns-player-${run}`;
const outsiderId = `test-ns-outsider-${run}`;
const pastGameId = `test-ns-past-${run}`;
const nextGameId = `test-ns-next-${run}`;
const circleOfficialId = `test-ns-c-official-${run}`;
const circleOpenId = `test-ns-c-open-${run}`;
const circleInviteId = `test-ns-c-invite-${run}`;
const clientA = `test-ns-client-a-${run}`;
const clientB = `test-ns-client-b-${run}`;
const bookingRef = `TNS${run}`.toUpperCase();
let centreId: string;
let county: string;

const iso = (days: number) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);

function get(path: string, headers: Record<string, string> = {}) {
  return fetch(`${baseUrl}${path}`, { headers });
}

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const residentId = req.header("X-Test-Resident-Id");
    if (residentId) (req as any).resident = { id: residentId };
    next();
  });
  app.use("/games", gamesRouter);
  app.use("/intents", participationIntentsRouter);
  app.use("/bookings", bookingsRouter);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Failed to bind test server");
  baseUrl = `http://127.0.0.1:${address.port}`;

  const centre = (await db.prepare(`SELECT id, county FROM centres WHERE status = 'approved' AND county != '' LIMIT 1`).get()) as { id: string; county: string };
  centreId = centre.id;
  county = centre.county;

  for (const [id, name] of [[hostId, "NS Host"], [playerId, "NS Player"], [outsiderId, "NS Outsider"]]) {
    await db.prepare(`INSERT INTO residents (id, email, name) VALUES (?, ?, ?)`).run(id, `${id}@example.test`, name);
  }
  const insertGame = db.prepare(
    `INSERT INTO games (id, host_resident_id, activity_label, centre_id, date, time, capacity, status) VALUES (?, ?, ?, ?, ?, '10:00', 8, 'open')`
  );
  await insertGame.run(pastGameId, hostId, LABEL, centreId, iso(-2));
  await insertGame.run(nextGameId, hostId, LABEL, centreId, iso(5));
  await db.prepare(`INSERT INTO game_participants (game_id, resident_id, status) VALUES (?, ?, 'joined')`).run(pastGameId, hostId);
  await db.prepare(`INSERT INTO game_participants (game_id, resident_id, status) VALUES (?, ?, 'joined')`).run(pastGameId, playerId);

  const insertCircle = db.prepare(
    `INSERT INTO circles (id, name, activity_label, county, about, created_by_resident_id, join_mode) VALUES (?, ?, ?, ?, '', ?, ?)`
  );
  await insertCircle.run(circleOpenId, `Open ${LABEL}`, LABEL, county, hostId, "open");
  await insertCircle.run(circleInviteId, `Invite ${LABEL}`, LABEL, county, hostId, "invite");
  await insertCircle.run(circleOfficialId, `Official ${LABEL}`, LABEL, county, hostId, "approval");
  await db.prepare(`INSERT INTO circle_members (circle_id, resident_id, role) VALUES (?, ?, 'organiser')`).run(circleOpenId, hostId);

  await db
    .prepare(
      `INSERT INTO bookings (ref, centre_id, room_id, date, time, duration, event_type, guests, name, email, phone, notes, total_cents, client_id, payment_status)
       VALUES (?, ?, '', ?, '10:00', 1, '', 1, 'NS Guest', 'ns@example.test', '', '', 1000, ?, 'paid')`
    )
    .run(bookingRef, centreId, iso(-1), clientA);
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await db.prepare(`DELETE FROM game_participants WHERE game_id IN (?, ?)`).run(pastGameId, nextGameId);
  await db.prepare(`DELETE FROM games WHERE id IN (?, ?)`).run(pastGameId, nextGameId);
  await db.prepare(`DELETE FROM circle_members WHERE circle_id IN (?, ?, ?)`).run(circleOfficialId, circleOpenId, circleInviteId);
  await db.prepare(`DELETE FROM circles WHERE id IN (?, ?, ?)`).run(circleOfficialId, circleOpenId, circleInviteId);
  await db.prepare(`DELETE FROM participation_intents WHERE activity_label = ?`).run(LABEL);
  await db.prepare(`DELETE FROM intent_cluster_notifications WHERE activity_label = ?`).run(LABEL);
  await db.prepare(`DELETE FROM attendance WHERE kind = 'booking' AND ref = ?`).run(bookingRef);
  await db.prepare(`DELETE FROM bookings WHERE ref = ?`).run(bookingRef);
  await db.prepare(`DELETE FROM analytics_events WHERE client_id IN (?, ?) OR resident_id IN (?, ?, ?)`).run(clientA, clientB, hostId, playerId, outsiderId);
  await db.prepare(`DELETE FROM analytics_events WHERE metadata LIKE ?`).run(`%${run}%`);
  await db.prepare(`DELETE FROM residents WHERE id IN (?, ?, ?)`).run(hostId, playerId, outsiderId);
});

describe("GET /games/:id/next-steps", () => {
  it("is only for people who were in the game", async () => {
    expect((await get(`/games/${pastGameId}/next-steps`)).status).toBe(401);
    expect((await get(`/games/${pastGameId}/next-steps`, { "X-Test-Resident-Id": outsiderId })).status).toBe(404);
  });

  it("suggests an open Circle nearby (never invite-only) and the host's next session", async () => {
    const res = await get(`/games/${pastGameId}/next-steps`, { "X-Test-Resident-Id": playerId });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.officialCircle).toBeNull();
    expect(body.suggestedCircle).toMatchObject({ id: circleOpenId, members: 1, joinMode: "open", isMember: false });
    expect(body.nextSession).toMatchObject({ id: nextGameId, sameHost: true });
    expect(body.createCircle).toBeNull();
    // Aggregate only — no member list or names anywhere in the payload.
    expect(JSON.stringify(body)).not.toContain("NS Host");
  });

  it("puts the game's own Circle first once it has one", async () => {
    await db.prepare(`UPDATE games SET circle_id = ? WHERE id = ?`).run(circleOfficialId, pastGameId);
    const body = await (await get(`/games/${pastGameId}/next-steps`, { "X-Test-Resident-Id": playerId })).json();
    expect(body.officialCircle).toMatchObject({ id: circleOfficialId, joinMode: "approval" });
    expect(body.suggestedCircle).toBeNull();
    await db.prepare(`UPDATE games SET circle_id = NULL WHERE id = ?`).run(pastGameId);
  });

  it("falls back to 'start a Circle' when there's nothing to join, and skips games already joined", async () => {
    await db.prepare(`UPDATE circles SET status = 'archived' WHERE id IN (?, ?)`).run(circleOpenId, circleOfficialId);
    await db.prepare(`INSERT INTO game_participants (game_id, resident_id, status) VALUES (?, ?, 'joined')`).run(nextGameId, playerId);
    const body = await (await get(`/games/${pastGameId}/next-steps`, { "X-Test-Resident-Id": playerId })).json();
    expect(body.suggestedCircle).toBeNull();
    expect(body.nextSession).toBeNull();
    expect(body.createCircle).toEqual({ activityLabel: LABEL, county });
    await db.prepare(`UPDATE circles SET status = 'active' WHERE id IN (?, ?)`).run(circleOpenId, circleOfficialId);
    await db.prepare(`DELETE FROM game_participants WHERE game_id = ? AND resident_id = ?`).run(nextGameId, playerId);
  });
});

describe("intents: \"I'm interested too\"", () => {
  const post = (clientId: string) =>
    fetch(`${baseUrl}/intents`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Client-Id": clientId },
      body: JSON.stringify({ activityLabel: LABEL, county, preferredTimeWindow: "Sunday morning" }),
    });
  const count = (clientId?: string) =>
    get(`/intents/count?activityLabel=${encodeURIComponent(LABEL)}&county=${encodeURIComponent(county)}`, clientId ? { "X-Client-Id": clientId } : {}).then((r) => r.json());

  it("reports the caller's own intent, and logs joining existing demand separately", async () => {
    expect(await count(clientA)).toMatchObject({ count: 0, residentCount: 0, myIntentId: null });

    const { id } = await (await post(clientA)).json();
    expect(await count(clientA)).toMatchObject({ count: 1, myIntentId: id });
    expect(await count(clientB)).toMatchObject({ count: 1, myIntentId: null });

    await post(clientB);
    // logEvent is fire-and-forget (never blocks the request), so poll briefly.
    let events: { clientId: string; eventType: string }[] = [];
    for (let i = 0; i < 20 && events.length < 2; i++) {
      await new Promise((r) => setTimeout(r, 50));
      events = (await db
        .prepare(`SELECT client_id as clientId, event_type as eventType FROM analytics_events WHERE client_id IN (?, ?) AND event_type IN ('intent_created', 'request_interest_added')`)
        .all(clientA, clientB)) as { clientId: string; eventType: string }[];
    }
    expect(events).toContainEqual({ clientId: clientA, eventType: "intent_created" });
    expect(events).toContainEqual({ clientId: clientB, eventType: "request_interest_added" });

    // Resubmitting doesn't count the same person twice.
    await post(clientB);
    expect((await count()).count).toBe(2);
  });
});

describe("GET /bookings — attendance", () => {
  it("is null until the vendor checks the booking in, then 'present'", async () => {
    const find = async () => ((await (await get(`/bookings`, { "X-Client-Id": clientA })).json()) as { ref: string; attendance: string | null }[]).find((b) => b.ref === bookingRef);
    expect((await find())?.attendance).toBeNull();
    await db.prepare(`INSERT INTO attendance (kind, ref, checked_in_by) VALUES ('booking', ?, 'test')`).run(bookingRef);
    expect((await find())?.attendance).toBe("present");
  });
});
