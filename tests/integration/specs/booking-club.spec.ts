import { randomUUID } from "node:crypto";
import type { APIRequestContext } from "@playwright/test";
import { expect } from "../fixtures";
import { evidence } from "../authorization-fixture";
import { test, withActors, rows } from "../lifecycle-fixture";
import { bookableClub, guest, registrationBody, outbound, synthCoupon, expectedTotal } from "../booking-fixture";

// Phase 8 — club registrations (free/trial/cash confirm internally; online stops at the provider).

const paid = (f: any, club: string) => rows(f, "SELECT ref, client_id FROM registrations WHERE club_id = ? AND payment_status = 'paid' AND status != 'cancelled' ORDER BY id", [club]);
const wl = (f: any, club: string) => rows(f, "SELECT id, client_id, status FROM waitlist_entries WHERE listing_type = 'club' AND listing_id = ? ORDER BY id", [club]);

test("BK-CLUB-LIFECYCLE: free registration, capacity 1, waitlist, held offer, claim, cancel and vendor ownership", async ({ playwright }) => {
  await withActors(playwright, ["QA_VENDOR", "QA_VENDOR_B"], async f => {
    const opened: APIRequestContext[] = [];
    try {
      const club = await bookableClub(f, { price: 0, capacity: 1 });
      const [a, b, c] = await Promise.all([1, 2, 3].map(() => guest(playwright, opened)));
      const ra = await a.ctx.post("/api/registrations/checkout", { data: registrationBody(club, a.email, { totalCents: 1, couponCode: undefined }) });
      expect(ra.status()).toBe(201);
      const refA = (await ra.json()).ref;
      expect((await rows(f, "SELECT client_id, total_cents, payment_status, status FROM registrations WHERE ref = ?", [refA]))[0]).toEqual({ client_id: a.clientId, total_cents: 0, payment_status: "paid", status: "confirmed" });
      expect((await (await a.ctx.get("/api/registrations")).json()).map((x: any) => x.ref)).toContain(refA);
      expect(JSON.stringify(await (await f.actors.QA_VENDOR.get("/api/vendor/registrations")).json())).toContain(refA);
      // Capacity 1: B is refused, may join the waitlist once.
      const rb = await b.ctx.post("/api/registrations/checkout", { data: registrationBody(club, b.email) });
      expect(rb.status()).toBe(409);
      expect((await rb.json()).full).toBe(true);
      expect((await b.ctx.post(`/api/clubs/${club}/waitlist`, { data: { name: "QA B", email: b.email } })).status()).toBe(201);
      expect((await b.ctx.post(`/api/clubs/${club}/waitlist`, { data: { name: "QA B", email: b.email } })).status()).toBe(409);
      // Ownership: B and the other org cannot read/cancel A's registration.
      expect((await b.ctx.get(`/api/registrations/status/${refA}`)).status()).toBe(404);
      expect((await b.ctx.post(`/api/registrations/${refA}/cancel`, { data: {} })).status()).toBe(404);
      expect((await f.actors.QA_VENDOR_B.post(`/api/vendor/registrations/${refA}/cancel`, { data: {} })).status()).toBe(404);
      // A cancels → spot offered to B (held); C cannot take it; B claims.
      expect((await a.ctx.post(`/api/registrations/${refA}/cancel`, { data: {} })).status()).toBe(200);
      expect((await a.ctx.post(`/api/registrations/${refA}/cancel`, { data: {} })).status()).toBe(409);
      await expect.poll(async () => (await wl(f, club)).map(w => w.status).join(",")).toBe("offered");
      const rc = await c.ctx.post("/api/registrations/checkout", { data: registrationBody(club, c.email) });
      expect(rc.status(), "held offer blocks a non-offered registrant").toBe(409);
      const claim = await b.ctx.post("/api/registrations/checkout", { data: registrationBody(club, b.email) });
      expect(claim.status()).toBe(201);
      expect((await wl(f, club)).map(w => w.status)).toEqual(["claimed"]);
      expect((await paid(f, club)).map(r => r.client_id)).toEqual([b.clientId]);
      // Vendor (owning org) cancel frees the spot again.
      const claimRef = (await claim.json()).ref;
      f.track("audit_log", "object_id", claimRef); // vendor cancel writes an audit row keyed by ref
      expect((await f.actors.QA_VENDOR.post(`/api/vendor/registrations/${claimRef}/cancel`, { data: {} })).status()).toBe(200);
      expect(await paid(f, club)).toEqual([]);
      // Duplicate submission by the same guest (same registrant details).
      const free2 = await bookableClub(f, { price: 0, capacity: 5 });
      const body = registrationBody(free2, a.email);
      const first = await a.ctx.post("/api/registrations/checkout", { data: body });
      const second = await a.ctx.post("/api/registrations/checkout", { data: body });
      await evidence("bk-club-lifecycle", { capacity1Refused: 409, waitlist: true, heldOfferBlocked: true, claimed: true, duplicateSubmissionStatuses: `${first.status()},${second.status()}`, duplicateRows: (await paid(f, free2)).length });
    } finally { for (const c of opened) await c.dispose(); }
  });
});

