import type { APIRequestContext } from "@playwright/test";
import { expect, personas } from "../fixtures";
import { evidence } from "../authorization-fixture";
import { test, withActors, rows, createActivity } from "../lifecycle-fixture";
import { bookableCentre, bookableClub, bookableExperience, bookableProgram, bookingBody, experienceBody, guest, outbound, registrationBody, synthCoupon } from "../booking-fixture";

// Phase 8 remediation — provider-independent paid state machine. This batch
// runs with the QA provider seam (QA_PAYMENT_PROVIDER_STUB): checkout returns a
// synthetic session with no network, and /api/__qa/provider drives the app's
// own success / failure / expired handling. Stripe stays unconfigured.

const provider = (actor: APIRequestContext, type: string, ref: string, outcome: "success" | "failure" | "expired") =>
  actor.post("/api/__qa/provider", { data: { type, ref, outcome } });
const settledCount = async (f: any, sql: string, values: unknown[]) => {
  let last = -1;
  for (let i = 0; i < 15; i++) { const n = (await rows(f, sql, values)).length; if (n === last) return n; last = n; await new Promise(r => setTimeout(r, 250)); }
  return last;
};
/** Age only this test's own pending row past the hold window (safe control). */
const expireHold = (f: any, table: string, ref: string, column = "created_at") => f.connection.execute(`UPDATE ${table} SET ${column} = NOW() - INTERVAL 31 MINUTE WHERE ref = ?`, [ref]);

test("BK-PAY-REGISTRATION: hold, success (idempotent, coupon once), failure, expiry and late success", async ({ playwright }) => {
  await withActors(playwright, ["QA_VENDOR"], async f => {
    const opened: APIRequestContext[] = [];
    try {
      const [a, b, c] = await Promise.all([1, 2, 3].map(() => guest(playwright, opened)));
      expect(await outbound(a.ctx)).toEqual({ blockedOutboundAttempts: 0, paymentProviderConfigured: false });
      // Hold + success + duplicate success.
      const club = await bookableClub(f, { price: 50, capacity: 1, payment: "online" });
      const coupon = await synthCoupon(f, { kind: "percent", amount: 10, maxUses: 1 });
      const ra = await a.ctx.post("/api/registrations/checkout", { data: registrationBody(club, a.email, { couponCode: coupon }) });
      expect(ra.status()).toBe(201);
      const refA = (await ra.json()).ref;
      expect((await rows(f, "SELECT payment_status, stripe_session_id FROM registrations WHERE ref = ?", [refA]))[0]).toEqual({ payment_status: "pending", stripe_session_id: `cs_qa_stub_${refA}` });
      expect((await b.ctx.post("/api/registrations/checkout", { data: registrationBody(club, b.email) })).status(), "pending hold reserves the last place").toBe(409);
      for (let i = 0; i < 2; i++) expect((await provider(a.ctx, "registration", refA, "success")).status()).toBe(200);
      expect((await rows(f, "SELECT payment_status, status FROM registrations WHERE ref = ?", [refA]))[0]).toEqual({ payment_status: "paid", status: "confirmed" });
      expect((await rows(f, "SELECT used_count FROM coupons WHERE code = ?", [coupon]))[0].used_count).toBe(1);
      const notes = await settledCount(f, "SELECT id FROM notifications WHERE ref = ?", [refA]);
      expect((await provider(a.ctx, "registration", refA, "success")).status()).toBe(200);
      expect(await settledCount(f, "SELECT id FROM notifications WHERE ref = ?", [refA])).toBe(notes);
      expect((await rows(f, "SELECT id FROM registrations WHERE club_id = ? AND payment_status = 'paid' AND status != 'cancelled'", [club])).length).toBe(1);
      // Failure releases the hold.
      const club2 = await bookableClub(f, { price: 50, capacity: 1, payment: "online" });
      const r2 = (await (await a.ctx.post("/api/registrations/checkout", { data: registrationBody(club2, a.email) })).json()).ref;
      expect((await provider(a.ctx, "registration", r2, "failure")).status()).toBe(200);
      expect((await rows(f, "SELECT payment_status FROM registrations WHERE ref = ?", [r2]))[0].payment_status).toBe("failed");
      expect((await b.ctx.post("/api/registrations/checkout", { data: registrationBody(club2, b.email) })).status(), "capacity back after failure").toBe(201);
      // Expiry: stale hold stops counting; a late success cannot take a place someone else now holds.
      const club3 = await bookableClub(f, { price: 50, capacity: 1, payment: "online" });
      const r3 = (await (await a.ctx.post("/api/registrations/checkout", { data: registrationBody(club3, a.email) })).json()).ref;
      await expireHold(f, "registrations", r3);
      const rb3 = await b.ctx.post("/api/registrations/checkout", { data: registrationBody(club3, b.email) });
      expect(rb3.status(), "expired hold released").toBe(201);
      expect((await provider(a.ctx, "registration", r3, "success")).status()).toBe(200);
      expect((await rows(f, "SELECT payment_status, status FROM registrations WHERE ref = ?", [r3]))[0], "late success → refund required, not a second place").toEqual({ payment_status: "paid", status: "cancelled" });
      f.track("audit_log", "object_id", r3);
      expect((await rows(f, "SELECT action FROM audit_log WHERE object_id = ?", [r3])).map(x => x.action)).toEqual(["registration.refund_required"]);
      expect((await provider(b.ctx, "registration", (await rb3.json()).ref, "success")).status()).toBe(200);
      expect((await rows(f, "SELECT id FROM registrations WHERE club_id = ? AND payment_status = 'paid' AND status != 'cancelled'", [club3])).length).toBe(1);
      // Concurrent paid checkouts for the last place.
      const club4 = await bookableClub(f, { price: 50, capacity: 1, payment: "online" });
      const gs = await Promise.all([1, 2, 3, 4, 5, 6].map(() => guest(playwright, opened)));
      const racing = await Promise.all(gs.map(g => g.ctx.post("/api/registrations/checkout", { data: registrationBody(club4, g.email) })));
      expect(racing.map(r => r.status()).sort()).toEqual([201, 409, 409, 409, 409, 409]);
      // A stale hold whose seat is still free confirms normally.
      const club5 = await bookableClub(f, { price: 50, capacity: 2, payment: "online" });
      const r5 = (await (await c.ctx.post("/api/registrations/checkout", { data: registrationBody(club5, c.email) })).json()).ref;
      await expireHold(f, "registrations", r5);
      expect((await provider(c.ctx, "registration", r5, "success")).status()).toBe(200);
      expect((await rows(f, "SELECT payment_status, status FROM registrations WHERE ref = ?", [r5]))[0]).toEqual({ payment_status: "paid", status: "confirmed" });
      expect(await outbound(a.ctx)).toEqual({ blockedOutboundAttempts: 0, paymentProviderConfigured: false });
      await evidence("bk-pay-registration", { hold: 409, success: true, duplicateSuccessNoop: true, couponUsedOnce: 1, failureReleases: 201, expiryReleases: 201, lateSuccess: "refund_required", concurrentPaid: racing.map(r => r.status()).sort().join(",") });
    } finally { for (const x of opened) await x.dispose(); }
  });
});

