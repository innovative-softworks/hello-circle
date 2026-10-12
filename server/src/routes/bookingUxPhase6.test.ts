import crypto from "node:crypto";
import http, { type Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../db/index.js";
import { stubProvider } from "../payments/provider.js";
import { vendorOperationsRouter } from "./vendorOperations.js";

// Booking UX Phase 6:
//   B13 a provider cancellation refunds a paid online order in full, once
//   B12 the vendor's orders list flags what still needs doing

let server: Server;
let baseUrl: string;
const tag = crypto.randomUUID().slice(0, 8);
const vendorId = `test-vendor-p6-${tag}`;
const centreId = `test-centre-p6-${tag}`;
const roomId = `test-room-p6-${tag}`;

async function booking(ref: string, opts: { session?: string | null; date?: string; status?: string; paymentStatus?: string } = {}) {
  // Hire 8000 + VAT 1840 + fee 400 + 10000 deposit = 20240.
  await db
    .prepare(
      `INSERT INTO bookings (ref, client_id, centre_id, room_id, date, time, duration, event_type, guests, name, email, phone, notes,
         subtotal_cents, discount_cents, vat_cents, platform_fee_cents, total_cents, payment_status, status, stripe_session_id)
       VALUES (?, 'p6', ?, ?, ?, '10:00', 2, 'Party', 5, 'P6 Guest', 'p6@example.test', '', '', 8000, 0, 1840, 400, 20240, ?, ?, ?)`
    )
    .run(ref, centreId, roomId, opts.date ?? "2099-09-01", opts.paymentStatus ?? "paid", opts.status ?? "confirmed", opts.session === undefined ? `cs_p6_${ref}` : opts.session);
}
const cancel = (ref: string) => fetch(`${baseUrl}/bookings/${ref}/cancel`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
const orders = async (attention = false) => (await (await fetch(`${baseUrl}/orders${attention ? "?attention=1" : ""}`)).json()) as { ref: string; attention: string[]; depositCents: number }[];
const payStatus = async (ref: string) => ((await db.prepare(`SELECT payment_status as s FROM bookings WHERE ref = ?`).get(ref)) as { s: string }).s;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { user: object }).user = { id: vendorId, role: "vendor", status: "approved", invitedStaff: false };
    (req as unknown as { vendorIds: string[] }).vendorIds = [vendorId];
    next();
  });
  app.use("/", vendorOperationsRouter);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Failed to bind test server");
  baseUrl = `http://127.0.0.1:${address.port}`;
  process.env.QA_E2E_ENABLED = "true";
  process.env.QA_PAYMENT_PROVIDER_STUB = "1";

  await db.prepare(`INSERT INTO users (id, email, password_hash, role, status, name) VALUES (?, ?, 'x', 'vendor', 'approved', 'P6 Vendor')`).run(vendorId, `${vendorId}@example.test`);
  await db
    .prepare(`INSERT INTO centres (id, name, area, county, rating, reviews, capacity, from_price, managed_by, ph, image_url, blurb, vendor_id) VALUES (?, 'P6 Centre', 'Area', 'Dublin', 0, 0, 10, 1000, 'Mgr', '', '', '', ?)`)
    .run(centreId, vendorId);
  await db.prepare(`INSERT INTO rooms (id, centre_id, name, cap, rate, \`desc\`, sort_order) VALUES (?, ?, 'Hall', 10, 40, '', 0)`).run(roomId, centreId);
});

afterAll(async () => {
  delete process.env.QA_E2E_ENABLED;
  delete process.env.QA_PAYMENT_PROVIDER_STUB;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  const refs = ((await db.prepare(`SELECT ref FROM bookings WHERE centre_id = ?`).all(centreId)) as { ref: string }[]).map((r) => r.ref);
  for (const ref of refs) {
    await db.prepare(`DELETE FROM refunds WHERE source_type = 'booking' AND source_ref = ?`).run(ref);
    await db.prepare(`DELETE FROM audit_log WHERE object_id = ?`).run(ref);
  }
  await db.prepare(`DELETE FROM notifications WHERE listing_id = ?`).run(centreId);
  await db.prepare(`DELETE FROM bookings WHERE centre_id = ?`).run(centreId);
  await db.prepare(`DELETE FROM rooms WHERE centre_id = ?`).run(centreId);
  await db.prepare(`DELETE FROM centres WHERE id = ?`).run(centreId);
  await db.prepare(`DELETE FROM users WHERE id = ?`).run(vendorId);
});

describe("B13 — a vendor cancellation refunds the customer", () => {
  it("refunds a paid online booking in full, exactly once", async () => {
    const ref = `HB-P6A${tag}`;
    await booking(ref);
    stubProvider.markPaid(`cs_p6_${ref}`, 20240);
    const res = await cancel(ref);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, refund: "refunded" });
    expect(await payStatus(ref)).toBe("refunded");
    const refunds = (await db.prepare(`SELECT amount_minor as a FROM refunds WHERE source_type = 'booking' AND source_ref = ?`).all(ref)) as { a: number }[];
    expect(refunds.map((r) => Number(r.a))).toEqual([20240]);
    // A repeat cancel changes nothing and refunds nothing more.
    expect((await cancel(ref)).status).toBe(409);
    expect(stubProvider.calls.filter((c) => c.method === "createRefund" && JSON.stringify(c.args).includes(ref))).toHaveLength(1);
  });

  it("has nothing to refund for a cash booking", async () => {
    const ref = `HB-P6B${tag}`;
    await booking(ref, { session: null });
    expect(await (await cancel(ref)).json()).toEqual({ ok: true, refund: "none" });
    expect(await payStatus(ref)).toBe("paid");
  });

  it("keeps the cancellation when the refund fails, and flags it for the finance team", async () => {
    const ref = `HB-P6C${tag}`;
    await booking(ref); // the provider has no record of this payment, so the refund fails
    const body = await (await cancel(ref)).json();
    expect(body).toMatchObject({ ok: true, refund: "failed" });
    expect(await payStatus(ref)).toBe("paid");
    const flagged = (await orders(true)).find((o) => o.ref === ref);
    expect(flagged?.attention).toEqual(["refund_pending"]);
  });
});

describe("B12 — the orders list", () => {
  it("flags a past booking whose deposit hasn't been returned, until it is", async () => {
    const ref = `HB-P6D${tag}`;
    await booking(ref, { date: "2020-01-01" });
    let row = (await orders()).find((o) => o.ref === ref);
    expect(row).toMatchObject({ depositCents: 10000, attention: ["deposit_due"] });
    await db
      .prepare(`INSERT INTO refunds (source_type, source_ref, amount_minor, currency, kind, origin, responsible, reason, status, idempotency_key) VALUES ('booking', ?, 10000, 'EUR', 'partial', 'in_app', 'partner', 'Deposit returned', 'succeeded', ?)`)
      .run(ref, `p6-deposit-${ref}`);
    row = (await orders()).find((o) => o.ref === ref);
    expect(row?.attention).toEqual([]);
    expect((await orders(true)).some((o) => o.ref === ref)).toBe(false);
  });
});
