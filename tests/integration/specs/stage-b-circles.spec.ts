import { randomUUID } from "node:crypto";
import type { APIRequestContext } from "@playwright/test";
import { test, expect, personas } from "../fixtures";
import { withActors, evidence } from "../authorization-fixture";

type Scope = Parameters<Parameters<typeof withActors>[2]>[0];
async function circleVia(f: Scope, role: string, joinMode = "invite") {
  const created = await f.actors[role].post("/api/circles", { data: { name: `QA stage B ${randomUUID()}`, joinMode, whatWeDo: "QA members-only detail" } });
  expect(created.status()).toBe(201);
  const id = (await created.json()).id as string;
  for (const [table, column] of [["circles", "id"], ["circle_members", "circle_id"], ["circle_invites", "circle_id"], ["circle_plans", "circle_id"], ["circle_polls", "circle_id"], ["chat_messages", "scope_id"], ["chat_reads", "scope_id"], ["notifications", "listing_id"]]) f.track(table, column, id);
  return id;
}

test("STAGE-B-CIRCLE-ROLES: owner, member, non-member, vendor, admin and guest boundaries", async ({ playwright }) => {
  await withActors(playwright, ["QA_USER", "QA_USER_B", "QA_HOST", "QA_VENDOR", "QA_ADMIN", "GUEST"], async (f) => {
    const circle = await circleVia(f, "QA_USER");
    await f.connection.execute("INSERT INTO circle_members (circle_id, resident_id, role) VALUES (?, ?, 'member')", [circle, personas.QA_USER_B.id]);
    const poll = await f.actors.QA_USER.post(`/api/circles/${circle}/polls`, { data: { question: "QA date", options: [{ date: "2030-06-20" }] } });
    expect(poll.status()).toBe(201);
    const pollId = (await poll.json()).id;
    f.track("circle_poll_votes", "poll_id", pollId); f.track("circle_poll_options", "poll_id", pollId);
    const invariants = await Promise.all([
      f.snapshot("SELECT * FROM circles WHERE id = ?", [circle]),
      f.snapshot("SELECT * FROM circle_members WHERE circle_id = ? ORDER BY id", [circle]),
      f.snapshot("SELECT * FROM circle_invites WHERE circle_id = ? ORDER BY id", [circle]),
      f.snapshot("SELECT * FROM circle_polls WHERE circle_id = ? ORDER BY id", [circle]),
      f.snapshot("SELECT COUNT(*) AS n FROM chat_messages WHERE scope_id = ?", [circle]),
    ]);
    const management = (X: APIRequestContext): [() => ReturnType<APIRequestContext["post"]>, string][] => [
      [() => X.put(`/api/circles/${circle}`, { data: { name: "Forbidden", joinMode: "open" } }), "edit"],
      [() => X.put(`/api/circles/${circle}/status`, { data: { status: "closed" } }), "close Circle"],
      [() => X.post(`/api/circles/${circle}/members/${personas.QA_USER.id}/remove`), "remove organiser"],
      [() => X.post(`/api/circles/${circle}/members/${personas.QA_USER_B.id}/promote`), "promote"],
      [() => X.post(`/api/circles/${circle}/members/${personas.QA_USER.id}/demote`), "demote organiser"],
      [() => X.post(`/api/circles/${circle}/invite`, { data: { residentId: personas.QA_HOST.id } }), "invite"],
      [() => X.get(`/api/circles/${circle}/join-requests`), "join requests"],
      [() => X.get(`/api/circles/${circle}/plans`), "organiser plans"],
      [() => X.post(`/api/circles/${circle}/polls/${pollId}/close`), "close poll"],
    ];
    const results: Record<string, number[]> = {};
    for (const [role, allowed] of [["QA_USER_B", [403]], ["QA_HOST", [403]], ["QA_VENDOR", [401]], ["QA_ADMIN", [401]], ["GUEST", [401]]] as [string, number[]][]) {
      results[role] = [];
      for (const [call, label] of management(f.actors[role])) {
        const status = (await call()).status();
        results[role].push(status);
        expect(allowed, `${role} ${label}`).toContain(status);
        for (const unchanged of invariants) await unchanged();
      }
    }
    // Private reads/writes: chat, share, plan/poll creation.
    for (const [role, expected] of [["QA_HOST", 403], ["QA_VENDOR", 403], ["QA_ADMIN", 401], ["GUEST", 401]] as [string, number][]) {
      expect((await f.actors[role].get(`/api/chat/circle/${circle}/messages`)).status(), `${role} chat read`).toBe(expected);
      expect((await f.actors[role].post(`/api/chat/circle/${circle}/messages`, { data: { body: "Forbidden" } })).status(), `${role} chat post`).toBe(expected);
    }
    for (const [path, data] of [["share", { entityType: "circle", entityId: circle }], ["plan-ideas", { title: "Forbidden" }], ["polls", { question: "Forbidden", options: [{ date: "2030-06-21" }] }]] as [string, object][]) {
      expect((await f.actors.QA_HOST.post(`/api/circles/${circle}/${path}`, { data })).status(), `non-member ${path}`).toBe(403);
    }
    for (const unchanged of invariants) await unchanged();
    // Member positive: private chat read/post only for members.
    expect((await f.actors.QA_USER_B.get(`/api/chat/circle/${circle}/messages`)).status()).toBe(200);
    const posted = await f.actors.QA_USER_B.post(`/api/chat/circle/${circle}/messages`, { data: { body: "QA member message" } });
    expect(posted.status()).toBe(201);
    const [message] = await f.connection.query<any[]>("SELECT id FROM chat_messages WHERE scope_id = ? ORDER BY id DESC LIMIT 1", [circle]);
    f.track("reports", "target_id", String(message[0].id));
    expect((await f.actors.QA_HOST.post(`/api/chat/messages/${message[0].id}/report`, { data: { reason: "Forbidden" } })).status(), "non-member cannot report private chat").toBe(403);
    // Organiser role changes succeed and are reversible.
    expect((await f.actors.QA_USER.post(`/api/circles/${circle}/members/${personas.QA_USER_B.id}/promote`)).status()).toBe(200);
    expect((await f.actors.QA_USER.post(`/api/circles/${circle}/members/${personas.QA_USER_B.id}/demote`)).status()).toBe(200);
    const [member] = await f.connection.query<any[]>("SELECT role FROM circle_members WHERE circle_id = ? AND resident_id = ?", [circle, personas.QA_USER_B.id]);
    expect(member[0].role).toBe("member");
    await evidence("stage-b-circle-roles", results);
  });
});

