import crypto from "node:crypto";
import http, { type Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../db/index.js";
import { chatRouter } from "./chat.js";

// Chat everywhere — program/club scopes, the provider posting as "Host",
// the My Chats inbox with unread counts, and message reports. Same stubbed
// identity middleware as chat.test.ts: X-Test-Resident-Id attaches a
// resident, X-Test-User-Id attaches an approved vendor.

let server: Server;
let baseUrl: string;

const tag = crypto.randomUUID().slice(0, 8);
const vendorId = `test-chatx-vendor-${tag}`;
const otherVendorId = `test-chatx-vendor2-${tag}`;
const enrolledId = `test-chatx-enrolled-${tag}`;
const emailOnlyId = `test-chatx-emailonly-${tag}`;
const outsiderId = `test-chatx-out-${tag}`;
const centreId = `test-chatx-centre-${tag}`;
const programId = `test-chatx-program-${tag}`;
const clubId = `test-chatx-club-${tag}`;
const emailOnlyAddress = `${emailOnlyId}@example.test`;

const asResident = (id: string) => ({ "X-Test-Resident-Id": id, "Content-Type": "application/json" });
const asVendor = (id: string) => ({ "X-Test-User-Id": id, "Content-Type": "application/json" });

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const residentId = req.header("X-Test-Resident-Id");
    if (residentId) (req as any).resident = { id: residentId, email: `${residentId}@example.test`, name: `Resident ${residentId.slice(-4)}` };
    const userId = req.header("X-Test-User-Id");
    if (userId) (req as any).user = { id: userId, role: "vendor", status: "approved", name: "Owner", businessName: `Biz ${userId.slice(-4)}`, orgId: null };
    next();
  });
  app.use("/chat", chatRouter);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Failed to bind test server");
  baseUrl = `http://127.0.0.1:${address.port}`;

  for (const id of [vendorId, otherVendorId]) {
    await db.prepare(`INSERT INTO users (id, email, password_hash, role, status, name, business_name) VALUES (?, ?, 'x', 'vendor', 'approved', 'Owner', ?)`).run(id, `${id}@example.test`, `Biz ${id.slice(-4)}`);
  }
  for (const id of [enrolledId, emailOnlyId, outsiderId]) {
    await db.prepare(`INSERT INTO residents (id, email, name) VALUES (?, ?, ?)`).run(id, `${id}@example.test`, `Resident ${id.slice(-4)}`);
  }
  await db.prepare(`INSERT INTO programs (id, listing_type, listing_id, vendor_id, title, description, status) VALUES (?, 'centre', ?, ?, 'Chat Test Program', '', 'published')`).run(programId, centreId, vendorId);
  // One enrolment by account, one only by the email it was booked with.
  await db
    .prepare(`INSERT INTO program_enrollments (ref, program_id, client_id, resident_id, participant_name, email, payment_status) VALUES (?, ?, 'c1', ?, 'Kid A', 'someone@example.test', 'paid')`)
    .run(`CX-${tag}-1`, programId, enrolledId);
  await db
    .prepare(`INSERT INTO program_enrollments (ref, program_id, client_id, participant_name, email, payment_status) VALUES (?, ?, 'c2', 'Kid B', ?, 'paid')`)
    .run(`CX-${tag}-2`, programId, emailOnlyAddress);
  await db
    .prepare(`INSERT INTO clubs (id, name, sport, area, county, ages, price, unit, trial, ph, blurb, vendor_id, status) VALUES (?, 'Chat Test Club', 'Testball', 'Area', 'Dublin', '5-12', 10, 'year', 0, '', '', ?, 'approved')`)
    .run(clubId, vendorId);
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  const ids = (await db.prepare(`SELECT id FROM chat_messages WHERE scope_type IN ('program','club') AND scope_id IN (?, ?)`).all(programId, clubId)) as { id: number }[];
  for (const { id } of ids) await db.prepare(`DELETE FROM reports WHERE target_type = 'chat_message' AND target_id = ?`).run(String(id));
  await db.prepare(`DELETE FROM chat_messages WHERE scope_id IN (?, ?)`).run(programId, clubId);
  await db.prepare(`DELETE FROM chat_reads WHERE scope_id IN (?, ?)`).run(programId, clubId);
  await db.prepare(`DELETE FROM program_enrollments WHERE program_id = ?`).run(programId);
  await db.prepare(`DELETE FROM programs WHERE id = ?`).run(programId);
  await db.prepare(`DELETE FROM clubs WHERE id = ?`).run(clubId);
  await db.prepare(`DELETE FROM residents WHERE id IN (?, ?, ?)`).run(enrolledId, emailOnlyId, outsiderId);
  await db.prepare(`DELETE FROM users WHERE id IN (?, ?)`).run(vendorId, otherVendorId);
});

