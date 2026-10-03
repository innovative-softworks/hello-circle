import { randomUUID } from "node:crypto";
import { test, expect, personas } from "../fixtures";
import { withActors, evidence } from "../authorization-fixture";
import { clubFor } from "../stage-b-fixture";

// Stage B completion (Phase 6B). Each test preserves ONE runtime finding as an
// unskipped regression. Canonical reference: GET /api/games/:id (404 for a
// viewer who may not see the activity) and GET /api/circles/:id (teaser).

type Track = (table: string, column: string, id: string | number) => void;
function trackGame(track: Track, id: string) {
  for (const [table, column] of [["games", "id"], ["game_participants", "game_id"], ["game_updates", "game_id"], ["listing_attributes", "listing_id"], ["notifications", "listing_id"]]) track(table, column, id);
}
const future = "2030-06-20";
const later = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 19).replace("T", " ");

test("HC-QA-010: game child reads must follow canonical activity visibility", async ({ playwright }) => {
  await withActors(playwright, ["QA_HOST", "QA_USER_B", "GUEST"], async ({ actors, track, snapshot }) => {
    const secret = `QA private update ${randomUUID()}`;
    const ids: string[] = [];
    for (const input of [{ visibility: "invite", lifecycle: "active" }, { visibility: "public", lifecycle: "draft" }]) {
      const created = await actors.QA_HOST.post("/api/games", { data: { activityLabel: `QA child ${randomUUID()}`, date: future, time: "12:00", capacity: 6, locationText: "Synthetic QA venue", priceCents: 0, ...input } });
      expect(created.status()).toBe(201);
      const { id } = await created.json();
      ids.push(id); trackGame(track, id);
      expect((await actors.QA_HOST.post(`/api/games/${id}/updates`, { data: { message: secret } })).status()).toBe(201);
    }
    const unchanged = await snapshot("SELECT * FROM games WHERE id IN (?,?) ORDER BY id", ids);
    const facts: Record<string, number | boolean> = {};
    for (const [index, id] of ids.entries()) {
      for (const role of ["GUEST", "QA_USER_B"]) {
        const canonical = (await actors[role].get(`/api/games/${id}`)).status();
        const participants = await actors[role].get(`/api/games/${id}/participants`);
        const updates = await actors[role].get(`/api/games/${id}/updates`);
        const participantsBody = participants.status() === 200 ? await participants.json() : null;
        const updatesText = updates.status() === 200 ? await updates.text() : "";
        const participantNamesDisclosed = !!participantsBody && Array.isArray(participantsBody.participants) && participantsBody.participants.length > 0;
        const updateDisclosed = updatesText.includes(secret);
        facts[`game${index}-${role}-canonical`] = canonical;
        facts[`game${index}-${role}-participantsStatus`] = participants.status();
        facts[`game${index}-${role}-participantNamesDisclosed`] = participantNamesDisclosed;
        facts[`game${index}-${role}-updatesStatus`] = updates.status();
        facts[`game${index}-${role}-updateDisclosed`] = updateDisclosed;
      }
    }
    await evidence("hc-qa-010-game-children", facts);
    for (const [index] of ids.entries()) for (const role of ["GUEST", "QA_USER_B"]) {
      expect(facts[`game${index}-${role}-canonical`], "Canonical detail denies this viewer").toBe(404);
      expect(facts[`game${index}-${role}-participantNamesDisclosed`], "Participant list of a non-viewable activity").toBe(false);
      expect(facts[`game${index}-${role}-updateDisclosed`], "Host update text of a non-viewable activity").toBe(false);
    }
    // Host positive control keeps working.
    expect(((await (await actors.QA_HOST.get(`/api/games/${ids[0]}/updates`)).json()) as { message: string }[]).some((u) => u.message === secret)).toBe(true);
    await unchanged();
  });
});

