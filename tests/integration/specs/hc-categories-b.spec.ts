import { randomBytes, randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { expect, personas } from "../fixtures";
import { evidence } from "../authorization-fixture";
import { createActivity, createCircle, rows, test, trackCircle, withActors } from "../lifecycle-fixture";
import { noHorizontalScroll, staffActor, uiActor } from "../lifecycle-ui-fixture";
import { clubFor, experienceFor, type Scope } from "../stage-b-fixture";

// Category system, part B — draft retry after a failed category save, review
// safety (no one-click accept for low confidence) and the Settings switch.
// Part A (hc-categories.spec.ts): admin CRUD + permissions, host and
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

test("CAT-VENDOR-RETRY: a failed category save keeps the draft, says so, and a retry saves it without creating a second listing", async ({ playwright, browser }) => {
  test.setTimeout(120_000);
  await withActors(playwright, ["QA_VENDOR"], async (f) => {
    const vendor = await staffActor(browser, "QA_VENDOR");
    try {
      const { page } = vendor;
      let fail = true;
      await page.route((u) => fail && /\/api\/vendor\/classification\/experience\//.test(u.pathname), (route) =>
        route.request().method() === "PUT" ? route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "Simulated failure" }) }) : route.continue()
      );
      await page.goto("/vendor/experiences/new");
      const title = `QA cat retry ${tag()}`;
      await page.getByLabel("Title").first().fill(title);
      await page.getByLabel("Short blurb").fill("Synthetic category retry QA experience");
      await page.getByRole("combobox", { name: /Category/ }).fill("kayak");
      await page.getByRole("option", { name: /Kayaking/ }).first().click();
      await page.getByRole("button", { name: /Save & continue/ }).click();
      await expect(page.getByRole("alert").filter({ hasText: /saved, but its category wasn't/ })).toBeVisible();
      await expect(page).toHaveURL(/\/vendor\/experiences\/[0-9a-f-]{36}/);
      const id = page.url().match(/experiences\/([0-9a-f-]{36})/)![1];
      for (const [table, column] of [["experiences", "id"], ["experience_sessions", "experience_id"], ["listing_taxonomy", "listing_id"], ["listing_attributes", "listing_id"], ["audit_log", "object_id"]]) f.track(table, column, id);
      // Still on Basics with the typed values; nothing classified yet.
      await expect(page.getByLabel("Title").first()).toHaveValue(title);
      expect(await rows(f, "SELECT 1 FROM listing_taxonomy WHERE listing_type = 'experience' AND listing_id = ?", [id])).toHaveLength(0);
      // Retry: updates the same draft, stores the category, moves on.
      fail = false;
      await page.getByRole("button", { name: /Save & continue/ }).click();
      await expect(page.getByRole("heading", { name: /Where/ })).toBeVisible();
      expect(await rows(f, "SELECT id FROM experiences WHERE title = ?", [title]), "one listing, not two").toHaveLength(1);
      const [lt] = await rows(f, "SELECT category_id, subcategory_id FROM listing_taxonomy WHERE listing_type = 'experience' AND listing_id = ?", [id]);
      expect(lt).toMatchObject({ category_id: "water", subcategory_id: "kayaking" });
      await evidence("cat-vendor-retry", { failureShown: true, draftKept: true, retrySaved: true, duplicates: 0 });
    } finally {
      await vendor.close();
    }
  });
});

test("CAT-REVIEW: low-confidence rows have no one-click accept; a medium suggestion needs a confirmation; the Settings switch asks before changing", async ({ playwright, browser }) => {
  test.setTimeout(120_000);
  await withActors(playwright, ["QA_VENDOR"], async (f) => {
    const t = tag();
    // Medium: a programme whose title names no sport, on a swimming club.
    const club = await clubFor(f, "QA_VENDOR");
    await f.connection.execute("UPDATE clubs SET sport = 'Swimming' WHERE id = ?", [club]);
    const prog = await f.actors.QA_VENDOR.post("/api/vendor/programs", { data: { listingType: "club", listingId: club, title: `QA cat squad ${t}`, description: "Synthetic review QA" } });
    expect(prog.status()).toBe(201);
    const programId = (await prog.json()).id as string;
    for (const [table, column] of [["programs", "id"], ["program_sessions", "program_id"], ["listing_taxonomy", "listing_id"], ["audit_log", "object_id"]]) f.track(table, column, programId);
    // Low: an experience titled with a review-only phrase.
    const exp = await experienceFor(f, "QA_VENDOR");
    await f.connection.execute("UPDATE experiences SET title = ? WHERE id = ?", [`QA cat walking tour ${t}`, exp]);
    f.track("listing_taxonomy", "listing_id", exp);

    const admin = await staffActor(browser, "QA_ADMIN");
    try {
      const { page } = admin;
      await page.goto("/admin?tab=categories&record=uncategorised");
      const lowRow = page.locator("li.cat-review-row").filter({ hasText: `QA cat walking tour ${t}` });
      await expect(lowRow.getByText("Low — check first")).toBeVisible();
      await expect(lowRow.getByRole("button", { name: /^Accept/ })).toHaveCount(0);
      await expect(lowRow.getByRole("button", { name: /Review the suggestion/ })).toBeVisible();

      const medRow = page.locator("li.cat-review-row").filter({ hasText: `QA cat squad ${t}` });
      await expect(medRow.getByText("Medium")).toBeVisible();
      await medRow.getByRole("button", { name: /^Accept Swimming/ }).click();
      const dialog = page.getByRole("alertdialog", { name: /Assign Swimming/ });
      await expect(dialog).toBeVisible();
      await dialog.getByRole("button", { name: "Cancel" }).click();
      expect(await rows(f, "SELECT 1 FROM listing_taxonomy WHERE listing_type = 'program' AND listing_id = ?", [programId]), "cancel assigns nothing").toHaveLength(0);
      await medRow.getByRole("button", { name: /^Accept Swimming/ }).click();
      await page.getByRole("alertdialog", { name: /Assign Swimming/ }).getByRole("button", { name: "Assign category" }).click();
      await expect(page.getByRole("alertdialog", { name: /Assign Swimming/ })).toBeHidden();
      const [lt] = await rows(f, "SELECT category_id, subcategory_id, assigned_by FROM listing_taxonomy WHERE listing_type = 'program' AND listing_id = ?", [programId]);
      expect(lt).toMatchObject({ category_id: "water", subcategory_id: "swimming", assigned_by: "admin" });
      expect(await rows(f, "SELECT 1 FROM listing_taxonomy WHERE listing_type = 'experience' AND listing_id = ?", [exp]), "low row untouched").toHaveLength(0);

      // Settings: the switch explains the impact and changes nothing on Cancel.
      await page.goto("/admin?tab=settings");
      await expect(page.getByRole("heading", { name: "Categories on the site" })).toBeVisible();
      await page.getByRole("button", { name: "Hide categories" }).click();
      const hide = page.getByRole("alertdialog", { name: /Hide categories across the site/ });
      await expect(hide).toContainText("No category or listing assignment is deleted");
      await hide.getByRole("button", { name: "Cancel" }).click();
      expect((await (await admin.context.request.get("/api/admin/config/categories-enabled")).json()).enabled).toBe(true);
      await evidence("cat-review", { lowNoAccept: true, mediumConfirm: true, cancelNoChange: true, settingsConfirm: true });
    } finally {
      await admin.close();
    }
  });
});
