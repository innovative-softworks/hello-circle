import { randomUUID } from "node:crypto";
import type { APIRequestContext } from "@playwright/test";
import { expect } from "../fixtures";
import { evidence } from "../authorization-fixture";
import { test, withActors, rows } from "../lifecycle-fixture";
import { uiActor } from "../lifecycle-ui-fixture";
import { bookableCentre, bookableClub, bookableExperience, bookableProgram, bookingBody, experienceBody, expectedTotal, guest, irelandDate, registrationBody, synthCoupon } from "../booking-fixture";

// Phase 8 booking finding gate HC-QA-034..047. The original failing-before
// regressions are unchanged (red before remediation, green after); HC-QA-047 was
// found and fixed during the remediation cross-model review. Extended scenarios
// live in booking-remediation*.spec.ts and booking-provider.spec.ts.

async function guests(playwright: any, n: number, opened: APIRequestContext[]) { return Promise.all(Array.from({ length: n }, () => guest(playwright, opened))); }

test("HC-QA-034: club-wide capacity is never exceeded by concurrent registrations", async ({ playwright }) => {
  await withActors(playwright, ["QA_VENDOR"], async f => {
    const opened: APIRequestContext[] = [];
    try {
      const club = await bookableClub(f, { price: 0, capacity: 1 });
      const gs = await guests(playwright, 6, opened);
      const results = await Promise.all(gs.map(g => g.ctx.post("/api/registrations/checkout", { data: registrationBody(club, g.email) })));
      const confirmed = (await rows(f, "SELECT id FROM registrations WHERE club_id = ? AND payment_status = 'paid' AND status != 'cancelled'", [club])).length;
      await evidence("hc-qa-034", { statuses: results.map(r => r.status()).sort().join(","), confirmed, capacity: 1 });
      expect(confirmed).toBe(1);
    } finally { for (const c of opened) await c.dispose(); }
  });
});

test("HC-QA-035: hall-hire duration must be a positive whole number of hours (price follows the stored duration)", async ({ playwright }) => {
  await withActors(playwright, ["QA_VENDOR"], async f => {
    const opened: APIRequestContext[] = [];
    try {
      const centre = await bookableCentre(f, { rate: 20 });
      const [g] = await guests(playwright, 1, opened);
      const negative = await g.ctx.post("/api/bookings/checkout", { data: bookingBody(centre, g.email, { duration: -2 }) });
      const fraction = await g.ctx.post("/api/bookings/checkout", { data: bookingBody(centre, g.email, { duration: 1.5, time: "13:00" }) });
      const stored = await rows(f, "SELECT duration, total_cents FROM bookings WHERE centre_id = ? ORDER BY id", [centre.id]);
      await evidence("hc-qa-035", { negativeStatus: negative.status(), fractionStatus: fraction.status(), stored: JSON.stringify(stored) });
      expect(negative.status()).toBe(400);
      expect(fraction.status()).toBe(400);
      for (const r of stored) expect(r.total_cents, "total matches stored duration").toBe(expectedTotal(20 * 100 * r.duration));
    } finally { for (const c of opened) await c.dispose(); }
  });
});

test("HC-QA-036: hall booking validates guests against room capacity and rejects past or malformed dates cleanly", async ({ playwright }) => {
  await withActors(playwright, ["QA_VENDOR"], async f => {
    const opened: APIRequestContext[] = [];
    try {
      const centre = await bookableCentre(f, { rate: 20, cap: 10 });
      const [g] = await guests(playwright, 1, opened);
      const statuses: Record<string, number> = {};
      for (const [name, extra] of Object.entries({ overCap: { guests: 500 }, negativeGuests: { guests: -3, time: "12:00" }, past: { date: "2021-03-03", time: "14:00" }, malformed: { date: "not-a-date", time: "16:00" } })) {
        statuses[name] = (await g.ctx.post("/api/bookings/checkout", { data: bookingBody(centre, g.email, extra) })).status();
      }
      const malformedRows = await rows(f, "SELECT ref FROM bookings WHERE centre_id = ? AND date = 'not-a-date'", [centre.id]);
      await evidence("hc-qa-036", { ...statuses, malformedRowsLeft: malformedRows.length });
      expect(statuses).toEqual({ overCap: 400, negativeGuests: 400, past: 400, malformed: 400 });
      expect(malformedRows).toEqual([]);
    } finally { for (const c of opened) await c.dispose(); }
  });
});

