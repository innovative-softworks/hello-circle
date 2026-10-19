import crypto from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { db, initSchema } from "./db/index.js";

// D-02 — the pre-roles upgrade backfill (NULL admin_role → super) runs once per
// database. It promotes exactly the admin rows with no role at that first run,
// records each one in the audit log, and never runs again: re-running schema
// setup (as every restart does) must not turn a role-less admin into a super
// admin — a role-less admin is denied everything.

const legacyId = `test-legacy-admin-${crypto.randomUUID()}`;
const laterId = `test-later-admin-${crypto.randomUUID()}`;
const vendorId = `test-null-vendor-${crypto.randomUUID()}`;
const MARKER = "migration.admin_role_backfill";
const preRolesIds: string[] = [];
let markerBefore: unknown;

afterAll(async () => {
  for (const id of [legacyId, laterId, vendorId, ...preRolesIds]) {
    await db.prepare(`DELETE FROM audit_log WHERE object_id = ?`).run(id);
    await db.prepare(`DELETE FROM users WHERE id = ?`).run(id);
  }
  // Leave the marker as this database had it.
  if (markerBefore) await db.prepare("INSERT IGNORE INTO app_settings (`key`, value) VALUES (?, 'done')").run(MARKER);
});

const roleOf = async (id: string) => ((await db.prepare(`SELECT admin_role FROM users WHERE id = ?`).get(id)) as { admin_role: string | null }).admin_role;
const insertUser = (id: string, role: string) =>
  db.prepare(`INSERT INTO users (id, email, password_hash, role, status, name, admin_role) VALUES (?, ?, 'x', ?, 'approved', 'Backfill test', NULL)`).run(id, `${id}@example.test`, role);

describe("admin role backfill", () => {
  it("first run promotes exactly the role-less admins (audited); later runs promote nobody", async () => {
    markerBefore = await db.prepare("SELECT value FROM app_settings WHERE `key` = ?").get(MARKER);
    // Simulate a database upgraded from before roles existed: no marker, one legacy admin, one vendor.
    await db.prepare("DELETE FROM app_settings WHERE `key` = ?").run(MARKER);
    await insertUser(legacyId, "admin");
    await insertUser(vendorId, "vendor");
    await initSchema();
    expect(await roleOf(legacyId)).toBe("super");
    expect(await roleOf(vendorId)).toBeNull(); // only admin rows
    const audit = (await db.prepare(`SELECT actor_kind, action, new_value FROM audit_log WHERE object_id = ?`).all(legacyId)) as { actor_kind: string; action: string; new_value: string }[];
    expect(audit.map((a) => [a.actor_kind, a.action, JSON.parse(a.new_value).adminRole])).toEqual([["system", "admin.role_backfilled", "super"]]);
    expect(await db.prepare("SELECT value FROM app_settings WHERE `key` = ?").get(MARKER)).toEqual({ value: "done" });

    // An admin left without a role afterwards stays without one across restarts.
    await insertUser(laterId, "admin");
    await initSchema();
    await initSchema();
    expect(await roleOf(laterId)).toBeNull();
    expect((await db.prepare(`SELECT COUNT(*) AS n FROM audit_log WHERE object_id = ?`).get(laterId)) as { n: number }).toEqual({ n: 0 });
  });

  it("runbook rehearsal: a database without the admin_role column — inventory, migrate, verify", async () => {
    // Step 1 — schema availability.
    const hasColumn = async () =>
      Number(((await db.prepare(`SELECT COUNT(*) AS n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'admin_role'`).get()) as { n: number }).n) === 1;
    // Simulate production/staging today: no column, no marker.
    const pre = `test-preroles-admin-${crypto.randomUUID()}`;
    await db.prepare(`INSERT INTO users (id, email, password_hash, role, status, name) VALUES (?, ?, 'x', 'admin', 'approved', 'Pre-roles admin')`).run(pre, `${pre}@example.test`);
    preRolesIds.push(pre);
    await db.exec(`ALTER TABLE users DROP COLUMN admin_role`);
    await db.prepare("DELETE FROM app_settings WHERE `key` = ?").run(MARKER);
    expect(await hasColumn()).toBe(false);

    // Step 2 — inventory without referencing admin_role.
    const inventory = ((await db.prepare(`SELECT id FROM users WHERE role = 'admin' ORDER BY id`).all()) as { id: string }[]).map((r) => r.id);
    expect(inventory).toContain(pre);

    // Step 3 — the first start of the new code.
    const lastAudit = Number(((await db.prepare(`SELECT COALESCE(MAX(id), 0) AS m FROM audit_log`).get()) as { m: number }).m);
    await initSchema();

    // Step 4 — verify: column back, every inventoried admin is super with exactly one backfill audit row, marker set.
    expect(await hasColumn()).toBe(true);
    const roles = (await db.prepare(`SELECT id, admin_role FROM users WHERE role = 'admin' ORDER BY id`).all()) as { id: string; admin_role: string | null }[];
    expect(roles.map((r) => r.id)).toEqual(inventory);
    expect(roles.every((r) => r.admin_role === "super")).toBe(true);
    const audited = ((await db.prepare(`SELECT object_id FROM audit_log WHERE action = 'admin.role_backfilled' AND id > ? ORDER BY object_id`).all(lastAudit)) as { object_id: string }[]).map((r) => r.object_id);
    // Exactly the inventoried admins, one audit row each, from this migration run.
    expect(audited).toEqual([...inventory].sort());
    expect(await db.prepare("SELECT value FROM app_settings WHERE `key` = ?").get(MARKER)).toEqual({ value: "done" });
  });
});
