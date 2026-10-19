import crypto from "node:crypto";
import http, { type Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "./db/index.js";
import { ModerationError, applyReportAction, reinstateListing, resolveReportTarget } from "./reportModeration.js";
import { chatRouter } from "./routes/chat.js";
import { circlesRouter } from "./routes/circles.js";
import { reportsRouter } from "./routes/reports.js";

// OG-03 / OG-18 / OG-32 — moderation changes the reported content's real state,
// once; organisers can remove messages and mute members in their own Circle.

let server: Server;
let baseUrl: string;
const t = crypto.randomUUID().slice(0, 8);
const organiser = `test-mod-org-${t}`;
const member = `test-mod-mem-${t}`;
const circleId = `test-mod-circle-${t}`;
const gameId = `test-mod-game-${t}`;
const vendorId = `test-mod-vendor-${t}`;
const centreId = `test-mod-centre-${t}`;
const admin = `test-mod-admin-${t}`;
const reason = { category: "terms_breach", explanation: "Abusive language aimed at another member of the group.", internalNote: null };

const as = (resident: string, init: RequestInit = {}) => ({ ...init, headers: { "Content-Type": "application/json", "X-Test-Resident-Id": resident, "X-Client-Id": `c-${resident}`, ...(init.headers ?? {}) } });

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const id = req.header("X-Test-Resident-Id");
    if (id) (req as any).resident = { id, name: `Resident ${id.slice(-4)}`, email: `${id}@example.test` };
    next();
  });
  app.use("/chat", chatRouter);
  app.use("/circles", circlesRouter);
  app.use("/reports", reportsRouter);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("no port");
  baseUrl = `http://127.0.0.1:${address.port}`;

  for (const id of [organiser, member]) await db.prepare(`INSERT INTO residents (id, email, name) VALUES (?, ?, ?)`).run(id, `${id}@example.test`, id);
  await db.prepare(`INSERT INTO circles (id, name, activity_label, area, county, about, created_by_resident_id) VALUES (?, 'Mod Circle', 'Testball', 'Area', 'Dublin', '', ?)`).run(circleId, organiser);
  await db.prepare(`INSERT INTO circle_members (circle_id, resident_id, role) VALUES (?, ?, 'organiser'), (?, ?, 'member')`).run(circleId, organiser, circleId, member);
  await db.prepare(`INSERT INTO games (id, host_resident_id, activity_label, date, time, capacity, status) VALUES (?, ?, 'Mod Game', '2099-01-01', '10:00', 8, 'open')`).run(gameId, organiser);
  await db.prepare(`INSERT INTO users (id, email, password_hash, role, status, name) VALUES (?, ?, 'x', 'vendor', 'approved', 'Mod Vendor')`).run(vendorId, `${vendorId}@example.test`);
  await db
    .prepare(`INSERT INTO centres (id, name, area, county, rating, reviews, capacity, from_price, managed_by, ph, image_url, blurb, vendor_id, status) VALUES (?, 'Mod Centre', 'Area', 'Dublin', 0, 0, 20, 1000, 'Mgr', '', '', '', ?, 'approved')`)
    .run(centreId, vendorId);
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await db.prepare(`DELETE FROM chat_messages WHERE scope_id = ?`).run(circleId);
  await db.prepare(`DELETE FROM reports WHERE target_id IN (?, ?, ?)`).run(circleId, gameId, centreId);
  await db.prepare(`DELETE FROM circle_members WHERE circle_id = ?`).run(circleId);
  await db.prepare(`DELETE FROM circles WHERE id = ?`).run(circleId);
  await db.prepare(`DELETE FROM games WHERE id = ?`).run(gameId);
  await db.prepare(`DELETE FROM moderation_decisions WHERE object_id = ?`).run(centreId);
  await db.prepare(`DELETE FROM centres WHERE id = ?`).run(centreId);
  await db.prepare(`DELETE FROM users WHERE id = ?`).run(vendorId);
  await db.prepare(`DELETE FROM residents WHERE id IN (?, ?)`).run(organiser, member);
});

async function postMessage(resident: string, body: string): Promise<number> {
  const r = await fetch(`${baseUrl}/chat/circle/${circleId}/messages`, as(resident, { method: "POST", body: JSON.stringify({ body }) }));
  expect(r.status).toBe(201);
  return Number((await r.json()).id);
}

describe("reporting", () => {
  it("only accepts content types HelloCircle can act on, and only real content", async () => {
    const bad = await fetch(`${baseUrl}/reports`, as(member, { method: "POST", body: JSON.stringify({ targetType: "user", targetId: "x", reason: "spam" }) }));
    expect(bad.status).toBe(400);
    const missing = await fetch(`${baseUrl}/reports`, as(member, { method: "POST", body: JSON.stringify({ targetType: "game", targetId: "no-such-game", reason: "spam" }) }));
    expect(missing.status).toBe(404);
    const ok = await fetch(`${baseUrl}/reports`, as(member, { method: "POST", body: JSON.stringify({ targetType: "game", targetId: gameId, reason: "Unsafe" }) }));
    expect(ok.status).toBe(201);
  });
});

