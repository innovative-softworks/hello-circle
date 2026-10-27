import http, { type Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "./db/index.js";
import { categoriesRouter } from "./routes/categories.js";
import { circlesRouter } from "./routes/circles.js";
import { gamesRouter } from "./routes/games.js";
import { vendorParticipationRouter } from "./routes/vendorParticipation.js";
import { adminCategoriesRouter, categoriesConfigRouter } from "./routes/adminCategories.js";
import { categorySitemapUrls, resolveCategoryOgMeta } from "./ogMeta.js";
import {
  CATEGORY_SEED,
  categoriesForSearch,
  classifyListing,
  integrityIssues,
  loadTaxonomy,
  matchLabel,
  normalizeAlias,
  TaxonomyValidationError,
  validateAssignment,
  type TaxonomyIndex,
} from "./taxonomy.js";

// Category system (approved 2026-10-22): seed shape, the deterministic
// matcher, write validation and the public/host/vendor routes. Runs in the
// isolated test profile like every server test; ids are run-scoped and
// cleaned up.

const run = Date.now().toString(36);
let index: TaxonomyIndex;
let server: Server;
let baseUrl = "";
const resident = `test-tax-r-${run}`;
const createdCircles: string[] = [];

function call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  return fetch(`${baseUrl}${path}`, { method, headers: { "Content-Type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
}

beforeAll(async () => {
  index = await loadTaxonomy();
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const residentId = req.header("X-Test-Resident-Id");
    if (residentId) (req as any).resident = { id: residentId, name: "Test", homeCounty: null };
    const adminRole = req.header("X-Test-Admin-Role");
    if (adminRole) (req as any).user = { id: `test-tax-admin-${run}`, role: "admin", status: "approved", adminRole };
    const vendorId = req.header("X-Test-Vendor-Id");
    if (vendorId) {
      (req as any).user = { id: vendorId, role: "vendor", status: "approved", invitedStaff: false, platformRole: null };
      (req as any).vendorIds = [vendorId];
    }
    next();
  });
  app.use("/categories", categoriesRouter);
  app.use("/circles", circlesRouter);
  app.use("/games", gamesRouter);
  app.use("/vendor", vendorParticipationRouter);
  app.use("/admin/categories", adminCategoriesRouter);
  app.use("/admin", categoriesConfigRouter);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Failed to bind test server");
  baseUrl = `http://127.0.0.1:${address.port}`;
  await db.prepare(`INSERT INTO residents (id, email, name) VALUES (?, ?, ?)`).run(resident, `${resident}@example.test`, "Tax Tester");
});

afterAll(async () => {
  for (const id of createdCircles) {
    await db.prepare(`DELETE FROM circle_members WHERE circle_id = ?`).run(id);
    await db.prepare(`DELETE FROM listing_taxonomy WHERE listing_type = 'circle' AND listing_id = ?`).run(id);
    await db.prepare(`DELETE FROM listing_attributes WHERE listing_type = 'circle' AND listing_id = ?`).run(id);
    await db.prepare(`DELETE FROM circles WHERE id = ?`).run(id);
  }
  await db.prepare(`DELETE FROM residents WHERE id = ?`).run(resident);
  await db.prepare(`UPDATE taxonomy_categories SET active = 1 WHERE id = 'padel'`).run();
  await db.prepare(`DELETE FROM taxonomy_aliases WHERE category_id LIKE ?`).run(`test-tax-%`);
  await db.prepare(`DELETE FROM taxonomy_categories WHERE id LIKE ?`).run(`test-tax-%`);
  server?.close();
});

describe("seed", () => {
  it("has the 21 approved active categories plus inactive extras, two levels deep, unique slugs", () => {
    const rows = [...index.byId.values()];
    const cats = rows.filter((r) => !r.parent_id);
    expect(cats.filter((c) => Number(c.active) === 1).map((c) => c.id)).toHaveLength(21);
    expect(cats).toHaveLength(CATEGORY_SEED.length);
    for (const r of rows.filter((r) => r.parent_id)) expect(index.byId.get(r.parent_id!)?.parent_id).toBeNull();
    expect(new Set(rows.map((r) => r.slug)).size).toBe(rows.length);
    for (const added of ["book-club", "coasteering", "athletics", "gymnastics"]) expect(index.byId.get(added)).toBeTruthy();
    expect(index.byId.get("football")).toBeUndefined(); // an alias needing review, never a category
  });
  it("passes the integrity check after the backfill", async () => {
    expect(await integrityIssues()).toEqual([]);
  });
});

describe("matcher", () => {
  it("normalises text the same way for aliases and labels", () => {
    expect(normalizeAlias("  Coffee & Chat — Meetup ")).toBe("coffee and chat meetup");
  });
  it("maps legacy labels exactly", () => {
    expect(matchLabel(index, "Five-a-side Football", "activity")).toMatchObject({ status: "matched", categoryId: "soccer", subcategoryId: "5-a-side" });
    expect(matchLabel(index, "Book Club Discussion", "circle")).toMatchObject({ status: "matched", categoryId: "meetups", subcategoryId: "book-club" });
  });
  it("never auto-applies 'football' or two-category titles", () => {
    expect(matchLabel(index, "Sunday football", "activity").status).toBe("ambiguous");
    expect(matchLabel(index, "Kilkenny Medieval Walking Tour", "experience").status).toBe("ambiguous");
    expect(matchLabel(index, "Dublin Rooftop Yoga & Brunch", "experience").status).toBe("ambiguous");
  });
  it("ignores categories that don't apply to the family", () => {
    expect(matchLabel(index, "Midlands Climbing Wall", "venue").status).toBe("none");
    expect(matchLabel(index, "Killarney Lakes Kayaking", "experience")).toMatchObject({ categoryId: "water", subcategoryId: "kayaking" });
  });
  it("uses a programme's parent club sport only as a suggestion", () => {
    const r = classifyListing(index, { type: "program", id: "x", family: "programme", labels: ["Adult Beginners"], parentSport: "Soccer" });
    expect(r).toMatchObject({ status: "ambiguous", suggestion: "soccer" });
  });
  it("widens search for 'football' to soccer and Gaelic games", () => {
    expect(categoriesForSearch(index, "football dublin").categoryIds.sort()).toEqual(["gaelic-games", "soccer"]);
    expect(categoriesForSearch(index, "badminton").subcategoryIds).toEqual(["badminton"]);
  });
});

describe("validateAssignment", () => {
  it("rejects unknown ids, wrong families and mismatched subcategories", async () => {
    await expect(validateAssignment("activity", "not-a-category", null, null)).rejects.toBeInstanceOf(TaxonomyValidationError);
    await expect(validateAssignment("activity", "badminton", null, null)).rejects.toThrow(/Unknown category/); // a subcategory id as category
    await expect(validateAssignment("venue", "racket-sports", null, null)).rejects.toThrow(/isn't available/);
    await expect(validateAssignment("activity", "racket-sports", "hiking", null)).rejects.toThrow(/doesn't belong/);
  });
  it("accepts valid pairs, treats omitted as unchanged and empty as clear", async () => {
    expect(await validateAssignment("activity", "racket-sports", "badminton", null)).toEqual({ categoryId: "racket-sports", subcategoryId: "badminton" });
    expect(await validateAssignment("activity", undefined, undefined, null)).toBeUndefined();
    expect(await validateAssignment("activity", "", undefined, null)).toBeNull();
  });
  it("refuses a disabled subcategory for a new choice but keeps it on an existing listing", async () => {
    await db.prepare(`UPDATE taxonomy_categories SET active = 0 WHERE id = 'padel'`).run();
    await expect(validateAssignment("activity", "racket-sports", "padel", null)).rejects.toThrow(/no longer offered/);
    expect(await validateAssignment("activity", "racket-sports", "padel", { categoryId: "racket-sports", subcategoryId: "padel" })).toEqual({ categoryId: "racket-sports", subcategoryId: "padel" });
    await db.prepare(`UPDATE taxonomy_categories SET active = 1 WHERE id = 'padel'`).run();
  });
});

describe("routes", () => {
  it("lists form options for a family and refuses an unknown family", async () => {
    const ok = await call("GET", "/categories/options?family=circle");
    expect(ok.status).toBe(200);
    const body = (await ok.json()) as { categories: { id: string }[]; tags: string[] };
    expect(body.categories.map((c) => c.id)).toContain("outdoors");
    expect(body.categories.map((c) => c.id)).not.toContain("spaces-sport");
    expect(body.tags).toContain("weekend");
    expect((await call("GET", "/categories?family=nonsense")).status).toBe(400);
  });

  it("host creates a Circle with a category and tags; invalid ids are refused before anything is written", async () => {
    const headers = { "X-Test-Resident-Id": resident };
    const bad = await call("POST", "/circles", { name: `Test Tax Bad ${run}`, activityLabel: "Hiking", categoryId: "outdoors", subcategoryId: "badminton" }, headers);
    expect(bad.status).toBe(400);
    expect(((await db.prepare(`SELECT COUNT(*) as n FROM circles WHERE name = ?`).get(`Test Tax Bad ${run}`)) as { n: number }).n).toBe(0);

    const res = await call("POST", "/circles", { name: `Test Tax Hikers ${run}`, activityLabel: "Hiking", county: "Dublin", categoryId: "outdoors", subcategoryId: "hiking", tags: ["weekend", "not-a-tag"] }, headers);
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: string };
    createdCircles.push(id);

    const detail = (await (await call("GET", `/circles/${id}`)).json()) as { taxonomy: { categoryId: string; subcategoryId: string }; tags: string[] };
    expect(detail.taxonomy).toMatchObject({ categoryId: "outdoors", subcategoryId: "hiking" });
    expect(detail.tags).toEqual(["weekend"]);

    const filtered = (await (await call("GET", `/circles?subcategoryId=hiking&limit=100`)).json()) as { id: string }[];
    expect(filtered.map((c) => c.id)).toContain(id);
    const other = (await (await call("GET", `/circles?categoryId=water&limit=100`)).json()) as { id: string }[];
    expect(other.map((c) => c.id)).not.toContain(id);

    // An edit that doesn't send the fields keeps them.
    const edit = await call("PUT", `/circles/${id}`, { name: `Test Tax Hikers ${run}`, activityLabel: "Hiking", county: "Dublin" }, headers);
    expect(edit.status).toBe(200);
    expect(((await db.prepare(`SELECT subcategory_id as s FROM listing_taxonomy WHERE listing_type = 'circle' AND listing_id = ?`).get(id)) as { s: string }).s).toBe("hiking");
  });

  it("returns no rows for an unknown category instead of every row", async () => {
    const res = await call("GET", "/games?categoryId=does-not-exist");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  it("vendors can only classify their own listings", async () => {
    const centre = (await db.prepare(`SELECT id, vendor_id as vendorId FROM centres WHERE vendor_id IS NOT NULL LIMIT 1`).get()) as { id: string; vendorId: string };
    const stranger = await call("PUT", `/vendor/classification/centre/${centre.id}`, { categoryId: "spaces-sport" }, { "X-Test-Vendor-Id": `test-tax-v-${run}` });
    expect(stranger.status).toBe(403);
    const wrongFamily = await call("PUT", `/vendor/classification/centre/${centre.id}`, { categoryId: "racket-sports" }, { "X-Test-Vendor-Id": centre.vendorId });
    expect(wrongFamily.status).toBe(400);
  });
});

describe("admin categories", () => {
  const superH = { "X-Test-Admin-Role": "super" };
  const supportH = { "X-Test-Admin-Role": "support" };
  const a = `test-tax-a-${run}`;
  const b = `test-tax-b-${run}`;

  it("lets every admin read but only Super change", async () => {
    expect((await call("GET", "/admin/categories", undefined, supportH)).status).toBe(200);
    expect((await call("POST", "/admin/categories", { name: "Nope", id: `test-tax-nope-${run}`, families: ["activity"] }, supportH)).status).toBe(403);
  });

  it("creates, edits with rowVersion, merges and refuses deleting a used category", async () => {
    const created = await call("POST", "/admin/categories", { name: "Test A", id: a, families: ["circle"] }, superH);
    expect(created.status).toBe(201);
    expect((await call("POST", "/admin/categories", { name: "Test A again", id: a, families: ["circle"] }, superH)).status).toBe(409);
    expect((await call("POST", "/admin/categories", { name: "Bad", id: "Bad Id!", families: ["circle"] }, superH)).status).toBe(400);
    expect((await call("POST", "/admin/categories", { name: "Test B", id: b, families: ["circle", "activity"] }, superH)).status).toBe(201);

    const { rowVersion } = (await created.json()) as { rowVersion: number };
    expect((await call("PUT", `/admin/categories/${a}`, { name: "Test A renamed", rowVersion }, superH)).status).toBe(200);
    expect((await call("PUT", `/admin/categories/${a}`, { name: "Stale", rowVersion }, superH)).status).toBe(409);

    // Put a Circle in A, then delete must be refused.
    const circleId = createdCircles[0];
    expect((await call("PUT", `/admin/categories/listings/circle/${circleId}`, { categoryId: a }, superH)).status).toBe(200);
    expect((await call("DELETE", `/admin/categories/${a}`, undefined, superH)).status).toBe(409);

    // B covers circle + activity, so A (circle) can merge into it; the reverse would not.
    expect((await call("POST", `/admin/categories/${b}/merge`, { targetId: a }, superH)).status).toBe(400);
    const merged = await call("POST", `/admin/categories/${a}/merge`, { targetId: b }, superH);
    expect(merged.status).toBe(200);
    expect(((await merged.json()) as { listingsMoved: number }).listingsMoved).toBe(1);
    expect(((await db.prepare(`SELECT category_id as c FROM listing_taxonomy WHERE listing_type = 'circle' AND listing_id = ?`).get(circleId)) as { c: string }).c).toBe(b);
    // The old slug keeps answering, pointing at the new one.
    const old = (await (await call("GET", `/categories/${a}`)).json()) as { redirectTo?: string };
    expect(old.redirectTo).toBe(b);
    // An archived (merged) category can't be newly chosen.
    expect((await call("PUT", `/admin/categories/listings/circle/${circleId}`, { categoryId: a }, superH)).status).toBe(400);
    expect(((await (await call("GET", `/admin/categories/${b}`, undefined, superH)).json()) as { history: unknown[] }).history.length).toBeGreaterThan(0);
  });

  it("lets Support report a wrong classification into the reports queue", async () => {
    const circleId = createdCircles[0];
    expect((await call("POST", "/admin/categories/report", { listingType: "circle", listingId: circleId, note: "Not hiking" }, supportH)).status).toBe(201);
    const row = (await db.prepare(`SELECT reason FROM reports WHERE target_type = 'circle' AND target_id = ? ORDER BY id DESC LIMIT 1`).get(circleId)) as { reason: string };
    expect(row.reason).toBe("Wrong category: Not hiking");
    await db.prepare(`DELETE FROM reports WHERE target_type = 'circle' AND target_id = ?`).run(circleId);
  });
});

describe("category SEO", () => {
  it("indexes a live category page alone, noindexes combinations, ignores unknown slugs", async () => {
    const live = (await (await call("GET", "/categories?family=circle")).json()) as { slug: string; subcategories: { slug: string }[] }[];
    expect(live.length).toBeGreaterThan(0);
    const slug = live[0].slug;
    expect((await resolveCategoryOgMeta("/circles", { category: slug }))?.robots).toBe("index, follow");
    const combo = await resolveCategoryOgMeta("/circles", { category: slug, county: "Dublin" });
    expect(combo?.robots).toBe("noindex, nofollow");
    expect(combo?.url).toMatch(new RegExp(`/circles\\?category=${slug}$`));
    expect(await resolveCategoryOgMeta("/circles", { category: "not-a-category" })).toBeNull();
    expect(await resolveCategoryOgMeta("/circles", { category: "culture-heritage" })).toBeNull(); // not a Circle category
  });
  it("lists only categories with live listings in the sitemap", async () => {
    const urls = await categorySitemapUrls();
    expect(urls.some((u) => u.includes("/circles?category="))).toBe(true);
    expect(urls.some((u) => u.includes("category=nature-wildlife"))).toBe(false); // inactive
  });
});

describe("categories switch and review safety", () => {
  const superH = { "X-Test-Admin-Role": "super" };
  const supportH = { "X-Test-Admin-Role": "support" };
  it("reads for every admin, changes only for Super, audits, and hides public categories while off", async () => {
    const read = await call("GET", "/admin/config/categories-enabled", undefined, supportH);
    expect(read.status).toBe(200);
    expect(((await read.json()) as { enabled: boolean }).enabled).toBe(true);
    expect((await call("PUT", "/admin/config/categories-enabled", { enabled: false }, supportH)).status).toBe(403);
    expect((await call("PUT", "/admin/config/categories-enabled", { enabled: "no" }, superH)).status).toBe(400);
    try {
      expect((await call("PUT", "/admin/config/categories-enabled", { enabled: false }, superH)).status).toBe(200);
      expect(await (await call("GET", "/categories?family=circle")).json()).toEqual([]);
      expect(((await (await call("GET", "/categories/options?family=circle")).json()) as { enabled: boolean }).enabled).toBe(false);
      const [audit] = (await db.prepare(`SELECT new_value FROM audit_log WHERE action = 'config.categories_enabled_changed' ORDER BY id DESC LIMIT 1`).all()) as { new_value: string }[];
      expect(JSON.parse(audit.new_value)).toEqual({ enabled: false });
    } finally {
      await call("PUT", "/admin/config/categories-enabled", { enabled: true }, superH);
      await db.prepare(`DELETE FROM audit_log WHERE action = 'config.categories_enabled_changed' AND actor_user_id = ?`).run(`test-tax-admin-${run}`);
    }
  }, 20_000);

  it("never assigns a review suggestion by itself: every unassigned row needs approval and stays unassigned after a read", async () => {
    const before = ((await db.prepare(`SELECT COUNT(*) as n FROM listing_taxonomy`).get()) as { n: number }).n;
    const list = (await (await call("GET", "/admin/categories/uncategorised", undefined, superH)).json()) as { needsApproval: boolean; confidence: string }[];
    expect(list.length).toBeGreaterThan(0);
    expect(list.every((r) => r.needsApproval === true)).toBe(true);
    expect(list.every((r) => ["medium", "low", "none"].includes(r.confidence))).toBe(true);
    expect(((await db.prepare(`SELECT COUNT(*) as n FROM listing_taxonomy`).get()) as { n: number }).n).toBe(before);
  });
});
