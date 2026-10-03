import { expect, personas } from "../fixtures";
import { evidence } from "../authorization-fixture";
import { test, withActors, rows, createCircle, createActivity } from "../lifecycle-fixture";

// Phase 11B — Circle invitation revocation (own batch: stays within the real
// 10-login password limiter per batch).

test("HC-GAP-CIRCLE-1: Circle invitation revoke — organiser of THAT Circle only; revoked invite grants no join/membership/plans/chat; members untouched", async ({ playwright }) => {
  await withActors(playwright, ["QA_HOST", "QA_HOST_B", "QA_USER", "QA_USER_B"], async (f) => {
    const circle = await createCircle(f, "QA_HOST", { joinMode: "invite" });
    const otherCircle = await createCircle(f, "QA_HOST_B", { joinMode: "invite" });
    const plan = await createActivity(f, "QA_HOST", { circleId: circle.id });
    expect((await f.actors.QA_HOST.post(`/api/circles/${circle.id}/invite`, { data: { residentId: personas.QA_USER.id } })).status()).toBe(201);
    const [inv] = await rows(f, "SELECT id FROM circle_invites WHERE circle_id = ? AND resident_id = ?", [circle.id, personas.QA_USER.id]);
    f.track("audit_log", "object_id", inv.id);

    const list = await f.actors.QA_HOST.get(`/api/circles/${circle.id}/invitations`);
    expect((await list.json()).map((i: any) => i.id)).toContain(inv.id);
    expect((await f.actors.QA_USER_B.get(`/api/circles/${circle.id}/invitations`)).status()).toBe(403);

    const unchanged = await f.snapshot("SELECT * FROM circle_invites WHERE id = ?", [inv.id]);
    expect((await f.actors.QA_USER_B.post(`/api/circles/${circle.id}/invitations/${inv.id}/revoke`, { data: {} })).status(), "unrelated resident").toBe(403);
    expect((await f.actors.QA_USER.post(`/api/circles/${circle.id}/invitations/${inv.id}/revoke`, { data: {} })).status(), "recipient").toBe(403);
    expect((await f.actors.QA_HOST_B.post(`/api/circles/${circle.id}/invitations/${inv.id}/revoke`, { data: {} })).status(), "wrong organiser").toBe(403);
    expect((await f.actors.QA_HOST_B.post(`/api/circles/${otherCircle.id}/invitations/${inv.id}/revoke`, { data: {} })).status(), "wrong Circle").toBe(404);
    await unchanged();

    expect((await f.actors.QA_HOST.post(`/api/circles/${circle.id}/invitations/${inv.id}/revoke`, { data: {} })).status()).toBe(200);
    const again = await f.actors.QA_HOST.post(`/api/circles/${circle.id}/invitations/${inv.id}/revoke`, { data: {} });
    expect(again.status()).toBe(200);
    expect((await again.json()).alreadyRevoked).toBe(true);
    expect((await rows(f, "SELECT id FROM audit_log WHERE action = 'circle_invite.revoked' AND object_id = ?", [inv.id])).length).toBe(1);

    expect((await f.actors.QA_USER.post(`/api/circles/invitations/${inv.id}/respond`, { data: { accept: true } })).status(), "cannot accept").toBe(409);
    expect((await f.actors.QA_USER.post(`/api/circles/${circle.id}/join`, { data: {} })).status(), "join shortcut gone").toBe(403);
    expect((await rows(f, "SELECT 1 FROM circle_members WHERE circle_id = ? AND resident_id = ?", [circle.id, personas.QA_USER.id])).length).toBe(0);
    expect((await (await f.actors.QA_USER.get("/api/circles/invitations/mine")).json()).map((i: any) => i.id)).not.toContain(inv.id);
    expect((await f.actors.QA_USER.get(`/api/games/${plan.id}`)).status(), "no Circle-only plan access").toBe(404);
    expect([403, 404]).toContain((await f.actors.QA_USER.get(`/api/chat/circle/${circle.id}/messages`)).status());
    const teaser = await (await f.actors.QA_USER.get(`/api/circles/${circle.id}`)).json();
    expect(teaser.hasPendingInvite ?? false, "no 'invited' state left").toBe(false);

    // Accepted invitation: not revocable, membership kept.
    expect((await f.actors.QA_HOST.post(`/api/circles/${circle.id}/invite`, { data: { residentId: personas.QA_USER_B.id } })).status()).toBe(201);
    const [invB] = await rows(f, "SELECT id FROM circle_invites WHERE circle_id = ? AND resident_id = ?", [circle.id, personas.QA_USER_B.id]);
    expect((await f.actors.QA_USER_B.post(`/api/circles/invitations/${invB.id}/respond`, { data: { accept: true } })).status()).toBe(200);
    expect((await f.actors.QA_HOST.post(`/api/circles/${circle.id}/invitations/${invB.id}/revoke`, { data: {} })).status()).toBe(409);
    expect((await rows(f, "SELECT 1 FROM circle_members WHERE circle_id = ? AND resident_id = ?", [circle.id, personas.QA_USER_B.id])).length, "member kept").toBe(1);
    await evidence("hc-gap-circle-1", { unauthorized: "403/404", revoke: 200, accessAfter: "none", acceptedKept: true });
  });
});

