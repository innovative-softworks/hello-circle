import crypto from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "./db/index.js";
import { governanceSummary } from "./governance.js";

// Phase L — the admin governance summary groups the audit log by theme, with
// who/what/when only (never stored values), flags heavy exporting, and
// reports retention as counts.

const run = crypto.randomUUID().slice(0, 8);
const admin = `t-admin-gv-${run}`;
const SECRET = `secret-value-${run}`;

beforeAll(async () => {
  await db.prepare(`INSERT INTO users (id, email, password_hash, role, status, name) VALUES (?, ?, 'x', 'admin', 'approved', 'GV')`).run(admin, `${admin}@example.test`);
  await db.prepare(`INSERT INTO audit_log (actor_user_id, action, object_type, object_id, new_value) VALUES (?, 'fields.policy_changed', 'field_policy', '1', ?)`).run(admin, JSON.stringify({ note: SECRET }));
  for (let i = 0; i < 10; i++) await db.prepare(`INSERT INTO audit_log (actor_user_id, action, object_type, object_id) VALUES (?, 'club.answers_exported', 'club', ?)`).run(admin, `c-${run}-${i}`);
});
afterAll(async () => {
  await db.prepare(`DELETE FROM audit_log WHERE actor_user_id = ?`).run(admin);
  await db.prepare(`DELETE FROM users WHERE id = ?`).run(admin);
});

describe("governance summary", () => {
  it("groups changes by theme without stored values, flags heavy exporting, counts retention", async () => {
    const g = await governanceSummary(7);
    const fields = g.themes.find((t) => t.key === "fields")!;
    expect(fields.count).toBeGreaterThanOrEqual(1);
    expect(fields.latest.some((e) => e.actorEmail === `${admin}@example.test`)).toBe(true);
    expect(g.themes.find((t) => t.key === "exports")!.count).toBeGreaterThanOrEqual(10);
    expect(g.indicators.some((i) => i.kind === "exports" && i.text.includes(`${admin}@example.test`))).toBe(true);
    expect(JSON.stringify(g)).not.toContain(SECRET);
    expect(g.retention.medical.columnPresent).toBe(true);
    expect(g.privacyReview.length).toBeGreaterThan(0);
  });
});
