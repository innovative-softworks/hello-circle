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

test("HC-QA-031: clicking an activity card's photo opens the activity", async ({ playwright, browser }) => {
  await withActors(playwright, ["QA_HOST"], async f => {
    const game = await createActivity(f, "QA_HOST");
    const viewer = await uiActor(browser, null, "desktop");
    try {
      await viewer.page.goto("/games");
      const link = viewer.page.getByRole("link", { name: game.activityLabel }).first();
      await link.scrollIntoViewIfNeeded();
      const photoHitsLink = await link.evaluate((el) => { const r = el.getBoundingClientRect(); return document.elementFromPoint(r.x + r.width / 2, r.y + 40) === el; });
      await evidence("hc-qa-031", { photoAreaClickReachesLink: photoHitsLink });
      expect(photoHitsLink).toBe(true);
    } finally { await viewer.close(); }
  });
});

test("HC-QA-031-INTERACTION: photo, text area and keyboard open the activity; save stays a separate control", async ({ playwright, browser }) => {
  await withActors(playwright, ["QA_HOST"], async f => {
    const game = await createActivity(f, "QA_HOST");
    f.track("favourites", "listing_id", game.id);
    const user = await uiActor(browser, "QA_USER", "desktop");
    const { page } = user;
    try {
      const card = async () => { await page.goto("/games"); const l = page.getByRole("link", { name: game.activityLabel }).first(); await l.scrollIntoViewIfNeeded(); return l; };
      // Mouse: photo area.
      let link = await card();
      let box = (await link.boundingBox())!;
      await page.mouse.click(box.x + box.width / 2, box.y + 40);
      await expect(page).toHaveURL(new RegExp(`/games/${game.id}$`));
      // Mouse: text area.
      link = await card(); box = (await link.boundingBox())!;
      await page.mouse.click(box.x + 30, box.y + box.height - 30);
      await expect(page).toHaveURL(new RegExp(`/games/${game.id}$`));
      // Save control inside the photo stays independent (no navigation, real toggle).
      link = await card();
      const cardRoot = page.locator(".card-surface").filter({ has: link });
      const save = cardRoot.getByRole("button").first();
      await save.click();
      await expect(page).toHaveURL(/\/games$/);
      await expect.poll(async () => (await rows(f, "SELECT id FROM favourites WHERE listing_id = ? AND resident_id = ?", [game.id, personas.QA_USER.id])).length).toBe(1);
      // Keyboard: the card link is focusable with an accessible name; Enter opens it.
      link = await card();
      await link.focus();
      expect(await link.evaluate(el => document.activeElement === el && el.getAttribute("aria-label"))).toBe(game.activityLabel);
      expect(await link.evaluate(el => el.querySelectorAll("a, button").length)).toBe(0); // no nested interactive content
      await page.keyboard.press("Enter");
      await expect(page).toHaveURL(new RegExp(`/games/${game.id}$`));
    } finally { await user.close(); }
  });
});

test("HC-QA-032-DRAFT-COPY: saving a draft is not confirmed as live", async ({ playwright, browser }) => {
  await withActors(playwright, [], async f => {
    const host = await uiActor(browser, "QA_HOST", "desktop");
    try {
      const label = `QA draft copy ${randomUUID().slice(0, 6)}`;
      await host.page.goto("/games/host");
      await host.page.locator("#game-activity").fill(label);
      await host.page.locator("#game-location").fill("QA park");
      await host.page.locator("#game-date").fill("2030-09-21");
      await host.page.locator("#game-time").fill("09:30");
      await host.page.getByRole("button", { name: "Continue →" }).click();
      await host.page.getByRole("radio", { name: /Save as draft/ }).check();
      await host.page.getByRole("button", { name: "Create session", exact: true }).click();
      await expect.poll(async () => (await rows(f, "SELECT id FROM games WHERE activity_label = ?", [label])).length).toBe(1);
      const [g] = await rows(f, "SELECT id FROM games WHERE activity_label = ?", [label]);
      trackGame(f, g.id);
      const saysLive = await host.page.getByRole("heading", { name: "You're live." }).isVisible();
      await evidence("hc-qa-032-draft", { draftConfirmationSaysLive: saysLive });
      expect(saysLive).toBe(false);
    } finally { await host.close(); }
  });
});

