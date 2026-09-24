import crypto from "node:crypto";
import http, { type Server } from "node:http";
import express from "express";
import { HeadObjectCommand } from "@aws-sdk/client-s3";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../db/index.js";
import { r2Client } from "../media/r2Client.js";
import { deleteObject } from "../media/mediaService.js";
import { mediaRouter } from "./media.js";

/** SOI + a single SOF0 segment — same minimal, real-signature fixture as
 * media/imageSniff.test.ts's buildMinimalJpeg, not a fully decodable JPEG
 * (no scan data). sniffImage() only reads the signature/header, so this is
 * enough to exercise finalizeUpload's real bounded-read validation against
 * live R2 — it does NOT prove full pixel decodability, which this app's
 * validation still doesn't attempt (documented gap, see mediaService.ts). */
function buildMinimalJpeg(width: number, height: number): Buffer {
  const buf = Buffer.alloc(19);
  buf[0] = 0xff;
  buf[1] = 0xd8;
  buf[2] = 0xff;
  buf[3] = 0xc0;
  buf.writeUInt16BE(11, 4);
  buf[6] = 8;
  buf.writeUInt16BE(height, 7);
  buf.writeUInt16BE(width, 9);
  buf[11] = 1;
  return buf;
}

async function objectExistsInR2(key: string): Promise<boolean> {
  try {
    await r2Client!.send(new HeadObjectCommand({ Bucket: process.env.R2_BUCKET!, Key: key }));
    return true;
  } catch {
    return false;
  }
}

// Cloudflare R2 Media System — Changesets 1-3. Exercises the authorization
// matrix in media.ts's checkUploadPermission, which is the security-
// critical part of this router (the Image/Media System Audit's §6
// finding: the OLD generic /api/uploads route has role-only auth with no
// entity ownership check at all — this suite is what proves the NEW
// authorize/finalize/release flow closes that gap for every entity type).
//
// server/.env has MEDIA_PROVIDER=r2 with real, live-verified R2
// credentials (vitest.setup.ts loads the full .env), so every "passes
// permission" assertion below exercises a genuine authorizeUpload() call
// against real Cloudflare R2 — not a mocked/local-fallback path. Permission
// is still checked BEFORE anything R2-specific happens (see media.ts's own
// comment on that ordering), which is what keeps the 401/403 authorization
// assertions meaningful independent of whichever storage backend is live.

let server: Server;
let baseUrl: string;

const orgAOwnerId = `test-org-a-owner-${crypto.randomUUID()}`;
const orgAStaffId = `test-org-a-staff-${crypto.randomUUID()}`;
const orgBOwnerId = `test-org-b-owner-${crypto.randomUUID()}`;
const orgAId = `test-org-a-${crypto.randomUUID()}`;
const orgBId = `test-org-b-${crypto.randomUUID()}`;

const hostResidentId = `test-host-${crypto.randomUUID()}`;
const otherResidentId = `test-other-resident-${crypto.randomUUID()}`;
const organiserResidentId = `test-organiser-${crypto.randomUUID()}`;
const memberResidentId = `test-member-${crypto.randomUUID()}`;
const outsiderResidentId = `test-outsider-${crypto.randomUUID()}`;

const centreId = `test-centre-${crypto.randomUUID()}`;
const gameId = `test-game-${crypto.randomUUID()}`;
const openCircleId = `test-open-circle-${crypto.randomUUID()}`;
const restrictedCircleId = `test-restricted-circle-${crypto.randomUUID()}`;
const clubId = `test-club-${crypto.randomUUID()}`;
const clubSessionId = `test-club-session-${crypto.randomUUID()}`;

// Media architecture pass — authorize now returns a throwaway, NOT
// entity-namespaced staging key (see mediaService.ts's stagingKeyFor);
// ownership is proven by a `pending` media_assets ledger row created at
// authorize time instead, keyed to that exact staging key. This helper
// asserts that row exists with the right entity binding, closing the same
// gap a plain string-prefix check on the key used to close.
async function expectPendingLedgerRow(objectKey: string, entityType: string, entityId: string) {
  expect(objectKey).toMatch(/^_staging\/[0-9a-f-]+\.[a-z]+$/);
  const row = (await db.prepare(`SELECT entity_type as entityType, entity_id as entityId, status FROM media_assets WHERE id = ?`).get(objectKey)) as
    | { entityType: string; entityId: string; status: string }
    | undefined;
  expect(row).toBeDefined();
  expect(row?.entityType).toBe(entityType);
  expect(row?.entityId).toBe(entityId);
  expect(row?.status).toBe("pending");
}

