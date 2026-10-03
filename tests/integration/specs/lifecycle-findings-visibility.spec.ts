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

test("HC-QA-023: a plan created for an invite-only Circle through the organiser UI payload is not publicly discoverable", async ({ playwright }) => {
  await withActors(playwright, ["QA_HOST", "GUEST"], async f => {
    const circle = await createCircle(f, "QA_HOST", { joinMode: "invite" });
    // Exactly what HostGamePage sends for "Create first plan": circleId, no visibility field.
    const plan = await createActivity(f, "QA_HOST", { circleId: circle.id });
    const listed = (await (await f.actors.GUEST.get("/api/games")).json()).find((g: any) => g.id === plan.id);
    await evidence("hc-qa-023", { storedVisibility: plan.visibility, anonymousListed: !!listed, circleNameExposed: !!listed?.circleName });
    expect(listed, "invite-only Circle plan must not appear in anonymous discovery").toBeUndefined();
  });
});

test("HC-QA-023-INHERIT: UI-created Circle plans inherit Circle visibility across every surface", async ({ playwright }) => {
  await withActors(playwright, ["QA_HOST", "QA_USER", "QA_USER_B", "GUEST"], async f => {
    const { QA_HOST: organiser, QA_USER: member, QA_USER_B: outsider, GUEST: guest } = f.actors;
    const result: Record<string, unknown> = {};
    for (const [mode, expected] of [["open", "public"], ["approval", "circle"], ["invite", "circle"]] as const) {
      const circle = await createCircle(f, "QA_HOST", { joinMode: mode });
      expect((await organiser.post(`/api/circles/${circle.id}/invite`, { data: { residentId: personas.QA_USER.id } })).status()).toBe(201);
      expect((await member.post(`/api/circles/${circle.id}/join`, { data: {} })).status()).toBe(201);
      const plan = await createActivity(f, "QA_HOST", { circleId: circle.id }); // exact UI payload: no visibility
      expect(plan.visibility, mode).toBe(expected);
      const isPublic = expected === "public";
      const anonList = (await (await guest.get("/api/games")).json()).map((g: any) => g.id);
      const profile = (await (await guest.get(`/api/residents/${personas.QA_HOST.id}/host-profile`)).json()).upcomingGames.map((g: any) => g.id);
      const share = await (await outsider.get(`/api/share/game/${plan.id}`)).json();
      const facts = {
        anonymousDetail: (await guest.get(`/api/games/${plan.id}`)).status(),
        outsiderDetail: (await outsider.get(`/api/games/${plan.id}`)).status(),
        memberDetail: (await member.get(`/api/games/${plan.id}`)).status(),
        discovery: anonList.includes(plan.id),
        hostProfile: profile.includes(plan.id),
        organiserPlans: (await (await organiser.get(`/api/circles/${circle.id}/plans`)).json()).some((g: any) => g.id === plan.id),
        memberUpcoming: (await (await member.get(`/api/circles/${circle.id}/upcoming`)).json()).some((g: any) => g.id === plan.id),
        memberNextPlan: (await (await member.get(`/api/circles/${circle.id}`)).json()).nextPlan?.id === plan.id,
        shareFull: share.title === plan.activityLabel || String(share.title).includes(plan.activityLabel),
        outsiderJoin: (await outsider.post(`/api/games/${plan.id}/join`, { data: {} })).status(),
        memberJoin: (await member.post(`/api/games/${plan.id}/join`, { data: {} })).status(),
      };
      result[mode] = facts;
      expect(facts).toEqual({
        anonymousDetail: isPublic ? 200 : 404, outsiderDetail: isPublic ? 200 : 404, memberDetail: 200,
        discovery: isPublic, hostProfile: isPublic, organiserPlans: true, memberUpcoming: true, memberNextPlan: true,
        shareFull: isPublic, outsiderJoin: isPublic ? 200 : 404, memberJoin: 200,
      });
    }
    // Explicit, valid visibility is honoured; unknown values are rejected.
    const invite = await createCircle(f, "QA_HOST", { joinMode: "invite" });
    expect((await createActivity(f, "QA_HOST", { circleId: invite.id, visibility: "invite" })).visibility).toBe("invite");
    expect((await organiser.post("/api/games", { data: { activityLabel: "x", date: "2030-07-15", time: "10:00", capacity: 4, locationText: "x", visibility: "everyone" } })).status()).toBe(400);
    await evidence("hc-qa-023-inherit", { matrix: JSON.stringify(result) });
  });
});

test("HC-QA-030: public host profile counts only publicly discoverable activities", async ({ playwright }) => {
  await withActors(playwright, ["QA_HOST", "GUEST"], async f => {
    const count = async () => Number((await (await f.actors.GUEST.get(`/api/residents/${personas.QA_HOST.id}/host-profile`)).json()).gamesHostedTotal);
    const before = await count();
    await createActivity(f, "QA_HOST", { lifecycle: "draft" });
    await createActivity(f, "QA_HOST", { visibility: "invite" });
    const after = await count();
    await evidence("hc-qa-030", { before, afterDraftAndPrivate: after });
    expect(after).toBe(before);
  });
});

test("HC-QA-030-TRANSITIONS: public count tracks discoverability through create, publish and visibility changes", async ({ playwright }) => {
  await withActors(playwright, ["QA_HOST", "GUEST"], async f => {
    const host = f.actors.QA_HOST;
    const count = async () => Number((await (await f.actors.GUEST.get(`/api/residents/${personas.QA_HOST.id}/host-profile`)).json()).gamesHostedTotal);
    const base = await count();
    const pub = await createActivity(f, "QA_HOST");
    expect(await count()).toBe(base + 1);
    const draft = await createActivity(f, "QA_HOST", { lifecycle: "draft" });
    await createActivity(f, "QA_HOST", { visibility: "invite" });
    await createActivity(f, "QA_HOST", { publishAt: "2030-01-01 00:00:00" });
    expect(await count()).toBe(base + 1);
    expect((await host.post(`/api/games/${draft.id}/lifecycle`, { data: { lifecycle: "active" } })).status()).toBe(200);
    expect(await count()).toBe(base + 2);
    expect((await host.put(`/api/games/${pub.id}`, { data: { activityLabel: pub.activityLabel, date: "2030-07-15", time: "18:30", capacity: 8, locationText: "QA synthetic park", visibility: "invite" } })).status()).toBe(200);
    expect(await count()).toBe(base + 1);
    expect((await host.post(`/api/games/${draft.id}/cancel`, { data: {} })).status()).toBe(200);
    expect(await count()).toBe(base);
  });
});
