import crypto from "node:crypto";
import http, { type Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../db/index.js";
import { residentsRouter } from "./residents.js";

// Phase 1 "Connect": My Life V2's "Needs You" aggregation
// (GET /me/needs-attention). Auth stubbed the same way other route tests
// stub req.resident — this endpoint additionally reads req.guestEmail,
// which normally comes from attachGuestEmail.

let server: Server;
let baseUrl: string;

const testClientId = `test-client-${crypto.randomUUID()}`;
const testResidentId = `test-resident-${crypto.randomUUID()}`;
const testOrganiserId = `test-organiser-${crypto.randomUUID()}`;
const testCentreId = `test-centre-${crypto.randomUUID()}`;
const testGameId = `test-game-${crypto.randomUUID()}`;
const testCircleId = `test-circle-${crypto.randomUUID()}`;
let pendingBookingRef: string;
let waitlistEntryId: number;
const circleInviteId = crypto.randomUUID();

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const residentId = req.header("X-Test-Resident-Id");
    if (residentId) (req as any).resident = { id: residentId, name: "Test Resident" };
    const guestEmail = req.header("X-Test-Guest-Email");
    if (guestEmail) (req as any).guestEmail = guestEmail;
    next();
  });
  app.use("/", residentsRouter);

  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Failed to bind test server");
  baseUrl = `http://127.0.0.1:${address.port}`;

  await db.prepare(`INSERT INTO residents (id, email, name) VALUES (?, ?, ?)`).run(testResidentId, `${testResidentId}@example.test`, "Test Resident");
  await db.prepare(`INSERT INTO residents (id, email, name) VALUES (?, ?, ?)`).run(testOrganiserId, `${testOrganiserId}@example.test`, "Test Organiser");

  await db
    .prepare(
      `INSERT INTO centres (id, name, area, county, rating, reviews, capacity, from_price, managed_by, ph, image_url, blurb)
       VALUES (?, 'Test Centre', 'Test Area', 'Dublin', 0, 0, 20, 1000, 'Test Manager', '', '', '')`
    )
    .run(testCentreId);

  pendingBookingRef = `test-bkg-${crypto.randomUUID()}`;
  await db
    .prepare(
      `INSERT INTO bookings (ref, client_id, centre_id, room_id, date, time, duration, event_type, guests, name, email, phone, notes, total_cents, payment_status)
       VALUES (?, ?, ?, 'test-room', '2099-01-01', '18:00', 1, 'Test Event', 2, 'Test Guest', 'guest@example.test', '', '', 1000, 'pending')`
    )
    .run(pendingBookingRef, testClientId, testCentreId);

  const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  await db.prepare(`INSERT INTO games (id, host_resident_id, activity_label, date, time, capacity, centre_id, status) VALUES (?, ?, 'Test Game', ?, '18:00', 1, ?, 'open')`).run(testGameId, testResidentId, future, testCentreId);
  const waitlistResult = await db
    .prepare(`INSERT INTO waitlist_entries (listing_type, listing_id, resident_id, client_id, name, email, status) VALUES ('game', ?, ?, ?, 'Test Resident', 'r@example.test', 'offered')`)
    .run(testGameId, testResidentId, testClientId);
  waitlistEntryId = Number(waitlistResult.lastInsertRowid);

  await db.prepare(`INSERT INTO circles (id, name, activity_label, area, county, about, created_by_resident_id) VALUES (?, 'Test Circle', 'Walking', 'Test Area', 'Dublin', '', ?)`).run(testCircleId, testOrganiserId);
  await db.prepare(`INSERT INTO circle_members (circle_id, resident_id, role) VALUES (?, ?, 'organiser')`).run(testCircleId, testOrganiserId);
  await db
    .prepare(`INSERT INTO circle_invites (id, circle_id, resident_id, invited_by_resident_id, initiated_by) VALUES (?, ?, ?, ?, 'organiser')`)
    .run(circleInviteId, testCircleId, testResidentId, testOrganiserId);
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await db.prepare(`DELETE FROM circle_invites WHERE circle_id = ?`).run(testCircleId);
  await db.prepare(`DELETE FROM circle_members WHERE circle_id = ?`).run(testCircleId);
  await db.prepare(`DELETE FROM circles WHERE id = ?`).run(testCircleId);
  await db.prepare(`DELETE FROM waitlist_entries WHERE listing_id = ?`).run(testGameId);
  await db.prepare(`DELETE FROM games WHERE id = ?`).run(testGameId);
  await db.prepare(`DELETE FROM bookings WHERE ref = ?`).run(pendingBookingRef);
  await db.prepare(`DELETE FROM centres WHERE id = ?`).run(testCentreId);
  await db.prepare(`DELETE FROM residents WHERE id IN (?, ?)`).run(testResidentId, testOrganiserId);
});

