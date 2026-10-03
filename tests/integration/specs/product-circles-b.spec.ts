import { randomUUID } from "node:crypto";
import { expect, personas } from "../fixtures";
import { evidence } from "../authorization-fixture";
import { test, withActors, createCircle, createActivity, rows } from "../lifecycle-fixture";
import { uiActor } from "../lifecycle-ui-fixture";

// Phase 10A — HC-QA-055 (chat text lost during an in-flight send) and
// HC-QA-056 (Circle members not notified of new plans). Original
// failing-before regressions first; adjacent invariants after.

test("HC-QA-055: messages typed and sent while a send is in flight are not lost", async ({ playwright, browser }) => {
  await withActors(playwright, ["QA_HOST", "QA_USER"], async (f) => {
    const circle = await createCircle(f, "QA_HOST", { joinMode: "open" });
    expect((await f.actors.QA_USER.post(`/api/circles/${circle.id}/join`, { data: {} })).status()).toBe(201);
    const ui = await uiActor(browser, "QA_USER", "desktop");
    try {
      const { page } = ui;
      // A realistic round trip so the next message is typed while the previous one is still sending.
      await page.route("**/api/chat/**", async (route) => { if (route.request().method() === "POST") await new Promise((r) => setTimeout(r, 400)); await route.continue(); });
      await page.goto(`/circles/${circle.id}`);
      await page.getByText("Chat", { exact: true }).first().click();
      const box = page.getByRole("textbox", { name: "Message" });
      await expect(box).toBeVisible();
      for (let i = 1; i <= 5; i++) { await box.fill(`QA rapid ${i}`); await box.press("Enter"); }
      await expect.poll(async () => (await rows(f, "SELECT body FROM chat_messages WHERE scope_id = ? AND resident_id = ? ORDER BY id", [circle.id, personas.QA_USER.id])).map((r) => r.body), { timeout: 15_000 })
        .toEqual(["QA rapid 1", "QA rapid 2", "QA rapid 3", "QA rapid 4", "QA rapid 5"]);
      await expect(box).toHaveValue("");
      await evidence("hc-qa-055", { sent: 5, persisted: 5, inOrder: true });
    } finally { await ui.close(); }
  });
});

const planNotifications = (f: Parameters<Parameters<typeof withActors>[2]>[0], residentId: string, gameId: string) =>
  rows(f, "SELECT id, title FROM notifications WHERE resident_id = ? AND listing_id = ?", [residentId, gameId]);

test("HC-QA-056: Circle members are notified when the organiser creates a plan", async ({ playwright }) => {
  await withActors(playwright, ["QA_HOST", "QA_USER", "QA_USER_B"], async (f) => {
    const circle = await createCircle(f, "QA_HOST", { joinMode: "open" });
    expect((await f.actors.QA_USER.post(`/api/circles/${circle.id}/join`, { data: {} })).status()).toBe(201);
    const plan = await createActivity(f, "QA_HOST", { circleId: circle.id });
    await expect.poll(async () => (await planNotifications(f, personas.QA_USER.id, plan.id)).length).toBe(1);
    await evidence("hc-qa-056", { memberNotified: true });
  });
});

test("HC-QA-056-ELIGIBILITY: only current members, once per plan, only when the plan is bookable", async ({ playwright }) => {
  await withActors(playwright, ["QA_HOST", "QA_USER", "QA_USER_B"], async (f) => {
    const circle = await createCircle(f, "QA_HOST", { joinMode: "open" });
    expect((await f.actors.QA_USER.post(`/api/circles/${circle.id}/join`, { data: {} })).status()).toBe(201);
    expect((await f.actors.QA_USER_B.post(`/api/circles/${circle.id}/join`, { data: {} })).status()).toBe(201);
    expect((await f.actors.QA_HOST.post(`/api/circles/${circle.id}/members/${personas.QA_USER_B.id}/remove`, { data: {} })).status()).toBe(200);

    const live = await createActivity(f, "QA_HOST", { circleId: circle.id });
    await expect.poll(async () => (await planNotifications(f, personas.QA_USER.id, live.id)).length).toBe(1);
    expect((await planNotifications(f, personas.QA_USER_B.id, live.id)).length, "removed member not notified").toBe(0);
    expect((await planNotifications(f, personas.QA_HOST.id, live.id)).length, "organiser not notified of own plan").toBe(0);
    const [note] = await planNotifications(f, personas.QA_USER.id, live.id);
    expect(note.title).toContain(live.activityLabel);

    // Draft: never announced.
    const draft = await createActivity(f, "QA_HOST", { circleId: circle.id, lifecycle: "draft" });
    // Coming soon: announced only when it opens, exactly once.
    const soon = await createActivity(f, "QA_HOST", { circleId: circle.id, lifecycle: "coming_soon" });
    expect((await planNotifications(f, personas.QA_USER.id, draft.id)).length).toBe(0);
    expect((await planNotifications(f, personas.QA_USER.id, soon.id)).length).toBe(0);
    expect((await f.actors.QA_HOST.post(`/api/games/${soon.id}/lifecycle`, { data: { lifecycle: "active" } })).status()).toBe(200);
    await expect.poll(async () => (await planNotifications(f, personas.QA_USER.id, soon.id)).length).toBe(1);
    await f.actors.QA_HOST.post(`/api/games/${soon.id}/lifecycle`, { data: { lifecycle: "active" } });
    expect((await planNotifications(f, personas.QA_USER.id, soon.id)).length, "no duplicate on a repeated open").toBe(1);

    // A standalone (non-Circle) activity does not notify Circle members.
    const standalone = await createActivity(f, "QA_HOST", { activityLabel: `QA standalone ${randomUUID().slice(0, 6)}` });
    expect((await planNotifications(f, personas.QA_USER.id, standalone.id)).length).toBe(0);
    await evidence("hc-qa-056-eligibility", { removedMemberNotified: false, organiserNotified: false, duplicateOnReopen: false });
  });
});
