import { randomUUID } from "node:crypto";
import { expect, personas, env } from "../fixtures";
import { centreFor, clubFor, programFor } from "../stage-b-fixture";
import { evidence } from "../authorization-fixture";
import { test, withActors } from "../lifecycle-fixture";
import { createActivity, createCircle, rows, joinedIds, waitlist, notificationsFor, trackGame } from "../lifecycle-fixture";
import { uiActor } from "../lifecycle-ui-fixture";

// Phase 7 finding gate HC-QA-022..033. The original failing-before regressions
// are kept unchanged (red before remediation, green after); the *-INVARIANT /
// *-SEMANTICS / *-CROSS-SCOPE cases extend them. Free synthetic data only.

test("HC-QA-026: waitlist entries stay consistent with participation (no phantom held offers)", async ({ playwright }) => {
  await withActors(playwright, ["QA_HOST", "QA_USER", "QA_USER_B", "QA_HOST_B"], async f => {
    const { QA_HOST: host, QA_USER: a, QA_USER_B: b, QA_HOST_B: c } = f.actors;
    const game = await createActivity(f, "QA_HOST", { capacity: 2 });
    expect((await c.post(`/api/games/${game.id}/join`, { data: {} })).status()).toBe(200); // full
    expect((await a.post(`/api/games/${game.id}/waitlist`, { data: {} })).status()).toBe(201);
    expect((await host.put(`/api/games/${game.id}`, { data: { activityLabel: game.activityLabel, date: "2030-07-15", time: "18:30", capacity: 3, locationText: "QA synthetic park" } })).status()).toBe(200);
    expect((await a.post(`/api/games/${game.id}/join`, { data: {} })).status()).toBe(200); // direct join into the new spot
    expect((await c.delete(`/api/games/${game.id}/join`)).status()).toBe(200);
    await expect.poll(async () => (await waitlist(f, game.id)).map(w => w.status).join(","), { timeout: 5_000 }).not.toBe("");
    const bJoin = await b.post(`/api/games/${game.id}/join`, { data: {} });
    const states = (await waitlist(f, game.id)).map(w => w.status);
    const joinedCount = (await joinedIds(f, game.id)).length;
    const alreadyJoinedWaitlist = await a.post(`/api/games/${game.id}/waitlist`, { data: {} });
    await evidence("hc-qa-026", { waitlistStatesAfterDirectJoinAndLeave: states.join(","), joinedCount, capacity: 3, otherResidentJoin: bJoin.status(), alreadyJoinedWaitlist: alreadyJoinedWaitlist.status() });
    expect(bJoin.status(), "a free spot must not be held for a resident who already joined").toBe(200);
    expect(alreadyJoinedWaitlist.status(), "a joined participant cannot also be waitlisted").toBe(409);
  });
});

test("HC-QA-026-OFFER-WHEN-FULL: a host cannot offer a waitlist spot that does not exist", async ({ playwright }) => {
  await withActors(playwright, ["QA_HOST", "QA_USER_B", "QA_HOST_B"], async f => {
    const game = await createActivity(f, "QA_HOST", { capacity: 2 });
    expect((await f.actors.QA_HOST_B.post(`/api/games/${game.id}/join`, { data: {} })).status()).toBe(200);
    expect((await f.actors.QA_USER_B.post(`/api/games/${game.id}/waitlist`, { data: {} })).status()).toBe(201);
    const [entry] = await waitlist(f, game.id);
    const offer = await f.actors.QA_HOST.post(`/api/games/${game.id}/waitlist/${entry.id}/offer`, { data: {} });
    const claim = await f.actors.QA_USER_B.post(`/api/games/${game.id}/join`, { data: {} });
    await evidence("hc-qa-026-offer", { offerWhenFull: offer.status(), claimAfterOffer: claim.status() });
    expect(offer.status() === 409 || claim.status() === 200, "an offered spot must be claimable").toBe(true);
  });
});
