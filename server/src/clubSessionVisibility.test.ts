import crypto from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "./db/index.js";
import { getProviderUpcoming, listScheduledActivities } from "./db/queries.js";
import { setOrgStatus } from "./orgSuspension.js";
import { offeringSellable } from "./orgStatus.js";
import type { AuthedUser } from "./auth.js";

// Public club-session feeds follow the parent club's own publication status
// and the D-01 organisation rule: sessions of draft, rejected or paused clubs,
// or of a suspended organisation's clubs, never appear; reinstatement brings
// back only sessions whose club is still approved.

const run = crypto.randomUUID().slice(0, 8);
const orgId = `test-org-cs-${run}`;
const vendorId = `test-vendor-cs-${run}`;
const admin = { id: `test-admin-cs-${run}`, role: "admin", status: "approved", adminRole: "super" } as unknown as AuthedUser;
const clubs = { approved: `cs-approved-${run}`, draft: `cs-draft-${run}`, rejected: `cs-rejected-${run}`, paused: `cs-paused-${run}` } as const;
const sessions: Record<keyof typeof clubs, string> = { approved: "", draft: "", rejected: "", paused: "" };

beforeAll(async () => {
  await db.prepare(`INSERT INTO organisations (id, name, kind) VALUES (?, 'Club session org', 'vendor')`).run(orgId);
  await db.prepare(`INSERT INTO users (id, email, password_hash, role, status, name, org_id) VALUES (?, ?, 'x', 'vendor', 'approved', 'CS vendor', ?)`).run(vendorId, `${vendorId}@example.test`, orgId);
  await db.prepare(`INSERT INTO users (id, email, password_hash, role, status, name, admin_role) VALUES (?, ?, 'x', 'admin', 'approved', 'CS admin', 'super')`).run(admin.id, `${admin.id}@example.test`);
  for (const [status, id] of Object.entries(clubs) as [keyof typeof clubs, string][]) {
    await db
      .prepare(`INSERT INTO clubs (id, name, sport, area, county, ages, price, unit, trial, ph, blurb, vendor_id, status) VALUES (?, ?, 'Testball', 'Area', 'Testshire', '5-12', 10, 'session', 0, '', 'blurb', ?, ?)`)
      .run(id, `CS ${status} ${run}`, vendorId, status);
    const sid = `cs-session-${status}-${run}`;
    sessions[status] = sid;
    // Every weekday, so a session falls inside any one-week window.
    for (let d = 0; d < 7; d++) {
      await db.prepare(`INSERT INTO club_sessions (id, club_id, day_of_week, time, label, active) VALUES (?, ?, ?, '18:00', ?, 1)`).run(d === 0 ? sid : `${sid}-${d}`, id, d, `CS ${status} session`);
    }
  }
});

afterAll(async () => {
  for (const id of Object.values(clubs)) {
    await db.prepare(`DELETE FROM club_sessions WHERE club_id = ?`).run(id);
    await db.prepare(`DELETE FROM clubs WHERE id = ?`).run(id);
  }
  await db.prepare(`DELETE FROM moderation_decisions WHERE object_id = ?`).run(orgId);
  await db.prepare(`DELETE FROM audit_log WHERE object_id = ?`).run(orgId);
  await db.prepare(`DELETE FROM notifications WHERE recipient_id = ?`).run(vendorId);
  await db.prepare(`DELETE FROM users WHERE id IN (?, ?)`).run(vendorId, admin.id);
  await db.prepare(`DELETE FROM organisations WHERE id = ?`).run(orgId);
});

const week = () => ({ county: "Testshire", from: new Date(), to: new Date(Date.now() + 7 * 86400000) });
const feedClubs = async () => new Set((await listScheduledActivities(week())).filter((a) => a.kind === "club_session").map((a) => a.clubName));
const providerClubs = async () => new Set((await getProviderUpcoming(vendorId, 50)).filter((a) => a.kind === "club_session").map((a) => a.title));

describe("public club-session feeds", () => {
  it("show sessions of approved clubs only — never draft, rejected or paused", async () => {
    const names = await feedClubs();
    expect(names).toContain(`CS approved ${run}`);
    for (const s of ["draft", "rejected", "paused"]) expect(names, s).not.toContain(`CS ${s} ${run}`);
    const titles = [...(await providerClubs())].join("|");
    expect(titles).toContain("CS approved session");
    for (const s of ["draft", "rejected", "paused"]) expect(titles, s).not.toContain(`CS ${s} session`);
  });

  it("hide every session while the organisation is suspended; reinstatement brings back only the approved club's", async () => {
    await setOrgStatus(orgId, "suspended", { category: "safety", explanation: "Safety concerns raised about these sessions.", internalNote: null }, admin);
    expect((await feedClubs()).has(`CS approved ${run}`)).toBe(false);
    expect([...(await providerClubs())]).toEqual([]);
    expect(await offeringSellable(vendorId)).toBe(false);
    await setOrgStatus(orgId, "active", null, admin);
    const names = await feedClubs();
    expect(names).toContain(`CS approved ${run}`);
    for (const s of ["draft", "rejected", "paused"]) expect(names, s).not.toContain(`CS ${s} ${run}`);
  });
});