test("HC-QA-011: Circle summaries and upcoming must not aggregate private, draft or scheduled activities", async ({ playwright }) => {
  await withActors(playwright, ["QA_USER", "QA_HOST_B", "GUEST"], async ({ actors, track }) => {
    const label = `QA aggregation ${randomUUID().slice(0, 8)}`;
    const circle = await actors.QA_USER.post("/api/circles", { data: { name: `QA open ${randomUUID()}`, joinMode: "open", activityLabel: label } });
    expect(circle.status()).toBe(201);
    const circleId = (await circle.json()).id;
    track("circles", "id", circleId); track("circle_members", "circle_id", circleId);
    const protectedIds: Record<string, string> = {};
    for (const [name, input] of Object.entries({
      inviteOnly: { visibility: "invite", lifecycle: "active" },
      draft: { visibility: "public", lifecycle: "draft" },
      scheduled: { visibility: "public", lifecycle: "active", publishAt: later },
    })) {
      const created = await actors.QA_HOST_B.post("/api/games", { data: { activityLabel: label, date: future, time: "12:00", capacity: 6, locationText: "Synthetic QA venue", priceCents: 0, ...input } });
      expect(created.status()).toBe(201);
      protectedIds[name] = (await created.json()).id; trackGame(track, protectedIds[name]);
    }
    const facts: Record<string, number | boolean> = {};
    for (const [name, id] of Object.entries(protectedIds)) facts[`${name}-canonicalGuest`] = (await actors.GUEST.get(`/api/games/${id}`)).status();
    const upcoming = await actors.GUEST.get(`/api/circles/${circleId}/upcoming`);
    expect(upcoming.status()).toBe(200);
    const upcomingIds = ((await upcoming.json()) as { id: string }[]).map((row) => row.id);
    const detail = await (await actors.GUEST.get(`/api/circles/${circleId}`)).json();
    const listed = ((await (await actors.GUEST.get("/api/circles")).json()) as { id: string; nextPlan: { id: string } | null }[]).find((row) => row.id === circleId);
    for (const [name, id] of Object.entries(protectedIds)) {
      facts[`${name}-inUpcoming`] = upcomingIds.includes(id);
      facts[`${name}-inDetailNextPlan`] = detail.nextPlan?.id === id;
      facts[`${name}-inListNextPlan`] = listed?.nextPlan?.id === id;
    }
    facts.detailPlansThisMonthCountsProtected = Number(detail.plansThisMonth) > 0 && !upcomingIds.some((id) => !Object.values(protectedIds).includes(id));
    await evidence("hc-qa-011-circle-aggregation", facts);
    for (const name of Object.keys(protectedIds)) {
      expect(facts[`${name}-canonicalGuest`], `${name} canonical detail denied`).toBe(404);
      expect(facts[`${name}-inUpcoming`], `${name} must not appear in Circle upcoming`).toBe(false);
      expect(facts[`${name}-inDetailNextPlan`], `${name} must not appear as Circle nextPlan`).toBe(false);
      expect(facts[`${name}-inListNextPlan`], `${name} must not appear in Circle list nextPlan`).toBe(false);
    }
  });
});

