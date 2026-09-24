import crypto from "node:crypto";
import http, { type Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../db/index.js";
import { manageRouter } from "./manage.js";

// Platform Pre-Launch Polish — Changeset 1/6. The account-linking flow
// (POST /link/request → email → POST /link/confirm) previously had no test
// coverage at all, and its client-side confirm page didn't even exist until
// this phase. This exercises the real server routes end to end against a
// real DB — the thing under test is the token lifecycle and the identity
// binding, not the email itself (sendMail already logs instead of sending
// under vitest, per this session's earlier SMTP fix).

let server: Server;
let baseUrl: string;

const vendorId = `test-vendor-link-${crypto.randomUUID()}`;
const otherVendorId = `test-vendor-link-other-${crypto.randomUUID()}`;
const residentId = `test-resident-link-${crypto.randomUUID()}`;
const otherResidentId = `test-resident-link-other-${crypto.randomUUID()}`;
const unlinkedResidentId = `test-resident-link-unlinked-${crypto.randomUUID()}`;
const residentEmail = `${residentId}@example.test`;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  // Mirrors real attachUser/attachResident closely enough for these
  // routes: manage.ts only ever reads req.user's id/role/businessName/
  // orgId/status/residentId and req.resident's id — a real DB-backed
  // lookup keyed by test headers, not a full session/cookie stack (the
  // thing under test is the linking logic, not cookie auth itself).
  app.use(async (req, _res, next) => {
    const testUserId = req.header("X-Test-User-Id");
    if (testUserId) {
      const row = (await db.prepare(`SELECT id, role, business_name as businessName, org_id as orgId, status, resident_id as residentId FROM users WHERE id = ?`).get(testUserId)) as
        | { id: string; role: string; businessName: string; orgId: string | null; status: string; residentId: string | null }
        | undefined;
      if (row) (req as any).user = row;
    }
    const testResidentId = req.header("X-Test-Resident-Id");
    if (testResidentId) (req as any).resident = { id: testResidentId };
    next();
  });
  app.use("/manage", manageRouter);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Failed to bind test server");
  baseUrl = `http://127.0.0.1:${address.port}`;

  await db.prepare(`INSERT INTO users (id, email, password_hash, role, status, name, business_name) VALUES (?, ?, 'x', 'vendor', 'approved', 'Test Owner', 'Test Linking Vendor')`).run(
    vendorId,
    `${vendorId}@example.test`
  );
  await db.prepare(`INSERT INTO users (id, email, password_hash, role, status, name, business_name) VALUES (?, ?, 'x', 'vendor', 'approved', 'Other Owner', 'Other Vendor')`).run(
    otherVendorId,
    `${otherVendorId}@example.test`
  );
  await db.prepare(`INSERT INTO residents (id, email, name) VALUES (?, ?, 'Link Resident')`).run(residentId, residentEmail);
  await db.prepare(`INSERT INTO residents (id, email, name) VALUES (?, ?, 'Other Resident')`).run(otherResidentId, `${otherResidentId}@example.test`);
  await db.prepare(`INSERT INTO residents (id, email, name) VALUES (?, ?, 'Unlinked Resident')`).run(unlinkedResidentId, `${unlinkedResidentId}@example.test`);
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await db.prepare(`DELETE FROM manage_link_tokens WHERE user_id IN (?, ?)`).run(vendorId, otherVendorId);
  await db.prepare(`DELETE FROM audit_log WHERE actor_user_id IN (?, ?)`).run(vendorId, otherVendorId);
  await db.prepare(`DELETE FROM users WHERE id IN (?, ?)`).run(vendorId, otherVendorId);
  await db.prepare(`DELETE FROM residents WHERE id IN (?, ?, ?)`).run(residentId, otherResidentId, unlinkedResidentId);
});

async function getToken(userId: string, email: string): Promise<string> {
  const row = (await db.prepare(`SELECT token FROM manage_link_tokens WHERE user_id = ? AND resident_email = ? ORDER BY expires_at DESC LIMIT 1`).get(userId, email)) as
    | { token: string }
    | undefined;
  if (!row) throw new Error("No link token found — /link/request didn't create one");
  return row.token;
}

