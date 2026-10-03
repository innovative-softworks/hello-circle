import { randomUUID } from "node:crypto";
import { expect, personas } from "../fixtures";
import { evidence } from "../authorization-fixture";
import { test, withActors } from "../lifecycle-fixture";
import { createCircle, trackGame, rows, notificationsFor, hrefOf } from "../lifecycle-fixture";

// Phase 7 — Parts 16-19. Organiser = QA_HOST_B, member = QA_USER, non-member = QA_USER_B.

test("LC-CIR-PLANS: member idea stays unofficial until organiser confirms and converts; official plan surfaces by ID", async ({ playwright }) => {
  await withActors(playwright, ["QA_HOST_B", "QA_USER", "QA_USER_B"], async f => {
    const { QA_HOST_B: organiser, QA_USER: member, QA_USER_B: outsider } = f.actors;
    const circle = await createCircle(f, "QA_HOST_B", { joinMode: "approval" });
    expect((await organiser.post(`/api/circles/${circle.id}/invite`, { data: { residentId: personas.QA_USER.id } })).status()).toBe(201);
    expect((await member.post(`/api/circles/${circle.id}/join`, { data: {} })).status()).toBe(201);

    // Part 16 — member idea.
    expect((await outsider.post(`/api/circles/${circle.id}/plan-ideas`, { data: { title: "Outsider idea" } })).status()).toBe(403);
    const created = await member.post(`/api/circles/${circle.id}/plan-ideas`, { data: { title: "QA Saturday walk", note: "Easy pace", proposedDate: "2030-09-06", proposedTime: "10:00", locationText: "QA pier" } });
    expect(created.status()).toBe(201);
    const idea = await created.json();
    expect(idea).toMatchObject({ status: "idea", createdByResidentId: personas.QA_USER.id, activity: null });
    const ideaNote = (await notificationsFor(f, "QA_HOST_B", circle.id)).filter(n => n.ref === idea.id);
    expect(ideaNote.length).toBe(1);
    expect(hrefOf(ideaNote[0])).toBe(`/circles/${circle.id}`);
    expect((await (await organiser.get(`/api/circles/${circle.id}/plan-ideas`)).json()).map((p: any) => p.id)).toContain(idea.id);
    const needs = await (await organiser.get("/api/residents/me/needs-attention", { headers: { "X-Client-Id": randomUUID() } })).json();
    expect(needs.some((i: any) => i.actionType === "plan_confirmation" && i.sourceId === idea.id)).toBe(true);
    const unofficial = await (await member.get(`/api/circles/${circle.id}`)).json();
    expect(unofficial.nextPlan).toBeNull(); // an idea is NOT an official plan
    expect(unofficial.activePlan).toMatchObject({ id: idea.id, status: "idea" });
    expect(await rows(f, "SELECT id FROM games WHERE circle_id = ? OR plan_id = ?", [circle.id, idea.id])).toEqual([]);
    expect((await member.patch(`/api/circles/${circle.id}/plan-ideas/${idea.id}`, { data: { note: "Updated by creator" } })).status()).toBe(200);
    expect((await member.post(`/api/circles/${circle.id}/plan-ideas/${idea.id}/confirm`, { data: {} })).status()).toBe(403);
    // Member cannot convert even with the plan id; organiser must confirm first.
    const early = await organiser.post("/api/games", { data: { activityLabel: "QA walk", date: "2030-09-06", time: "10:00", capacity: 10, locationText: "QA pier", circleId: circle.id, planId: idea.id } });
    expect(early.status()).toBe(409);
    expect((await organiser.post(`/api/circles/${circle.id}/plan-ideas/${idea.id}/confirm`, { data: {} })).status()).toBe(200);
    expect((await member.patch(`/api/circles/${circle.id}/plan-ideas/${idea.id}`, { data: { note: "creator edit after confirm" } })).status()).toBe(403);
    expect((await notificationsFor(f, "QA_USER", circle.id)).filter(n => n.ref === idea.id && n.title.endsWith("is confirmed")).length).toBe(1);
    expect(await rows(f, "SELECT id FROM games WHERE plan_id = ?", [idea.id])).toEqual([]); // confirmed ≠ activity
    const memberConvert = await member.post("/api/games", { data: { activityLabel: "QA walk", date: "2030-09-06", time: "10:00", capacity: 10, locationText: "QA pier", circleId: circle.id, planId: idea.id } });
    expect(memberConvert.status()).toBe(403);

    // Normal organiser workflow creates the official activity from the confirmed plan.
    const conversion = await organiser.post("/api/games", { data: { activityLabel: "QA Saturday walk", date: "2030-09-06", time: "10:00", capacity: 10, locationText: "QA pier", circleId: circle.id, planId: idea.id } });
    expect(conversion.status()).toBe(201);
    const game = await conversion.json();
    trackGame(f, game.id);
    const again = await organiser.post("/api/games", { data: { activityLabel: "QA dup", date: "2030-09-06", time: "10:00", capacity: 10, locationText: "QA pier", circleId: circle.id, planId: idea.id } });
    expect(again.status()).toBe(409);
    expect(await rows(f, "SELECT id FROM games WHERE plan_id = ?", [idea.id])).toEqual([{ id: game.id }]);
    const [plan] = await rows(f, "SELECT status, activity_source_type, activity_source_id FROM circle_plans WHERE id = ?", [idea.id]);
    expect(plan).toEqual({ status: "activity_created", activity_source_type: "game", activity_source_id: game.id });
    const [link] = await rows(f, "SELECT circle_id, plan_id, visibility FROM games WHERE id = ?", [game.id]);
    expect(link).toMatchObject({ circle_id: circle.id, plan_id: idea.id });

    // Part 17 — official plan surfaces use authoritative IDs.
    const detail = await (await member.get(`/api/circles/${circle.id}`)).json();
    expect(detail.nextPlan).toMatchObject({ id: game.id, source: "circle" });
    expect(detail.activePlan).toBeNull();
    expect((await (await member.get(`/api/circles/${circle.id}/upcoming`)).json()).filter((g: any) => g.source === "circle").map((g: any) => g.id)).toEqual([game.id]);
    expect((await (await organiser.get(`/api/circles/${circle.id}/plans`)).json()).map((g: any) => g.id)).toEqual([game.id]);
    expect((await member.get(`/api/circles/${circle.id}/plans`)).status()).toBe(403);
    const planJson = await (await member.get(`/api/circles/${circle.id}/plan-ideas/${idea.id}`)).json();
    expect(planJson).toMatchObject({ status: "activity_created", activitySourceId: game.id, activity: { id: game.id } });
    const gameJson = await (await member.get(`/api/games/${game.id}`)).json();
    expect(gameJson).toMatchObject({ circleId: circle.id, circleSlug: circle.slug });
    expect((await member.get(`/api/games/${game.id}/ics`)).status()).toBe(200);
    // Renaming the Circle's activity label must not detach the official plan (ID link, not label).
    expect((await organiser.put(`/api/circles/${circle.id}`, { data: { name: "QA renamed circle", activityLabel: "Totally different label" } })).status()).toBe(200);
    expect((await (await member.get(`/api/circles/${circle.id}`)).json()).nextPlan?.id).toBe(game.id);
    // Visibility of the converted plan: organiser UI never sends a visibility, so a Circle plan defaults to public.
    await evidence("lc-cir-plans", { memberIdeaUnofficial: true, confirmRequiresOrganiser: true, conversionOrganiserOnly: true, conversionIdempotent: 409, officialPlanById: true, convertedPlanVisibility: String(link.visibility) });
  });
});

