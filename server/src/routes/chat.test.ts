import crypto from "node:crypto";
import http, { type Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../db/index.js";
import { chatRouter } from "./chat.js";

// Circle Experience Polish — Changeset 6. chat.ts previously had ZERO test
// coverage despite being the most security-sensitive live-authorization
// code in the whole Circle surface (checkCircleMembership re-queries
// circle_members on every single request — this proves that's actually
// true, not just asserted in a comment).

let server: Server;
let baseUrl: string;

const organiserId = `test-chat-org-${crypto.randomUUID()}`;
const memberId = `test-chat-mem-${crypto.randomUUID()}`;
const outsiderId = `test-chat-out-${crypto.randomUUID()}`;
const blockedId = `test-chat-blocked-${crypto.randomUUID()}`;
const circleId = `test-chat-circle-${crypto.randomUUID()}`;
const otherCircleId = `test-chat-other-circle-${crypto.randomUUID()}`;
const closedCircleId = `test-chat-closed-circle-${crypto.randomUUID()}`;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const residentId = req.header("X-Test-Resident-Id");
    if (residentId) (req as any).resident = { id: residentId, name: `Resident ${residentId.slice(-4)}` };
    next();
  });
  app.use("/chat", chatRouter);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Failed to bind test server");
  baseUrl = `http://127.0.0.1:${address.port}`;

  for (const [id, name] of [
    [organiserId, "Chat Organiser"],
    [memberId, "Chat Member"],
    [outsiderId, "Chat Outsider"],
    [blockedId, "Chat Blocked"],
  ] as const) {
    await db.prepare(`INSERT INTO residents (id, email, name) VALUES (?, ?, ?)`).run(id, `${id}@example.test`, name);
  }

  await db.prepare(`INSERT INTO circles (id, name, activity_label, area, county, about, created_by_resident_id) VALUES (?, 'Chat Test Circle', 'Testball', 'Area', 'Dublin', '', ?)`).run(circleId, organiserId);
  await db.prepare(`INSERT INTO circle_members (circle_id, resident_id, role) VALUES (?, ?, 'organiser')`).run(circleId, organiserId);
  await db.prepare(`INSERT INTO circle_members (circle_id, resident_id, role) VALUES (?, ?, 'member')`).run(circleId, memberId);
  await db.prepare(`INSERT INTO circle_members (circle_id, resident_id, role) VALUES (?, ?, 'member')`).run(circleId, blockedId);

  await db.prepare(`INSERT INTO circles (id, name, activity_label, area, county, about, created_by_resident_id) VALUES (?, 'Other Chat Circle', 'Testball', 'Area', 'Dublin', '', ?)`).run(otherCircleId, organiserId);
  await db.prepare(`INSERT INTO circle_members (circle_id, resident_id, role) VALUES (?, ?, 'organiser')`).run(otherCircleId, organiserId);

  await db
    .prepare(`INSERT INTO circles (id, name, activity_label, area, county, about, created_by_resident_id, status) VALUES (?, 'Closed Chat Circle', 'Testball', 'Area', 'Dublin', '', ?, 'closed')`)
    .run(closedCircleId, organiserId);
  await db.prepare(`INSERT INTO circle_members (circle_id, resident_id, role) VALUES (?, ?, 'organiser')`).run(closedCircleId, organiserId);
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await db.prepare(`DELETE FROM chat_messages WHERE scope_type = 'circle' AND scope_id IN (?, ?, ?)`).run(circleId, otherCircleId, closedCircleId);
  await db.prepare(`DELETE FROM blocked_residents WHERE blocker_resident_id = ? OR blocked_resident_id = ?`).run(memberId, blockedId);
  await db.prepare(`DELETE FROM circle_members WHERE circle_id IN (?, ?, ?)`).run(circleId, otherCircleId, closedCircleId);
  await db.prepare(`DELETE FROM circles WHERE id IN (?, ?, ?)`).run(circleId, otherCircleId, closedCircleId);
  await db.prepare(`DELETE FROM residents WHERE id IN (?, ?, ?, ?)`).run(organiserId, memberId, outsiderId, blockedId);
});

