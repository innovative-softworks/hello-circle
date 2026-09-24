import crypto from "node:crypto";
import http, { type Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../db/index.js";
import { orgRouter } from "./org.js";

// Vendor Experience Polish — Changeset 6 (test coverage backfill). org.ts
// had zero coverage despite being the real, enforced owner-vs-staff RBAC
// boundary for the whole Organisation surface (profile/policies/logo/staff
// invites) — this covers exactly that boundary: the org owner can do
// everything, an invited staff member (regardless of their platformRole,
// since org.ts gates on `invitedStaff` alone, not `requirePlatformRole`)
// is rejected from every owner-only mutation.

let server: Server;
let baseUrl: string;

const orgId = `test-org-${crypto.randomUUID()}`;
const ownerId = `test-owner-${crypto.randomUUID()}`;
const staffId = `test-staff-${crypto.randomUUID()}`;

let apiUser: { id: string; role: string; status: string; invitedStaff: boolean; orgId: string; businessName?: string } = {
  id: ownerId,
  role: "vendor",
  status: "approved",
  invitedStaff: false,
  orgId,
};

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).user = apiUser;
    next();
  });
  app.use("/", orgRouter);

  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Failed to bind test server");
  baseUrl = `http://127.0.0.1:${address.port}`;

  await db.prepare(`INSERT INTO organisations (id, name, kind) VALUES (?, 'Test Org', 'vendor')`).run(orgId);
  await db
    .prepare(`INSERT INTO users (id, email, password_hash, role, status, name, org_id, invited_staff) VALUES (?, ?, 'x', 'vendor', 'approved', 'Test Owner', ?, 0)`)
    .run(ownerId, `${ownerId}@example.test`, orgId);
  await db
    .prepare(`INSERT INTO users (id, email, password_hash, role, status, name, org_id, invited_staff, platform_role) VALUES (?, ?, 'x', 'vendor', 'approved', 'Test Staff', ?, 1, 'communications')`)
    .run(staffId, `${staffId}@example.test`, orgId);
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await db.prepare(`DELETE FROM org_invites WHERE org_id = ?`).run(orgId);
  await db.prepare(`DELETE FROM org_policies WHERE org_id = ?`).run(orgId);
  await db.prepare(`DELETE FROM audit_log WHERE actor_user_id IN (?, ?)`).run(ownerId, staffId);
  await db.prepare(`DELETE FROM users WHERE id IN (?, ?)`).run(ownerId, staffId);
  await db.prepare(`DELETE FROM organisations WHERE id = ?`).run(orgId);
});

