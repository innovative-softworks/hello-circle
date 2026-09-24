import crypto from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "./db/index.js";
import { notifyCancellation, notifyNewBookingOrRegistration, notifyRefund } from "./notifications.js";

// Resident Experience Polish — Changeset 2. Previously
// notifyNewBookingOrRegistration/notifyCancellation/notifyRefund only ever
// wrote notification rows for the vendor/admin side (recipient_id) and
// emailed the guest — a resident who made the booking themselves never got
// an in-app row, unlike waitlist/game/circle notifications, which always
// did. This proves the fix directly against the three shared functions:
// residentId set -> a real resident_id-keyed row exists with the right
// kind/listing/ref; residentId absent (pure guest) -> no row, and no crash.

const residentId = `test-resident-${crypto.randomUUID()}`;
const vendorId = `test-vendor-notif-${crypto.randomUUID()}`;

async function residentNotificationRows(ref: string) {
  return (await db.prepare(`SELECT kind, title, listing_type as listingType, listing_id as listingId, ref FROM notifications WHERE resident_id = ? AND ref = ?`).all(residentId, ref)) as {
    kind: string;
    title: string;
    listingType: string;
    listingId: string;
    ref: string;
  }[];
}

beforeEach(async () => {
  await db.prepare(`DELETE FROM notifications WHERE resident_id = ?`).run(residentId);
});

afterAll(async () => {
  await db.prepare(`DELETE FROM notifications WHERE resident_id = ?`).run(residentId);
});

describe("notifyNewBookingOrRegistration — resident copy", () => {
  it("writes a resident_id-keyed row when residentId is set", async () => {
    const ref = `test-ref-${crypto.randomUUID()}`;
    await notifyNewBookingOrRegistration({
      kind: "booking",
      listingType: "centre",
      listingId: "test-listing-1",
      listingName: "Test Centre",
      vendorId,
      guestName: "Test Guest",
      guestEmail: "guest@example.test",
      ref,
      detailsText: "2026-09-30 at 18:00",
      residentId,
    });

    const rows = await residentNotificationRows(ref);
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe("booking");
    expect(rows[0].title).toContain("confirmed");
    expect(rows[0].title).toContain("Test Centre");
    expect(rows[0].listingType).toBe("centre");
    expect(rows[0].listingId).toBe("test-listing-1");
  });

  it("writes nothing for a pure guest booking (no residentId)", async () => {
    const ref = `test-ref-${crypto.randomUUID()}`;
    await notifyNewBookingOrRegistration({
      kind: "booking",
      listingType: "centre",
      listingId: "test-listing-1",
      listingName: "Test Centre",
      vendorId,
      guestName: "Test Guest",
      guestEmail: "guest@example.test",
      ref,
      detailsText: "2026-09-30 at 18:00",
      residentId: null,
    });

    const rows = await residentNotificationRows(ref);
    expect(rows).toHaveLength(0);
  });

  it("writes exactly one row per call — no inappropriate duplicate", async () => {
    const ref = `test-ref-${crypto.randomUUID()}`;
    await notifyNewBookingOrRegistration({
      kind: "registration",
      listingType: "club",
      listingId: "test-club-1",
      listingName: "Test Club",
      vendorId,
      guestName: "Test Guardian",
      guestEmail: "guardian@example.test",
      ref,
      detailsText: "Test Child",
      residentId,
    });

    const rows = await residentNotificationRows(ref);
    expect(rows).toHaveLength(1);
  });
});

describe("notifyCancellation — resident copy", () => {
  it("writes a resident_id-keyed 'cancelled' row when residentId is set", async () => {
    const ref = `test-ref-${crypto.randomUUID()}`;
    await notifyCancellation({
      kind: "booking",
      listingType: "centre",
      listingId: "test-listing-1",
      listingName: "Test Centre",
      vendorId,
      guestName: "Test Guest",
      guestEmail: "guest@example.test",
      ref,
      detailsText: "Cancelled",
      residentId,
    });

    const rows = await residentNotificationRows(ref);
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toContain("cancelled");
  });

  it("writes nothing for a pure guest cancellation", async () => {
    const ref = `test-ref-${crypto.randomUUID()}`;
    await notifyCancellation({
      kind: "registration",
      listingType: "club",
      listingId: "test-club-1",
      listingName: "Test Club",
      vendorId,
      guestName: "Test Guardian",
      guestEmail: "guardian@example.test",
      ref,
      detailsText: "Cancelled",
    });

    const rows = await residentNotificationRows(ref);
    expect(rows).toHaveLength(0);
  });
});

describe("notifyRefund — resident copy", () => {
  it("writes a resident_id-keyed refund row when residentId is set", async () => {
    const ref = `test-ref-${crypto.randomUUID()}`;
    await notifyRefund({
      kind: "booking",
      listingType: "centre",
      listingId: "test-listing-1",
      listingName: "Test Centre",
      vendorId,
      guestName: "Test Guest",
      guestEmail: "guest@example.test",
      ref,
      detailsText: "Refunded",
      refundedCents: 5000,
      residentId,
    });

    const rows = await residentNotificationRows(ref);
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toContain("Refund issued");
  });
});