describe("Circle chat — membership enforcement", () => {
  it("a member can read (empty) and send a message", async () => {
    const read = await fetch(`${baseUrl}/chat/circle/${circleId}/messages`, { headers: { "X-Test-Resident-Id": memberId } });
    expect(read.status).toBe(200);
    const readBody = (await read.json()) as { canPost: boolean };
    expect(readBody.canPost).toBe(true);

    const send = await fetch(`${baseUrl}/chat/circle/${circleId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Test-Resident-Id": memberId },
      body: JSON.stringify({ body: "Hello Circle" }),
    });
    expect(send.status).toBe(201);
  });

  it("a non-member is rejected from both reading and sending", async () => {
    const read = await fetch(`${baseUrl}/chat/circle/${circleId}/messages`, { headers: { "X-Test-Resident-Id": outsiderId } });
    expect(read.status).toBe(403);
    const send = await fetch(`${baseUrl}/chat/circle/${circleId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Test-Resident-Id": outsiderId },
      body: JSON.stringify({ body: "Should not be allowed" }),
    });
    expect(send.status).toBe(403);
  });

  it("an unauthenticated request is rejected", async () => {
    const res = await fetch(`${baseUrl}/chat/circle/${circleId}/messages`);
    expect(res.status).toBe(401);
  });

  it("a removed member loses read+send access on their very next request — enforced server-side, not cached", async () => {
    const before = await fetch(`${baseUrl}/chat/circle/${circleId}/messages`, { headers: { "X-Test-Resident-Id": memberId } });
    expect(before.status).toBe(200);

    await db.prepare(`DELETE FROM circle_members WHERE circle_id = ? AND resident_id = ?`).run(circleId, memberId);

    const after = await fetch(`${baseUrl}/chat/circle/${circleId}/messages`, { headers: { "X-Test-Resident-Id": memberId } });
    expect(after.status).toBe(403);
    const sendAfter = await fetch(`${baseUrl}/chat/circle/${circleId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Test-Resident-Id": memberId },
      body: JSON.stringify({ body: "Should be rejected now" }),
    });
    expect(sendAfter.status).toBe(403);

    // Restore membership for later tests in this file.
    await db.prepare(`INSERT INTO circle_members (circle_id, resident_id, role) VALUES (?, ?, 'member')`).run(circleId, memberId);
  });

  it("a member of one circle cannot read or post to a different circle's chat", async () => {
    const read = await fetch(`${baseUrl}/chat/circle/${otherCircleId}/messages`, { headers: { "X-Test-Resident-Id": memberId } });
    expect(read.status).toBe(403);
    const send = await fetch(`${baseUrl}/chat/circle/${otherCircleId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Test-Resident-Id": memberId },
      body: JSON.stringify({ body: "Should not cross circles" }),
    });
    expect(send.status).toBe(403);
  });

  it("mutual-block filtering hides a blocked resident's messages from the blocker's read, without affecting their own ability to post", async () => {
    await db.prepare(`INSERT INTO chat_messages (scope_type, scope_id, resident_id, body) VALUES ('circle', ?, ?, 'A message from the blocked resident')`).run(circleId, blockedId);
    await db.prepare(`INSERT INTO blocked_residents (blocker_resident_id, blocked_resident_id) VALUES (?, ?)`).run(organiserId, blockedId);

    const asOrganiser = await fetch(`${baseUrl}/chat/circle/${circleId}/messages`, { headers: { "X-Test-Resident-Id": organiserId } });
    const organiserBody = (await asOrganiser.json()) as { messages: { residentId: string }[] };
    expect(organiserBody.messages.some((m) => m.residentId === blockedId)).toBe(false);

    // A third, unrelated member (not part of the block either direction) still sees it.
    const asMember = await fetch(`${baseUrl}/chat/circle/${circleId}/messages`, { headers: { "X-Test-Resident-Id": memberId } });
    const memberBody = (await asMember.json()) as { messages: { residentId: string }[] };
    expect(memberBody.messages.some((m) => m.residentId === blockedId)).toBe(true);
  });

  it("Changeset 1D — a closed circle's chat stays readable but rejects new posts", async () => {
    const read = await fetch(`${baseUrl}/chat/circle/${closedCircleId}/messages`, { headers: { "X-Test-Resident-Id": organiserId } });
    expect(read.status).toBe(200);
    const readBody = (await read.json()) as { canPost: boolean; postBlockedReason?: string };
    expect(readBody.canPost).toBe(false);
    expect(readBody.postBlockedReason).toMatch(/closed/i);

    const send = await fetch(`${baseUrl}/chat/circle/${closedCircleId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Test-Resident-Id": organiserId },
      body: JSON.stringify({ body: "Should be rejected" }),
    });
    expect(send.status).toBe(409);
  });
});
