import crypto from "node:crypto";
import http, { type Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "./db/index.js";
import { adminRouter } from "./routes/admin.js";
import { vendorRouter } from "./routes/vendor.js";
import { categoriesRouter } from "./routes/categories.js";
import { categoryAccessIssues, categoryRefusal, cleanAccess, CategoryAccessError, filterPicker } from "./categoryPolicy.js";
import { loadTaxonomy, type CategoryRow } from "./taxonomy.js";

// Configuration framework Phase E (docs/participation-expansion/15) — category
// governance on the existing taxonomy: organisation eligibility, subcategory
// restrictions, moderation policy, suggested form, legacy listings. Own test
// categories only (seeded categories are never modified). Real routers.

const run = crypto.randomUUID().slice(0, 8);
const id = (k: string) => `t-${k}-ce-${run}`;
const orgA = id("orgA");
const orgB = id("orgB");
const ownerA = id("ownerA");
const ownerB = id("ownerB");
const cat = { open: `tce-open-${run}`, eligible: `tce-elig-${run}`, review: `tce-rev-${run}` };
const sub = { o1: `tce-o1-${run}`, o2: `tce-o2-${run}`, r1: `tce-r1-${run}` };
const expA = id("expA");
const expLive = id("expLive");
const expB = id("expB");
let server: Server;
let base: string;

function userFor(who: string) {
  const v = { role: "vendor", status: "approved", invitedStaff: false, platformRole: null, orgStatus: "active", name: who, businessName: who, email: `${who}@example.test` };
  if (who === "ownerA") return { ...v, id: ownerA, orgId: orgA };
  if (who === "ownerB") return { ...v, id: ownerB, orgId: orgB };
  if (who === "super") return { id: "t-super-ce", role: "admin", status: "approved", adminRole: "super", name: "s", email: "s@example.test" };
  if (who === "support") return { id: "t-support-ce", role: "admin", status: "approved", adminRole: "support", name: "u", email: "u@example.test" };
  return undefined;
}
async function call(method: string, path: string, body?: unknown, who?: string) {
  const res = await fetch(`${base}${path}`, { method, headers: { "Content-Type": "application/json", ...(who ? { "X-Test-User": who } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json };
}
const classify = (exp: string, who: string, categoryId: string | null, subcategoryId: string | null = null) => call("PUT", `/api/vendor/classification/experience/${exp}`, { categoryId, subcategoryId, tags: [] }, who);
const orgVersion = async (org: string) => Number(((await db.prepare(`SELECT config_version AS v FROM organisations WHERE id = ?`).get(org)) as { v: number }).v);

beforeAll(async () => {
  await db.prepare(`INSERT INTO organisations (id, name, kind) VALUES (?, 'CE A', 'vendor'), (?, 'CE B', 'vendor')`).run(orgA, orgB);
  for (const [u, o] of [[ownerA, orgA], [ownerB, orgB]]) await db.prepare(`INSERT INTO users (id, email, password_hash, role, status, name, org_id) VALUES (?, ?, 'x', 'vendor', 'approved', 'CE', ?)`).run(u, `${u}@example.test`, o);
  const insCat = `INSERT INTO taxonomy_categories (id, parent_id, name, slug, families, sort_order, active, discoverable, moderation_policy) VALUES (?, ?, ?, ?, 'experience', 999, 1, 1, ?)`;
  await db.prepare(insCat).run(cat.open, null, "CE Open", cat.open, "standard");
  await db.prepare(insCat).run(sub.o1, cat.open, "CE Open one", sub.o1, "standard");
  await db.prepare(insCat).run(sub.o2, cat.open, "CE Open two", sub.o2, "standard");
  await db.prepare(insCat).run(cat.eligible, null, "CE Approved only", cat.eligible, "eligible_only");
  await db.prepare(insCat).run(cat.review, null, "CE Review", cat.review, "review_required");
  await db.prepare(insCat).run(sub.r1, cat.review, "CE Review one", sub.r1, "standard");
  const insExp = `INSERT INTO experiences (id, vendor_id, kind, title, blurb, description, fitness_requirements, itinerary, equipment_provided, equipment_required, transport_info, safety_info, weather_policy, eligibility, cancellation_terms, status, capacity, price_cents, payment_method)
                  VALUES (?, ?, 'experience', ?, 'b', 'd', '', '', '', '', '', '', '', '', '', ?, 10, 0, 'cash')`;
  await db.prepare(insExp).run(expA, ownerA, "CE draft", "draft");
  await db.prepare(insExp).run(expLive, ownerA, "CE live", "approved");
  await db.prepare(insExp).run(expB, ownerB, "CE B", "draft");
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const who = req.header("X-Test-User");
    if (who) (req as any).user = userFor(who);
    next();
  });
  app.use("/api/admin", adminRouter);
  app.use("/api/vendor", vendorRouter);
  app.use("/api/categories", categoriesRouter);
  server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, r));
  const a = server.address();
  if (!a || typeof a === "string") throw new Error("bind");
  base = `http://127.0.0.1:${a.port}`;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  await db.prepare(`DELETE FROM listing_taxonomy WHERE listing_id IN (?, ?, ?)`).run(expA, expLive, expB);
  await db.prepare(`DELETE FROM listing_attributes WHERE listing_id IN (?, ?, ?)`).run(expA, expLive, expB);
  await db.prepare(`DELETE FROM experiences WHERE id IN (?, ?, ?)`).run(expA, expLive, expB);
  await db.prepare(`DELETE FROM org_category_access WHERE org_id IN (?, ?, 'ghost-org')`).run(orgA, orgB);
  await db.prepare(`DELETE FROM taxonomy_categories WHERE id IN (?, ?, ?, ?, ?, ?)`).run(cat.open, cat.eligible, cat.review, sub.o1, sub.o2, sub.r1);
  await db.prepare(`DELETE FROM audit_log WHERE object_id IN (?, ?, ?, ?, ?, ?)`).run(orgA, orgB, expA, expLive, expB, cat.open);
  await db.prepare(`DELETE FROM users WHERE id IN (?, ?)`).run(ownerA, ownerB);
  await db.prepare(`DELETE FROM organisations WHERE id IN (?, ?)`).run(orgA, orgB);
});