function asVendor(user: { id: string; status?: string; invitedStaff?: boolean; orgId?: string }) {
  return {
    "X-Test-User-Id": user.id,
    "X-Test-User-Role": "vendor",
    "X-Test-User-Status": user.status ?? "approved",
    "X-Test-Invited-Staff": user.invitedStaff ? "true" : "false",
    "X-Test-Org-Id": user.orgId ?? "",
  };
}
function asResident(residentId: string) {
  return { "X-Test-Resident-Id": residentId };
}

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const userId = req.header("X-Test-User-Id");
    if (userId) {
      (req as any).user = {
        id: userId,
        role: req.header("X-Test-User-Role") ?? "vendor",
        status: req.header("X-Test-User-Status") ?? "approved",
        invitedStaff: req.header("X-Test-Invited-Staff") === "true",
        orgId: req.header("X-Test-Org-Id") || null,
      };
    }
    const residentId = req.header("X-Test-Resident-Id");
    if (residentId) (req as any).resident = { id: residentId, name: "Test Resident" };
    next();
  });
  app.use("/media", mediaRouter);

  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Failed to bind test server");
  baseUrl = `http://127.0.0.1:${address.port}`;

  await db.prepare(`INSERT INTO users (id, email, password_hash, role, status, name, org_id, invited_staff) VALUES (?, ?, 'x', 'vendor', 'approved', 'Org A Owner', ?, 0)`).run(orgAOwnerId, `${orgAOwnerId}@example.test`, orgAId);
  await db.prepare(`INSERT INTO users (id, email, password_hash, role, status, name, org_id, invited_staff) VALUES (?, ?, 'x', 'vendor', 'approved', 'Org A Staff', ?, 1)`).run(orgAStaffId, `${orgAStaffId}@example.test`, orgAId);
  await db.prepare(`INSERT INTO users (id, email, password_hash, role, status, name, org_id, invited_staff) VALUES (?, ?, 'x', 'vendor', 'approved', 'Org B Owner', ?, 0)`).run(orgBOwnerId, `${orgBOwnerId}@example.test`, orgBId);

  await db
    .prepare(
      `INSERT INTO centres (id, name, area, county, rating, reviews, capacity, from_price, managed_by, ph, blurb, vendor_id) VALUES (?, 'Test Centre', 'Area', 'Dublin', 0, 0, 10, 1000, '', '', '', ?)`
    )
    .run(centreId, orgAOwnerId);
  await db
    .prepare(`INSERT INTO clubs (id, name, sport, area, county, ages, price, unit, trial, ph, blurb, vendor_id) VALUES (?, 'Test Club', 'Testball', 'Area', 'Dublin', '5-12', 10, 'year', 0, '', '', ?)`)
    .run(clubId, orgAOwnerId);
  await db.prepare(`INSERT INTO club_sessions (id, club_id, day_of_week, time) VALUES (?, ?, 1, '18:00')`).run(clubSessionId, clubId);

  await db.prepare(`INSERT INTO residents (id, email, name) VALUES (?, ?, 'Host')`).run(hostResidentId, `${hostResidentId}@example.test`);
  await db.prepare(`INSERT INTO residents (id, email, name) VALUES (?, ?, 'Other')`).run(otherResidentId, `${otherResidentId}@example.test`);
  await db.prepare(`INSERT INTO residents (id, email, name) VALUES (?, ?, 'Organiser')`).run(organiserResidentId, `${organiserResidentId}@example.test`);
  await db.prepare(`INSERT INTO residents (id, email, name) VALUES (?, ?, 'Member')`).run(memberResidentId, `${memberResidentId}@example.test`);
  await db.prepare(`INSERT INTO residents (id, email, name) VALUES (?, ?, 'Outsider')`).run(outsiderResidentId, `${outsiderResidentId}@example.test`);

  const future = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await db
    .prepare(`INSERT INTO games (id, host_resident_id, activity_label, location_text, date, time, capacity) VALUES (?, ?, 'Testball', 'Test Location', ?, '18:00', 10)`)
    .run(gameId, hostResidentId, future.toISOString().slice(0, 10));

  await db
    .prepare(`INSERT INTO circles (id, name, activity_label, area, county, about, created_by_resident_id, join_mode) VALUES (?, 'Open Circle', 'Testball', 'Area', 'Dublin', '', ?, 'open')`)
    .run(openCircleId, organiserResidentId);
  await db.prepare(`INSERT INTO circle_members (circle_id, resident_id, role) VALUES (?, ?, 'organiser')`).run(openCircleId, organiserResidentId);

  await db
    .prepare(`INSERT INTO circles (id, name, activity_label, area, county, about, created_by_resident_id, join_mode, image_url) VALUES (?, 'Restricted Circle', 'Testball', 'Area', 'Dublin', '', ?, 'invite', 'https://media.hellocircle.ie/circles/test-fixture/cover/x.jpg')`)
    .run(restrictedCircleId, organiserResidentId);
  await db.prepare(`INSERT INTO circle_members (circle_id, resident_id, role) VALUES (?, ?, 'organiser')`).run(restrictedCircleId, organiserResidentId);
  await db.prepare(`INSERT INTO circle_members (circle_id, resident_id, role) VALUES (?, ?, 'member')`).run(restrictedCircleId, memberResidentId);
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await db.prepare(`DELETE FROM circle_members WHERE circle_id IN (?, ?)`).run(openCircleId, restrictedCircleId);
  await db.prepare(`DELETE FROM circles WHERE id IN (?, ?)`).run(openCircleId, restrictedCircleId);
  await db.prepare(`DELETE FROM games WHERE id = ?`).run(gameId);
  await db.prepare(`DELETE FROM club_sessions WHERE id = ?`).run(clubSessionId);
  await db.prepare(`DELETE FROM clubs WHERE id = ?`).run(clubId);
  await db.prepare(`DELETE FROM centres WHERE id = ?`).run(centreId);
  await db.prepare(`DELETE FROM residents WHERE id IN (?, ?, ?, ?, ?)`).run(hostResidentId, otherResidentId, organiserResidentId, memberResidentId, outsiderResidentId);
  await db.prepare(`DELETE FROM users WHERE id IN (?, ?, ?)`).run(orgAOwnerId, orgAStaffId, orgBOwnerId);
});

