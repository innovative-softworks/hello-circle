import { randomBytes, randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import type { Page } from "@playwright/test";
import { expect } from "../fixtures";
import { test, withActors, rows } from "../lifecycle-fixture";
import { staffActor } from "../lifecycle-ui-fixture";

// Configuration framework Phase E (docs/participation-expansion/15): an admin
// limits a synthetic organisation to one category and one of its
// subcategories on the organisation record page; the partner's picker and the
// API follow it; a listing that already had another category keeps it.
// Synthetic organisation only; seeded categories are read, never changed.

const SHOTS = `${process.cwd()}/.qa-data/phase2-shots`;
const shot = (page: Page, name: string) => page.screenshot({ path: `${SHOTS}/config-${name}.png`, fullPage: true });

test("CFG-CATEGORIES: admin narrows an organisation's categories; the partner picker and API follow; legacy listings keep theirs", async ({ playwright, browser }) => {
  test.setTimeout(150_000);
  await withActors(playwright, ["QA_VENDOR"], async (f) => {
    const orgId = randomUUID(), ownerId = randomUUID(), password = randomBytes(24).toString("hex"), email = `qa_cat_${ownerId.slice(0, 8)}@example.test`;
    const live = randomUUID(), legacy = randomUUID();
    await f.connection.execute("INSERT INTO organisations (id, name, kind) VALUES (?, 'QA Faith Community', 'vendor')", [orgId]);
    await f.connection.execute("INSERT INTO users (id, email, password_hash, role, status, name, business_name, org_id, invited_staff) VALUES (?, ?, ?, 'vendor', 'approved', 'QA Cat Owner', 'QA Faith Community', ?, 0)", [ownerId, email, bcrypt.hashSync(password, 10), orgId]);
    const insExp = `INSERT INTO experiences (id, vendor_id, kind, title, blurb, description, fitness_requirements, itinerary, equipment_provided, equipment_required, transport_info, safety_info, weather_policy, eligibility, cancellation_terms, status, capacity, price_cents, payment_method)
                    VALUES (?, ?, 'experience', ?, 'b', 'd', '', '', '', '', '', '', '', '', '', 'approved', 10, 0, 'cash')`;
    await f.connection.execute(insExp, [live, ownerId, "QA Diwali gathering"]);
    await f.connection.execute(insExp, [legacy, ownerId, "QA Heritage walk"]);
    // The legacy listing was categorised before the restriction.
    await f.connection.execute("INSERT INTO listing_taxonomy (listing_type, listing_id, category_id, subcategory_id, assigned_by) VALUES ('experience', ?, 'culture-heritage', NULL, 'admin')", [legacy]);
    for (const [t, c, v] of [["organisations", "id", orgId], ["org_category_access", "org_id", orgId], ["audit_log", "object_id", orgId], ["users", "id", ownerId], ["sessions", "user_id", ownerId], ["experiences", "id", live], ["experiences", "id", legacy], ["listing_taxonomy", "listing_id", live], ["listing_taxonomy", "listing_id", legacy], ["listing_attributes", "listing_id", live], ["listing_attributes", "listing_id", legacy]]) f.track(t, c, v);

    const admin = await staffActor(browser, "QA_ADMIN");
    try {
      const { page } = admin;
      await page.goto(`/admin?tab=organisations&record=org:${orgId}`);
      await expect(page.getByRole("heading", { name: "QA Faith Community" })).toBeVisible();
      await page.getByLabel("Only the categories ticked below").check();
      await page.getByLabel("Culture, faith & celebrations").check();
      await page.getByLabel("All subcategories").uncheck();
      for (const s of ["Cultural festivals", "Community celebrations", "Fundraisers"]) await page.getByLabel(s, { exact: true }).uncheck();
      await page.getByRole("button", { name: "Review category changes" }).click();
      const review = page.getByRole("region", { name: "Review category changes" });
      await expect(review).toContainText("Culture & heritage (1 listings keep it)");
      await shot(page, "04-admin-allowed-categories");
      await page.getByRole("button", { name: "Save allowed categories" }).click();
      await expect(page.getByLabel("Faith gatherings", { exact: true })).toBeChecked();
      // The category editor's Governance section (viewed, not saved).
      await page.goto(`/admin?tab=categories&record=category-edit:culture-faith-celebrations`);
      await expect(page.getByLabel("Review rule")).toBeVisible();
      await expect(page.getByLabel(/^Suggested registration form/)).toBeVisible();
      await shot(page, "05-admin-category-governance");
      expect(admin.consoleErrors).toEqual([]);
    } finally { await admin.close(); }

    const [access] = await rows(f, "SELECT COUNT(*) AS n FROM org_category_access WHERE org_id = ? AND category_id = 'culture-faith-celebrations' AND subcategory_id = 'faith-gatherings'", [orgId]);
    expect(access.n).toBe(1);
    const [org] = await rows(f, "SELECT category_mode FROM organisations WHERE id = ?", [orgId]);
    expect(org.category_mode).toBe("restricted");

    const partner = await staffActor(browser, "QA_CAT", { credentials: { email, password } });
    try {
      const { page } = partner;
      expect((await partner.context.request.post("/api/auth/accept-terms", { data: { termsAccepted: true } })).status()).toBe(200);
      // The picker on the partner's own listing page (before it has a category).
      await page.goto(`/vendor/experiences/${live}`);
      await page.getByRole("button", { name: /^(Add|Edit) category$/ }).click();
      const combo = page.getByRole("combobox", { name: /Category/ });
      await expect(combo).toBeVisible();
      await combo.click();
      await combo.press("ArrowDown");
      const list = page.getByRole("listbox", { name: /Category options/ });
      await expect(list.getByRole("option")).toHaveCount(1);
      await expect(list.getByRole("option").first()).toContainText("Faith gatherings");
      await shot(page, "06-partner-picker");
      const options = await (await page.request.get("/api/categories/options?family=experience&scope=partner")).json();
      expect(options.categories.map((c: { id: string; subcategories: { id: string }[] }) => [c.id, c.subcategories.map((s) => s.id)])).toEqual([["culture-faith-celebrations", ["faith-gatherings"]]]);
      const refused = await page.request.put(`/api/vendor/classification/experience/${live}`, { data: { categoryId: "outdoors", subcategoryId: null, tags: [] } });
      expect(refused.status()).toBe(400);
      const ok = await page.request.put(`/api/vendor/classification/experience/${live}`, { data: { categoryId: "culture-faith-celebrations", subcategoryId: "faith-gatherings", tags: [] } });
      expect(ok.status()).toBe(200);
      // The legacy listing keeps Culture & heritage and can still be saved unchanged.
      const keep = await page.request.put(`/api/vendor/classification/experience/${legacy}`, { data: { categoryId: "culture-heritage", subcategoryId: null, tags: ["outdoor"] } });
      expect(keep.status()).toBe(200);
      const [legacyRow] = await rows(f, "SELECT category_id FROM listing_taxonomy WHERE listing_id = ?", [legacy]);
      expect(legacyRow.category_id).toBe("culture-heritage");
      expect(partner.consoleErrors).toEqual([]);
    } finally { await partner.close(); }
  });
});
