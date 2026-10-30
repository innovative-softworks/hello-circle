import crypto from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "./db/index.js";
import { privacyCounts } from "./privacyCounts.js";

// The privacy review counts (docs/participation-expansion/18): numbers only —
// a note's text never appears in the result — and nothing is written.

const clubId = `test-club-pc-${crypto.randomUUID()}`;
const refs = [`CR-PC-${crypto.randomUUID().slice(0, 6)}`, `CR-PC-${crypto.randomUUID().slice(0, 6)}`];
const SECRET = `Secret-note-${crypto.randomUUID()}`;
const q = async (sql: string, params: unknown[] = []) => (await db.prepare(sql).all(...params)) as Record<string, unknown>[];

beforeAll(async () => {
  await db.prepare(`INSERT INTO clubs (id, name, sport, area, county, ages, price, unit, trial, ph, image_url, blurb) VALUES (?, 'PC Club', 'x', 'a', 'Dublin', '5-12', 0, 'year', 1, '', '', '')`).run(clubId);
  for (const [ref, medical] of [[refs[0], SECRET], [refs[1], ""]]) {
    await db
      .prepare(`INSERT INTO registrations (ref, client_id, club_id, team, child_first, child_last, dob, g_first, g_last, email, phone, address, ec_name, ec_phone, ec_rel, medical, consent, trial, total_cents) VALUES (?, 'c', ?, 'T', 'A', 'B', '2015-01-01', 'G', 'G', 'pc@example.test', '0', 'A', 'E', '0', 'P', ?, 1, 0, 0)`)
      .run(ref, clubId, medical);
  }
});
afterAll(async () => {
  await db.prepare(`DELETE FROM registrations WHERE club_id = ?`).run(clubId);
  await db.prepare(`DELETE FROM clubs WHERE id = ?`).run(clubId);
});

describe("privacy review counts", () => {
  it("counts legacy medical notes without ever returning their text, and changes nothing", async () => {
    const before = (await db.prepare(`SELECT COUNT(*) AS n FROM registrations WHERE medical <> ''`).get()) as { n: number };
    const result = await privacyCounts(q, "test");
    expect(result.medical.columnPresent).toBe(true);
    expect(result.medical.withNote).toBe(Number(before.n));
    expect(result.medical.withNote).toBeGreaterThanOrEqual(1);
    expect(result.medical.registrations).toBeGreaterThanOrEqual(2);
    const text = JSON.stringify(result);
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain("pc@example.test");
    for (const r of refs) expect(text).not.toContain(r);
    const after = (await db.prepare(`SELECT medical FROM registrations WHERE ref = ?`).get(refs[0])) as { medical: string };
    expect(after.medical).toBe(SECRET);
  });
});
