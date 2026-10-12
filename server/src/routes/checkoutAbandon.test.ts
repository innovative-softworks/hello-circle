import crypto from "node:crypto";
import http, { type Server } from "node:http";
import express from "express";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { db } from "../db/index.js";
import { stubProvider } from "../payments/provider.js";
import { checkoutAbandonRouter } from "./checkoutAbandon.js";

// Booking UX Phase 3 — backing out of the payment page releases the hold now,
// through the provider-expiry path, and never touches a paid or completing one.

let server: Server;
let baseUrl: string;
const tag = crypto.randomUUID().slice(0, 8);
const centreId = `test-centre-abandon-${tag}`;
const roomId = `test-room-abandon-${tag}`;
const owner = `test-client-abandon-${tag}`;
const date = "2099-06-01";

async function pending(ref: string, sessionId: string, paymentStatus = "pending") {
  await db
    .prepare(
      `INSERT INTO bookings (ref, client_id, centre_id, room_id, date, time, duration, event_type, guests, name, email, phone, notes, total_cents, payment_status, stripe_session_id)
       VALUES (?, ?, ?, ?, ?, '10:00', 1, 'Party', 2, 'Guest', 'guest@example.test', '', '', 1000, ?, ?)`
    )
    .run(ref, owner, centreId, roomId, date, paymentStatus, sessionId);
}
const abandon = (ref: string, clientId = owner) => fetch(`${baseUrl}/${ref}/abandon`, { method: "POST", headers: { "X-Client-Id": clientId } });
const statusOf = async (ref: string) => ((await db.prepare(`SELECT payment_status as s FROM bookings WHERE ref = ?`).get(ref)) as { s: string }).s;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/", checkoutAbandonRouter);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Failed to bind test server");
  baseUrl = `http://127.0.0.1:${address.port}`;
  // The provider seam (same opt-in the commerce tests use): an in-memory stub.
  process.env.QA_E2E_ENABLED = "true";
  process.env.QA_PAYMENT_PROVIDER_STUB = "1";
});

afterEach(() => stubProvider.checkoutStatuses.clear());

afterAll(async () => {
  delete process.env.QA_E2E_ENABLED;
  delete process.env.QA_PAYMENT_PROVIDER_STUB;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await db.prepare(`DELETE FROM bookings WHERE centre_id = ?`).run(centreId);
});

describe("POST /api/checkout/:ref/abandon", () => {
  it("releases the guest's own open checkout: expires it at the provider and frees the hold", async () => {
    const ref = `HB-AB1${tag}`;
    await pending(ref, `cs_ab1_${tag}`);
    const res = await abandon(ref);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ state: "released", retryPath: `/book/${centreId}` });
    expect(await statusOf(ref)).toBe("failed");
    expect(stubProvider.checkoutStatuses.get(`cs_ab1_${tag}`)).toBe("expired");
    // Idempotent: a second visit changes nothing.
    expect(await (await abandon(ref)).json()).toMatchObject({ state: "not_pending" });
  });

  it("never releases a session the provider says has completed (its payment webhook is on the way)", async () => {
    const ref = `HB-AB2${tag}`;
    await pending(ref, `cs_ab2_${tag}`);
    stubProvider.checkoutStatuses.set(`cs_ab2_${tag}`, "complete");
    expect(await (await abandon(ref)).json()).toMatchObject({ state: "processing" });
    expect(await statusOf(ref)).toBe("pending");
  });

  it("leaves paid bookings alone and refuses anyone but the owner", async () => {
    const paid = `HB-AB3${tag}`;
    await pending(paid, `cs_ab3_${tag}`, "paid");
    expect(await (await abandon(paid)).json()).toMatchObject({ state: "paid" });
    expect(await statusOf(paid)).toBe("paid");

    const other = `HB-AB4${tag}`;
    await pending(other, `cs_ab4_${tag}`);
    expect((await abandon(other, "someone-else")).status).toBe(404);
    expect(await statusOf(other)).toBe("pending");
    expect((await abandon("XX-123456")).status).toBe(404);
    // A resident-owned type without a signed-in resident is not found.
    expect((await abandon("PS-123456")).status).toBe(404);
  });
});
