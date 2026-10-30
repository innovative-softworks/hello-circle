import crypto from "node:crypto";
import http, { type Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../db/index.js";
import { vendorListingsRouter } from "./vendorListings.js";

// Role-activity validation (2026-10-30, docs/participation-expansion/
// role-activity-validation/09 RAV-SEC-01) — claiming an unclaimed listing
// brings it into the organisation, so it needs the same staff role and
// capability as creating that listing type.

let server: Server;
let base: string;
const t = crypto.randomUUID().slice(0, 8);
const org = `org-claim-${t}`;
const owner = `test-claim-owner-${t}`;
const centre = `c-claim-${t}`;
const club = `cl-claim-${t}`;
const ROLES = ["owner", "centre_manager", "facility_manager", "finance", "communications", "read_only_analyst", "checkin_staff"] as const;
type Role = (typeof ROLES)[number];

const claim = async (role: Role, listingType: "centre" | "club") => {
  const r = await fetch(`${base}/vendor/claims`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(role === "owner" ? {} : { "X-Staff-Role": role }) },
    body: JSON.stringify({ listingType, listingId: listingType === "centre" ? centre : club, message: "ours" }),
  });
  return { status: r.status, body: (await r.json()) as Record<string, unknown> };
};
const clearClaims = () => db.prepare(`DELETE FROM listing_claims WHERE listing_id IN (?, ?)`).run(centre, club);

beforeAll(async () => {
  await db.prepare(`INSERT INTO organisations (id, name, kind) VALUES (?, 'Claim org', 'vendor')`).run(org);
  await db.prepare(`INSERT INTO users (id, email, password_hash, role, status, name, org_id) VALUES (?, ?, 'x', 'vendor', 'approved', 'Claim owner', ?)`).run(owner, `${owner}@example.test`, org);
  await db.prepare(`INSERT INTO centres (id, name, area, county, rating, reviews, capacity, from_price, managed_by, ph, image_url, blurb, vendor_id, status) VALUES (?, 'Unclaimed hall', 'A', 'Dublin', 0, 0, 1, 1, 'M', '', '', '', NULL, 'approved')`).run(centre);
  await db.prepare(`INSERT INTO clubs (id, name, sport, area, county, ages, price, unit, trial, ph, blurb, vendor_id, status) VALUES (?, 'Unclaimed club', 'Testball', 'Area', 'Dublin', '5-12', 10, 'session', 0, '', 'blurb', NULL, 'approved')`).run(club);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const staffRole = req.header("X-Staff-Role");
    (req as any).user = { id: owner, role: "vendor", status: "approved", orgId: org, invitedStaff: !!staffRole, platformRole: staffRole ?? null };
    (req as any).vendorIds = [owner];
    next();
  });
  app.use("/vendor", vendorListingsRouter);
  server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, r));
  const a = server.address();
  if (!a || typeof a === "string") throw new Error("bind");
  base = `http://127.0.0.1:${a.port}`;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  await clearClaims();
  await db.prepare(`DELETE FROM feature_flags WHERE org_id = ?`).run(org);
  await db.prepare(`DELETE FROM centres WHERE id = ?`).run(centre);
  await db.prepare(`DELETE FROM clubs WHERE id = ?`).run(club);
  await db.prepare(`DELETE FROM users WHERE id = ?`).run(owner);
  await db.prepare(`DELETE FROM organisations WHERE id = ?`).run(org);
});

describe("POST /vendor/claims — staff role and capability", () => {
  it.each([
    ["centre", ["owner", "centre_manager"]],
    ["club", ["owner", "facility_manager"]],
  ] as ["centre" | "club", Role[]][])("a %s claim is limited to the owner and the matching manager", async (type, allowed) => {
    for (const role of ROLES) {
      await clearClaims();
      const r = await claim(role, type);
      expect([role, r.status]).toEqual([role, allowed.includes(role) ? 201 : 403]);
    }
    const { n } = (await db.prepare(`SELECT COUNT(*) as n FROM listing_claims WHERE listing_id IN (?, ?)`).get(centre, club)) as { n: number };
    expect(Number(n)).toBe(0); // the last role tried (checkin_staff) filed nothing
  });

  it("refuses a claim when the organisation doesn't have the capability, even for the owner", async () => {
    await clearClaims();
    await db.prepare(`INSERT INTO feature_flags (org_id, flag_key, enabled) VALUES (?, 'clubs', 0)`).run(org);
    const r = await claim("owner", "club");
    expect(r.status).toBe(403);
    expect(r.body.capabilityOff).toBe("clubs");
    expect((await claim("owner", "centre")).status).toBe(201); // venues is still on
    await db.prepare(`DELETE FROM feature_flags WHERE org_id = ?`).run(org);
  });
});
