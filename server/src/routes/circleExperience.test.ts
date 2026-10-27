import crypto from "node:crypto";
import http, { type Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CIRCLE_FEATURES, setCircleFeature } from "../circleFeatures.js";
import { selectableWeeks } from "../circlePlanning.js";
import { db } from "../db/index.js";
import { applyReportAction, resolveReportTarget } from "../reportModeration.js";
import { circleExperienceRouter, memoryImageBelongs } from "./circleExperience.js";
import { circlesRouter } from "./circles.js";
import { gamesRouter } from "./games.js";

// Circle Experience 2.0 — the new Circle capabilities end to end against the
// isolated test DB: switches, privacy thresholds, membership checks (incl.
// cross-Circle), idempotency, the Make It Happen → activity conversion
// through the unchanged games.ts path, memories, and the D5 restriction.

let server: Server;
let base: string;

const t = crypto.randomUUID().slice(0, 8);
const ids = {
  organiser: `test-cx-org-${t}`,
  a: `test-cx-a-${t}`,
  b: `test-cx-b-${t}`,
  c: `test-cx-c-${t}`,
  outsider: `test-cx-out-${t}`,
};
const circleId = `test-cx-circle-${t}`;
const otherCircleId = `test-cx-other-${t}`;
const pastGameId = `test-cx-game-${t}`;
const [thisWeek, nextWeek] = selectableWeeks();

const as = (who: string, path: string, init: { method?: string; body?: unknown } = {}) =>
  fetch(`${base}${path}`, {
    method: init.method ?? "GET",
    headers: { "Content-Type": "application/json", "X-Test-Resident-Id": who },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });

async function allFeatures(on: boolean) {
  for (const f of CIRCLE_FEATURES) await setCircleFeature(f.key, on);
}

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const residentId = req.header("X-Test-Resident-Id");
    if (residentId) (req as any).resident = { id: residentId, name: `Resident ${residentId.slice(-4)}` };
    next();
  });
  app.use("/circles", circlesRouter);
  app.use("/circles", circleExperienceRouter);
  app.use("/games", gamesRouter);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("no port");
  base = `http://127.0.0.1:${address.port}`;

  for (const [k, id] of Object.entries(ids)) await db.prepare(`INSERT INTO residents (id, email, name) VALUES (?, ?, ?)`).run(id, `${id}@example.test`, `CX ${k}`);
  for (const [cid, name] of [[circleId, "CX Walkers"], [otherCircleId, "CX Other"]]) {
    await db.prepare(`INSERT INTO circles (id, name, activity_label, area, county, about, created_by_resident_id) VALUES (?, ?, 'Walking', 'Howth', 'Dublin', '', ?)`).run(cid, name, ids.organiser);
    await db.prepare(`INSERT INTO circle_members (circle_id, resident_id, role) VALUES (?, ?, 'organiser')`).run(cid, ids.organiser);
  }
  for (const m of [ids.a, ids.b, ids.c]) await db.prepare(`INSERT INTO circle_members (circle_id, resident_id, role) VALUES (?, ?, 'member')`).run(circleId, m);
  // A past Circle activity that a and organiser took part in (a attended).
  const tenDaysAgo = new Date(Date.now() - 10 * 86400000).toISOString().slice(0, 10);
  await db.prepare(`INSERT INTO games (id, host_resident_id, activity_label, date, time, capacity, status, circle_id) VALUES (?, ?, 'Walking', ?, '10:00', 10, 'open', ?)`).run(pastGameId, ids.organiser, tenDaysAgo, circleId);
  await db.prepare(`INSERT INTO game_participants (game_id, resident_id, attended) VALUES (?, ?, 1)`).run(pastGameId, ids.organiser);
  await db.prepare(`INSERT INTO game_participants (game_id, resident_id, attended) VALUES (?, ?, 1)`).run(pastGameId, ids.a);
});