test("HC-QA-037: a single-use coupon cannot be redeemed twice on cash or fully-discounted orders", async ({ playwright }) => {
  await withActors(playwright, ["QA_VENDOR"], async f => {
    const opened: APIRequestContext[] = [];
    try {
      const centre = await bookableCentre(f, { rate: 20 });
      const club = await bookableClub(f, { price: 50, capacity: 10, payment: "online" });
      const [g] = await guests(playwright, 1, opened);
      const cashCoupon = await synthCoupon(f, { kind: "percent", amount: 25, maxUses: 1 });
      const fullCoupon = await synthCoupon(f, { kind: "percent", amount: 100, maxUses: 1 });
      const cash = [await g.ctx.post("/api/bookings/checkout", { data: bookingBody(centre, g.email, { couponCode: cashCoupon }) }), await g.ctx.post("/api/bookings/checkout", { data: bookingBody(centre, g.email, { couponCode: cashCoupon, time: "14:00" }) })];
      const free = [await g.ctx.post("/api/registrations/checkout", { data: registrationBody(club, g.email, { couponCode: fullCoupon }) }), await g.ctx.post("/api/registrations/checkout", { data: registrationBody(club, g.email, { couponCode: fullCoupon }) })];
      const used = await rows(f, "SELECT code, used_count FROM coupons WHERE code IN (?, ?) ORDER BY code", [cashCoupon, fullCoupon]);
      await evidence("hc-qa-037", { cash: cash.map(r => r.status()).join(","), free: free.map(r => r.status()).join(","), used: JSON.stringify(used.map(u => Number(u.used_count))) });
      expect(cash.map(r => r.status())).toEqual([201, 400]);
      expect(free.map(r => r.status())).toEqual([201, 400]);
      for (const u of used) expect(Number(u.used_count)).toBe(1);
    } finally { for (const c of opened) await c.dispose(); }
  });
});

test("HC-QA-038: a repeated identical registration/enrolment does not create a second record or consume capacity twice", async ({ playwright }) => {
  await withActors(playwright, ["QA_VENDOR"], async f => {
    const opened: APIRequestContext[] = [];
    try {
      const club = await bookableClub(f, { price: 0, capacity: 5 });
      const program = await bookableProgram(f, { price: 0, capacity: 5 });
      const [g] = await guests(playwright, 1, opened);
      const reg = registrationBody(club, g.email);
      const regs = [await g.ctx.post("/api/registrations/checkout", { data: reg }), await g.ctx.post("/api/registrations/checkout", { data: reg })];
      const enrol = { participantName: "QA same participant", email: g.email, phone: "000" };
      const enrols = [await g.ctx.post(`/api/programs/${program.id}/enroll`, { data: enrol }), await g.ctx.post(`/api/programs/${program.id}/enroll`, { data: enrol })];
      const regRows = (await rows(f, "SELECT id FROM registrations WHERE club_id = ? AND status != 'cancelled'", [club])).length;
      const enrolRows = (await rows(f, "SELECT id FROM program_enrollments WHERE program_id = ? AND status != 'cancelled'", [program.id])).length;
      await evidence("hc-qa-038", { registration: regs.map(r => r.status()).join(","), enrolment: enrols.map(r => r.status()).join(","), regRows, enrolRows });
      expect([regRows, enrolRows]).toEqual([1, 1]);
    } finally { for (const c of opened) await c.dispose(); }
  });
});

test("HC-QA-039: experience party size must be a positive whole number; price and seats always agree", async ({ playwright }) => {
  await withActors(playwright, ["QA_VENDOR"], async f => {
    const opened: APIRequestContext[] = [];
    try {
      const exp = await bookableExperience(f, { price: 1000, capacity: 20, payment: "cash" });
      const [g] = await guests(playwright, 1, opened);
      const url = `/api/experiences/${exp.id}/sessions/${exp.session}/checkout`;
      const fraction = await g.ctx.post(url, { data: experienceBody(g.email, { partySize: 1.5 }) });
      const str = await g.ctx.post(url, { data: experienceBody(g.email, { partySize: "1" }) });
      const stored = await rows(f, "SELECT party_size, subtotal_cents FROM experience_bookings WHERE session_id = ?", [exp.session]);
      await evidence("hc-qa-039", { fraction: fraction.status(), string: str.status(), stored: JSON.stringify(stored) });
      expect(fraction.status()).toBe(400);
      for (const r of stored) expect(r.subtotal_cents, "price matches stored seats").toBe(1000 * r.party_size);
    } finally { for (const c of opened) await c.dispose(); }
  });
});
