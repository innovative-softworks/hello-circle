import { writeFileSync } from "node:fs";
import path from "node:path";
import { expect, personas, manifest } from "../fixtures";
import { evidence } from "../authorization-fixture";
import { test, withActors } from "../lifecycle-fixture";
import { createActivity, createCircle, rows, joinedIds, waitlist, notificationsFor, hrefOf, ids } from "../lifecycle-fixture";

// Phase 7 — Part 12 transition matrix, Part 20 updates, Part 22 cancel, Part 23 archive.

type Row = Record<string, string | number | boolean>;
async function probe(f: any, game: string, circle: string, opts: { tryJoin?: boolean } = {}): Promise<Row> {
  const { QA_HOST: host, QA_USER: participant, QA_USER_B: outsider } = f.actors;
  const hostDetail = await host.get(`/api/games/${game}`);
  const circleView = await (await outsider.get(`/api/circles/${circle}`)).json();
  const upcoming = await outsider.get(`/api/circles/${circle}/upcoming`);
  const row: Row = {
    stored: (await rows(f, "SELECT lifecycle FROM games WHERE id = ?", [game]))[0].lifecycle,
    status: (await rows(f, "SELECT status FROM games WHERE id = ?", [game]))[0].status,
    effective: hostDetail.status() === 200 ? (await hostDetail.json()).effectiveLifecycle : "n/a",
    ownerManage: (await ids(host, "/api/games/mine?hostedOnly=1")).includes(game),
    ownerDetail: hostDetail.status(),
    publicDetail: (await outsider.get(`/api/games/${game}`)).status(),
    discovery: (await ids(outsider, "/api/games")).includes(game),
    hostProfile: (await (await outsider.get(`/api/residents/${personas.QA_HOST.id}/host-profile`)).json()).upcomingGames.some((g: any) => g.id === game),
    circleUpcoming: upcoming.status() === 200 && (await upcoming.json()).some((g: any) => g.id === game),
    circleNextPlan: circleView.nextPlan?.id === game,
    participantJoined: (await joinedIds(f, game)).includes(personas.QA_USER.id),
    participantMine: (await ids(participant, "/api/games/mine")).includes(game),
    updatesRead: (await outsider.get(`/api/games/${game}/updates`)).status(),
  };
  if (opts.tryJoin !== false) {
    const join = await outsider.post(`/api/games/${game}/join`, { data: {} });
    row.join = join.status();
    if (join.status() === 200) expect((await outsider.delete(`/api/games/${game}/join`)).status()).toBe(200);
    const wl = await outsider.post(`/api/games/${game}/waitlist`, { data: {} });
    row.waitlist = wl.status();
    if (wl.status() === 201) expect((await outsider.delete(`/api/games/${game}/waitlist`)).status()).toBe(200);
  }
  return row;
}