describe("POST /media/authorize — request validation", () => {
  it("400s on missing fields", async () => {
    const res = await fetch(`${baseUrl}/media/authorize`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
    expect(res.status).toBe(400);
  });

  it("400s on an unknown entityType", async () => {
    const res = await fetch(`${baseUrl}/media/authorize`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...asVendor({ id: orgAOwnerId, orgId: orgAId }) },
      body: JSON.stringify({ entityType: "bogus", entityId: centreId, contentType: "image/jpeg" }),
    });
    expect(res.status).toBe(400);
  });
});

describe("POST /media/authorize — resident-avatar", () => {
  it("401s when signed out", async () => {
    const res = await fetch(`${baseUrl}/media/authorize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entityType: "resident-avatar", entityId: hostResidentId, contentType: "image/jpeg" }),
    });
    expect(res.status).toBe(401);
  });

  it("403s trying to manage someone else's avatar", async () => {
    const res = await fetch(`${baseUrl}/media/authorize`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...asResident(otherResidentId) },
      body: JSON.stringify({ entityType: "resident-avatar", entityId: hostResidentId, contentType: "image/jpeg" }),
    });
    expect(res.status).toBe(403);
  });

  it("authorizes a real R2 upload for one's own avatar", async () => {
    const res = await fetch(`${baseUrl}/media/authorize`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...asResident(hostResidentId) },
      body: JSON.stringify({ entityType: "resident-avatar", entityId: hostResidentId, contentType: "image/jpeg" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.provider).toBe("r2");
    await expectPendingLedgerRow(body.objectKey, "resident-avatar", hostResidentId);
    expect(body.uploadUrl).toMatch(/^https:\/\/.*r2\.cloudflarestorage\.com\//);
  });
});

describe("POST /media/authorize — activity-cover (Game)", () => {
  it("403s a non-host resident", async () => {
    const res = await fetch(`${baseUrl}/media/authorize`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...asResident(otherResidentId) },
      body: JSON.stringify({ entityType: "activity-cover", entityId: gameId, contentType: "image/jpeg" }),
    });
    expect(res.status).toBe(403);
  });

  it("authorizes a real R2 upload for the actual host", async () => {
    const res = await fetch(`${baseUrl}/media/authorize`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...asResident(hostResidentId) },
      body: JSON.stringify({ entityType: "activity-cover", entityId: gameId, contentType: "image/jpeg" }),
    });
    expect(res.status).toBe(200);
    await expectPendingLedgerRow((await res.json()).objectKey, "activity-cover", gameId);
  });
});

describe("POST /media/authorize — circle-cover", () => {
  it("403s a non-organiser member", async () => {
    const res = await fetch(`${baseUrl}/media/authorize`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...asResident(memberResidentId) },
      body: JSON.stringify({ entityType: "circle-cover", entityId: restrictedCircleId, contentType: "image/jpeg" }),
    });
    expect(res.status).toBe(403);
  });

  it("authorizes a real R2 upload for the organiser", async () => {
    const res = await fetch(`${baseUrl}/media/authorize`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...asResident(organiserResidentId) },
      body: JSON.stringify({ entityType: "circle-cover", entityId: restrictedCircleId, contentType: "image/jpeg" }),
    });
    expect(res.status).toBe(200);
    await expectPendingLedgerRow((await res.json()).objectKey, "circle-cover", restrictedCircleId);
  });
});

describe("POST /media/authorize — centre-gallery (org scoping)", () => {
  it("403s a vendor in a different org", async () => {
    const res = await fetch(`${baseUrl}/media/authorize`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...asVendor({ id: orgBOwnerId, orgId: orgBId }) },
      body: JSON.stringify({ entityType: "centre-gallery", entityId: centreId, contentType: "image/jpeg" }),
    });
    expect(res.status).toBe(403);
  });

  it("403s an unauthenticated request", async () => {
    const res = await fetch(`${baseUrl}/media/authorize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entityType: "centre-gallery", entityId: centreId, contentType: "image/jpeg" }),
    });
    expect(res.status).toBe(401);
  });

  it("authorizes a real R2 upload for the owning org's owner", async () => {
    const res = await fetch(`${baseUrl}/media/authorize`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...asVendor({ id: orgAOwnerId, orgId: orgAId }) },
      body: JSON.stringify({ entityType: "centre-gallery", entityId: centreId, contentType: "image/jpeg" }),
    });
    expect(res.status).toBe(200);
    await expectPendingLedgerRow((await res.json()).objectKey, "centre-gallery", centreId);
  });

  it("authorizes a real R2 upload for another member of the SAME org (org-wide ownership, not just the creator)", async () => {
    const res = await fetch(`${baseUrl}/media/authorize`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...asVendor({ id: orgAStaffId, orgId: orgAId, invitedStaff: true }) },
      body: JSON.stringify({ entityType: "centre-gallery", entityId: centreId, contentType: "image/jpeg" }),
    });
    expect(res.status).toBe(200);
  });
});