test("BK-CLUB-CONCURRENT: club-wide and session capacity under concurrent registration", async ({ playwright }) => {
  await withActors(playwright, ["QA_VENDOR"], async f => {
    const opened: APIRequestContext[] = [];
    try {
      const club = await bookableClub(f, { price: 0, capacity: 1 });
      const gs = await Promise.all([1, 2, 3, 4, 5, 6].map(() => guest(playwright, opened)));
      const clubWide = await Promise.all(gs.map(g => g.ctx.post("/api/registrations/checkout", { data: registrationBody(club, g.email) })));
      const clubWideConfirmed = (await paid(f, club)).length;
      // Per-session capacity (row-locked path).
      const club2 = await bookableClub(f, { price: 0, capacity: null });
      const session = randomUUID();
      await f.connection.execute("INSERT INTO club_sessions (id, club_id, day_of_week, time, capacity, label, active) VALUES (?, ?, 3, '18:00', 1, 'QA', 1)", [session, club2]);
      const sessionResults = await Promise.all(gs.map(g => g.ctx.post("/api/registrations/checkout", { data: registrationBody(club2, g.email, { sessionId: session }) })));
      expect(sessionResults.map(r => r.status()).sort()).toEqual([201, 409, 409, 409, 409, 409]);
      expect((await rows(f, "SELECT id FROM registrations WHERE session_id = ? AND payment_status = 'paid' AND status != 'cancelled'", [session])).length).toBe(1);
      await evidence("bk-club-concurrent", { clubWideStatuses: clubWide.map(r => r.status()).sort().join(","), clubWideConfirmed, capacity: 1, sessionConfirmed: 1 });
    } finally { for (const c of opened) await c.dispose(); }
  });
});

test("BK-CLUB-PRICING-BOUNDARY: authoritative price, coupons on the free path, held capacity and the provider boundary", async ({ playwright }) => {
  await withActors(playwright, ["QA_VENDOR"], async f => {
    const opened: APIRequestContext[] = [];
    try {
      const g = await guest(playwright, opened);
      // Paid online club → 503 before any row; tampered totals ignored.
      const paidClub = await bookableClub(f, { price: 50, capacity: 10, payment: "online" });
      const r = await g.ctx.post("/api/registrations/checkout", { data: registrationBody(paidClub, g.email, { totalCents: 0, trial: false, price: 0 }) });
      expect(r.status()).toBe(503);
      expect(await rows(f, "SELECT ref FROM registrations WHERE club_id = ?", [paidClub])).toEqual([]);
      expect(await outbound(g.ctx)).toEqual({ blockedOutboundAttempts: 0, paymentProviderConfigured: false });
      // Cash club: server price incl. VAT/fee.
      const cashClub = await bookableClub(f, { price: 50, capacity: 10, payment: "cash" });
      const cash = await g.ctx.post("/api/registrations/checkout", { data: registrationBody(cashClub, g.email, { totalCents: 1 }) });
      expect(cash.status()).toBe(201);
      expect((await rows(f, "SELECT total_cents, payment_status FROM registrations WHERE ref = ?", [(await cash.json()).ref]))[0]).toEqual({ total_cents: expectedTotal(5000), payment_status: "paid" });
      // 100% single-use coupon on an online club makes the order free → confirmed internally. Reuse?
      const coupon = await synthCoupon(f, { kind: "percent", amount: 100, maxUses: 1 });
      const c1 = await g.ctx.post("/api/registrations/checkout", { data: registrationBody(paidClub, g.email, { couponCode: coupon }) });
      const c2 = await g.ctx.post("/api/registrations/checkout", { data: registrationBody(paidClub, g.email, { couponCode: coupon }) });
      const [{ used_count: used }] = await rows(f, "SELECT used_count FROM coupons WHERE code = ?", [coupon]);
      // Held capacity: a pending (mid-checkout) registration on a capacity-1 club, inserted for this test-owned club only.
      const heldClub = await bookableClub(f, { price: 0, capacity: 1 });
      await f.connection.execute(`INSERT INTO registrations (ref, client_id, club_id, team, child_first, child_last, dob, g_first, g_last, email, phone, address, ec_name, ec_phone, ec_rel, medical, consent, trial, total_cents, payment_status, status, registrant_type)
        VALUES (?, ?, ?, '', 'QA', 'Pending', '', 'QA', 'Pending', 'qa_pending@example.test', '0', 'QA', '', '', '', '', 1, 0, 6400, 'pending', 'confirmed', 'adult')`, [`QAP${randomUUID().slice(0, 8)}`, randomUUID(), heldClub]);
      const competing = await g.ctx.post("/api/registrations/checkout", { data: registrationBody(heldClub, g.email) });
      // Club session hard delete → registrations referencing it.
      const sClub = await bookableClub(f, { price: 0, capacity: null });
      const session = randomUUID();
      await f.connection.execute("INSERT INTO club_sessions (id, club_id, day_of_week, time, capacity, label, active) VALUES (?, ?, 2, '19:00', 5, 'QA', 1)", [session, sClub]);
      expect((await g.ctx.post("/api/registrations/checkout", { data: registrationBody(sClub, g.email, { sessionId: session }) })).status()).toBe(201);
      expect((await f.actors.QA_VENDOR.delete(`/api/club-sessions/${session}`)).status()).toBe(200);
      const orphans = await rows(f, "SELECT r.ref FROM registrations r LEFT JOIN club_sessions s ON s.id = r.session_id WHERE r.club_id = ? AND r.session_id IS NOT NULL AND s.id IS NULL", [sClub]);
      await evidence("bk-club-pricing", { paidBoundary: 503, couponFirst: c1.status(), couponSecond: c2.status(), couponUsedCount: Number(used), pendingHoldCompetingStatus: competing.status(), orphanedSessionRegistrations: orphans.length });
    } finally { for (const c of opened) await c.dispose(); }
  });
});
