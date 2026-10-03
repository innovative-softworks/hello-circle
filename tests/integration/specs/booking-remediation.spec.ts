import { randomUUID } from "node:crypto";
import type { APIRequestContext } from "@playwright/test";
import { expect } from "../fixtures";
import { evidence } from "../authorization-fixture";
import { test, withActors, rows } from "../lifecycle-fixture";
import { bookableCentre, bookableClub, bookableExperience, bookableProgram, bookingBody, experienceBody, expectedTotal, guest, irelandDate, registrationBody, synthCoupon } from "../booking-fixture";

// Phase 8 remediation — extended scenarios beyond the preserved HC-QA-034..046
// regressions (which stay unchanged in booking-findings.spec.ts).

async function guests(playwright: any, n: number, opened: APIRequestContext[]) { return Promise.all(Array.from({ length: n }, () => guest(playwright, opened))); }
const confirmedRegs = async (f: any, club: string) => (await rows(f, "SELECT id FROM registrations WHERE club_id = ? AND payment_status = 'paid' AND status != 'cancelled'", [club])).length;

test("REM-034: capacity 2 under 6-way races, independent clubs, waitlist after exhaustion", async ({ playwright }) => {
  await withActors(playwright, ["QA_VENDOR"], async f => {
    const opened: APIRequestContext[] = [];
    try {
      const gs = await guests(playwright, 6, opened);
      const two = await bookableClub(f, { price: 0, capacity: 2 });
      const r2 = await Promise.all(gs.map(g => g.ctx.post("/api/registrations/checkout", { data: registrationBody(two, g.email) })));
      expect(r2.map(r => r.status()).sort()).toEqual([201, 201, 409, 409, 409, 409]);
      expect(await confirmedRegs(f, two)).toBe(2);
      // Different clubs concurrently: each takes its own place (club-level locks don't block each other).
      const clubs = await Promise.all([1, 2, 3, 4, 5, 6].map(() => bookableClub(f, { price: 0, capacity: 1 })));
      const parallel = await Promise.all(gs.map((g, i) => g.ctx.post("/api/registrations/checkout", { data: registrationBody(clubs[i], g.email) })));
      expect(parallel.map(r => r.status())).toEqual([201, 201, 201, 201, 201, 201]);
      // Exhausted → waitlist → cancel → offer → claim, still within capacity.
      const loser = gs[r2.findIndex(r => r.status() === 409)];
      expect((await loser.ctx.post(`/api/clubs/${two}/waitlist`, { data: { name: "QA", email: loser.email } })).status()).toBe(201);
      const winner = gs[r2.findIndex(r => r.status() === 201)];
      const [{ ref: winnerRef }] = await rows(f, "SELECT ref FROM registrations WHERE club_id = ? AND client_id = ?", [two, winner.clientId]);
      expect((await winner.ctx.post(`/api/registrations/${winnerRef}/cancel`, { data: {} })).status()).toBe(200);
      await expect.poll(async () => (await rows(f, "SELECT status FROM waitlist_entries WHERE listing_id = ? AND client_id = ?", [two, loser.clientId]))[0]?.status).toBe("offered");
      expect((await loser.ctx.post("/api/registrations/checkout", { data: registrationBody(two, loser.email) })).status()).toBe(201);
      expect(await confirmedRegs(f, two)).toBe(2);
    } finally { for (const c of opened) await c.dispose(); }
  });
});

