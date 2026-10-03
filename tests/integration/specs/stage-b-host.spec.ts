import { randomUUID } from "node:crypto";
import type { APIRequestContext } from "@playwright/test";
import { test, expect, personas } from "../fixtures";
import { withActors, evidence } from "../authorization-fixture";
import { FUTURE } from "../stage-b-fixture";

type Scope = Parameters<Parameters<typeof withActors>[2]>[0];
async function hostGame(f: Scope, input: Record<string, unknown>) {
  const created = await f.actors.QA_HOST.post("/api/games", { data: { activityLabel: `QA host ${randomUUID()}`, date: FUTURE, time: "12:00", capacity: 6, locationText: "Synthetic QA venue", priceCents: 0, ...input } });
  expect(created.status()).toBe(201);
  const id = (await created.json()).id as string;
  for (const [table, column] of [["games", "id"], ["game_participants", "game_id"], ["game_updates", "game_id"], ["listing_attributes", "listing_id"], ["notifications", "listing_id"], ["waitlist_entries", "listing_id"]]) f.track(table, column, id);
  return id;
}

test("STAGE-B-HOST-MUTATIONS: another host or a participant cannot manage, price, cancel or message a host's activity", async ({ playwright }) => {
  await withActors(playwright, ["QA_HOST", "QA_HOST_B", "QA_USER_B"], async (f) => {
    const game = await hostGame(f, { visibility: "public", lifecycle: "active" });
    await f.connection.execute("INSERT INTO game_participants (game_id, resident_id, status, payment_status, stripe_session_id) VALUES (?, ?, 'joined', 'paid', ?)", [game, personas.QA_USER_B.id, `cs_test_qa_${randomUUID()}`]);
    const [entry] = await f.connection.execute<any>("INSERT INTO waitlist_entries (listing_type, listing_id, client_id, name, email) VALUES ('game', ?, ?, 'QA waiting', 'qa_waitlist@example.test')", [game, randomUUID()]);
    const code = `QAHB${randomUUID().slice(0, 8).toUpperCase()}`;
    f.track("coupons", "code", code);
    expect((await f.actors.QA_HOST.post("/api/games/coupons", { data: { code, kind: "percent", amount: 10, gameId: game } })).status()).toBe(201);
    const [coupon] = await f.connection.query<any[]>("SELECT id FROM coupons WHERE code = ?", [code]);
    const invariants = await Promise.all([
      f.snapshot("SELECT * FROM games WHERE id = ?", [game]),
      f.snapshot("SELECT * FROM game_participants WHERE game_id = ? ORDER BY id", [game]),
      f.snapshot("SELECT * FROM game_updates WHERE game_id = ? ORDER BY id", [game]),
      f.snapshot("SELECT * FROM waitlist_entries WHERE listing_id = ? ORDER BY id", [game]),
      f.snapshot("SELECT * FROM coupons WHERE eligible_listing_id = ? ORDER BY id", [game]),
      f.snapshot("SELECT COUNT(*) AS n FROM notifications WHERE listing_id = ?", [game]),
    ]);
    const statuses: number[] = [];
    for (const role of ["QA_HOST_B", "QA_USER_B"]) {
      const X: APIRequestContext = f.actors[role];
      const cases: [() => ReturnType<APIRequestContext["post"]>, number[], string][] = [
        [() => X.post(`/api/games/${game}/cancel`, { data: { reason: "Forbidden" } }), [403], "cancel"],
        [() => X.post(`/api/games/${game}/updates`, { data: { message: "Forbidden" } }), [403], "host update"],
        [() => X.post(`/api/games/${game}/participants/${personas.QA_USER_B.id}/remove`), [403], "remove participant"],
        [() => X.post(`/api/games/${game}/participants/${personas.QA_USER_B.id}/check-in`), [403], "host check-in"],
        [() => X.post(`/api/games/${game}/participants/${personas.QA_USER_B.id}/refund`), [403], "refund before provider"],
        [() => X.get(`/api/games/${game}/participants/manage`), [403], "manage roster"],
        [() => X.get(`/api/games/${game}/waitlist`), [403], "waitlist read"],
        [() => X.post(`/api/games/${game}/waitlist/${Number(entry.insertId)}/offer`), [403], "waitlist offer"],
        [() => X.post("/api/games/coupons", { data: { code: `QAX${randomUUID().slice(0, 8)}`, kind: "fixed", amount: 100, gameId: game } }), [403], "coupon on foreign game"],
        [() => X.put(`/api/games/coupons/${coupon[0].id}/active`, { data: { active: false } }), [404], "foreign coupon toggle"],
        [() => X.put(`/api/games/${game}`, { data: { activityLabel: "Forbidden", date: FUTURE, time: "13:00", capacity: 1, priceCents: 9999, locationText: "Forbidden", hostResidentId: role === "QA_HOST_B" ? personas.QA_HOST_B.id : personas.QA_USER_B.id } }), [403], "capacity/pricing edit"],
        [() => X.post(`/api/games/${game}/lifecycle`, { data: { lifecycle: "paused" } }), [403], "publication state"],
      ];
      for (const [response, allowed, label] of cases) {
        const status = (await response()).status();
        statuses.push(status);
        expect(allowed, `${role} ${label}`).toContain(status);
        for (const unchanged of invariants) await unchanged();
      }
    }
    // Owner positive control + server-derived ownership on update.
    expect((await f.actors.QA_HOST.put(`/api/games/${game}`, { data: { activityLabel: "QA host renamed", date: FUTURE, time: "12:00", capacity: 8, priceCents: 0, locationText: "Synthetic QA venue", hostResidentId: personas.QA_HOST_B.id, host_resident_id: personas.QA_HOST_B.id } })).status()).toBe(200);
    const [row] = await f.connection.query<any[]>("SELECT host_resident_id, capacity FROM games WHERE id = ?", [game]);
    expect(row[0].host_resident_id === personas.QA_HOST.id && Number(row[0].capacity) === 8).toBe(true);
    await evidence("stage-b-host-mutations", { deniedStatuses: statuses, ownerUpdateServerDerived: true });
  });
});