test("HC-QA-012: host profile and scheduled discovery must exclude draft or not-yet-published activities", async ({ playwright }) => {
  await withActors(playwright, ["QA_HOST", "GUEST"], async ({ actors, track }) => {
    const ids: Record<string, string> = {};
    for (const [name, input] of Object.entries({
      draft: { visibility: "public", lifecycle: "draft" },
      scheduled: { visibility: "public", lifecycle: "active", publishAt: later },
      live: { visibility: "public", lifecycle: "active" },
    })) {
      const created = await actors.QA_HOST.post("/api/games", { data: { activityLabel: `QA profile ${randomUUID()}`, date: future, time: "12:00", capacity: 6, locationText: "Synthetic QA venue", priceCents: 0, ...input } });
      expect(created.status()).toBe(201);
      ids[name] = (await created.json()).id; trackGame(track, ids[name]);
    }
    const profile = await actors.GUEST.get(`/api/residents/${personas.QA_HOST.id}/host-profile`);
    expect(profile.status()).toBe(200);
    const profileIds = ((await profile.json()).upcomingGames as { id: string }[]).map((g) => g.id);
    const listIds = ((await (await actors.GUEST.get("/api/games")).json()) as { id: string }[]).map((g) => g.id);
    const facts: Record<string, number | boolean> = {};
    for (const [name, id] of Object.entries(ids)) {
      facts[`${name}-canonicalGuest`] = (await actors.GUEST.get(`/api/games/${id}`)).status();
      facts[`${name}-inHostProfile`] = profileIds.includes(id);
      facts[`${name}-inPublicList`] = listIds.includes(id);
    }
    await evidence("hc-qa-012-profile-discovery", facts);
    // Positive control: a live public activity is visible everywhere.
    expect(facts["live-canonicalGuest"]).toBe(200);
    expect(facts["live-inHostProfile"] && facts["live-inPublicList"]).toBe(true);
    for (const name of ["draft", "scheduled"]) {
      expect(facts[`${name}-canonicalGuest`], `${name} canonical detail denied`).toBe(404);
      expect(facts[`${name}-inHostProfile`], `${name} must not appear on public host profile`).toBe(false);
      expect(facts[`${name}-inPublicList`], `${name} must not appear in public discovery list`).toBe(false);
    }
  });
});

test("HC-QA-013: Circle poll vote must be scoped to the authorized Circle", async ({ playwright }) => {
  await withActors(playwright, ["QA_USER", "QA_USER_B"], async ({ actors, connection, track, snapshot }) => {
    const circles: string[] = [];
    for (const role of ["QA_USER", "QA_USER_B"]) {
      const created = await actors[role].post("/api/circles", { data: { name: `QA poll ${randomUUID()}`, joinMode: "invite" } });
      expect(created.status()).toBe(201);
      const id = (await created.json()).id;
      circles.push(id);
      for (const [table, column] of [["circles", "id"], ["circle_members", "circle_id"], ["circle_polls", "circle_id"]]) track(table, column, id);
    }
    const [a, b] = circles;
    const poll = await actors.QA_USER.post(`/api/circles/${a}/polls`, { data: { question: "Synthetic QA date", options: [{ date: future, time: "12:00" }] } });
    expect(poll.status()).toBe(201);
    const pollId = (await poll.json()).id;
    const [options] = await connection.query<any[]>("SELECT id FROM circle_poll_options WHERE poll_id = ?", [pollId]);
    track("circle_poll_votes", "poll_id", pollId); track("circle_poll_options", "poll_id", pollId);
    const optionId = options[0].id;
    const invariants = await Promise.all([
      snapshot("SELECT * FROM circle_poll_votes WHERE poll_id = ? ORDER BY resident_id", [pollId]),
      snapshot("SELECT * FROM circle_polls WHERE id = ?", [pollId]),
      snapshot("SELECT * FROM circle_members WHERE circle_id IN (?,?) ORDER BY id", circles),
    ]);
    // Direct access is denied: B is not a member of invite-only Circle A.
    expect((await actors.QA_USER_B.get(`/api/circles/${a}/polls`)).status()).toBe(403);
    expect((await actors.QA_USER_B.post(`/api/circles/${a}/polls/${pollId}/options/${optionId}/vote`)).status()).toBe(403);
    for (const unchanged of invariants) await unchanged();
    // Substituted parent: B's own Circle + A's poll/option.
    const substituted = await actors.QA_USER_B.post(`/api/circles/${b}/polls/${pollId}/options/${optionId}/vote`);
    const [votes] = await connection.query<any[]>("SELECT COUNT(*) AS n FROM circle_poll_votes WHERE poll_id = ? AND resident_id = ?", [pollId, personas.QA_USER_B.id]);
    await evidence("hc-qa-013-poll-vote", { substitutedStatus: substituted.status(), foreignVoteRecorded: Number(votes[0].n) > 0 });
    expect(substituted.status(), "Foreign poll under an authorized Circle is not found").toBe(404);
    for (const unchanged of invariants) await unchanged();
    // Positive control: organiser votes in own Circle's poll.
    expect((await actors.QA_USER.post(`/api/circles/${a}/polls/${pollId}/options/${optionId}/vote`)).status()).toBe(200);
  });
});

