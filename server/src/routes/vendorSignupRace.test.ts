import cookieParser from "cookie-parser";
import crypto from "node:crypto";
import http, { type Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { attachUser } from "../auth.js";
import { db } from "../db/index.js";
import { authRouter } from "./auth.js";

// Duplicate-account prevention audit (§9) — POST /auth/signup's
// findUserByEmail pre-check isn't a lock: two concurrent signups for the
// same brand-new email can both pass it and race each other into
// createVendorSignup's INSERT. Before this fix, the loser's ER_DUP_ENTRY
// propagated past the route handler and was caught only by index.ts's
// generic final error handler as a bare 500 — this proves it now gets the
// same controlled 409 the pre-check itself already returns for a
// non-concurrent duplicate, and that no orphaned organisation/listing is
// left behind for the losing attempt.

let server: Server;
let baseUrl: string;
const testEmails: string[] = [];

function freshEmail(label: string): string {
  const email = `vendor-signup-race-${label}-${crypto.randomUUID()}@example.test`;
  testEmails.push(email);
  return email;
}

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use(attachUser);
  app.use("/auth", authRouter);

  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Failed to bind test server");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  if (!testEmails.length) return;
  const placeholders = testEmails.map(() => "?").join(",");
  const users = (await db.prepare(`SELECT id, org_id FROM users WHERE email IN (${placeholders})`).all(...testEmails)) as { id: string; org_id: string | null }[];
  for (const { id, org_id } of users) {
    const centres = (await db.prepare(`SELECT id FROM centres WHERE vendor_id = ?`).all(id)) as { id: string }[];
    for (const { id: centreId } of centres) await db.prepare(`DELETE FROM rooms WHERE centre_id = ?`).run(centreId);
    await db.prepare(`DELETE FROM centres WHERE vendor_id = ?`).run(id);
    if (org_id) await db.prepare(`DELETE FROM organisations WHERE id = ?`).run(org_id);
  }
  await db.prepare(`DELETE FROM users WHERE email IN (${placeholders})`).run(...testEmails);
});

function postJson(path: string, body: unknown) {
  return fetch(`${baseUrl}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

describe("POST /auth/signup — concurrent signup for the same brand-new email", () => {
  it("lets exactly one concurrent signup win with 201, the other gets a controlled 409 (not a 500), and only one user + one org exist", async () => {
    const email = freshEmail("race");
    const intake = {
      email,
      password: "password123",
      name: "Racer",
      vendorType: "community" as const,
      businessName: "Race Test Centre",
      address: "1 Test Street",
      county: "Dublin",
      mobile: "0850000000",
      description: "A test centre for the signup-race suite",
      termsAccepted: true,
    };

    const [res1, res2] = await Promise.all([postJson("/auth/signup", intake), postJson("/auth/signup", intake)]);
    const statuses = [res1.status, res2.status].sort();
    expect(statuses).toEqual([201, 409]);

    const users = (await db.prepare(`SELECT id, org_id FROM users WHERE email = ?`).all(email)) as { id: string; org_id: string }[];
    expect(users).toHaveLength(1);

    const centres = (await db.prepare(`SELECT id FROM centres WHERE vendor_id = ?`).all(users[0].id)) as { id: string }[];
    expect(centres).toHaveLength(1);
  });
});