describe("POST /media/authorize — club-session-cover", () => {
  it("403s a vendor in a different org", async () => {
    const res = await fetch(`${baseUrl}/media/authorize`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...asVendor({ id: orgBOwnerId, orgId: orgBId }) },
      body: JSON.stringify({ entityType: "club-session-cover", entityId: clubSessionId, contentType: "image/jpeg" }),
    });
    expect(res.status).toBe(403);
  });

  it("authorizes a real R2 upload for the owning club's org", async () => {
    const res = await fetch(`${baseUrl}/media/authorize`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...asVendor({ id: orgAOwnerId, orgId: orgAId }) },
      body: JSON.stringify({ entityType: "club-session-cover", entityId: clubSessionId, contentType: "image/jpeg" }),
    });
    expect(res.status).toBe(200);
    await expectPendingLedgerRow((await res.json()).objectKey, "club-session-cover", clubSessionId);
  });
});

describe("POST /media/authorize — org-logo", () => {
  it("403s an invited staff member (owner-only, matches org.ts's existing /logo route)", async () => {
    const res = await fetch(`${baseUrl}/media/authorize`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...asVendor({ id: orgAStaffId, orgId: orgAId, invitedStaff: true }) },
      body: JSON.stringify({ entityType: "org-logo", entityId: orgAId, contentType: "image/jpeg" }),
    });
    expect(res.status).toBe(403);
  });

  it("authorizes a real R2 upload for the org owner", async () => {
    const res = await fetch(`${baseUrl}/media/authorize`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...asVendor({ id: orgAOwnerId, orgId: orgAId }) },
      body: JSON.stringify({ entityType: "org-logo", entityId: orgAId, contentType: "image/jpeg" }),
    });
    expect(res.status).toBe(200);
    await expectPendingLedgerRow((await res.json()).objectKey, "org-logo", orgAId);
  });
});

