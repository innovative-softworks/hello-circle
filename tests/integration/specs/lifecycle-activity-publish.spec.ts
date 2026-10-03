import { expect, personas } from "../fixtures";
import { evidence } from "../authorization-fixture";
import { test, withActors } from "../lifecycle-fixture";
import { createActivity, rows, publicSurfaces, inSurfaces, notificationsFor, hrefOf, ids } from "../lifecycle-fixture";

// Phase 7 — Parts 1-5. HOST_A = QA_HOST, USER_A = QA_USER, USER_B = QA_USER_B.
// Free synthetic activities only; no payment provider involved.

test("LC-ACT-CREATE-DRAFT-PUBLISH: create defaults, draft privacy, draft edit, publish and secondary surfaces", async ({ playwright }) => {
  await withActors(playwright, ["QA_HOST", "QA_USER_B", "GUEST"], async f => {
    const host = f.actors.QA_HOST, outsider = f.actors.QA_USER_B, guest = f.actors.GUEST;
    const hostId = personas.QA_HOST.id;
    const baseline = await publicSurfaces(guest, hostId);

    // Part 1 — create with defaults (omit lifecycle/visibility) as the real host session.
    const created = await createActivity(f, "QA_HOST", { durationMinutes: 60, skillLevel: "Beginner", equipmentNeeded: "Water", meetingInstructions: "QA gate B" });
    expect(created.hostResidentId).toBe(hostId);
    expect(created.lifecycle).toBe("active");
    expect(created.visibility).toBe("public");
    expect(created.effectiveLifecycle).toBe("active");
    expect(created.status).toBe("open");
    expect(created.joined).toBe(1); // host auto-joined, takes one spot
    expect(created.spotsLeft).toBe(7);
    const [db] = await rows(f, "SELECT host_resident_id, lifecycle, visibility, status, capacity, price_cents, circle_id, publish_at FROM games WHERE id = ?", [created.id]);
    expect(db).toMatchObject({ host_resident_id: hostId, lifecycle: "active", visibility: "public", status: "open", capacity: 8, price_cents: null, circle_id: null, publish_at: null });
    expect((await rows(f, "SELECT resident_id FROM game_participants WHERE game_id = ? AND status = 'joined'", [created.id])).map(r => r.resident_id)).toEqual([hostId]);
    const anonDetail = await (await guest.get(`/api/games/${created.id}`)).json();
    expect(anonDetail.meetingInstructions).toBeNull(); // exact meeting point is participant-only
    expect((await (await host.get(`/api/games/${created.id}`)).json()).meetingInstructions).toBe("QA gate B");
    const afterCreate = await publicSurfaces(guest, hostId);
    expect(inSurfaces(afterCreate.surfaces, created.id)).toEqual({ list: true, hostProfile: true });

    // Part 2 — draft.
    const draft = await createActivity(f, "QA_HOST", { lifecycle: "draft" });
    expect(draft.lifecycle).toBe("draft");
    expect(draft.effectiveLifecycle).toBe("draft");
    expect(draft.effectiveAvailability).toBe("not_open");
    expect(await ids(host, "/api/games/mine?hostedOnly=1")).toContain(draft.id);
    expect((await host.get(`/api/games/${draft.id}`)).status()).toBe(200);
    for (const actor of [outsider, guest]) {
      for (const suffix of ["", "/participants", "/updates", "/ics"]) expect((await actor.get(`/api/games/${draft.id}${suffix}`)).status(), `draft ${suffix}`).toBe(404);
      expect((await actor.get(`/api/share/game/${draft.id}`)).status()).toBe(404);
    }
    for (const action of ["join", "waitlist"]) expect((await outsider.post(`/api/games/${draft.id}/${action}`, { data: {} })).status(), `draft ${action}`).toBe(404);
    const withDraft = await publicSurfaces(guest, hostId);
    expect(inSurfaces(withDraft.surfaces, draft.id)).toEqual({ list: false, hostProfile: false });
    expect(await rows(f, "SELECT id FROM game_participants WHERE game_id = ? AND resident_id = ?", [draft.id, personas.QA_USER_B.id])).toEqual([]);
    expect(await rows(f, "SELECT id FROM waitlist_entries WHERE listing_id = ?", [draft.id])).toEqual([]);
    // Draft edit persists and stays private.
    const edit = await host.put(`/api/games/${draft.id}`, { data: { activityLabel: `${draft.activityLabel} edited`, date: "2030-07-16", time: "19:00", capacity: 6, locationText: "QA edited park", description: "Edited draft" } });
    expect(edit.status()).toBe(200);
    const [draftDb] = await rows(f, "SELECT activity_label, date, time, capacity, location_text, description, lifecycle FROM games WHERE id = ?", [draft.id]);
    expect(draftDb).toMatchObject({ activity_label: `${draft.activityLabel} edited`, date: "2030-07-16", time: "19:00", capacity: 6, location_text: "QA edited park", description: "Edited draft", lifecycle: "draft" });
    expect((await outsider.get(`/api/games/${draft.id}`)).status()).toBe(404);

    // Part 3 — publish through the lifecycle endpoint the host UI uses.
    const published = await host.post(`/api/games/${draft.id}/lifecycle`, { data: { lifecycle: "active" } });
    expect(published.status()).toBe(200);
    expect((await published.json()).effectiveLifecycle).toBe("active");
    const outsiderView = await outsider.get(`/api/games/${draft.id}`);
    expect(outsiderView.status()).toBe(200);
    expect((await outsiderView.json()).activityLabel).toBe(`${draft.activityLabel} edited`);
    const afterPublish = await publicSurfaces(guest, hostId);
    expect(inSurfaces(afterPublish.surfaces, draft.id)).toEqual({ list: true, hostProfile: true });
    const share = await guest.get(`/api/share/game/${draft.id}`);
    expect(share.status()).toBe(200);
    expect((await share.json()).title).toContain(`${draft.activityLabel} edited`);
    await evidence("lc-act-create-draft-publish", {
      defaultLifecycleActive: true, defaultVisibilityPublic: true, hostAutoJoined: true,
      draftHiddenFromOutsider: true, draftEditPersisted: true, publishedVisible: true,
      gamesHostedTotalBaseline: baseline.gamesHostedTotal, gamesHostedTotalAfterPublicCreate: afterCreate.gamesHostedTotal,
      gamesHostedTotalWithDraft: withDraft.gamesHostedTotal,
    });
  });
});

