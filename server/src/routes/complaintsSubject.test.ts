import crypto from "node:crypto";
import http, { type Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../db/index.js";
import { complaintsAbout, complaintsRouter, respondAsSubject } from "./complaints.js";

// OG-17 / DEC-12 — a complaint about a business's listing reaches that
// business (text and outcome, never the complainant), and only it can respond.

let server: Server;
let baseUrl: string;
const t = crypto.randomUUID().slice(0, 8);
const vendorId = `test-cmp-vendor-${t}`;
const centreId = `test-cmp-centre-${t}`;
const email = `complainer-${t}@example.test`;
let id = 0;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/complaints", complaintsRouter);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("no port");
  baseUrl = `http://127.0.0.1:${address.port}`;
  await db.prepare(`INSERT INTO users (id, email, password_hash, role, status, name) VALUES (?, ?, 'x', 'vendor', 'approved', 'Cmp Vendor')`).run(vendorId, `${vendorId}@example.test`);
  await db.prepare(`INSERT INTO centres (id, name, area, county, rating, reviews, capacity, from_price, managed_by, ph, image_url, blurb, vendor_id, status) VALUES (?, 'Cmp Centre', 'A', 'Dublin', 0, 0, 1, 1, 'M', '', '', '', ?, 'approved')`).run(centreId, vendorId);
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await db.prepare(`DELETE FROM complaints WHERE email = ?`).run(email);
  await db.prepare(`DELETE FROM notifications WHERE recipient_id = ?`).run(vendorId);
  await db.prepare(`DELETE FROM centres WHERE id = ?`).run(centreId);
  await db.prepare(`DELETE FROM users WHERE id = ?`).run(vendorId);
});

describe("complaints about a business", () => {
  it("reach the business without the complainant's details", async () => {
    const r = await fetch(`${baseUrl}/complaints`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Client-Id": `c-${t}` },
      body: JSON.stringify({ kind: "complaint", subjectType: "listing", subjectRef: centreId, email, body: "The hall was locked when we arrived at the booked time." }),
    });
    expect(r.status).toBe(201);
    id = (await r.json()).id;
    const mine = (await complaintsAbout({ vendorIds: [vendorId] })) as Record<string, unknown>[];
    const c = mine.find((x) => Number(x.id) === id)!;
    expect(c).toMatchObject({ body: expect.stringContaining("hall was locked"), status: "open" });
    expect(JSON.stringify(c)).not.toContain(email);
    expect(await complaintsAbout({ vendorIds: [`someone-else-${t}`] })).toEqual([]);
    const notice = await db.prepare(`SELECT title FROM notifications WHERE recipient_id = ? AND kind = 'complaint'`).get(vendorId);
    expect(notice).toBeTruthy();
  });

  it("only the business it's about can respond, until it's decided", async () => {
    expect((await respondAsSubject(id, { vendorIds: [`someone-else-${t}`] }, "x", "This is a response text")).status).toBe(404);
    expect((await respondAsSubject(id, { vendorIds: [vendorId] }, vendorId, "short")).status).toBe(400);
    expect((await respondAsSubject(id, { vendorIds: [vendorId] }, vendorId, "We're sorry; the caretaker was off sick and we've refunded you.")).status).toBe(200);
    await db.prepare(`UPDATE complaints SET status = 'closed' WHERE id = ?`).run(id);
    expect((await respondAsSubject(id, { vendorIds: [vendorId] }, vendorId, "Another response after the decision")).status).toBe(404);
  });
});
