import { expect, personas } from "../fixtures";
import { evidence } from "../authorization-fixture";
import { test, withActors } from "../lifecycle-fixture";
import { createActivity, rows, participants, joinedIds, waitlist, notificationsFor, hrefOf, ids } from "../lifecycle-fixture";

// Phase 7 — Parts 6-9. Free activities only; Stripe never reached.

test("LC-ACT-JOIN-LEAVE: discover, join, duplicate, leave, host view and rejoin", async ({ playwright }) => {
  await withActors(playwright, ["QA_HOST", "QA_USER", "QA_USER_B"], async f => {
    const host = f.actors.QA_HOST, user = f.actors.QA_USER;
    const game = await createActivity(f, "QA_HOST", { capacity: 5 });
    // Part 6 — discover → detail → join → joined state.
    expect(await ids(user, "/api/games")).toContain(game.id);
    const before = await (await user.get(`/api/games/${game.id}`)).json();
    expect(before).toMatchObject({ joinedByMe: false, waitlistedByMe: false, joined: 1, spotsLeft: 4, meetingInstructions: null });
    expect((await user.post(`/api/games/${game.id}/join`, { data: {} })).status()).toBe(200);
    const after = await (await user.get(`/api/games/${game.id}`)).json(); // refresh
    expect(after).toMatchObject({ joinedByMe: true, joined: 2, spotsLeft: 3 });
    expect(await ids(user, "/api/games/mine")).toContain(game.id);
    const preview = await (await f.actors.QA_USER_B.get(`/api/games/${game.id}/participants`)).json();
    expect(preview.total).toBe(2);
    expect(preview.participants.map((p: any) => p.residentId)).toContain(personas.QA_USER.id);
    const manage = await (await host.get(`/api/games/${game.id}/participants/manage`)).json();
    expect(manage.find((p: any) => p.residentId === personas.QA_USER.id)).toMatchObject({ status: "joined" });
    expect((await user.get(`/api/games/${game.id}/participants/manage`)).status()).toBe(403);
    // Duplicate join: one participant row, clear conflict.
    const dup = await user.post(`/api/games/${game.id}/join`, { data: {} });
    expect(dup.status()).toBe(409);
    expect((await dup.json()).error).toBe("You've already joined this session");
    expect((await participants(f, game.id)).filter(p => p.resident_id === personas.QA_USER.id).length).toBe(1);

    // Part 7 — leave.
    expect((await user.delete(`/api/games/${game.id}/join`)).status()).toBe(200);
    expect((await participants(f, game.id)).find(p => p.resident_id === personas.QA_USER.id)?.status).toBe("cancelled");
    expect(await (await user.get(`/api/games/${game.id}`)).json()).toMatchObject({ joinedByMe: false, joined: 1, spotsLeft: 4 });
    expect(await ids(user, "/api/games/mine")).not.toContain(game.id);
    expect((await (await host.get(`/api/games/${game.id}/participants/manage`)).json()).find((p: any) => p.residentId === personas.QA_USER.id)).toMatchObject({ status: "cancelled" });
    expect((await (await f.actors.QA_USER_B.get(`/api/games/${game.id}/participants`)).json()).total).toBe(1);
    expect((await user.delete(`/api/games/${game.id}/join`)).status()).toBe(404); // second leave
    const hostNotesAfterLeave = await notificationsFor(f, "QA_HOST", game.id);
    // Rejoin reactivates the same row (UNIQUE(game_id, resident_id)).
    expect((await user.post(`/api/games/${game.id}/join`, { data: {} })).status()).toBe(200);
    const mine = (await participants(f, game.id)).filter(p => p.resident_id === personas.QA_USER.id);
    expect(mine).toEqual([{ resident_id: personas.QA_USER.id, status: "joined" }]);
    expect(await joinedIds(f, game.id)).toEqual([personas.QA_HOST.id, personas.QA_USER.id].sort());
    await evidence("lc-act-join-leave", { joined: true, duplicateStatus: 409, participantRows: mine.length, leaveApplied: true, rejoinReactivatedSameRow: true, hostNotificationsOnFreeLeave: hostNotesAfterLeave.length });
  });
});

