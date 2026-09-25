import crypto from "node:crypto";
import http, { type Server } from "node:http";
import cookieParser from "cookie-parser";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../db/index.js";
import { createLoginToken } from "../guestAuth.js";
import { TERMS_VERSION } from "../terms.js";
import { authRouter } from "./auth.js";
import { guestAuthRouter } from "./guestAuth.js";
import { residentsRouter } from "./residents.js";

// Onboarding audit E1 (renewed Terms acceptance for accounts with none on
// file), E2 (Terms version recorded next to every acceptance) and G2 (vendor
// setup status that works while pending). Real DB, isolated rows.

let server: Server;
let baseUrl: string;
const emails: string[] = [];
const residentIds: string[] = [];

function fresh(label: string) {
  const email = `terms-${label}-${crypto.randomUUID()}@example.test`;
  emails.push(email);
  return email;
}

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use(async (req, _res, next) => {
    const uid = req.header("X-Test-User-Id");
    if (uid) {
      const row = (await db.prepare(`SELECT id, email, role, status, org_id as orgId, invited_staff as invitedStaff, business_name as businessName FROM users WHERE id = ?`).get(uid)) as any;
      if (row) (req as any).user = { ...row, invitedStaff: !!row.invitedStaff };
    }
    const rid = req.header("X-Test-Resident-Id");
    if (rid) {
      const row = (await db.prepare(`SELECT id, email, name FROM residents WHERE id = ?`).get(rid)) as any;
      if (row) (req as any).resident = row;
    }
    next();
  });
  app.use("/auth", authRouter);
  app.use("/guest", guestAuthRouter);
  app.use("/residents", residentsRouter);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Failed to bind test server");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  if (emails.length) {
    const ph = emails.map(() => "?").join(",");
    const users = `SELECT id FROM users WHERE email IN (${ph})`;
    await db.prepare(`DELETE FROM rooms WHERE centre_id IN (SELECT id FROM centres WHERE vendor_id IN (${users}))`).run(...emails);
    await db.prepare(`DELETE FROM centres WHERE vendor_id IN (${users})`).run(...emails);
    await db.prepare(`DELETE FROM organisations WHERE id IN (SELECT org_id FROM users WHERE email IN (${ph}))`).run(...emails);
    await db.prepare(`DELETE FROM users WHERE email IN (${ph})`).run(...emails);
    await db.prepare(`DELETE FROM guest_login_tokens WHERE email IN (${ph})`).run(...emails);
    await db.prepare(`DELETE FROM resident_signup_tokens WHERE email IN (${ph})`).run(...emails);
    await db.prepare(`DELETE FROM guest_sessions WHERE email IN (${ph})`).run(...emails);
    await db.prepare(`DELETE FROM residents WHERE email IN (${ph})`).run(...emails);
  }
});

