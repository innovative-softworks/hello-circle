import crypto from "node:crypto";
import http, { type Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../db/index.js";
import { clubSessionsRouter } from "./clubSessions.js";

// Image Upload Coverage audit: club_sessions.image_url existed in the
// schema but had no create/edit UI and no fallback-to-club-cover logic —
// GET returned the raw column, which was always empty, so a session's card
// never showed the club's own photo either. This suite locks in the fix:
// a session with no override inherits the club's cover, an explicit
// imageUrl overrides it, and clearing the override (imageUrl: "") restores
// inheritance rather than leaving a broken image reference.

let server: Server;
let baseUrl: string;

const orgAId = `test-org-a-${crypto.randomUUID()}`;
const orgBId = `test-org-b-${crypto.randomUUID()}`;
const vendorAOwnerId = `test-vendor-a-owner-${crypto.randomUUID()}`;
const vendorAStaffId = `test-vendor-a-staff-${crypto.randomUUID()}`;
const vendorBOwnerId = `test-vendor-b-owner-${crypto.randomUUID()}`;
const clubAId = `test-club-a-${crypto.randomUUID()}`;
const clubCoverUrl = "https://media.hellocircle.ie/clubs/test-club-a/gallery/club-cover.jpg";

let apiUser: { id: string; role: string; status: string; invitedStaff: boolean; orgId: string; platformRole?: string } = {
  id: vendorAOwnerId,
  role: "vendor",
  status: "approved",
  invitedStaff: false,
  orgId: orgAId,
};

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).user = apiUser;
    next();
  });
  app.use("/club-sessions", clubSessionsRouter);

  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Failed to bind test server");
  baseUrl = `http://127.0.0.1:${address.port}`;

  await db.prepare(`INSERT INTO users (id, email, password_hash, role, status, name, org_id, invited_staff) VALUES (?, ?, 'x', 'vendor', 'approved', 'Org A Owner', ?, 0)`).run(vendorAOwnerId, `${vendorAOwnerId}@example.test`, orgAId);
  await db.prepare(`INSERT INTO users (id, email, password_hash, role, status, name, org_id, invited_staff) VALUES (?, ?, 'x', 'vendor', 'approved', 'Org A Staff', ?, 1)`).run(vendorAStaffId, `${vendorAStaffId}@example.test`, orgAId);
  await db.prepare(`INSERT INTO users (id, email, password_hash, role, status, name, org_id, invited_staff) VALUES (?, ?, 'x', 'vendor', 'approved', 'Org B Owner', ?, 0)`).run(vendorBOwnerId, `${vendorBOwnerId}@example.test`, orgBId);
  await db
    .prepare(`INSERT INTO clubs (id, name, sport, area, county, ages, price, unit, trial, ph, image_url, blurb, vendor_id) VALUES (?, 'Club A', 'Testball', 'Area', 'Dublin', '5-12', 10, 'year', 0, '', ?, '', ?)`)
    .run(clubAId, clubCoverUrl, vendorAOwnerId);
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await db.prepare(`DELETE FROM club_sessions WHERE club_id = ?`).run(clubAId);
  await db.prepare(`DELETE FROM clubs WHERE id = ?`).run(clubAId);
  await db.prepare(`DELETE FROM users WHERE id IN (?, ?, ?)`).run(vendorAOwnerId, vendorAStaffId, vendorBOwnerId);
});

function asUser(u: typeof apiUser) {
  apiUser = u;
}

