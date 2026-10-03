import { randomUUID } from "node:crypto";
import type { APIRequestContext } from "@playwright/test";
import { expect, personas } from "../fixtures";
import { evidence } from "../authorization-fixture";
import { test, withActors, rows, createCircle, createActivity } from "../lifecycle-fixture";
import { closureGame, closureInvite } from "../closure-fixture";
import { bookableExperience, bookableProgram, experienceBody, guest, irelandDate } from "../booking-fixture";

// Phase 11B — MVP product gaps, API + object-level authorization. Fail-before:
// none of these routes/guarantees existed (revoke routes 404; /mine had no
// canCancel/refundState; a refunded booking vanished from /mine).

const noToken = (body: unknown) => !JSON.stringify(body).match(/"token"\s*:/i);

async function hostInvite(f: any, game: string, residentId: string) {
  const res = await f.actors.QA_HOST.post("/api/invitations", { data: { entityType: "game", entityId: game, inviteeResidentIds: [residentId] } });
  expect(res.status(), "host invites").toBe(201);
  const [row] = await rows(f, "SELECT id, token, status FROM invitations WHERE entity_type = 'game' AND entity_id = ? AND invitee_resident_id = ?", [game, residentId]);
  return row as { id: string; token: string; status: string };
}

const privateReads = (actor: APIRequestContext, game: string) =>
  Promise.all(["", "/participants", "/updates"].map(async (s) => (await actor.get(`/api/games/${game}${s}`)).status()));

test("HC-GAP-INV-1: activity invitation revoke — organiser only, idempotent, removes every invitation-based access, old link dead", async ({ playwright }) => {
  await withActors(playwright, ["QA_HOST", "QA_HOST_B", "QA_USER", "QA_USER_B"], async (f) => {
    const game = await closureGame(f);
    const invite = await hostInvite(f, game, personas.QA_USER.id);
    expect(await privateReads(f.actors.QA_USER, game), "invitee can see before revoke").toEqual([200, 200, 200]);

    // Sent list: host sees it, never a token; an unrelated resident sees nothing.
    const hostList = await (await f.actors.QA_HOST.get(`/api/invitations/sent?entityType=game&entityId=${game}`)).json();
    expect(hostList.map((i: any) => i.id)).toContain(invite.id);
    expect(noToken(hostList), "no raw invitation token exposed").toBe(true);
    expect(await (await f.actors.QA_USER_B.get(`/api/invitations/sent?entityType=game&entityId=${game}`)).json()).toEqual([]);

    // Object-level authorization: unrelated host, recipient, unrelated resident → indistinguishable 404, nothing changes.
    const unchanged = await f.snapshot("SELECT * FROM invitations WHERE id = ?", [invite.id]);
    for (const actor of ["QA_HOST_B", "QA_USER", "QA_USER_B"]) {
      expect((await f.actors[actor].post(`/api/invitations/${invite.id}/revoke`, { data: {} })).status(), `${actor} cannot revoke`).toBe(404);
    }
    await unchanged();

    // Organiser revokes; repeat is a no-op.
    const first = await f.actors.QA_HOST.post(`/api/invitations/${invite.id}/revoke`, { data: {} });
    expect(first.status()).toBe(200);
    expect((await first.json()).status).toBe("revoked");
    const again = await f.actors.QA_HOST.post(`/api/invitations/${invite.id}/revoke`, { data: {} });
    expect(again.status()).toBe(200);
    expect((await again.json()).alreadyRevoked).toBe(true);
    const [after] = await rows(f, "SELECT status, token FROM invitations WHERE id = ?", [invite.id]);
    expect(after.status).toBe("revoked");
    expect(after.token, "token rotated — the old link is dead").not.toBe(invite.token);
    expect((await rows(f, "SELECT id FROM audit_log WHERE action = 'invitation.revoked' AND object_id = ?", [invite.id])).length).toBe(1);
    f.track("audit_log", "object_id", invite.id);

    // No access remains solely because of the revoked invitation.
    expect(await privateReads(f.actors.QA_USER, game), "detail/participants/updates").toEqual([404, 404, 404]);
    expect((await f.actors.QA_USER.post(`/api/games/${game}/join`, { data: {} })).status()).toBe(404);
    expect((await f.actors.QA_USER.post(`/api/games/${game}/waitlist`, { data: {} })).status()).toBe(404);
    expect((await f.actors.QA_USER.post(`/api/invitations/${invite.id}/respond`, { data: { response: "accepted" } })).status()).toBe(409);
    expect((await f.actors.QA_USER.get(`/api/invitations/token/${invite.token}`)).status(), "old URL").toBe(404);
    expect((await f.actors.QA_USER.post(`/api/invitations/token/${invite.token}/respond`, { data: { response: "accepted" } })).status()).toBe(404);
    expect((await (await f.actors.QA_USER.get("/api/invitations/mine")).json()).map((i: any) => i.id)).not.toContain(invite.id);
    const share = await (await f.actors.QA_USER.get(`/api/share/game/${game}`)).json();
    expect(share.date ?? null, "no time/date via share preview").toBeNull();
    expect(share.location ?? null, "no location via share preview").toBeNull();
    expect((await rows(f, "SELECT id FROM game_participants WHERE game_id = ? AND resident_id = ?", [game, personas.QA_USER.id])).length).toBe(0);

    // The organiser may deliberately re-invite.
    await hostInvite(f, game, personas.QA_USER.id);
    expect(await privateReads(f.actors.QA_USER, game)).toEqual([200, 200, 200]);
    await evidence("hc-gap-inv-1", { unauthorizedRevoke: 404, revoke: 200, repeat: "alreadyRevoked", accessAfter: 404, oldLink: 404, reinvite: true });
  });
});