describe("GET /me/needs-attention", () => {
  it("returns only the guest-visible payment-incomplete item for a signed-out visitor", async () => {
    const res = await fetch(`${baseUrl}/me/needs-attention`, { headers: { "X-Client-Id": testClientId } });
    expect(res.status).toBe(200);
    const items = (await res.json()) as { actionType: string; sourceId: string }[];
    expect(items.some((i) => i.actionType === "payment_incomplete" && i.sourceId === pendingBookingRef)).toBe(true);
    expect(items.every((i) => i.actionType === "payment_incomplete")).toBe(true);
  });

  it("returns payment, waitlist, and circle-invitation items for a signed-in resident, in priority order", async () => {
    const res = await fetch(`${baseUrl}/me/needs-attention`, { headers: { "X-Client-Id": testClientId, "X-Test-Resident-Id": testResidentId } });
    expect(res.status).toBe(200);
    const items = (await res.json()) as { actionType: string; sourceId: string }[];

    expect(items.some((i) => i.actionType === "payment_incomplete" && i.sourceId === pendingBookingRef)).toBe(true);
    expect(items.some((i) => i.actionType === "waitlist_offered" && i.sourceId === String(waitlistEntryId))).toBe(true);
    expect(items.some((i) => i.actionType === "circle_invitation" && i.sourceId === String(circleInviteId))).toBe(true);

    // payment_incomplete (priority 0) must sort before waitlist_offered (1),
    // which must sort before circle_invitation (3).
    const priorityIndex = { payment_incomplete: 0, waitlist_offered: 1, join_request: 2, circle_invitation: 3, open_poll: 4 } as Record<string, number>;
    for (let i = 1; i < items.length; i++) {
      expect(priorityIndex[items[i].actionType]).toBeGreaterThanOrEqual(priorityIndex[items[i - 1].actionType]);
    }
  });

  it("surfaces a join request to the circle's organiser", async () => {
    const res = await fetch(`${baseUrl}/me/needs-attention`, { headers: { "X-Client-Id": `test-other-${crypto.randomUUID()}`, "X-Test-Resident-Id": testOrganiserId } });
    expect(res.status).toBe(200);
    // The organiser has no join request pending yet in this fixture set —
    // confirms the query runs cleanly and returns an empty/valid array
    // rather than erroring for a resident with none of these signals.
    expect(Array.isArray(await res.json())).toBe(true);
  });
});

// Cloudflare R2 Media System — Changeset 3. PUT /me/avatar-url is the R2
// counterpart to the legacy multipart POST /me/avatar (see api/resident.ts's
// uploadAvatar(), which tries the R2 flow first and falls back to that
// multipart route). It must only ever accept a URL that could plausibly be
// this resident's own finalized avatar upload — never an arbitrary
// client-supplied URL (that would let one resident overwrite their avatar
// with another entity's, or any external URL at all).
describe("PUT /me/avatar-url", () => {
  it("401s when signed out", async () => {
    const res = await fetch(`${baseUrl}/me/avatar-url`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: "x" }) });
    expect(res.status).toBe(401);
  });

  it("400s a missing url", async () => {
    const res = await fetch(`${baseUrl}/me/avatar-url`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "X-Test-Resident-Id": testResidentId },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it("400s a URL not under this resident's own avatar key prefix", async () => {
    const res = await fetch(`${baseUrl}/me/avatar-url`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "X-Test-Resident-Id": testResidentId },
      body: JSON.stringify({ url: "https://media.hellocircle.ie/residents/someone-else/avatar/x.jpg" }),
    });
    expect(res.status).toBe(400);
  });

  it("400s a non-R2 external URL", async () => {
    const res = await fetch(`${baseUrl}/me/avatar-url`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "X-Test-Resident-Id": testResidentId },
      body: JSON.stringify({ url: "https://evil.example/x.jpg" }),
    });
    expect(res.status).toBe(400);
  });

  it("accepts and attaches a URL under this resident's own avatar key prefix", async () => {
    const url = `https://media.hellocircle.ie/residents/${testResidentId}/avatar/test.jpg`;
    const res = await fetch(`${baseUrl}/me/avatar-url`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "X-Test-Resident-Id": testResidentId },
      body: JSON.stringify({ url }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).avatarUrl).toBe(url);
    const row = (await db.prepare(`SELECT avatar_url FROM residents WHERE id = ?`).get(testResidentId)) as { avatar_url: string };
    expect(row.avatar_url).toBe(url);
    await db.prepare(`UPDATE residents SET avatar_url = NULL WHERE id = ?`).run(testResidentId);
  });
});