afterAll(async () => {
  await allFeatures(false);
  await new Promise<void>((resolve) => server.close(() => resolve()));
  const circles = [circleId, otherCircleId];
  for (const cid of circles) {
    await db.prepare(`DELETE FROM circle_pulses WHERE circle_id = ?`).run(cid);
    await db.prepare(`DELETE FROM circle_poll_votes WHERE poll_id IN (SELECT id FROM circle_polls WHERE circle_id = ?)`).run(cid);
    await db.prepare(`DELETE FROM circle_poll_options WHERE poll_id IN (SELECT id FROM circle_polls WHERE circle_id = ?)`).run(cid);
    await db.prepare(`DELETE FROM circle_polls WHERE circle_id = ?`).run(cid);
    await db.prepare(`DELETE FROM circle_pulse_notices WHERE circle_id = ?`).run(cid);
    await db.prepare(`DELETE FROM circle_availability WHERE circle_id = ?`).run(cid);
    await db.prepare(`DELETE FROM circle_plan_interest WHERE plan_id IN (SELECT id FROM circle_plans WHERE circle_id = ?)`).run(cid);
    await db.prepare(`DELETE FROM circle_plans WHERE circle_id = ?`).run(cid);
    await db.prepare(`DELETE FROM circle_memories WHERE circle_id = ?`).run(cid);
    await db.prepare(`DELETE FROM circle_restrictions WHERE circle_id = ?`).run(cid);
    await db.prepare(`DELETE FROM circle_invites WHERE circle_id = ?`).run(cid);
    await db.prepare(`DELETE FROM game_participants WHERE game_id IN (SELECT id FROM games WHERE circle_id = ?)`).run(cid);
    await db.prepare(`DELETE FROM games WHERE circle_id = ?`).run(cid);
    await db.prepare(`DELETE FROM circle_members WHERE circle_id = ?`).run(cid);
    await db.prepare(`DELETE FROM notifications WHERE listing_id = ?`).run(cid);
    await db.prepare(`DELETE FROM circles WHERE id = ?`).run(cid);
  }
  for (const id of Object.values(ids)) {
    await db.prepare(`DELETE FROM notifications WHERE resident_id = ?`).run(id);
    await db.prepare(`DELETE FROM residents WHERE id = ?`).run(id);
  }
  await db.prepare(`DELETE FROM audit_log WHERE object_id IN (?, ?)`).run(circleId, otherCircleId);
});

describe("feature switches", () => {
  it("every new feature route answers 404 while its switch is off (the default)", async () => {
    await allFeatures(false);
    const paths = [`/circles/${circleId}/pulse`, `/circles/${circleId}/free-time`, `/circles/${circleId}/memories`, `/circles/${circleId}/first-time`];
    for (const p of paths) expect((await as(ids.a, p)).status).toBe(404);
    expect((await as(ids.a, `/circles/${circleId}/pulse`, { method: "POST", body: { interest: "Hiking", weekStart: thisWeek } })).status).toBe(404);
  });

  it("plan ideas keep their old shape while Make It Happen is off", async () => {
    const res = await as(ids.a, `/circles/${circleId}/plan-ideas`, { method: "POST", body: { title: "Old-style idea" } });
    expect(res.status).toBe(201);
    const plan = (await res.json()) as Record<string, unknown>;
    expect(plan).not.toHaveProperty("interestCount");
    const row = (await db.prepare(`SELECT expires_at, target_size FROM circle_plans WHERE id = ?`).get(plan.id)) as { expires_at: string | null; target_size: number | null };
    expect(row).toEqual({ expires_at: null, target_size: null });
    expect(await db.prepare(`SELECT 1 FROM circle_plan_interest WHERE plan_id = ?`).get(plan.id)).toBeUndefined();
  });
});

