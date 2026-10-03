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

test("VIS-COUNTS: public counts do not change when protected activities are created", async ({ playwright }) => {
  await withActors(playwright, ["QA_VENDOR", "QA_USER", "QA_HOST_B", "GUEST"], async (f) => {
    const centre = await centreFor(f, "QA_VENDOR");
    const label = `QA counts ${randomUUID().slice(0, 8)}`;
    const created = await f.actors.QA_USER.post("/api/circles", { data: { name: `QA counts ${randomUUID()}`, joinMode: "open", activityLabel: label } });
    const circle = (await created.json()).id;
    f.track("circles", "id", circle); f.track("circle_members", "circle_id", circle);
    const counts = async () => {
      const momentum = await text(f.actors.GUEST, "/api/discover/momentum");
      const detail = await (await f.actors.GUEST.get(`/api/circles/${circle}`)).json();
      const activity = await (await f.actors.GUEST.get(`/api/circles/${circle}/activity`)).json();
      return { momentumHasLabel: momentum.includes(label), plansThisMonth: Number(detail.plansThisMonth), plansCreated: Number(activity.plansCreated) };
    };
    const before = await counts();
    const today = new Date().toISOString().slice(0, 10);
    for (const input of [{ visibility: "invite", lifecycle: "active" }, { visibility: "public", lifecycle: "draft" }, { visibility: "public", lifecycle: "active", publishAt: at(20) }]) {
      await game(f, "QA_HOST_B", { activityLabel: label, centreId: centre.id, capacity: 500, date: today, time: "23:30", ...input });
    }
    const afterProtected = await counts();
    await game(f, "QA_HOST_B", { activityLabel: label, centreId: centre.id, capacity: 500, date: today, time: "23:45", visibility: "public", lifecycle: "active" });
    const afterPublic = await counts();
    await evidence("vis-counts", { before: JSON.stringify(before), afterProtected: JSON.stringify(afterProtected), afterPublic: JSON.stringify(afterPublic) });
    expect(afterProtected, "protected activities do not move public counts").toEqual(before);
    expect(afterPublic.plansCreated, "public control is counted").toBe(before.plansCreated + 1);
    expect(afterPublic.momentumHasLabel, "public control reaches momentum").toBe(true);
  });
});

test("VIS-013-POLL: poll vote parent/child matrix with vote-count invariants", async ({ playwright }) => {
  await withActors(playwright, ["QA_USER", "QA_USER_B"], async (f) => {
    const ids: string[] = [], polls: string[] = [], options: number[] = [];
    for (const role of ["QA_USER", "QA_USER_B"]) {
      const created = await f.actors[role].post("/api/circles", { data: { name: `QA poll matrix ${randomUUID()}`, joinMode: "invite" } });
      const id = (await created.json()).id; ids.push(id);
      for (const [table, column] of [["circles", "id"], ["circle_members", "circle_id"], ["circle_polls", "circle_id"]]) f.track(table, column, id);
      const poll = await f.actors[role].post(`/api/circles/${id}/polls`, { data: { question: "QA", options: [{ date: day(9) }] } });
      const pollId = (await poll.json()).id; polls.push(pollId);
      f.track("circle_poll_votes", "poll_id", pollId); f.track("circle_poll_options", "poll_id", pollId);
      const [rows] = await f.connection.query<any[]>("SELECT id FROM circle_poll_options WHERE poll_id = ?", [pollId]);
      options.push(rows[0].id);
    }
    const [A, B] = ids, [pA, pB] = polls, [oA, oB] = options;
    const invariants = await Promise.all([
      f.snapshot("SELECT * FROM circle_poll_votes WHERE poll_id IN (?,?) ORDER BY poll_id, resident_id", polls),
      f.snapshot("SELECT * FROM circle_polls WHERE id IN (?,?) ORDER BY id", polls),
    ]);
    const cases: [APIRequestContext, string, number, string][] = [
      [f.actors.QA_USER_B, `/api/circles/${B}/polls/${pA}/options/${oA}/vote`, 404, "Circle B + Poll A"],
      [f.actors.QA_USER, `/api/circles/${A}/polls/${pB}/options/${oB}/vote`, 404, "Circle A + Poll B"],
      [f.actors.QA_USER, `/api/circles/${A}/polls/${pA}/options/${oB}/vote`, 404, "Poll A + foreign option"],
      [f.actors.QA_USER, `/api/circles/${randomUUID()}/polls/${pA}/options/${oA}/vote`, 403, "nonexistent Circle"],
      [f.actors.QA_USER, `/api/circles/${A}/polls/${randomUUID()}/options/${oA}/vote`, 404, "nonexistent poll"],
    ];
    for (const [actor, path, status, label] of cases) {
      expect((await actor.post(path)).status(), label).toBe(status);
      for (const unchanged of invariants) await unchanged();
    }
    expect((await f.actors.QA_USER.post(`/api/circles/${A}/polls/${pA}/options/${oA}/vote`)).status(), "Circle A + Poll A member").toBe(200);
    const [votes] = await f.connection.query<any[]>("SELECT poll_id, resident_id FROM circle_poll_votes WHERE poll_id IN (?,?)", polls);
    expect(votes.length === 1 && votes[0].poll_id === pA && votes[0].resident_id === personas.QA_USER.id).toBe(true);
  });
});

test("VIS-014-015: organiser-only Circle attachment and club schedule owner/public policy", async ({ playwright }) => {
  await withActors(playwright, ["QA_USER", "QA_USER_B", "QA_VENDOR", "QA_VENDOR_B", "GUEST"], async (f) => {
    const created = await f.actors.QA_USER.post("/api/circles", { data: { name: `QA attach ${randomUUID()}`, joinMode: "open" } });
    const circle = (await created.json()).id;
    f.track("circles", "id", circle); f.track("circle_members", "circle_id", circle);
    await f.connection.execute("INSERT INTO circle_members (circle_id, resident_id, role) VALUES (?, ?, 'member')", [circle, personas.QA_USER_B.id]);
    const count = await f.snapshot("SELECT COUNT(*) AS n FROM games WHERE circle_id = ?", [circle]);
    const base = { activityLabel: "QA attach", date: day(5), time: "12:00", capacity: 6, locationText: "Synthetic QA venue", priceCents: 0, circleId: circle };
    expect((await f.actors.QA_USER_B.post("/api/games", { data: base })).status(), "member (non-organiser) cannot attach").toBe(403);
    await count();
    expect(await game(f, "QA_USER", { ...base })).toBeTruthy();
    // Club schedule: public only while approved; owning organisation keeps editor access.
    const club = await clubFor(f, "QA_VENDOR", "pending");
    const session = randomUUID();
    await f.connection.execute("INSERT INTO club_sessions (id, club_id, day_of_week, time) VALUES (?, ?, 2, '18:00')", [session, club]);
    const sees = async (actor: APIRequestContext) => (await text(actor, `/api/club-sessions?clubId=${club}`)).includes(session);
    const facts = { owner: await sees(f.actors.QA_VENDOR), foreignVendor: await sees(f.actors.QA_VENDOR_B), resident: await sees(f.actors.QA_USER), guest: await sees(f.actors.GUEST) };
    await f.connection.execute("UPDATE clubs SET status = 'approved' WHERE id = ?", [club]);
    const approvedGuest = await sees(f.actors.GUEST);
    await evidence("vis-014-015", { ...facts, approvedGuest });
    expect(facts.owner && approvedGuest).toBe(true);
    expect(facts.foreignVendor || facts.resident || facts.guest).toBe(false);
  });
});