test("LC-CIR-POLLS: member poll, votes, toggle, results, close and membership requirement", async ({ playwright }) => {
  await withActors(playwright, ["QA_HOST_B", "QA_USER", "QA_USER_B"], async f => {
    const { QA_HOST_B: organiser, QA_USER: member, QA_USER_B: outsider } = f.actors;
    const circle = await createCircle(f, "QA_HOST_B", { joinMode: "open" });
    expect((await member.post(`/api/circles/${circle.id}/join`, { data: {} })).status()).toBe(201);
    expect((await outsider.post(`/api/circles/${circle.id}/polls`, { data: { question: "x", options: [{ date: "2030-09-01" }] } })).status()).toBe(403);
    expect((await member.post(`/api/circles/${circle.id}/polls`, { data: { question: "x", options: [] } })).status()).toBe(400);
    const pollRes = await member.post(`/api/circles/${circle.id}/polls`, { data: { question: "Which day?", options: [{ date: "2030-09-01", time: "10:00" }, { date: "2030-09-02", time: "11:00" }] } });
    expect(pollRes.status()).toBe(201);
    const pollId = (await pollRes.json()).id;
    f.track("circle_poll_options", "poll_id", pollId); f.track("circle_poll_votes", "poll_id", pollId);
    const list = async (actor: any) => (await (await actor.get(`/api/circles/${circle.id}/polls`)).json()).find((p: any) => p.id === pollId);
    const [o1, o2] = (await list(member)).options.map((o: any) => o.id);
    const vote = (actor: any, option: number) => actor.post(`/api/circles/${circle.id}/polls/${pollId}/options/${option}/vote`, { data: {} });
    for (const [actor, option] of [[member, o1], [organiser, o1], [organiser, o2]] as const) expect((await vote(actor, option)).status()).toBe(200);
    expect((await vote(outsider, o1)).status()).toBe(403);
    let poll = await list(member);
    expect(poll.options.map((o: any) => [Number(o.voteCount), o.votedByMe])).toEqual([[2, true], [1, false]]);
    // Voting the same option again toggles the vote off (multi-select availability poll).
    expect((await vote(member, o1)).status()).toBe(200);
    poll = await list(member);
    expect(poll.options.map((o: any) => Number(o.voteCount))).toEqual([1, 1]);
    expect((await rows(f, "SELECT COUNT(*) AS n FROM circle_poll_votes WHERE poll_id = ? AND resident_id = ?", [pollId, personas.QA_HOST_B.id]))[0].n).toBe(2);
    expect((await member.post(`/api/circles/${circle.id}/polls/${pollId}/close`, { data: {} })).status()).toBe(403);
    expect((await organiser.post(`/api/circles/${circle.id}/polls/${pollId}/close`, { data: {} })).status()).toBe(200);
    expect((await list(member)).status).toBe("closed");
    const before = await rows(f, "SELECT option_id, resident_id FROM circle_poll_votes WHERE poll_id = ? ORDER BY option_id, resident_id", [pollId]);
    const afterClose = await vote(member, o2);
    const after = await rows(f, "SELECT option_id, resident_id FROM circle_poll_votes WHERE poll_id = ? ORDER BY option_id, resident_id", [pollId]);
    // Removed member loses voting rights.
    expect((await organiser.post(`/api/circles/${circle.id}/members/${personas.QA_USER.id}/remove`, { data: {} })).status()).toBe(200);
    const poll2 = await organiser.post(`/api/circles/${circle.id}/polls`, { data: { question: "Next?", options: [{ date: "2030-10-01" }] } });
    const poll2Id = (await poll2.json()).id;
    f.track("circle_poll_options", "poll_id", poll2Id); f.track("circle_poll_votes", "poll_id", poll2Id);
    const [p2o] = (await list(organiser).then(() => organiser.get(`/api/circles/${circle.id}/polls`)).then(r => r.json())).find((p: any) => p.id === poll2Id).options.map((o: any) => o.id);
    expect((await member.post(`/api/circles/${circle.id}/polls/${poll2Id}/options/${p2o}/vote`, { data: {} })).status()).toBe(403);
    await evidence("lc-cir-polls", { votesCounted: true, toggleRemovesVote: true, outsiderVoteDenied: 403, closedByOrganiser: true, voteAfterCloseStatus: afterClose.status(), votesChangedAfterClose: JSON.stringify(before) !== JSON.stringify(after) });
  });
});