test("HC-GAP-CIRCLE-2: declined not revocable; revoke vs accept race is consistent; concurrent revokes = one transition", async ({ playwright }) => {
  await withActors(playwright, ["QA_HOST", "QA_USER", "QA_USER_B"], async (f) => {
    const circle = await createCircle(f, "QA_HOST", { joinMode: "invite" });
    expect((await f.actors.QA_HOST.post(`/api/circles/${circle.id}/invite`, { data: { residentId: personas.QA_USER_B.id } })).status()).toBe(201);
    const [declined] = await rows(f, "SELECT id FROM circle_invites WHERE circle_id = ? AND resident_id = ?", [circle.id, personas.QA_USER_B.id]);
    expect((await f.actors.QA_USER_B.post(`/api/circles/invitations/${declined.id}/respond`, { data: { accept: false } })).status()).toBe(200);
    expect((await f.actors.QA_HOST.post(`/api/circles/${circle.id}/invitations/${declined.id}/revoke`, { data: {} })).status()).toBe(409);

    const outcomes: string[] = [];
    for (let i = 0; i < 4; i++) {
      await f.connection.execute("DELETE FROM circle_members WHERE circle_id = ? AND resident_id = ?", [circle.id, personas.QA_USER.id]);
      expect((await f.actors.QA_HOST.post(`/api/circles/${circle.id}/invite`, { data: { residentId: personas.QA_USER.id } })).status()).toBe(201);
      const [inv] = await rows(f, "SELECT id FROM circle_invites WHERE circle_id = ? AND resident_id = ?", [circle.id, personas.QA_USER.id]);
      f.track("audit_log", "object_id", inv.id);
      const [revoke, accept] = await Promise.all([
        f.actors.QA_HOST.post(`/api/circles/${circle.id}/invitations/${inv.id}/revoke`, { data: {} }),
        f.actors.QA_USER.post(`/api/circles/invitations/${inv.id}/respond`, { data: { accept: true } }),
      ]);
      const [{ status }] = await rows(f, "SELECT status FROM circle_invites WHERE id = ?", [inv.id]);
      const member = (await rows(f, "SELECT 1 FROM circle_members WHERE circle_id = ? AND resident_id = ?", [circle.id, personas.QA_USER.id])).length === 1;
      outcomes.push(`${revoke.status()}/${accept.status()}/${status}/${member}`);
      const revokeWon = revoke.status() === 200 && accept.status() === 409 && status === "revoked" && !member;
      const acceptWon = accept.status() === 200 && revoke.status() === 409 && status === "accepted" && member;
      expect(revokeWon || acceptWon, `consistent race outcome: ${outcomes.at(-1)}`).toBe(true);
    }

    await f.connection.execute("DELETE FROM circle_members WHERE circle_id = ? AND resident_id = ?", [circle.id, personas.QA_USER.id]);
    expect((await f.actors.QA_HOST.post(`/api/circles/${circle.id}/invite`, { data: { residentId: personas.QA_USER.id } })).status()).toBe(201);
    const [inv] = await rows(f, "SELECT id FROM circle_invites WHERE circle_id = ? AND resident_id = ?", [circle.id, personas.QA_USER.id]);
    f.track("audit_log", "object_id", inv.id);
    // The re-invited row keeps its id (earlier race iterations' revokes are
    // separate, legitimate transitions) — count only what this step adds.
    const auditsBefore = (await rows(f, "SELECT id FROM audit_log WHERE action = 'circle_invite.revoked' AND object_id = ?", [inv.id])).length;
    const statuses = (await Promise.all([1, 2, 3, 4].map(() => f.actors.QA_HOST.post(`/api/circles/${circle.id}/invitations/${inv.id}/revoke`, { data: {} })))).map((r) => r.status());
    expect(statuses).toEqual([200, 200, 200, 200]);
    expect((await rows(f, "SELECT id FROM audit_log WHERE action = 'circle_invite.revoked' AND object_id = ?", [inv.id])).length - auditsBefore, "one transition").toBe(1);
    await evidence("hc-gap-circle-2", { declined: 409, races: outcomes.join(" "), concurrent: statuses.join(",") });
  });
});

