import { randomUUID } from "node:crypto";
import { expect, personas } from "../fixtures";
import { test, withActors, createCircle, rows } from "../lifecycle-fixture";
import { noHorizontalScroll, overflowingElements, uiActor } from "../lifecycle-ui-fixture";

// Circle Experience 4.0 (docs/circle-visitor-experience-v4/) — the visitor
// page in a real browser against the isolated QA backend: signed-out visitor
// (join keeps the intent through sign-in), signed-in request to an
// approval Circle (pending, never asked again), ?join=1 continuing into the
// member Home with its welcome, privacy of the visitor data, phone layout,
// and the switch turning it all off. Switches on for this run, off after.

const FLAGS = ["circles.visitor_experience", "circles.first_time_friendly"];

async function setFlags(f: { connection: { query: (sql: string, values?: unknown[]) => Promise<unknown> } }, on: boolean) {
  for (const key of FLAGS) await f.connection.query("INSERT INTO app_settings (`key`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)", [key, on ? "true" : "false"]);
  await new Promise((r) => setTimeout(r, 5500));
}

test("CX4: visitor page — signed out, request pending, join continues into Home, privacy, switch off", async ({ playwright, browser }) => {
  test.setTimeout(180_000);
  await withActors(playwright, ["QA_HOST", "QA_USER", "QA_USER_B"], async (f) => {
    await setFlags(f, true);
    try {
      const t = randomUUID().slice(0, 6);
      const open = await createCircle(f, "QA_HOST", { joinMode: "open", name: `QA CX4 open ${t}`, whatWeDo: "QA walks every Saturday" });
      const approval = await createCircle(f, "QA_HOST", { joinMode: "approval", name: `QA CX4 approval ${t}`, whatWeDo: "QA dips at dawn" });
      f.track("circle_invites", "circle_id", approval.id);
      f.track("games", "circle_id", open.id);
      const gameId = `qa-cx4-${t}`;
      const future = new Date(Date.now() + 6 * 86400000).toISOString().slice(0, 10);
      await f.connection.query("INSERT INTO games (id, host_resident_id, activity_label, date, time, capacity, status, circle_id, location_text, visibility) VALUES (?, ?, ?, ?, '10:00', 10, 'open', ?, 'QA pier', 'public')", [gameId, personas.QA_HOST.id, `QA CX4 walk ${t}`, future, open.id]);

      // Signed out: the welcome page, and Join keeps the intent through sign-in.
      const visitor = await uiActor(browser, null, "desktop");
      try {
        const { page } = visitor;
        await page.goto(`/circles/${open.slug}`);
        await expect(page.getByRole("heading", { level: 1, name: `QA CX4 open ${t}` })).toBeVisible();
        await expect(page.getByRole("heading", { name: "Come along to something" })).toBeVisible();
        await expect(page.getByText(`QA CX4 walk ${t}`).first()).toBeVisible();
        await expect(page.getByRole("heading", { name: `Ready to join QA CX4 open ${t}?`, exact: true })).toBeVisible();
        await expect(page.getByRole("heading", { name: `Join QA CX4 open ${t}`, exact: true })).toBeVisible();
        await page.getByRole("button", { name: "Join this Circle" }).first().click();
        await expect(page).toHaveURL(/\/signin/);
        expect(decodeURIComponent(page.url())).toContain("join=1");
        expect(visitor.consoleErrors).toEqual([]);
      } finally {
        await visitor.close();
      }

      // Signed in, approval Circle: request → pending, and never asked to join again.
      const user = await uiActor(browser, "QA_USER", "desktop");
      try {
        const { page } = user;
        await page.goto(`/circles/${approval.slug}`);
        await expect(page.getByRole("heading", { name: "Come along to something" })).toBeVisible();
        await page.getByRole("button", { name: "Request to join" }).filter({ visible: true }).first().click();
        await page.getByRole("alertdialog").getByRole("button", { name: "Send request" }).click();
        await expect(page.getByText("Request sent").first()).toBeVisible();
        await expect.poll(async () => (await rows(f, "SELECT status, initiated_by FROM circle_invites WHERE circle_id = ? AND resident_id = ?", [approval.id, personas.QA_USER.id]))[0]).toEqual({ status: "pending", initiated_by: "resident" });
        await page.reload();
        await expect(page.getByRole("button", { name: "Withdraw request" })).toBeVisible();
        await expect(page.getByRole("button", { name: /^Request to join$/ }).filter({ visible: true })).toHaveCount(0);

        // ?join=1 (back from sign-in) opens the join step; joining lands on the member Home.
        await page.goto(`/circles/${open.slug}?join=1`);
        await page.getByRole("alertdialog").getByRole("button", { name: "Join Circle" }).click();
        await expect(page.getByRole("heading", { name: /^Welcome to / })).toBeVisible();
        await expect(page.getByRole("heading", { name: "Next up" })).toBeVisible();
        await expect(page).not.toHaveURL(/join=1/);
        expect(user.consoleErrors).toEqual([]);
      } finally {
        await user.close();
      }

      // Privacy: a visitor's data carries no member names and, for an approval Circle, no counts.
      const v = await f.actors.QA_USER_B.get(`/api/circles/${approval.id}/visitor`);
      expect(v.status()).toBe(200);
      const body = await v.text();
      expect(JSON.parse(body).community).toBeNull();
      expect(body).not.toContain(personas.QA_USER.id);

      // Phone layout: no sideways scroll.
      const phone = await uiActor(browser, null, "mobile");
      try {
        await phone.page.goto(`/circles/${open.slug}`);
        await expect(phone.page.getByRole("heading", { name: "Come along to something" })).toBeVisible();
        expect(await noHorizontalScroll(phone.page), (await overflowingElements(phone.page)).join(", ")).toBe(true);
      } finally {
        await phone.close();
      }
    } finally {
      await setFlags(f, false);
    }

    // Switch off: the old page again.
    const off = await uiActor(browser, null, "desktop");
    try {
      const circle = (await rows<{ slug: string }>(f, "SELECT slug FROM circles WHERE name LIKE 'QA CX4 open %' ORDER BY created_at DESC LIMIT 1"))[0];
      await off.page.goto(`/circles/${circle.slug}`);
      await expect(off.page.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(off.page.getByRole("heading", { name: "Come along to something" })).toHaveCount(0);
    } finally {
      await off.close();
    }
  });
});