test("BK-PAY-PROGRAM-EXPERIENCE-HALL: holds, success, failure and expiry across the other paid models", async ({ playwright }) => {
  await withActors(playwright, ["QA_VENDOR"], async f => {
    const opened: APIRequestContext[] = [];
    try {
      const [a, b] = await Promise.all([1, 2].map(() => guest(playwright, opened)));
      // Programme.
      const program = await bookableProgram(f, { price: 2500, capacity: 1 });
      const pa = await a.ctx.post(`/api/programs/${program.id}/enroll`, { data: { participantName: "QA A", email: a.email } });
      expect(pa.status()).toBe(201);
      const prefA = (await pa.json()).ref;
      expect((await b.ctx.post(`/api/programs/${program.id}/enroll`, { data: { participantName: "QA B", email: b.email } })).status()).toBe(409);
      await expireHold(f, "program_enrollments", prefA);
      const pb = await b.ctx.post(`/api/programs/${program.id}/enroll`, { data: { participantName: "QA B", email: b.email } });
      expect(pb.status(), "expired programme hold released").toBe(201);
      expect((await provider(b.ctx, "program", (await pb.json()).ref, "success")).status()).toBe(200);
      expect((await provider(a.ctx, "program", prefA, "success")).status()).toBe(200);
      f.track("audit_log", "object_id", prefA);
      expect((await rows(f, "SELECT payment_status, status FROM program_enrollments WHERE ref = ?", [prefA]))[0]).toEqual({ payment_status: "paid", status: "cancelled" });
      expect((await rows(f, "SELECT id FROM program_enrollments WHERE program_id = ? AND payment_status = 'paid' AND status != 'cancelled'", [program.id])).length).toBe(1);
      // Experience (party of 2, capacity 2).
      const exp = await bookableExperience(f, { price: 1500, capacity: 2, payment: "online" });
      const url = `/api/experiences/${exp.id}/sessions/${exp.session}/checkout`;
      const ea = await a.ctx.post(url, { data: experienceBody(a.email, { partySize: 2 }) });
      expect(ea.status()).toBe(201);
      const erefA = (await ea.json()).ref;
      expect((await b.ctx.post(url, { data: experienceBody(b.email) })).status()).toBe(409);
      expect((await provider(a.ctx, "experience", erefA, "failure")).status()).toBe(200);
      expect(await rows(f, "SELECT ref FROM experience_bookings WHERE ref = ?", [erefA])).toEqual([]);
      const eb = await b.ctx.post(url, { data: experienceBody(b.email, { partySize: 2 }) });
      expect(eb.status(), "failure released the seats").toBe(201);
      for (let i = 0; i < 2; i++) expect((await provider(b.ctx, "experience", (await eb.json()).ref, "success")).status()).toBe(200);
      expect((await rows(f, "SELECT COALESCE(SUM(party_size), 0) AS n FROM experience_bookings WHERE session_id = ? AND payment_status = 'paid' AND status != 'cancelled'", [exp.session]))[0].n).toBe("2");
      // Hall (online room): pending holds the slot; expiry frees it; late success → refund required.
      const centre = await bookableCentre(f, { payment: "online" });
      const ha = await a.ctx.post("/api/bookings/checkout", { data: bookingBody(centre, a.email) });
      expect(ha.status()).toBe(201);
      const hrefA = (await ha.json()).ref;
      expect((await b.ctx.post("/api/bookings/checkout", { data: bookingBody(centre, b.email) })).status()).toBe(409);
      await expireHold(f, "bookings", hrefA);
      const hb = await b.ctx.post("/api/bookings/checkout", { data: bookingBody(centre, b.email) });
      expect(hb.status(), "expired hall hold released").toBe(201);
      expect((await provider(a.ctx, "booking", hrefA, "success")).status()).toBe(200);
      f.track("audit_log", "object_id", hrefA);
      expect((await rows(f, "SELECT payment_status, status FROM bookings WHERE ref = ?", [hrefA]))[0]).toEqual({ payment_status: "paid", status: "cancelled" });
      expect((await provider(b.ctx, "booking", (await hb.json()).ref, "success")).status()).toBe(200);
      expect((await rows(f, "SELECT ref FROM bookings WHERE centre_id = ? AND payment_status = 'paid' AND status != 'cancelled'", [centre.id])).length).toBe(1);
      expect(await outbound(a.ctx)).toEqual({ blockedOutboundAttempts: 0, paymentProviderConfigured: false });
      await evidence("bk-pay-other-models", { programHoldExpiry: true, experienceFailureRelease: true, hallExpiryAndLateSuccess: true });
    } finally { for (const x of opened) await x.dispose(); }
  });
});

