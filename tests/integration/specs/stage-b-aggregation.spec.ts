import { randomUUID } from "node:crypto";
import { test, expect, personas } from "../fixtures";
import { withActors, evidence } from "../authorization-fixture";
import { FUTURE } from "../stage-b-fixture";

// Canonical references: GET /api/circles/:id (full vs restricted teaser) and
// GET /api/games/:id (404 when not viewable). Draft/scheduled/private game
// leaks through Circle and host-profile aggregation are preserved separately
// as HC-QA-011/012 in stage-b-findings.spec.ts.

test("STAGE-B-AGG-CIRCLES: Circle list and detail summaries follow membership visibility across transitions", async ({ playwright }) => {
  await withActors(playwright, ["QA_USER", "GUEST"], async (f) => {
    const secret = `QA members-only ${randomUUID()}`;
    const created = await f.actors.QA_USER.post("/api/circles", { data: { name: `QA aggregation ${randomUUID()}`, joinMode: "open", whatWeDo: secret, whoCanJoin: secret, values: secret } });
    expect(created.status()).toBe(201);
    const id = (await created.json()).id;
    for (const [table, column] of [["circles", "id"], ["circle_members", "circle_id"], ["circle_plans", "circle_id"]]) f.track(table, column, id);
    const plan = await f.actors.QA_USER.post(`/api/circles/${id}/plan-ideas`, { data: { title: secret } });
    expect(plan.status()).toBe(201);
    const listed = async () => ((await (await f.actors.GUEST.get("/api/circles")).json()) as any[]).find((row) => row.id === id);
    // PUBLIC -> appears with full content.
    expect(JSON.stringify(await listed()).includes(secret)).toBe(true);
    expect(JSON.stringify(await (await f.actors.GUEST.get(`/api/circles/${id}`)).json()).includes(secret)).toBe(true);
    const facts: Record<string, boolean | number> = {};
    for (const mode of ["approval", "invite"]) {
      expect((await f.actors.QA_USER.put(`/api/circles/${id}`, { data: { name: `QA aggregation ${mode}`, joinMode: mode } })).status()).toBe(200);
      const row = await listed();
      const detail = await (await f.actors.GUEST.get(`/api/circles/${id}`)).json();
      facts[`${mode}-listLeak`] = JSON.stringify(row ?? {}).includes(secret);
      facts[`${mode}-detailLeak`] = JSON.stringify(detail).includes(secret);
      facts[`${mode}-restricted`] = detail.restricted === true && detail.activePlan === null && detail.nextPlan === null;
      facts[`${mode}-planIdeas`] = (await f.actors.GUEST.get(`/api/circles/${id}/plan-ideas`)).status();
      facts[`${mode}-upcoming`] = (await f.actors.GUEST.get(`/api/circles/${id}/upcoming`)).status();
      expect(facts[`${mode}-listLeak`] || facts[`${mode}-detailLeak`], `${mode}: protected Circle content disappears`).toBe(false);
      expect(facts[`${mode}-restricted`]).toBe(true);
      expect(facts[`${mode}-planIdeas`]).toBe(403);
      expect(facts[`${mode}-upcoming`]).toBe(403);
    }
    await evidence("stage-b-agg-circles", facts);
  });
});

test("STAGE-B-AGG-HOST-PROFILE: host profile and public list exclude private activities and non-open Circles across transitions", async ({ playwright }) => {
  await withActors(playwright, ["QA_HOST", "GUEST"], async (f) => {
    const game = async (visibility: string) => {
      const created = await f.actors.QA_HOST.post("/api/games", { data: { activityLabel: `QA profile ${randomUUID()}`, date: FUTURE, time: "12:00", capacity: 6, locationText: "Synthetic QA venue", priceCents: 0, visibility, lifecycle: "active" } });
      expect(created.status()).toBe(201);
      const id = (await created.json()).id as string;
      for (const [table, column] of [["games", "id"], ["game_participants", "game_id"], ["listing_attributes", "listing_id"]]) f.track(table, column, id);
      return id;
    };
    const invite = await game("invite"), live = await game("public");
    const circles: Record<string, string> = {};
    for (const joinMode of ["open", "invite"]) {
      const created = await f.actors.QA_HOST.post("/api/circles", { data: { name: `QA host circle ${randomUUID()}`, joinMode } });
      circles[joinMode] = (await created.json()).id;
      f.track("circles", "id", circles[joinMode]); f.track("circle_members", "circle_id", circles[joinMode]);
    }
    const profile = async () => (await (await f.actors.GUEST.get(`/api/residents/${personas.QA_HOST.id}/host-profile`)).json()) as { upcomingGames: { id: string }[]; circles: { id: string }[] };
    const list = async () => ((await (await f.actors.GUEST.get("/api/games")).json()) as { id: string }[]).map((g) => g.id);
    let p = await profile();
    expect(p.upcomingGames.some((g) => g.id === live) && !p.upcomingGames.some((g) => g.id === invite)).toBe(true);
    expect(p.circles.some((c) => c.id === circles.open) && !p.circles.some((c) => c.id === circles.invite)).toBe(true);
    expect((await list()).includes(live) && !(await list()).includes(invite)).toBe(true);
    // PUBLIC -> aggregated -> changed to private: disappears everywhere.
    expect((await f.actors.QA_HOST.put(`/api/games/${live}`, { data: { activityLabel: "QA now private", date: FUTURE, time: "12:00", capacity: 6, locationText: "Synthetic QA venue", priceCents: 0, visibility: "invite" } })).status()).toBe(200);
    expect((await f.actors.QA_HOST.put(`/api/circles/${circles.open}`, { data: { name: "QA now invite", joinMode: "invite" } })).status()).toBe(200);
    p = await profile();
    const facts = {
      privateGameOnProfile: p.upcomingGames.some((g) => g.id === live),
      privateGameInList: (await list()).includes(live),
      privateCircleOnProfile: p.circles.some((c) => c.id === circles.open),
      canonical: (await f.actors.GUEST.get(`/api/games/${live}`)).status(),
    };
    await evidence("stage-b-agg-host-profile", facts);
    expect(facts.canonical).toBe(404);
    expect(facts.privateGameOnProfile || facts.privateGameInList || facts.privateCircleOnProfile).toBe(false);
  });
});

