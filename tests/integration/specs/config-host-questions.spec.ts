import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import { expect, personas } from "../fixtures";
import { test, withActors, rows } from "../lifecycle-fixture";
import { uiActor } from "../lifecycle-ui-fixture";
import { setSwitches } from "../revenue-fixture";

// Phase N (docs/participation-expansion/24), final validation journey E: the
// host-questions switch is turned on in isolated QA only. The host picks two
// approved questions; another resident joins on a phone and answers them in the
// join confirmation; the host reads the answers in Manage and marks "didn't
// come"; a third resident can't read the answers; leaving removes them.

const SHOTS = `${process.cwd()}/.qa-data/phase2-shots`;
const shot = (page: Page, name: string) => page.screenshot({ path: `${SHOTS}/config-${name}.png`, fullPage: true });

test("CFG-HOST-QUESTIONS: host picks approved questions, a resident answers when joining, the host reads them and records a no-show", async ({ playwright, browser }) => {
  test.setTimeout(180_000);
  await withActors(playwright, ["QA_HOST", "QA_USER", "QA_USER_B"], async (f) => {
    const [before] = await rows(f, "SELECT value FROM app_settings WHERE `key` = 'participation.host_questions'", []).catch(() => [{ value: null }]);
    const restoreSwitches = await setSwitches(f.connection, { "participation.host_questions": true });
    try {
      const created = await f.actors.QA_HOST.post("/api/games", { data: { activityLabel: `QA Five-a-side ${randomUUID().slice(0, 6)}`, date: "2030-07-15", time: "18:30", capacity: 10, locationText: "QA pitch" } });
      expect(created.status()).toBe(201);
      const game = (await created.json()) as { id: string; activityLabel: string };
      for (const [t, c] of [["games", "id"], ["game_participants", "game_id"], ["listing_attributes", "listing_id"], ["notifications", "listing_id"], ["registration_questions", "listing_id"]]) f.track(t, c, game.id);
      // Host-only, library-only set-up.
      expect((await f.actors.QA_USER.put(`/api/games/${game.id}/questions`, { data: { picks: [{ key: "q_hostlevel" }] } })).status()).toBe(403);
      expect((await f.actors.QA_HOST.put(`/api/games/${game.id}/questions`, { data: { picks: [{ key: "q_custom", label: "Any medical conditions?" }] } })).status()).toBe(400);
      expect((await f.actors.QA_HOST.put(`/api/games/${game.id}/questions`, { data: { picks: [{ key: "q_hostlevel", required: true }, { key: "q_hostposition" }] } })).status()).toBe(200);

      // A resident joins on a phone and answers.
      const joiner = await uiActor(browser, "QA_USER", "mobile");
      try {
        const { page } = joiner;
        page.setDefaultTimeout(15_000);
        await page.goto(`/games/${game.id}`);
        await page.locator(".mobile-join-bar").getByRole("button").first().click();
        const dialog = page.getByRole("dialog").or(page.getByRole("alertdialog")).first();
        await expect(dialog.getByText("A few questions from the host")).toBeVisible();
        await expect(dialog.getByRole("button", { name: "Confirm I'm in" })).toBeDisabled();
        await dialog.getByRole("radio", { name: "Intermediate" }).check();
        await dialog.getByLabel(/^Preferred position/).fill("Goal");
        await shot(page, "50-resident-host-questions-phone");
        await dialog.getByRole("button", { name: "Confirm I'm in" }).click();
        await expect.poll(async () => (await rows(f, "SELECT id FROM game_participants WHERE game_id = ? AND resident_id = ? AND status = 'joined'", [game.id, personas.QA_USER.id])).length).toBe(1);
        expect(joiner.consoleErrors).toEqual([]);
      } finally { await joiner.close(); }
      const answers = await rows(f, "SELECT label_snapshot, value_text FROM registration_answers WHERE source_type = 'game' AND source_ref = ? ORDER BY id", [`${game.id}:${personas.QA_USER.id}`]);
      f.track("registration_answers", "source_ref", `${game.id}:${personas.QA_USER.id}`);
      expect(answers.map((a) => [a.label_snapshot, a.value_text])).toEqual([["Your level", "Intermediate"], ["Preferred position", "Goal"]]);
      // Another resident can't read the answers.
      expect((await f.actors.QA_USER_B.get(`/api/games/${game.id}/participants/manage`)).status()).toBe(403);
      expect(await (await f.actors.QA_USER_B.get(`/api/games/${game.id}/participants`)).text()).not.toContain("Intermediate");

      // The host reads them in Manage and records a no-show.
      const host = await uiActor(browser, "QA_HOST", "desktop");
      try {
        const { page } = host;
        page.setDefaultTimeout(15_000);
        await page.goto(`/manage?tab=activities&record=activity:${game.id}`);
        await expect(page.getByText(/Your level: Intermediate/)).toBeVisible();
        await page.getByRole("button", { name: /as didn't come$/ }).click();
        await expect(page.getByText(/Check-in: Didn't come/)).toBeVisible();
        await shot(page, "51-host-answers-no-show");
      } finally { await host.close(); }
      f.track("attendance", "ref", `${game.id}:${personas.QA_USER.id}`);
      const [att] = await rows(f, "SELECT status FROM attendance WHERE kind = 'game' AND ref = ?", [`${game.id}:${personas.QA_USER.id}`]);
      expect(att.status).toBe("no_show");

      // Leaving takes the answers with it.
      expect((await f.actors.QA_USER.delete(`/api/games/${game.id}/join`)).status()).toBe(200);
      expect(await rows(f, "SELECT id FROM registration_answers WHERE source_type = 'game' AND source_ref = ?", [`${game.id}:${personas.QA_USER.id}`])).toEqual([]);
    } finally {
      await restoreSwitches();
    }
    const [after] = await rows(f, "SELECT value FROM app_settings WHERE `key` = 'participation.host_questions'", []).catch(() => [{ value: null }]);
    expect(after?.value ?? null).toBe(before?.value ?? null);
  });
});
