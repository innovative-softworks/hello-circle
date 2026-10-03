import { expect, personas } from "../fixtures";
import { evidence } from "../authorization-fixture";
import { test, withActors } from "../lifecycle-fixture";
import { createActivity, createCircle, rows, hrefOf } from "../lifecycle-fixture";

// Phase 7 — Part 21. In-app notifications only; the backend has no SMTP and
// external sockets are blocked by the QA wrapper, so no email leaves.

test("LC-NOTIFY: lifecycle events notify the right recipient once, navigate to the resource and track read state", async ({ playwright }) => {
  await withActors(playwright, ["QA_HOST", "QA_USER", "QA_USER_B"], async f => {
    const { QA_HOST: host, QA_USER: user, QA_USER_B: other } = f.actors;
    const game = await createActivity(f, "QA_HOST", { visibility: "invite", capacity: 3 });
    const circle = await createCircle(f, "QA_HOST", { joinMode: "approval" });
    // Events: activity invitation, join (no per-join host notice), update, plan change, circle request/approval, cancellation.
    expect((await host.post("/api/invitations", { data: { entityType: "game", entityId: game.id, inviteeResidentIds: [personas.QA_USER.id] } })).status()).toBe(201);
    expect((await user.post(`/api/games/${game.id}/join`, { data: {} })).status()).toBe(200);
    expect((await host.post(`/api/games/${game.id}/updates`, { data: { message: "QA bring water" } })).status()).toBe(201);
    expect((await host.put(`/api/games/${game.id}`, { data: { activityLabel: game.activityLabel, date: "2030-07-20", time: "18:30", capacity: 3, locationText: "QA synthetic park", visibility: "invite" } })).status()).toBe(200);
    expect((await user.post(`/api/circles/${circle.id}/join`, { data: {} })).status()).toBe(202);
    const [request] = await (await host.get(`/api/circles/${circle.id}/join-requests`)).json();
    expect((await host.post(`/api/circles/${circle.id}/join-requests/${request.id}/respond`, { data: { accept: true } })).status()).toBe(200);
    expect((await host.post(`/api/games/${game.id}/cancel`, { data: {} })).status()).toBe(200);

    const inbox = await (await user.get("/api/residents/me/notifications")).json() as any[];
    const mine = inbox.filter(n => n.listingId === game.id || n.listingId === circle.id);
    const byTitle = (prefix: string) => mine.filter(n => n.title.startsWith(prefix));
    const events: Record<string, any[]> = {
      invitation: mine.filter(n => n.kind === "invite"),
      update: byTitle("Update:"),
      planChange: byTitle("Plan updated:"),
      approval: byTitle("Approved:"),
      cancellation: byTitle("Cancelled:"),
    };
    for (const [event, list] of Object.entries(events)) {
      expect(list.length, `${event} notified exactly once`).toBe(1);
      const n = list[0];
      expect(n.read, `${event} starts unread`).toBe(0);
      const href = hrefOf({ kind: n.kind, listing_type: n.listingType, listing_id: n.listingId, ref: n.ref });
      expect(href, `${event} navigation target`).toBe(n.listingType === "circle" ? `/circles/${circle.id}` : `/games/${game.id}`);
      // Target resource is reachable for the recipient.
      const api = href!.startsWith("/circles/") ? `/api/circles/${circle.id}` : `/api/games/${game.id}`;
      expect((await user.get(api)).status(), `${event} target reachable`).toBe(200);
    }
    // Wrong recipients see none of the user's notifications.
    const otherInbox = await (await other.get("/api/residents/me/notifications")).json() as any[];
    expect(otherInbox.filter(n => n.listingId === game.id || n.listingId === circle.id)).toEqual([]);
    // Host received only the join request: no self-notification for own update/edit/cancel.
    const hostInbox = (await (await host.get("/api/residents/me/notifications")).json() as any[]).filter(n => n.listingId === game.id || n.listingId === circle.id);
    expect(hostInbox.map(n => n.title.split(":")[0]).sort()).toEqual(["Join request"]);

    // Read / unread.
    const target = events.update[0];
    expect((await other.post(`/api/residents/me/notifications/${target.id}/read`)).status()).toBe(404); // not theirs
    expect((await user.post(`/api/residents/me/notifications/${target.id}/read`)).status()).toBe(200);
    expect((await user.post(`/api/residents/me/notifications/${target.id}/read`)).status()).toBe(200); // idempotent
    const after = await (await user.get("/api/residents/me/notifications")).json() as any[];
    expect(after.find(n => n.id === target.id).read).toBe(1);
    expect(after.filter(n => (n.listingId === game.id || n.listingId === circle.id) && n.read === 0).length).toBe(mine.length - 1);
    const [dbRow] = await rows(f, "SELECT resident_id, `read` FROM notifications WHERE id = ?", [target.id]);
    expect(dbRow).toEqual({ resident_id: personas.QA_USER.id, read: 1 });
    // Ordering: newest first by created_at (ties are same-second).
    const times = after.map(n => new Date(n.createdAt).getTime());
    expect(times.every((t, i) => i === 0 || times[i - 1] >= t)).toBe(true);
    await evidence("lc-notify", { eventsEachOnce: Object.keys(events).length, wrongRecipientNone: true, hostSelfNotifications: 0, readUnread: true, crossUserMarkRead: 404, hostJoinNotificationsBelowCapacity: hostInbox.filter(n => n.title.startsWith("Your session is full")).length });
  });
});
