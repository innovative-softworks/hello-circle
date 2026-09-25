import cookieParser from "cookie-parser";
import crypto from "node:crypto";
import http, { type Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../db/index.js";
import { guestAuthRouter } from "./guestAuth.js";

// Auth UX audit regression coverage — two real findings fixed here:
//
// (C8) POST /guest/signup was the one resident signup path with no
// server-side Terms enforcement or consent persistence at all, unlike
// Google-completion and vendor signup right next to it.
//
// (Duplicate-account prevention audit, §9) createResidentWithPassword's
// findResidentPasswordHash pre-check isn't a lock — two concurrent signups
// for the same brand-new email can both pass it and race the INSERT.
// residents.email's UNIQUE constraint decides the real winner; this proves
// the loser gets a controlled 409, not an uncaught rejection.

let server: Server;
let baseUrl: string;
const testEmails: string[] = [];

function freshEmail(label: string): string {
  const email = `resident-pw-signup-${label}-${crypto.randomUUID()}@example.test`;
  testEmails.push(email);
  return email;
}

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use("/guest", guestAuthRouter);

  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Failed to bind test server");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  if (testEmails.length) {
    const placeholders = testEmails.map(() => "?").join(",");
    await db.prepare(`DELETE FROM guest_sessions WHERE email IN (${placeholders})`).run(...testEmails);
    await db.prepare(`DELETE FROM residents WHERE email IN (${placeholders})`).run(...testEmails);
  }
});

function postJson(path: string, body: unknown) {
  return fetch(`${baseUrl}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

describe("POST /guest/signup — Terms enforcement and consent persistence (C8)", () => {
  it("rejects signup without termsAccepted, and creates nothing", async () => {
    const email = freshEmail("no-terms");
    const res = await postJson("/guest/signup", { name: "No Terms", email, password: "password123", termsAccepted: false });
    expect(res.status).toBe(400);

    const rows = (await db.prepare(`SELECT id FROM residents WHERE email = ?`).all(email)) as { id: string }[];
    expect(rows).toHaveLength(0);
  });

  it("records terms_accepted_at and marketing_consent on a successful signup", async () => {
    const email = freshEmail("with-consent");
    const res = await postJson("/guest/signup", { name: "With Consent", email, password: "password123", termsAccepted: true, marketingConsent: true });
    expect(res.status).toBe(201);
    expect(res.headers.get("set-cookie")).toContain("hello_circle_guest_session");

    const row = (await db.prepare(`SELECT terms_accepted_at, marketing_consent FROM residents WHERE email = ?`).get(email)) as {
      terms_accepted_at: string | null;
      marketing_consent: number;
    };
    expect(row.terms_accepted_at).toBeTruthy();
    expect(row.marketing_consent).toBe(1);
  });

  it("defaults marketing_consent to 0 when omitted", async () => {
    const email = freshEmail("no-marketing");
    const res = await postJson("/guest/signup", { name: "No Marketing", email, password: "password123", termsAccepted: true });
    expect(res.status).toBe(201);

    const row = (await db.prepare(`SELECT marketing_consent FROM residents WHERE email = ?`).get(email)) as { marketing_consent: number };
    expect(row.marketing_consent).toBe(0);
  });
});

describe("POST /guest/signup — concurrent signup for the same brand-new email (duplicate-account prevention §9)", () => {
  it("lets exactly one concurrent signup win with 201, the other gets a controlled 409 (not a 500), and only one resident row exists", async () => {
    const email = freshEmail("race");
    const [res1, res2] = await Promise.all([
      postJson("/guest/signup", { name: "Racer One", email, password: "password123", termsAccepted: true }),
      postJson("/guest/signup", { name: "Racer Two", email, password: "password123", termsAccepted: true }),
    ]);
    const statuses = [res1.status, res2.status].sort();
    expect(statuses).toEqual([201, 409]);

    const rows = (await db.prepare(`SELECT id FROM residents WHERE email = ?`).all(email)) as { id: string }[];
    expect(rows).toHaveLength(1);
  });
});
