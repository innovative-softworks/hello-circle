import { randomUUID } from "node:crypto";
import type { APIRequestContext } from "@playwright/test";
import { expect } from "../fixtures";
import { evidence } from "../authorization-fixture";
import { test, withActors, rows } from "../lifecycle-fixture";
import { bookableProgram, guest, outbound } from "../booking-fixture";

// Phase 8 — programme enrolments (free confirms internally; paid stops at the provider).

const enrolBody = (email: string) => ({ participantName: `QA participant ${randomUUID().slice(0, 4)}`, email, phone: "000" });
const confirmed = (f: any, program: string) => rows(f, "SELECT ref, client_id FROM program_enrollments WHERE program_id = ? AND payment_status = 'paid' AND status != 'cancelled' ORDER BY id", [program]);

test("BK-PROGRAM-LIFECYCLE: enrol, persist, capacity, duplicate, ownership, cancel idempotently, vendor cancel", async ({ playwright }) => {
  await withActors(playwright, ["QA_VENDOR", "QA_VENDOR_B"], async f => {
    const opened: APIRequestContext[] = [];
    try {
      const program = await bookableProgram(f, { price: 0, capacity: 2 });
      const [a, b, c] = await Promise.all([1, 2, 3].map(() => guest(playwright, opened)));
      const ea = await a.ctx.post(`/api/programs/${program.id}/enroll`, { data: { ...enrolBody(a.email), totalCents: 999, priceCents: 999 } });
      expect(ea.status()).toBe(201);
      const refA = (await ea.json()).ref;
      expect((await rows(f, "SELECT client_id, total_cents, payment_status, status FROM program_enrollments WHERE ref = ?", [refA]))[0]).toEqual({ client_id: a.clientId, total_cents: 0, payment_status: "paid", status: "confirmed" });
      expect((await (await a.ctx.get("/api/programs/enrollments/mine")).json()).map((x: any) => x.ref)).toContain(refA);
      expect(JSON.stringify(await (await f.actors.QA_VENDOR.get(`/api/vendor/programs/${program.id}/enrollments`)).json())).toContain(refA);
      expect((await f.actors.QA_VENDOR_B.get(`/api/vendor/programs/${program.id}/enrollments`)).status()).toBe(403);
      const dup = await a.ctx.post(`/api/programs/${program.id}/enroll`, { data: enrolBody(a.email) });
      expect((await b.ctx.post(`/api/programs/${program.id}/enroll`, { data: enrolBody(b.email) })).status()).toBe(dup.status() === 201 ? 409 : 201);
      expect((await c.ctx.post(`/api/programs/${program.id}/enroll`, { data: enrolBody(c.email) })).status()).toBe(409);
      expect((await confirmed(f, program.id)).length).toBe(2);
      // Ownership.
      expect((await b.ctx.get(`/api/programs/enrollments/status/${refA}`)).status()).toBe(404);
      expect((await b.ctx.post(`/api/programs/enrollments/${refA}/cancel`, { data: {} })).status()).toBe(404);
      // Cancel idempotently → capacity released → C enrols.
      expect((await a.ctx.post(`/api/programs/enrollments/${refA}/cancel`, { data: {} })).status()).toBe(200);
      expect((await a.ctx.post(`/api/programs/enrollments/${refA}/cancel`, { data: {} })).status()).toBe(409);
      expect((await (await a.ctx.get("/api/programs/enrollments/mine")).json()).find((x: any) => x.ref === refA)?.status, "cancelled stays in history").toBe("cancelled");
      expect((await c.ctx.post(`/api/programs/${program.id}/enroll`, { data: enrolBody(c.email) })).status()).toBe(201);
      // Vendor cancel (owning org only).
      const [{ id: enrolId, ref: enrolRef }] = await rows(f, "SELECT id, ref FROM program_enrollments WHERE program_id = ? AND client_id = ? AND status != 'cancelled'", [program.id, c.clientId]);
      f.track("audit_log", "object_id", enrolRef); // vendor cancel writes an audit row keyed by ref
      expect((await f.actors.QA_VENDOR_B.post(`/api/vendor/programs/${program.id}/enrollments/${enrolId}/cancel`, { data: {} })).status()).toBe(403);
      expect((await f.actors.QA_VENDOR.post(`/api/vendor/programs/${program.id}/enrollments/${enrolId}/cancel`, { data: {} })).status()).toBe(200);
      expect((await rows(f, "SELECT status FROM program_enrollments WHERE id = ?", [enrolId]))[0].status).toBe("cancelled");
      // Not open for enrolment once unpublished.
      await f.connection.execute("UPDATE programs SET status = 'paused' WHERE id = ?", [program.id]);
      expect((await c.ctx.post(`/api/programs/${program.id}/enroll`, { data: enrolBody(c.email) })).status()).toBe(409);
      await evidence("bk-program-lifecycle", { duplicateEnrolmentSameGuest: dup.status() });
    } finally { for (const x of opened) await x.dispose(); }
  });
});

test("BK-PROGRAM-CONCURRENT-BOUNDARY: concurrent enrolment for the last place; paid programme stops at the provider", async ({ playwright }) => {
  await withActors(playwright, ["QA_VENDOR"], async f => {
    const opened: APIRequestContext[] = [];
    try {
      const program = await bookableProgram(f, { price: 0, capacity: 1 });
      const gs = await Promise.all([1, 2, 3, 4, 5, 6].map(() => guest(playwright, opened)));
      const results = await Promise.all(gs.map(g => g.ctx.post(`/api/programs/${program.id}/enroll`, { data: enrolBody(g.email) })));
      expect(results.map(r => r.status()).sort()).toEqual([201, 409, 409, 409, 409, 409]);
      expect((await confirmed(f, program.id)).length).toBe(1);
      const paidProgram = await bookableProgram(f, { price: 2500, capacity: 5 });
      const r = await gs[0].ctx.post(`/api/programs/${paidProgram.id}/enroll`, { data: enrolBody(gs[0].email) });
      expect(r.status()).toBe(503);
      expect(await rows(f, "SELECT ref FROM program_enrollments WHERE program_id = ?", [paidProgram.id])).toEqual([]);
      expect(await outbound(gs[0].ctx)).toEqual({ blockedOutboundAttempts: 0, paymentProviderConfigured: false });
      // Held capacity: a pending (mid-checkout) enrolment does not reserve the last place.
      const held = await bookableProgram(f, { price: 0, capacity: 1 });
      await f.connection.execute("INSERT INTO program_enrollments (ref, program_id, client_id, participant_name, email, total_cents, payment_status) VALUES (?, ?, ?, 'QA pending', 'qa_pending@example.test', 3200, 'pending')", [randomUUID(), held.id, randomUUID()]);
      const competing = await gs[1].ctx.post(`/api/programs/${held.id}/enroll`, { data: enrolBody(gs[1].email) });
      await evidence("bk-program-boundary", { concurrentConfirmed: 1, paidBoundary: 503, pendingHoldCompetingStatus: competing.status() });
    } finally { for (const x of opened) await x.dispose(); }
  });
});
