import { randomUUID } from "node:crypto";
import { test, expect, personas } from "../fixtures";
import { withActors, evidence } from "../authorization-fixture";
import { residentCircle, type Scope } from "../stage-b-fixture";

async function game(f: Scope, input: Record<string, unknown>) {
  const response = await f.actors.QA_HOST.post("/api/games", { data: {
    activityLabel: `QA join boundary ${randomUUID()}`, date: "2030-06-20", time: "12:00",
    capacity: 12, locationText: "Synthetic QA venue", priceCents: 0,
    visibility: "public", lifecycle: "active", ...input,
  } });
  expect(response.status()).toBe(201);
  const id = (await response.json()).id as string;
  for (const [table, column] of [["games", "id"], ["game_participants", "game_id"], ["waitlist_entries", "listing_id"], ["listing_attributes", "listing_id"], ["notifications", "listing_id"], ["invitations", "entity_id"]]) f.track(table, column, id);
  return id;
}

async function invariants(f: Scope, id: string) {
  const checks = await Promise.all([
    f.snapshot("SELECT * FROM games WHERE id = ?", [id]),
    f.snapshot("SELECT * FROM game_participants WHERE game_id = ? ORDER BY id", [id]),
    f.snapshot("SELECT * FROM waitlist_entries WHERE listing_type = 'game' AND listing_id = ? ORDER BY id", [id]),
    f.snapshot("SELECT * FROM invitations WHERE entity_type = 'game' AND entity_id = ? ORDER BY id", [id]),
    f.snapshot("SELECT * FROM notifications WHERE listing_id = ? ORDER BY id", [id]),
    f.snapshot("SELECT * FROM analytics_events WHERE JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.gameId')) = ? ORDER BY id", [id]),
    f.snapshot("SELECT * FROM audit_log WHERE object_id = ? ORDER BY id", [id]),
    f.snapshot("SELECT * FROM residents WHERE id IN (?, ?, ?) ORDER BY id", [personas.QA_HOST.id, personas.QA_USER.id, personas.QA_USER_B.id]),
    // Isolated QA only; read-only complete snapshots also catch unexpected
    // writes outside the activity relationship. Values are never reported.
    ...["bookings", "registrations", "program_enrollments", "experience_bookings", "sessions", "guest_sessions", "circle_members"].map(table => f.snapshot(`SELECT * FROM ${table} ORDER BY 1`, [])),
  ]);
  return async () => { for (const check of checks) await check(); };
}