describe("POST /media/authorize — content type validation (real R2, reachable now)", () => {
  it("400s an unsupported content type", async () => {
    const res = await fetch(`${baseUrl}/media/authorize`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...asResident(hostResidentId) },
      body: JSON.stringify({ entityType: "resident-avatar", entityId: hostResidentId, contentType: "application/pdf" }),
    });
    expect(res.status).toBe(400);
  });
});

describe("POST /media/finalize and /media/release — same authorization matrix", () => {
  it("finalize 403s a non-owner", async () => {
    const res = await fetch(`${baseUrl}/media/finalize`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...asVendor({ id: orgBOwnerId, orgId: orgBId }) },
      body: JSON.stringify({ entityType: "centre-gallery", entityId: centreId, objectKey: "centres/x/gallery/y.jpg" }),
    });
    expect(res.status).toBe(403);
  });

  it("release 403s a non-owner", async () => {
    const res = await fetch(`${baseUrl}/media/release`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...asVendor({ id: orgBOwnerId, orgId: orgBId }) },
      body: JSON.stringify({ entityType: "centre-gallery", entityId: centreId, url: "https://example.test/x.jpg" }),
    });
    expect(res.status).toBe(403);
  });

  it("release no-ops safely (200 ok:true) for the real owner even with R2 unconfigured", async () => {
    const res = await fetch(`${baseUrl}/media/release`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...asVendor({ id: orgAOwnerId, orgId: orgAId }) },
      body: JSON.stringify({ entityType: "centre-gallery", entityId: centreId, url: "https://example.test/x.jpg" }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });

  // Regression coverage for a real cross-tenant deletion bug found in the
  // Image Upload Coverage audit: owning entityId alone was accepted as
  // proof the caller could delete ANY url passed in the body, so an owner
  // of Centre A could delete Centre B's object by passing B's url while
  // claiming entityId=A. Fixed by objectKeyFromUrlForEntity() re-checking
  // the url's key prefix against the claimed entity before deleting.
  it("release 403s when the url belongs to a DIFFERENT entity than the one the caller owns", async () => {
    const res = await fetch(`${baseUrl}/media/release`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...asVendor({ id: orgAOwnerId, orgId: orgAId }) },
      body: JSON.stringify({
        entityType: "centre-gallery",
        entityId: centreId,
        url: `https://media.hellocircle.ie/centres/some-other-centre-id/gallery/${crypto.randomUUID()}.jpg`,
      }),
    });
    expect(res.status).toBe(403);
  });

  it("release 200s when the url's key genuinely matches the owned entity's own prefix", async () => {
    const res = await fetch(`${baseUrl}/media/release`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...asVendor({ id: orgAOwnerId, orgId: orgAId }) },
      body: JSON.stringify({
        entityType: "centre-gallery",
        entityId: centreId,
        url: `https://media.hellocircle.ie/centres/${centreId}/gallery/${crypto.randomUUID()}.jpg`,
      }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });

  // Media Cost Controls pass — release used to trust the caller's own
  // claim that the entity's DB row had already been updated to stop
  // referencing this url. Proves the server now re-checks that itself.
  it("release 409s when the url is still the entity's CURRENT live cover image", async () => {
    const currentUrl = `https://media.hellocircle.ie/centres/${centreId}/gallery/still-current.jpg`;
    await db.prepare(`UPDATE centres SET image_url = ? WHERE id = ?`).run(currentUrl, centreId);
    const res = await fetch(`${baseUrl}/media/release`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...asVendor({ id: orgAOwnerId, orgId: orgAId }) },
      body: JSON.stringify({ entityType: "centre-gallery", entityId: centreId, url: currentUrl }),
    });
    expect(res.status).toBe(409);
    await db.prepare(`UPDATE centres SET image_url = '' WHERE id = ?`).run(centreId);
  });

  it("release 409s when the url is still present in the entity's gallery rows", async () => {
    const currentUrl = `https://media.hellocircle.ie/centres/${centreId}/gallery/still-in-gallery.jpg`;
    await db.prepare(`INSERT INTO centre_images (centre_id, url, sort_order) VALUES (?, ?, 0)`).run(centreId, currentUrl);
    const res = await fetch(`${baseUrl}/media/release`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...asVendor({ id: orgAOwnerId, orgId: orgAId }) },
      body: JSON.stringify({ entityType: "centre-gallery", entityId: centreId, url: currentUrl }),
    });
    expect(res.status).toBe(409);
    await db.prepare(`DELETE FROM centre_images WHERE centre_id = ? AND url = ?`).run(centreId, currentUrl);
  });
});