test("LC-ACT-STATES: supported transition matrix across owner, public, discovery, Circle, participants, join and waitlist", async ({ playwright }) => {
  test.setTimeout(120_000);
  await withActors(playwright, ["QA_HOST", "QA_USER", "QA_USER_B"], async f => {
    const host = f.actors.QA_HOST;
    const circle = await createCircle(f, "QA_HOST", { joinMode: "open" });
    const game = await createActivity(f, "QA_HOST", { circleId: circle.id, lifecycle: "draft", capacity: 6 });
    const matrix: Record<string, Row> = {};
    const move = async (to: string, expected = 200) => {
      const r = await host.post(`/api/games/${game.id}/lifecycle`, { data: { lifecycle: to } });
      expect(r.status(), `transition to ${to}`).toBe(expected);
    };
    matrix.draft = await probe(f, game.id, circle.id);
    await move("paused", 409); // draft → paused is not a valid transition
    await move("coming_soon");
    matrix.coming_soon = await probe(f, game.id, circle.id);
    await move("active");
    expect((await f.actors.QA_USER.post(`/api/games/${game.id}/join`, { data: {} })).status()).toBe(200);
    matrix.active = await probe(f, game.id, circle.id);
    await move("paused");
    matrix.paused = await probe(f, game.id, circle.id);
    await move("coming_soon", 409);
    await move("active");
    matrix.resumed = await probe(f, game.id, circle.id);
    expect((await host.post(`/api/games/${game.id}/cancel`, { data: { reason: "QA weather" } })).status()).toBe(200);
    matrix.cancelled = await probe(f, game.id, circle.id);
    await move("archived");
    matrix.archived_after_cancel = await probe(f, game.id, circle.id);
    await move("active", 409); // archived is terminal
    expect((await f.actors.QA_USER.post(`/api/games/${game.id}/lifecycle`, { data: { lifecycle: "active" } })).status()).toBe(403);

    // completed is derived from date < today (never stored). Past dates are
    // rejected at creation (HC-QA-032), so age only this test-created row's
    // date — the same safe-control pattern as invitation/offer expiry.
    const past = await createActivity(f, "QA_HOST");
    await f.connection.execute("UPDATE games SET date = '2020-01-01' WHERE id = ?", [past.id]);
    matrix.completed_past_date = await probe(f, past.id, circle.id);

    for (const [state, expected] of Object.entries({
      draft: { ownerDetail: 200, publicDetail: 404, discovery: false, hostProfile: false, circleUpcoming: false, join: 404, waitlist: 404, updatesRead: 404 },
      coming_soon: { publicDetail: 200, discovery: true, hostProfile: true, circleUpcoming: true, join: 409, waitlist: 409, effective: "coming_soon" },
      active: { publicDetail: 200, discovery: true, hostProfile: true, circleUpcoming: true, circleNextPlan: true, participantJoined: true, participantMine: true, join: 200, waitlist: 201 },
      paused: { publicDetail: 200, discovery: true, circleUpcoming: true, participantJoined: true, join: 409, waitlist: 409, effective: "paused" },
      resumed: { effective: "active", join: 200 },
      cancelled: { status: "cancelled", effective: "cancelled", publicDetail: 200, discovery: false, hostProfile: false, circleUpcoming: false, circleNextPlan: false, participantMine: true, join: 409, waitlist: 409 },
      archived_after_cancel: { stored: "archived", ownerManage: true, discovery: false, hostProfile: false, circleUpcoming: false, join: 409, waitlist: 409 },
      completed_past_date: { effective: "completed", discovery: false, hostProfile: false, join: 409, waitlist: 409 },
    })) expect(matrix[state], state).toMatchObject(expected);

    // Cancellation notified the joined participant once, with the reason, linking to the activity.
    const cancelNotes = (await notificationsFor(f, "QA_USER", game.id)).filter(n => n.title.startsWith("Cancelled:"));
    expect(cancelNotes.length).toBe(1);
    expect(cancelNotes[0].body).toContain("QA weather");
    expect(hrefOf(cancelNotes[0])).toBe(`/games/${game.id}`);
    const share = await (await f.actors.QA_USER_B.get(`/api/share/game/${game.id}`)).json();
    expect(share.title).toContain("(Cancelled)");

    const outFile = path.join(manifest.dataDir, "evidence", "lc-act-state-matrix.json");
    writeFileSync(outFile, JSON.stringify(matrix, null, 2), { mode: 0o600 });
    await evidence("lc-act-states", { states: Object.keys(matrix).length, invalidTransitionsRejected: true, nonHostTransitionDenied: 403 });
  });
});