test("STAGE-B-HOST-PRIVATE: private and draft activities are not readable through detail, calendar, next-steps or management", async ({ playwright }) => {
  await withActors(playwright, ["QA_HOST", "QA_HOST_B"], async (f) => {
    const invite = await hostGame(f, { visibility: "invite", lifecycle: "active", meetingInstructions: "QA secret meeting point" });
    const draft = await hostGame(f, { visibility: "public", lifecycle: "draft" });
    const live = await hostGame(f, { visibility: "public", lifecycle: "active", meetingInstructions: "QA joined-only meeting point" });
    for (const id of [invite, draft]) {
      expect((await f.actors.QA_HOST_B.get(`/api/games/${id}`)).status()).toBe(404);
      expect((await f.actors.QA_HOST_B.get(`/api/games/${id}/ics`)).status()).toBe(404);
      expect((await f.actors.QA_HOST_B.get(`/api/games/${id}/next-steps`)).status()).toBe(404);
      expect((await f.actors.QA_HOST_B.get(`/api/games/${id}/participants/manage`)).status()).toBe(403);
      expect((await f.actors.QA_HOST.get(`/api/games/${id}`)).status()).toBe(200);
    }
    // Public detail withholds joined-only meeting instructions from non-participants.
    const liveDetail = await (await f.actors.QA_HOST_B.get(`/api/games/${live}`)).json();
    expect(liveDetail.meetingInstructions).toBeNull();
    const mine = ((await (await f.actors.QA_HOST_B.get("/api/games/mine")).json()) as { id: string }[]).map((g) => g.id);
    expect(mine.some((id) => [invite, draft, live].includes(id))).toBe(false);
    const earnings = await (await f.actors.QA_HOST_B.get("/api/games/host/insights")).text();
    expect([invite, draft, live].some((id) => earnings.includes(id))).toBe(false);
  });
});
