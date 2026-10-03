import { randomUUID } from "node:crypto";
import type { APIRequestContext } from "@playwright/test";
import { expect } from "../fixtures";
import { evidence } from "../authorization-fixture";
import { test, withActors, rows } from "../lifecycle-fixture";
import { bookableExperience, experienceBody, expectedTotal, guest, outbound } from "../booking-fixture";

// Phase 8 — experience/adventure bookings (cash/free confirm internally; online stops at the provider).

const seats = async (f: any, session: string) => Number((await rows(f, "SELECT COALESCE(SUM(party_size), 0) AS n FROM experience_bookings WHERE session_id = ? AND payment_status = 'paid' AND status != 'cancelled'", [session]))[0].n);

test("BK-EXPERIENCE-LIFECYCLE: party pricing, capacity, ownership, cancel idempotently, vendor cancel and session cancel", async ({ playwright }) => {
  await withActors(playwright, ["QA_VENDOR", "QA_VENDOR_B"], async f => {
    const opened: APIRequestContext[] = [];
    try {
      const exp = await bookableExperience(f, { price: 1000, capacity: 4, payment: "cash" });
      const [a, b, c] = await Promise.all([1, 2, 3].map(() => guest(playwright, opened)));
      const url = `/api/experiences/${exp.id}/sessions/${exp.session}/checkout`;
      const ra = await a.ctx.post(url, { data: experienceBody(a.email, { partySize: 2, totalCents: 1, priceCents: 1 }) });
      expect(ra.status()).toBe(201);
      const refA = (await ra.json()).ref;
      expect((await rows(f, "SELECT client_id, party_size, total_cents, payment_status, status FROM experience_bookings WHERE ref = ?", [refA]))[0])
        .toEqual({ client_id: a.clientId, party_size: 2, total_cents: expectedTotal(2000), payment_status: "paid", status: "confirmed" });
      expect((await (await a.ctx.get("/api/experiences/bookings/mine")).json()).map((x: any) => x.ref)).toContain(refA);
      expect((await b.ctx.post(url, { data: experienceBody(b.email, { partySize: 3 }) })).status(), "party larger than remaining seats").toBe(409);
      expect((await b.ctx.post(url, { data: experienceBody(b.email, { partySize: 2 }) })).status()).toBe(201);
      expect(await seats(f, exp.session)).toBe(4);
      expect((await c.ctx.post(url, { data: experienceBody(c.email) })).status()).toBe(409);
      // Ownership.
      expect((await c.ctx.get(`/api/experiences/bookings/status/${refA}`)).status()).toBe(404);
      expect((await c.ctx.post(`/api/experiences/bookings/${refA}/cancel`, { data: {} })).status()).toBe(404);
      const [{ id: bookingA }] = await rows(f, "SELECT id FROM experience_bookings WHERE ref = ?", [refA]);
      expect((await f.actors.QA_VENDOR_B.post(`/api/vendor/experiences/${exp.id}/bookings/${bookingA}/cancel`, { data: {} })).status()).toBe(403);
      // Owner cancel idempotent → seats released → C books.
      expect((await a.ctx.post(`/api/experiences/bookings/${refA}/cancel`, { data: {} })).status()).toBe(200);
      expect((await a.ctx.post(`/api/experiences/bookings/${refA}/cancel`, { data: {} })).status()).toBe(409);
      expect(await seats(f, exp.session)).toBe(2);
      const rc = await c.ctx.post(url, { data: experienceBody(c.email) });
      expect(rc.status()).toBe(201);
      // Vendor cancels C's booking.
      const refC = (await rc.json()).ref;
      const [{ id: bookingC }] = await rows(f, "SELECT id FROM experience_bookings WHERE ref = ?", [refC]);
      f.track("audit_log", "object_id", refC); // vendor cancel writes an audit row keyed by ref
      expect((await f.actors.QA_VENDOR.post(`/api/vendor/experiences/${exp.id}/bookings/${bookingC}/cancel`, { data: {} })).status()).toBe(200);
      expect((await f.actors.QA_VENDOR.post(`/api/vendor/experiences/${exp.id}/bookings/${bookingC}/cancel`, { data: {} })).status()).toBe(409);
      // Vendor cancels the whole session (resource cancellation) with B's booking still active.
      expect((await f.actors.QA_VENDOR.delete(`/api/vendor/experiences/${exp.id}/sessions/${exp.session}`)).status()).toBe(200);
      const [bRow] = await rows(f, "SELECT status, payment_status FROM experience_bookings WHERE session_id = ? AND client_id = ?", [exp.session, b.clientId]);
      const bMine = (await (await b.ctx.get("/api/experiences/bookings/mine")).json()) as any[];
      const bNotes = await rows(f, "SELECT id FROM notifications WHERE listing_id = ? AND title LIKE '%ancel%'", [exp.id]);
      await evidence("bk-experience-lifecycle", { bookingStatusAfterSessionCancel: `${bRow.status}/${bRow.payment_status}`, bListedEntries: bMine.length, cancellationNotificationsForSession: bNotes.length });
    } finally { for (const x of opened) await x.dispose(); }
  });
});