test("LC-ACT-UPDATES-CANCEL-ARCHIVE: updates, cancel with waitlist and archive of a live activity", async ({ playwright }) => {
  await withActors(playwright, ["QA_HOST", "QA_USER", "QA_USER_B"], async f => {
    const { QA_HOST: host, QA_USER: participant, QA_USER_B: outsider } = f.actors;
    // Part 20 — updates.
    const game = await createActivity(f, "QA_HOST", { capacity: 2 });
    expect((await participant.post(`/api/games/${game.id}/join`, { data: {} })).status()).toBe(200);
    for (const message of ["QA update one", "QA update two", "QA update three"]) expect((await host.post(`/api/games/${game.id}/updates`, { data: { message } })).status()).toBe(201);
    expect((await participant.post(`/api/games/${game.id}/updates`, { data: { message: "not host" } })).status()).toBe(403);
    expect((await host.post(`/api/games/${game.id}/updates`, { data: { message: "  " } })).status()).toBe(400);
    const read = await (await participant.get(`/api/games/${game.id}/updates`)).json();
    expect(read.map((u: any) => u.message).sort()).toEqual(["QA update one", "QA update three", "QA update two"]);
    expect((await outsider.get(`/api/games/${game.id}/updates`)).status()).toBe(200); // public activity → public updates
    const updateNotes = (await notificationsFor(f, "QA_USER", game.id)).filter(n => n.title.startsWith("Update:"));
    expect(updateNotes.map(n => n.body)).toEqual(["QA update one", "QA update two", "QA update three"]);
    expect(updateNotes.every(n => hrefOf(n) === `/games/${game.id}`)).toBe(true);
    expect((await notificationsFor(f, "QA_HOST", game.id)).filter(n => n.title.startsWith("Update:"))).toEqual([]);
    const privateGame = await createActivity(f, "QA_HOST", { visibility: "invite" });
    expect((await host.post(`/api/games/${privateGame.id}/updates`, { data: { message: "private" } })).status()).toBe(201);
    expect((await outsider.get(`/api/games/${privateGame.id}/updates`)).status()).toBe(404);

    // Part 22 — cancel with participant + waitlisted resident.
    expect((await outsider.post(`/api/games/${game.id}/waitlist`, { data: {} })).status()).toBe(201); // full: host + participant
    expect((await outsider.post(`/api/games/${game.id}/cancel`, { data: {} })).status()).toBe(403);
    expect((await host.post(`/api/games/${game.id}/cancel`, { data: {} })).status()).toBe(200);
    const detail = await (await participant.get(`/api/games/${game.id}`)).json();
    expect(detail).toMatchObject({ status: "cancelled", effectiveLifecycle: "cancelled", effectiveAvailability: "closed", joinedByMe: true });
    expect((await outsider.post(`/api/games/${game.id}/join`, { data: {} })).status()).toBe(409);
    expect((await outsider.post(`/api/games/${game.id}/waitlist`, { data: {} })).status()).toBe(409);
    expect(await ids(outsider, "/api/games")).not.toContain(game.id);
    expect((await host.put(`/api/games/${game.id}`, { data: { activityLabel: "x", date: "2030-07-15", time: "10:00", capacity: 5, locationText: "x" } })).status()).toBe(409);
    const hostMine = (await (await host.get("/api/games/mine?hostedOnly=1")).json()).find((g: any) => g.id === game.id);
    expect(hostMine.status).toBe("cancelled");
    const [wl] = await waitlist(f, game.id);
    const waitlistedNotes = await notificationsFor(f, "QA_USER_B", game.id);
    const recancel = await host.post(`/api/games/${game.id}/cancel`, { data: {} });
    const cancelNotesAfterSecondCancel = (await notificationsFor(f, "QA_USER", game.id)).filter(n => n.title.startsWith("Cancelled:")).length;

    // Part 23 — archive (API-only; no UI exposes archive).
    const live = await createActivity(f, "QA_HOST");
    expect((await participant.post(`/api/games/${live.id}/join`, { data: {} })).status()).toBe(200);
    // HC-QA-028: archive is administrative — blocked while others have joined; cancel (which notifies) first.
    expect((await host.post(`/api/games/${live.id}/lifecycle`, { data: { lifecycle: "archived" } })).status()).toBe(409);
    expect(await ids(outsider, "/api/games")).toContain(live.id);
    expect((await host.post(`/api/games/${live.id}/cancel`, { data: {} })).status()).toBe(200);
    expect((await host.post(`/api/games/${live.id}/lifecycle`, { data: { lifecycle: "archived" } })).status()).toBe(200);
    expect(await ids(outsider, "/api/games")).not.toContain(live.id);
    expect((await (await outsider.get(`/api/residents/${personas.QA_HOST.id}/host-profile`)).json()).upcomingGames.map((g: any) => g.id)).not.toContain(live.id);
    expect((await outsider.post(`/api/games/${live.id}/join`, { data: {} })).status()).toBe(409);
    const archivedDetail = await participant.get(`/api/games/${live.id}`);
    const archivedParticipantNotes = await notificationsFor(f, "QA_USER", live.id);
    const deleteRoute = await host.delete(`/api/games/${live.id}`);
    await evidence("lc-act-updates-cancel-archive", {
      updatesPersisted: 3, participantUpdateNotifications: updateNotes.length, updateReadOrder: read.map((u: any) => u.message).join("|"),
      cancelBlocksJoin: true, waitlistEntryStatusAfterCancel: wl?.status ?? "none", waitlistedNotifiedOfCancel: waitlistedNotes.length,
      secondCancelStatus: recancel.status(), participantCancelNotificationsAfterSecondCancel: cancelNotesAfterSecondCancel,
      archivedParticipantDetail: archivedDetail.status(), archivedStillJoined: (await joinedIds(f, live.id)).includes(personas.QA_USER.id),
      archivedParticipantNotified: archivedParticipantNotes.length, hardDeleteRouteStatus: deleteRoute.status(),
    });
  });
});
