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

test("HC-QA-033-GHOST-INVITE: a Circle invite must target an existing resident", async ({ playwright }) => {
  await withActors(playwright, ["QA_HOST_B"], async f => {
    const circle = await createCircle(f, "QA_HOST_B", { joinMode: "invite" });
    const ghost = randomUUID();
    f.track("notifications", "resident_id", ghost);
    const r = await f.actors.QA_HOST_B.post(`/api/circles/${circle.id}/invite`, { data: { residentId: ghost } });
    const orphan = await rows(f, "SELECT id FROM circle_invites WHERE resident_id = ?", [ghost]);
    await evidence("hc-qa-033-ghost", { status: r.status(), orphanRows: orphan.length });
    expect(orphan.length).toBe(0);
  });
});

test("HC-QA-033-REPEAT-REQUEST: re-sending a pending Circle join request does not re-notify organisers", async ({ playwright }) => {
  await withActors(playwright, ["QA_HOST_B", "QA_USER"], async f => {
    const circle = await createCircle(f, "QA_HOST_B", { joinMode: "approval" });
    for (let i = 0; i < 2; i++) expect((await f.actors.QA_USER.post(`/api/circles/${circle.id}/join`, { data: {} })).status()).toBe(202);
    const notes = (await notificationsFor(f, "QA_HOST_B", circle.id)).filter(n => n.title.startsWith("Join request"));
    await evidence("hc-qa-033-repeat", { organiserNotifications: notes.length });
    expect(notes.length).toBe(1);
  });
});

test("HC-QA-033-SEMANTICS: invitations require a real resident; join requests notify once per pending request", async ({ playwright }) => {
  await withActors(playwright, ["QA_HOST_B", "QA_USER", "QA_USER_B"], async f => {
    const { QA_HOST_B: organiser, QA_USER: requester } = f.actors;
    const circle = await createCircle(f, "QA_HOST_B", { joinMode: "approval" });
    const ghost = randomUUID();
    f.track("notifications", "resident_id", ghost);
    const r = await organiser.post(`/api/circles/${circle.id}/invite`, { data: { residentId: ghost } });
    expect(r.status()).toBe(404);
    expect(await rows(f, "SELECT id FROM circle_invites WHERE resident_id = ?", [ghost])).toEqual([]);
    expect(await rows(f, "SELECT id FROM notifications WHERE resident_id = ?", [ghost])).toEqual([]);
    expect((await organiser.post(`/api/circles/${circle.id}/invite`, { data: { residentId: personas.QA_USER_B.id } })).status()).toBe(201);
    const requests = () => rows(f, "SELECT id, status FROM circle_invites WHERE circle_id = ? AND resident_id = ?", [circle.id, personas.QA_USER.id]);
    const notes = async () => (await notificationsFor(f, "QA_HOST_B", circle.id)).filter(n => n.title.startsWith("Join request")).length;
    for (let i = 0; i < 3; i++) expect((await requester.post(`/api/circles/${circle.id}/join`, { data: {} })).status()).toBe(202);
    expect((await requests()).map(r => r.status)).toEqual(["pending"]);
    expect(await notes()).toBe(1);
    const [req] = await requests();
    expect((await organiser.post(`/api/circles/${circle.id}/join-requests/${req.id}/respond`, { data: { accept: false } })).status()).toBe(200);
    expect((await requester.post(`/api/circles/${circle.id}/join`, { data: {} })).status()).toBe(202); // new pending request after decline
    expect((await requests()).map(r => r.status)).toEqual(["pending"]);
    expect(await notes()).toBe(2);
    expect((await requester.post(`/api/circles/${circle.id}/join`, { data: {} })).status()).toBe(202);
    expect(await notes()).toBe(2);
  });
});