describe("eligibility rules", () => {
  const row = (idv: string, policy = "standard") => ({ id: idv, name: idv, moderation_policy: policy }) as CategoryRow;
  it("all mode allows everything except approved-only categories; restricted mode only what's granted; subcategory rows narrow", () => {
    const all = { mode: "all" as const, grants: new Map<string, Set<string>>() };
    expect(categoryRefusal(all, row("x"), null)).toBeNull();
    expect(categoryRefusal(all, row("y", "eligible_only"), null)).toMatch(/only available to organisations/);
    const restricted = { mode: "restricted" as const, grants: new Map([["x", new Set(["s1"])]]) };
    expect(categoryRefusal(restricted, row("z"), null)).toMatch(/isn't one of your organisation's/);
    expect(categoryRefusal(restricted, row("x"), null)).toMatch(/Choose one of/);
    expect(categoryRefusal(restricted, row("x"), "s2")).toMatch(/isn't available/);
    expect(categoryRefusal(restricted, row("x"), "s1")).toBeNull();
  });
  it("validates grants against the taxonomy (application-level integrity, D-A1)", async () => {
    const index = await loadTaxonomy();
    const err = (raw: unknown) => { try { cleanAccess(raw, index); return null; } catch (e) { return e instanceof CategoryAccessError ? e.message : String(e); } };
    expect(err({ mode: "restricted", grants: [] })).toMatch(/at least one/);
    expect(err({ mode: "all", grants: [{ categoryId: "nope" }] })).toMatch(/Unknown category/);
    expect(err({ mode: "all", grants: [{ categoryId: cat.open, subcategoryIds: [sub.r1] }] })).toMatch(/isn't one of its subcategories/);
    expect(cleanAccess({ mode: "restricted", grants: [{ categoryId: cat.open, subcategoryIds: [sub.o1] }, { categoryId: cat.review }] }, index).rows).toHaveLength(2);
  });
  it("the picker hides approved-only categories by default", async () => {
    const index = await loadTaxonomy();
    const picked = filterPicker([{ id: cat.open, name: "", description: null, icon: null, subcategories: [] }, { id: cat.eligible, name: "", description: null, icon: null, subcategories: [] }], { mode: "all", grants: new Map() }, index);
    expect(picked.map((p) => p.id)).toEqual([cat.open]);
  });
});

describe("admin configuration and partner enforcement", () => {
  it("only orgs.manage changes an organisation's categories; versioned and audited", async () => {
    expect((await call("GET", `/api/admin/organisations/${orgA}/categories`, undefined, "support")).status).toBe(200);
    const body = { mode: "restricted", grants: [{ categoryId: cat.open, subcategoryIds: [sub.o1] }, { categoryId: cat.review, subcategoryIds: "*" }], configVersion: await orgVersion(orgA), reason: "Event organiser setup" };
    expect((await call("PUT", `/api/admin/organisations/${orgA}/categories`, body, "support")).status).toBe(403);
    expect((await call("PUT", `/api/admin/organisations/${orgA}/categories`, body, "ownerA")).status).toBe(403);
    const saved = await call("PUT", `/api/admin/organisations/${orgA}/categories`, body, "super");
    expect(saved.status).toBe(200);
    expect(saved.body.mode).toBe("restricted");
    expect((await call("PUT", `/api/admin/organisations/${orgA}/categories`, { ...body, configVersion: 0 }, "super")).status).toBe(409);
    const audit = (await db.prepare(`SELECT reason, new_value FROM audit_log WHERE object_id = ? AND action = 'org.categories_changed'`).all(orgA)) as { reason: string; new_value: string }[];
    expect(audit).toHaveLength(1);
    expect(audit[0].reason).toBe("Event organiser setup");
  });

  it("#5 an unauthorised category is refused on the server; the picker shows only allowed ones", async () => {
    const outside = await classify(expA, "ownerA", cat.eligible);
    expect(outside.status).toBe(400);
    expect((await classify(expA, "ownerA", cat.open, sub.o2)).body.error).toMatch(/isn't available/);
    expect((await classify(expA, "ownerA", cat.open, null)).body.error).toMatch(/Choose one of/);
    expect((await classify(expA, "ownerA", cat.open, sub.o1)).status).toBe(200);
    const options = (await call("GET", `/api/vendor/classification/experience/${expA}`, undefined, "ownerA")).body.options as { id: string; subcategories: { id: string }[]; subcategoryRequired?: boolean }[];
    const mine = options.filter((o) => o.id.startsWith("tce-"));
    expect(mine.map((o) => o.id).sort()).toEqual([cat.open, cat.review].sort());
    expect(mine.find((o) => o.id === cat.open)).toMatchObject({ subcategories: [{ id: sub.o1 }], subcategoryRequired: true });
    // Restricted mode hides every seeded category for this organisation, too.
    expect(options.every((o) => o.id.startsWith("tce-"))).toBe(true);
    // The shared picker filters only for a partner form that asks for it.
    const partner = (await call("GET", `/api/categories/options?family=experience&scope=partner`, undefined, "ownerA")).body.categories as { id: string }[];
    const publicList = (await call("GET", `/api/categories/options?family=experience`, undefined, "ownerA")).body.categories as { id: string }[];
    expect(partner.every((c) => c.id.startsWith("tce-"))).toBe(true);
    expect(publicList.some((c) => c.id === "outdoors")).toBe(true);
    // Organisation B (all categories) can't use the approved-only one until granted.
    expect((await classify(expB, "ownerB", cat.eligible)).status).toBe(400);
    expect((await call("PUT", `/api/admin/organisations/${orgB}/categories`, { mode: "all", grants: [{ categoryId: cat.eligible }], configVersion: await orgVersion(orgB) }, "super")).status).toBe(200);
    expect((await classify(expB, "ownerB", cat.eligible)).status).toBe(200);
  });

  it("#6 a legacy listing keeps a category its organisation (or the platform) no longer offers", async () => {
    // Admin had placed the live listing in the open category's other subcategory.
    expect((await call("PUT", `/api/admin/categories/listings/experience/${expLive}`, { categoryId: cat.open, subcategoryId: sub.o2 }, "super")).status).toBe(200);
    expect((await classify(expLive, "ownerA", cat.open, sub.o2)).status).toBe(200); // unchanged → allowed
    await db.prepare(`UPDATE taxonomy_categories SET active = 0 WHERE id = ?`).run(cat.open);
    expect((await classify(expLive, "ownerA", cat.open, sub.o2)).status).toBe(200); // still unchanged
    expect((await classify(expA, "ownerA", cat.open, sub.o1)).status).toBe(200); // expA already has it
    const row = (await db.prepare(`SELECT category_id, subcategory_id FROM listing_taxonomy WHERE listing_id = ?`).get(expLive)) as { category_id: string; subcategory_id: string };
    expect(row).toEqual({ category_id: cat.open, subcategory_id: sub.o2 });
    await db.prepare(`UPDATE taxonomy_categories SET active = 1 WHERE id = ?`).run(cat.open);
  });

  it("review_required flags a live listing moved into it (never unpublishes); the admin accepts it", async () => {
    expect((await classify(expA, "ownerA", cat.review, sub.r1)).status).toBe(200); // draft → no flag
    expect((await call("GET", `/api/admin/categories/review`, undefined, "super")).body.some((r: { listingId: string }) => r.listingId === expA)).toBe(false);
    expect((await classify(expLive, "ownerA", cat.review, sub.r1)).status).toBe(200);
    const queue = (await call("GET", `/api/admin/categories/review`, undefined, "support")).body as { listingId: string; categoryName: string }[];
    expect(queue.find((r) => r.listingId === expLive)).toMatchObject({ categoryName: "CE Review" });
    expect(((await db.prepare(`SELECT status FROM experiences WHERE id = ?`).get(expLive)) as { status: string }).status).toBe("approved");
    expect((await call("POST", `/api/admin/categories/review/experience/${expLive}/accept`, {}, "support")).status).toBe(403);
    expect((await call("POST", `/api/admin/categories/review/experience/${expLive}/accept`, {}, "super")).status).toBe(200);
    expect((await call("GET", `/api/admin/categories/review`, undefined, "super")).body.some((r: { listingId: string }) => r.listingId === expLive)).toBe(false);
  });

  it("category review rule and suggested form are validated and saved", async () => {
    const cur = (await call("GET", `/api/admin/categories/${cat.open}`, undefined, "super")).body;
    const rowVersion = cur.category?.rowVersion ?? cur.rowVersion;
    expect((await call("PUT", `/api/admin/categories/${cat.open}`, { rowVersion, moderationPolicy: "sometimes" }, "super")).status).toBe(400);
    expect((await call("PUT", `/api/admin/categories/${cat.open}`, { rowVersion, suggestedForm: "tax_return" }, "super")).status).toBe(400);
    const ok = await call("PUT", `/api/admin/categories/${cat.open}`, { rowVersion, moderationPolicy: "review_required", suggestedForm: "event_registration" }, "super");
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ moderationPolicy: "review_required", suggestedForm: "event_registration" });
    const list = (await call("GET", `/api/admin/categories`, undefined, "super")).body;
    expect(list.formTypes.map((f: { key: string }) => f.key)).toContain("event_registration");
  });

  it("integrity: grants pointing at nothing are reported (D-A1)", async () => {
    await db.prepare(`INSERT INTO org_category_access (org_id, category_id, subcategory_id) VALUES ('ghost-org', 'no-such-category', '*')`).run();
    const issues = await categoryAccessIssues();
    expect(issues.map((i) => i.kind)).toEqual(expect.arrayContaining(["access_unknown_org", "access_unknown_category"]));
  });
});