test("LC-ACT-SCHEDULED-COMING-SOON: publish_at and coming-soon transitions on real read-time lifecycle", async ({ playwright }) => {
  test.setTimeout(90_000);
  await withActors(playwright, ["QA_HOST", "QA_USER_B"], async f => {
    const host = f.actors.QA_HOST, outsider = f.actors.QA_USER_B;
    // Existing safe mechanism: effective lifecycle is derived at read time
    // from publish_at vs. the real clock. A near-future publish_at reaches
    // publication by waiting — no clock or row manipulation.
    const at = new Date(Date.now() + 12_000);
    const publishAt = at.toISOString().slice(0, 19).replace("T", " ");
    const scheduled = await createActivity(f, "QA_HOST", { publishAt });
    expect(scheduled.lifecycle).toBe("active");
    expect(scheduled.effectiveLifecycle).toBe("draft");
    expect((await host.get(`/api/games/${scheduled.id}`)).status()).toBe(200);
    expect(await ids(host, "/api/games/mine?hostedOnly=1")).toContain(scheduled.id);
    expect((await outsider.get(`/api/games/${scheduled.id}`)).status()).toBe(404);
    expect(await ids(outsider, "/api/games")).not.toContain(scheduled.id);
    expect((await outsider.get(`/api/share/game/${scheduled.id}`)).status()).toBe(404);
    expect((await outsider.post(`/api/games/${scheduled.id}/join`, { data: {} })).status()).toBe(404);
    const profileBefore = await (await outsider.get(`/api/residents/${personas.QA_HOST.id}/host-profile`)).json();
    expect(profileBefore.upcomingGames.map((g: any) => g.id)).not.toContain(scheduled.id);

    await expect.poll(async () => (await outsider.get(`/api/games/${scheduled.id}`)).status(), { timeout: 30_000, intervals: [1_000] }).toBe(200);
    expect((await (await outsider.get(`/api/games/${scheduled.id}`)).json()).effectiveLifecycle).toBe("active");
    expect(await ids(outsider, "/api/games")).toContain(scheduled.id);
    expect((await outsider.get(`/api/share/game/${scheduled.id}`)).status()).toBe(200);
    expect((await outsider.post(`/api/games/${scheduled.id}/join`, { data: {} })).status()).toBe(200);
    const [stored] = await rows(f, "SELECT lifecycle FROM games WHERE id = ?", [scheduled.id]);
    expect(stored.lifecycle).toBe("active"); // never silently rewritten by a job

    // Coming soon: announced and discoverable, but not bookable until opened.
    const soon = await createActivity(f, "QA_HOST", { lifecycle: "coming_soon" });
    expect(soon.effectiveAvailability).toBe("not_open");
    expect((await outsider.get(`/api/games/${soon.id}`)).status()).toBe(200);
    expect(await ids(outsider, "/api/games")).toContain(soon.id);
    for (const action of ["join", "waitlist"]) {
      const r = await outsider.post(`/api/games/${soon.id}/${action}`, { data: {} });
      expect(r.status(), `coming soon ${action}`).toBe(409);
    }
    expect((await outsider.post(`/api/games/${soon.id}/notify-me`, { data: {} })).status()).toBe(201);
    expect((await host.post(`/api/games/${soon.id}/lifecycle`, { data: { lifecycle: "active" } })).status()).toBe(200);
    const [notify] = await rows(f, "SELECT notified_at FROM notify_me_subscriptions WHERE resident_id = ? AND entity_id = ?", [personas.QA_USER_B.id, soon.id]);
    expect(notify?.notified_at, "notify-me subscriber marked notified on open").toBeTruthy();
    const notes = await notificationsFor(f, "QA_USER_B", soon.id);
    expect(notes.length).toBe(1);
    expect(hrefOf(notes[0])).toBe(`/games/${soon.id}`);
    expect((await outsider.post(`/api/games/${soon.id}/join`, { data: {} })).status()).toBe(200);
    await evidence("lc-act-scheduled", { hiddenBeforePublishAt: true, visibleAfterPublishAt: true, storedLifecycleUnchanged: true, comingSoonNotBookable: true, notifyMeFiredOnce: notes.length });
  });
});

