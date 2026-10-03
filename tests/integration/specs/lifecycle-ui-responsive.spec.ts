import { randomUUID } from "node:crypto";
import { expect, personas } from "../fixtures";
import { evidence } from "../authorization-fixture";
import { test, withActors } from "../lifecycle-fixture";
import { trackCircle, trackGame, rows } from "../lifecycle-fixture";
import { uiActor, noHorizontalScroll } from "../lifecycle-ui-fixture";

// Phase 7 — Part 24. Critical journeys at tablet (820×1180) and mobile (390×844):
// create activity, discover, detail, join, Circle detail, membership, plan, chat.

for (const viewport of ["tablet", "mobile"] as const) {
  test(`LC-UI-${viewport.toUpperCase()}: create, discover, join, Circle membership, plan idea and chat`, async ({ playwright, browser }) => {
    test.setTimeout(150_000);
    await withActors(playwright, [], async f => {
      const host = await uiActor(browser, "QA_HOST", viewport);
      const user = await uiActor(browser, "QA_USER", viewport);
      const overflow: Record<string, boolean> = {};
      try {
        // Create activity through the UI.
        const label = `QA ${viewport} activity ${randomUUID().slice(0, 6)}`;
        await host.page.goto("/games/host");
        await host.page.locator("#game-activity").fill(label);
        await host.page.locator("#game-location").fill(`QA ${viewport} park`);
        await host.page.locator("#game-date").fill("2030-10-04");
        await host.page.locator("#game-time").fill("10:00");
        overflow.hostCreate = await noHorizontalScroll(host.page);
        await host.page.getByRole("button", { name: "Continue →" }).click();
        await host.page.getByRole("button", { name: "Create session", exact: true }).click();
        await expect(host.page.getByRole("heading", { name: "You're live." })).toBeVisible();
        const [game] = await rows(f, "SELECT id FROM games WHERE activity_label = ?", [label]);
        trackGame(f, game.id);

        // Discover → detail → join.
        await user.page.goto("/games");
        await expect(user.page.getByRole("link", { name: label }).first()).toBeAttached();
        overflow.discover = await noHorizontalScroll(user.page);
        await user.page.goto(`/games/${game.id}`);
        await expect(user.page.getByRole("heading", { name: label }).first()).toBeVisible();
        overflow.detail = await noHorizontalScroll(user.page);
        await user.page.getByRole("button", { name: "Join", exact: true }).filter({ visible: true }).first().click();
        await user.page.getByRole("button", { name: "Confirm I'm in" }).click();
        await expect(user.page.getByRole("button", { name: "View plan" })).toBeVisible();
        expect(await rows(f, "SELECT status FROM game_participants WHERE game_id = ? AND resident_id = ?", [game.id, personas.QA_USER.id])).toEqual([{ status: "joined" }]);

        // Circle detail → membership → plan idea → chat.
        const circle = await (await host.context.request.post("/api/circles", { data: { name: `QA ${viewport} circle ${randomUUID().slice(0, 6)}`, activityLabel: "QA responsive", joinMode: "open" } })).json();
        trackCircle(f, circle.id);
        await user.page.goto(`/circles/${circle.slug}`);
        overflow.circleDetail = await noHorizontalScroll(user.page);
        await user.page.getByRole("button", { name: "Join Circle" }).filter({ visible: true }).first().click();
        await user.page.getByRole("alertdialog").getByRole("button", { name: "Join Circle" }).click();
        await expect.poll(async () => (await rows(f, "SELECT role FROM circle_members WHERE circle_id = ? AND resident_id = ?", [circle.id, personas.QA_USER.id])).map(r => r.role)).toEqual(["member"]);
        await user.page.reload();
        await user.page.getByRole("button", { name: "Suggest a plan" }).first().click();
        await user.page.getByPlaceholder("e.g. Coastal walk").fill(`QA ${viewport} idea`);
        await user.page.getByRole("button", { name: "Suggest to Circle" }).click();
        await expect(user.page.getByText(`QA ${viewport} idea`).first()).toBeVisible();
        const [idea] = await rows(f, "SELECT status, created_by_resident_id FROM circle_plans WHERE circle_id = ?", [circle.id]);
        expect(idea).toEqual({ status: "idea", created_by_resident_id: personas.QA_USER.id });
        await user.page.getByRole("button", { name: /Group chat/ }).filter({ visible: true }).first().click();
        await user.page.getByRole("textbox", { name: "Message" }).fill(`QA ${viewport} chat`);
        await user.page.getByRole("button", { name: "Send", exact: true }).click();
        await expect(user.page.getByText(`QA ${viewport} chat`)).toBeVisible();
        overflow.chat = await noHorizontalScroll(user.page);
        await expect.poll(async () => (await rows(f, "SELECT body FROM chat_messages WHERE scope_type = 'circle' AND scope_id = ?", [circle.id])).map(r => r.body).join("|"), { timeout: 10_000 }).toBe(`QA ${viewport} chat`);
        expect(host.consoleErrors).toEqual([]);
        expect(user.consoleErrors).toEqual([]);
        await evidence(`lc-ui-${viewport}`, { created: true, discovered: true, joined: true, circleJoined: true, planIdea: true, chat: true, ...Object.fromEntries(Object.entries(overflow).map(([k, v]) => [`noHorizontalScroll_${k}`, v])) });
      } finally { await host.close(); await user.close(); }
    });
  });
}

test("LC-UI-MOBILE-CONSENT: first-visit consent banner (known mobile overlap) vs. the mobile join journey", async ({ playwright, browser }) => {
  test.setTimeout(90_000);
  await withActors(playwright, ["QA_HOST"], async f => {
    const game = await (await f.actors.QA_HOST.post("/api/games", { data: { activityLabel: `QA consent ${randomUUID().slice(0, 6)}`, date: "2030-10-05", time: "10:00", capacity: 6, locationText: "QA consent park" } })).json();
    trackGame(f, game.id);
    // No pre-decided consent: the fresh-visitor banner is present, as for a real first visit.
    const user = await uiActor(browser, "QA_USER", "mobile", { consent: false });
    try {
      await user.page.goto(`/games/${game.id}`);
      const banner = user.page.getByRole("button", { name: "Necessary only", exact: true });
      const bannerShown = await banner.isVisible().catch(() => false);
      let joinClickable = true;
      try {
        await user.page.getByRole("button", { name: "Join", exact: true }).filter({ visible: true }).first().click({ timeout: 5000 });
        await user.page.getByRole("button", { name: "Confirm I'm in" }).click({ timeout: 5000 });
      } catch { joinClickable = false; }
      let joined = false;
      try {
        await expect.poll(async () => (await rows(f, "SELECT status FROM game_participants WHERE game_id = ? AND resident_id = ?", [game.id, personas.QA_USER.id])).length, { timeout: 8_000 }).toBe(1);
        joined = true;
      } catch { joined = false; }
      let consentClickable = true;
      try { await user.page.getByRole("button", { name: "Necessary only", exact: true }).click({ timeout: 5000 }); } catch { consentClickable = false; }
      await evidence("lc-ui-hc-qa-001-impact", { bannerShown, joinClickableWithBanner: joinClickable, joinedWithBanner: joined, consentButtonClickable: consentClickable });
      expect(joined, "the known consent overlap must not block the join lifecycle").toBe(true);
    } finally { await user.close(); }
  });
});