test("LC-ACT-CAPACITY-WAITLIST: full state, waitlist, held offer, claim and capacity invariant", async ({ playwright }) => {
  await withActors(playwright, ["QA_HOST", "QA_USER", "QA_USER_B", "QA_HOST_B"], async f => {
    const { QA_HOST: host, QA_USER: userA, QA_USER_B: userB, QA_HOST_B: hostB } = f.actors;
    const game = await createActivity(f, "QA_HOST", { capacity: 3 });
    for (const actor of [userA, hostB]) expect((await actor.post(`/api/games/${game.id}/join`, { data: {} })).status()).toBe(200);
    // Part 8 — full.
    const full = await (await userB.get(`/api/games/${game.id}`)).json();
    expect(full).toMatchObject({ joined: 3, spotsLeft: 0, effectiveAvailability: "waitlist" });
    const rejected = await userB.post(`/api/games/${game.id}/join`, { data: {} });
    expect(rejected.status()).toBe(409);
    expect((await rejected.json()).error).toBe("This session is full");
    expect(await rows(f, "SELECT id FROM game_participants WHERE game_id = ? AND resident_id = ?", [game.id, personas.QA_USER_B.id])).toEqual([]);
    expect((await (await host.get(`/api/residents/${personas.QA_HOST.id}/host-profile`)).json()).upcomingGames.map((g: any) => g.id)).toContain(game.id);
    const fullNote = await notificationsFor(f, "QA_HOST", game.id);
    expect(fullNote.map(n => n.title)).toEqual([`Your session is full: ${game.activityLabel}`]);

    // Part 9 — waitlist.
    expect((await userB.post(`/api/games/${game.id}/waitlist`, { data: {} })).status()).toBe(201);
    expect((await (await userB.get(`/api/games/${game.id}`)).json()).waitlistedByMe).toBe(true);
    const dup = await userB.post(`/api/games/${game.id}/waitlist`, { data: {} });
    expect(dup.status()).toBe(409);
    expect((await waitlist(f, game.id)).filter(w => w.status === "waiting").map(w => w.resident_id)).toEqual([personas.QA_USER_B.id]);
    const hostList = await (await host.get(`/api/games/${game.id}/waitlist`)).json();
    expect(hostList.length).toBe(1);
    expect((await userA.get(`/api/games/${game.id}/waitlist`)).status()).toBe(403);

    // Free a place: automatic promotion to a time-limited held offer (implemented).
    expect((await userA.delete(`/api/games/${game.id}/join`)).status()).toBe(200);
    await expect.poll(async () => (await waitlist(f, game.id))[0]?.status, { timeout: 10_000 }).toBe("offered");
    const [offer] = await rows(f, "SELECT offer_expires_at FROM waitlist_entries WHERE listing_id = ? AND resident_id = ?", [game.id, personas.QA_USER_B.id]);
    expect(offer.offer_expires_at).toBeTruthy();
    const offerNote = (await notificationsFor(f, "QA_USER_B", game.id)).filter(n => n.kind === "waitlist");
    expect(offerNote.length).toBe(1);
    expect(hrefOf(offerNote[0])).toBe(`/games/${game.id}`);
    // Held spot: a non-offered resident cannot take it during the window.
    const blocked = await userA.post(`/api/games/${game.id}/join`, { data: {} });
    expect(blocked.status()).toBe(409);
    expect((await blocked.json()).error).toBe("This session is full");
    // Offered resident claims it.
    expect((await userB.post(`/api/games/${game.id}/join`, { data: {} })).status()).toBe(200);
    expect((await waitlist(f, game.id))[0].status).toBe("claimed");
    expect(await joinedIds(f, game.id)).toEqual([personas.QA_HOST.id, personas.QA_HOST_B.id, personas.QA_USER_B.id].sort());
    const [{ joined, capacity }] = await rows(f, "SELECT (SELECT COUNT(*) FROM game_participants WHERE game_id = g.id AND status = 'joined') AS joined, capacity FROM games g WHERE id = ?", [game.id]);
    expect(Number(joined)).toBeLessThanOrEqual(capacity);

    // Waitlist self-leave.
    expect((await userA.post(`/api/games/${game.id}/waitlist`, { data: {} })).status()).toBe(201);
    expect((await userA.delete(`/api/games/${game.id}/waitlist`)).status()).toBe(200);
    expect((await waitlist(f, game.id)).find(w => w.resident_id === personas.QA_USER.id)?.status).toBe("left");
    expect((await (await userA.get(`/api/games/${game.id}`)).json()).waitlistedByMe).toBe(false);

    // Observations recorded for the report (asserted separately in lifecycle-findings).
    const joinedWaitlist = await hostB.post(`/api/games/${game.id}/waitlist`, { data: {} });
    await evidence("lc-act-capacity-waitlist", { fullStatus: 409, waitlistCreated: 201, duplicateWaitlist: 409, autoPromotedToOffer: true, heldSpotBlockedOthers: true, claimed: true, capacityRespected: true, alreadyJoinedWaitlistStatus: joinedWaitlist.status() });
  });
});
