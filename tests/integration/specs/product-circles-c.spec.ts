import { expect, personas } from "../fixtures";
import { evidence } from "../authorization-fixture";
import { test, withActors, createCircle, rows } from "../lifecycle-fixture";
import { uiActor } from "../lifecycle-ui-fixture";

// Phase 10A — HC-QA-057 ("Message Circle" must open this Circle's chat) and
// the HC-QA-055 failure-path invariant. Split from product-circles-b to stay
// within the real 10-login limiter.

test("HC-QA-055-FAILURE: a failed send keeps the text and does not overwrite newer typing", async ({ playwright, browser }) => {
  await withActors(playwright, ["QA_HOST"], async (f) => {
    const circle = await createCircle(f, "QA_HOST", { joinMode: "open" });
    const ui = await uiActor(browser, "QA_HOST", "desktop");
    try {
      const { page } = ui;
      let fail = true;
      await page.route("**/api/chat/**", async (route) => {
        if (route.request().method() === "POST" && fail) { await new Promise((r) => setTimeout(r, 1500)); return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "Couldn't send — try again" }) }); }
        await route.continue();
      });
      await page.goto(`/circles/${circle.id}`);
      await page.getByText("Chat", { exact: true }).first().click();
      const box = page.getByRole("textbox", { name: "Message" });
      await box.fill("QA will fail");
      await box.press("Enter");
      await expect(box).toHaveValue(""); // cleared at send time
      await box.pressSequentially("QA typed during send"); // typed while the send is still in flight
      await expect(page.getByRole("alert").filter({ hasText: /send/i })).toBeVisible();
      await expect(box).toHaveValue(/QA will fail/);
      await expect(box).toHaveValue(/QA typed during send/);
      fail = false;
      expect((await rows(f, "SELECT id FROM chat_messages WHERE scope_id = ?", [circle.id])).length).toBe(0);
    } finally { await ui.close(); }
  });
});


for (const viewport of ["desktop", "mobile"] as const) {
  test(`HC-QA-057: "Message Circle" opens this Circle's chat (${viewport})`, async ({ playwright, browser }) => {
    await withActors(playwright, ["QA_HOST", "QA_USER"], async (f) => {
      const circle = await createCircle(f, "QA_HOST", { joinMode: "open" });
      const [{ name }] = await rows(f, "SELECT name FROM circles WHERE id = ?", [circle.id]);
      expect((await f.actors.QA_USER.post(`/api/circles/${circle.id}/join`, { data: {} })).status()).toBe(201);
      const ui = await uiActor(browser, "QA_USER", viewport);
      try {
        const { page } = ui;
        await page.goto(`/circles/${circle.id}`);
        const historyBefore = await page.evaluate(() => history.length);
        const message = page.getByRole("button", { name: "Message Circle" }).filter({ visible: true }).first();
        await message.scrollIntoViewIfNeeded();
        // Keyboard activation (Enter) — no mouse.
        await message.focus();
        await page.keyboard.press("Enter");
        const dialog = page.getByRole("dialog").filter({ hasText: name });
        await expect(dialog, "chat dialog for THIS Circle").toBeVisible();
        await expect(dialog.getByRole("textbox", { name: "Message" })).toBeVisible();
        await dialog.getByRole("textbox", { name: "Message" }).fill("QA hello from Message Circle");
        await dialog.getByRole("textbox", { name: "Message" }).press("Enter");
        await expect.poll(async () => (await rows(f, "SELECT scope_type, scope_id FROM chat_messages WHERE resident_id = ? AND body = ?", [personas.QA_USER.id, "QA hello from Message Circle"]))).toEqual([{ scope_type: "circle", scope_id: circle.id }]);
        await page.keyboard.press("Escape");
        await expect(dialog).toBeHidden();
        expect(page.url()).toContain(`/circles/${circle.id}`);
        expect(await page.evaluate(() => history.length), "opening chat adds no history entry (Back leaves the page as expected)").toBe(historyBefore);
        // Re-opening uses the same single conversation (no duplicates).
        await message.click();
        await expect(page.getByRole("dialog").filter({ hasText: "QA hello from Message Circle" })).toBeVisible();
        expect((await rows(f, "SELECT DISTINCT scope_id FROM chat_messages WHERE resident_id = ? AND scope_type = 'circle'", [personas.QA_USER.id])).map((r) => r.scope_id)).toContain(circle.id);
        await evidence(`hc-qa-057-${viewport}`, { chatOpened: true, keyboard: true, correctScope: true });
      } finally { await ui.close(); }
    });
  });
}

test("HC-QA-057-AUTHZ: a non-member is not offered Message Circle and cannot post", async ({ playwright, browser }) => {
  await withActors(playwright, ["QA_HOST", "QA_USER_B"], async (f) => {
    const circle = await createCircle(f, "QA_HOST", { joinMode: "approval" });
    const post = await f.actors.QA_USER_B.post(`/api/chat/circle/${circle.id}/messages`, { data: { body: "QA outsider" } });
    expect([403, 404]).toContain(post.status());
    const ui = await uiActor(browser, null, "desktop");
    try {
      await ui.page.goto(`/circles/${circle.id}`);
      await expect(ui.page.getByRole("heading").first()).toBeVisible();
      await expect(ui.page.getByRole("button", { name: "Message Circle" })).toHaveCount(0);
    } finally { await ui.close(); }
  });
});