test("BK-PAY-ACTIVITY: paid join hold, idempotent success, expired hold restartable", async ({ playwright }) => {
  await withActors(playwright, ["QA_HOST", "QA_USER", "QA_USER_B"], async f => {
    const { QA_USER: a, QA_USER_B: b } = f.actors;
    const game = await createActivity(f, "QA_HOST", { capacity: 2, priceCents: 800 });
    const ja = await a.post(`/api/games/${game.id}/join`, { data: {} });
    expect(ja.status()).toBe(201);
    const refA = (await ja.json()).ref;
    expect((await b.post(`/api/games/${game.id}/join`, { data: {} })).status(), "pending_payment holds the seat").toBe(409);
    for (let i = 0; i < 2; i++) expect((await provider(a, "game", refA, "success")).status()).toBe(200);
    expect((await rows(f, "SELECT status, payment_status FROM game_participants WHERE ref = ?", [refA]))[0]).toEqual({ status: "joined", payment_status: "paid" });
    const g2 = await createActivity(f, "QA_HOST", { capacity: 2, priceCents: 800 });
    const r2 = (await (await b.post(`/api/games/${g2.id}/join`, { data: {} })).json()).ref;
    expect((await b.post(`/api/games/${g2.id}/join`, { data: {} })).status(), "own live hold blocks a duplicate").toBe(409);
    await f.connection.execute("UPDATE game_participants SET joined_at = NOW() - INTERVAL 31 MINUTE WHERE ref = ?", [r2]);
    const restart = await b.post(`/api/games/${g2.id}/join`, { data: {} });
    expect(restart.status(), "expired hold can be restarted").toBe(201);
    expect((await rows(f, "SELECT COUNT(*) AS n FROM game_participants WHERE game_id = ? AND resident_id = ?", [g2.id, personas.QA_USER_B.id]))[0].n).toBe(1);
    await evidence("bk-pay-activity", { holdBlocks: 409, idempotentSuccess: true, expiredRestart: restart.status() });
  });
});
