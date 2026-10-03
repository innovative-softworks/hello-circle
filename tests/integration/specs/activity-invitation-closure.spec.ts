import { test, expect, personas } from "../fixtures";
import { withActors, evidence } from "../authorization-fixture";
import { closureGame, closureInvite } from "../closure-fixture";

test("CLOSURE-INV-STATE: only live eligible invitation states grant private activity access", async ({ playwright }) => {
  await withActors(playwright, ["QA_HOST", "QA_USER", "QA_USER_B"], async f => {
    const failures: string[] = [];
    const statuses: number[] = [];
    // Actual persisted response states; expired is derived, not an invented state.
    for (const status of ["pending", "accepted", "maybe", "declined"]) {
      for (const expired of [false, true]) {
        const game = await closureGame(f);
        await closureInvite(f, game, { status, expired });
        const allowed = !expired && status !== "declined";
        const unchanged = await f.snapshot("SELECT * FROM game_participants WHERE game_id = ? ORDER BY id", [game]);
        for (const suffix of ["", "/participants", "/updates"]) {
          const result = await f.actors.QA_USER.get(`/api/games/${game}${suffix}`);
          statuses.push(result.status());
          if (result.status() !== (allowed ? 200 : 404)) failures.push(`${status}:${expired}:${suffix}`);
        }
        for (const action of ["waitlist", "join"]) {
          const result = await f.actors.QA_USER.post(`/api/games/${game}/${action}`, { data: {} });
          if (result.status() !== (allowed ? (action === "join" ? 200 : 201) : 404)) failures.push(`${status}:${expired}:${action}`);
        }
        if (!allowed && !failures.some(v => v.startsWith(`${status}:${expired}:`))) await unchanged();
      }
    }
    // No activity revoke API or revoked status exists: deletion is the actual
    // relationship-removal representation, staged only in isolated QA.
    const game = await closureGame(f), invite = await closureInvite(f, game);
    expect((await f.actors.QA_USER.get(`/api/games/${game}`)).status()).toBe(200);
    await f.connection.execute("DELETE FROM invitations WHERE id = ?", [invite.id]);
    expect((await f.actors.QA_USER.post(`/api/invitations/token/${invite.token}/respond`, { data: { response: "accepted" } })).status()).toBe(404);
    for (const suffix of ["", "/participants", "/updates"]) expect((await f.actors.QA_USER.get(`/api/games/${game}${suffix}`)).status()).toBe(404);
    for (const action of ["join", "waitlist"]) expect((await f.actors.QA_USER.post(`/api/games/${game}/${action}`, { data: {} })).status()).toBe(404);
    await evidence("closure-invitation-states", { violatingCases: failures.length, readStatuses: statuses, revokedByDeletionDenied: true });
    expect(failures, "Expired/declined invitations are not authorization").toEqual([]);
  });
});

test("CLOSURE-INV-BIND: email invitation cannot be claimed by a different authenticated identity", async ({ playwright }) => {
  await withActors(playwright, ["QA_HOST", "QA_USER", "QA_USER_B"], async f => {
    const game = await closureGame(f), invite = await closureInvite(f, game, { emailOnly: true });
    await f.connection.execute("UPDATE invitations SET invitee_email = CONCAT(' ', UPPER(invitee_email), ' ') WHERE id = ?", [invite.id]);
    const unchanged = await f.snapshot("SELECT * FROM invitations WHERE id = ?", [invite.id]);
    const untouched = await Promise.all([
      f.snapshot("SELECT * FROM residents WHERE id IN (?, ?) ORDER BY id", [personas.QA_USER.id, personas.QA_USER_B.id]),
      f.snapshot("SELECT * FROM guest_sessions ORDER BY token", []),
      f.snapshot("SELECT * FROM game_participants WHERE game_id = ? ORDER BY id", [game]),
      f.snapshot("SELECT * FROM notifications WHERE listing_id = ? ORDER BY id", [game]),
    ]);
    const result = await f.actors.QA_USER_B.post(`/api/invitations/token/${invite.token}/respond`, { data: { response: "accepted" } });
    const after = await f.actors.QA_USER_B.get(`/api/games/${game}`);
    await evidence("closure-invitation-binding", { responseStatus: result.status(), unrelatedDetailStatus: after.status() });
    expect(result.status()).toBe(403);
    await unchanged();
    for (const check of untouched) await check();
    expect(after.status()).toBe(404);
    const valid = await f.actors.QA_USER.post(`/api/invitations/token/${invite.token}/respond`, { data: { response: "accepted" } });
    expect(valid.status()).toBe(200);
    expect((await f.actors.QA_USER.get(`/api/games/${game}`)).status()).toBe(200);
    expect((await f.actors.QA_USER.post(`/api/invitations/token/${invite.token}/respond`, { data: { response: "accepted" } })).status()).toBe(409);
    const expiredGame = await closureGame(f), expired = await closureInvite(f, expiredGame, { expired: true });
    expect((await f.actors.QA_USER.post(`/api/invitations/token/${expired.token}/respond`, { data: { response: "accepted" } })).status()).toBe(409);
    for (const path of ["/api/invitations/mine", `/api/invitations/token/${invite.token}`]) {
      const body = await (await f.actors.QA_USER.get(path)).text();
      expect(body.includes(invite.token) || body.includes(expired.token), "Ordinary response contains no redemption credential").toBe(false);
    }
  });
});

test("CLOSURE-INV-CREATE: hidden activity cannot be shared into an unauthorized invitation relationship", async ({ playwright }) => {
  await withActors(playwright, ["QA_HOST", "QA_USER", "QA_USER_B"], async f => {
    const game = await closureGame(f);
    const unchanged = await f.snapshot("SELECT * FROM invitations WHERE entity_id = ?", [game]);
    const response = await f.actors.QA_USER_B.post("/api/invitations", { data: { entityType: "game", entityId: game, inviteeResidentIds: [personas.QA_USER.id] } });
    const detail = await f.actors.QA_USER.get(`/api/games/${game}`);
    await evidence("closure-invitation-creation", { createStatus: response.status(), recipientDetailStatus: detail.status() });
    expect(response.status()).toBe(404);
    expect(detail.status()).toBe(404);
    await unchanged();
    const legitimate = await f.actors.QA_HOST.post("/api/invitations", { data: { entityType: "game", entityId: game, inviteeResidentIds: [personas.QA_USER.id] } });
    expect(legitimate.status()).toBe(201);
    expect((await f.actors.QA_USER.get(`/api/games/${game}`)).status()).toBe(200);
  });
});