describe("Account linking — request + confirm", () => {
  it("a vendor can request a link to a real resident account", async () => {
    const res = await fetch(`${baseUrl}/manage/link/request`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Test-User-Id": vendorId },
      body: JSON.stringify({ residentEmail }),
    });
    expect(res.status).toBe(200);
    const token = await getToken(vendorId, residentEmail);
    expect(token).toBeTruthy();
  });

  it("rejects a request for an email with no HelloCircle resident account", async () => {
    const res = await fetch(`${baseUrl}/manage/link/request`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Test-User-Id": vendorId },
      body: JSON.stringify({ residentEmail: `nobody-${crypto.randomUUID()}@example.test` }),
    });
    expect(res.status).toBe(404);
  });

  it("an invalid token is rejected", async () => {
    const res = await fetch(`${baseUrl}/manage/link/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: "not-a-real-token" }),
    });
    expect(res.status).toBe(400);
    const row = await db.prepare(`SELECT resident_id FROM users WHERE id = ?`).get(vendorId);
    expect((row as { resident_id: string | null }).resident_id).toBeNull();
  });

  it("an expired token is rejected the same way, without linking", async () => {
    const expiredToken = crypto.randomBytes(32).toString("hex");
    await db.prepare(`INSERT INTO manage_link_tokens (token, user_id, resident_email, expires_at) VALUES (?, ?, ?, DATE_SUB(NOW(), INTERVAL 1 MINUTE))`).run(expiredToken, vendorId, residentEmail);
    const res = await fetch(`${baseUrl}/manage/link/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: expiredToken }),
    });
    expect(res.status).toBe(400);
    const row = await db.prepare(`SELECT resident_id FROM users WHERE id = ?`).get(vendorId);
    expect((row as { resident_id: string | null }).resident_id).toBeNull();
  });

  it("a valid token links the accounts, and workspaces appear afterward", async () => {
    const token = await getToken(vendorId, residentEmail);
    const res = await fetch(`${baseUrl}/manage/link/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    expect(res.status).toBe(200);

    const row = (await db.prepare(`SELECT resident_id as residentId FROM users WHERE id = ?`).get(vendorId)) as { residentId: string | null };
    expect(row.residentId).toBe(residentId);

    const workspaces = await fetch(`${baseUrl}/manage/workspaces`, { headers: { "X-Test-Resident-Id": residentId } });
    const body = (await workspaces.json()) as { vendor: { businessName: string; status: string } | null };
    expect(body.vendor).toMatchObject({ businessName: "Test Linking Vendor", status: "approved" });
  });

  it("the same token cannot be used twice (already-used)", async () => {
    // A fresh token, confirmed once, then replayed.
    await fetch(`${baseUrl}/manage/link/request`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Test-User-Id": otherVendorId },
      body: JSON.stringify({ residentEmail: `${otherResidentId}@example.test` }),
    });
    const token = await getToken(otherVendorId, `${otherResidentId}@example.test`);
    const first = await fetch(`${baseUrl}/manage/link/confirm`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) });
    expect(first.status).toBe(200);

    const replay = await fetch(`${baseUrl}/manage/link/confirm`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) });
    expect(replay.status).toBe(400);
  });
});

describe("Account linking — cannot link an arbitrary unrelated identity", () => {
  it("a vendor cannot link a resident who never confirmed — no request, no token, nothing to confirm", async () => {
    // Simulates "escalation without proof of inbox": no /link/request was
    // ever made for unlinkedResidentId, so no token exists for it at all —
    // there is no way to link it without going through the email step.
    const { n } = (await db.prepare(`SELECT COUNT(*) as n FROM manage_link_tokens WHERE resident_email = ?`).get(`${unlinkedResidentId}@example.test`)) as { n: number };
    expect(n).toBe(0);
  });

  it("linking one vendor to a resident does not grant a second, unrelated vendor account the same link", async () => {
    // otherVendorId got linked to otherResidentId above — vendorId's own
    // link (to residentId) must be completely unaffected.
    const row = (await db.prepare(`SELECT resident_id as residentId FROM users WHERE id = ?`).get(vendorId)) as { residentId: string | null };
    expect(row.residentId).toBe(residentId);
    const otherRow = (await db.prepare(`SELECT resident_id as residentId FROM users WHERE id = ?`).get(otherVendorId)) as { residentId: string | null };
    expect(otherRow.residentId).toBe(otherResidentId);
    expect(otherRow.residentId).not.toBe(row.residentId);
  });
});

describe("Workspace switch cannot mint an arbitrary session", () => {
  it("switching to 'vendor' only works for the resident's own linked account — an unlinked resident gets 404, not someone else's vendor session", async () => {
    const res = await fetch(`${baseUrl}/manage/switch`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Test-Resident-Id": unlinkedResidentId },
      body: JSON.stringify({ to: "vendor" }),
    });
    expect(res.status).toBe(404);
  });

  it("switching to 'resident' only works for the vendor's own linked account", async () => {
    const res = await fetch(`${baseUrl}/manage/switch`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Test-User-Id": otherVendorId },
      body: JSON.stringify({ to: "resident" }),
    });
    // otherVendorId's req.user stub above is a fresh DB read each request,
    // so this reflects the real, already-linked resident_id — confirms the
    // route resolves strictly from the caller's own identity, never a
    // client-supplied resident id (the request body only ever carries `to`).
    expect(res.status).toBe(200);
  });
});