test("REM-035-036: hall duration and input matrix; billed hours equal reserved hours", async ({ playwright }) => {
  await withActors(playwright, ["QA_VENDOR"], async f => {
    const opened: APIRequestContext[] = [];
    try {
      const centre = await bookableCentre(f, { rate: 20, cap: 10 });
      const [g] = await guests(playwright, 1, opened);
      const cases: [string, Record<string, unknown>, number][] = [
        ["negative", { duration: -2 }, 400], ["zero", { duration: 0 }, 400], ["fraction", { duration: 1.5 }, 400],
        ["text", { duration: "two" }, 400], ["numericString", { duration: "2" }, 400], ["nullish", { duration: null }, 400],
        ["beyondClosing", { duration: 13, time: "10:00" }, 409], ["guestsZero", { guests: 0 }, 400], ["guestsFraction", { guests: 2.5 }, 400],
        // 09:00 today has passed only after 09:00 Ireland time; otherwise it's a valid future slot.
        ["today0900", { date: irelandDate(0), time: "09:00" }, Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Dublin", hour: "2-digit", hour12: false }).format(new Date())) >= 9 ? 400 : 201],
        ["badCalendar", { date: "2030-02-31" }, 400],
        ["minimum", { duration: 1, time: "10:00" }, 201], ["multiHour", { duration: 3, time: "12:00" }, 201], ["atCapacity", { guests: 10, time: "16:00" }, 201],
      ];
      const observed: Record<string, number> = {};
      for (const [name, extra, expected] of cases) {
        const r = await g.ctx.post("/api/bookings/checkout", { data: bookingBody(centre, g.email, extra) });
        observed[name] = r.status();
      }
      await evidence("rem-035-036", observed);
      for (const [name, , expected] of cases) expect(observed[name], name).toBe(expected);
      for (const b of await rows(f, "SELECT duration, subtotal_cents, total_cents FROM bookings WHERE centre_id = ?", [centre.id])) {
        expect(b.subtotal_cents, "billed = reserved hours").toBe(20 * 100 * b.duration);
        expect(b.total_cents).toBe(expectedTotal(b.subtotal_cents));
      }
      await evidence("rem-035-036", observed);
    } finally { for (const c of opened) await c.dispose(); }
  });
});

test("REM-037-038: concurrent single-use coupon, duplicate retries (sequential/concurrent) and legitimate rebooking", async ({ playwright }) => {
  await withActors(playwright, ["QA_VENDOR"], async f => {
    const opened: APIRequestContext[] = [];
    try {
      const gs = await guests(playwright, 6, opened);
      const club = await bookableClub(f, { price: 50, capacity: 20, payment: "cash" });
      const coupon = await synthCoupon(f, { kind: "fixed", amount: 1000, maxUses: 1 });
      const race = await Promise.all(gs.map(g => g.ctx.post("/api/registrations/checkout", { data: registrationBody(club, g.email, { couponCode: coupon }) })));
      expect(race.filter(r => r.status() === 201).length, "exactly one qualifying use").toBe(1);
      expect((await rows(f, "SELECT used_count FROM coupons WHERE code = ?", [coupon]))[0].used_count).toBe(1);
      expect((await rows(f, "SELECT id FROM registrations WHERE club_id = ? AND coupon_code = ?", [club, coupon])).length).toBe(1);
      // Duplicates: concurrent identical registration and enrolment → one record each.
      const free = await bookableClub(f, { price: 0, capacity: 20 });
      const body = registrationBody(free, gs[0].email);
      const dupes = await Promise.all([1, 2, 3, 4].map(() => gs[0].ctx.post("/api/registrations/checkout", { data: body })));
      expect(dupes.map(r => r.status()).sort()).toEqual([201, 409, 409, 409]);
      const program = await bookableProgram(f, { price: 0, capacity: 20 });
      const enrol = { participantName: "QA Same", email: gs[1].email };
      const enrols = await Promise.all([1, 2, 3, 4].map(() => gs[1].ctx.post(`/api/programs/${program.id}/enroll`, { data: enrol })));
      expect(enrols.map(r => r.status()).sort()).toEqual([201, 409, 409, 409]);
      // Different participant from the same owner is allowed (siblings).
      expect((await gs[0].ctx.post("/api/registrations/checkout", { data: { ...body, childLast: "Sibling" } })).status()).toBe(201);
      // Rebook after cancellation.
      const ref = (await dupes.find(r => r.status() === 201)!.json()).ref;
      expect((await gs[0].ctx.post(`/api/registrations/${ref}/cancel`, { data: {} })).status()).toBe(200);
      expect((await gs[0].ctx.post("/api/registrations/checkout", { data: body })).status(), "rebook after cancel").toBe(201);
      const eref = (await enrols.find(r => r.status() === 201)!.json()).ref;
      expect((await gs[1].ctx.post(`/api/programs/enrollments/${eref}/cancel`, { data: {} })).status()).toBe(200);
      expect((await gs[1].ctx.post(`/api/programs/${program.id}/enroll`, { data: enrol })).status()).toBe(201);
    } finally { for (const c of opened) await c.dispose(); }
  });
});

test("REM-039-045: party-size matrix (price = seats) and session start boundary", async ({ playwright }) => {
  await withActors(playwright, ["QA_VENDOR"], async f => {
    const opened: APIRequestContext[] = [];
    try {
      const [g] = await guests(playwright, 1, opened);
      const exp = await bookableExperience(f, { price: 1000, capacity: 5, payment: "cash" });
      const url = `/api/experiences/${exp.id}/sessions/${exp.session}/checkout`;
      const cases: [string, unknown, number][] = [["zero", 0, 400], ["negative", -1, 400], ["fraction", 1.5, 400], ["text", "two", 400], ["numericString", "2", 400], ["nan", "NaN", 400], ["overCapacity", 6, 409], ["one", 1, 201], ["max", 4, 201]];
      for (const [name, partySize, expected] of cases) expect((await g.ctx.post(url, { data: experienceBody(g.email, { partySize }) })).status(), name).toBe(expected);
      for (const b of await rows(f, "SELECT party_size, subtotal_cents FROM experience_bookings WHERE session_id = ?", [exp.session])) expect(b.subtotal_cents).toBe(1000 * b.party_size);
      expect(Number((await rows(f, "SELECT SUM(party_size) AS n FROM experience_bookings WHERE session_id = ? AND status != 'cancelled'", [exp.session]))[0].n)).toBe(5);
      // Quote = checkout amount for the same input.
      const quote = await (await g.ctx.post(`/api/experiences/${exp.id}/sessions/${exp.session}/quote`, { data: { partySize: 2 } })).json();
      expect(quote).toMatchObject({ partySize: 2, subtotalCents: 2000, totalCents: expectedTotal(2000), currency: "EUR" });
      expect((await g.ctx.post(`/api/experiences/${exp.id}/sessions/${exp.session}/quote`, { data: { partySize: 1.5 } })).status()).toBe(400);
      // Start boundary (Ireland time): earlier today → closed; later today and future → open.
      const now = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Dublin", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date()).split(":").map(Number);
      const mins = now[0] * 60 + now[1];
      const at = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
      const session = async (date: string, time: string) => {
        const id = randomUUID();
        await f.connection.execute("INSERT INTO experience_sessions (id, experience_id, date, time, capacity, status) VALUES (?, ?, ?, ?, 5, 'scheduled')", [id, exp.id, date, time]);
        return (await g.ctx.post(`/api/experiences/${exp.id}/sessions/${id}/checkout`, { data: experienceBody(g.email) })).status();
      };
      const results: Record<string, number> = { past: await session("2021-05-05", "10:00"), future: await session(irelandDate(3), "10:00") };
      if (mins > 5) results.earlierToday = await session(irelandDate(0), at(mins - 5));
      if (mins < 23 * 60 + 50) results.laterToday = await session(irelandDate(0), at(mins + 5));
      expect(results.past).toBe(409);
      expect(results.future).toBe(201);
      if (results.earlierToday !== undefined) expect(results.earlierToday).toBe(409);
      if (results.laterToday !== undefined) expect(results.laterToday).toBe(201);
      await evidence("rem-039-045", results);
    } finally { for (const c of opened) await c.dispose(); }
  });
});

test("REM-040-044-046: session cancel cascade (idempotent), club session delete rules, 6-way cancel races for enrolments and experiences", async ({ playwright }) => {
  await withActors(playwright, ["QA_VENDOR"], async f => {
    const opened: APIRequestContext[] = [];
    try {
      const gs = await guests(playwright, 6, opened);
      // 040 — cancel a session with a cash-paid booking; repeat is a no-op; new bookings denied.
      const exp = await bookableExperience(f, { price: 1000, capacity: 5, payment: "cash" });
      const url = `/api/experiences/${exp.id}/sessions/${exp.session}/checkout`;
      const ref = (await (await gs[0].ctx.post(url, { data: experienceBody(gs[0].email) })).json()).ref;
      const first = await (await f.actors.QA_VENDOR.delete(`/api/vendor/experiences/${exp.id}/sessions/${exp.session}`)).json();
      const again = await (await f.actors.QA_VENDOR.delete(`/api/vendor/experiences/${exp.id}/sessions/${exp.session}`)).json();
      expect([first.bookingsCancelled, again.bookingsCancelled]).toEqual([1, 0]);
      f.track("audit_log", "object_id", exp.session);
      expect((await rows(f, "SELECT status, payment_status FROM experience_bookings WHERE ref = ?", [ref]))[0], "paid → cancelled, refund follow-up via vendor refund route").toEqual({ status: "cancelled", payment_status: "paid" });
      expect((await gs[1].ctx.post(url, { data: experienceBody(gs[1].email) })).status()).toBe(409);
      await new Promise(r => setTimeout(r, 800));
      const cancelNotes = (await rows(f, "SELECT id FROM notifications WHERE ref = ? AND title LIKE '%ancel%'", [ref])).length;
      // 044 — empty session deleted; used session deactivated, history intact.
      const club = await bookableClub(f, { price: 0, capacity: null });
      const empty = randomUUID(), used = randomUUID();
      for (const id of [empty, used]) await f.connection.execute("INSERT INTO club_sessions (id, club_id, day_of_week, time, capacity, label, active) VALUES (?, ?, 2, '19:00', 5, 'QA', 1)", [id, club]);
      expect((await gs[2].ctx.post("/api/registrations/checkout", { data: registrationBody(club, gs[2].email, { sessionId: used }) })).status()).toBe(201);
      expect(await (await f.actors.QA_VENDOR.delete(`/api/club-sessions/${empty}`)).json()).toEqual({ ok: true, deactivated: false });
      expect(await (await f.actors.QA_VENDOR.delete(`/api/club-sessions/${used}`)).json()).toEqual({ ok: true, deactivated: true });
      expect(await rows(f, "SELECT id FROM club_sessions WHERE id = ?", [empty])).toEqual([]);
      expect((await rows(f, "SELECT active FROM club_sessions WHERE id = ?", [used]))[0].active).toBe(0);
      expect((await gs[3].ctx.post("/api/registrations/checkout", { data: registrationBody(club, gs[3].email, { sessionId: used }) })).status(), "inactive session closed to new registrations").toBe(400);
      // 046 — 6 simultaneous cancels for a programme enrolment and an experience booking.
      const program = await bookableProgram(f, { price: 0, capacity: 5 });
      const pref = (await (await gs[4].ctx.post(`/api/programs/${program.id}/enroll`, { data: { participantName: "QA", email: gs[4].email } })).json()).ref;
      const exp2 = await bookableExperience(f, { price: 0, capacity: 5 });
      const eref = (await (await gs[5].ctx.post(`/api/experiences/${exp2.id}/sessions/${exp2.session}/checkout`, { data: experienceBody(gs[5].email) })).json()).ref;
      await new Promise(r => setTimeout(r, 800));
      const [pBefore, eBefore] = [(await rows(f, "SELECT id FROM notifications WHERE ref = ?", [pref])).length, (await rows(f, "SELECT id FROM notifications WHERE ref = ?", [eref])).length];
      const pc = await Promise.all([1, 2, 3, 4, 5, 6].map(() => gs[4].ctx.post(`/api/programs/enrollments/${pref}/cancel`, { data: {} })));
      const ec = await Promise.all([1, 2, 3, 4, 5, 6].map(() => gs[5].ctx.post(`/api/experiences/bookings/${eref}/cancel`, { data: {} })));
      expect(pc.map(r => r.status()).sort()).toEqual([200, 409, 409, 409, 409, 409]);
      expect(ec.map(r => r.status()).sort()).toEqual([200, 409, 409, 409, 409, 409]);
      await new Promise(r => setTimeout(r, 1200));
      const pAfter = (await rows(f, "SELECT id FROM notifications WHERE ref = ?", [pref])).length - pBefore;
      const eAfter = (await rows(f, "SELECT id FROM notifications WHERE ref = ?", [eref])).length - eBefore;
      expect(pAfter).toBeLessThanOrEqual(2);
      expect(eAfter).toBeLessThanOrEqual(2);
      await evidence("rem-040-044-046", { sessionCancel: `${first.bookingsCancelled},${again.bookingsCancelled}`, sessionCancelNotifications: cancelNotes, programCancelNotifications: pAfter, experienceCancelNotifications: eAfter });
    } finally { for (const c of opened) await c.dispose(); }
  });
});
