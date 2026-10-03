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

test("HC-QA-024: votes cannot be cast or changed after a poll is closed", async ({ playwright }) => {
  await withActors(playwright, ["QA_HOST_B", "QA_USER"], async f => {
    const circle = await createCircle(f, "QA_HOST_B", { joinMode: "open" });
    expect((await f.actors.QA_USER.post(`/api/circles/${circle.id}/join`, { data: {} })).status()).toBe(201);
    const pollId = (await (await f.actors.QA_HOST_B.post(`/api/circles/${circle.id}/polls`, { data: { question: "Day?", options: [{ date: "2030-09-01" }] } })).json()).id;
    f.track("circle_poll_options", "poll_id", pollId); f.track("circle_poll_votes", "poll_id", pollId);
    const [option] = await rows(f, "SELECT id FROM circle_poll_options WHERE poll_id = ?", [pollId]);
    expect((await f.actors.QA_HOST_B.post(`/api/circles/${circle.id}/polls/${pollId}/close`, { data: {} })).status()).toBe(200);
    const vote = await f.actors.QA_USER.post(`/api/circles/${circle.id}/polls/${pollId}/options/${option.id}/vote`, { data: {} });
    const votes = await rows(f, "SELECT resident_id FROM circle_poll_votes WHERE poll_id = ?", [pollId]);
    await evidence("hc-qa-024", { voteAfterCloseStatus: vote.status(), votesAfterClose: votes.length });
    expect(vote.status()).toBe(409);
    expect(votes.length).toBe(0);
  });
});

test("HC-QA-024-INVARIANT: open voting and toggling work; closed polls preserve results; Circle scoping intact", async ({ playwright }) => {
  await withActors(playwright, ["QA_HOST_B", "QA_USER", "QA_USER_B"], async f => {
    const { QA_HOST_B: organiser, QA_USER: member, QA_USER_B: otherMember } = f.actors;
    const circle = await createCircle(f, "QA_HOST_B", { joinMode: "open" });
    const otherCircle = await createCircle(f, "QA_HOST_B", { joinMode: "open" });
    expect((await member.post(`/api/circles/${circle.id}/join`, { data: {} })).status()).toBe(201);
    expect((await otherMember.post(`/api/circles/${otherCircle.id}/join`, { data: {} })).status()).toBe(201);
    const pollId = (await (await organiser.post(`/api/circles/${circle.id}/polls`, { data: { question: "Day?", options: [{ date: "2030-09-01" }, { date: "2030-09-02" }] } })).json()).id;
    f.track("circle_poll_options", "poll_id", pollId); f.track("circle_poll_votes", "poll_id", pollId);
    const [o1, o2] = (await rows(f, "SELECT id FROM circle_poll_options WHERE poll_id = ? ORDER BY sort_order", [pollId])).map(r => r.id);
    const vote = (actor: any, option: number, circleId = circle.id) => actor.post(`/api/circles/${circleId}/polls/${pollId}/options/${option}/vote`, { data: {} });
    const votes = () => rows(f, "SELECT option_id, resident_id FROM circle_poll_votes WHERE poll_id = ? ORDER BY option_id, resident_id", [pollId]);
    expect((await vote(member, o1)).status()).toBe(200);
    expect((await vote(member, o2)).status()).toBe(200);
    expect((await vote(member, o2)).status()).toBe(200); // toggle off (multi-select availability poll)
    expect((await vote(organiser, o1)).status()).toBe(200);
    // HC-QA-013: a member of another Circle cannot reach this poll through their own Circle id.
    expect((await vote(otherMember, o1, otherCircle.id)).status()).toBe(404);
    expect((await organiser.post(`/api/circles/${circle.id}/polls/${pollId}/close`, { data: {} })).status()).toBe(200);
    const before = await votes();
    expect(before.length).toBe(2);
    const newVote = await vote(member, o2);
    const toggleOff = await vote(member, o1);
    const organiserVote = await vote(organiser, o2);
    expect([newVote.status(), toggleOff.status(), organiserVote.status()]).toEqual([409, 409, 409]);
    expect(await votes()).toEqual(before);
    const listed = (await (await member.get(`/api/circles/${circle.id}/polls`)).json()).find((p: any) => p.id === pollId);
    expect(listed.status).toBe("closed");
    expect(listed.options.map((o: any) => Number(o.voteCount))).toEqual([2, 0]);
  });
});

