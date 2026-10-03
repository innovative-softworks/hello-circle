import { randomUUID } from "node:crypto";
import type { APIRequestContext } from "@playwright/test";
import { test, expect, personas } from "../fixtures";
import { withActors, evidence } from "../authorization-fixture";
import { centreFor, clubFor } from "../stage-b-fixture";

// Remediation coverage for the canonical activity visibility policy
// (server/src/gameVisibility.ts): canViewGame() for detail/relationship views,
// discoverableGameSql() for discovery/aggregation/counts. Complements the
// unchanged HC-QA-010..015 regressions in stage-b-findings.spec.ts.

type Scope = Parameters<Parameters<typeof withActors>[2]>[0];
const day = (offset: number) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
const at = (offsetDays: number) => new Date(Date.now() + offsetDays * 86400000).toISOString().slice(0, 19).replace("T", " ");
async function game(f: Scope, role: string, input: Record<string, unknown>) {
  const created = await f.actors[role].post("/api/games", { data: { activityLabel: `QA vis ${randomUUID()}`, date: day(5), time: "12:00", capacity: 6, locationText: "Synthetic QA venue", priceCents: 0, ...input } });
  expect(created.status(), "activity created").toBe(201);
  const id = (await created.json()).id as string;
  for (const [table, column] of [["games", "id"], ["game_participants", "game_id"], ["game_updates", "game_id"], ["listing_attributes", "listing_id"], ["notifications", "listing_id"], ["invitations", "entity_id"]]) f.track(table, column, id);
  return id;
}
const text = async (actor: APIRequestContext, path: string) => (await actor.get(path)).text();

test("VIS-010-TRANSITION: participants/updates follow canonical visibility for viewers, invitees and hosts across public→private", async ({ playwright }) => {
  await withActors(playwright, ["QA_HOST", "QA_USER", "QA_USER_B", "GUEST"], async (f) => {
    const id = await game(f, "QA_HOST", { visibility: "public", lifecycle: "active" });
    const marker = `QA transition update ${randomUUID()}`;
    expect((await f.actors.QA_HOST.post(`/api/games/${id}/updates`, { data: { message: marker } })).status()).toBe(201);
    await f.connection.execute("INSERT INTO invitations (id, token, entity_type, entity_id, inviter_resident_id, invitee_resident_id, expires_at) VALUES (?, ?, 'game', ?, ?, ?, DATE_ADD(NOW(), INTERVAL 1 DAY))", [randomUUID(), randomUUID(), id, personas.QA_HOST.id, personas.QA_USER.id]);
    const facts: Record<string, number> = {};
    for (const role of ["GUEST", "QA_USER_B", "QA_USER", "QA_HOST"]) {
      facts[`public-${role}-participants`] = (await f.actors[role].get(`/api/games/${id}/participants`)).status();
      facts[`public-${role}-updates`] = (await f.actors[role].get(`/api/games/${id}/updates`)).status();
    }
    expect(Object.values(facts).every((s) => s === 200), "Public activity children readable").toBe(true);
    // PUBLIC -> invite-only: unauthorized callers lose every child read.
    expect((await f.actors.QA_HOST.put(`/api/games/${id}`, { data: { activityLabel: "QA now private", date: day(5), time: "12:00", capacity: 6, locationText: "Synthetic QA venue", priceCents: 0, visibility: "invite" } })).status()).toBe(200);
    for (const role of ["GUEST", "QA_USER_B", "QA_USER", "QA_HOST"]) {
      const participants = await f.actors[role].get(`/api/games/${id}/participants`);
      const updates = await f.actors[role].get(`/api/games/${id}/updates`);
      facts[`private-${role}-participants`] = participants.status();
      facts[`private-${role}-updates`] = updates.status();
      facts[`private-${role}-canonical`] = (await f.actors[role].get(`/api/games/${id}`)).status();
      if (["GUEST", "QA_USER_B"].includes(role)) expect((await updates.text()).includes(marker)).toBe(false);
    }
    await evidence("vis-010-transition", facts);
    for (const role of ["GUEST", "QA_USER_B"]) for (const read of ["participants", "updates", "canonical"]) expect(facts[`private-${role}-${read}`], `${role} ${read}`).toBe(404);
    // Invitee and host follow the canonical detail policy (allowed).
    for (const role of ["QA_USER", "QA_HOST"]) for (const read of ["participants", "updates", "canonical"]) expect(facts[`private-${role}-${read}`], `${role} ${read}`).toBe(200);
  });
});

