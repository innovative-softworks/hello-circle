import type { APIRequestContext } from "@playwright/test";
import { expect, env } from "../fixtures";
import { evidence } from "../authorization-fixture";
import { test, withActors, rows } from "../lifecycle-fixture";
import { bookableCentre, bookingBody, expectedTotal, guest, irelandDate, outbound, synthCoupon } from "../booking-fixture";

// Phase 8 — centre/room hire (bookings). Cash rooms confirm internally
// ("due in cash on arrival"); online rooms stop at the provider-disabled boundary.

const active = (f: any, centre: string) => rows(f, "SELECT ref, client_id, date, time, status, payment_status, total_cents FROM bookings WHERE centre_id = ? AND status != 'cancelled' AND payment_status != 'failed' ORDER BY id", [centre]);
const notesFor = (f: any, ref: string) => rows(f, "SELECT kind, title, recipient_id, resident_id FROM notifications WHERE ref = ? ORDER BY id", [ref]);
/** Notification fan-out is fire-and-forget after the response: wait until the count is stable. */
async function settled(f: any, ref: string) {
  let last = -1;
  for (let i = 0; i < 20; i++) {
    const n = (await notesFor(f, ref)).length;
    if (n === last) return n;
    last = n;
    await new Promise(r => setTimeout(r, 300));
  }
  return last;
}

test("BK-CENTRE-LIFECYCLE: create, persist, duplicate, ownership, reschedule, cancel idempotently, rebook, vendor cancel", async ({ playwright }) => {
  await withActors(playwright, ["QA_VENDOR", "QA_VENDOR_B"], async f => {
    const opened: APIRequestContext[] = [];
    try {
      const centre = await bookableCentre(f, { rate: 20, cap: 10 });
      const a = await guest(playwright, opened), b = await guest(playwright, opened);
      // Create — with client-supplied price fields that must be ignored.
      const create = await a.ctx.post("/api/bookings/checkout", { data: bookingBody(centre, a.email, { totalCents: 1, subtotalCents: 1, discountCents: 999999, vatCents: 0, currency: "usd", priceCents: 1 }) });
      expect(create.status()).toBe(201);
      const { ref, totalEuro } = await create.json();
      const total = expectedTotal(20 * 2 * 100);
      expect(totalEuro).toBe(total / 100);
      const [row] = await rows(f, "SELECT client_id, resident_id, room_id, date, time, duration, guests, subtotal_cents, discount_cents, total_cents, payment_status, status, stripe_session_id FROM bookings WHERE ref = ?", [ref]);
      expect(row).toMatchObject({ client_id: a.clientId, resident_id: null, room_id: centre.room, date: irelandDate(14), time: "10:00", duration: 2, guests: 5, subtotal_cents: 4000, discount_cents: 0, total_cents: total, payment_status: "paid", status: "confirmed", stripe_session_id: null });
      // Persist: status + list for the owner (a "refresh" is a new request).
      expect((await a.ctx.get(`/api/bookings/status/${ref}`)).status()).toBe(200);
      expect((await (await a.ctx.get("/api/bookings")).json()).map((x: any) => x.ref)).toContain(ref);
      const vendorList = await (await f.actors.QA_VENDOR.get("/api/vendor/bookings")).json();
      expect(JSON.stringify(vendorList)).toContain(ref);
      const created = { length: await settled(f, ref) };
      // Duplicate / overlapping slot: never a second active booking.
      for (const actor of [a, b]) {
        const dup = await actor.ctx.post("/api/bookings/checkout", { data: bookingBody(centre, actor.email, { time: "11:00" }) });
        expect(dup.status()).toBe(409);
      }
      expect((await active(f, centre.id)).length).toBe(1);
      // Ownership: another guest can't read/modify/cancel; another vendor can't cancel.
      expect((await b.ctx.get(`/api/bookings/status/${ref}`)).status()).toBe(404);
      expect((await b.ctx.get(`/api/bookings/${ref}/ics`)).status()).toBe(404);
      expect((await (await b.ctx.get("/api/bookings")).json()).map((x: any) => x.ref)).not.toContain(ref);
      expect((await b.ctx.post(`/api/bookings/${ref}/cancel`, { data: {} })).status()).toBe(404);
      expect((await b.ctx.post(`/api/bookings/${ref}/reschedule`, { data: { date: irelandDate(15), time: "12:00" } })).status()).toBe(404);
      expect((await f.actors.QA_VENDOR_B.post(`/api/vendor/bookings/${ref}/cancel`, { data: {} })).status()).toBe(404);
      expect((await rows(f, "SELECT status, date, time FROM bookings WHERE ref = ?", [ref]))[0]).toEqual({ status: "confirmed", date: irelandDate(14), time: "10:00" });
      // Legitimate reschedule (session change) keeps ref/payment, frees the old slot.
      expect((await a.ctx.post(`/api/bookings/${ref}/reschedule`, { data: { date: irelandDate(15), time: "14:00" } })).status()).toBe(200);
      expect((await rows(f, "SELECT date, time, total_cents, payment_status FROM bookings WHERE ref = ?", [ref]))[0]).toEqual({ date: irelandDate(15), time: "14:00", total_cents: total, payment_status: "paid" });
      const old = await b.ctx.post("/api/bookings/checkout", { data: bookingBody(centre, b.email) });
      expect(old.status(), "old slot released by reschedule").toBe(201);
      const refB = (await old.json()).ref;
      const rescheduleNotes = (await settled(f, ref)) - created.length;
      // Cancel (owner) — idempotent: second cancel 409, no extra notification, capacity released once.
      expect((await a.ctx.post(`/api/bookings/${ref}/cancel`, { data: {} })).status()).toBe(200);
      const afterCancel = await settled(f, ref);
      expect((await a.ctx.post(`/api/bookings/${ref}/cancel`, { data: {} })).status()).toBe(409);
      expect(await settled(f, ref)).toBe(afterCancel);
      expect((await rows(f, "SELECT status, payment_status FROM bookings WHERE ref = ?", [ref]))[0]).toEqual({ status: "cancelled", payment_status: "paid" });
      // Rebook the released slot.
      const rebook = await a.ctx.post("/api/bookings/checkout", { data: bookingBody(centre, a.email, { date: irelandDate(15), time: "14:00" }) });
      expect(rebook.status()).toBe(201);
      // Vendor (owning org) cancels B's booking; repeat is rejected.
      f.track("audit_log", "object_id", refB); // vendor cancel writes an audit row keyed by ref
      expect((await f.actors.QA_VENDOR.post(`/api/vendor/bookings/${refB}/cancel`, { data: {} })).status()).toBe(200);
      expect((await f.actors.QA_VENDOR.post(`/api/vendor/bookings/${refB}/cancel`, { data: {} })).status()).toBe(409);
      expect((await rows(f, "SELECT status FROM bookings WHERE ref = ?", [refB]))[0].status).toBe("cancelled");
      expect((await (await a.ctx.get("/api/bookings")).json()).find((x: any) => x.ref === ref)?.status, "cancelled booking stays in history").toBe("cancelled");
      await evidence("bk-centre-lifecycle", { createNotifications: created.length, rescheduleNotifications: rescheduleNotes, cancelNotificationsAfterRepeat: afterCancel - created.length - rescheduleNotes, tamperIgnored: true });
    } finally { for (const c of opened) await c.dispose(); }
  });
});