describe("admin moderation actions", () => {
  it("hides a chat message: readers see it removed, the text is kept as evidence, and it can't be hidden twice", async () => {
    const id = await postMessage(member, "a nasty message");
    await expect(applyReportAction({ id: 1, targetType: "chat_message", targetId: String(id) }, admin, null)).rejects.toBeInstanceOf(ModerationError); // reason required
    const done = await applyReportAction({ id: 1, targetType: "chat_message", targetId: String(id) }, admin, reason);
    expect(done.action).toBe("chat_message_hidden");
    const read = await (await fetch(`${baseUrl}/chat/circle/${circleId}/messages`, as(organiser))).json();
    const msg = read.messages.find((m: { id: number }) => Number(m.id) === id);
    expect(msg).toMatchObject({ body: "", hidden: "admin" });
    expect(await resolveReportTarget("chat_message", String(id))).toMatchObject({ body: "a nasty message" });
    await expect(applyReportAction({ id: 1, targetType: "chat_message", targetId: String(id) }, admin, reason)).rejects.toThrow(/already hidden/);
  });

  it("cancels a reported activity once", async () => {
    const done = await applyReportAction({ id: 2, targetType: "game", targetId: gameId }, admin, reason);
    expect(done.action).toBe("game_cancelled");
    expect(((await db.prepare(`SELECT status FROM games WHERE id = ?`).get(gameId)) as { status: string }).status).toBe("cancelled");
    await expect(applyReportAction({ id: 2, targetType: "game", targetId: gameId }, admin, reason)).rejects.toThrow(/already cancelled/);
  });

  it("suspends a listing (closed to sales, partner can't resume) and reinstates its previous status", async () => {
    await applyReportAction({ id: 3, targetType: "centre", targetId: centreId }, admin, reason);
    const row = (await db.prepare(`SELECT status, moderation_prior_status as prior FROM centres WHERE id = ?`).get(centreId)) as { status: string; prior: string };
    expect(row).toEqual({ status: "suspended", prior: "approved" });
    const decision = await db.prepare(`SELECT action, explanation FROM moderation_decisions WHERE object_id = ? ORDER BY id DESC LIMIT 1`).get(centreId);
    expect(decision).toMatchObject({ action: "listing.suspended", explanation: reason.explanation });
    expect(await reinstateListing("centre", centreId, admin, null)).toEqual({ status: "approved" });
    await expect(reinstateListing("centre", centreId, admin, null)).rejects.toThrow(/isn't suspended/);
  });
});

describe("organiser moderation in a Circle", () => {
  it("an organiser can remove a message; a member can't", async () => {
    const id = await postMessage(member, "off-topic spam");
    const denied = await fetch(`${baseUrl}/chat/messages/${id}/hide`, as(member, { method: "POST", body: JSON.stringify({ reason: "no" }) }));
    expect(denied.status).toBe(403);
    const ok = await fetch(`${baseUrl}/chat/messages/${id}/hide`, as(organiser, { method: "POST", body: JSON.stringify({ reason: "Spam" }) }));
    expect(ok.status).toBe(200);
    const read = await (await fetch(`${baseUrl}/chat/circle/${circleId}/messages`, as(member))).json();
    expect(read.messages.find((m: { id: number }) => Number(m.id) === id)).toMatchObject({ body: "", hidden: "organiser" });
    expect(read.canModerate).toBe(false);
  });

  it("a muted member can read but not post, and can post again once unmuted; organisers can't be muted", async () => {
    expect((await fetch(`${baseUrl}/circles/${circleId}/members/${member}/mute`, as(member, { method: "POST", body: JSON.stringify({ hours: 2 }) }))).status).toBe(403);
    expect((await fetch(`${baseUrl}/circles/${circleId}/members/${organiser}/mute`, as(organiser, { method: "POST", body: JSON.stringify({ hours: 2 }) }))).status).toBe(404);
    expect((await fetch(`${baseUrl}/circles/${circleId}/members/${member}/mute`, as(organiser, { method: "POST", body: JSON.stringify({ hours: 2 }) }))).status).toBe(200);
    const read = await (await fetch(`${baseUrl}/chat/circle/${circleId}/messages`, as(member))).json();
    expect(read.canPost).toBe(false);
    const blocked = await fetch(`${baseUrl}/chat/circle/${circleId}/messages`, as(member, { method: "POST", body: JSON.stringify({ body: "hello?" }) }));
    expect(blocked.status).toBe(409);
    expect((await fetch(`${baseUrl}/circles/${circleId}/members/${member}/unmute`, as(organiser, { method: "POST" }))).status).toBe(200);
    await postMessage(member, "back again");
  });
});
