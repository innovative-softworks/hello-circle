import crypto from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "./db/index.js";
import { listFinancialExceptions, noticeFailedPayout, noticePastDue } from "./financialExceptions.js";

// OG-05 — money exceptions are listed from the records that hold them, and a
// partner is told once about a failed payout or a failed Pro payment.

const t = crypto.randomUUID().slice(0, 8);
const hostId = `test-fx-host-${t}`;
const accountId = `acct_test_fx_${t}`;
const payoutId = `po_test_fx_${t}`;
const vendorId = `test-fx-vendor-${t}`;
const centreId = `test-fx-centre-${t}`;
const bookingRef = `HBFX-${t}`;
let subId = 0;

const residentNotices = async (title: string) =>
  Number(((await db.prepare(`SELECT COUNT(*) as n FROM notifications WHERE resident_id = ? AND title LIKE ?`).get(hostId, `%${title}%`)) as { n: number }).n);

beforeAll(async () => {
  await db.prepare(`INSERT INTO residents (id, email, name) VALUES (?, ?, 'FX Host')`).run(hostId, `${hostId}@example.test`);
  await db.prepare(`INSERT INTO connected_accounts (party_type, party_id, provider, account_id, country) VALUES ('host', ?, 'stripe', ?, 'IE')`).run(hostId, accountId);
  await db.prepare(`INSERT INTO connected_payouts (provider_payout_id, account_id, amount_minor, currency, status, failure_message) VALUES (?, ?, 4200, 'EUR', 'failed', 'Account closed')`).run(payoutId, accountId);
  const info = await db
    .prepare(`INSERT INTO partner_subscriptions (party_type, party_id, status, gross_minor, created_by, grace_until) VALUES ('host', ?, 'past_due', 2900, 'test', DATE_ADD(NOW(), INTERVAL 7 DAY))`)
    .run(hostId);
  subId = Number(info.lastInsertRowid);
  await db.prepare(`INSERT INTO users (id, email, password_hash, role, status, name) VALUES (?, ?, 'x', 'vendor', 'approved', 'FX Vendor')`).run(vendorId, `${vendorId}@example.test`);
  await db
    .prepare(`INSERT INTO centres (id, name, area, county, rating, reviews, capacity, from_price, managed_by, ph, image_url, blurb, vendor_id, status) VALUES (?, 'FX Centre', 'Area', 'Dublin', 0, 0, 20, 1000, 'Mgr', '', '', '', ?, 'approved')`)
    .run(centreId, vendorId);
  await db
    .prepare(
      `INSERT INTO bookings (ref, client_id, centre_id, room_id, date, time, duration, event_type, guests, name, email, phone, notes, total_cents, status, payment_status, stripe_session_id)
       VALUES (?, 'fx', ?, 'r', '2099-01-01', '10:00', 1, 'M', 2, 'FX Guest', 'fx_guest@example.test', '', '', 5000, 'cancelled', 'paid', 'cs_test_fx')`
    )
    .run(bookingRef, centreId);
});

afterAll(async () => {
  await db.prepare(`DELETE FROM notifications WHERE resident_id = ?`).run(hostId);
  await db.prepare(`DELETE FROM connected_payouts WHERE provider_payout_id = ?`).run(payoutId);
  await db.prepare(`DELETE FROM connected_accounts WHERE account_id = ?`).run(accountId);
  await db.prepare(`DELETE FROM partner_subscriptions WHERE id = ?`).run(subId);
  await db.prepare(`DELETE FROM bookings WHERE ref = ?`).run(bookingRef);
  await db.prepare(`DELETE FROM centres WHERE id = ?`).run(centreId);
  await db.prepare(`DELETE FROM users WHERE id = ?`).run(vendorId);
  await db.prepare(`DELETE FROM residents WHERE id = ?`).run(hostId);
});

describe("financial exceptions", () => {
  it("lists a failed payout, a past-due Pro payment and a refund that's still due", async () => {
    const items = await listFinancialExceptions();
    const ids = items.map((i) => i.id);
    expect(ids).toContain(`payout_failed:${payoutId}`);
    expect(ids).toContain(`subscription_past_due:${subId}`);
    expect(ids).toContain(`refund_pending:booking:${bookingRef}`);
    const payout = items.find((i) => i.id === `payout_failed:${payoutId}`)!;
    expect(payout).toMatchObject({ severity: "high", amountMinor: 4200, party: { type: "host", id: hostId, name: "FX Host" } });
    // High-severity items come first.
    const firstMedium = items.findIndex((i) => i.severity === "medium");
    expect(items.slice(0, firstMedium === -1 ? items.length : firstMedium).every((i) => i.severity === "high")).toBe(true);
  });

  it("tells the partner about a failed payout once, however many events arrive", async () => {
    await noticeFailedPayout(payoutId);
    await noticeFailedPayout(payoutId);
    expect(await residentNotices("didn't go through")).toBe(1);
  });

  it("tells the partner about a failed Pro payment once", async () => {
    await noticePastDue(subId);
    await noticePastDue(subId);
    expect(await residentNotices("Pro payment failed")).toBe(1);
  });
});