describe("POST /media/finalize — real upload validation against live R2", () => {
  it("authorize -> real PUT -> finalize promotes a validated staging object to its final, entity-namespaced key", async () => {
    const authRes = await fetch(`${baseUrl}/media/authorize`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...asVendor({ id: orgAOwnerId, orgId: orgAId }) },
      body: JSON.stringify({ entityType: "centre-gallery", entityId: centreId, contentType: "image/jpeg" }),
    });
    expect(authRes.status).toBe(200);
    const { objectKey: stagingKey, uploadUrl } = await authRes.json();
    expect(stagingKey).toMatch(/^_staging\//);

    const jpeg = buildMinimalJpeg(120, 90);
    const putRes = await fetch(uploadUrl, { method: "PUT", body: jpeg, headers: { "Content-Type": "image/jpeg" } });
    expect(putRes.ok).toBe(true);

    const finalizeRes = await fetch(`${baseUrl}/media/finalize`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...asVendor({ id: orgAOwnerId, orgId: orgAId }) },
      body: JSON.stringify({ entityType: "centre-gallery", entityId: centreId, objectKey: stagingKey }),
    });
    expect(finalizeRes.status).toBe(200);
    const finalized = await finalizeRes.json();
    expect(finalized.objectKey).toMatch(new RegExp(`^centres/${centreId}/gallery/[0-9a-f-]+\\.jpg$`));
    expect(finalized.contentType).toBe("image/jpeg");
    expect(finalized.contentLength).toBe(jpeg.length);

    // The staging object is gone — the presigned PUT URL is now inert.
    expect(await objectExistsInR2(stagingKey)).toBe(false);
    // The final object genuinely exists in R2 — the promote actually copied real bytes, not just a DB record.
    expect(await objectExistsInR2(finalized.objectKey)).toBe(true);

    const ledgerRow = (await db.prepare(`SELECT status, width, height, bytes FROM media_assets WHERE provider = 'r2' AND provider_key = ?`).get(finalized.objectKey)) as
      | { status: string; width: number; height: number; bytes: number }
      | undefined;
    expect(ledgerRow).toEqual({ status: "attached", width: 120, height: 90, bytes: jpeg.length });

    // Idempotent replay: finalizing the SAME (already-consumed) staging key
    // again returns the same already-promoted result, without erroring.
    const replayRes = await fetch(`${baseUrl}/media/finalize`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...asVendor({ id: orgAOwnerId, orgId: orgAId }) },
      body: JSON.stringify({ entityType: "centre-gallery", entityId: centreId, objectKey: stagingKey }),
    });
    expect(replayRes.status).toBe(200);
    expect(await replayRes.json()).toEqual(finalized);

    await deleteObject(finalized.objectKey);
    await db.prepare(`DELETE FROM media_assets WHERE provider_key = ?`).run(finalized.objectKey);
  });

  it("rejects a file whose actual bytes are not a real image, even though the client declared an image Content-Type", async () => {
    const authRes = await fetch(`${baseUrl}/media/authorize`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...asVendor({ id: orgAOwnerId, orgId: orgAId }) },
      body: JSON.stringify({ entityType: "centre-gallery", entityId: centreId, contentType: "image/jpeg" }),
    });
    const { objectKey: stagingKey, uploadUrl } = await authRes.json();

    const notAnImage = Buffer.from("<html><body>not an image, just labeled as one</body></html>");
    await fetch(uploadUrl, { method: "PUT", body: notAnImage, headers: { "Content-Type": "image/jpeg" } });

    const finalizeRes = await fetch(`${baseUrl}/media/finalize`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...asVendor({ id: orgAOwnerId, orgId: orgAId }) },
      body: JSON.stringify({ entityType: "centre-gallery", entityId: centreId, objectKey: stagingKey }),
    });
    expect(finalizeRes.status).toBe(400);
    expect((await finalizeRes.json()).error).toMatch(/doesn't match a supported image format/);

    // Rejected content never becomes reachable at any real key, and the
    // ledger reflects the rejection rather than staying "pending" forever.
    expect(await objectExistsInR2(stagingKey)).toBe(false);
    const ledgerRow = (await db.prepare(`SELECT status FROM media_assets WHERE id = ?`).get(stagingKey)) as { status: string } | undefined;
    expect(ledgerRow?.status).toBe("failed");
  });

  it("403s finalize for a staging key that exists but was authorized for a DIFFERENT entity", async () => {
    const authRes = await fetch(`${baseUrl}/media/authorize`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...asVendor({ id: orgAOwnerId, orgId: orgAId }) },
      body: JSON.stringify({ entityType: "centre-gallery", entityId: centreId, contentType: "image/jpeg" }),
    });
    const { objectKey: stagingKey } = await authRes.json();

    // A DIFFERENT centre owned by the same org tries to finalize the first centre's staging key.
    const otherCentreId = `test-other-centre-${crypto.randomUUID()}`;
    await db
      .prepare(`INSERT INTO centres (id, name, area, county, rating, reviews, capacity, from_price, managed_by, ph, blurb, vendor_id) VALUES (?, 'Other', 'Area', 'Dublin', 0, 0, 10, 1000, '', '', '', ?)`)
      .run(otherCentreId, orgAOwnerId);
    const finalizeRes = await fetch(`${baseUrl}/media/finalize`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...asVendor({ id: orgAOwnerId, orgId: orgAId }) },
      body: JSON.stringify({ entityType: "centre-gallery", entityId: otherCentreId, objectKey: stagingKey }),
    });
    expect(finalizeRes.status).toBe(400); // MediaValidationError -> mediaRouter's own 400 mapping, not a generic 500
    expect((await finalizeRes.json()).error).toMatch(/Upload session not found/);
    await db.prepare(`DELETE FROM centres WHERE id = ?`).run(otherCentreId);
    await db.prepare(`DELETE FROM media_assets WHERE id = ?`).run(stagingKey);
  });
});

