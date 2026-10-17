import { randomUUID } from "node:crypto";
import type { Browser, BrowserContext } from "@playwright/test";
import { env, expect, personas } from "../fixtures";
import { evidence } from "../authorization-fixture";
import { test, withActors, trackGame, trackCircle, rows, FUTURE_DATE } from "../lifecycle-fixture";
import { uiActor } from "../lifecycle-ui-fixture";

// OG-01…OG-32 pass — browser journeys for the new workspace features against
// the real stack (real React app, real Express + isolated MySQL; external
// origins aborted, no provider keys). Each journey checks the database after
// the UI action, not just the screen. Synthetic free activities only.

async function staffActor(browser: Browser, role: "QA_VENDOR" | "QA_ADMIN") {
  const context: BrowserContext = await browser.newContext({ baseURL: env.E2E_BASE_URL, viewport: { width: 1440, height: 900 }, serviceWorkers: "block", acceptDownloads: true });
  await context.route("**/*", async (route) => {
    if (new URL(route.request().url()).origin === env.E2E_BASE_URL) await route.continue();
    else await route.abort("blockedbyclient");
  });
  await context.addInitScript(() => {
    try {
      localStorage.setItem("hello_circle_cookie_consent", "rejected");
    } catch {
      /* storage unavailable */
    }
  });
  const login = await context.request.post("/api/auth/login", { data: { email: env[`${role}_EMAIL`], password: env[`${role}_PASSWORD`] } });
  expect(login.status(), "real persona login").toBe(200);
  if (role === "QA_VENDOR") expect((await context.request.post("/api/auth/accept-terms", { data: { termsAccepted: true } })).status()).toBe(200);
  const page = await context.newPage();
  return { context, page, close: async () => { await context.request.post("/api/auth/logout"); await context.close(); } };
}

