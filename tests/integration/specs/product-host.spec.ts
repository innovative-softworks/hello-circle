import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import { expect, manifest, personas } from "../fixtures";
import { evidence } from "../authorization-fixture";
import { test, withActors, createActivity, createCircle, rows } from "../lifecycle-fixture";
import { uiActor } from "../lifecycle-ui-fixture";
import { tinyPng } from "../product-fixture";

// Phase 10A — HC-QA-053 (draft Share spins forever) and HC-QA-062 (resident
// media impossible without cloud storage). Local media mode only (the QA
// profile has no R2); cloud media remains a separate staging integration.

const uploadedFiles: string[] = [];
test.afterEach(() => {
  // Exact files this run created; never a directory sweep.
  for (const name of uploadedFiles.splice(0)) {
    if (!/^[a-f0-9-]+\.(jpg|png|webp|gif)$/.test(name)) continue;
    for (const dir of ["uploads", "private-uploads"]) {
      const file = path.join(manifest.dataDir, dir, name);
      if (existsSync(file)) rmSync(file);
    }
  }
});
const remember = (url: string) => { const m = /([a-f0-9-]+\.(?:jpg|png|webp|gif))/.exec(url); if (m) uploadedFiles.push(m[1]); };

test("HC-QA-053: a draft activity offers no Share; sharing never spins forever", async ({ playwright, browser }) => {
  await withActors(playwright, ["QA_HOST"], async (f) => {
    const draft = await createActivity(f, "QA_HOST", { lifecycle: "draft" });
    const live = await createActivity(f, "QA_HOST");
    const ui = await uiActor(browser, "QA_HOST", "desktop");
    try {
      const { page } = ui;
      await page.goto("/manage?tab=activities");
      const row = (label: string) => page.locator("div").filter({ hasText: label }).filter({ has: page.getByRole("button", { name: "Participants" }) }).last();
      await expect(row(draft.activityLabel)).toBeVisible();
      await expect(row(draft.activityLabel).getByRole("button", { name: /Share/ }), "draft rows offer no Share (drafts are private)").toHaveCount(0);
      await expect(row(live.activityLabel).getByRole("button", { name: /Share/ })).toHaveCount(1);
      await evidence("hc-qa-053", { draftShareOffered: false });
    } finally { await ui.close(); }
  });
});

test("HC-QA-053-ERROR-STATE: a failed share load shows an error with a way out, not a spinner", async ({ playwright, browser }) => {
  await withActors(playwright, ["QA_HOST"], async (f) => {
    const live = await createActivity(f, "QA_HOST");
    const ui = await uiActor(browser, "QA_HOST", "desktop");
    try {
      const { page } = ui;
      await page.route(`**/api/share/game/${live.id}`, (route) => route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "Internal" }) }));
      // The Manage row's Share is the ShareSheet trigger the finding names.
      await page.goto("/manage?tab=activities");
      const row = page.locator("div").filter({ hasText: live.activityLabel }).filter({ has: page.getByRole("button", { name: "Participants" }) }).last();
      await row.getByRole("button", { name: /Share/ }).click();
      const dialog = page.getByRole("dialog");
      await expect(dialog.getByRole("alert")).toContainText(/couldn't|can't|unable/i, { timeout: 5_000 });
      await expect(dialog.getByRole("button", { name: /try again/i })).toBeVisible();
      await page.unroute(`**/api/share/game/${live.id}`);
      await dialog.getByRole("button", { name: /try again/i }).click();
      await expect(dialog.getByRole("button", { name: /copy link/i })).toBeVisible();
    } finally { await ui.close(); }
  });
});

test("HC-QA-062: a resident host can upload an activity cover without cloud storage", async ({ playwright }) => {
  await withActors(playwright, ["QA_HOST"], async (f) => {
    const game = await createActivity(f, "QA_HOST");
    const response = await f.actors.QA_HOST.post("/api/media/upload", { multipart: { entityType: "activity-cover", entityId: game.id, file: { name: "cover.png", mimeType: "image/png", buffer: tinyPng() } } });
    expect(response.status(), "local fallback stores the image").toBe(201);
    const { url } = await response.json();
    remember(url);
    expect(url).toMatch(/^\/uploads\/[a-f0-9-]+\.png$/);
    const served = await f.actors.QA_HOST.get(url);
    expect(served.status()).toBe(200);
    expect(served.headers()["content-type"]).toContain("image/png");
    // Display path: saved on the activity and returned to viewers.
    const current = await (await f.actors.QA_HOST.get(`/api/games/${game.id}`)).json();
    expect((await f.actors.QA_HOST.put(`/api/games/${game.id}`, { data: { activityLabel: current.activityLabel, date: current.date, time: current.time, capacity: current.capacity, locationText: current.locationText, imageUrl: url } })).status()).toBe(200);
    expect((await (await f.actors.QA_HOST.get(`/api/games/${game.id}`)).json()).imageUrl).toBe(url);
    await evidence("hc-qa-062", { residentUpload: 201, served: 200 });
  });
});

test("HC-QA-062-BOUNDARIES: invalid files, foreign entities and guests are refused; restricted covers stay private", async ({ playwright }) => {
  await withActors(playwright, ["QA_HOST", "QA_USER_B", "GUEST"], async (f) => {
    const game = await createActivity(f, "QA_HOST");
    const upload = (actor: string, entityType: string, entityId: string, buffer: Buffer, mimeType = "image/png") =>
      f.actors[actor].post("/api/media/upload", { multipart: { entityType, entityId, file: { name: "x.png", mimeType, buffer } } });
    // Invalid content declared as an image.
    const fake = await upload("QA_HOST", "activity-cover", game.id, Buffer.from("not really an image"));
    expect(fake.status()).toBe(400);
    expect(JSON.stringify(await fake.json())).not.toMatch(/\/Users|node_modules|stack/i);
    // Foreign resident and guest.
    expect([401, 403]).toContain((await upload("QA_USER_B", "activity-cover", game.id, tinyPng())).status());
    expect([401, 403]).toContain((await upload("GUEST", "activity-cover", game.id, tinyPng())).status());
    // Restricted Circle cover: members only, never under the public /uploads path.
    const circle = await createCircle(f, "QA_HOST", { joinMode: "approval" });
    const cover = await upload("QA_HOST", "circle-cover", circle.id, tinyPng());
    expect(cover.status()).toBe(201);
    const { url } = await cover.json();
    remember(url);
    expect(url.startsWith("/uploads/"), "restricted cover not on the public static path").toBe(false);
    await f.connection.execute("UPDATE circles SET image_url = ? WHERE id = ?", [url, circle.id]);
    const member = await f.actors.QA_HOST.get(`/api/media/circles/${circle.id}/cover`);
    expect(member.status()).toBe(200);
    expect(member.headers()["content-type"]).toContain("image/png");
    expect((await f.actors.GUEST.get(`/api/media/circles/${circle.id}/cover`)).status()).toBe(403);
    expect((await f.actors.QA_USER_B.get(`/api/media/circles/${circle.id}/cover`)).status()).toBe(403);
    const fileName = /([a-f0-9-]+\.png)/.exec(url)![1];
    expect((await f.actors.GUEST.get(`/uploads/${fileName}`)).status(), "file not discoverable under /uploads").toBe(404);
    // Missing media.
    const bare = await createCircle(f, "QA_HOST", { joinMode: "approval" });
    expect((await f.actors.QA_HOST.get(`/api/media/circles/${bare.id}/cover`)).status()).toBe(404);
    await evidence("hc-qa-062-boundaries", { invalid: 400, foreign: "denied", restrictedPublicPath: false });
    void personas;
  });
});
