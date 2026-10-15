import crypto from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, setSetting } from "../db/index.js";
import { postGroup } from "./ledger.js";
import { runSettlement } from "./settlement.js";

// Settlement fix (2026-10-15) — one ledger group can credit two parties' available
// balances (a split venue/host booking refunded or disputed after completion).
// Before the fix only the first party's share could be settled: in the same run
// the second party's settlement failed on a duplicate item key (the run was left
// "running"); in a later run the second share was silently excluded for ever.

const run = crypto.randomUUID().slice(0, 8);
const venue = { partyType: "org", partyId: `ssg-org-${run}` };
const host = { partyType: "host", partyId: `ssg-host-${run}` };
const adminId = `ssg-admin-${run}`;
const groups: string[] = [];

async function shared(key: string, venueMinor: number, hostMinor: number) {
  const g = await db.transaction((tx) =>
    postGroup(tx, {
      idempotencyKey: `ssg:${run}:${key}`,
      sourceType: "test",
      sourceId: `${run}:${key}`,
      description: `Shared group ${key}`,
      basis: "actual",
      currency: "EUR",
      lines: [
        { account: "partner_available", amountMinor: -venueMinor, ...venue, memo: "venue share" },
        { account: "partner_available", amountMinor: -hostMinor, ...host, memo: "host share" },
        { account: "stripe_clearing", amountMinor: venueMinor + hostMinor, memo: "counterpart" },
      ],
    })
  );
  groups.push(g.groupId);
  return g.groupId;
}
const settlementsOf = async (p: { partyType: string; partyId: string }) =>
  (await db.prepare(`SELECT id, net_minor AS net FROM settlements WHERE party_type = ? AND party_id = ? ORDER BY id`).all(p.partyType, p.partyId)) as { id: number; net: number | string }[];
const itemsOf = async (settlementId: number) => ((await db.prepare(`SELECT ledger_group_id AS g FROM settlement_items WHERE settlement_id = ?`).all(settlementId)) as { g: string }[]).map((r) => r.g);

beforeAll(async () => {
  await db.prepare(`INSERT INTO users (id, email, password_hash, role, status, name, admin_role) VALUES (?, ?, 'x', 'admin', 'approved', 'A', 'finance')`).run(adminId, `${adminId}@example.test`);
  await setSetting("commerce.settlement_ledger", "true");
});

afterAll(async () => {
  await setSetting("commerce.settlement_ledger", "false");
  const ids = [...(await settlementsOf(venue)), ...(await settlementsOf(host))].map((s) => s.id);
  for (const id of ids) {
    const g = (await db.prepare(`SELECT ledger_group_id AS g FROM settlements WHERE id = ?`).get(id)) as { g: string | null };
    await db.prepare(`DELETE FROM settlement_items WHERE settlement_id = ?`).run(id);
    if (g.g) groups.push(g.g);
    await db.prepare(`DELETE FROM settlements WHERE id = ?`).run(id);
  }
  for (const g of groups) {
    await db.prepare(`DELETE FROM ledger_entries WHERE group_id = ?`).run(g);
    await db.prepare(`DELETE FROM ledger_entry_groups WHERE id = ?`).run(g);
  }
  await db.prepare(`DELETE FROM settlement_runs WHERE run_key LIKE ?`).run(`ssg-${run}%`);
  await db.prepare(`DELETE FROM users WHERE id = ?`).run(adminId);
});

describe("a ledger group shared by two parties", () => {
  it("is settled for each party in the same run, once", async () => {
    const g = await shared("both", 4000, 3000);
    const r = await runSettlement({ runKey: `ssg-${run}-1`, dryRun: false, actorId: adminId, reason: "shared group settles both parties" });
    expect(r.settled.filter((s) => s.partyId === venue.partyId || s.partyId === host.partyId).map((s) => s.netMinor).sort()).toEqual([3000, 4000]);
    const [v] = await settlementsOf(venue);
    const [h] = await settlementsOf(host);
    expect(await itemsOf(v.id)).toContain(g);
    expect(await itemsOf(h.id)).toContain(g);
    // Nothing is settled twice.
    await runSettlement({ runKey: `ssg-${run}-2`, dryRun: false, actorId: adminId, reason: "second run settles nothing new" });
    expect(await settlementsOf(venue)).toHaveLength(1);
    expect(await settlementsOf(host)).toHaveLength(1);
  });

  it("a share carried forward in one run (below the minimum) is settled in a later run, not lost", async () => {
    await shared("small-host", 3000, 1000); // host 10.00 < 25.00 minimum → carried
    await runSettlement({ runKey: `ssg-${run}-3`, dryRun: false, actorId: adminId, reason: "host share carried forward" });
    expect(await settlementsOf(host)).toHaveLength(1);
    await shared("more-host", 0 + 1, 2000); // host now 30.00 available
    const r = await runSettlement({ runKey: `ssg-${run}-4`, dryRun: false, actorId: adminId, reason: "host share reaches the minimum" });
    expect(r.settled.find((s) => s.partyId === host.partyId)?.netMinor, "the carried share is included").toBe(3000);
  });

  it("a run that fails is marked failed with its step, not left running", async () => {
    const before = (await db.prepare(`SELECT COUNT(*) AS c FROM settlement_runs WHERE status = 'running'`).get()) as { c: number };
    await expect(runSettlement({ runKey: `ssg-${run}-x`, dryRun: false, actorId: "", reason: "valid reason", now: new Date("invalid") })).rejects.toMatchObject({ step: expect.any(String) });
    const row = (await db.prepare(`SELECT status, failed_step AS step, failure FROM settlement_runs WHERE run_key = ?`).get(`ssg-${run}-x`)) as { status: string; step: string; failure: string };
    expect(row.status).toBe("failed");
    expect(row.step.length).toBeGreaterThan(0);
    expect(row.failure.length).toBeGreaterThan(0);
    expect(((await db.prepare(`SELECT COUNT(*) AS c FROM settlement_runs WHERE status = 'running'`).get()) as { c: number }).c).toBe(before.c);
  });
});