describe("Circle Pulse", () => {
  beforeAll(() => allFeatures(true));

  it("is members only, and can't be reached through another Circle", async () => {
    expect((await as(ids.outsider, `/circles/${circleId}/pulse`)).status).toBe(403);
    expect((await as(ids.outsider, `/circles/${circleId}/pulse`, { method: "POST", body: { interest: "Hiking", weekStart: thisWeek } })).status).toBe(403);
    // a is a member of circleId, not otherCircleId
    expect((await as(ids.a, `/circles/${otherCircleId}/pulse`)).status).toBe(403);
  });

  it("validates input", async () => {
    expect((await as(ids.a, `/circles/${circleId}/pulse`, { method: "POST", body: { interest: "x", weekStart: thisWeek } })).status).toBe(400);
    expect((await as(ids.a, `/circles/${circleId}/pulse`, { method: "POST", body: { interest: "Hiking", weekStart: "2020-01-06" } })).status).toBe(400);
    expect((await as(ids.a, `/circles/${circleId}/pulse`, { method: "POST", body: { interest: "Hiking", weekStart: nextWeek, note: "n".repeat(281) } })).status).toBe(400);
  });

  it("hides a lone interest from others, shows it to its owner without a count", async () => {
    const res = await as(ids.a, `/circles/${circleId}/pulse`, { method: "POST", body: { interest: "Hiking", weekStart: nextWeek, slots: ["sat:morning", "nope"], note: "Somewhere flat" } });
    expect(res.status).toBe(201);
    const mine = (await (await as(ids.a, `/circles/${circleId}/pulse`)).json()) as { groups: { count: number | null; mine: boolean }[]; mine: { slots: string[] }[] };
    expect(mine.groups).toEqual([expect.objectContaining({ count: null, mine: true })]);
    expect(mine.mine[0].slots).toEqual(["sat:morning"]);
    const theirs = (await (await as(ids.b, `/circles/${circleId}/pulse`)).json()) as { groups: unknown[] };
    expect(theirs.groups).toEqual([]);
  });

  it("updates instead of duplicating, and counts people not taps", async () => {
    const again = await as(ids.a, `/circles/${circleId}/pulse`, { method: "POST", body: { interest: "  hiking ", weekStart: nextWeek, slots: ["sun:morning"] } });
    expect(again.status).toBe(200);
    expect(((await again.json()) as { updated: boolean }).updated).toBe(true);
    const { n } = (await db.prepare(`SELECT COUNT(*) as n FROM circle_pulses WHERE circle_id = ? AND resident_id = ?`).get(circleId, ids.a)) as { n: number };
    expect(Number(n)).toBe(1);
  });

  it("shows totals from two, never names, and notifies organisers once at three", async () => {
    await as(ids.b, `/circles/${circleId}/pulse`, { method: "POST", body: { interest: "Hiking", weekStart: nextWeek, slots: ["sun:morning"], note: "Mornings suit me" } });
    const two = (await (await as(ids.c, `/circles/${circleId}/pulse`)).json()) as { groups: { count: number; interest: string; topSlot: string | null }[] };
    expect(two.groups[0]).toMatchObject({ count: 2, interest: "Hiking", topSlot: "sun:morning" });
    expect(JSON.stringify(two)).not.toContain(ids.a);
    expect(JSON.stringify(two)).not.toContain("Mornings suit me"); // notes are for organisers only

    await as(ids.c, `/circles/${circleId}/pulse`, { method: "POST", body: { interest: "Hiking", weekStart: nextWeek } });
    await as(ids.c, `/circles/${circleId}/pulse`, { method: "POST", body: { interest: "Hiking", weekStart: nextWeek } });
    const notices = (await db.prepare(`SELECT COUNT(*) as n FROM notifications WHERE resident_id = ? AND ref LIKE 'pulse:%'`).get(ids.organiser)) as { n: number };
    expect(Number(notices.n)).toBe(1);

    const organiserView = (await (await as(ids.organiser, `/circles/${circleId}/pulse`)).json()) as { groups: { status: string; organiserNotes?: string[] }[] };
    expect(organiserView.groups[0].status).toBe("matched");
    expect(organiserView.groups[0].organiserNotes).toEqual(["Mornings suit me"]);
  });

  it("only the owner can withdraw an interest", async () => {
    const { id } = (await db.prepare(`SELECT id FROM circle_pulses WHERE circle_id = ? AND resident_id = ?`).get(circleId, ids.c)) as { id: string };
    expect((await as(ids.b, `/circles/${circleId}/pulse/${id}`, { method: "DELETE" })).status).toBe(404);
    expect((await as(ids.c, `/circles/${circleId}/pulse/${id}`, { method: "DELETE" })).status).toBe(200);
  });
});

describe("Free Time Match", () => {
  it("is opt-in per week, and claims a match only at three", async () => {
    const empty = (await (await as(ids.a, `/circles/${circleId}/free-time`)).json()) as { mine: Record<string, string[] | null>; matches: unknown[] };
    expect(empty.mine[thisWeek]).toBeNull();

    for (const who of [ids.a, ids.b]) {
      expect((await as(who, `/circles/${circleId}/free-time/${nextWeek}`, { method: "PUT", body: { slots: ["sun:afternoon"] } })).status).toBe(200);
    }
    let view = (await (await as(ids.a, `/circles/${circleId}/free-time`)).json()) as { matches: { interest: string | null; count: number }[]; sharedCount: Record<string, number | null> };
    expect(view.matches.filter((m) => m.interest === null)).toEqual([]);
    expect(view.sharedCount[nextWeek]).toBeNull(); // two sharers — not enough to say how many

    await as(ids.c, `/circles/${circleId}/free-time/${nextWeek}`, { method: "PUT", body: { slots: ["sun:afternoon", "sat:evening"] } });
    view = (await (await as(ids.a, `/circles/${circleId}/free-time`)).json()) as typeof view;
    expect(view.matches).toContainEqual(expect.objectContaining({ interest: null, slot: "sun:afternoon", count: 3, includesMe: true }));
    expect(JSON.stringify(view)).not.toContain(ids.b);
  });

  it("refuses other weeks and lets a member withdraw", async () => {
    expect((await as(ids.a, `/circles/${circleId}/free-time/2020-01-06`, { method: "PUT", body: { slots: ["sun:afternoon"] } })).status).toBe(400);
    expect((await as(ids.a, `/circles/${circleId}/free-time/${nextWeek}`, { method: "DELETE" })).status).toBe(200);
    const view = (await (await as(ids.a, `/circles/${circleId}/free-time`)).json()) as { mine: Record<string, string[] | null> };
    expect(view.mine[nextWeek]).toBeNull();
  });
});