test("HC-QA-025: the publishing-state endpoint cannot silently cancel or complete an activity", async ({ playwright }) => {
  await withActors(playwright, ["QA_HOST", "QA_USER"], async f => {
    const game = await createActivity(f, "QA_HOST");
    expect((await f.actors.QA_USER.post(`/api/games/${game.id}/join`, { data: {} })).status()).toBe(200);
    const cancel = await f.actors.QA_HOST.post(`/api/games/${game.id}/lifecycle`, { data: { lifecycle: "cancelled" } });
    const [row] = await rows(f, "SELECT status, lifecycle FROM games WHERE id = ?", [game.id]);
    const notified = (await notificationsFor(f, "QA_USER", game.id)).length;
    const future = await createActivity(f, "QA_HOST");
    const complete = await f.actors.QA_HOST.post(`/api/games/${future.id}/lifecycle`, { data: { lifecycle: "completed" } });
    await evidence("hc-qa-025", { cancelViaLifecycle: cancel.status(), storedStatus: row.status, storedLifecycle: row.lifecycle, participantNotified: notified, completeFutureViaLifecycle: complete.status() });
    // Either reject (use POST /:id/cancel) or apply the full cancellation semantics.
    const consistent = cancel.status() === 409 || (row.status === "cancelled" && notified === 1);
    expect(consistent, "cancellation via lifecycle must be rejected or consistent with POST /cancel").toBe(true);
    expect(complete.status(), "a future-dated activity cannot be marked completed").toBe(409);
  });
});

test("HC-QA-025-INVARIANT: rejected transitions leave state unchanged; cancellation only through the canonical workflow", async ({ playwright }) => {
  await withActors(playwright, ["QA_HOST", "QA_USER"], async f => {
    const { QA_HOST: host, QA_USER: user } = f.actors;
    const game = await createActivity(f, "QA_HOST");
    expect((await user.post(`/api/games/${game.id}/join`, { data: {} })).status()).toBe(200);
    const snaps = await Promise.all([
      f.snapshot("SELECT * FROM games WHERE id = ?", [game.id]),
      f.snapshot("SELECT * FROM game_participants WHERE game_id = ? ORDER BY id", [game.id]),
      f.snapshot("SELECT * FROM notifications WHERE listing_id = ? ORDER BY id", [game.id]),
    ]);
    for (const to of ["cancelled", "completed", "bogus"]) expect((await host.post(`/api/games/${game.id}/lifecycle`, { data: { lifecycle: to } })).status(), to).toBe(409);
    for (const s of snaps) await s();
    // Canonical cancel: status cancelled, lifecycle untouched, participant notified once.
    expect((await host.post(`/api/games/${game.id}/cancel`, { data: {} })).status()).toBe(200);
    const [row] = await rows(f, "SELECT status, lifecycle FROM games WHERE id = ?", [game.id]);
    expect(row).toEqual({ status: "cancelled", lifecycle: "active" });
    expect((await notificationsFor(f, "QA_USER", game.id)).filter(n => n.title.startsWith("Cancelled:")).length).toBe(1);
    // A cancelled activity cannot be paused/resumed through publishing state; archive is allowed.
    for (const to of ["paused", "active", "draft"]) expect((await host.post(`/api/games/${game.id}/lifecycle`, { data: { lifecycle: to } })).status(), to).toBe(409);
    expect((await host.post(`/api/games/${game.id}/lifecycle`, { data: { lifecycle: "archived" } })).status()).toBe(200);
    expect((await rows(f, "SELECT status, lifecycle FROM games WHERE id = ?", [game.id]))[0]).toEqual({ status: "cancelled", lifecycle: "archived" });
    // Normal publishing transitions unaffected.
    const other = await createActivity(f, "QA_HOST");
    for (const to of ["paused", "active"]) expect((await host.post(`/api/games/${other.id}/lifecycle`, { data: { lifecycle: to } })).status(), to).toBe(200);
    const contradictory = await rows(f, "SELECT id FROM games WHERE id IN (?, ?) AND lifecycle IN ('cancelled', 'completed')", [game.id, other.id]);
    expect(contradictory).toEqual([]);
  });
});