test("BK-CENTRE-CONCURRENT: competing and duplicate concurrent requests for one slot never double-book", async ({ playwright }) => {
  await withActors(playwright, ["QA_VENDOR"], async f => {
    const opened: APIRequestContext[] = [];
    try {
      const centre = await bookableCentre(f);
      const guests = await Promise.all([1, 2, 3, 4, 5, 6].map(() => guest(playwright, opened)));
      const results = await Promise.all(guests.map(g => g.ctx.post("/api/bookings/checkout", { data: bookingBody(centre, g.email) })));
      expect(results.map(r => r.status()).sort()).toEqual([201, 409, 409, 409, 409, 409]);
      const same = await guest(playwright, opened);
      const dupes = await Promise.all([1, 2, 3].map(() => same.ctx.post("/api/bookings/checkout", { data: bookingBody(centre, same.email, { time: "16:00" }) })));
      expect(dupes.map(r => r.status()).sort()).toEqual([201, 409, 409]);
      expect((await active(f, centre.id)).length).toBe(2);
    } finally { for (const c of opened) await c.dispose(); }
  });
});

test("BK-CENTRE-INPUT: duration, guests and date are validated before pricing and inventory", async ({ playwright }) => {
  await withActors(playwright, ["QA_VENDOR"], async f => {
    const opened: APIRequestContext[] = [];
    try {
      const centre = await bookableCentre(f, { rate: 20, cap: 10 });
      const g = await guest(playwright, opened);
      const cases: Record<string, Record<string, unknown>> = {
        negativeDuration: { duration: -2, time: "10:00" },
        fractionalDuration: { duration: 1.5, time: "12:00" },
        stringDuration: { duration: "2", time: "13:00" },
        guestsOverCapacity: { guests: 500, time: "15:00" },
        negativeGuests: { guests: -3, time: "17:00" },
        pastDate: { date: "2021-03-03", time: "10:00" },
        malformedDate: { date: "not-a-date", time: "10:00" },
      };
      const observed: Record<string, string> = {};
      for (const [name, extra] of Object.entries(cases)) {
        const r = await g.ctx.post("/api/bookings/checkout", { data: bookingBody(centre, g.email, extra) });
        const stored = r.status() === 201 ? (await rows(f, "SELECT duration, guests, date, total_cents FROM bookings WHERE ref = ?", [(await r.json()).ref]))[0] : null;
        observed[name] = `${r.status()}${stored ? ` stored(duration=${stored.duration},guests=${stored.guests},date=${stored.date},total=${stored.total_cents})` : ""}`;
      }
      await evidence("bk-centre-input", observed);
    } finally { for (const c of opened) await c.dispose(); }
  });
});