describe("Make It Happen", () => {
  let planId: string;

  it("a suggestion starts gathering interest with its suggester in", async () => {
    const res = await as(ids.a, `/circles/${circleId}/plan-ideas`, { method: "POST", body: { title: "Howth cliff walk", proposedDate: "2099-05-02", targetSize: 3, sourcePulseKey: `${nextWeek}|hiking` } });
    expect(res.status).toBe(201);
    const plan = (await res.json()) as { id: string; interestCount: number; interestedByMe: boolean; stage: string; sourcePulseKey: string };
    planId = plan.id;
    expect(plan).toMatchObject({ interestCount: 1, interestedByMe: true, stage: "gathering", sourcePulseKey: `${nextWeek}|hiking` });
    expect((await as(ids.a, `/circles/${circleId}/plan-ideas`, { method: "POST", body: { title: "Bad size", targetSize: 1 } })).status).toBe(400);
    expect((await as(ids.a, `/circles/${circleId}/plan-ideas`, { method: "POST", body: { title: "Past", proposedDate: "2020-01-01" } })).status).toBe(400);
  });

  it("interest is members only and idempotent; ready-for-review is announced once", async () => {
    expect((await as(ids.outsider, `/circles/${circleId}/plan-ideas/${planId}/interest`, { method: "POST" })).status).toBe(403);
    expect((await as(ids.organiser, `/circles/${otherCircleId}/plan-ideas/${planId}/interest`, { method: "POST" })).status).toBe(404);
    await as(ids.b, `/circles/${circleId}/plan-ideas/${planId}/interest`, { method: "POST" });
    await as(ids.b, `/circles/${circleId}/plan-ideas/${planId}/interest`, { method: "POST" });
    const three = (await (await as(ids.c, `/circles/${circleId}/plan-ideas/${planId}/interest`, { method: "POST" })).json()) as { interestCount: number };
    expect(three.interestCount).toBe(3);
    await as(ids.c, `/circles/${circleId}/plan-ideas/${planId}/interest`, { method: "DELETE" });
    await as(ids.c, `/circles/${circleId}/plan-ideas/${planId}/interest`, { method: "POST" });
    const { n } = (await db.prepare(`SELECT COUNT(*) as n FROM notifications WHERE resident_id = ? AND ref = ? AND title LIKE 'Ready for review%'`).get(ids.organiser, planId)) as { n: number };
    expect(Number(n)).toBe(1);
    const plan = (await (await as(ids.b, `/circles/${circleId}/plan-ideas/${planId}`)).json()) as { stage: string; interestedByMe: boolean };
    expect(plan).toMatchObject({ stage: "ready", interestedByMe: true });
  });

  it("interest never creates an activity; only the organiser's normal activity flow does", async () => {
    expect(await db.prepare(`SELECT 1 FROM games WHERE plan_id = ?`).get(planId)).toBeUndefined();
    // A member can't confirm or convert.
    expect((await as(ids.a, `/circles/${circleId}/plan-ideas/${planId}/confirm`, { method: "POST" })).status).toBe(403);
    // Not confirmed yet → conversion refused.
    const early = await as(ids.organiser, `/games`, { method: "POST", body: { activityLabel: "Howth cliff walk", date: "2099-05-02", time: "10:00", capacity: 10, locationText: "Howth DART", circleId, planId } });
    expect(early.status).toBe(409);
    expect((await as(ids.organiser, `/circles/${circleId}/plan-ideas/${planId}/confirm`, { method: "POST" })).status).toBe(200);
    expect((await as(ids.organiser, `/circles/${circleId}/plan-ideas/${planId}/confirm`, { method: "POST" })).status).toBe(409);
    const made = await as(ids.organiser, `/games`, { method: "POST", body: { activityLabel: "Howth cliff walk", date: "2099-05-02", time: "10:00", capacity: 10, locationText: "Howth DART", circleId, planId } });
    expect(made.status).toBe(201);
    const plan = (await (await as(ids.a, `/circles/${circleId}/plan-ideas/${planId}`)).json()) as { stage: string; activity: { id: string } };
    expect(plan.stage).toBe("activity_created");
    // Interested members hear it's happening — one notice each.
    const notes = (await db.prepare(`SELECT title FROM notifications WHERE resident_id = ? AND listing_id = ?`).all(ids.b, plan.activity.id)) as { title: string }[];
    expect(notes).toHaveLength(1);
    expect(notes[0].title).toMatch(/^It's happening/);
    // Interest closes once converted, and the Pulse it came from reads as converted.
    expect((await as(ids.b, `/circles/${circleId}/plan-ideas/${planId}/interest`, { method: "DELETE" })).status).toBe(409);
    const pulse = (await (await as(ids.a, `/circles/${circleId}/pulse`)).json()) as { groups: { key: string; status: string }[] };
    expect(pulse.groups.find((g) => g.key === `${nextWeek}|hiking`)?.status).toBe("converted");
  });

  it("an organiser can decline with a reason that members see", async () => {
    const res = await as(ids.b, `/circles/${circleId}/plan-ideas`, { method: "POST", body: { title: "Midnight swim" } });
    const { id } = (await res.json()) as { id: string };
    expect((await as(ids.organiser, `/circles/${circleId}/plan-ideas/${id}/cancel`, { method: "POST", body: { reason: "Not safe after dark" } })).status).toBe(200);
    const plan = (await (await as(ids.b, `/circles/${circleId}/plan-ideas/${id}`)).json()) as { stage: string; declineReason: string };
    expect(plan).toMatchObject({ stage: "cancelled", declineReason: "Not safe after dark" });
    const audit = await db.prepare(`SELECT 1 FROM audit_log WHERE object_id = ? AND action = 'circle.plan_declined'`).get(circleId);
    expect(audit).toBeTruthy();
  });
});

describe("First-Time Friendly", () => {
  it("reports welcome and first-activity state from real history, and dismisses once", async () => {
    const before = (await (await as(ids.b, `/circles/${circleId}/membership`)).json()) as { welcomed: boolean; firstCircleActivity: boolean };
    expect(before).toMatchObject({ welcomed: false, firstCircleActivity: true });
    const veteran = (await (await as(ids.a, `/circles/${circleId}/membership`)).json()) as { firstCircleActivity: boolean };
    expect(veteran.firstCircleActivity).toBe(false);
    expect((await as(ids.b, `/circles/${circleId}/welcome/dismiss`, { method: "POST" })).status).toBe(200);
    const after = (await (await as(ids.b, `/circles/${circleId}/membership`)).json()) as { welcomed: boolean };
    expect(after.welcomed).toBe(true);
    expect((await as(ids.outsider, `/circles/${circleId}/welcome/dismiss`, { method: "POST" })).status).toBe(403);
  });

  it("guidance uses only what the organiser entered", async () => {
    const g = (await (await as(ids.b, `/circles/${circleId}/first-time`)).json()) as { nextActivity: { activityLabel: string; meetingInstructions: string | null; where: string } | null };
    expect(g.nextActivity).toMatchObject({ activityLabel: "Howth cliff walk", where: "Howth DART", meetingInstructions: null });
  });
});

describe("Circle Memories", () => {
  const photoUrl = `/api/media/circles/${circleId}/memory-file?file=abc123.jpg`;

  it("only accepts photos uploaded for this Circle", () => {
    expect(memoryImageBelongs(circleId, photoUrl)).toBe(true);
    expect(memoryImageBelongs(circleId, `/api/media/circles/${otherCircleId}/memory-file?file=abc123.jpg`)).toBe(false);
    expect(memoryImageBelongs(circleId, "https://evil.example/x.jpg")).toBe(false);
  });

  it("lets people who took part add a reflection or a consented photo", async () => {
    expect((await as(ids.b, `/circles/${circleId}/memories`, { method: "POST", body: { gameId: pastGameId, kind: "reflection", body: "Lovely day" } })).status).toBe(403); // b wasn't there
    expect((await as(ids.a, `/circles/${circleId}/memories`, { method: "POST", body: { gameId: pastGameId, kind: "photo", imageUrl: photoUrl } })).status).toBe(400); // no consent
    expect((await as(ids.a, `/circles/${circleId}/memories`, { method: "POST", body: { gameId: pastGameId, kind: "photo", imageUrl: "https://evil.example/x.jpg", consent: true } })).status).toBe(400);
    expect((await as(ids.a, `/circles/${circleId}/memories`, { method: "POST", body: { gameId: pastGameId, kind: "photo", imageUrl: photoUrl, consent: true, caption: "Summit!" } })).status).toBe(201);
    expect((await as(ids.a, `/circles/${circleId}/memories`, { method: "POST", body: { gameId: pastGameId, kind: "reflection", body: "Best walk yet" } })).status).toBe(201);
    // The organiser (also there) heard once, not twice.
    const { n } = (await db.prepare(`SELECT COUNT(*) as n FROM notifications WHERE resident_id = ? AND ref = ?`).get(ids.organiser, `memory:${pastGameId}`)) as { n: number };
    expect(Number(n)).toBe(1);
  });

  it("is members only and never exposes the stored photo location", async () => {
    expect((await as(ids.outsider, `/circles/${circleId}/memories`)).status).toBe(403);
    const view = (await (await as(ids.b, `/circles/${circleId}/memories`)).json()) as { activitiesTogether: number; canContribute: boolean; items: { kind: string; imageUrl: string | null; canRemove: boolean }[] };
    expect(view.activitiesTogether).toBe(1);
    expect(view.canContribute).toBe(false);
    const photo = view.items.find((i) => i.kind === "photo")!;
    expect(photo.imageUrl).toMatch(new RegExp(`^/api/media/circles/${circleId}/memories/`));
    expect(JSON.stringify(view)).not.toContain("memory-file");
    expect(photo.canRemove).toBe(false);
  });

  it("can be removed by its contributor or an organiser, and moderated from a report", async () => {
    const [first, second] = (await db.prepare(`SELECT id FROM circle_memories WHERE circle_id = ? ORDER BY created_at, id`).all(circleId)) as { id: string }[];
    expect((await as(ids.b, `/circles/${circleId}/memories/${first.id}`, { method: "DELETE" })).status).toBe(403);
    expect((await as(ids.organiser, `/circles/${circleId}/memories/${first.id}`, { method: "DELETE" })).status).toBe(200);
    expect((await as(ids.organiser, `/circles/${circleId}/memories/${first.id}`, { method: "DELETE" })).status).toBe(404);
    expect(await resolveReportTarget("circle_memory", second.id)).toMatchObject({ circleId, kind: expect.any(String) });
    await expect(applyReportAction({ id: 1, targetType: "circle_memory", targetId: second.id }, "admin-test", null)).rejects.toThrow();
    const done = await applyReportAction({ id: 1, targetType: "circle_memory", targetId: second.id }, "admin-test", { reasonCategory: "other", explanation: "Shared without consent" } as never);
    expect(done.action).toBe("circle_memory_removed");
  });
});

describe("D5 — removal blocks rejoining", () => {
  it("removing restricts; the member can't rejoin, request or be invited until lifted", async () => {
    expect((await as(ids.organiser, `/circles/${circleId}/members/${ids.c}/remove`, { method: "POST", body: { reason: "Repeated no-shows" } })).status).toBe(200);
    // Their Pulse / free time / interest went with them.
    expect(await db.prepare(`SELECT 1 FROM circle_availability WHERE circle_id = ? AND resident_id = ?`).get(circleId, ids.c)).toBeUndefined();
    expect((await as(ids.c, `/circles/${circleId}/join`, { method: "POST" })).status).toBe(403);
    const m = (await (await as(ids.c, `/circles/${circleId}/membership`)).json()) as { member: boolean; restricted: boolean };
    expect(m).toMatchObject({ member: false, restricted: true });
    expect((await as(ids.organiser, `/circles/${circleId}/invite`, { method: "POST", body: { residentId: ids.c } })).status).toBe(409);
    const list = (await (await as(ids.organiser, `/circles/${circleId}/restrictions`)).json()) as { residentId: string; reason: string }[];
    expect(list).toEqual([expect.objectContaining({ residentId: ids.c, reason: "Repeated no-shows" })]);
    expect((await as(ids.a, `/circles/${circleId}/restrictions`)).status).toBe(403);
    expect((await as(ids.a, `/circles/${circleId}/restrictions/${ids.c}/lift`, { method: "POST" })).status).toBe(403);

    expect((await as(ids.organiser, `/circles/${circleId}/restrictions/${ids.c}/lift`, { method: "POST" })).status).toBe(200);
    expect((await as(ids.c, `/circles/${circleId}/join`, { method: "POST" })).status).toBe(201);
    const audit = (await db.prepare(`SELECT action FROM audit_log WHERE object_id = ? AND action IN ('circle.member_removed', 'circle.restriction_lifted') ORDER BY id`).all(circleId)) as { action: string }[];
    expect(audit.map((a) => a.action)).toEqual(["circle.member_removed", "circle.restriction_lifted"]);
  });
});

describe("Planner — who's free, and organiser removals (2026-10-24)", () => {
  beforeAll(() => allFeatures(true));

  it("who's free is members only, totals only, and 404 while both sources are off", async () => {
    expect((await as(ids.outsider, `/circles/${circleId}/free-days`)).status).toBe(403);
    const r = await as(ids.a, `/circles/${circleId}/free-days`);
    expect(r.status).toBe(200);
    const body = (await r.json()) as { days: { date: string; free: number | null }[]; minGroup: number };
    expect(body.minGroup).toBe(3);
    expect(body.days.length).toBeGreaterThanOrEqual(8);
    expect(body.days.every((d) => d.free === null || d.free >= 3)).toBe(true);
    await setCircleFeature("circles.pulse", false);
    await setCircleFeature("circles.free_time_match", false);
    expect((await as(ids.a, `/circles/${circleId}/free-days`)).status).toBe(404);
    await allFeatures(true);
  });

  it("only an organiser removes a wish, as a whole, and its owners are told", async () => {
    for (const who of [ids.a, ids.b]) expect((await as(who, `/circles/${circleId}/pulse`, { method: "POST", body: { interest: "Removable swim", weekStart: nextWeek, slots: [] } })).status).toBe(201);
    const key = "removable swim";
    const path = `/circles/${circleId}/pulse-groups/${nextWeek}/${encodeURIComponent(key)}`;
    expect((await as(ids.a, path, { method: "DELETE" })).status).toBe(403);
    const r = await as(ids.organiser, path, { method: "DELETE", body: { reason: "Off topic" } });
    expect(r.status).toBe(200);
    expect(((await r.json()) as { removed: number }).removed).toBe(2);
    expect(await db.prepare(`SELECT 1 FROM circle_pulses WHERE circle_id = ? AND interest_key = ?`).get(circleId, key)).toBeUndefined();
    for (const who of [ids.a, ids.b]) expect(await db.prepare(`SELECT 1 FROM notifications WHERE resident_id = ? AND title LIKE 'Your wish was removed%'`).get(who)).toBeTruthy();
    expect(await db.prepare(`SELECT 1 FROM audit_log WHERE object_id = ? AND action = 'circle.wish_removed'`).get(circleId)).toBeTruthy();
    expect((await as(ids.organiser, path, { method: "DELETE" })).status).toBe(404);
  });

  it("only an organiser deletes a poll, with its options and votes", async () => {
    const created = await as(ids.a, `/circles/${circleId}/polls`, { method: "POST", body: { question: "Which day?", options: [{ date: "2030-08-01" }, { date: "2030-08-02" }] } });
    expect(created.status).toBe(201);
    const poll = (await created.json()) as { id: string };
    const [option] = (await db.prepare(`SELECT id FROM circle_poll_options WHERE poll_id = ? ORDER BY sort_order`).all(poll.id)) as { id: number }[];
    expect((await as(ids.b, `/circles/${circleId}/polls/${poll.id}/options/${option.id}/vote`, { method: "POST" })).status).toBeLessThan(300);
    expect((await as(ids.a, `/circles/${circleId}/polls/${poll.id}`, { method: "DELETE" })).status).toBe(403);
    expect((await as(ids.organiser, `/circles/${otherCircleId}/polls/${poll.id}`, { method: "DELETE" })).status).toBe(404);
    expect((await as(ids.organiser, `/circles/${circleId}/polls/${poll.id}`, { method: "DELETE" })).status).toBe(200);
    expect(await db.prepare(`SELECT 1 FROM circle_polls WHERE id = ?`).get(poll.id)).toBeUndefined();
    expect(await db.prepare(`SELECT 1 FROM circle_poll_votes WHERE poll_id = ?`).get(poll.id)).toBeUndefined();
    expect(await db.prepare(`SELECT 1 FROM circle_poll_options WHERE poll_id = ?`).get(poll.id)).toBeUndefined();
  });
});

describe("Circle Experience 4.0 — visitor page data", () => {
  const approvalId = `test-cx-appr-${t}`;
  const inviteId = `test-cx-inv-${t}`;
  const gameOpen = `test-cx-vg-${t}`;
  const gameAppr = `test-cx-vga-${t}`;
  const future = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
  beforeAll(async () => {
    await allFeatures(true);
    for (const [cid, mode] of [[approvalId, "approval"], [inviteId, "invite"]]) {
      await db
        .prepare(`INSERT INTO circles (id, name, activity_label, area, county, about, created_by_resident_id, join_mode, what_we_do, image_url) VALUES (?, 'CX Private', 'Swimming', 'Sutton', 'Dublin', 'About text', ?, ?, 'We swim', 'https://example.test/cover.jpg')`)
        .run(cid, ids.organiser, mode);
      await db.prepare(`INSERT INTO circle_members (circle_id, resident_id, role) VALUES (?, ?, 'organiser')`).run(cid, ids.organiser);
      await db.prepare(`INSERT INTO circle_members (circle_id, resident_id, role) VALUES (?, ?, 'member')`).run(cid, ids.a);
    }
    await db.prepare(`INSERT INTO games (id, host_resident_id, activity_label, date, time, capacity, status, circle_id, solo_friendly) VALUES (?, ?, 'CX open walk', ?, '10:00', 10, 'open', ?, 1)`).run(gameOpen, ids.organiser, future, circleId);
    await db.prepare(`INSERT INTO games (id, host_resident_id, activity_label, date, time, capacity, status, circle_id) VALUES (?, ?, 'CX dawn dip', ?, '07:00', 10, 'open', ?)`).run(gameAppr, ids.organiser, future, approvalId);
    await db.prepare(`INSERT INTO games (id, host_resident_id, activity_label, date, time, capacity, status, circle_id) VALUES (?, ?, 'CX invite swim', ?, '07:00', 10, 'open', ?)`).run(`${gameAppr}-i`, ids.organiser, future, inviteId);
  });
  afterAll(async () => {
    for (const g of [gameOpen, gameAppr, `${gameAppr}-i`]) await db.prepare(`DELETE FROM games WHERE id = ?`).run(g);
    for (const cid of [approvalId, inviteId]) {
      await db.prepare(`DELETE FROM circle_members WHERE circle_id = ?`).run(cid);
      await db.prepare(`DELETE FROM circles WHERE id = ?`).run(cid);
    }
  });

  it("answers 404 while the switch is off", async () => {
    await setCircleFeature("circles.visitor_experience", false);
    expect((await as(ids.outsider, `/circles/${circleId}/visitor`)).status).toBe(404);
    await setCircleFeature("circles.visitor_experience", true);
  });

  it("an open Circle shows upcoming activities and planning counts, never member names", async () => {
    const r = await as(ids.outsider, `/circles/${circleId}/visitor`);
    expect(r.status).toBe(200);
    const text = await r.text();
    const v = JSON.parse(text) as { members: number; upcoming: { id: string }[]; community: unknown; organiser: { name: string } };
    expect(v.upcoming.map((u) => u.id)).toContain(gameOpen);
    expect(v.community).toEqual(expect.objectContaining({ openPolls: expect.any(Number), livePlans: expect.any(Number) }));
    expect(v.organiser.name).toBe("CX organiser");
    for (const k of ["a", "b", "c"]) expect(text).not.toContain(`CX ${k}`);
  });

  it("an approval Circle shares activity titles but no cover, counts or names", async () => {
    const v = (await (await as(ids.outsider, `/circles/${approvalId}/visitor`)).json()) as { upcoming: { activityLabel: string }[]; community: unknown; coverUrl: string | null; about: { whatWeDo: string | null } };
    expect(v.upcoming.map((u) => u.activityLabel)).toEqual(["CX dawn dip"]);
    expect(v.community).toBeNull();
    expect(v.coverUrl).toBeNull();
    expect(v.about.whatWeDo).toBe("We swim");
  });

  it("an invite-only Circle stays a teaser", async () => {
    const v = (await (await as(ids.outsider, `/circles/${inviteId}/visitor`)).json()) as { upcoming: unknown[]; about: { whatWeDo: string | null }; venuePhotos: unknown[] };
    expect(v.upcoming).toEqual([]);
    expect(v.about.whatWeDo).toBeNull();
    expect(v.venuePhotos).toEqual([]);
  });

  it("'coming on your own' comes from the organiser's own word, which only an organiser can set", async () => {
    expect((await as(ids.a, `/circles/${circleId}`, { method: "PUT", body: { name: "CX Walkers", soloWelcome: true } })).status).toBe(403);
    expect((await as(ids.organiser, `/circles/${circleId}`, { method: "PUT", body: { name: "CX Walkers", activityLabel: "Walking", area: "Howth", county: "Dublin", soloWelcome: true } })).status).toBe(200);
    const v = (await (await as(ids.outsider, `/circles/${circleId}/visitor`)).json()) as { soloWelcome: { source: string } | null };
    expect(v.soloWelcome).toEqual({ source: "organiser" });
    await as(ids.organiser, `/circles/${circleId}`, { method: "PUT", body: { name: "CX Walkers", activityLabel: "Walking", area: "Howth", county: "Dublin", soloWelcome: false } });
    expect(((await (await as(ids.outsider, `/circles/${circleId}/visitor`)).json()) as { soloWelcome: unknown }).soloWelcome).toBeNull();
  });
});
