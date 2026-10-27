import { randomUUID } from "node:crypto";
import { expect, personas } from "../fixtures";
import { test, withActors, createCircle, rows } from "../lifecycle-fixture";
import { noHorizontalScroll, overflowingElements, uiActor } from "../lifecycle-ui-fixture";

// Circle Experience 2.0 (docs/circle-experience-2-audit.md) — the new Circle
// features in a real browser against the isolated QA backend: welcome step,
// Circle Pulse privacy thresholds, Make it happen interest, Circle Memories,
// the D5 removal restriction, and phone layout. The circles.* switches are
// default-off, so this spec turns them on for its own run and back off after.

const FLAGS = ["circles.pulse", "circles.free_time_match", "circles.make_it_happen", "circles.first_time_friendly", "circles.memories"];

async function setFlags(f: { connection: { query: (sql: string, values?: unknown[]) => Promise<unknown> } }, on: boolean) {
  for (const key of FLAGS) await f.connection.query("INSERT INTO app_settings (`key`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)", [key, on ? "true" : "false"]);
  // The server caches settings for five seconds.
  await new Promise((r) => setTimeout(r, 5500));
}

function trackExperience(f: { track: (table: string, column: string, id: string) => void }, circleId: string) {
  for (const table of ["circle_pulses", "circle_pulse_notices", "circle_availability", "circle_memories", "circle_restrictions"]) f.track(table, "circle_id", circleId);
  f.track("games", "circle_id", circleId);
}

