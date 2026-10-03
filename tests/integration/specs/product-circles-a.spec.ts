import { randomUUID } from "node:crypto";
import { expect, personas } from "../fixtures";
import { evidence } from "../authorization-fixture";
import { test, withActors, createCircle, rows } from "../lifecycle-fixture";
import { uiActor } from "../lifecycle-ui-fixture";

// Phase 10A — HC-QA-054 (duplicate Circle polls). Original failing-before regressions first.

const pollBody = (question: string) => ({ question, options: [{ date: "2030-08-01" }, { date: "2030-08-03" }] });

test("HC-QA-054: double-clicking Create poll creates exactly one poll", async ({ playwright, browser }) => {
  await withActors(playwright, ["QA_HOST", "QA_USER"], async (f) => {
    const circle = await createCircle(f, "QA_HOST", { joinMode: "open" });
    expect((await f.actors.QA_USER.post(`/api/circles/${circle.id}/join`, { data: {} })).status()).toBe(201);
    const ui = await uiActor(browser, "QA_USER", "desktop");
    try {
      const { page } = ui;
      await page.goto(`/circles/${circle.id}`);
      await page.getByRole("button", { name: /Propose a time/ }).first().click();
      const question = `QA poll ${randomUUID().slice(0, 6)}`;
      await page.getByPlaceholder("e.g. Next badminton session").fill(question);
      const dates = page.locator("input[type=date]");
      const n = await dates.count();
      await dates.nth(n - 3).fill("2030-08-01");
      await dates.nth(n - 2).fill("2030-08-03");
      await page.getByRole("button", { name: "Create poll" }).dblclick();
      await page.waitForTimeout(2500);
      const created = (await rows(f, "SELECT id FROM circle_polls WHERE circle_id = ? AND question = ?", [circle.id, question])).length;
      await evidence("hc-qa-054", { pollsAfterDoubleClick: created });
      expect(created, "exactly one logical poll").toBe(1);
    } finally { await ui.close(); }
  });
});

test("HC-QA-054-BACKEND: concurrent and repeated identical poll requests resolve to one poll", async ({ playwright }) => {
  await withActors(playwright, ["QA_HOST", "QA_USER"], async (f) => {
    const circle = await createCircle(f, "QA_HOST", { joinMode: "open" });
    expect((await f.actors.QA_USER.post(`/api/circles/${circle.id}/join`, { data: {} })).status()).toBe(201);
    const question = `QA backend poll ${randomUUID().slice(0, 6)}`;
    const results = await Promise.all(Array.from({ length: 4 }, () => f.actors.QA_USER.post(`/api/circles/${circle.id}/polls`, { data: pollBody(question) })));
    expect(results.every((r) => r.status() === 200 || r.status() === 201)).toBe(true);
    const ids = new Set(await Promise.all(results.map(async (r) => (await r.json()).id)));
    expect(ids.size, "every response names the same poll").toBe(1);
    for (let i = 0; i < 3; i++) expect([200, 201]).toContain((await f.actors.QA_USER.post(`/api/circles/${circle.id}/polls`, { data: pollBody(question) })).status());
    const polls = await rows(f, "SELECT id FROM circle_polls WHERE circle_id = ? AND question = ?", [circle.id, question]);
    expect(polls.length).toBe(1);
    expect((await rows(f, "SELECT id FROM circle_poll_options WHERE poll_id = ?", [polls[0].id])).length, "options not duplicated").toBe(2);
    // Legitimately different polls are still allowed.
    expect((await f.actors.QA_USER.post(`/api/circles/${circle.id}/polls`, { data: pollBody(`${question} (second)`) })).status()).toBe(201);
    expect((await f.actors.QA_USER.post(`/api/circles/${circle.id}/polls`, { data: { question, options: [{ date: "2030-09-09" }] } })).status()).toBe(201);
    // Another member asking the same question is a separate poll.
    expect((await f.actors.QA_HOST.post(`/api/circles/${circle.id}/polls`, { data: pollBody(question) })).status()).toBe(201);
    expect((await rows(f, "SELECT id FROM circle_polls WHERE circle_id = ?", [circle.id])).length).toBe(4);
  });
});

test("HC-QA-054-UI-DELAY: rapid clicks during a slow network create one poll and show progress", async ({ playwright, browser }) => {
  test.setTimeout(60_000);
  await withActors(playwright, ["QA_HOST"], async (f) => {
    const circle = await createCircle(f, "QA_HOST", { joinMode: "open" });
    const ui = await uiActor(browser, "QA_HOST", "desktop");
    try {
      const { page } = ui;
      await page.route(`**/api/circles/${circle.id}/polls`, async (route) => { if (route.request().method() === "POST") await new Promise((r) => setTimeout(r, 1500)); await route.continue(); });
      await page.goto(`/circles/${circle.id}`);
      await page.getByRole("button", { name: /Propose a time/ }).first().click();
      const question = `QA slow poll ${randomUUID().slice(0, 6)}`;
      await page.getByPlaceholder("e.g. Next badminton session").fill(question);
      const dates = page.locator("input[type=date]");
      const n = await dates.count();
      await dates.nth(n - 3).fill("2030-08-01");
      const create = page.getByRole("button", { name: /Create poll|Creating/ });
      await create.click({ clickCount: 3, delay: 60 });
      await expect.poll(async () => (await rows(f, "SELECT id FROM circle_polls WHERE circle_id = ? AND question = ?", [circle.id, question])).length, { timeout: 10_000 }).toBe(1);
      await page.waitForTimeout(2500);
      expect((await rows(f, "SELECT id FROM circle_polls WHERE circle_id = ? AND question = ?", [circle.id, question])).length).toBe(1);
    } finally { await ui.close(); }
  });
});