test("OG-27-UI: a join request on an approval activity, approved by the host", async ({ playwright, browser }) => {
  test.setTimeout(150_000);
  await withActors(playwright, [], async (f) => {
    const host = await uiActor(browser, "QA_HOST", "desktop");
    const user = await uiActor(browser, "QA_USER", "desktop");
    try {
      const label = `QA approval ${randomUUID().slice(0, 6)}`;
      const created = await host.context.request.post("/api/games", { data: { activityLabel: label, date: FUTURE_DATE, time: "11:00", capacity: 6, locationText: "QA approval park" } });
      expect(created.status()).toBe(201);
      const game = await created.json();
      trackGame(f, game.id);
      f.track("game_join_requests", "game_id", game.id);

      // Host turns approval on from the activity record.
      await host.page.goto(`/manage?tab=activities&record=activity:${game.id}`);
      await host.page.getByRole("button", { name: "Approve each person" }).click();
      await expect(host.page.getByText("You approve each person")).toBeVisible();
      expect(await rows(f, "SELECT join_mode FROM games WHERE id = ?", [game.id])).toEqual([{ join_mode: "approval" }]);

      // Resident asks to join: a request, not a seat.
      await user.page.goto(`/games/${game.id}`);
      await user.page.getByRole("button", { name: "Ask to join" }).filter({ visible: true }).first().click();
      await user.page.locator("#join-request-note").fill("New to the area");
      await user.page.getByRole("button", { name: "Send request" }).click();
      await expect(user.page.getByRole("heading", { name: "Request sent" })).toBeVisible();
      expect(await rows(f, "SELECT status FROM game_participants WHERE game_id = ? AND resident_id = ?", [game.id, personas.QA_USER.id])).toEqual([]);
      expect(await rows(f, "SELECT status, message FROM game_join_requests WHERE game_id = ?", [game.id])).toEqual([{ status: "requested", message: "New to the area" }]);

      // Host approves; the resident now holds a seat.
      await host.page.reload();
      await host.page.getByRole("button", { name: /^Approve / }).click();
      await expect.poll(async () => rows(f, "SELECT status FROM game_participants WHERE game_id = ? AND resident_id = ?", [game.id, personas.QA_USER.id])).toEqual([{ status: "joined" }]);
      await user.page.reload();
      await expect(user.page.getByRole("heading", { name: /You're going/ })).toBeVisible();
      await evidence("og-27-ui", { requestedNotSeated: true, approvedSeated: true });
    } finally {
      await host.close();
      await user.close();
    }
  });
});

test("OG-26-UI: a weekly series from the create form, then cancelling the remaining dates", async ({ playwright, browser }) => {
  test.setTimeout(150_000);
  await withActors(playwright, [], async (f) => {
    const host = await uiActor(browser, "QA_HOST", "desktop");
    try {
      const label = `QA series ${randomUUID().slice(0, 6)}`;
      await host.page.goto("/games/host?from=manage");
      await expect(host.page.locator(".hc-ws-label")).toHaveText("Host workspace");
      await host.page.locator("#game-activity").fill(label);
      await host.page.locator("#game-location").fill("QA series pier");
      await host.page.locator("#game-date").fill("2030-09-02");
      await host.page.locator("#game-time").fill("19:00");
      await host.page.locator("#game-repeat").selectOption("weekly");
      await host.page.getByPlaceholder("Times").fill("3");
      await host.page.getByRole("button", { name: "Continue →" }).click();
      await host.page.getByRole("button", { name: "Create 3 sessions" }).click();
      await expect(host.page.getByRole("heading", { name: "You're live." })).toBeVisible();
      const games = await rows<{ id: string; date: string; series_id: string }>(f, "SELECT id, date, series_id FROM games WHERE activity_label = ? ORDER BY date", [label]);
      for (const g of games) trackGame(f, g.id);
      expect(games.map((g) => g.date)).toEqual(["2030-09-02", "2030-09-09", "2030-09-16"]);
      expect(new Set(games.map((g) => g.series_id)).size).toBe(1);
      f.track("game_series", "id", games[0].series_id);

      await host.page.goto(`/manage?tab=activities&record=activity:${games[0].id}`);
      await host.page.getByRole("button", { name: "Cancel the 3 remaining dates" }).click();
      await host.page.getByRole("alertdialog").getByRole("button", { name: "Cancel remaining dates" }).click();
      await expect.poll(async () => (await rows(f, "SELECT status FROM games WHERE series_id = ?", [games[0].series_id])).map((r) => r.status)).toEqual(["cancelled", "cancelled", "cancelled"]);
      await evidence("og-26-ui", { occurrences: 3, linked: true, cancelledRemaining: 3 });
    } finally {
      await host.close();
    }
  });
});

test("OG-29/OG-31-UI: a privacy request answered by an admin; consent lookup and maps switch", async ({ playwright, browser }) => {
  test.setTimeout(150_000);
  await withActors(playwright, [], async (f) => {
    const user = await uiActor(browser, "QA_USER", "desktop");
    const admin = await staffActor(browser, "QA_ADMIN");
    try {
      await user.page.goto("/profile");
      await user.page.getByRole("button", { name: "Make a request" }).click();
      await user.page.locator("#privacy-kind").selectOption("correction");
      await user.page.locator("#privacy-details").fill("My surname is misspelt");
      await user.page.getByRole("button", { name: "Send request" }).click();
      await expect(user.page.getByText("Sent. We've emailed you a reference")).toBeVisible();
      const [req] = await rows<{ id: number; status: string }>(f, "SELECT id, status FROM privacy_requests WHERE resident_id = ? ORDER BY id DESC LIMIT 1", [personas.QA_USER.id]);
      f.track("privacy_requests", "id", req.id);
      f.track("audit_log", "object_id", String(req.id));
      expect(req.status).toBe("received");

      await admin.page.goto("/admin?tab=privacy");
      await admin.page.getByRole("button", { name: `Open request PR-${req.id}` }).click();
      await expect(admin.page.locator("h1")).toHaveText("Correction request");
      await admin.page.getByLabel("Reply to the person").fill("We've corrected your surname. Thanks for telling us.");
      await admin.page.getByRole("button", { name: "Complete and send" }).click();
      await expect.poll(async () => (await rows(f, "SELECT status FROM privacy_requests WHERE id = ?", [req.id]))[0].status).toBe("completed");

      // Erasure: nothing is deleted yet (D-07, DEC-14), so it can't be "completed" —
      // the admin replies and it stays open; the person sees "nothing deleted yet".
      await user.page.goto("/profile");
      await user.page.getByRole("button", { name: "Make a request" }).click();
      await user.page.locator("#privacy-kind").selectOption("erasure");
      await user.page.locator("#privacy-details").fill("Please delete my account");
      await user.page.getByRole("button", { name: "Send request" }).click();
      await expect(user.page.getByText("Sent. We've emailed you a reference")).toBeVisible();
      const [erase] = await rows<{ id: number }>(f, "SELECT id FROM privacy_requests WHERE resident_id = ? AND kind = 'erasure' ORDER BY id DESC LIMIT 1", [personas.QA_USER.id]);
      f.track("privacy_requests", "id", erase.id);
      f.track("audit_log", "object_id", String(erase.id));
      await admin.page.goto(`/admin?tab=privacy&record=privacy:${erase.id}`);
      await expect(admin.page.locator("h1")).toHaveText("Deletion request");
      await expect(admin.page.getByRole("button", { name: "Complete and send" })).toHaveCount(0);
      await expect(admin.page.getByText("this request can't be marked completed")).toBeVisible();
      expect((await admin.context.request.post(`/api/admin/privacy/requests/${erase.id}`, { data: { status: "completed", response: "Your data has been deleted." } })).status(), "server refuses too").toBe(409);
      await admin.page.getByLabel("Reply to the person").fill("We've recorded your request. Deletion isn't available yet; we'll write again.");
      await admin.page.getByRole("button", { name: "Send reply, keep open" }).click();
      await expect.poll(async () => (await rows(f, "SELECT status, response FROM privacy_requests WHERE id = ?", [erase.id]))[0]).toEqual({ status: "in_progress", response: "We've recorded your request. Deletion isn't available yet; we'll write again." });
      await user.page.reload();
      const erasureRow = user.page.getByRole("listitem").filter({ hasText: "Delete my data" }).first();
      await expect(erasureRow).toContainText("In progress");
      await expect(erasureRow).toContainText("nothing deleted yet");
      await expect(erasureRow).not.toContainText("Completed");

      // Consent lookup shows the persona's own records.
      await admin.page.goto("/admin?tab=privacy&psec=consents");
      await admin.page.getByLabel("Email address").fill(env.QA_USER_EMAIL);
      await admin.page.getByRole("button", { name: "Look up" }).click();
      await expect(admin.page.getByText("personal account")).toBeVisible();

      // Maps switch: off and back on (global setting in the isolated QA database).
      await admin.page.goto("/admin?tab=settings");
      await admin.page.getByRole("button", { name: "Turn maps off" }).click();
      await expect(admin.page.getByText("Maps are off").first()).toBeVisible();
      await admin.page.getByRole("button", { name: "Turn maps on" }).click();
      await expect(admin.page.getByText("Maps are on").first()).toBeVisible();
      await evidence("og-29-31-ui", { requestRecorded: true, completedWithReply: true, erasureNeverCompleted: true, consentLookup: true, mapsToggled: true });
    } finally {
      await user.close();
      await admin.close();
    }
  });
});

test("OG-18/OG-25-UI: a Circle announcement from Moderation; the partner's monthly statement", async ({ playwright, browser }) => {
  test.setTimeout(150_000);
  await withActors(playwright, [], async (f) => {
    const host = await uiActor(browser, "QA_HOST", "desktop");
    const vendor = await staffActor(browser, "QA_VENDOR");
    host.page.setDefaultTimeout(20_000);
    vendor.page.setDefaultTimeout(20_000);
    try {
      const made = await host.context.request.post("/api/circles", { data: { name: `QA mod circle ${randomUUID().slice(0, 6)}`, activityLabel: "QA moderation", county: "Dublin", about: "Synthetic", joinMode: "open" } });
      expect(made.status()).toBe(201);
      const circle = await made.json();
      trackCircle(f, circle.id);
      f.track("audit_log", "object_id", circle.id);
      await host.page.goto(`/manage/circles/${circle.id}?tab=moderation`);
      await host.page.getByRole("button", { name: "Send an announcement" }).click();
      await host.page.getByRole("dialog").getByRole("textbox").fill("QA: walk moves to 10am");
      await host.page.getByRole("button", { name: "Send to all members" }).click();
      await expect.poll(async () => rows(f, "SELECT body FROM chat_messages WHERE scope_type = 'circle' AND scope_id = ?", [circle.id])).toEqual([{ body: "📣 QA: walk moves to 10am" }]);

      await vendor.page.goto("/vendor?tab=earnings");
      await expect(vendor.page.getByRole("heading", { name: "Monthly statement" })).toBeVisible();
      await expect(vendor.page.getByText("Orders taken")).toBeVisible();
      const download = vendor.page.waitForEvent("download", { timeout: 20_000 });
      await vendor.page.getByRole("button", { name: "Download CSV" }).click();
      expect((await download).suggestedFilename()).toMatch(/^hellocircle-statement-\d{4}-\d{2}\.csv$/);
      await evidence("og-18-25-ui", { announcementPosted: true, statementDownloaded: true });
    } finally {
      await host.close();
      await vendor.close();
    }
  });
});