test("CX2: join → welcome → Pulse (totals only) → Make it happen → memories → removal restriction", async ({ playwright, browser }) => {
  await withActors(playwright, ["QA_HOST", "QA_USER", "QA_USER_B"], async (f) => {
    await setFlags(f, true);
    try {
      const circle = await createCircle(f, "QA_HOST", { joinMode: "open", activityLabel: "Sea swimming" });
      trackExperience(f, circle.id);
      expect((await f.actors.QA_USER_B.post(`/api/circles/${circle.id}/join`, { data: {} })).status()).toBe(201);

      // A past Circle activity QA_USER took part in, so they can add a memory.
      const pastId = `qa-cx2-${randomUUID().slice(0, 8)}`;
      const past = new Date(Date.now() - 5 * 86400000).toISOString().slice(0, 10);
      await f.connection.query("INSERT INTO games (id, host_resident_id, activity_label, date, time, capacity, status, circle_id, location_text, visibility) VALUES (?, ?, 'QA dip', ?, '09:00', 10, 'open', ?, 'QA cove', 'public')", [pastId, personas.QA_HOST.id, past, circle.id]);
      f.track("game_participants", "game_id", pastId);

      const user = await uiActor(browser, "QA_USER", "desktop");
      try {
        const { page } = user;
        await page.goto(`/circles/${circle.slug}`);
        await page.getByRole("button", { name: "Join Circle" }).filter({ visible: true }).first().click();
        await page.getByRole("alertdialog").getByRole("button", { name: "Join Circle" }).click();
        await expect(page.getByRole("heading", { name: /^Welcome to / })).toBeVisible();
        await page.getByRole("button", { name: "Got it" }).click();
        await expect(page.getByRole("heading", { name: /^Welcome to / })).toHaveCount(0);
        await expect.poll(async () => (await rows(f, "SELECT welcomed_at IS NOT NULL AS w FROM circle_members WHERE circle_id = ? AND resident_id = ?", [circle.id, personas.QA_USER.id]))[0]?.w).toBe(1);
        await f.connection.query("INSERT INTO game_participants (game_id, resident_id, attended) VALUES (?, ?, 1)", [pastId, personas.QA_USER.id]);

        // Pulse: a lone wish is "only you so far" to its owner and invisible to others.
        const together = page.locator("#circle-plans");
        await together.locator("#ce-together-interest").fill("Sunrise swim");
        await together.getByRole("button", { name: "Next week" }).click();
        await together.getByRole("button", { name: "Add", exact: true }).click();
        await expect(together.locator("li", { hasText: "Sunrise swim" }).getByText(/Only you so far/)).toBeVisible();
        const other = await (await f.actors.QA_USER_B.get(`/api/circles/${circle.id}/pulse`)).json();
        expect(other.groups).toEqual([]);
        // A second person makes it visible, as a total.
        expect((await f.actors.QA_USER_B.post(`/api/circles/${circle.id}/pulse`, { data: { interest: "sunrise swim", weekStart: other.weeks[1], slots: [] } })).status()).toBe(201);
        await page.reload();
        await expect(page.locator("#circle-plans li", { hasText: "Sunrise swim" }).getByText(/2 members want this next week/)).toBeVisible();

        // Make it happen: suggest, then the other member says "I'm in".
        const title = `QA CX2 plan ${randomUUID().slice(0, 6)}`;
        await page.getByRole("button", { name: "Suggest a plan" }).first().click();
        await page.getByPlaceholder("e.g. Coastal walk").fill(title);
        await page.locator("#ce-plan-size").fill("2");
        await page.getByRole("button", { name: "Suggest to Circle" }).click();
        await expect(page.getByText(title).first()).toBeVisible();
        const [plan] = await rows(f, "SELECT id, target_size FROM circle_plans WHERE circle_id = ? AND title = ?", [circle.id, title]);
        expect(plan.target_size).toBe(2);
        f.track("circle_plan_interest", "plan_id", plan.id);
        const b = await uiActor(browser, "QA_USER_B", "desktop");
        try {
          await b.page.goto(`/circles/${circle.slug}`);
          await expect(b.page.getByText(title).first()).toBeVisible();
          await b.page.getByRole("button", { name: "I'm in", exact: true }).first().click();
          await expect.poll(async () => (await rows(f, "SELECT COUNT(*) AS n FROM circle_plan_interest WHERE plan_id = ?", [plan.id]))[0].n).toBe(2);
          await expect(b.page.getByText(/ready for review/i).first()).toBeVisible();
        } finally {
          await b.close();
        }
        // Interest never creates an activity.
        expect((await rows(f, "SELECT COUNT(*) AS n FROM games WHERE plan_id = ?", [plan.id]))[0].n).toBe(0);

        // Memories: add a reflection to the past activity.
        await page.goto(`/circles/${circle.slug}?tab=memories`);
        await page.getByRole("button", { name: "Add a memory" }).click();
        await page.getByRole("dialog").getByText("A few words").click();
        await page.locator("#ce-memory-body").fill("Freezing and brilliant.");
        await page.getByRole("dialog").getByRole("button", { name: "Add memory" }).click();
        await expect(page.getByText("Freezing and brilliant.")).toBeVisible();

        // Phone layout: no sideways scroll on the member home.
        await page.setViewportSize({ width: 390, height: 844 });
        await page.goto(`/circles/${circle.slug}`);
        expect(await noHorizontalScroll(page), (await overflowingElements(page)).join(", ")).toBe(true);
        expect(user.consoleErrors).toEqual([]);
      } finally {
        await user.close();
      }

      // D5: removal blocks rejoining, shown on the Circle page.
      expect((await f.actors.QA_HOST.post(`/api/circles/${circle.id}/members/${personas.QA_USER_B.id}/remove`, { data: {} })).status()).toBe(200);
      const removed = await uiActor(browser, "QA_USER_B", "mobile");
      try {
        await removed.page.goto(`/circles/${circle.slug}`);
        await expect(removed.page.getByText("You can't rejoin this Circle").first()).toBeVisible();
        expect((await f.actors.QA_USER_B.post(`/api/circles/${circle.id}/join`, { data: {} })).status()).toBe(403);
      } finally {
        await removed.close();
      }
      // A non-member (now) gets nothing from the feature routes.
      expect((await f.actors.QA_USER_B.get(`/api/circles/${circle.id}/memories`)).status()).toBe(403);
    } finally {
      await setFlags(f, false);
    }
  });
});