test("HC-QA-032-PAST-DATE: an activity cannot be created in the past", async ({ playwright }) => {
  await withActors(playwright, ["QA_HOST"], async f => {
    const r = await f.actors.QA_HOST.post("/api/games", { data: { activityLabel: "QA past", date: "2020-01-01", time: "10:00", capacity: 4, locationText: "x" } });
    if (r.status() === 201) trackGame(f, (await r.json()).id);
    await evidence("hc-qa-032-past", { createStatus: r.status() });
    expect(r.status()).toBe(400);
  });
});

test("HC-QA-032-SEMANTICS: state-accurate confirmation; past dates rejected on create/change, past activities still editable", async ({ playwright, browser }) => {
  await withActors(playwright, ["QA_HOST"], async f => {
    const api = f.actors.QA_HOST;
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Dublin", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    // Server: create.
    const todayGame = await api.post("/api/games", { data: { activityLabel: "QA today", date: today, time: "23:59", capacity: 4, locationText: "x" } });
    expect(todayGame.status()).toBe(201);
    trackGame(f, (await todayGame.json()).id);
    expect((await api.post("/api/games", { data: { activityLabel: "QA past", date: "2021-05-05", time: "10:00", capacity: 4, locationText: "x" } })).status()).toBe(400);
    expect((await api.post("/api/games", { data: { activityLabel: "QA bad", date: "not-a-date", time: "10:00", capacity: 4, locationText: "x" } })).status()).toBe(400);
    // Server: edit.
    const game = await createActivity(f, "QA_HOST");
    const body = (date: string, label = game.activityLabel) => ({ data: { activityLabel: label, date, time: "18:30", capacity: 8, locationText: "QA synthetic park" } });
    expect((await api.put(`/api/games/${game.id}`, body("2021-05-05"))).status()).toBe(400);
    await f.connection.execute("UPDATE games SET date = '2021-05-05' WHERE id = ?", [game.id]); // safe control: now a completed activity
    expect((await api.put(`/api/games/${game.id}`, body("2021-05-05", "QA corrected title"))).status()).toBe(200);
    expect((await rows(f, "SELECT activity_label FROM games WHERE id = ?", [game.id]))[0].activity_label).toBe("QA corrected title");
    expect((await api.put(`/api/games/${game.id}`, body("2021-05-06", "QA corrected title"))).status()).toBe(400);
    // Client: min date and step validation; coming-soon confirmation copy.
    const host = await uiActor(browser, "QA_HOST", "desktop");
    try {
      await host.page.goto("/games/host");
      expect(await host.page.locator("#game-date").getAttribute("min")).toBe(today);
      const label = `QA soon ${randomUUID().slice(0, 6)}`;
      await host.page.locator("#game-activity").fill(label);
      await host.page.locator("#game-location").fill("QA park");
      await host.page.locator("#game-date").fill("2021-05-05");
      await host.page.locator("#game-time").fill("09:30");
      await host.page.getByRole("button", { name: "Continue →" }).click();
      await expect(host.page.getByText("Pick a date that hasn't passed")).toBeVisible();
      await host.page.locator("#game-date").fill("2030-09-21");
      await host.page.getByRole("button", { name: "Continue →" }).click();
      await host.page.getByRole("radio", { name: /Coming soon/ }).check();
      await host.page.getByRole("button", { name: "Create session", exact: true }).click();
      await expect(host.page.getByRole("heading", { name: "Announced." })).toBeVisible();
      const [g] = await rows(f, "SELECT id, lifecycle FROM games WHERE activity_label = ?", [label]);
      trackGame(f, g.id);
      expect(g.lifecycle).toBe("coming_soon");
      // Edit form of a completed (past-dated) activity opens without a min that would block saving.
      await host.page.goto(`/games/host/${game.id}`);
      expect(await host.page.locator("#game-date").getAttribute("min")).toBeNull();
    } finally { await host.close(); }
  });
});