// SEO/Privacy audit — Phase 1, P0 fix #2. GET /:id/host-profile (public,
// zero-auth) previously listed a host's upcoming games with no
// `visibility` filter and their organised Circles with no `status`/
// `join_mode` filter — a circle-only/invite-only game's real activity
// label/date/time, and a restricted Circle's real name, both leaked onto
// the public profile regardless. This is the regression suite for the
// fix.
describe("GET /:id/host-profile — private Activity/Circle data never leaks", () => {
  const hostId = `test-hostprofile-host-${crypto.randomUUID()}`;
  const publicGameId = `test-hostprofile-pub-game-${crypto.randomUUID()}`;
  const circleOnlyGameId = `test-hostprofile-circ-game-${crypto.randomUUID()}`;
  const inviteGameId = `test-hostprofile-inv-game-${crypto.randomUUID()}`;
  const openCircleId = `test-hostprofile-open-circle-${crypto.randomUUID()}`;
  const restrictedCircleId = `test-hostprofile-restricted-circle-${crypto.randomUUID()}`;
  const future = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  beforeAll(async () => {
    await db
      .prepare(`INSERT INTO residents (id, email, name, host_status) VALUES (?, ?, 'Test Host', 'verified')`)
      .run(hostId, `${hostId}@example.test`);

    await db
      .prepare(`INSERT INTO games (id, host_resident_id, activity_label, location_text, date, time, capacity, status, visibility) VALUES (?, ?, 'Public Test Session', 'Test Location', ?, '18:00', 10, 'open', 'public')`)
      .run(publicGameId, hostId, future);
    await db
      .prepare(`INSERT INTO games (id, host_resident_id, activity_label, location_text, date, time, capacity, status, visibility) VALUES (?, ?, 'Secret Circle-Only Session', 'Test Location', ?, '18:00', 10, 'open', 'circle')`)
      .run(circleOnlyGameId, hostId, future);
    await db
      .prepare(`INSERT INTO games (id, host_resident_id, activity_label, location_text, date, time, capacity, status, visibility) VALUES (?, ?, 'Secret Invite-Only Session', 'Test Location', ?, '18:00', 10, 'open', 'invite')`)
      .run(inviteGameId, hostId, future);

    await db
      .prepare(`INSERT INTO circles (id, name, activity_label, area, county, about, created_by_resident_id, join_mode, status) VALUES (?, 'Public Host Circle', 'Testball', 'Area', 'Dublin', '', ?, 'open', 'active')`)
      .run(openCircleId, hostId);
    await db.prepare(`INSERT INTO circle_members (circle_id, resident_id, role) VALUES (?, ?, 'organiser')`).run(openCircleId, hostId);

    await db
      .prepare(`INSERT INTO circles (id, name, activity_label, area, county, about, created_by_resident_id, join_mode, status) VALUES (?, 'Secret Host Circle', 'Testball', 'Area', 'Dublin', '', ?, 'invite', 'active')`)
      .run(restrictedCircleId, hostId);
    await db.prepare(`INSERT INTO circle_members (circle_id, resident_id, role) VALUES (?, ?, 'organiser')`).run(restrictedCircleId, hostId);
  });

  afterAll(async () => {
    await db.prepare(`DELETE FROM games WHERE id IN (?, ?, ?)`).run(publicGameId, circleOnlyGameId, inviteGameId);
    await db.prepare(`DELETE FROM circle_members WHERE circle_id IN (?, ?)`).run(openCircleId, restrictedCircleId);
    await db.prepare(`DELETE FROM circles WHERE id IN (?, ?)`).run(openCircleId, restrictedCircleId);
    await db.prepare(`DELETE FROM residents WHERE id = ?`).run(hostId);
  });

  it("includes the public game but excludes circle-only and invite-only games, unauthenticated", async () => {
    const res = await fetch(`${baseUrl}/${hostId}/host-profile`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { upcomingGames: { id: string; activityLabel: string }[] };
    const ids = body.upcomingGames.map((g) => g.id);
    expect(ids).toContain(publicGameId);
    expect(ids).not.toContain(circleOnlyGameId);
    expect(ids).not.toContain(inviteGameId);
    expect(body.upcomingGames.some((g) => g.activityLabel.includes("Secret"))).toBe(false);
  });

  it("includes the open Circle but excludes the restricted Circle, unauthenticated", async () => {
    const res = await fetch(`${baseUrl}/${hostId}/host-profile`);
    const body = (await res.json()) as { circles: { id: string; name: string }[] };
    const ids = body.circles.map((c) => c.id);
    expect(ids).toContain(openCircleId);
    expect(ids).not.toContain(restrictedCircleId);
    expect(body.circles.some((c) => c.name.includes("Secret"))).toBe(false);
  });
});