test("VIS-011-CIRCLE: Circle plans use the circle_id relationship per viewer; label matches are public-only; protected IDs never appear", async ({ playwright }) => {
  await withActors(playwright, ["QA_USER", "QA_USER_B", "QA_HOST_B", "GUEST"], async (f) => {
    const label = `QA circle vis ${randomUUID().slice(0, 8)}`;
    const created = await f.actors.QA_USER.post("/api/circles", { data: { name: `QA vis ${randomUUID()}`, joinMode: "open", activityLabel: label } });
    const circle = (await created.json()).id;
    f.track("circles", "id", circle); f.track("circle_members", "circle_id", circle);
    await f.connection.execute("INSERT INTO circle_members (circle_id, resident_id, role) VALUES (?, ?, 'member')", [circle, personas.QA_USER_B.id]);
    // Circle-owned (authoritative circle_id): members-only and organiser draft.
    const circleOnly = await game(f, "QA_USER", { activityLabel: label, visibility: "circle", lifecycle: "active", circleId: circle, date: day(2) });
    const circleDraft = await game(f, "QA_USER", { activityLabel: label, visibility: "public", lifecycle: "draft", circleId: circle, date: day(1) });
    // Unrelated host, same label: legitimate public vs protected.
    const publicNearby = await game(f, "QA_HOST_B", { activityLabel: label, visibility: "public", lifecycle: "active", date: day(3) });
    const inviteNearby = await game(f, "QA_HOST_B", { activityLabel: label, visibility: "invite", lifecycle: "active", date: day(1) });
    const draftNearby = await game(f, "QA_HOST_B", { activityLabel: label, visibility: "public", lifecycle: "draft", date: day(1) });
    const scheduledNearby = await game(f, "QA_HOST_B", { activityLabel: label, visibility: "public", lifecycle: "active", publishAt: at(30), date: day(1) });
    const protectedFromGuest = [circleOnly, circleDraft, inviteNearby, draftNearby, scheduledNearby];
    const surfaces = async (actor: APIRequestContext) => [await text(actor, `/api/circles/${circle}/upcoming`), await text(actor, `/api/circles/${circle}`), await text(actor, "/api/circles")].join("\n");
    const guest = await surfaces(f.actors.GUEST);
    const member = await surfaces(f.actors.QA_USER_B);
    const organiserPlans = await text(f.actors.QA_USER, `/api/circles/${circle}/plans`);
    const facts: Record<string, boolean> = {
      guestSeesPublicNearby: guest.includes(publicNearby),
      guestLeaksProtectedId: protectedFromGuest.some((id) => guest.includes(id)),
      memberSeesCircleOnly: member.includes(circleOnly),
      memberLeaksDraftOrUnrelatedProtected: [circleDraft, inviteNearby, draftNearby, scheduledNearby].some((id) => member.includes(id)),
      organiserPlansIncludeOwnDraft: organiserPlans.includes(circleDraft),
    };
    // PUBLIC -> private transition of the legitimate nearby activity.
    expect((await f.actors.QA_HOST_B.put(`/api/games/${publicNearby}`, { data: { activityLabel: label, date: day(3), time: "12:00", capacity: 6, locationText: "Synthetic QA venue", priceCents: 0, visibility: "invite" } })).status()).toBe(200);
    facts.guestSeesAfterPrivate = (await surfaces(f.actors.GUEST)).includes(publicNearby);
    await evidence("vis-011-circle", facts);
    expect(facts.guestSeesPublicNearby && facts.memberSeesCircleOnly && facts.organiserPlansIncludeOwnDraft, "legitimate visibility preserved").toBe(true);
    expect(facts.guestLeaksProtectedId || facts.memberLeaksDraftOrUnrelatedProtected || facts.guestSeesAfterPrivate, "protected activity IDs never aggregated").toBe(false);
  });
});

test("VIS-012-SCHEDULED: future publish_at is draft on every migrated discovery surface; owner views preserved", async ({ playwright }) => {
  await withActors(playwright, ["QA_HOST", "QA_USER", "GUEST"], async (f) => {
    const label = `QA scheduled ${randomUUID().slice(0, 8)}`;
    const live = await game(f, "QA_HOST", { activityLabel: label, visibility: "public", lifecycle: "active", date: day(3) });
    const scheduled = await game(f, "QA_HOST", { activityLabel: label, visibility: "public", lifecycle: "active", publishAt: at(2), date: day(4) });
    const draft = await game(f, "QA_HOST", { activityLabel: label, visibility: "public", lifecycle: "draft", date: day(4) });
    // Participant context for next-steps: joined only `other` (next-steps
    // excludes activities the viewer already joined, so `live` stays a control).
    const other = await game(f, "QA_HOST", { activityLabel: label, visibility: "public", lifecycle: "active", date: day(2) });
    await f.connection.execute("INSERT INTO game_participants (game_id, resident_id, status) VALUES (?, ?, 'joined')", [other, personas.QA_USER.id]);
    const G = f.actors.GUEST;
    const surfaces: Record<string, string> = {
      list: await text(G, "/api/games"),
      hostProfile: await text(G, `/api/residents/${personas.QA_HOST.id}/host-profile`),
      discover: await text(G, "/api/discover"),
      search: await text(G, `/api/search?q=${encodeURIComponent(label)}`),
      share: await text(G, `/api/share/game/${scheduled}`),
      nextSteps: await text(f.actors.QA_USER, `/api/games/${other}/next-steps`),
    };
    const facts: Record<string, boolean | number> = { canonicalScheduled: (await G.get(`/api/games/${scheduled}`)).status(), ownerSeesScheduled: (await f.actors.QA_HOST.get(`/api/games/${scheduled}`)).status() };
    for (const [name, body] of Object.entries(surfaces)) {
      facts[`${name}-scheduled`] = body.includes(scheduled);
      facts[`${name}-draft`] = body.includes(draft);
      facts[`${name}-live`] = body.includes(live);
    }
    const mine = await text(f.actors.QA_HOST, "/api/games/mine");
    facts.ownerMineIncludesScheduledAndDraft = mine.includes(scheduled) && mine.includes(draft);
    await evidence("vis-012-scheduled", facts);
    expect(facts.canonicalScheduled).toBe(404);
    expect(facts.ownerSeesScheduled).toBe(200);
    expect(facts.ownerMineIncludesScheduledAndDraft).toBe(true);
    expect(facts["list-live"] && facts["hostProfile-live"] && facts["nextSteps-live"], "controls present").toBe(true);
    for (const name of Object.keys(surfaces)) {
      expect(facts[`${name}-scheduled`], `${name} scheduled`).toBe(false);
      expect(facts[`${name}-draft`], `${name} draft`).toBe(false);
    }
  });
});

