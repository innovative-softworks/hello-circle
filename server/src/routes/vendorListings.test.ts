import crypto from "node:crypto";
import http, { type Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../db/index.js";
import { vendorListingsRouter } from "./vendorListings.js";

// Vendor Experience Polish — Changeset 6 (test coverage backfill). Before
// this suite, vendorListings.ts (venue/club/room CRUD, publish/pause/
// duplicate, the last-active-room guard) had zero test coverage despite
// being the majority of the Vendor surface — the Vendor Experience Audit
// flagged this explicitly. Covers: organisation-ownership boundaries
// (Vendor A can't touch Vendor B's listing), RBAC (centre_manager vs
// facility_manager, and an invited staff member without the right role
// getting rejected), and the create/edit/publish/pause/duplicate/room
// lifecycle including the last-room-can't-deactivate guard.

let server: Server;
let baseUrl: string;

// Mutable so each request can act as a different caller — same pattern as
// vendorScheduleItems.test.ts.
let apiUser: { id: string; role: string; status: string; invitedStaff: boolean; platformRole?: string; vendorType: string } = {
  id: "",
  role: "vendor",
  status: "approved",
  invitedStaff: false,
  vendorType: "community",
};
let apiVendorIds: string[] = [];

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).user = apiUser;
    (req as any).vendorIds = apiVendorIds;
    next();
  });
  app.use("/", vendorListingsRouter);

  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Failed to bind test server");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("Centre CRUD: ownership boundaries + RBAC", () => {
  const vendorAId = `test-vendor-a-${crypto.randomUUID()}`;
  const vendorBId = `test-vendor-b-${crypto.randomUUID()}`;
  let centreId = "";

  beforeAll(async () => {
    await db.prepare(`INSERT INTO users (id, email, password_hash, role, status, name) VALUES (?, ?, 'x', 'vendor', 'approved', 'Test Vendor A')`).run(vendorAId, `${vendorAId}@example.test`);
    await db.prepare(`INSERT INTO users (id, email, password_hash, role, status, name) VALUES (?, ?, 'x', 'vendor', 'approved', 'Test Vendor B')`).run(vendorBId, `${vendorBId}@example.test`);
  });

  afterAll(async () => {
    if (centreId) {
      await db.prepare(`DELETE FROM rooms WHERE centre_id = ?`).run(centreId);
      await db.prepare(`DELETE FROM centre_amenities WHERE centre_id = ?`).run(centreId);
      await db.prepare(`DELETE FROM centres WHERE id = ?`).run(centreId);
    }
    await db.prepare(`DELETE FROM audit_log WHERE actor_user_id IN (?, ?)`).run(vendorAId, vendorBId);
    await db.prepare(`DELETE FROM users WHERE id IN (?, ?)`).run(vendorAId, vendorBId);
  });

  it("creates a draft centre with one auto-created active room", async () => {
    apiUser = { id: vendorAId, role: "vendor", status: "approved", invitedStaff: false, vendorType: "community" };
    apiVendorIds = [vendorAId];
    const res = await fetch(`${baseUrl}/centres`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "Test Centre A", county: "Dublin" }) });
    expect(res.status).toBe(201);
    const centre = (await res.json()) as { id: string; status: string };
    expect(centre.status).toBe("draft");
    centreId = centre.id;

    const rooms = (await db.prepare(`SELECT id, active FROM rooms WHERE centre_id = ?`).get(centreId)) as { id: string; active: number } | undefined;
    expect(rooms?.active).toBe(1);
  });

  it("an invited staff member without centre_manager is rejected (RBAC)", async () => {
    apiUser = { id: vendorAId, role: "vendor", status: "approved", invitedStaff: true, platformRole: "communications", vendorType: "community" };
    apiVendorIds = [vendorAId];
    const res = await fetch(`${baseUrl}/centres/${centreId}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ blurb: "Should not apply" }) });
    expect(res.status).toBe(403);
  });

  it("an invited staff member WITH centre_manager can edit (RBAC)", async () => {
    apiUser = { id: vendorAId, role: "vendor", status: "approved", invitedStaff: true, platformRole: "centre_manager", vendorType: "community" };
    apiVendorIds = [vendorAId];
    const res = await fetch(`${baseUrl}/centres/${centreId}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ blurb: "Updated by centre_manager" }) });
    expect(res.status).toBe(200);
  });

  it("Vendor B cannot edit Vendor A's centre (org ownership boundary)", async () => {
    apiUser = { id: vendorBId, role: "vendor", status: "approved", invitedStaff: false, vendorType: "community" };
    apiVendorIds = [vendorBId];
    const res = await fetch(`${baseUrl}/centres/${centreId}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ blurb: "Hostile edit" }) });
    expect(res.status).toBe(403);

    const row = (await db.prepare(`SELECT blurb FROM centres WHERE id = ?`).get(centreId)) as { blurb: string };
    expect(row.blurb).toBe("Updated by centre_manager");
  });

  it("Vendor B cannot delete Vendor A's centre", async () => {
    apiUser = { id: vendorBId, role: "vendor", status: "approved", invitedStaff: false, vendorType: "community" };
    apiVendorIds = [vendorBId];
    const res = await fetch(`${baseUrl}/centres/${centreId}`, { method: "DELETE" });
    expect(res.status).toBe(403);
  });

  it("publish rejects a centre missing required fields, then succeeds once complete", async () => {
    apiUser = { id: vendorAId, role: "vendor", status: "approved", invitedStaff: false, vendorType: "community" };
    apiVendorIds = [vendorAId];
    const missing = await fetch(`${baseUrl}/centres/${centreId}/publish`, { method: "POST" });
    expect(missing.status).toBe(400);

    await fetch(`${baseUrl}/centres/${centreId}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ area: "City Centre" }) });
    const ok = await fetch(`${baseUrl}/centres/${centreId}/publish`, { method: "POST" });
    expect(ok.status).toBe(200);
    const published = (await ok.json()) as { status: string };
    expect(published.status).toBe("pending");
  });

  it("pause/resume toggles between approved and paused, and rejects from the wrong state", async () => {
    apiUser = { id: vendorAId, role: "vendor", status: "approved", invitedStaff: false, vendorType: "community" };
    apiVendorIds = [vendorAId];
    // pause requires 'approved' — this centre is still 'pending' post-publish.
    const tooEarly = await fetch(`${baseUrl}/centres/${centreId}/pause`, { method: "POST" });
    expect(tooEarly.status).toBe(400);

    await db.prepare(`UPDATE centres SET status = 'approved' WHERE id = ?`).run(centreId);
    const paused = await fetch(`${baseUrl}/centres/${centreId}/pause`, { method: "POST" });
    expect(paused.status).toBe(200);
    expect(((await paused.json()) as { status: string }).status).toBe("paused");

    const resumed = await fetch(`${baseUrl}/centres/${centreId}/resume`, { method: "POST" });
    expect(resumed.status).toBe(200);
    expect(((await resumed.json()) as { status: string }).status).toBe("approved");
  });

  it("duplicate clones core fields into a new draft, Vendor B can't duplicate it", async () => {
    apiUser = { id: vendorAId, role: "vendor", status: "approved", invitedStaff: false, vendorType: "community" };
    apiVendorIds = [vendorAId];
    const res = await fetch(`${baseUrl}/centres/${centreId}/duplicate`, { method: "POST" });
    expect(res.status).toBe(201);
    const dup = (await res.json()) as { id: string; status: string };
    expect(dup.status).toBe("draft");
    await db.prepare(`DELETE FROM rooms WHERE centre_id = ?`).run(dup.id);
    await db.prepare(`DELETE FROM centre_amenities WHERE centre_id = ?`).run(dup.id);
    await db.prepare(`DELETE FROM centres WHERE id = ?`).run(dup.id);

    apiUser = { id: vendorBId, role: "vendor", status: "approved", invitedStaff: false, vendorType: "community" };
    apiVendorIds = [vendorBId];
    const forbidden = await fetch(`${baseUrl}/centres/${centreId}/duplicate`, { method: "POST" });
    expect(forbidden.status).toBe(403);
  });
});