const call = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
  fetch(`${baseUrl}${path}`, { method, headers: { "Content-Type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });

async function legacyResident(): Promise<{ id: string; email: string }> {
  const id = crypto.randomUUID();
  const email = fresh("legacy");
  residentIds.push(id);
  await db.prepare(`INSERT INTO residents (id, email, name) VALUES (?, ?, 'Legacy')`).run(id, email);
  return { id, email };
}
const terms = async (email: string) =>
  (await db.prepare(`SELECT terms_accepted_at as at, terms_version as version, marketing_consent as marketing FROM residents WHERE email = ?`).get(email)) as { at: string | null; version: string | null; marketing: number };

describe("E1 — resident renewed acceptance", () => {
  it("reports no acceptance on file for a legacy account, without inventing one", async () => {
    const r = await legacyResident();
    const body = (await (await call("GET", "/residents/me", undefined, { "X-Test-Resident-Id": r.id })).json()) as any;
    expect(body.resident.termsAcceptedAt).toBeNull();
    expect(body.resident.termsVersion).toBeNull();
  });

  it("requires the explicit flag and requires a resident session", async () => {
    const r = await legacyResident();
    expect((await call("POST", "/residents/me/accept-terms", {}, { "X-Test-Resident-Id": r.id })).status).toBe(400);
    expect((await call("POST", "/residents/me/accept-terms", { termsAccepted: true })).status).toBe(401);
    expect((await terms(r.email)).at).toBeNull();
  });

  it("records timestamp + current version, and leaves marketing untouched", async () => {
    const r = await legacyResident();
    const res = await call("POST", "/residents/me/accept-terms", { termsAccepted: true, marketingConsent: true }, { "X-Test-Resident-Id": r.id });
    expect(res.status).toBe(200);
    const t = await terms(r.email);
    expect(t.at).toBeTruthy();
    expect(t.version).toBe(TERMS_VERSION);
    expect(t.marketing).toBe(0);
  });

  it("never overwrites an acceptance already on file", async () => {
    const r = await legacyResident();
    await db.prepare(`UPDATE residents SET terms_accepted_at = '2024-01-01 00:00:00', terms_version = 'old' WHERE id = ?`).run(r.id);
    await call("POST", "/residents/me/accept-terms", { termsAccepted: true }, { "X-Test-Resident-Id": r.id });
    const t = await terms(r.email);
    expect(t.version).toBe("old");
    expect(String(t.at)).toContain("2024");
  });
});

describe("E2 — version recorded on every path", () => {
  it("password signup, magic-link completion", async () => {
    const pw = fresh("pw");
    expect((await call("POST", "/guest/signup", { email: pw, password: "password123", termsAccepted: true })).status).toBe(201);
    expect((await terms(pw)).version).toBe(TERMS_VERSION);

    const ml = fresh("ml");
    const { token } = await createLoginToken(ml);
    const { completionToken } = (await (await call("POST", "/guest/verify", { token })).json()) as { completionToken: string };
    await call("POST", "/guest/verify/complete", { completionToken, termsAccepted: true });
    expect((await terms(ml)).version).toBe(TERMS_VERSION);
  });

  it("password signup on a pre-existing consent-less account records the acceptance just given, but never overwrites an earlier one", async () => {
    const r = await legacyResident();
    expect((await call("POST", "/guest/signup", { email: r.email, password: "password123", termsAccepted: true })).status).toBe(201);
    expect((await terms(r.email)).version).toBe(TERMS_VERSION);

    const kept = fresh("kept");
    await db.prepare(`INSERT INTO residents (id, email, terms_accepted_at, terms_version) VALUES (?, ?, '2024-01-01 00:00:00', 'old')`).run(crypto.randomUUID(), kept);
    await call("POST", "/guest/signup", { email: kept, password: "password123", termsAccepted: true });
    expect((await terms(kept)).version).toBe("old");
  });

  it("vendor signup", async () => {
    const email = fresh("vendor");
    const res = await call("POST", "/auth/signup", { name: "V", email, password: "password123", termsAccepted: true, vendorType: "community", businessName: "Terms Hall", address: "1 St", county: "Dublin", mobile: "087", description: "d" });
    expect(res.status).toBe(201);
    const row = (await db.prepare(`SELECT terms_version FROM users WHERE email = ?`).get(email)) as { terms_version: string };
    expect(row.terms_version).toBe(TERMS_VERSION);
  });
});

describe("E1 + G2 — vendor accounts", () => {
  async function pendingVendor() {
    const email = fresh("setup");
    await call("POST", "/auth/signup", { name: "V", email, password: "password123", termsAccepted: true, vendorType: "community", businessName: "Setup Hall", address: "1 St", county: "Dublin", mobile: "087", description: "d" });
    const row = (await db.prepare(`SELECT id, org_id FROM users WHERE email = ?`).get(email)) as { id: string; org_id: string };
    return { email, id: row.id, h: { "X-Test-User-Id": row.id } };
  }

  it("setup-status works for a pending vendor and reflects only saved state", async () => {
    const v = await pendingVendor();
    const s = (await (await call("GET", "/auth/setup-status", undefined, v.h)).json()) as any;
    const done = (k: string) => s.steps.find((x: any) => x.key === k).done;
    expect(s.accountStatus).toBe("pending");
    expect([done("account"), done("terms"), done("details"), done("listing")]).toEqual([true, true, true, true]);
    expect([done("review"), done("photo"), done("capacity"), done("live")]).toEqual([false, false, false, false]);
    expect(s.complete).toBe(false);
    expect(s.listing.type).toBe("centre");

    await db.prepare(`UPDATE users SET status = 'approved' WHERE id = ?`).run(v.id);
    await db.prepare(`UPDATE centres SET image_url = '/x.jpg', capacity = 20, status = 'approved' WHERE vendor_id = ?`).run(v.id);
    const s2 = (await (await call("GET", "/auth/setup-status", undefined, v.h)).json()) as any;
    expect(s2.complete).toBe(true);
  });

  it("setup-status is vendor-only and scoped to the caller's own organisation", async () => {
    expect((await call("GET", "/auth/setup-status")).status).toBe(401);
    const a = await pendingVendor();
    const b = await pendingVendor();
    await db.prepare(`UPDATE centres SET image_url = '/b.jpg' WHERE vendor_id = ?`).run(b.id);
    const sa = (await (await call("GET", "/auth/setup-status", undefined, a.h)).json()) as any;
    expect(sa.steps.find((x: any) => x.key === "photo").done).toBe(false);
  });

  it("/auth/me exposes terms status; accept-terms needs the flag, is vendor-only, and only fills a NULL", async () => {
    const v = await pendingVendor();
    await db.prepare(`UPDATE users SET terms_accepted_at = NULL, terms_version = NULL WHERE id = ?`).run(v.id);
    expect(((await (await call("GET", "/auth/me", undefined, v.h)).json()) as any).user.termsAcceptedAt).toBeNull();

    expect((await call("POST", "/auth/accept-terms", {}, v.h)).status).toBe(400);
    expect((await call("POST", "/auth/accept-terms", { termsAccepted: true })).status).toBe(401);
    expect((await call("POST", "/auth/accept-terms", { termsAccepted: true }, v.h)).status).toBe(200);
    const row = (await db.prepare(`SELECT terms_accepted_at as at, terms_version as version FROM users WHERE id = ?`).get(v.id)) as any;
    expect(row.at).toBeTruthy();
    expect(row.version).toBe(TERMS_VERSION);

    const adminId = `admin-${crypto.randomUUID()}`;
    const adminEmail = fresh("admin");
    await db.prepare(`INSERT INTO users (id, email, password_hash, role, status, name) VALUES (?, ?, 'x', 'admin', 'approved', 'A')`).run(adminId, adminEmail);
    expect((await call("POST", "/auth/accept-terms", { termsAccepted: true }, { "X-Test-User-Id": adminId })).status).toBe(403);
  });
});
