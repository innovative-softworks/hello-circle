import { expect, personas } from "../fixtures";
import { evidence } from "../authorization-fixture";
import { test, withActors } from "../lifecycle-fixture";
import { createActivity, createCircle, rows, joinedIds, waitlist, notificationsFor, hrefOf, ids, inSurfaces, publicSurfaces } from "../lifecycle-fixture";

// Phase 7 — Parts 10-11. HC-QA-016/017/018 behaviour must hold throughout.

async function invite(f: any, game: string, role: string) {
  const r = await f.actors.QA_HOST.post("/api/invitations", { data: { entityType: "game", entityId: game, inviteeResidentIds: [personas[role].id] } });
  expect(r.status(), "real invitation workflow").toBe(201);
  const [row] = await rows(f, "SELECT id, status FROM invitations WHERE entity_type = 'game' AND entity_id = ? AND invitee_resident_id = ?", [game, personas[role].id]);
  return row as { id: string; status: string };
}

async function denied(actor: any, game: string) {
  for (const suffix of ["", "/participants", "/updates"]) expect((await actor.get(`/api/games/${game}${suffix}`)).status(), `read ${suffix}`).toBe(404);
  for (const action of ["join", "waitlist"]) expect((await actor.post(`/api/games/${game}/${action}`, { data: {} })).status(), action).toBe(404);
  expect(await ids(actor, "/api/games")).not.toContain(game);
}

test("LC-ACT-INVITE-ONLY: invitation, accept, decline, re-invite and expiry", async ({ playwright }) => {
  await withActors(playwright, ["QA_HOST", "QA_USER", "QA_USER_B"], async f => {
    const { QA_USER: userA, QA_USER_B: userB } = f.actors;
    const game = await createActivity(f, "QA_HOST", { visibility: "invite" });
    await denied(userB, game.id);
    await denied(userA, game.id); // no relationship yet
    expect(inSurfaces((await publicSurfaces(userB, personas.QA_HOST.id)).surfaces, game.id)).toEqual({ list: false, hostProfile: false });

    const inv = await invite(f, game.id, "QA_USER");
    expect(inv.status).toBe("pending");
    const mine = await (await userA.get("/api/invitations/mine")).json();
    expect(mine.map((i: any) => i.id)).toContain(inv.id);
    const note = (await notificationsFor(f, "QA_USER", game.id)).filter(n => n.kind === "invite");
    expect(note.length).toBe(1);
    expect(hrefOf(note[0])).toBe(`/games/${game.id}`);
    expect((await userA.get(`/api/games/${game.id}`)).status()).toBe(200);
    await denied(userB, game.id); // unrelated user unaffected by A's invitation
    expect((await userA.post(`/api/invitations/${inv.id}/respond`, { data: { response: "accepted" } })).status()).toBe(200);
    expect((await rows(f, "SELECT status FROM invitations WHERE id = ?", [inv.id]))[0].status).toBe("accepted");
    expect((await notificationsFor(f, "QA_HOST", game.id)).filter(n => n.kind === "invite").length).toBe(1);
    expect((await userA.post(`/api/games/${game.id}/join`, { data: {} })).status()).toBe(200);
    expect(await joinedIds(f, game.id)).toEqual([personas.QA_HOST.id, personas.QA_USER.id].sort());
    expect((await userA.post(`/api/invitations/${inv.id}/respond`, { data: { response: "declined" } })).status()).toBe(409); // single use
    // Invitation is not the only relationship once joined.
    expect((await userA.get(`/api/games/${game.id}`)).status()).toBe(200);

    // Decline → no access (HC-QA-017), then re-invite restores a pending invitation.
    const g2 = await createActivity(f, "QA_HOST", { visibility: "invite" });
    const inv2 = await invite(f, g2.id, "QA_USER");
    expect((await userA.post(`/api/invitations/${inv2.id}/respond`, { data: { response: "declined" } })).status()).toBe(200);
    await denied(userA, g2.id);
    expect((await userA.get("/api/invitations/mine")).ok()).toBe(true);
    expect((await (await userA.get("/api/invitations/mine")).json()).map((i: any) => i.id)).not.toContain(inv2.id);
    const again = await invite(f, g2.id, "QA_USER");
    expect(again).toMatchObject({ id: inv2.id, status: "pending" });
    expect((await userA.get(`/api/games/${g2.id}`)).status()).toBe(200);

    // Expiry via the safe test control used by the security gate: expire only
    // this test-created invitation row. Expired → no visibility or response.
    const g3 = await createActivity(f, "QA_HOST", { visibility: "invite" });
    const inv3 = await invite(f, g3.id, "QA_USER");
    expect((await userA.get(`/api/games/${g3.id}`)).status()).toBe(200);
    await f.connection.execute("UPDATE invitations SET expires_at = DATE_SUB(NOW(), INTERVAL 1 MINUTE) WHERE id = ?", [inv3.id]);
    await denied(userA, g3.id);
    expect((await userA.post(`/api/invitations/${inv3.id}/respond`, { data: { response: "accepted" } })).status()).toBe(409);
    expect((await (await userA.get("/api/invitations/mine")).json()).map((i: any) => i.id)).not.toContain(inv3.id);
    expect(await waitlist(f, g3.id)).toEqual([]);
    // Revocation: no product route exists for a host to revoke a sent activity invitation.
    const revoke = await f.actors.QA_HOST.delete(`/api/invitations/${inv3.id}`);
    await evidence("lc-act-invite-only", { outsiderDenied: true, invitedVisible: true, acceptedJoined: true, declineRemovesAccess: true, reinviteRestoresPending: true, expiryRemovesAccess: true, revokeRouteStatus: revoke.status() });
  });
});