test("HC-GAP-INV-2: only pending invitations are revocable; accepted/declined/expired untouched; concurrent revokes = one transition", async ({ playwright }) => {
  await withActors(playwright, ["QA_HOST", "QA_USER"], async (f) => {
    const results: Record<string, number> = {};
    for (const [status, expired] of [["accepted", false], ["maybe", false], ["declined", false], ["pending", true]] as const) {
      const game = await closureGame(f);
      const inv = await closureInvite(f, game, { status, expired });
      const unchanged = await f.snapshot("SELECT * FROM invitations WHERE id = ?", [inv.id]);
      const res = await f.actors.QA_HOST.post(`/api/invitations/${inv.id}/revoke`, { data: {} });
      results[`${status}${expired ? "-expired" : ""}`] = res.status();
      expect(res.status(), `${status}${expired ? " (expired)" : ""} not revocable`).toBe(409);
      await unchanged();
    }
    // Accepted invitation keeps its legitimate access.
    const kept = await closureGame(f);
    await closureInvite(f, kept, { status: "accepted" });
    expect((await f.actors.QA_USER.get(`/api/games/${kept}`)).status()).toBe(200);

    const game = await closureGame(f);
    const inv = await hostInvite(f, game, personas.QA_USER.id);
    f.track("audit_log", "object_id", inv.id);
    const statuses = (await Promise.all([1, 2, 3, 4].map(() => f.actors.QA_HOST.post(`/api/invitations/${inv.id}/revoke`, { data: {} })))).map((r) => r.status());
    expect(statuses, "every concurrent revoke answers cleanly").toEqual([200, 200, 200, 200]);
    expect((await rows(f, "SELECT id FROM audit_log WHERE action = 'invitation.revoked' AND object_id = ?", [inv.id])).length, "one transition").toBe(1);
    await evidence("hc-gap-inv-2", { nonPending: JSON.stringify(results), concurrent: statuses.join(",") });
  });
});

const expSeats = async (f: any, session: string) => Number((await rows(f, "SELECT COALESCE(SUM(party_size), 0) AS n FROM experience_bookings WHERE session_id = ? AND payment_status = 'paid' AND status != 'cancelled'", [session]))[0].n);
const progSeats = async (f: any, program: string) => Number((await rows(f, "SELECT COUNT(*) AS n FROM program_enrollments WHERE program_id = ? AND payment_status = 'paid' AND status != 'cancelled'", [program]))[0].n);
const mineRow = async (ctx: APIRequestContext, path: string, ref: string) => ((await (await ctx.get(path)).json()) as any[]).find((r) => r.ref === ref);

