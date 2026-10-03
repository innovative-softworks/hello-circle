import { randomUUID } from "node:crypto";
import { expect, personas } from "../fixtures";
import { evidence } from "../authorization-fixture";
import { test, withActors } from "../lifecycle-fixture";
import { createCircle, rows, notificationsFor, hrefOf } from "../lifecycle-fixture";

// Phase 7 — Parts 13-15. CIRCLE_OWNER = QA_HOST_B, CIRCLE_MEMBER = QA_USER,
// CIRCLE_NON_MEMBER = QA_USER_B.

const membership = async (actor: any, circle: string) => (await actor.get(`/api/circles/${circle}/membership`)).json();
const needs = async (actor: any) => (await (await actor.get("/api/residents/me/needs-attention", { headers: { "X-Client-Id": randomUUID() } })).json()) as any[];
const memberRows = (f: any, circle: string) => rows<{ resident_id: string; role: string }>(f, "SELECT resident_id, role FROM circle_members WHERE circle_id = ? ORDER BY id", [circle]);

test("LC-CIR-CREATE-JOIN: creation defaults, approval requests, approve/decline, leave, remove and private content", async ({ playwright }) => {
  await withActors(playwright, ["QA_HOST_B", "QA_USER", "QA_USER_B", "GUEST"], async f => {
    const { QA_HOST_B: owner, QA_USER: user, QA_USER_B: other, GUEST: guest } = f.actors;
    // Part 13 — create (approval mode).
    const circle = await createCircle(f, "QA_HOST_B", { joinMode: "approval", whatWeDo: "QA walks", whoCanJoin: "Anyone" });
    const [row] = await rows(f, "SELECT created_by_resident_id, join_mode, status, slug FROM circles WHERE id = ?", [circle.id]);
    expect(row).toMatchObject({ created_by_resident_id: personas.QA_HOST_B.id, join_mode: "approval", status: "active", slug: circle.slug });
    expect(await memberRows(f, circle.id)).toEqual([{ resident_id: personas.QA_HOST_B.id, role: "organiser" }]);
    expect(await membership(owner, circle.id)).toEqual({ member: true, role: "organiser", requested: false });
    const full = await (await owner.get(`/api/circles/${circle.slug}`)).json();
    expect(full).toMatchObject({ id: circle.id, members: 1, joinMode: "approval", whatWeDo: "QA walks" });
    expect(full.restricted).toBeUndefined();
    expect((await (await owner.get("/api/circles/mine")).json()).map((c: any) => c.id)).toContain(circle.id);
    const teaser = await (await guest.get(`/api/circles/${circle.id}`)).json();
    expect(teaser).toMatchObject({ restricted: true, members: 1, whatWeDo: null, nextPlan: null });
    for (const suffix of ["/members", "/plan-ideas", "/upcoming", "/polls"]) expect((await user.get(`/api/circles/${circle.id}${suffix}`)).status(), suffix).toBe(403);
    expect((await user.get(`/api/chat/circle/${circle.id}/messages`)).status()).toBe(403);
    expect((await owner.get(`/api/circles/${circle.id}/join-requests`)).status()).toBe(200);
    expect((await user.get(`/api/circles/${circle.id}/join-requests`)).status()).toBe(403);

    // Part 14 — request → pending → approve → member.
    expect((await user.post(`/api/circles/${circle.id}/join`, { data: {} })).status()).toBe(202);
    expect((await user.post(`/api/circles/${circle.id}/join`, { data: {} })).status()).toBe(202); // repeat request stays one row
    expect((await rows(f, "SELECT id FROM circle_invites WHERE circle_id = ? AND resident_id = ?", [circle.id, personas.QA_USER.id])).length).toBe(1);
    expect(await membership(user, circle.id)).toEqual({ member: false, role: null, requested: true });
    expect((await (await user.get(`/api/circles/${circle.id}`)).json()).requested).toBe(true);
    const requests = await (await owner.get(`/api/circles/${circle.id}/join-requests`)).json();
    expect(requests.map((r: any) => r.residentId)).toEqual([personas.QA_USER.id]);
    expect((await needs(owner)).some(i => i.actionType === "join_request" && i.actionUrl === `/circles/${circle.id}`)).toBe(true);
    const requestNotes = (await notificationsFor(f, "QA_HOST_B", circle.id)).filter(n => n.title.startsWith("Join request"));
    expect(requestNotes.length).toBe(1); // HC-QA-033: a repeat while pending does not re-notify
    expect((await user.post(`/api/circles/${circle.id}/join-requests/${requests[0].id}/respond`, { data: { accept: true } })).status()).toBe(403);
    expect((await owner.post(`/api/circles/${circle.id}/join-requests/${requests[0].id}/respond`, { data: { accept: true } })).status()).toBe(200);
    expect((await owner.post(`/api/circles/${circle.id}/join-requests/${requests[0].id}/respond`, { data: { accept: true } })).status()).toBe(409);
    expect(await membership(user, circle.id)).toEqual({ member: true, role: "member", requested: false });
    const approved = (await notificationsFor(f, "QA_USER", circle.id)).filter(n => n.title.startsWith("Approved:"));
    expect(approved.length).toBe(1);
    expect(hrefOf(approved[0])).toBe(`/circles/${circle.id}`);
    for (const suffix of ["/members", "/plan-ideas", "/upcoming", "/polls"]) expect((await user.get(`/api/circles/${circle.id}${suffix}`)).status(), suffix).toBe(200);
    expect((await user.get(`/api/chat/circle/${circle.id}/messages`)).status()).toBe(200);
    expect((await (await user.get("/api/chat/mine")).json()).items.some((s: any) => s.scopeType === "circle" && s.scopeId === circle.id)).toBe(true);
    expect((await (await owner.get(`/api/circles/${circle.id}`)).json()).members).toBe(2);

    // Leave → private content closes again.
    expect((await user.delete(`/api/circles/${circle.id}/join`)).status()).toBe(200);
    expect(await membership(user, circle.id)).toEqual({ member: false, role: null, requested: false });
    expect((await user.get(`/api/circles/${circle.id}/members`)).status()).toBe(403);
    expect((await user.get(`/api/chat/circle/${circle.id}/messages`)).status()).toBe(403);
    // Sole organiser cannot leave.
    expect((await owner.delete(`/api/circles/${circle.id}/join`)).status()).toBe(409);

    // Re-request → decline.
    expect((await user.post(`/api/circles/${circle.id}/join`, { data: {} })).status()).toBe(202);
    const [again] = await (await owner.get(`/api/circles/${circle.id}/join-requests`)).json();
    expect((await owner.post(`/api/circles/${circle.id}/join-requests/${again.id}/respond`, { data: { accept: false } })).status()).toBe(200);
    expect(await membership(user, circle.id)).toEqual({ member: false, role: null, requested: false });
    expect((await notificationsFor(f, "QA_USER", circle.id)).filter(n => n.title.startsWith("Declined:")).length).toBe(1);

    // Remove: a member re-admitted by request, then removed by the organiser.
    expect((await user.post(`/api/circles/${circle.id}/join`, { data: {} })).status()).toBe(202);
    const [third] = await (await owner.get(`/api/circles/${circle.id}/join-requests`)).json();
    expect((await owner.post(`/api/circles/${circle.id}/join-requests/${third.id}/respond`, { data: { accept: true } })).status()).toBe(200);
    expect((await other.post(`/api/circles/${circle.id}/members/${personas.QA_USER.id}/remove`, { data: {} })).status()).toBe(403);
    expect((await owner.post(`/api/circles/${circle.id}/members/${personas.QA_USER.id}/remove`, { data: {} })).status()).toBe(200);
    expect((await owner.post(`/api/circles/${circle.id}/members/${personas.QA_HOST_B.id}/remove`, { data: {} })).status()).toBe(404); // organiser not removable
    expect(await memberRows(f, circle.id)).toEqual([{ resident_id: personas.QA_HOST_B.id, role: "organiser" }]);
    expect((await user.get(`/api/chat/circle/${circle.id}/messages`)).status()).toBe(403);
    expect((await notificationsFor(f, "QA_USER", circle.id)).filter(n => n.title.startsWith("Removed:")).length).toBe(1);

    // Open Circle: instant self-join, idempotent.
    const open = await createCircle(f, "QA_HOST_B", { joinMode: "open" });
    expect((await other.post(`/api/circles/${open.id}/join`, { data: {} })).status()).toBe(201);
    expect((await other.post(`/api/circles/${open.id}/join`, { data: {} })).status()).toBe(201);
    expect((await memberRows(f, open.id)).filter(m => m.resident_id === personas.QA_USER_B.id).length).toBe(1);
    await evidence("lc-cir-create-join", { ownerIsOrganiser: true, approvalFlow: true, declineFlow: true, leaveClosesPrivate: true, removeClosesPrivate: true, soleOrganiserLeaveBlocked: 409, joinRequestNotificationsForTwoSubmissions: requestNotes.length });
  });
});

