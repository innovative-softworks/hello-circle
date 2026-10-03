import { randomUUID } from "node:crypto";
import type { APIRequestContext } from "@playwright/test";
import { test, expect, personas, env } from "../fixtures";
import { withActors, evidence } from "../authorization-fixture";
import { closureGame } from "../closure-fixture";
import { centreFor, programFor, experienceFor, clubFor, staffLogin } from "../stage-b-fixture";

test("CLOSURE-CHAT: game, experience, programme and club enforce runtime membership and message parent", async ({ playwright }) => {
  test.setTimeout(60_000);
  const opened: APIRequestContext[] = [];
  try {
  await withActors(playwright, ["QA_HOST", "QA_USER", "QA_USER_B", "QA_VENDOR", "QA_VENDOR_B", "GUEST"], async f => {
    const manager = await staffLogin(playwright, f, "QA_VENDOR", "centre_manager", opened);
    const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Dublin", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(Date.now() + 3600000));
    const p = (name: string) => parts.find(p => p.type === name)!.value;
    const date = `${p("year")}-${p("month")}-${p("day")}`, time = `${p("hour")}:${p("minute")}`;
    const scopes: { type: string; ids: string[]; owner: string; revoke: () => Promise<unknown> }[] = [];
    const games: string[] = [], experiences: string[] = [], programs: string[] = [], clubs: string[] = [];
    for (const role of ["QA_USER", "QA_USER_B"]) {
      const vendor = role === "QA_USER" ? "QA_VENDOR" : "QA_VENDOR_B";
      const game = await closureGame(f, { date, time }); games.push(game);
      await f.connection.execute("INSERT INTO game_participants (game_id, resident_id) VALUES (?, ?)", [game, personas[role].id]);
      const experience = await experienceFor(f, vendor), session = randomUUID(); experiences.push(session);
      await f.connection.execute("INSERT INTO experience_sessions (id, experience_id, date, time) VALUES (?, ?, ?, ?)", [session, experience, date, time]);
      await f.connection.execute("INSERT INTO experience_bookings (ref, experience_id, session_id, client_id, resident_id, participant_name, email, total_cents, payment_status) VALUES (?, ?, ?, ?, ?, 'QA chat', ?, 0, 'paid')", [randomUUID(), experience, session, randomUUID(), personas[role].id, env[`${role}_EMAIL`]]);
      const centre = await centreFor(f, vendor), program = await programFor(f, vendor, centre.id); programs.push(program);
      await f.connection.execute("INSERT INTO program_enrollments (ref, program_id, client_id, resident_id, participant_name, email, total_cents, payment_status) VALUES (?, ?, ?, ?, 'QA chat', ?, 0, 'paid')", [randomUUID(), program, randomUUID(), personas[role].id, env[`${role}_EMAIL`]]);
      const club = await clubFor(f, vendor); clubs.push(club);
      await f.connection.execute(`INSERT INTO registrations (ref, client_id, club_id, resident_id, team, child_first, child_last, dob, g_first, g_last, email, phone, address, ec_name, ec_phone, ec_rel, medical, consent, trial, total_cents, payment_status)
        VALUES (?, ?, ?, ?, 'QA', 'QA', 'QA', '', 'QA', 'QA', ?, '', '', '', '', '', '', 1, 0, 0, 'paid')`, [randomUUID(), randomUUID(), club, personas[role].id, env[`${role}_EMAIL`]]);
    }
    scopes.push(
      { type: "game", ids: games, owner: "QA_HOST", revoke: () => f.connection.execute("UPDATE game_participants SET status = 'cancelled' WHERE game_id = ? AND resident_id = ?", [games[0], personas.QA_USER.id]) },
      { type: "experience_session", ids: experiences, owner: "QA_VENDOR", revoke: () => f.connection.execute("UPDATE experience_bookings SET status = 'cancelled' WHERE session_id = ?", [experiences[0]]) },
      { type: "program", ids: programs, owner: "QA_VENDOR", revoke: () => f.connection.execute("UPDATE program_enrollments SET status = 'cancelled' WHERE program_id = ?", [programs[0]]) },
      { type: "club", ids: clubs, owner: "QA_VENDOR", revoke: () => f.connection.execute("UPDATE registrations SET status = 'cancelled' WHERE club_id = ?", [clubs[0]]) },
    );
    for (const scope of scopes) {
      for (const id of scope.ids) { f.track("chat_messages", "scope_id", id); f.track("chat_reads", "scope_id", id); }
      const url = (id: string) => `/api/chat/${scope.type}/${id}/messages`;
      if (scope.type !== "game") {
        expect((await manager.context.get(url(scope.ids[0]))).status()).toBe(200);
        expect((await manager.context.post(url(scope.ids[0]), { data: { body: "QA manager message" } })).status()).toBe(201);
      }
      for (const [role, id] of [["QA_USER", scope.ids[0]], ["QA_USER_B", scope.ids[1]], [scope.owner, scope.ids[0]]]) {
        expect((await f.actors[role].get(url(id))).status(), `${scope.type} member read`).toBe(200);
        const posted = await f.actors[role].post(url(id), { data: { body: "Synthetic QA message" } });
        expect(posted.status(), `${scope.type} member write`).toBe(201);
        const message = (await posted.json()).id;
        f.track("reports", "target_id", message);
      }
      const [messages] = await f.connection.query<any[]>("SELECT id FROM chat_messages WHERE scope_type = ? AND scope_id = ? ORDER BY id", [scope.type, scope.ids[0]]);
      const checks = await Promise.all([
        f.snapshot("SELECT * FROM chat_messages WHERE scope_id IN (?, ?) ORDER BY id", scope.ids),
        f.snapshot("SELECT * FROM chat_reads WHERE scope_id IN (?, ?) ORDER BY reader_key, scope_id", scope.ids),
        f.snapshot("SELECT * FROM reports WHERE target_type = 'chat_message' ORDER BY id", []),
      ]);
      for (const role of ["QA_USER_B", "QA_VENDOR_B", "GUEST"]) {
        const actor = f.actors[role], expected = role === "GUEST" ? 401 : 403;
        expect((await actor.get(url(scope.ids[0]))).status()).toBe(expected);
        expect((await actor.post(url(scope.ids[0]), { data: { body: "Forbidden" } })).status()).toBe(expected);
        // Report derives the real parent from the message, not supplied B IDs.
        expect((await actor.post(`/api/chat/messages/${messages[0].id}/report`, { data: { reason: "QA", scopeId: scope.ids[1], scopeType: scope.type } })).status()).toBe(expected);
        for (const check of checks) await check();
      }
      expect((await f.actors.QA_USER.post(`/api/chat/messages/${messages[0].id}/report`, { data: { reason: "Synthetic QA" } })).status()).toBe(201);
      await scope.revoke();
      expect((await f.actors.QA_USER.get(url(scope.ids[0]))).status()).toBe(403);
      expect((await f.actors.QA_USER.post(url(scope.ids[0]), { data: { body: "After revocation" } })).status()).toBe(403);
      await checks[0](); await checks[1]();
    }
    const privateGame = await closureGame(f, { date, time });
    expect((await f.actors.QA_USER_B.get(`/api/games/${privateGame}`)).status()).toBe(404);
    expect((await f.actors.QA_USER_B.get(`/api/chat/game/${privateGame}/messages`)).status()).toBe(403);
    expect((await f.actors.QA_USER_B.post(`/api/chat/game/${privateGame}/messages`, { data: { body: "Forbidden" } })).status()).toBe(403);
    expect((await f.actors.QA_USER_B.get(`/api/games/${privateGame}`)).status()).toBe(404);
    await evidence("closure-chat", { scopesCovered: 4, parentMessageSubstitutionDenied: true, deniedWritesUnchanged: true, cancelledEntitlementDenied: true, providerCalled: false });
  });
  } finally { for (const context of opened) await context.dispose(); }
});
