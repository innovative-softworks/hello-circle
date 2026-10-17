import crypto from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "./db/index.js";
import { monthBounds, statementCsv, vendorStatement } from "./vendorStatements.js";

// OG-25 — a month's statement lists the organisation's own orders and refunds
// at their recorded amounts, Ireland-month bounded, and is not a VAT invoice.

const t = crypto.randomUUID().slice(0, 8);
const vendorId = `test-stmt-vendor-${t}`;
const otherVendor = `test-stmt-other-${t}`;
const centreId = `test-stmt-centre-${t}`;
const otherCentre = `test-stmt-centre2-${t}`;
const refs = { inMonth: `HBST-${t}-1`, lateUtc: `HBST-${t}-2`, other: `HBST-${t}-3`, nextMonth: `HBST-${t}-4` };

async function booking(ref: string, centre: string, createdAt: string, cents: number) {
  await db
    .prepare(
      `INSERT INTO bookings (ref, client_id, centre_id, room_id, date, time, duration, event_type, guests, name, email, phone, notes, total_cents, status, payment_status, created_at)
       VALUES (?, 'st', ?, 'room', '2026-07-20', '10:00', 1, 'M', 2, '=HYPERLINK("x")', 's@example.test', '', '', ?, 'confirmed', 'paid', ?)`
    )
    .run(ref, centre, cents, createdAt);
}

beforeAll(async () => {
  for (const [v, c] of [
    [vendorId, centreId],
    [otherVendor, otherCentre],
  ]) {
    await db.prepare(`INSERT INTO users (id, email, password_hash, role, status, name) VALUES (?, ?, 'x', 'vendor', 'approved', 'Stmt')`).run(v, `${v}@example.test`);
    await db
      .prepare(`INSERT INTO centres (id, name, area, county, rating, reviews, capacity, from_price, managed_by, ph, image_url, blurb, vendor_id, status) VALUES (?, 'Stmt Centre', 'A', 'Dublin', 0, 0, 10, 0, 'M', '', '', '', ?, 'approved')`)
      .run(c, v);
  }
  await booking(refs.inMonth, centreId, "2026-07-10 12:00:00", 5000);
  // 31 July 23:30 UTC is 1 August 00:30 in Ireland (IST) — belongs to August.
  await booking(refs.lateUtc, centreId, "2026-07-31 23:30:00", 700);
  await booking(refs.other, otherCentre, "2026-07-10 12:00:00", 9900);
  // 30 June 23:30 UTC is 1 July 00:30 in Ireland — belongs to July.
  await booking(refs.nextMonth, centreId, "2026-06-30 23:30:00", 300);
  await db
    .prepare(`INSERT INTO refunds (source_type, source_ref, idempotency_key, amount_minor, currency, kind, origin, responsible, reason, status, created_at) VALUES ('booking', ?, ?, 2000, 'EUR', 'partial', 'vendor', 'partner', 'test', 'succeeded', '2026-07-15 10:00:00')`)
    .run(refs.inMonth, `stmt-${t}`);
  await db
    .prepare(`INSERT INTO connected_accounts (party_type, party_id, provider, account_id, country) VALUES ('vendor', ?, 'stripe', ?, 'IE')`)
    .run(vendorId, `acct_stmt_${t}`);
  await db
    .prepare(`INSERT INTO connected_payouts (provider_payout_id, account_id, amount_minor, currency, status, created_at) VALUES (?, ?, 4100, 'EUR', 'paid', '2026-07-20 09:00:00'), (?, ?, 900, 'EUR', 'failed', '2026-07-21 09:00:00')`)
    .run(`po_stmt_${t}_1`, `acct_stmt_${t}`, `po_stmt_${t}_2`, `acct_stmt_${t}`);
});

afterAll(async () => {
  await db.prepare(`DELETE FROM connected_payouts WHERE account_id = ?`).run(`acct_stmt_${t}`);
  await db.prepare(`DELETE FROM connected_accounts WHERE account_id = ?`).run(`acct_stmt_${t}`);
  await db.prepare(`DELETE FROM refunds WHERE idempotency_key = ?`).run(`stmt-${t}`);
  await db.prepare(`DELETE FROM bookings WHERE centre_id IN (?, ?)`).run(centreId, otherCentre);
  await db.prepare(`DELETE FROM centres WHERE id IN (?, ?)`).run(centreId, otherCentre);
  await db.prepare(`DELETE FROM users WHERE id IN (?, ?)`).run(vendorId, otherVendor);
});

describe("monthly statement", () => {
  it("rejects a malformed month", () => {
    expect(monthBounds("2026-13")).toBeNull();
    expect(monthBounds("July")).toBeNull();
  });

  it("covers the organisation's own orders in the Ireland month, with refunds", async () => {
    const s = await vendorStatement([vendorId], "2026-07");
    expect(s.lines.map((l) => l.ref).sort()).toEqual([refs.inMonth, refs.nextMonth].sort());
    expect(s.totals).toMatchObject({ orders: 2, orderTotalCents: 5300, refunds: 1, refundedCents: 2000, payouts: 1, paidOutCents: 4100 });
    expect(s.payouts.map((p) => p.status)).toEqual(["paid", "failed"]);
    // No pricing snapshot was recorded for these orders: fees stay blank, never estimated.
    expect(s.lines.every((l) => l.customerFeeCents === null && l.platformFeeCents === null && l.partnerShareCents === null)).toBe(true);
    expect((await vendorStatement([vendorId], "2026-08")).lines.map((l) => l.ref)).toEqual([refs.lateUtc]);
  });

  it("says it isn't a VAT invoice and neutralises formulas in the CSV", async () => {
    const csv = statementCsv(await vendorStatement([vendorId], "2026-07"), "Stmt Org");
    expect(csv).toContain("Not a VAT invoice");
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
    expect(csv).toContain(`"50.00"`);
    expect(csv).toContain(`"po_stmt_${t}_1"`);
  });
});