describe("Rooms: last-active-room guard", () => {
  const vendorId = `test-vendor-rooms-${crypto.randomUUID()}`;
  let centreId = "";
  let firstRoomId = "";
  let secondRoomId = "";

  beforeAll(async () => {
    await db.prepare(`INSERT INTO users (id, email, password_hash, role, status, name) VALUES (?, ?, 'x', 'vendor', 'approved', 'Test Rooms Vendor')`).run(vendorId, `${vendorId}@example.test`);
    apiUser = { id: vendorId, role: "vendor", status: "approved", invitedStaff: false, vendorType: "community" };
    apiVendorIds = [vendorId];
    const res = await fetch(`${baseUrl}/centres`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "Rooms Test Centre", county: "Cork" }) });
    const centre = (await res.json()) as { id: string };
    centreId = centre.id;
    const roomsRes = await fetch(`${baseUrl}/centres/${centreId}/rooms`);
    const rooms = (await roomsRes.json()) as { id: string }[];
    firstRoomId = rooms[0].id;
  });

  afterAll(async () => {
    await db.prepare(`DELETE FROM rooms WHERE centre_id = ?`).run(centreId);
    await db.prepare(`DELETE FROM centre_amenities WHERE centre_id = ?`).run(centreId);
    await db.prepare(`DELETE FROM centres WHERE id = ?`).run(centreId);
    await db.prepare(`DELETE FROM audit_log WHERE actor_user_id = ?`).run(vendorId);
    await db.prepare(`DELETE FROM users WHERE id = ?`).run(vendorId);
  });

  it("refuses to deactivate the only active room", async () => {
    const res = await fetch(`${baseUrl}/centres/${centreId}/rooms/${firstRoomId}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ active: false }) });
    expect(res.status).toBe(409);
  });

  it("allows deactivating one of two active rooms, then refuses on the last one", async () => {
    const createRes = await fetch(`${baseUrl}/centres/${centreId}/rooms`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "Second Room" }) });
    const second = (await createRes.json()) as { id: string };
    secondRoomId = second.id;

    const deactivateFirst = await fetch(`${baseUrl}/centres/${centreId}/rooms/${firstRoomId}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ active: false }) });
    expect(deactivateFirst.status).toBe(200);

    const deactivateSecond = await fetch(`${baseUrl}/centres/${centreId}/rooms/${secondRoomId}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ active: false }) });
    expect(deactivateSecond.status).toBe(409);
  });

  it("two concurrent deactivate requests on the last two active rooms leave exactly one active", async () => {
    // Reactivate the first room so we're back to two active rooms, then race
    // deactivating both simultaneously — the row-lock guard should let
    // exactly one succeed.
    await db.prepare(`UPDATE rooms SET active = 1 WHERE id = ? AND centre_id = ?`).run(firstRoomId, centreId);
    const [r1, r2] = await Promise.all([
      fetch(`${baseUrl}/centres/${centreId}/rooms/${firstRoomId}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ active: false }) }),
      fetch(`${baseUrl}/centres/${centreId}/rooms/${secondRoomId}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ active: false }) }),
    ]);
    const statuses = [r1.status, r2.status].sort();
    expect(statuses).toEqual([200, 409]);

    const activeCount = (await db.prepare(`SELECT COUNT(*) as n FROM rooms WHERE centre_id = ? AND active = 1`).get(centreId)) as { n: number };
    expect(activeCount.n).toBe(1);
  });
});

describe("Club CRUD: ownership + RBAC", () => {
  const vendorAId = `test-vendor-club-a-${crypto.randomUUID()}`;
  const vendorBId = `test-vendor-club-b-${crypto.randomUUID()}`;
  let clubId = "";

  beforeAll(async () => {
    await db.prepare(`INSERT INTO users (id, email, password_hash, role, status, name) VALUES (?, ?, 'x', 'vendor', 'approved', 'Test Club Vendor A')`).run(vendorAId, `${vendorAId}@example.test`);
    await db.prepare(`INSERT INTO users (id, email, password_hash, role, status, name) VALUES (?, ?, 'x', 'vendor', 'approved', 'Test Club Vendor B')`).run(vendorBId, `${vendorBId}@example.test`);
  });

  afterAll(async () => {
    if (clubId) await db.prepare(`DELETE FROM clubs WHERE id = ?`).run(clubId);
    await db.prepare(`DELETE FROM audit_log WHERE actor_user_id IN (?, ?)`).run(vendorAId, vendorBId);
    await db.prepare(`DELETE FROM users WHERE id IN (?, ?)`).run(vendorAId, vendorBId);
  });

  it("a centre_manager-only staff member cannot create a club (wrong RBAC role)", async () => {
    apiUser = { id: vendorAId, role: "vendor", status: "approved", invitedStaff: true, platformRole: "centre_manager", vendorType: "community" };
    apiVendorIds = [vendorAId];
    const res = await fetch(`${baseUrl}/clubs`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "Test Club", sport: "Football", county: "Dublin" }) });
    expect(res.status).toBe(403);
  });

  it("a facility_manager can create a club", async () => {
    apiUser = { id: vendorAId, role: "vendor", status: "approved", invitedStaff: true, platformRole: "facility_manager", vendorType: "sports" };
    apiVendorIds = [vendorAId];
    const res = await fetch(`${baseUrl}/clubs`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "Test Club", sport: "Football", county: "Dublin" }) });
    expect(res.status).toBe(201);
    const club = (await res.json()) as { id: string };
    clubId = club.id;
  });

  it("Vendor B cannot edit or delete Vendor A's club", async () => {
    apiUser = { id: vendorBId, role: "vendor", status: "approved", invitedStaff: false, vendorType: "sports" };
    apiVendorIds = [vendorBId];
    const editRes = await fetch(`${baseUrl}/clubs/${clubId}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ blurb: "Hostile" }) });
    expect(editRes.status).toBe(403);
    const deleteRes = await fetch(`${baseUrl}/clubs/${clubId}`, { method: "DELETE" });
    expect(deleteRes.status).toBe(403);
  });
});
