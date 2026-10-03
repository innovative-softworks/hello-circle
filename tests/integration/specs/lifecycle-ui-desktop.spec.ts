import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { expect, personas, manifest } from "../fixtures";
import { evidence } from "../authorization-fixture";
import { test, withActors } from "../lifecycle-fixture";
import { trackCircle, trackGame, rows } from "../lifecycle-fixture";
import { uiActor, noHorizontalScroll } from "../lifecycle-ui-fixture";

// Phase 7 — real browser journeys at desktop width (Parts 1-3, 5, 6-7, 13-14, 17, 19).

test("LC-UI-DESKTOP-HOST: create Circle, create official plan, draft activity, publish and edit through the UI", async ({ playwright, browser }) => {
  test.setTimeout(120_000);
  await withActors(playwright, ["GUEST"], async f => {
    const host = await uiActor(browser, "QA_HOST", "desktop");
    const { page } = host;
    try {
      // Part 13 — Circle via Start a Circle.
      const circleName = `QA UI circle ${randomUUID().slice(0, 8)}`;
      const activityName = `QA UI walk ${randomUUID().slice(0, 6)}`;
      await page.goto("/circles/start");
      await page.getByPlaceholder("e.g. Clontarf Badminton Circle").fill(circleName);
      await page.getByPlaceholder("e.g. Badminton").fill(activityName);
      await page.locator("select").filter({ hasText: "Invite only" }).selectOption("invite");
      await page.getByRole("button", { name: "Create Circle", exact: true }).click();
      await expect(page.getByRole("heading", { name: "Your Circle is live." })).toBeVisible();
      const [circle] = await rows(f, "SELECT id, join_mode, created_by_resident_id FROM circles WHERE name = ?", [circleName]);
      trackCircle(f, circle.id);
      expect(circle).toMatchObject({ join_mode: "invite", created_by_resident_id: personas.QA_HOST.id });
      expect((await rows(f, "SELECT role FROM circle_members WHERE circle_id = ? AND resident_id = ?", [circle.id, personas.QA_HOST.id]))[0].role).toBe("organiser");

      // Part 17 — organiser creates the Circle's first official plan through the UI deep link.
      await page.getByRole("button", { name: "Create first plan" }).click();
      await expect(page.locator("#game-activity")).toHaveValue(activityName);
      await page.locator("#game-location").fill("QA UI meeting point");
      await page.locator("#game-date").fill("2030-09-20");
      await page.locator("#game-time").fill("18:00");
      await page.getByRole("button", { name: "Continue →" }).click();
      await page.getByRole("button", { name: "Create session", exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`/manage/circles/${circle.id}`));
      const [plan] = await rows(f, "SELECT id, circle_id, visibility, lifecycle, host_resident_id FROM games WHERE circle_id = ?", [circle.id]);
      trackGame(f, plan.id);
      expect(plan).toMatchObject({ circle_id: circle.id, lifecycle: "active", host_resident_id: personas.QA_HOST.id });
      const anonymousList = await (await f.actors.GUEST.get("/api/games")).json();
      const planPublic = anonymousList.some((g: any) => g.id === plan.id);
      const planCircleNamePublic = anonymousList.find((g: any) => g.id === plan.id)?.circleName === circleName;
      await page.goto(`/circles/${circle.id}`);
      await expect(page.getByText(circleName).first()).toBeVisible();

      // Parts 1-3 — standalone activity saved as draft, then published, then edited.
      const label = `QA UI activity ${randomUUID().slice(0, 8)}`;
      await page.goto("/games/host");
      await page.locator("#game-activity").fill(label);
      await page.locator("#game-location").fill("QA UI park");
      await page.locator("#game-date").fill("2030-09-21");
      await page.locator("#game-time").fill("09:30");
      await page.getByRole("button", { name: "Continue →" }).click();
      await page.getByRole("radio", { name: /Save as draft/ }).check();
      await page.getByRole("button", { name: "Create session", exact: true }).click();
      await expect(page.getByRole("heading", { name: "Draft saved." })).toBeVisible(); // HC-QA-032
      const draftConfirmationSaysLive = await page.getByRole("heading", { name: "You're live." }).isVisible();
      const [draft] = await rows(f, "SELECT id, lifecycle, visibility FROM games WHERE activity_label = ?", [label]);
      trackGame(f, draft.id);
      expect(draft).toMatchObject({ lifecycle: "draft", visibility: "public" });
      expect((await f.actors.GUEST.get(`/api/games/${draft.id}`)).status()).toBe(404);
      await page.getByRole("button", { name: "Manage activity" }).click();
      await expect(page).toHaveURL(new RegExp(`/games/${draft.id}`));
      await expect(page.getByRole("heading", { name: label }).first()).toBeVisible();

      await page.goto(`/games/host/${draft.id}`);
      await expect(page.getByText("Draft — only you can see this")).toBeVisible();
      await page.getByRole("button", { name: "Publish now" }).click();
      await expect.poll(async () => (await rows(f, "SELECT lifecycle FROM games WHERE id = ?", [draft.id]))[0].lifecycle).toBe("active");
      expect((await f.actors.GUEST.get(`/api/games/${draft.id}`)).status()).toBe(200);
      await page.locator("#game-activity").fill(`${label} edited`);
      await page.getByRole("button", { name: "Continue →" }).click();
      await page.getByRole("button", { name: "Save changes" }).click();
      await expect(page).toHaveURL(/\/manage\?tab=activities/);
      expect((await rows(f, "SELECT activity_label, lifecycle FROM games WHERE id = ?", [draft.id]))[0]).toEqual({ activity_label: `${label} edited`, lifecycle: "active" });
      await expect(page.getByText(`${label} edited`).first()).toBeVisible();
      expect(await noHorizontalScroll(page)).toBe(true);
      expect(host.consoleErrors).toEqual([]);
      await evidence("lc-ui-desktop-host", { circleCreatedViaUi: true, officialPlanViaUi: true, uiCirclePlanVisibility: String(plan.visibility), invitOnlyCirclePlanInPublicList: planPublic, invitOnlyCircleNameInPublicList: planCircleNamePublic, draftViaUi: true, draftConfirmationSaysLive, publishedViaUi: true, editedViaUi: true });
    } finally { await host.close(); }
  });
});