test("STAGE-B-CIRCLE-CHILDREN: plan, poll and invitation identifiers are relationship-scoped", async ({ playwright }) => {
  await withActors(playwright, ["QA_USER", "QA_USER_B", "QA_HOST"], async (f) => {
    const A = await circleVia(f, "QA_USER"), B = await circleVia(f, "QA_USER_B");
    const plan = await f.actors.QA_USER.post(`/api/circles/${A}/plan-ideas`, { data: { title: "QA private plan", note: "QA secret note" } });
    expect(plan.status()).toBe(201);
    const planId = (await plan.json()).id;
    const poll = await f.actors.QA_USER.post(`/api/circles/${A}/polls`, { data: { question: "QA private poll", options: [{ date: "2030-06-20" }] } });
    const pollId = (await poll.json()).id;
    f.track("circle_poll_votes", "poll_id", pollId); f.track("circle_poll_options", "poll_id", pollId);
    expect((await f.actors.QA_USER.post(`/api/circles/${A}/invite`, { data: { residentId: personas.QA_HOST.id } })).status()).toBe(201);
    const [invite] = await f.connection.query<any[]>("SELECT id FROM circle_invites WHERE circle_id = ? AND resident_id = ?", [A, personas.QA_HOST.id]);
    const invariants = await Promise.all([
      f.snapshot("SELECT * FROM circle_plans WHERE circle_id IN (?,?) ORDER BY id", [A, B]),
      f.snapshot("SELECT * FROM circle_polls WHERE circle_id IN (?,?) ORDER BY id", [A, B]),
      f.snapshot("SELECT * FROM circle_invites WHERE circle_id IN (?,?) ORDER BY id", [A, B]),
      f.snapshot("SELECT * FROM circle_members WHERE circle_id IN (?,?) ORDER BY id", [A, B]),
    ]);
    const XB = f.actors.QA_USER_B;
    const cases: [() => ReturnType<APIRequestContext["post"]>, number, string][] = [
      [() => XB.get(`/api/circles/${B}/plan-ideas/${planId}`), 404, "own Circle + foreign plan read"],
      [() => XB.patch(`/api/circles/${B}/plan-ideas/${planId}`, { data: { title: "Forbidden" } }), 404, "own Circle + foreign plan edit"],
      [() => XB.post(`/api/circles/${B}/plan-ideas/${planId}/confirm`), 404, "own Circle + foreign plan confirm"],
      [() => XB.post(`/api/circles/${B}/plan-ideas/${planId}/cancel`), 404, "own Circle + foreign plan cancel"],
      [() => XB.post(`/api/circles/${B}/polls`, { data: { question: "Forbidden", options: [{ date: "2030-06-21" }], planId } }), 404, "own Circle poll bound to foreign plan"],
      [() => XB.get(`/api/circles/${A}/plan-ideas/${planId}`), 403, "foreign Circle + child read"],
      [() => XB.patch(`/api/circles/${A}/plan-ideas/${planId}`, { data: { title: "Forbidden" } }), 403, "foreign Circle + child edit"],
      [() => XB.post(`/api/circles/${A}/plan-ideas/${planId}/confirm`), 403, "foreign Circle + child confirm"],
      [() => XB.post(`/api/circles/${randomUUID()}/plan-ideas/${planId}/confirm`), 404, "nonexistent parent"],
      [() => f.actors.QA_USER.post(`/api/circles/${A}/plan-ideas/${randomUUID()}/confirm`), 404, "nonexistent child"],
      [() => XB.post(`/api/circles/invitations/${invite[0].id}/respond`, { data: { accept: true } }), 404, "respond to another resident's invitation"],
    ];
    for (const [call, status, label] of cases) {
      expect((await call()).status(), label).toBe(status);
      for (const unchanged of invariants) await unchanged();
    }
    // Own Circle + foreign poll close is a scoped no-op (200), never a foreign mutation.
    expect((await XB.post(`/api/circles/${B}/polls/${pollId}/close`)).status()).toBe(200);
    for (const unchanged of invariants) await unchanged();
    // Intended recipient can respond (positive control).
    expect((await f.actors.QA_HOST.post(`/api/circles/invitations/${invite[0].id}/respond`, { data: { accept: false } })).status()).toBe(200);
    await evidence("stage-b-circle-children", { denials: cases.length + 1, foreignPlanOrPollMutated: false });
  });
});
