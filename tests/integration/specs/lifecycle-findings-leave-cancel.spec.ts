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

test("HC-QA-027: leaving a free activity does not tell the host to refund a payment", async ({ playwright }) => {
  await withActors(playwright, ["QA_HOST", "QA_USER"], async f => {
    const game = await createActivity(f, "QA_HOST");
    expect((await f.actors.QA_USER.post(`/api/games/${game.id}/join`, { data: {} })).status()).toBe(200);
    expect((await f.actors.QA_USER.delete(`/api/games/${game.id}/join`)).status()).toBe(200);
    const notes = await notificationsFor(f, "QA_HOST", game.id);
    const refundCopy = notes.filter(n => /paid|refund/i.test(n.body));
    await evidence("hc-qa-027", { hostNotifications: notes.length, refundWordingNotifications: refundCopy.length });
    expect(refundCopy.length).toBe(0);
  });
});

test("HC-QA-028-WAITLIST-ON-CANCEL: cancelling closes waitlist entries and informs waitlisted residents", async ({ playwright }) => {
  await withActors(playwright, ["QA_HOST", "QA_USER", "QA_USER_B"], async f => {
    const game = await createActivity(f, "QA_HOST", { capacity: 2 });
    expect((await f.actors.QA_USER.post(`/api/games/${game.id}/join`, { data: {} })).status()).toBe(200);
    expect((await f.actors.QA_USER_B.post(`/api/games/${game.id}/waitlist`, { data: {} })).status()).toBe(201);
    expect((await f.actors.QA_HOST.post(`/api/games/${game.id}/cancel`, { data: {} })).status()).toBe(200);
    const [entry] = await waitlist(f, game.id);
    const notes = await notificationsFor(f, "QA_USER_B", game.id);
    const detail = await (await f.actors.QA_USER_B.get(`/api/games/${game.id}`)).json();
    await evidence("hc-qa-028-waitlist", { entryStatus: entry.status, waitlistedNotified: notes.length, stillShownWaitlisted: detail.waitlistedByMe });
    expect(entry.status).not.toBe("waiting");
    expect(notes.length).toBe(1);
  });
});

test("HC-QA-028-REPEAT-CANCEL: cancelling an already-cancelled activity does not re-notify participants", async ({ playwright }) => {
  await withActors(playwright, ["QA_HOST", "QA_USER"], async f => {
    const game = await createActivity(f, "QA_HOST");
    expect((await f.actors.QA_USER.post(`/api/games/${game.id}/join`, { data: {} })).status()).toBe(200);
    expect((await f.actors.QA_HOST.post(`/api/games/${game.id}/cancel`, { data: {} })).status()).toBe(200);
    const second = await f.actors.QA_HOST.post(`/api/games/${game.id}/cancel`, { data: {} });
    const count = (await notificationsFor(f, "QA_USER", game.id)).filter(n => n.title.startsWith("Cancelled:")).length;
    await evidence("hc-qa-028-repeat", { secondCancelStatus: second.status(), cancellationNotifications: count });
    expect(count).toBe(1);
  });
});

test("HC-QA-028-ARCHIVE-SILENT: archiving an upcoming activity with participants informs them", async ({ playwright }) => {
  await withActors(playwright, ["QA_HOST", "QA_USER"], async f => {
    const game = await createActivity(f, "QA_HOST");
    expect((await f.actors.QA_USER.post(`/api/games/${game.id}/join`, { data: {} })).status()).toBe(200);
    const archive = await f.actors.QA_HOST.post(`/api/games/${game.id}/lifecycle`, { data: { lifecycle: "archived" } });
    const notes = await notificationsFor(f, "QA_USER", game.id);
    await evidence("hc-qa-028-archive", { archiveStatus: archive.status(), participantNotified: notes.length });
    expect(archive.status() === 409 || notes.length === 1, "archive must be blocked or communicated to participants").toBe(true);
  });
});