test("LC-ACT-CIRCLE-ONLY: member eligibility, non-member denial and removal follows current membership", async ({ playwright }) => {
  await withActors(playwright, ["QA_HOST", "QA_USER", "QA_USER_B"], async f => {
    const { QA_HOST: organiser, QA_USER: member, QA_USER_B: outsider } = f.actors;
    const circle = await createCircle(f, "QA_HOST", { joinMode: "invite" });
    // Membership through the real organiser-invite → accept workflow.
    expect((await organiser.post(`/api/circles/${circle.id}/invite`, { data: { residentId: personas.QA_USER.id } })).status()).toBe(201);
    const [ci] = await rows(f, "SELECT id FROM circle_invites WHERE circle_id = ? AND resident_id = ?", [circle.id, personas.QA_USER.id]);
    expect((await member.post(`/api/circles/invitations/${ci.id}/respond`, { data: { accept: true } })).status()).toBe(200);

    // HC-QA-014: only the organiser attaches an official Circle activity.
    const memberAttach = await member.post("/api/games", { data: { activityLabel: "QA member attach", date: "2030-07-15", time: "10:00", capacity: 5, locationText: "x", circleId: circle.id, visibility: "circle" } });
    expect(memberAttach.status()).toBe(403);
    const game = await createActivity(f, "QA_HOST", { circleId: circle.id, visibility: "circle" });
    expect(game).toMatchObject({ circleId: circle.id, visibility: "circle" });
    const [dbGame] = await rows(f, "SELECT circle_id FROM games WHERE id = ?", [game.id]);
    expect(dbGame.circle_id).toBe(circle.id); // authoritative ID, not a label

    expect((await member.get(`/api/games/${game.id}`)).status()).toBe(200);
    expect((await (await member.get(`/api/circles/${circle.id}/upcoming`)).json()).map((g: any) => g.id)).toContain(game.id);
    expect((await (await member.get(`/api/circles/${circle.id}`)).json()).nextPlan?.id).toBe(game.id);
    await denied(outsider, game.id);
    expect((await outsider.get(`/api/circles/${circle.id}/upcoming`)).status()).toBe(403);
    expect((await (await outsider.get(`/api/circles/${circle.id}`)).json()).nextPlan).toBeNull();
    expect((await member.post(`/api/games/${game.id}/join`, { data: {} })).status()).toBe(200);

    // Remove member → subsequent eligibility follows current membership.
    const game2 = await createActivity(f, "QA_HOST", { circleId: circle.id, visibility: "circle" });
    expect((await member.get(`/api/games/${game2.id}`)).status()).toBe(200);
    expect((await organiser.post(`/api/circles/${circle.id}/members/${personas.QA_USER.id}/remove`, { data: {} })).status()).toBe(200);
    await denied(member, game2.id);
    expect((await member.get(`/api/circles/${circle.id}/upcoming`)).status()).toBe(403);
    // Existing participation is an independent relationship (canonical policy).
    const stillParticipant = (await member.get(`/api/games/${game.id}`)).status();
    expect(stillParticipant).toBe(200);
    expect(await joinedIds(f, game.id)).toContain(personas.QA_USER.id);
    const removedNote = (await notificationsFor(f, "QA_USER", circle.id)).filter(n => n.title.startsWith("Removed:"));
    expect(removedNote.length).toBe(1);
    await evidence("lc-act-circle-only", { memberAttachDenied: 403, memberVisible: true, outsiderDenied: true, removedLosesNewEligibility: true, existingParticipationRetained: stillParticipant === 200 });
  });
});