test("LC-CIR-INVITE: organiser invitation, decline, re-invite, accept and invite-only enforcement", async ({ playwright }) => {
  await withActors(playwright, ["QA_HOST_B", "QA_USER", "QA_USER_B"], async f => {
    const { QA_HOST_B: owner, QA_USER: member, QA_USER_B: invitee } = f.actors;
    const circle = await createCircle(f, "QA_HOST_B", { joinMode: "invite" });
    expect((await invitee.post(`/api/circles/${circle.id}/join`, { data: {} })).status()).toBe(403); // no self-serve path
    const teaser = await (await invitee.get(`/api/circles/${circle.id}`)).json();
    expect(teaser).toMatchObject({ restricted: true, members: 0, hostName: "", hasPendingInvite: false });

    expect((await member.post(`/api/circles/${circle.id}/invite`, { data: { residentId: personas.QA_USER_B.id } })).status()).toBe(403);
    expect((await owner.post(`/api/circles/${circle.id}/invite`, { data: { residentId: personas.QA_USER_B.id } })).status()).toBe(201);
    const mine = await (await invitee.get("/api/circles/invitations/mine")).json();
    const inv = mine.find((i: any) => i.circleId === circle.id);
    expect(inv).toBeTruthy();
    expect((await (await invitee.get(`/api/circles/${circle.id}`)).json()).hasPendingInvite).toBe(true);
    expect((await needs(invitee)).some(i => i.actionType === "circle_invitation" && i.sourceId === inv.id)).toBe(true);
    const invitedNote = (await notificationsFor(f, "QA_USER_B", circle.id)).filter(n => n.title.startsWith("Invited:"));
    expect(invitedNote.length).toBe(1);
    expect(hrefOf(invitedNote[0])).toBe(`/circles/${circle.id}`);
    expect((await member.post(`/api/circles/invitations/${inv.id}/respond`, { data: { accept: true } })).status()).toBe(404); // not theirs

    expect((await invitee.post(`/api/circles/invitations/${inv.id}/respond`, { data: { accept: false } })).status()).toBe(200);
    expect((await invitee.post(`/api/circles/invitations/${inv.id}/respond`, { data: { accept: true } })).status()).toBe(409);
    expect((await membership(invitee, circle.id)).member).toBe(false);
    expect((await notificationsFor(f, "QA_HOST_B", circle.id)).filter(n => n.title.startsWith("Declined:")).length).toBe(1);

    expect((await owner.post(`/api/circles/${circle.id}/invite`, { data: { residentId: personas.QA_USER_B.id } })).status()).toBe(201);
    const [reinv] = await rows(f, "SELECT id, status FROM circle_invites WHERE circle_id = ? AND resident_id = ?", [circle.id, personas.QA_USER_B.id]);
    expect(reinv).toMatchObject({ id: inv.id, status: "pending" });
    expect((await invitee.post(`/api/circles/invitations/${inv.id}/respond`, { data: { accept: true } })).status()).toBe(200);
    expect(await membership(invitee, circle.id)).toEqual({ member: true, role: "member", requested: false });
    expect((await notificationsFor(f, "QA_HOST_B", circle.id)).filter(n => n.title.startsWith("Accepted:")).length).toBe(1);
    expect((await owner.post(`/api/circles/${circle.id}/invite`, { data: { residentId: personas.QA_USER_B.id } })).status()).toBe(409);
    expect((await invitee.get(`/api/circles/${circle.id}/members`)).status()).toBe(200);

    // Organiser invite also admits through POST /join (invite shortcut).
    expect((await owner.post(`/api/circles/${circle.id}/invite`, { data: { residentId: personas.QA_USER.id } })).status()).toBe(201);
    expect((await member.post(`/api/circles/${circle.id}/join`, { data: {} })).status()).toBe(201);
    expect((await membership(member, circle.id)).member).toBe(true);
    // Closed Circle: no new invitations/joins.
    expect((await owner.put(`/api/circles/${circle.id}/status`, { data: { status: "closed" } })).status()).toBe(200);
    expect((await owner.post(`/api/circles/${circle.id}/invite`, { data: { residentId: randomUUID() } })).status()).toBe(409);
    expect((await notificationsFor(f, "QA_USER", circle.id)).filter(n => n.title.startsWith("Closed:")).length).toBe(1);
    expect((await owner.put(`/api/circles/${circle.id}/status`, { data: { status: "active" } })).status()).toBe(200);
    // Revocation: no product route to withdraw a pending organiser invitation.
    const revoke = await owner.delete(`/api/circles/${circle.id}/invite`);
    const ghost = randomUUID();
    const ghostInvite = await owner.post(`/api/circles/${circle.id}/invite`, { data: { residentId: ghost } });
    const ghostRows = await rows(f, "SELECT id FROM circle_invites WHERE circle_id = ? AND resident_id = ?", [circle.id, ghost]);
    await evidence("lc-cir-invite", { declineThenReinvite: true, acceptedMember: true, alreadyMember: 409, closedBlocksInvite: 409, revokeRouteStatus: revoke.status(), nonexistentResidentInviteStatus: ghostInvite.status(), nonexistentResidentInviteRows: ghostRows.length });
  });
});
