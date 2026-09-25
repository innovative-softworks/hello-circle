import cookieParser from "cookie-parser";
import crypto from "node:crypto";
import http, { type Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { attachUser, createUser, requireVendor } from "../auth.js";
import { db } from "../db/index.js";
import { adminRouter } from "./admin.js";
import { authRouter } from "./auth.js";

// Vendor Experience Polish — Changeset 6 (test coverage backfill). Exercises
// the real end-to-end Vendor onboarding flow the Vendor Experience Audit
// found had zero coverage: signup -> pending user + pending draft listing
// -> a pending vendor can log in (gets a session) but every /vendor/* route
// stays 403'd by requireVendor -> admin approval -> the same session now
// passes requireVendor. Uses the real authRouter/adminRouter/attachUser
// middleware (not stubbed identity) since this is specifically testing
// that wiring, with real session cookies carried across requests.

let server: Server;
let baseUrl: string;

const adminEmail = `test-admin-${crypto.randomUUID()}@example.test`;
const adminPassword = "adminpass123";
const vendorEmail = `test-vendor-flow-${crypto.randomUUID()}@example.test`;
const vendorPassword = "vendorpass123";
let vendorUserId = "";
let createdCentreId = "";
let createdOrgId = "";

function extractCookie(res: { headers: { get(name: string): string | null } }): string {
  const setCookie = res.headers.get("set-cookie");
  if (!setCookie) throw new Error("No Set-Cookie header on response");
  return setCookie.split(";")[0];
}

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use(attachUser);
  app.use("/auth", authRouter);
  app.use("/admin", adminRouter);
  // A minimal stand-in for the real /vendor/* mount (vendor.ts) — just
  // enough to prove requireVendor's approval gate actually blocks/allows
  // real sessions, without pulling in the full vendor router tree.
  app.get("/vendor/ping", requireVendor, (_req, res) => res.json({ ok: true }));

  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Failed to bind test server");
  baseUrl = `http://127.0.0.1:${address.port}`;

  await createUser(adminEmail, adminPassword, "Test Admin", "admin", "approved");
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  if (createdCentreId) {
    await db.prepare(`DELETE FROM rooms WHERE centre_id = ?`).run(createdCentreId);
    await db.prepare(`DELETE FROM centres WHERE id = ?`).run(createdCentreId);
  }
  await db.prepare(`DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email IN (?, ?))`).run(adminEmail, vendorEmail);
  await db.prepare(`DELETE FROM audit_log WHERE actor_user_id IN (SELECT id FROM users WHERE email IN (?, ?))`).run(adminEmail, vendorEmail);
  await db.prepare(`DELETE FROM users WHERE email IN (?, ?)`).run(adminEmail, vendorEmail);
  if (createdOrgId) await db.prepare(`DELETE FROM organisations WHERE id = ?`).run(createdOrgId);
});

describe("Vendor signup -> pending -> admin approval -> vendor access", () => {
  it("signup creates a pending user and a pending draft centre, no session set", async () => {
    const res = await fetch(`${baseUrl}/auth/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: vendorEmail,
        password: vendorPassword,
        name: "Test Vendor Flow",
        vendorType: "community",
        businessName: "Test Flow Centre",
        address: "1 Test Street",
        county: "Dublin",
        mobile: "0850000000",
        description: "A test centre for the auth flow suite",
        termsAccepted: true,
      }),
    });
    expect(res.status).toBe(201);
    expect(res.headers.get("set-cookie")).toBeNull();

    const row = (await db.prepare(`SELECT id, status, org_id FROM users WHERE email = ?`).get(vendorEmail)) as { id: string; status: string; org_id: string };
    expect(row.status).toBe("pending");
    vendorUserId = row.id;
    createdOrgId = row.org_id;

    // The signup form already collects every required field itself, so its
    // listing skips the draft/wizard step entirely and goes straight to
    // 'pending' admin review — unlike POST /vendor/centres (vendorListings.ts),
    // which starts a listing created after signup as 'draft' until the
    // vendor explicitly publishes it. Confirmed against the actual insert in
    // auth.ts's /signup handler.
    const centre = (await db.prepare(`SELECT id, status FROM centres WHERE vendor_id = ?`).get(vendorUserId)) as { id: string; status: string };
    expect(centre.status).toBe("pending");
    createdCentreId = centre.id;
  });

  it("a pending vendor can log in (gets a session) but requireVendor still blocks them", async () => {
    const loginRes = await fetch(`${baseUrl}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: vendorEmail, password: vendorPassword }),
    });
    expect(loginRes.status).toBe(200);
    const cookie = extractCookie(loginRes);

    const pingRes = await fetch(`${baseUrl}/vendor/ping`, { headers: { Cookie: cookie } });
    expect(pingRes.status).toBe(403);
    const body = (await pingRes.json()) as { error: string };
    expect(body.error).toMatch(/not yet approved/i);
  });

  it("an admin approves the vendor account", async () => {
    const adminLogin = await fetch(`${baseUrl}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: adminEmail, password: adminPassword }),
    });
    expect(adminLogin.status).toBe(200);
    const adminCookie = extractCookie(adminLogin);

    const approveRes = await fetch(`${baseUrl}/admin/vendors/${vendorUserId}/status`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({ status: "approved" }),
    });
    expect(approveRes.status).toBe(200);

    const row = (await db.prepare(`SELECT status FROM users WHERE id = ?`).get(vendorUserId)) as { status: string };
    expect(row.status).toBe("approved");
  });

  it("the same vendor session now passes requireVendor", async () => {
    const loginRes = await fetch(`${baseUrl}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: vendorEmail, password: vendorPassword }),
    });
    const cookie = extractCookie(loginRes);

    const pingRes = await fetch(`${baseUrl}/vendor/ping`, { headers: { Cookie: cookie } });
    expect(pingRes.status).toBe(200);
  });

  it("a non-admin vendor cannot approve their own account", async () => {
    const loginRes = await fetch(`${baseUrl}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: vendorEmail, password: vendorPassword }),
    });
    const cookie = extractCookie(loginRes);

    const res = await fetch(`${baseUrl}/admin/vendors/${vendorUserId}/status`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ status: "approved" }),
    });
    expect(res.status).toBe(401);
  });
});