test("LC-CIR-CHAT: member send, persistence, inbox, moderation report and post-removal authorization", async ({ playwright }) => {
  await withActors(playwright, ["QA_HOST_B", "QA_USER", "QA_USER_B"], async f => {
    const { QA_HOST_B: organiser, QA_USER: member, QA_USER_B: outsider } = f.actors;
    const circle = await createCircle(f, "QA_HOST_B", { joinMode: "open" });
    expect((await member.post(`/api/circles/${circle.id}/join`, { data: {} })).status()).toBe(201);
    const url = `/api/chat/circle/${circle.id}/messages`;
    expect((await outsider.get(url)).status()).toBe(403);
    expect((await outsider.post(url, { data: { body: "outsider" } })).status()).toBe(403);
    expect((await member.post(url, { data: { body: "  " } })).status()).toBe(400);
    const sent = await member.post(url, { data: { body: "QA hello Circle" } });
    expect(sent.status()).toBe(201);
    const msgId = (await sent.json()).id;
    f.track("reports", "target_id", String(msgId));
    expect((await organiser.post(url, { data: { body: "QA organiser reply" } })).status()).toBe(201);
    const refreshed = await (await member.get(url)).json(); // refresh / reload
    expect(refreshed.messages.map((m: any) => [m.body, m.isMine])).toEqual([["QA hello Circle", true], ["QA organiser reply", false]]);
    expect(refreshed.canPost).toBe(true);
    const organiserView = await (await organiser.get(url)).json();
    expect(organiserView.messages.map((m: any) => m.isMine)).toEqual([false, true]);
    // Moderation: members can report; no edit/delete routes exist.
    expect((await member.post(`/api/chat/messages/${msgId}/report`, { data: { reason: "QA moderation check" } })).status()).toBe(201);
    expect((await outsider.post(`/api/chat/messages/${msgId}/report`, { data: { reason: "x" } })).status()).toBe(403);
    const editRoute = await member.put(`/api/chat/messages/${msgId}`, { data: { body: "edited" } });
    const deleteRoute = await member.delete(`/api/chat/messages/${msgId}`);
    // Inbox with two conversations that both have messages.
    // (Activity chats only open 24h before start, so a second Circle is used.)
    const second = await createCircle(f, "QA_HOST_B", { joinMode: "open" });
    expect((await member.post(`/api/circles/${second.id}/join`, { data: {} })).status()).toBe(201);
    expect((await member.post(`/api/chat/circle/${second.id}/messages`, { data: { body: "QA second chat" } })).status()).toBe(201);
    const inbox = await member.get("/api/chat/mine");
    const inboxStatus = inbox.status();
    // Removal → subsequent chat authorization follows membership.
    expect((await organiser.post(`/api/circles/${circle.id}/members/${personas.QA_USER.id}/remove`, { data: {} })).status()).toBe(200);
    expect((await member.get(url)).status()).toBe(403);
    expect((await member.post(url, { data: { body: "after removal" } })).status()).toBe(403);
    // Closed Circle: members read-only.
    expect((await organiser.put(`/api/circles/${circle.id}/status`, { data: { status: "closed" } })).status()).toBe(200);
    const closed = await (await organiser.get(url)).json();
    expect(closed.canPost).toBe(false);
    expect((await organiser.post(url, { data: { body: "closed" } })).status()).toBe(409);
    await evidence("lc-cir-chat", { persisted: true, outsiderDenied: 403, reportAccepted: 201, editRouteStatus: editRoute.status(), deleteRouteStatus: deleteRoute.status(), inboxTwoConversationsStatus: inboxStatus, removedDenied: 403, closedReadOnly: true });
  });
});
