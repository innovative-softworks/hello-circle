import crypto from "node:crypto";
import http, { type Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../db/index.js";
import { circlesRouter } from "./circles.js";

// OG-18 — the organiser's moderation view (reports without reporters, hidden
// messages, mutes, history) and announcements to every member.

let server: Server;
let baseUrl: string;
const t = crypto.randomUUID().slice(0, 8);
const organiser = `test-cmod-org-${t}`;
const member = `test-cmod-mem-${t}`;
const circleId = `test-cmod-circle-${t}`;
let messageId = 0;

const call = (method: string, path: string, resident: string, body?: unknown) =>
  fetch(`${baseUrl}/circles/${circleId}${path}`, { method, headers: { "Content-Type": "application/json", "X-Test-Resident-Id": resident }, body: body === undefined ? undefined : JSON.stringify(body) });

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const id = req.header("X-Test-Resident-Id");
    if (id) (req as any).resident = { id, name: id, email: `${id}@example.test` };
    next();
  });
  app.use("/circles", circlesRouter);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("no port");
  baseUrl = `http://127.0.0.1:${address.port}`;
  for (const id of [organiser, member]) await db.prepare(`INSERT INTO residents (id, email, name) VALUES (?, ?, ?)`).run(id, `${id}@example.test`, id);
  await db.prepare(`INSERT INTO circles (id, name, activity_label, area, county, about, created_by_resident_id, join_mode, status) VALUES (?, 'Mod Circle', 'Walking', 'A', 'Dublin', '', ?, 'open', 'active')`).run(circleId, organiser);
  await db.prepare(`INSERT INTO circle_members (circle_id, resident_id, role) VALUES (?, ?, 'organiser'), (?, ?, 'member')`).run(circleId, organiser, circleId, member);
  const r = await db.prepare(`INSERT INTO chat_messages (scope_type, scope_id, resident_id, body) VALUES ('circle', ?, ?, 'rude message')`).run(circleId, member);
  messageId = Number(r.lastInsertRowid);
  await db.prepare(`INSERT INTO reports (target_type, target_id, reporter_client_id, reason) VALUES ('chat_message', ?, 'secret-reporter', 'This is abusive')`).run(String(messageId));
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await db.prepare(`DELETE FROM reports WHERE target_type = 'chat_message' AND target_id = ?`).run(String(messageId));
  await db.prepare(`DELETE FROM chat_messages WHERE scope_type = 'circle' AND scope_id = ?`).run(circleId);
  await db.prepare(`DELETE FROM notifications WHERE listing_id = ?`).run(circleId);
  await db.prepare(`DELETE FROM audit_log WHERE object_id = ?`).run(circleId);
  await db.prepare(`DELETE FROM circle_members WHERE circle_id = ?`).run(circleId);
  await db.prepare(`DELETE FROM circles WHERE id = ?`).run(circleId);
  await db.prepare(`DELETE FROM residents WHERE id IN (?, ?)`).run(organiser, member);
});

describe("circle moderation", () => {
  it("is organiser-only and never names the reporter", async () => {
    expect((await call("GET", "/moderation", member)).status).toBe(403);
    await call("POST", `/members/${member}/mute`, organiser, { hours: 2, reason: "cool off" });
    const view = await (await call("GET", "/moderation", organiser)).json();
    expect(view.reported).toEqual([expect.objectContaining({ id: messageId, reports: 1, latestReason: "This is abusive" })]);
    expect(JSON.stringify(view)).not.toContain("secret-reporter");
    expect(view.muted).toEqual([expect.objectContaining({ residentId: member })]);
    expect(view.history[0]).toMatchObject({ action: "circle.member_muted", reason: "cool off" });
  });

  it("announcements reach every member and are organiser-only", async () => {
    expect((await call("POST", "/announcements", member, { message: "Hello all" })).status).toBe(403);
    const r = await call("POST", "/announcements", organiser, { message: "Walk moved to 10am" });
    expect(await r.json()).toMatchObject({ ok: true, recipients: 1 });
    const n = (await db.prepare(`SELECT title FROM notifications WHERE resident_id = ? AND listing_id = ?`).all(member, circleId)) as { title: string }[];
    expect(n.some((x) => x.title.startsWith("Announcement in"))).toBe(true);
  });
});