test("BK-EXPERIENCE-INTEGRITY: concurrency, party-size inputs, held capacity and the provider boundary", async ({ playwright }) => {
  await withActors(playwright, ["QA_VENDOR"], async f => {
    const opened: APIRequestContext[] = [];
    try {
      const gs = await Promise.all([1, 2, 3, 4, 5, 6].map(() => guest(playwright, opened)));
      const one = await bookableExperience(f, { price: 0, capacity: 1 });
      const results = await Promise.all(gs.map(g => g.ctx.post(`/api/experiences/${one.id}/sessions/${one.session}/checkout`, { data: experienceBody(g.email) })));
      expect(results.map(r => r.status()).sort()).toEqual([201, 409, 409, 409, 409, 409]);
      expect(await seats(f, one.session)).toBe(1);
      // Party-size representations.
      const exp = await bookableExperience(f, { price: 1000, capacity: 20, payment: "cash" });
      const url = `/api/experiences/${exp.id}/sessions/${exp.session}/checkout`;
      const observed: Record<string, string> = {};
      for (const [name, partySize] of [["zero", 0], ["negative", -3], ["fraction", 1.5], ["string", "2"], ["huge", 999]] as const) {
        const r = await gs[0].ctx.post(url, { data: experienceBody(gs[0].email, { partySize }) });
        const stored = r.status() === 201 ? (await rows(f, "SELECT party_size, subtotal_cents, total_cents FROM experience_bookings WHERE ref = ?", [(await r.json()).ref]))[0] : null;
        observed[name] = `${r.status()}${stored ? ` stored(party=${stored.party_size},subtotal=${stored.subtotal_cents},total=${stored.total_cents})` : ""}`;
      }
      // Held capacity: pending mid-checkout booking on a capacity-1 session.
      const held = await bookableExperience(f, { price: 0, capacity: 1 });
      await f.connection.execute("INSERT INTO experience_bookings (ref, experience_id, session_id, client_id, participant_name, email, party_size, total_cents, payment_status) VALUES (?, ?, ?, ?, 'QA pending', 'qa_pending@example.test', 1, 1280, 'pending')", [randomUUID(), held.id, held.session, randomUUID()]);
      const competing = await gs[1].ctx.post(`/api/experiences/${held.id}/sessions/${held.session}/checkout`, { data: experienceBody(gs[1].email) });
      // Provider boundary.
      const online = await bookableExperience(f, { price: 1500, capacity: 5, payment: "online" });
      const p = await gs[2].ctx.post(`/api/experiences/${online.id}/sessions/${online.session}/checkout`, { data: experienceBody(gs[2].email) });
      expect(p.status()).toBe(503);
      expect(await rows(f, "SELECT ref FROM experience_bookings WHERE experience_id = ?", [online.id])).toEqual([]);
      expect(await outbound(gs[2].ctx)).toEqual({ blockedOutboundAttempts: 0, paymentProviderConfigured: false });
      // Past-dated session still 'scheduled'.
      const past = await bookableExperience(f, { price: 0, capacity: 5, date: "2021-05-05" });
      const pastBooking = await gs[3].ctx.post(`/api/experiences/${past.id}/sessions/${past.session}/checkout`, { data: experienceBody(gs[3].email) });
      await evidence("bk-experience-integrity", { ...observed, pendingHoldCompetingStatus: competing.status(), paidBoundary: 503, pastSessionBooking: pastBooking.status() });
    } finally { for (const x of opened) await x.dispose(); }
  });
});