test("HC-QA-014: an activity may be attached only to a Circle its host may organise into", async ({ playwright }) => {
  await withActors(playwright, ["QA_USER", "QA_HOST_B"], async ({ actors, track, snapshot }) => {
    const circle = await actors.QA_USER.post("/api/circles", { data: { name: `QA private feed ${randomUUID()}`, joinMode: "invite", activityLabel: `QA feed ${randomUUID().slice(0, 8)}` } });
    expect(circle.status()).toBe(201);
    const circleId = (await circle.json()).id;
    track("circles", "id", circleId); track("circle_members", "circle_id", circleId);
    const members = await snapshot("SELECT * FROM circle_members WHERE circle_id = ? ORDER BY id", [circleId]);
    // Direct access denied to the outsider.
    expect((await actors.QA_HOST_B.get(`/api/circles/${circleId}/upcoming`)).status()).toBe(403);
    const injected = await actors.QA_HOST_B.post("/api/games", { data: { activityLabel: "Outsider injected plan", date: future, time: "12:00", capacity: 6, locationText: "Synthetic QA venue", priceCents: 0, circleId } });
    let gameId: string | null = null;
    if (injected.status() === 201) { gameId = (await injected.json()).id; trackGame(track, gameId!); }
    const upcoming = await (await actors.QA_USER.get(`/api/circles/${circleId}/upcoming`)).json() as { id: string; source: string }[];
    const presentedAsCircle = !!gameId && upcoming.some((row) => row.id === gameId && row.source === "circle");
    await evidence("hc-qa-014-circle-attachment", { createStatus: injected.status(), outsiderGamePresentedAsCirclePlan: presentedAsCircle });
    expect(presentedAsCircle, "A non-member's activity must not be presented as this private Circle's own plan").toBe(false);
    await members();
  });
});

test("HC-QA-015: public club schedule must follow parent club publication", async ({ playwright }) => {
  await withActors(playwright, ["GUEST"], async (f) => {
    const club = await clubFor(f, "QA_VENDOR", "approved");
    const sessionId = randomUUID();
    await f.connection.execute("INSERT INTO club_sessions (id, club_id, day_of_week, time, label, instructor_name) VALUES (?, ?, 2, '18:00', 'QA schedule', 'QA instructor')", [sessionId, club]);
    const read = async () => ((await (await f.actors.GUEST.get(`/api/club-sessions?clubId=${club}`)).json()) as { id: string }[]).some((s) => s.id === sessionId);
    expect((await f.actors.GUEST.get(`/api/clubs/${club}`)).status()).toBe(200);
    expect(await read()).toBe(true);
    const facts: Record<string, number | boolean> = {};
    for (const status of ["pending", "paused", "deleted"]) {
      await f.connection.execute("UPDATE clubs SET status = ? WHERE id = ?", [status, club]);
      facts[`${status}-canonical`] = (await f.actors.GUEST.get(`/api/clubs/${club}`)).status();
      facts[`${status}-scheduleVisible`] = await read();
    }
    await evidence("hc-qa-015-club-sessions", facts);
    for (const status of ["pending", "paused", "deleted"]) {
      expect(facts[`${status}-canonical`], `${status} canonical club denied`).toBe(404);
      expect(facts[`${status}-scheduleVisible`], `${status} club schedule must not be publicly aggregated`).toBe(false);
    }
  });
});