test("HC-GAP-EXP-1: experience self-cancel — server-decided canCancel, capacity once, notifications once, concurrent/double, cross-user, refund states", async ({ playwright }) => {
  await withActors(playwright, ["QA_VENDOR"], async (f) => {
    const opened: APIRequestContext[] = [];
    try {
      const exp = await bookableExperience(f, { price: 0, capacity: 4, payment: "cash" });
      const [a, b] = await Promise.all([guest(playwright, opened), guest(playwright, opened)]);
      const url = `/api/experiences/${exp.id}/sessions/${exp.session}/checkout`;
      const refA = (await (await a.ctx.post(url, { data: experienceBody(a.email, { partySize: 2 }) })).json()).ref;
      f.track("audit_log", "object_id", refA);
      const before = await mineRow(a.ctx, "/api/experiences/bookings/mine", refA);
      expect(before).toMatchObject({ canCancel: true, refundState: "none" });
      expect(JSON.stringify(before)).not.toMatch(/stripe_session|cs_test/i);
      expect(await expSeats(f, exp.session)).toBe(2);
      // Cross-user.
      expect((await b.ctx.post(`/api/experiences/bookings/${refA}/cancel`, { data: {} })).status()).toBe(404);
      // Concurrent / double submit → exactly one transition.
      const statuses = (await Promise.all([1, 2, 3].map(() => a.ctx.post(`/api/experiences/bookings/${refA}/cancel`, { data: {} })))).map((r) => r.status()).sort();
      expect(statuses).toEqual([200, 409, 409]);
      expect(await expSeats(f, exp.session), "capacity released exactly once").toBe(0);
      // Notifications are sent fire-and-forget after the transition — let them settle first.
      await new Promise((r) => setTimeout(r, 2_000));
      const notes = (await rows(f, "SELECT id FROM notifications WHERE ref = ? AND kind = 'experience' AND title LIKE '%ancel%'", [refA])).length;
      expect(notes, "cancellation notification sent").toBeGreaterThan(0);
      expect((await a.ctx.post(`/api/experiences/bookings/${refA}/cancel`, { data: {} })).status()).toBe(409);
      await new Promise((r) => setTimeout(r, 1_500));
      expect((await rows(f, "SELECT id FROM notifications WHERE ref = ? AND kind = 'experience' AND title LIKE '%ancel%'", [refA])).length, "no duplicate notification").toBe(notes);
      expect(await mineRow(a.ctx, "/api/experiences/bookings/mine", refA)).toMatchObject({ status: "cancelled", canCancel: false, refundState: "none" });

      // Paid online (Policy A): cancellation → refund pending until HelloCircle issues it.
      const paid = await bookableExperience(f, { price: 1500, capacity: 4, payment: "cash" });
      const refP = (await (await a.ctx.post(`/api/experiences/${paid.id}/sessions/${paid.session}/checkout`, { data: experienceBody(a.email) })).json()).ref;
      f.track("audit_log", "object_id", refP);
      await f.connection.execute("UPDATE experience_bookings SET stripe_session_id = ? WHERE ref = ?", [`cs_test_qa_${randomUUID()}`, refP]);
      const cancelP = await a.ctx.post(`/api/experiences/bookings/${refP}/cancel`, { data: {} });
      expect(cancelP.status()).toBe(200);
      expect((await cancelP.json()).refundState, "honest: refund pending, not 'refunded'").toBe("pending");
      expect(await mineRow(a.ctx, "/api/experiences/bookings/mine", refP)).toMatchObject({ status: "cancelled", paymentStatus: "paid", refundState: "pending", paidOnline: true });
      // Once the provider refund lands (simulated state), it stays visible as refunded.
      await f.connection.execute("UPDATE experience_bookings SET payment_status = 'refunded' WHERE ref = ?", [refP]);
      expect(await mineRow(a.ctx, "/api/experiences/bookings/mine", refP), "refunded booking stays in My Life").toMatchObject({ refundState: "refunded", canCancel: false });

      // Already refunded (not cancelled) → not cancellable, state shown.
      const refR = (await (await a.ctx.post(`/api/experiences/${paid.id}/sessions/${paid.session}/checkout`, { data: experienceBody(a.email) })).json()).ref;
      f.track("audit_log", "object_id", refR);
      await f.connection.execute("UPDATE experience_bookings SET payment_status = 'refunded' WHERE ref = ?", [refR]);
      expect(await mineRow(a.ctx, "/api/experiences/bookings/mine", refR)).toMatchObject({ canCancel: false, refundState: "refunded" });
      expect((await a.ctx.post(`/api/experiences/bookings/${refR}/cancel`, { data: {} })).status()).toBe(409);

      // Inside the organisation's cancellation window (default 48h) → not offered, refused.
      const soon = await bookableExperience(f, { price: 0, capacity: 2, payment: "cash" });
      const refS = (await (await a.ctx.post(`/api/experiences/${soon.id}/sessions/${soon.session}/checkout`, { data: experienceBody(a.email) })).json()).ref;
      f.track("audit_log", "object_id", refS);
      await f.connection.execute("UPDATE experience_sessions SET date = ? WHERE id = ?", [irelandDate(1), soon.session]);
      expect(await mineRow(a.ctx, "/api/experiences/bookings/mine", refS)).toMatchObject({ canCancel: false });
      expect((await a.ctx.post(`/api/experiences/bookings/${refS}/cancel`, { data: {} })).status()).toBe(409);
      await evidence("hc-gap-exp-1", { concurrent: statuses.join(","), capacityAfter: 0, paidRefundState: "pending", refundedVisible: true, windowBlocked: true });
    } finally { for (const x of opened) await x.dispose(); }
  });
});