test("BK-CENTRE-COUPON-BOUNDARY: coupon rules, single-use enforcement and the online provider boundary", async ({ playwright }) => {
  await withActors(playwright, ["QA_VENDOR"], async f => {
    const opened: APIRequestContext[] = [];
    try {
      const centre = await bookableCentre(f, { rate: 20 });
      const g = await guest(playwright, opened);
      const percent = await synthCoupon(f, { kind: "percent", amount: 25, maxUses: 1, listingType: "centre", listingId: centre.id });
      const expired = await synthCoupon(f, { kind: "fixed", amount: 500, expires: "2020-01-01 00:00:00" });
      const wrong = await synthCoupon(f, { kind: "fixed", amount: 500, listingType: "centre", listingId: "some-other-centre" });
      const fixedHuge = await synthCoupon(f, { kind: "fixed", amount: 999999 });
      expect((await g.ctx.post("/api/bookings/checkout", { data: bookingBody(centre, g.email, { couponCode: "NOPE-QA" }) })).status()).toBe(400);
      expect((await g.ctx.post("/api/bookings/checkout", { data: bookingBody(centre, g.email, { couponCode: expired }) })).status()).toBe(400);
      expect((await g.ctx.post("/api/bookings/checkout", { data: bookingBody(centre, g.email, { couponCode: wrong }) })).status()).toBe(400);
      const ok = await g.ctx.post("/api/bookings/checkout", { data: bookingBody(centre, g.email, { couponCode: percent.toLowerCase() }) });
      expect(ok.status()).toBe(201);
      const [withCoupon] = await rows(f, "SELECT subtotal_cents, discount_cents, total_cents, coupon_code FROM bookings WHERE ref = ?", [(await ok.json()).ref]);
      expect(withCoupon).toEqual({ subtotal_cents: 3000, discount_cents: 1000, total_cents: expectedTotal(3000), coupon_code: percent });
      const capped = await g.ctx.post("/api/bookings/checkout", { data: bookingBody(centre, g.email, { couponCode: fixedHuge, time: "14:00" }) });
      expect(capped.status()).toBe(201);
      expect((await rows(f, "SELECT total_cents FROM bookings WHERE ref = ?", [(await capped.json()).ref]))[0].total_cents, "fixed discount capped at subtotal, never negative").toBe(0);
      const reuse = await g.ctx.post("/api/bookings/checkout", { data: bookingBody(centre, g.email, { couponCode: percent, time: "17:00" }) });
      const [{ used_count: usedCount }] = await rows(f, "SELECT used_count FROM coupons WHERE code = ?", [percent]);
      // Provider boundary: an online room stops at the disabled provider, leaving no committed row.
      const online = await bookableCentre(f, { payment: "online" });
      expect(await outbound(g.ctx)).toEqual({ blockedOutboundAttempts: 0, paymentProviderConfigured: false });
      const paid = await g.ctx.post("/api/bookings/checkout", { data: bookingBody(online, g.email) });
      expect(paid.status()).toBe(503);
      expect(await paid.json()).toEqual({ error: "Payments aren't configured yet" });
      expect(await rows(f, "SELECT ref FROM bookings WHERE centre_id = ?", [online.id])).toEqual([]);
      expect(await rows(f, "SELECT id FROM notifications WHERE listing_id = ?", [online.id])).toEqual([]);
      expect(await outbound(g.ctx)).toEqual({ blockedOutboundAttempts: 0, paymentProviderConfigured: false });
      await evidence("bk-centre-coupon", { singleUseSecondRedemption: reuse.status(), usedCountAfterTwoCashRedemptions: Number(usedCount), providerBoundary: 503 });
    } finally { for (const c of opened) await c.dispose(); }
  });
});
