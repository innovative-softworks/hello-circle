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

test("HC-QA-028-HOST-SELF-LEAVE: a host cannot leave their own activity (cancel instead)", async ({ playwright }) => {
  await withActors(playwright, ["QA_HOST"], async f => {
    const game = await createActivity(f, "QA_HOST");
    const leave = await f.actors.QA_HOST.delete(`/api/games/${game.id}/join`);
    await evidence("hc-qa-028-host-leave", { hostLeaveStatus: leave.status(), hostStillJoined: (await joinedIds(f, game.id)).includes(personas.QA_HOST.id) });
    expect(leave.status()).toBe(400); // same rule as POST /:id/participants/:self/remove
  });
});

test("HC-QA-028-INVARIANT: cancel fan-out once to participants and waitlist, surfaces updated, archive and host-leave rules", async ({ playwright }) => {
  await withActors(playwright, ["QA_HOST", "QA_USER", "QA_USER_B"], async f => {
    const { QA_HOST: host, QA_USER: participant, QA_USER_B: waiter } = f.actors;
    const circle = await createCircle(f, "QA_HOST", { joinMode: "open" });
    const game = await createActivity(f, "QA_HOST", { capacity: 2, circleId: circle.id });
    expect((await participant.post(`/api/games/${game.id}/join`, { data: {} })).status()).toBe(200);
    expect((await waiter.post(`/api/games/${game.id}/waitlist`, { data: {} })).status()).toBe(201);
    // Free leave by a participant never asks the host for a refund (HC-QA-027) — checked on a separate activity.
    const free = await createActivity(f, "QA_HOST");
    expect((await waiter.post(`/api/games/${free.id}/join`, { data: {} })).status()).toBe(200);
    expect((await waiter.delete(`/api/games/${free.id}/join`)).status()).toBe(200);
    expect(await notificationsFor(f, "QA_HOST", free.id)).toEqual([]);
    // Host cannot leave own activity; ownership seat intact.
    const leave = await host.delete(`/api/games/${game.id}/join`);
    expect(leave.status()).toBe(400);
    expect(await joinedIds(f, game.id)).toEqual([personas.QA_HOST.id, personas.QA_USER.id].sort());
    // Archive blocked while others have joined.
    expect((await host.post(`/api/games/${game.id}/lifecycle`, { data: { lifecycle: "archived" } })).status()).toBe(409);
    // Cancel: one notification each to participant and waitlisted resident; waitlist closed; surfaces updated.
    expect((await host.post(`/api/games/${game.id}/cancel`, { data: { reason: "QA rain" } })).status()).toBe(200);
    const again = await host.post(`/api/games/${game.id}/cancel`, { data: {} });
    expect(again.status()).toBe(200);
    expect((await again.json()).alreadyCancelled).toBe(true);
    const pNotes = (await notificationsFor(f, "QA_USER", game.id)).filter(n => n.title.startsWith("Cancelled:"));
    const wNotes = (await notificationsFor(f, "QA_USER_B", game.id)).filter(n => n.title.startsWith("Cancelled:"));
    expect([pNotes.length, wNotes.length]).toEqual([1, 1]);
    expect(pNotes[0].body).toContain("QA rain");
    expect((await waitlist(f, game.id)).map(w => w.status)).toEqual(["cancelled"]);
    const wDetail = await (await waiter.get(`/api/games/${game.id}`)).json();
    expect(wDetail).toMatchObject({ waitlistedByMe: false, effectiveLifecycle: "cancelled" });
    expect((await (await waiter.get("/api/games")).json()).map((g: any) => g.id)).not.toContain(game.id);
    expect((await (await waiter.get(`/api/residents/${personas.QA_HOST.id}/host-profile`)).json()).upcomingGames.map((g: any) => g.id)).not.toContain(game.id);
    expect((await (await waiter.get(`/api/circles/${circle.id}`)).json()).nextPlan?.id ?? null).not.toBe(game.id);
    expect((await waiter.post(`/api/games/${game.id}/join`, { data: {} })).status()).toBe(409);
    // Leaving a cancelled activity never creates an offer.
    expect((await participant.delete(`/api/games/${game.id}/join`)).status()).toBe(200);
    expect((await waitlist(f, game.id)).map(w => w.status)).toEqual(["cancelled"]);
    // Archive of a cancelled activity and of an empty upcoming activity is administrative and silent.
    const before = (await notificationsFor(f, "QA_USER", game.id)).length;
    expect((await host.post(`/api/games/${game.id}/lifecycle`, { data: { lifecycle: "archived" } })).status()).toBe(200);
    const empty = await createActivity(f, "QA_HOST");
    expect((await host.post(`/api/games/${empty.id}/lifecycle`, { data: { lifecycle: "archived" } })).status()).toBe(200);
    expect((await notificationsFor(f, "QA_USER", game.id)).length).toBe(before);
  });
});

test("HC-QA-029: activity updates are returned newest first", async ({ playwright }) => {
  await withActors(playwright, ["QA_HOST"], async f => {
    const game = await createActivity(f, "QA_HOST");
    for (const message of ["QA first", "QA second", "QA third"]) expect((await f.actors.QA_HOST.post(`/api/games/${game.id}/updates`, { data: { message } })).status()).toBe(201);
    const order = (await (await f.actors.QA_HOST.get(`/api/games/${game.id}/updates`)).json()).map((u: any) => u.message);
    await evidence("hc-qa-029", { order: order.join("|") });
    expect(order).toEqual(["QA third", "QA second", "QA first"]);
  });
});

test("HC-QA-029-TIES: same-second updates and notifications are deterministic newest-first", async ({ playwright }) => {
  await withActors(playwright, ["QA_HOST", "QA_USER"], async f => {
    const game = await createActivity(f, "QA_HOST");
    expect((await f.actors.QA_USER.post(`/api/games/${game.id}/join`, { data: {} })).status()).toBe(200);
    const messages = ["QA u1", "QA u2", "QA u3", "QA u4", "QA u5"];
    for (const message of messages) expect((await f.actors.QA_HOST.post(`/api/games/${game.id}/updates`, { data: { message } })).status()).toBe(201);
    const stored = await rows(f, "SELECT id, created_at FROM game_updates WHERE game_id = ? ORDER BY id", [game.id]);
    const ties = stored.length - new Set(stored.map(r => new Date(r.created_at).getTime())).size;
    for (let i = 0; i < 3; i++) {
      const order = (await (await f.actors.QA_USER.get(`/api/games/${game.id}/updates`)).json()).map((u: any) => u.message);
      expect(order).toEqual([...messages].reverse());
    }
    const notes = (await (await f.actors.QA_USER.get("/api/residents/me/notifications")).json() as any[]).filter(n => n.listingId === game.id && n.title.startsWith("Update:"));
    expect(notes.map(n => n.body)).toEqual([...messages].reverse());
    await evidence("hc-qa-029-ties", { sameSecondTies: ties });
  });
});