for (const operation of ["waitlist", "join"] as const) {
  test(`HC-QA-016-${operation}: canonical visibility matrix and no denied side effects`, async ({ playwright }) => {
    await withActors(playwright, ["QA_HOST", "QA_USER", "QA_USER_B"], async f => {
      const circle = await residentCircle(f, "QA_HOST");
      await f.connection.execute("INSERT INTO circle_members (circle_id, resident_id, role) VALUES (?, ?, 'member')", [circle, personas.QA_USER.id]);
      const cases: [string, Record<string, unknown>, boolean, boolean][] = [
        ["public", {}, true, true],
        ["invite", { visibility: "invite" }, true, false],
        ["circle", { visibility: "circle", circleId: circle }, true, false],
        ["draft", { lifecycle: "draft" }, false, false],
        ["scheduled", { publishAt: "2030-06-19 12:00:00" }, false, false],
      ];
      for (const [name, input, eligible, outsider] of cases) {
        const id = await game(f, input);
        if (name === "invite") await f.connection.execute("INSERT INTO invitations (id, token, entity_type, entity_id, inviter_resident_id, invitee_resident_id, expires_at) VALUES (?, ?, 'game', ?, ?, ?, DATE_ADD(NOW(), INTERVAL 1 DAY))", [randomUUID(), randomUUID(), id, personas.QA_HOST.id, personas.QA_USER.id]);
        for (const [role, allowed] of [["QA_USER_B", outsider], ["QA_USER", eligible]] as const) {
          const actor = f.actors[role];
          expect((await actor.get(`/api/games/${id}`)).status()).toBe(allowed ? 200 : 404);
          const unchanged = await invariants(f, id);
          const response = await actor.post(`/api/games/${id}/${operation}`, { data: {} });
          await evidence(`hc-qa-016-${operation}-${name}-${role.toLowerCase().replaceAll("_", "-")}`, { allowed, status: response.status(), paymentUsed: false });
          expect(response.status(), `${operation} ${name} ${role}`).toBe(allowed ? (operation === "join" ? 200 : 201) : 404);
          if (!allowed) { expect(await response.json()).toEqual({ error: "Session not found" }); await unchanged(); }
          expect((await actor.get(`/api/games/${id}`)).status()).toBe(allowed ? 200 : 404);
          if (allowed) {
            const [rows] = await f.connection.query<any[]>(operation === "join"
              ? "SELECT id FROM game_participants WHERE game_id = ? AND resident_id = ? AND status = 'joined'"
              : "SELECT id FROM waitlist_entries WHERE listing_type = 'game' AND listing_id = ? AND resident_id = ? AND status = 'waiting'", [id, personas[role].id]);
            expect(rows.length).toBe(1);
          }
        }
        expect((await f.actors.QA_HOST.get(`/api/games/${id}`)).status()).toBe(200);
      }
      // Former member without any activity relationship cannot regain eligibility.
      await f.connection.execute("DELETE FROM circle_members WHERE circle_id = ? AND resident_id = ?", [circle, personas.QA_USER.id]);
      const id = await game(f, { visibility: "circle", circleId: circle });
      const unchanged = await invariants(f, id);
      expect((await f.actors.QA_USER.post(`/api/games/${id}/${operation}`, { data: {} })).status()).toBe(404);
      await unchanged();
    });
  });
}

test("HC-QA-016-paid-concurrent: denied paid boundary and one logical free participant", async ({ playwright }) => {
  await withActors(playwright, ["QA_HOST", "QA_USER_B"], async f => {
    const outbound = async () => (await f.actors.QA_USER_B.get("/api/__qa/outbound")).json();
    expect(await outbound()).toEqual({ blockedOutboundAttempts: 0, paymentProviderConfigured: false });
    const paid = await game(f, { visibility: "invite", priceCents: 1000 });
    const unchanged = await invariants(f, paid);
    expect((await f.actors.QA_USER_B.post(`/api/games/${paid}/join`, { data: { couponCode: "QA_INVALID" } })).status()).toBe(404);
    await unchanged();
    expect(await outbound()).toEqual({ blockedOutboundAttempts: 0, paymentProviderConfigured: false });
    await f.connection.execute("INSERT INTO invitations (id, token, entity_type, entity_id, inviter_resident_id, invitee_resident_id, expires_at) VALUES (?, ?, 'game', ?, ?, ?, DATE_ADD(NOW(), INTERVAL 1 DAY))", [randomUUID(), randomUUID(), paid, personas.QA_HOST.id, personas.QA_USER_B.id]);
    const beforeAuthorized = await invariants(f, paid);
    const localBoundary = await f.actors.QA_USER_B.post(`/api/games/${paid}/join`, { data: {} });
    expect(localBoundary.status()).toBe(503);
    expect(await localBoundary.json()).toEqual({ error: "Payments aren't configured yet" });
    await beforeAuthorized();
    expect(await outbound()).toEqual({ blockedOutboundAttempts: 0, paymentProviderConfigured: false });
    const free = await game(f, {});
    const responses = await Promise.all([1, 2].map(() => f.actors.QA_USER_B.post(`/api/games/${free}/join`, { data: {} })));
    expect(responses.map(r => r.status()).sort()).toEqual([200, 409]);
    const [rows] = await f.connection.query<any[]>("SELECT id FROM game_participants WHERE game_id = ? AND resident_id = ?", [free, personas.QA_USER_B.id]);
    expect(rows.length).toBe(1);
    await evidence("hc-qa-016-paid-concurrent", { unauthorizedStatus: 404, authorizedBoundary: 503, providerConfigured: false, concurrentStatuses: responses.map(r => r.status()).sort(), participantCount: rows.length });
  });
});