describe("GET / — both owner and staff can read", () => {
  it("owner sees isOwner: true", async () => {
    apiUser = { id: ownerId, role: "vendor", status: "approved", invitedStaff: false, orgId };
    const res = await fetch(`${baseUrl}/`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { isOwner: boolean };
    expect(body.isOwner).toBe(true);
  });

  it("staff sees isOwner: false but can still read", async () => {
    apiUser = { id: staffId, role: "vendor", status: "approved", invitedStaff: true, orgId };
    const res = await fetch(`${baseUrl}/`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { isOwner: boolean };
    expect(body.isOwner).toBe(false);
  });
});

describe("Owner-only mutations reject an invited staff member", () => {
  it("PUT / (profile) — staff rejected, owner succeeds", async () => {
    apiUser = { id: staffId, role: "vendor", status: "approved", invitedStaff: true, orgId };
    const staffRes = await fetch(`${baseUrl}/`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "Hostile rename" }) });
    expect(staffRes.status).toBe(403);

    apiUser = { id: ownerId, role: "vendor", status: "approved", invitedStaff: false, orgId };
    const ownerRes = await fetch(`${baseUrl}/`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "Legit Rename Co" }) });
    expect(ownerRes.status).toBe(200);

    const row = (await db.prepare(`SELECT name FROM organisations WHERE id = ?`).get(orgId)) as { name: string };
    expect(row.name).toBe("Legit Rename Co");
  });

  it("PUT /logo — staff rejected, owner succeeds", async () => {
    apiUser = { id: staffId, role: "vendor", status: "approved", invitedStaff: true, orgId };
    const staffRes = await fetch(`${baseUrl}/logo`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ logo: "https://example.test/hostile.png" }) });
    expect(staffRes.status).toBe(403);

    apiUser = { id: ownerId, role: "vendor", status: "approved", invitedStaff: false, orgId };
    const ownerRes = await fetch(`${baseUrl}/logo`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ logo: "https://example.test/real.png" }) });
    expect(ownerRes.status).toBe(200);
  });

  it("PUT /policies — staff rejected, owner succeeds and existing fields survive a partial update", async () => {
    apiUser = { id: ownerId, role: "vendor", status: "approved", invitedStaff: false, orgId };
    await fetch(`${baseUrl}/policies`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ taxNumber: "IE1234567T" }) });

    apiUser = { id: staffId, role: "vendor", status: "approved", invitedStaff: true, orgId };
    const staffRes = await fetch(`${baseUrl}/policies`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cancellationHours: 1 }) });
    expect(staffRes.status).toBe(403);

    apiUser = { id: ownerId, role: "vendor", status: "approved", invitedStaff: false, orgId };
    const ownerRes = await fetch(`${baseUrl}/policies`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cancellationHours: 24 }) });
    expect(ownerRes.status).toBe(200);

    // Partial update (cancellationHours only) must not blank out taxNumber
    // set by the earlier owner call — the exact COALESCE-on-both-sides bug
    // this route's own comment says it fixed.
    const row = (await db.prepare(`SELECT cancellation_hours as cancellationHours, tax_number as taxNumber FROM org_policies WHERE org_id = ?`).get(orgId)) as {
      cancellationHours: number;
      taxNumber: string;
    };
    expect(row.cancellationHours).toBe(24);
    expect(row.taxNumber).toBe("IE1234567T");
  });

  it("POST /staff/invite and DELETE /staff/invite/:token — staff rejected, owner succeeds", async () => {
    apiUser = { id: staffId, role: "vendor", status: "approved", invitedStaff: true, orgId };
    const staffRes = await fetch(`${baseUrl}/staff/invite`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "new-staff@example.test", platformRole: "finance" }) });
    expect(staffRes.status).toBe(403);

    apiUser = { id: ownerId, role: "vendor", status: "approved", invitedStaff: false, orgId };
    const ownerRes = await fetch(`${baseUrl}/staff/invite`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "new-staff@example.test", platformRole: "finance" }) });
    expect(ownerRes.status).toBe(201);

    const invite = (await db.prepare(`SELECT token FROM org_invites WHERE org_id = ? AND email = ?`).get(orgId, "new-staff@example.test")) as { token: string };
    expect(invite.token).toBeTruthy();

    apiUser = { id: staffId, role: "vendor", status: "approved", invitedStaff: true, orgId };
    const revokeAsStaff = await fetch(`${baseUrl}/staff/invite/${invite.token}`, { method: "DELETE" });
    expect(revokeAsStaff.status).toBe(403);

    apiUser = { id: ownerId, role: "vendor", status: "approved", invitedStaff: false, orgId };
    const revokeAsOwner = await fetch(`${baseUrl}/staff/invite/${invite.token}`, { method: "DELETE" });
    expect(revokeAsOwner.status).toBe(200);

    const row = (await db.prepare(`SELECT status FROM org_invites WHERE token = ?`).get(invite.token)) as { status: string };
    expect(row.status).toBe("revoked");
  });

  it("rejects an invalid platformRole rather than silently accepting it", async () => {
    apiUser = { id: ownerId, role: "vendor", status: "approved", invitedStaff: false, orgId };
    const res = await fetch(`${baseUrl}/staff/invite`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "bad-role@example.test", platformRole: "super_admin" }) });
    expect(res.status).toBe(400);
  });
});