describe("GET /media/circles/:id/cover — restricted-media privacy gate", () => {
  it("404s a circle with no cover image", async () => {
    const res = await fetch(`${baseUrl}/media/circles/${openCircleId}/cover`);
    expect(res.status).toBe(404);
  });

  it("403s an outsider trying to view a restricted (invite-mode) Circle's cover", async () => {
    const res = await fetch(`${baseUrl}/media/circles/${restrictedCircleId}/cover`, { headers: asResident(outsiderResidentId) });
    expect(res.status).toBe(403);
  });

  it("403s a signed-out visitor for the same restricted Circle", async () => {
    const res = await fetch(`${baseUrl}/media/circles/${restrictedCircleId}/cover`);
    expect(res.status).toBe(403);
  });

  it("redirects an actual member to a short-lived signed R2 GET URL (not the flat public bucket path)", async () => {
    const res = await fetch(`${baseUrl}/media/circles/${restrictedCircleId}/cover`, { headers: asResident(memberResidentId), redirect: "manual" });
    expect(res.status).toBe(302);
    const location = res.headers.get("location") ?? "";
    expect(location).toMatch(/^https:\/\/.*r2\.cloudflarestorage\.com\/circles\/test-fixture\/cover\/x\.jpg\?/);
    expect(location).toContain("X-Amz-Signature=");
  });

  it("redirects the organiser too (not just an ordinary member)", async () => {
    const res = await fetch(`${baseUrl}/media/circles/${restrictedCircleId}/cover`, { headers: asResident(organiserResidentId), redirect: "manual" });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toContain("X-Amz-Signature=");
  });

  it("ignores ?variant= for a legacy-shaped cover (no siblings to swap to) and signs the same one file", async () => {
    const res = await fetch(`${baseUrl}/media/circles/${restrictedCircleId}/cover?variant=thumbnail`, { headers: asResident(memberResidentId), redirect: "manual" });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toMatch(/circles\/test-fixture\/cover\/x\.jpg\?/);
  });

  it("signs the SIBLING variant's own key (never rewrites the already-issued signed url) for a local-processing-style cover", async () => {
    const localProcCircleId = `test-local-proc-circle-${crypto.randomUUID()}`;
    await db
      .prepare(
        `INSERT INTO circles (id, name, activity_label, area, county, about, created_by_resident_id, join_mode, image_url) VALUES (?, 'Local Proc Circle', 'Testball', 'Area', 'Dublin', '', ?, 'invite', 'https://media.hellocircle.ie/circles/lp-test/cover/uuid-hero.avif')`
      )
      .run(localProcCircleId, organiserResidentId);
    await db.prepare(`INSERT INTO circle_members (circle_id, resident_id, role) VALUES (?, ?, 'organiser')`).run(localProcCircleId, organiserResidentId);

    const noVariant = await fetch(`${baseUrl}/media/circles/${localProcCircleId}/cover`, { headers: asResident(organiserResidentId), redirect: "manual" });
    expect(noVariant.headers.get("location")).toContain("circles/lp-test/cover/uuid-hero.avif");

    const withVariant = await fetch(`${baseUrl}/media/circles/${localProcCircleId}/cover?variant=thumbnail`, { headers: asResident(organiserResidentId), redirect: "manual" });
    expect(withVariant.status).toBe(302);
    expect(withVariant.headers.get("location")).toContain("circles/lp-test/cover/uuid-thumbnail.avif");
    expect(withVariant.headers.get("location")).toContain("X-Amz-Signature="); // a FRESH signature for the sibling key, not a mutated copy of the hero's

    await db.prepare(`DELETE FROM circle_members WHERE circle_id = ?`).run(localProcCircleId);
    await db.prepare(`DELETE FROM circles WHERE id = ?`).run(localProcCircleId);
  });
});

