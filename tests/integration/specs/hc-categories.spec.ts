import { randomBytes, randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { expect, personas } from "../fixtures";
import { evidence } from "../authorization-fixture";
import { createActivity, createCircle, rows, test, trackCircle, withActors } from "../lifecycle-fixture";
import { noHorizontalScroll, staffActor, uiActor } from "../lifecycle-ui-fixture";
import { clubFor, experienceFor, type Scope } from "../stage-b-fixture";

// Category system (approved 2026-10-22) — admin CRUD + permissions, host and
// vendor create/edit, public category/subcategory filtering, search aliases,
// breadcrumbs, related listings, SEO robots/canonical, merge and archive,
// existing-listing compatibility, mobile layout and basic accessibility.
// Synthetic rows only; every category/listing this file creates is tracked
// by exact ID and removed by withActors' cleanup.

const tag = () => randomUUID().slice(0, 8);

function trackTaxonomy(f: Scope, categoryId: string) {
  f.track("taxonomy_aliases", "category_id", categoryId);
  f.track("taxonomy_categories", "id", categoryId);
  f.track("taxonomy_categories", "parent_id", categoryId);
  f.track("audit_log", "object_id", categoryId);
}

async function subAdmin(f: Scope, adminRole: string) {
  const id = randomUUID(), password = randomBytes(24).toString("hex"), email = `qa_cat_${adminRole}_${id.slice(0, 8)}@example.test`;
  await f.connection.execute("INSERT INTO users (id, email, password_hash, role, status, name, admin_role) VALUES (?, ?, ?, 'admin', 'approved', ?, ?)", [id, email, bcrypt.hashSync(password, 10), `QA ${adminRole} admin`, adminRole]);
  f.track("users", "id", id); f.track("sessions", "user_id", id); f.track("audit_log", "actor_user_id", id);
  return { id, email, password };
}

test("CAT-ADMIN: Super creates, edits (rowVersion), merges and archives; Support reads but can't change; used categories can't be deleted", async ({ playwright, browser }) => {
  test.setTimeout(120_000);
  await withActors(playwright, ["QA_HOST"], async (f) => {
    const a = `qa-cat-a-${tag()}`, b = `qa-cat-b-${tag()}`;
    trackTaxonomy(f, a); trackTaxonomy(f, b);
    const admin = await staffActor(browser, "QA_ADMIN");
    const support = await staffActor(browser, "support", { credentials: await subAdmin(f, "support") });
    try {
      const api = admin.context.request;
      expect((await support.context.request.get("/api/admin/categories")).status(), "support reads").toBe(200);
      expect((await support.context.request.post("/api/admin/categories", { data: { name: "Nope", id: `qa-cat-no-${tag()}`, families: ["activity"] } })).status(), "support can't create").toBe(403);

      const created = await api.post("/api/admin/categories", { data: { name: "QA Cat A", id: a, families: ["activity", "circle"] } });
      expect(created.status()).toBe(201);
      expect((await api.post("/api/admin/categories", { data: { name: "QA Cat B", id: b, families: ["activity", "circle"] } })).status()).toBe(201);
      const { rowVersion } = await created.json();
      expect((await api.put(`/api/admin/categories/${a}`, { data: { name: "QA Cat A renamed", rowVersion } })).status()).toBe(200);
      expect((await api.put(`/api/admin/categories/${a}`, { data: { name: "Stale", rowVersion } })).status(), "stale edit").toBe(409);

      // A real host activity in A → delete refused, merge moves it.
      const game = await createActivity(f, "QA_HOST", { categoryId: a });
      f.track("listing_taxonomy", "listing_id", game.id);
      expect((await api.delete(`/api/admin/categories/${a}`)).status(), "used category can't be deleted").toBe(409);
      const merged = await api.post(`/api/admin/categories/${a}/merge`, { data: { targetId: b } });
      expect(merged.status()).toBe(200);
      expect((await merged.json()).listingsMoved).toBe(1);
      const [moved] = await rows(f, "SELECT category_id FROM listing_taxonomy WHERE listing_type = 'game' AND listing_id = ?", [game.id]);
      expect(moved.category_id).toBe(b);
      expect((await (await api.get(`/api/categories/${a}`)).json()).redirectTo, "old slug redirects").toBe(b);

      // Archive: hidden publicly, not selectable for a new listing, kept on existing ones.
      expect((await api.post(`/api/admin/categories/${b}/archive`)).status()).toBe(200);
      const hostEdit = await f.actors.QA_HOST.post("/api/games", { data: { activityLabel: `QA cat ${tag()}`, date: "2030-07-15", time: "18:30", capacity: 8, locationText: "QA synthetic park", categoryId: b } });
      expect(hostEdit.status(), "archived category refused for a new listing").toBe(400);
      const detail = await (await f.actors.QA_HOST.get(`/api/games/${game.id}`)).json();
      expect(detail.taxonomy).toMatchObject({ categoryId: b, active: false });

      // Admin UI: directory and Uncategorised review render with their controls.
      await admin.page.goto("/admin?tab=categories");
      await expect(admin.page.getByRole("heading", { name: "Categories", level: 1 })).toBeVisible();
      await expect(admin.page.getByRole("button", { name: /New category/ })).toBeVisible();
      await admin.page.goto("/admin?tab=categories&record=uncategorised");
      await expect(admin.page.getByRole("heading", { name: "Uncategorised listings" })).toBeVisible();
      await expect(admin.page.getByLabel("Confidence")).toBeVisible();
      await evidence("cat-admin", { create: 201, stale: 409, supportCreate: 403, deleteUsed: 409, merge: "1 moved + redirect", archive: "refused for new, kept on existing" });
    } finally {
      await admin.close();
      await support.close();
    }
  });
});

test("CAT-HOST: picker on create, category kept on edit, invalid IDs refused; Circle create from the UI stores the choice", async ({ playwright, browser }) => {
  test.setTimeout(120_000);
  await withActors(playwright, ["QA_HOST", "QA_USER"], async (f) => {
    const game = await createActivity(f, "QA_HOST", { categoryId: "racket-sports", subcategoryId: "badminton", tags: ["indoor", "not-a-tag"] });
    f.track("listing_taxonomy", "listing_id", game.id);
    const host = f.actors.QA_HOST;
    let detail = await (await host.get(`/api/games/${game.id}`)).json();
    expect(detail.taxonomy).toMatchObject({ categoryId: "racket-sports", subcategoryId: "badminton" });
    expect(detail.tags).toEqual(["indoor"]);
    const keep = await host.put(`/api/games/${game.id}`, { data: { activityLabel: detail.activityLabel, date: detail.date, time: detail.time, capacity: detail.capacity, locationText: detail.locationText } });
    expect(keep.status(), "edit without category fields").toBe(200);
    detail = await (await host.get(`/api/games/${game.id}`)).json();
    expect(detail.taxonomy?.subcategoryId, "kept on edit").toBe("badminton");
    const bad = await host.put(`/api/games/${game.id}`, { data: { activityLabel: detail.activityLabel, date: detail.date, time: detail.time, capacity: detail.capacity, locationText: detail.locationText, categoryId: "racket-sports", subcategoryId: "hiking" } });
    expect(bad.status(), "subcategory from another category").toBe(400);
    expect((await host.post("/api/circles", { data: { name: `QA cat circle ${tag()}`, categoryId: "spaces-sport" } })).status(), "venue category on a Circle").toBe(400);

    // UI: Start a Circle with the searchable picker (keyboard).
    const ui = await uiActor(browser, "QA_USER", "mobile");
    try {
      const { page } = ui;
      await page.goto("/circles/start");
      const name = `QA cat UI circle ${tag()}`;
      // Accessible name "Name" (the required marker is aria-hidden; getByLabel reads raw label text).
      await page.getByRole("textbox", { name: "Name", exact: true }).fill(name);
      const picker = page.getByRole("combobox", { name: /What's your Circle about/ });
      await picker.fill("hik");
      await expect(page.getByRole("option", { name: /Hiking/ }).first()).toBeVisible();
      await picker.press("ArrowDown");
      await picker.press("ArrowDown");
      await picker.press("Enter");
      await expect(page.getByText("Hiking", { exact: false }).first()).toBeVisible();
      await page.getByRole("button", { name: "Create Circle" }).click();
      await expect(page.getByRole("heading", { name: /Your Circle is live/ })).toBeVisible();
      const [circle] = await rows(f, "SELECT id FROM circles WHERE name = ?", [name]);
      trackCircle(f, circle.id);
      f.track("listing_taxonomy", "listing_id", circle.id);
      const [lt] = await rows(f, "SELECT category_id, subcategory_id FROM listing_taxonomy WHERE listing_type = 'circle' AND listing_id = ?", [circle.id]);
      expect(lt).toMatchObject({ category_id: "outdoors", subcategory_id: "hiking" });
      expect(await noHorizontalScroll(page)).toBe(true);
    } finally {
      await ui.close();
    }
    await evidence("cat-host", { create: "stored", edit: "kept", invalid: 400, circleUi: "outdoors/hiking" });
  });
});

test("CAT-VENDOR: the experience wizard's Basics step stores the category; vendors can't classify another partner's listing", async ({ playwright, browser }) => {
  test.setTimeout(120_000);
  await withActors(playwright, ["QA_VENDOR"], async (f) => {
    const vendor = await staffActor(browser, "QA_VENDOR", { viewport: "mobile" });
    try {
      const { page } = vendor;
      await page.goto("/vendor/experiences/new");
      const title = `QA cat kayak ${tag()}`;
      await page.getByLabel("Title").first().fill(title);
      await page.getByLabel(/blurb|Short description/i).first().fill("Synthetic category QA experience");
      const picker = page.getByRole("combobox", { name: /Category/ });
      await picker.fill("kayak");
      await page.getByRole("option", { name: /Kayaking/ }).first().click();
      await page.getByRole("button", { name: /Save & continue/ }).click();
      await expect(page).toHaveURL(/\/vendor\/experiences\/[0-9a-f-]{36}/);
      const id = page.url().match(/experiences\/([0-9a-f-]{36})/)![1];
      for (const [table, column] of [["experiences", "id"], ["experience_sessions", "experience_id"], ["listing_taxonomy", "listing_id"], ["listing_attributes", "listing_id"], ["audit_log", "object_id"]]) f.track(table, column, id);
      // The URL changes as soon as the draft exists; the category is saved
      // just after, then the wizard moves on — wait for that step.
      await expect(page.getByRole("heading", { name: /Where/ })).toBeVisible();
      const [lt] = await rows(f, "SELECT category_id, subcategory_id FROM listing_taxonomy WHERE listing_type = 'experience' AND listing_id = ?", [id]);
      expect(lt).toMatchObject({ category_id: "water", subcategory_id: "kayaking" });
      expect(await noHorizontalScroll(page)).toBe(true);
      // Another partner's venue: refused.
      const [other] = await rows(f, "SELECT id FROM centres WHERE vendor_id IS NOT NULL AND vendor_id != ? LIMIT 1", [personas.QA_VENDOR.id]);
      if (other) expect((await vendor.context.request.put(`/api/vendor/classification/centre/${other.id}`, { data: { categoryId: "spaces-sport" } })).status()).toBe(403);
      await evidence("cat-vendor", { wizard: "water/kayaking", crossTenant: other ? 403 : "no other centre" });
    } finally {
      await vendor.close();
    }
  });
});

test("CAT-PUBLIC: chips filter by category and subcategory, URL state, breadcrumbs, related, search aliases, SEO and mobile layout", async ({ playwright, browser }) => {
  test.setTimeout(150_000);
  await withActors(playwright, ["QA_HOST"], async (f) => {
    const a = await createActivity(f, "QA_HOST", { categoryId: "racket-sports", subcategoryId: "badminton" });
    const b = await createActivity(f, "QA_HOST", { categoryId: "racket-sports", subcategoryId: "badminton" });
    const c = await createActivity(f, "QA_HOST", { categoryId: "racket-sports", subcategoryId: "padel" });
    for (const g of [a, b, c]) f.track("listing_taxonomy", "listing_id", g.id);
    const host = f.actors.QA_HOST;
    const ids = async (url: string) => ((await (await host.get(url)).json()) as { id: string }[]).map((g) => g.id);
    const all = await ids("/api/games?categorySlug=racket-sports&limit=100");
    expect(all).toEqual(expect.arrayContaining([a.id, b.id, c.id]));
    const sub = await ids("/api/games?categorySlug=racket-sports&subcategorySlug=padel&limit=100");
    expect(sub).toContain(c.id);
    expect(sub).not.toContain(a.id);
    expect(await ids("/api/games?categorySlug=not-a-category")).toEqual([]);
    // Search reaches 60 days ahead, so the 2030 activities can't show there;
    // a Circle classified as badminton whose name doesn't say so proves the
    // category alias match instead.
    const circle = await createCircle(f, "QA_HOST", { name: `QA cat shuttle group ${tag()}`, activityLabel: "Shuttle Fridays", categoryId: "racket-sports", subcategoryId: "badminton" });
    f.track("listing_taxonomy", "listing_id", circle.id);
    const search = await (await host.get("/api/search?q=badminton")).json();
    expect(search.circles.map((x: { id: string }) => x.id), "alias match").toContain(circle.id);
    expect(Array.isArray(search.programmes), "unified search keys").toBe(true);

    // SEO — category alone indexable, combinations noindex with a canonical.
    // Only when this origin serves server-rendered meta (a production build);
    // the rules themselves are unit-tested in server/src/taxonomy.test.ts.
    const html = await (await host.get("/games?category=racket-sports")).text();
    const seoChecked = html.includes('rel="canonical"'); // only the server adds a canonical; Vite's static index.html doesn't
    if (seoChecked) {
      expect(html).toMatch(/<meta name="robots" content="index, follow"/);
      expect(html).toMatch(/<link rel="canonical" href="[^"]*\/games\?category=racket-sports"/);
      const combo = await (await host.get("/games?category=racket-sports&sub=padel")).text();
      expect(combo).toMatch(/<meta name="robots" content="noindex, nofollow"/);
    }

    for (const viewport of ["desktop", "mobile"] as const) {
      const ui = await uiActor(browser, null, viewport);
      try {
        const { page } = ui;
        await page.goto("/games");
        const group = page.getByRole("group", { name: "Filter by category" });
        await group.getByRole("button", { name: /Racket sports/ }).click();
        await expect(page).toHaveURL(/category=racket-sports/);
        await page.getByRole("group", { name: "Racket sports types" }).getByRole("button", { name: /Padel/ }).click();
        await expect(page).toHaveURL(/sub=padel/);
        await expect(page.getByText(c.activityLabel).first()).toBeVisible();
        await expect(page.getByText(a.activityLabel)).toHaveCount(0);
        expect(await noHorizontalScroll(page), `no overflow (${viewport})`).toBe(true);
        // Back keeps URL state.
        await page.goBack();
        await expect(page).not.toHaveURL(/sub=padel/);
        await expect(page).toHaveURL(/category=racket-sports/);
        // Detail: breadcrumb links back to the filtered list; related shows same subcategory.
        await page.goto(`/games/${a.id}`);
        const crumbs = page.getByRole("navigation", { name: "Category" });
        await expect(crumbs.getByRole("link", { name: "Badminton" })).toHaveAttribute("href", "/games?category=racket-sports&sub=badminton");
        await expect(page.getByRole("heading", { name: "More like this" })).toBeVisible();
        expect(await noHorizontalScroll(page)).toBe(true);
      } finally {
        await ui.close();
      }
    }
    await evidence("cat-public", { categoryFilter: "ok", subFilter: "ok", unknown: "[]", searchAlias: "ok", seo: seoChecked ? "index/noindex" : "not served by this origin (unit-tested)", mobile: "no overflow" });
  });
});

test("CAT-COMPAT: listings without a category still appear unfiltered; an old ?category=<label> link still filters by label", async ({ playwright, browser }) => {
  test.setTimeout(90_000);
  await withActors(playwright, ["QA_HOST"], async (f) => {
    const plain = await createActivity(f, "QA_HOST");
    const unfiltered = ((await (await f.actors.QA_HOST.get("/api/games?limit=100&dateFrom=2030-07-15&dateTo=2030-07-15")).json()) as { id: string }[]).map((g) => g.id);
    expect(unfiltered, "uncategorised listing stays in the plain list").toContain(plain.id);
    const ui = await uiActor(browser, null, "desktop");
    try {
      await ui.page.goto(`/games?category=${encodeURIComponent(plain.activityLabel)}`);
      await expect(ui.page.getByText(plain.activityLabel).first()).toBeVisible();
    } finally {
      await ui.close();
    }
    await evidence("cat-compat", { uncategorisedVisible: true, legacyLabelLink: true });
  });
});