test("LC-ACT-EDIT: published edits propagate to detail, host, participant, discovery and share surfaces", async ({ playwright }) => {
  await withActors(playwright, ["QA_HOST", "QA_USER", "QA_USER_B"], async f => {
    const host = f.actors.QA_HOST, participant = f.actors.QA_USER, outsider = f.actors.QA_USER_B;
    const game = await createActivity(f, "QA_HOST", { capacity: 6 });
    expect((await participant.post(`/api/games/${game.id}/join`, { data: {} })).status()).toBe(200);
    const newLabel = `${game.activityLabel} renamed`;
    const put = await host.put(`/api/games/${game.id}`, { data: { activityLabel: newLabel, description: "New description", date: "2030-08-01", time: "10:15", capacity: 10, locationText: "QA new pitch" } });
    expect(put.status()).toBe(200);
    const detail = await (await outsider.get(`/api/games/${game.id}`)).json();
    expect(detail).toMatchObject({ activityLabel: newLabel, description: "New description", date: "2030-08-01", time: "10:15", capacity: 10, locationText: "QA new pitch", joined: 2, spotsLeft: 8 });
    const hostMine = (await (await host.get("/api/games/mine?hostedOnly=1")).json()).find((g: any) => g.id === game.id);
    const participantMine = (await (await participant.get("/api/games/mine")).json()).find((g: any) => g.id === game.id);
    const listed = (await (await outsider.get("/api/games")).json()).find((g: any) => g.id === game.id);
    const profile = (await (await outsider.get(`/api/residents/${personas.QA_HOST.id}/host-profile`)).json()).upcomingGames.find((g: any) => g.id === game.id);
    const share = await (await outsider.get(`/api/share/game/${game.id}`)).json();
    for (const [name, view] of Object.entries({ hostMine, participantMine, listed })) expect(view, name).toMatchObject({ activityLabel: newLabel, date: "2030-08-01", time: "10:15", capacity: 10 });
    expect(profile).toMatchObject({ activityLabel: newLabel, date: "2030-08-01", time: "10:15" });
    expect(share.title).toContain(newLabel);
    // Material change notifies the joined participant exactly once; host is not self-notified.
    const notes = await notificationsFor(f, "QA_USER", game.id);
    expect(notes.map(n => n.title)).toEqual([`Plan updated: ${newLabel}`]);
    expect(hrefOf(notes[0])).toBe(`/games/${game.id}`);
    expect(await notificationsFor(f, "QA_HOST", game.id)).toEqual([]);
    // Capacity cannot drop below joined; a non-material edit does not notify.
    expect((await host.put(`/api/games/${game.id}`, { data: { activityLabel: newLabel, date: "2030-08-01", time: "10:15", capacity: 1, locationText: "QA new pitch" } })).status()).toBe(409);
    expect((await host.put(`/api/games/${game.id}`, { data: { activityLabel: newLabel, description: "Only text", date: "2030-08-01", time: "10:15", capacity: 10, locationText: "QA new pitch" } })).status()).toBe(200);
    expect((await notificationsFor(f, "QA_USER", game.id)).length).toBe(1);
    // Visibility edit: public -> invite. Existing participant keeps access; outsider and discovery lose it.
    expect((await host.put(`/api/games/${game.id}`, { data: { activityLabel: newLabel, date: "2030-08-01", time: "10:15", capacity: 10, locationText: "QA new pitch", visibility: "invite" } })).status()).toBe(200);
    expect((await outsider.get(`/api/games/${game.id}`)).status()).toBe(404);
    expect(await ids(outsider, "/api/games")).not.toContain(game.id);
    expect((await (await outsider.get(`/api/residents/${personas.QA_HOST.id}/host-profile`)).json()).upcomingGames.map((g: any) => g.id)).not.toContain(game.id);
    expect((await participant.get(`/api/games/${game.id}`)).status()).toBe(200);
    // Non-host cannot edit.
    expect((await outsider.put(`/api/games/${game.id}`, { data: { activityLabel: "x", date: "2030-08-01", time: "10:15", capacity: 10, locationText: "x" } })).status()).toBe(403);
    await evidence("lc-act-edit", { surfacesConsistent: true, participantNotifications: 1, visibilityEditApplied: true });
  });
});