describe("Program chat", () => {
  it("lets an enrolled resident in and keeps outsiders out", async () => {
    const ok = await fetch(`${baseUrl}/chat/program/${programId}/messages`, { headers: asResident(enrolledId) });
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { canPost: boolean }).canPost).toBe(true);

    const out = await fetch(`${baseUrl}/chat/program/${programId}/messages`, { headers: asResident(outsiderId) });
    expect(out.status).toBe(403);

    const anon = await fetch(`${baseUrl}/chat/program/${programId}/messages`);
    expect(anon.status).toBe(401);
  });

  it("counts an enrolment made with the resident's email before they had an account", async () => {
    const res = await fetch(`${baseUrl}/chat/program/${programId}/messages`, { headers: asResident(emailOnlyId) });
    expect(res.status).toBe(200);
  });

  it("lets the provider post as the host, and only the provider", async () => {
    const post = await fetch(`${baseUrl}/chat/program/${programId}/messages`, { method: "POST", headers: asVendor(vendorId), body: JSON.stringify({ body: "Welcome, everyone!" }) });
    expect(post.status).toBe(201);

    const other = await fetch(`${baseUrl}/chat/program/${programId}/messages`, { headers: asVendor(otherVendorId) });
    expect(other.status).toBe(403);

    const feed = (await (await fetch(`${baseUrl}/chat/program/${programId}/messages`, { headers: asResident(enrolledId) })).json()) as {
      messages: { body: string; authorType: string; isMine: boolean; residentName: string }[];
    };
    const hostMsg = feed.messages.find((m) => m.body === "Welcome, everyone!");
    expect(hostMsg?.authorType).toBe("host");
    expect(hostMsg?.isMine).toBe(false);
    expect(hostMsg?.residentName).toBe(`Biz ${vendorId.slice(-4)}`);

    const hostView = (await (await fetch(`${baseUrl}/chat/program/${programId}/messages`, { headers: asVendor(vendorId) })).json()) as {
      viewerRole: string;
      messages: { body: string; isMine: boolean }[];
    };
    expect(hostView.viewerRole).toBe("host");
    expect(hostView.messages.find((m) => m.body === "Welcome, everyone!")?.isMine).toBe(true);
  });
});

describe("Club chat", () => {
  it("is open to the club's own provider but not to other vendors or unregistered residents", async () => {
    expect((await fetch(`${baseUrl}/chat/club/${clubId}/messages`, { headers: asVendor(vendorId) })).status).toBe(200);
    expect((await fetch(`${baseUrl}/chat/club/${clubId}/messages`, { headers: asVendor(otherVendorId) })).status).toBe(403);
    expect((await fetch(`${baseUrl}/chat/club/${clubId}/messages`, { headers: asResident(outsiderId) })).status).toBe(403);
  });
});

describe("My Chats inbox", () => {
  it("lists the program with an unread count that clears once read", async () => {
    await fetch(`${baseUrl}/chat/program/${programId}/messages`, { method: "POST", headers: asVendor(vendorId), body: JSON.stringify({ body: "Bring water bottles." }) });

    const before = (await (await fetch(`${baseUrl}/chat/mine`, { headers: asResident(emailOnlyId) })).json()) as { items: { scopeId: string; unread: number; lastMessage: { body: string } | null }[] };
    const item = before.items.find((i) => i.scopeId === programId);
    expect(item).toBeTruthy();
    expect(item!.unread).toBeGreaterThan(0);
    expect(item!.lastMessage?.body).toBe("Bring water bottles.");

    await fetch(`${baseUrl}/chat/program/${programId}/messages`, { headers: asResident(emailOnlyId) });
    const after = (await (await fetch(`${baseUrl}/chat/mine`, { headers: asResident(emailOnlyId) })).json()) as { items: { scopeId: string; unread: number }[] };
    expect(after.items.find((i) => i.scopeId === programId)?.unread).toBe(0);
  });

  it("gives the provider a host inbox of chats with participants", async () => {
    const res = (await (await fetch(`${baseUrl}/chat/mine?as=host`, { headers: asVendor(vendorId) })).json()) as { items: { scopeType: string; scopeId: string }[] };
    expect(res.items.some((i) => i.scopeType === "program" && i.scopeId === programId)).toBe(true);
    // No registrations yet, so the club has no one to talk to.
    expect(res.items.some((i) => i.scopeType === "club" && i.scopeId === clubId)).toBe(false);
  });
});

describe("Reporting a message", () => {
  it("lets a participant report a message they can see", async () => {
    const feed = (await (await fetch(`${baseUrl}/chat/program/${programId}/messages`, { headers: asResident(enrolledId) })).json()) as { messages: { id: number }[] };
    const target = feed.messages[0];
    const res = await fetch(`${baseUrl}/chat/messages/${target.id}/report`, { method: "POST", headers: asResident(enrolledId), body: JSON.stringify({ reason: "Spam or scam" }) });
    expect(res.status).toBe(201);
    const row = await db.prepare(`SELECT reason FROM reports WHERE target_type = 'chat_message' AND target_id = ?`).get(String(target.id));
    expect(row).toBeTruthy();
  });

  it("refuses a report from someone outside the conversation", async () => {
    const feed = (await (await fetch(`${baseUrl}/chat/program/${programId}/messages`, { headers: asResident(enrolledId) })).json()) as { messages: { id: number }[] };
    const res = await fetch(`${baseUrl}/chat/messages/${feed.messages[0].id}/report`, { method: "POST", headers: asResident(outsiderId), body: JSON.stringify({ reason: "Spam or scam" }) });
    expect(res.status).toBe(403);
  });
});