describe("POST /media/upload — local-processing route wiring", () => {
  it("processes a real upload end-to-end through the actual HTTP route (multer, permission check, pipeline, response shape)", async () => {
    const form = new FormData();
    const jpeg = await (await import("sharp")).default({ create: { width: 1200, height: 900, channels: 3, background: { r: 90, g: 140, b: 60 } } }).jpeg({ quality: 85 }).toBuffer();
    form.append("file", new Blob([jpeg], { type: "image/jpeg" }), "test.jpg");
    form.append("entityType", "centre-gallery");
    form.append("entityId", centreId);

    const res = await fetch(`${baseUrl}/media/upload`, { method: "POST", headers: asVendor({ id: orgAOwnerId, orgId: orgAId }), body: form });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.contentType).toBe("image/avif");
    expect(body.url).toMatch(new RegExp(`^https://media\\.hellocircle\\.ie/centres/${centreId}/gallery/[0-9a-f-]+-hero\\.avif$`));

    const ledgerRows = (await db.prepare(`SELECT variant, status FROM media_assets WHERE entity_id = ? AND status = 'attached' ORDER BY variant`).all(centreId)) as { variant: string; status: string }[];
    expect(ledgerRows.map((r) => r.variant)).toEqual(["card", "hero", "thumbnail"]);

    // Cleanup: delete the real R2 objects this test created.
    const { deleteObject } = await import("../media/mediaService.js");
    for (const r of ledgerRows) {
      const row = (await db.prepare(`SELECT provider_key as providerKey FROM media_assets WHERE entity_id = ? AND variant = ?`).get(centreId, r.variant)) as { providerKey: string };
      await deleteObject(row.providerKey);
    }
    await db.prepare(`DELETE FROM media_assets WHERE entity_id = ?`).run(centreId);
  });

  it("403s a non-owner exactly like the presigned flow does (same checkUploadPermission)", async () => {
    const form = new FormData();
    form.append("file", new Blob([Buffer.from([0xff, 0xd8])], { type: "image/jpeg" }), "test.jpg");
    form.append("entityType", "centre-gallery");
    form.append("entityId", centreId);
    const res = await fetch(`${baseUrl}/media/upload`, { method: "POST", headers: asVendor({ id: orgBOwnerId, orgId: orgBId }), body: form });
    expect(res.status).toBe(403);
  });
});