test("HC-GAP-PROG-1: programme self-cancel — canCancel, capacity once, notifications once, concurrent, cross-user, refund states", async ({ playwright }) => {
  await withActors(playwright, ["QA_VENDOR"], async (f) => {
    const opened: APIRequestContext[] = [];
    try {
      const prog = await bookableProgram(f, { price: 0, capacity: 2 });
      const [a, b] = await Promise.all([guest(playwright, opened), guest(playwright, opened)]);
      const enrol = async (who: typeof a, program: string) => (await (await who.ctx.post(`/api/programs/${program}/enroll`, { data: { participantName: `QA ${randomUUID().slice(0, 4)}`, email: who.email } })).json()).ref as string;
      const refA = await enrol(a, prog.id);
      f.track("audit_log", "object_id", refA);
      expect(await mineRow(a.ctx, "/api/programs/enrollments/mine", refA)).toMatchObject({ canCancel: true, refundState: "none" });
      expect(await progSeats(f, prog.id)).toBe(1);
      expect((await b.ctx.post(`/api/programs/enrollments/${refA}/cancel`, { data: {} })).status(), "cross-user").toBe(404);
      const statuses = (await Promise.all([1, 2, 3].map(() => a.ctx.post(`/api/programs/enrollments/${refA}/cancel`, { data: {} })))).map((r) => r.status()).sort();
      expect(statuses).toEqual([200, 409, 409]);
      expect(await progSeats(f, prog.id), "capacity released exactly once").toBe(0);
      await new Promise((r) => setTimeout(r, 2_000));
      const notes = (await rows(f, "SELECT id FROM notifications WHERE ref = ? AND title LIKE '%ancel%'", [refA])).length;
      expect(notes, "cancellation notification sent").toBeGreaterThan(0);
      expect((await a.ctx.post(`/api/programs/enrollments/${refA}/cancel`, { data: {} })).status()).toBe(409);
      await new Promise((r) => setTimeout(r, 1_500));
      expect((await rows(f, "SELECT id FROM notifications WHERE ref = ? AND title LIKE '%ancel%'", [refA])).length, "no duplicate notification").toBe(notes);
      expect(await mineRow(a.ctx, "/api/programs/enrollments/mine", refA)).toMatchObject({ status: "cancelled", canCancel: false });

      // Paid online (state staged on a free enrolment — this suite has no
      // payment provider; the real Stripe path is covered in the stripe batch).
      const paid = await bookableProgram(f, { price: 0, capacity: 2 });
      const refP = await enrol(a, paid.id);
      f.track("audit_log", "object_id", refP);
      await f.connection.execute("UPDATE program_enrollments SET stripe_session_id = ?, payment_status = 'paid', total_cents = 2500 WHERE ref = ?", [`cs_test_qa_${randomUUID()}`, refP]);
      expect(await mineRow(a.ctx, "/api/programs/enrollments/mine", refP)).toMatchObject({ canCancel: true, refundState: "none", paidOnline: true });
      const c = await a.ctx.post(`/api/programs/enrollments/${refP}/cancel`, { data: {} });
      expect(c.status()).toBe(200);
      expect((await c.json()).refundState, "honest: refund pending").toBe("pending");
      await f.connection.execute("UPDATE program_enrollments SET payment_status = 'refunded' WHERE ref = ?", [refP]);
      expect(await mineRow(a.ctx, "/api/programs/enrollments/mine", refP), "refunded enrolment stays visible").toMatchObject({ refundState: "refunded", canCancel: false });
      await evidence("hc-gap-prog-1", { concurrent: statuses.join(","), capacityAfter: 0, paidRefundState: "pending" });
    } finally { for (const x of opened) await x.dispose(); }
  });
});
