import { test, expect, personas } from "../fixtures";
import { withActors, evidence } from "../authorization-fixture";
import { closureGame, closureInvite } from "../closure-fixture";
import { residentCircle } from "../stage-b-fixture";

test("CLOSURE-REVOKE: requests after committed invitation or Circle revocation cannot reuse eligibility", async ({ playwright }) => {
  await withActors(playwright, ["QA_HOST", "QA_USER"], async f => {
    const statuses: number[] = [];
    for (const kind of ["invitation", "circle"]) {
      const circle = kind === "circle" ? await residentCircle(f, "QA_HOST") : null;
      if (circle) await f.connection.execute("INSERT INTO circle_members (circle_id, resident_id, role) VALUES (?, ?, 'member')", [circle, personas.QA_USER.id]);
      const game = await closureGame(f, circle ? { circleId: circle, visibility: "circle" } : {});
      const invite = circle ? null : await closureInvite(f, game);
      expect((await f.actors.QA_USER.get(`/api/games/${game}`)).status()).toBe(200);
      const [race] = await Promise.all([
        f.actors.QA_USER.post(`/api/games/${game}/waitlist`, { data: {} }),
        circle ? f.connection.execute("DELETE FROM circle_members WHERE circle_id = ? AND resident_id = ?", [circle, personas.QA_USER.id]) : f.connection.execute("DELETE FROM invitations WHERE id = ?", [invite!.id]),
      ]);
      statuses.push(race.status());
      expect([201, 404]).toContain(race.status()); // Either ordering is legitimate.
      const checks = await Promise.all([
        f.snapshot("SELECT * FROM games WHERE id = ?", [game]),
        f.snapshot("SELECT * FROM game_participants WHERE game_id = ? ORDER BY id", [game]),
        f.snapshot("SELECT * FROM waitlist_entries WHERE listing_id = ? ORDER BY id", [game]),
        f.snapshot("SELECT * FROM notifications WHERE listing_id = ? ORDER BY id", [game]),
      ]);
      for (const suffix of ["", "/participants", "/updates"]) expect((await f.actors.QA_USER.get(`/api/games/${game}${suffix}`)).status()).toBe(404);
      for (const action of ["join", "waitlist"]) expect((await f.actors.QA_USER.post(`/api/games/${game}/${action}`, { data: {} })).status()).toBe(404);
      for (const check of checks) await check();
    }
    await evidence("closure-revocation", { raceStatuses: statuses, postCommitReadAndMutationsDenied: true, databaseUnchangedAfterCommit: true });
  });
});

test("CLOSURE-INV-CONSUME: one pending invitation permits one concurrent response", async ({ playwright }) => {
  await withActors(playwright, ["QA_HOST", "QA_USER"], async f => {
    const game = await closureGame(f), invite = await closureInvite(f, game);
    const responses = await Promise.all([1, 2].map(() => f.actors.QA_USER.post(`/api/invitations/${invite.id}/respond`, { data: { response: "accepted" } })));
    const [notifications] = await f.connection.query<any[]>("SELECT id FROM notifications WHERE listing_id = ? AND kind = 'invite'", [game]);
    await evidence("closure-invitation-consumption", { statuses: responses.map(r => r.status()).sort(), notificationCount: notifications.length });
    expect(responses.map(r => r.status()).sort()).toEqual([200, 409]);
    expect(notifications.length).toBe(1);
    expect((await f.actors.QA_USER.post(`/api/invitations/${invite.id}/respond`, { data: { response: "accepted" } })).status()).toBe(409);
    const otherGame = await closureGame(f), other = await closureInvite(f, otherGame, { emailOnly: true });
    const tokenResponses = await Promise.all([1, 2].map(() => f.actors.QA_USER.post(`/api/invitations/token/${other.token}/respond`, { data: { response: "accepted" } })));
    expect(tokenResponses.map(r => r.status()).sort()).toEqual([200, 409]);
  });
});