test("LC-UI-DESKTOP-PARTICIPANT: discover, join, refresh persistence, leave, Circle join and chat through the UI", async ({ playwright, browser }) => {
  test.setTimeout(120_000);
  await withActors(playwright, ["QA_HOST_B"], async f => {
    const organiser = f.actors.QA_HOST_B;
    const game = await (await organiser.post("/api/games", { data: { activityLabel: `QA UI join ${randomUUID().slice(0, 8)}`, date: "2030-09-22", time: "11:00", capacity: 6, locationText: "QA UI pitch" } })).json();
    trackGame(f, game.id);
    const circleRes = await (await organiser.post("/api/circles", { data: { name: `QA UI open circle ${randomUUID().slice(0, 8)}`, activityLabel: "QA UI chat", joinMode: "open" } })).json();
    trackCircle(f, circleRes.id);
    const user = await uiActor(browser, "QA_USER", "desktop");
    const { page } = user;
    let step = "start";
    const mark = (name: string) => { step = name; writeFileSync(path.join(manifest.dataDir, "evidence", "lc-ui-desktop-participant-step.json"), JSON.stringify({ lastStep: step }), { mode: 0o600 }); };
    try {
      mark("discover");
      await page.goto("/games");
      const cardLink = page.getByRole("link", { name: game.activityLabel }).first();
      await cardLink.scrollIntoViewIfNeeded();
      // Hit-test: which element receives a real click on the card photo vs. the text area?
      const hit = await cardLink.evaluate((link) => {
        const r = link.getBoundingClientRect();
        const onLink = (x: number, y: number) => document.elementFromPoint(x, y) === link;
        return { photoArea: onLink(r.x + r.width / 2, r.y + 40), textArea: onLink(r.x + 30, r.y + r.height - 30), height: r.height };
      });
      await cardLink.click({ position: { x: 30, y: hit.height - 30 } }); // where a real click reaches the link
      await expect(page).toHaveURL(new RegExp(`/games/${game.id}`));
      await page.getByRole("button", { name: "Join", exact: true }).click();
      await page.getByRole("button", { name: "Confirm I'm in" }).click();
      await expect(page.getByRole("button", { name: "View plan" })).toBeVisible(); // joined confirmation state
      mark("reload"); await page.reload(); // refresh/session persistence
      await expect(page.getByRole("button", { name: "Leave session" }).first()).toBeVisible();
      expect((await rows(f, "SELECT status FROM game_participants WHERE game_id = ? AND resident_id = ?", [game.id, personas.QA_USER.id]))).toEqual([{ status: "joined" }]);
      mark("leave");
      await page.getByRole("button", { name: "Leave session" }).first().click();
      await page.getByRole("alertdialog").getByRole("button", { name: "Leave session" }).click();
      await expect(page.getByRole("button", { name: "Join", exact: true })).toBeVisible();
      expect((await rows(f, "SELECT status FROM game_participants WHERE game_id = ? AND resident_id = ?", [game.id, personas.QA_USER.id]))).toEqual([{ status: "cancelled" }]);

      mark("circle-join");
      await page.goto(`/circles/${circleRes.slug}`);
      await page.getByRole("button", { name: "Join Circle" }).first().click();
      await page.getByRole("alertdialog").getByRole("button", { name: "Join Circle" }).click();
      await expect.poll(async () => (await rows(f, "SELECT role FROM circle_members WHERE circle_id = ? AND resident_id = ?", [circleRes.id, personas.QA_USER.id])).length).toBe(1);
      await page.reload();
      mark("chat-open"); await page.getByRole("button", { name: /Group chat/ }).first().click();
      await page.getByRole("textbox", { name: "Message" }).fill("QA UI chat hello");
      await page.getByRole("button", { name: "Send", exact: true }).click();
      await expect(page.getByText("QA UI chat hello")).toBeVisible();
      await page.reload();
      await page.getByRole("button", { name: /Group chat/ }).first().click();
      await expect(page.getByText("QA UI chat hello")).toBeVisible();
      expect((await rows(f, "SELECT body FROM chat_messages WHERE scope_type = 'circle' AND scope_id = ?", [circleRes.id])).map(r => r.body)).toEqual(["QA UI chat hello"]);

      mark("inbox"); // HC-QA-022 UI impact: a second Circle conversation with messages makes the inbox 500,
      // and ListingChatButton silently hides the chat entry point.
      const second = await (await organiser.post("/api/circles", { data: { name: `QA UI second ${randomUUID().slice(0, 8)}`, joinMode: "open" } })).json();
      trackCircle(f, second.id);
      expect((await user.context.request.post(`/api/circles/${second.id}/join`, { data: {} })).status()).toBe(201);
      expect((await user.context.request.post(`/api/chat/circle/${second.id}/messages`, { data: { body: "QA second" } })).status()).toBe(201);
      await page.goto(`/circles/${circleRes.slug}`);
      await expect(page.getByRole("heading").first()).toBeVisible();
      await page.waitForLoadState("networkidle");
      const chatButtonAfterSecondConversation = await page.getByRole("button", { name: /Group chat/ }).count();
      await page.goto("/chats");
      await page.waitForLoadState("networkidle");
      const chatsPageShowsFirst = await page.getByText("QA UI chat hello").count();
      await evidence("lc-ui-desktop-participant", { cardPhotoAreaClickReachesLink: hit.photoArea, cardTextAreaClickReachesLink: hit.textArea, discoveredAndJoined: true, persistedAfterReload: true, leftViaUi: true, circleJoinedViaUi: true, chatSentAndPersisted: true, chatButtonAfterSecondConversation, chatsPageShowsFirstConversation: chatsPageShowsFirst });
    } finally { await user.close(); }
  });
});