describe("club session cover — fallback, override, and clearing", () => {
  let sessionId: string;

  it("creates a session with no image and it falls back to the club's cover", async () => {
    asUser({ id: vendorAOwnerId, role: "vendor", status: "approved", invitedStaff: false, orgId: orgAId });
    const createRes = await fetch(`${baseUrl}/club-sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clubId: clubAId, dayOfWeek: 2, time: "17:00", label: "Under-8s" }),
    });
    expect(createRes.status).toBe(201);
    sessionId = (await createRes.json()).id;

    const listRes = await fetch(`${baseUrl}/club-sessions?clubId=${clubAId}`);
    const list = await listRes.json();
    const session = list.find((s: any) => s.id === sessionId);
    expect(session.imageUrl).toBe(clubCoverUrl);
    expect(session.hasCustomImage).toBe(false);
  });

  it("setting a session-specific imageUrl overrides the club cover", async () => {
    const customUrl = "https://media.hellocircle.ie/club-sessions/x/cover/custom.jpg";
    const putRes = await fetch(`${baseUrl}/club-sessions/${sessionId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imageUrl: customUrl }),
    });
    expect(putRes.status).toBe(200);

    const listRes = await fetch(`${baseUrl}/club-sessions?clubId=${clubAId}`);
    const session = (await listRes.json()).find((s: any) => s.id === sessionId);
    expect(session.imageUrl).toBe(customUrl);
    expect(session.hasCustomImage).toBe(true);
  });

  it("clearing the override (imageUrl: '') restores inheritance from the club cover", async () => {
    const putRes = await fetch(`${baseUrl}/club-sessions/${sessionId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imageUrl: "" }),
    });
    expect(putRes.status).toBe(200);

    const listRes = await fetch(`${baseUrl}/club-sessions?clubId=${clubAId}`);
    const session = (await listRes.json()).find((s: any) => s.id === sessionId);
    expect(session.imageUrl).toBe(clubCoverUrl);
    expect(session.hasCustomImage).toBe(false);
  });

  it("an unrelated field update (no imageUrl passed) leaves the existing override untouched", async () => {
    const customUrl = "https://media.hellocircle.ie/club-sessions/x/cover/custom2.jpg";
    await fetch(`${baseUrl}/club-sessions/${sessionId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imageUrl: customUrl }),
    });
    await fetch(`${baseUrl}/club-sessions/${sessionId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: "Renamed" }),
    });

    const listRes = await fetch(`${baseUrl}/club-sessions?clubId=${clubAId}`);
    const session = (await listRes.json()).find((s: any) => s.id === sessionId);
    expect(session.imageUrl).toBe(customUrl);
    expect(session.hasCustomImage).toBe(true);
    expect(session.label).toBe("Renamed");
  });

  it("a vendor in a different org cannot create a session for someone else's club", async () => {
    asUser({ id: vendorBOwnerId, role: "vendor", status: "approved", invitedStaff: false, orgId: orgBId });
    const res = await fetch(`${baseUrl}/club-sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clubId: clubAId, dayOfWeek: 3, time: "18:00" }),
    });
    expect(res.status).toBe(403);
  });

  it("a vendor in a different org cannot edit someone else's session", async () => {
    asUser({ id: vendorBOwnerId, role: "vendor", status: "approved", invitedStaff: false, orgId: orgBId });
    const res = await fetch(`${baseUrl}/club-sessions/${sessionId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imageUrl: "https://media.hellocircle.ie/hijack.jpg" }),
    });
    expect(res.status).toBe(403);
  });

  it("an invited staff member without facility_manager access cannot create a session", async () => {
    asUser({ id: vendorAStaffId, role: "vendor", status: "approved", invitedStaff: true, orgId: orgAId, platformRole: "finance" });
    const res = await fetch(`${baseUrl}/club-sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clubId: clubAId, dayOfWeek: 4, time: "19:00" }),
    });
    expect(res.status).toBe(403);
  });

  it("an invited staff member WITH facility_manager access can create a session", async () => {
    asUser({ id: vendorAStaffId, role: "vendor", status: "approved", invitedStaff: true, orgId: orgAId, platformRole: "facility_manager" });
    const res = await fetch(`${baseUrl}/club-sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clubId: clubAId, dayOfWeek: 5, time: "20:00" }),
    });
    expect(res.status).toBe(201);
  });
});
