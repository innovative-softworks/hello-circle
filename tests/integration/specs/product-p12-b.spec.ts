import { randomUUID } from "node:crypto";
import { expect, personas } from "../fixtures";
import { evidence } from "../authorization-fixture";
import { test, withActors, rows } from "../lifecycle-fixture";
import { uiActor } from "../lifecycle-ui-fixture";
import { businessUiActor } from "../product-fixture";
import { closureGame } from "../closure-fixture";
import { bookableCentre, bookableProgram } from "../booking-fixture";

// Phase 12 — HC-QA-059 (gated venue status), revoked-invitation notification,
// programme-session cancellation notifications, notifications Load more.

test("HC-QA-059: an approved venue is shown as 'Not publicly visible' (not 'Live') while venue pages are gated; no dead public links", async ({ playwright, browser }) => {
  test.setTimeout(90_000);
  await withActors(playwright, ["QA_VENDOR"], async (f) => {
    const centre = await bookableCentre(f, { rate: 20 });
    const [{ name }] = await rows(f, "SELECT name FROM centres WHERE id = ?", [(centre as any).id]);
    const vendor = await businessUiActor(browser, "QA_VENDOR", "desktop");
    try {
      const { page } = vendor;
      // The listings tab label varies per vendor ("My centre", …); open it directly.
      await page.goto("/vendor?tab=listings");
      // Every approved venue is gated in this configuration, so assert on the whole listings view.
      const main = page.locator("main");
      await expect(main.getByText("Not publicly visible").locator("visible=true").first()).toBeVisible({ timeout: 20_000 });
      await expect(main.getByText(/Venue pages aren't publicly available yet/).locator("visible=true").first()).toBeVisible();
      await expect(main.getByText("View live listing"), "no dead public link").toHaveCount(0);
      await expect(main.getByText("Live", { exact: true }), "no misleading 'Live' badge").toHaveCount(0);
      expect(name).toBeTruthy();
      // Publication state itself is unchanged.
      expect((await rows(f, "SELECT status FROM centres WHERE id = ?", [(centre as any).id]))[0].status).toBe("approved");
    } finally { await vendor.close(); }
    const guest = await uiActor(browser, null, "desktop");
    try {
      await guest.page.goto(`/centres/${(centre as any).id}`);
      await expect(guest.page).toHaveURL(/coming-soon/);
    } finally { await guest.close(); }
    await evidence("hc-qa-059", { vendorLabel: "Not publicly visible", publicGated: true, statusUnchanged: true });
  });
});

test("PART-10: revoking an invitation turns the recipient's notification into a non-actionable 'Invitation withdrawn' — once, without activity details", async ({ playwright }) => {
  await withActors(playwright, ["QA_HOST", "QA_USER"], async (f) => {
    const game = await closureGame(f);
    expect((await f.actors.QA_HOST.post("/api/invitations", { data: { entityType: "game", entityId: game, inviteeResidentIds: [personas.QA_USER.id] } })).status()).toBe(201);
    const [inv] = await rows(f, "SELECT id FROM invitations WHERE entity_id = ? AND invitee_resident_id = ?", [game, personas.QA_USER.id]);
    f.track("audit_log", "object_id", inv.id);
    const [{ activity_label: label }] = await rows(f, "SELECT activity_label FROM games WHERE id = ?", [game]);
    const before = await rows(f, "SELECT id, kind, title FROM notifications WHERE resident_id = ? AND listing_id = ?", [personas.QA_USER.id, game]);
    expect(before.some((n: any) => n.kind === "invite"), "actionable invite notification exists first").toBe(true);
    const total = (await rows(f, "SELECT COUNT(*) AS n FROM notifications WHERE resident_id = ?", [personas.QA_USER.id]))[0].n;
    expect((await f.actors.QA_HOST.post(`/api/invitations/${inv.id}/revoke`, { data: {} })).status()).toBe(200);
    expect((await f.actors.QA_HOST.post(`/api/invitations/${inv.id}/revoke`, { data: {} })).status(), "idempotent").toBe(200);
    const ids = before.map((n: any) => n.id);
    const after = await rows(f, `SELECT kind, title, body, listing_id, ref FROM notifications WHERE id IN (${ids.map(() => "?").join(",")})`, ids);
    const totalAfter = (await rows(f, "SELECT COUNT(*) AS n FROM notifications WHERE resident_id = ?", [personas.QA_USER.id]))[0].n;
    await evidence("part-10", { withdrawn: after.length, kinds: after.map((n: any) => n.kind).join(","), noNewNotification: Number(totalAfter) === Number(total) });
    for (const n of after as any[]) {
      expect(n.kind).toBe("invite_withdrawn");
      expect(n.title).toBe("Invitation withdrawn");
      expect(`${n.title} ${n.body}`, "no activity details").not.toContain(label);
      expect(n.listing_id, "no link target").toBe("");
    }
    expect(Number(totalAfter), "no duplicate/extra notification").toBe(Number(total));
    // The recipient's API view of it carries no destination.
    const mine = await (await f.actors.QA_USER.get("/api/residents/me/notifications?limit=100")).json();
    expect(mine.filter((n: any) => n.kind === "invite_withdrawn").every((n: any) => !n.listingId)).toBe(true);
  });
});

test("PART-11: cancelling one programme session notifies residents with a live enrolment — once; not cancelled enrolments or unrelated residents", async ({ playwright }) => {
  await withActors(playwright, ["QA_VENDOR", "QA_USER", "QA_USER_B"], async (f) => {
    const prog = await bookableProgram(f, { price: 0, capacity: 5 });
    const session = randomUUID();
    const date = new Date(Date.now() + 12 * 86_400_000).toISOString().slice(0, 10);
    await f.connection.execute("INSERT INTO program_sessions (id, program_id, date, time, status) VALUES (?, ?, ?, '18:00', 'scheduled')", [session, prog.id, date]);
    f.track("program_sessions", "id", session);
    const enrol = async (actor: string) => {
      const r = await f.actors[actor].post(`/api/programs/${prog.id}/enroll`, { headers: { "X-Client-Id": randomUUID() }, data: { participantName: `QA ${actor}`, email: `qa_${randomUUID().slice(0, 6)}@example.test` } });
      expect(r.status()).toBe(201);
      return (await r.json()).ref as string;
    };
    await enrol("QA_USER");
    const refB = await enrol("QA_USER_B");
    expect((await f.actors.QA_USER_B.post(`/api/programs/enrollments/${refB}/cancel`, { headers: { "X-Client-Id": randomUUID() }, data: {} })).status()).toBe(200);
    const count = async (who: string) => Number((await rows(f, "SELECT COUNT(*) AS n FROM notifications WHERE resident_id = ? AND ref = ? AND title LIKE 'Session cancelled:%'", [personas[who].id, session]))[0].n);
    expect((await f.actors.QA_VENDOR.delete(`/api/vendor/programs/${prog.id}/sessions/${session}`)).status()).toBe(200);
    expect((await f.actors.QA_VENDOR.delete(`/api/vendor/programs/${prog.id}/sessions/${session}`)).status(), "repeat is a no-op").toBe(200);
    const [n] = await rows(f, "SELECT title, body FROM notifications WHERE resident_id = ? AND ref = ?", [personas.QA_USER.id, session]);
    await evidence("part-11", { enrolledNotified: await count("QA_USER"), cancelledEnrolmentNotified: await count("QA_USER_B"), mentionsDate: !!n && String(n.body).includes(date) });
    expect(await count("QA_USER"), "enrolled resident notified exactly once").toBe(1);
    expect(await count("QA_USER_B"), "cancelled enrolment not notified").toBe(0);
    expect(String(n.body), "identifies the affected date").toContain(date);
    expect(String(n.title)).toContain("Session cancelled:");
  });
});

test("HC-QA-073-NOTIFICATIONS: Profile inbox loads more server pages; rows are keyboard-operable buttons", async ({ playwright, browser }) => {
  await withActors(playwright, ["QA_USER"], async (f) => {
    const tag = `QA inbox ${randomUUID().slice(0, 6)}`;
    const values: unknown[] = [];
    for (let i = 0; i < 60; i++) values.push("", personas.QA_USER.id, "circle", `${tag} ${i}`, "Synthetic", "circle", "x", "x");
    await f.connection.query(`INSERT INTO notifications (recipient_id, resident_id, kind, title, body, listing_type, listing_id, ref) VALUES ${Array.from({ length: 60 }, () => "(?,?,?,?,?,?,?,?)").join(",")}`, values);
    const ui = await uiActor(browser, "QA_USER", "desktop");
    try {
      const { page } = ui;
      await page.goto("/profile?tab=inbox"); // Profile's own deep link to the notifications inbox
      const list = page.getByRole("list", { name: "Notifications" });
      await expect(list).toBeVisible({ timeout: 20_000 });
      const before = await list.getByText(tag, { exact: false }).count();
      expect(before).toBeGreaterThan(0);
      expect(before).toBeLessThan(60);
      await page.getByRole("button", { name: "Load more" }).click();
      await expect.poll(async () => list.getByText(tag, { exact: false }).count()).toBe(60);
      expect(await list.getByRole("button").count(), "unread rows are buttons").toBeGreaterThan(0);
      await evidence("hc-qa-073-notifications", { firstPage: before, afterLoadMore: 60 });
    } finally {
      await ui.close();
      await f.connection.execute("DELETE FROM notifications WHERE resident_id = ? AND title LIKE ?", [personas.QA_USER.id, `${tag}%`]);
    }
  });
});
