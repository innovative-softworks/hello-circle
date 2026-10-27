import { Router } from "express";
import { requireAdminPermission } from "../adminPermissions.js";
import { writeAudit } from "../audit.js";
import { db, getSetting, setSetting } from "../db/index.js";
import {
  classifyListing,
  FAMILIES,
  familiesOf,
  familyOf,
  getListingTaxonomy,
  integrityIssues,
  isFamily,
  isTaxonomyListingType,
  listingLabels,
  listingTable,
  loadTaxonomy,
  normalizeAlias,
  setListingTaxonomy,
  suggestionFor,
  TAXONOMY_LISTING_TYPES,
  TaxonomyValidationError,
  validateAssignment,
  type CategoryRow,
  type TaxonomyListingType,
} from "../taxonomy.js";

// Admin Categories (/admin?tab=categories) — mounted under /api/admin, so
// requireAdmin already ran. Reads: taxonomy.view (every admin). Changes:
// taxonomy.manage (Super). Every change is audited; a category is never
// hard-deleted while anything references it (archive instead); a merge
// re-points listings and keeps the old slug working as an alias.
export const adminCategoriesRouter = Router();

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const OBJECT = "taxonomy_category";

function toJson(r: CategoryRow) {
  return {
    id: r.id,
    parentId: r.parent_id,
    name: r.name,
    slug: r.slug,
    description: r.description,
    families: familiesOf(r),
    icon: r.icon,
    imageUrl: r.image_url,
    sortOrder: r.sort_order,
    active: Number(r.active) === 1,
    discoverable: Number(r.discoverable) === 1,
    featured: Number(r.featured) === 1,
    archived: !!r.archived_at,
    archivedAt: r.archived_at,
    seoTitle: r.seo_title,
    seoDescription: r.seo_description,
    rowVersion: r.row_version,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/** listing_taxonomy rows per category/subcategory id (any status — this is usage, not public inventory). */
async function usageCounts(): Promise<Map<string, number>> {
  const rows = (await db.prepare(`SELECT category_id as c, subcategory_id as s, COUNT(*) as n FROM listing_taxonomy GROUP BY category_id, subcategory_id`).all()) as { c: string; s: string | null; n: number | string }[];
  const out = new Map<string, number>();
  for (const r of rows) {
    out.set(r.c, (out.get(r.c) ?? 0) + Number(r.n));
    if (r.s) out.set(r.s, (out.get(r.s) ?? 0) + Number(r.n));
  }
  return out;
}

const TITLE_SQL: Record<TaxonomyListingType, string> = {
  game: "SELECT id, activity_label as title, status FROM games",
  experience: "SELECT id, title, status FROM experiences",
  program: "SELECT id, title, status FROM programs",
  circle: "SELECT id, name as title, status FROM circles",
  club: "SELECT id, name as title, status FROM clubs",
  centre: "SELECT id, name as title, status FROM centres",
};

async function titlesFor(type: TaxonomyListingType, ids: string[]): Promise<Map<string, { title: string; status: string }>> {
  if (!ids.length) return new Map();
  const rows = (await db.prepare(`${TITLE_SQL[type]} WHERE id IN (${ids.map(() => "?").join(",")})`).all(...ids)) as { id: string; title: string; status: string }[];
  return new Map(rows.map((r) => [String(r.id), { title: r.title, status: r.status }]));
}

// --- Reads ------------------------------------------------------------------------

adminCategoriesRouter.get("/", requireAdminPermission("taxonomy.view"), async (_req, res) => {
  const index = await loadTaxonomy();
  const usage = await usageCounts();
  const rows = [...index.byId.values()];
  const uncategorised: Record<string, number> = {};
  for (const t of TAXONOMY_LISTING_TYPES) {
    const { n } = (await db
      .prepare(`SELECT COUNT(*) as n FROM ${listingTable(t)} x WHERE NOT EXISTS (SELECT 1 FROM listing_taxonomy lt WHERE lt.listing_type = ? AND lt.listing_id = x.id)`)
      .get(t)) as { n: number | string };
    uncategorised[t] = Number(n);
  }
  res.json({
    families: FAMILIES,
    categories: rows
      .filter((r) => !r.parent_id)
      .map((c) => ({
        ...toJson(c),
        listingCount: usage.get(c.id) ?? 0,
        subcategories: rows.filter((s) => s.parent_id === c.id).map((s) => ({ ...toJson(s), listingCount: usage.get(s.id) ?? 0 })),
      })),
    uncategorised,
  });
});

adminCategoriesRouter.get("/uncategorised", requireAdminPermission("taxonomy.view"), async (req, res) => {
  const type = req.query.type;
  if (type !== undefined && !isTaxonomyListingType(type)) return res.status(400).json({ error: "Unknown listing type" });
  const index = await loadTaxonomy();
  const assigned = new Set(((await db.prepare(`SELECT listing_type, listing_id FROM listing_taxonomy`).all()) as { listing_type: string; listing_id: string }[]).map((r) => `${r.listing_type}:${r.listing_id}`));
  const listings = (await listingLabels()).filter((l) => (!type || l.type === type) && !assigned.has(`${l.type}:${l.id}`));
  const out = [];
  for (const t of TAXONOMY_LISTING_TYPES) {
    const ofType = listings.filter((l) => l.type === t);
    const titles = await titlesFor(t, ofType.map((l) => l.id));
    for (const l of ofType) {
      const verdict = classifyListing(index, l);
      const s = suggestionFor(index, l);
      out.push({
        listingType: l.type,
        listingId: l.id,
        family: l.family,
        title: titles.get(l.id)?.title ?? l.labels[0] ?? "",
        status: titles.get(l.id)?.status ?? "",
        /** The free text the matcher read (activity label, sport, title…). */
        existingLabel: l.labels.filter(Boolean).join(" · "),
        reason: verdict.status === "ambiguous" ? "ambiguous" : "no_match",
        candidates: verdict.candidates.map((id) => ({ id, name: index.byId.get(id)?.name ?? id })),
        suggestion: s.categoryId,
        suggestionName: s.categoryId ? index.byId.get(s.categoryId)?.name ?? s.categoryId : null,
        suggestedSubcategory: s.subcategoryId,
        suggestedSubcategoryName: s.subcategoryId ? index.byId.get(s.subcategoryId)?.name ?? s.subcategoryId : null,
        confidence: s.confidence,
        explanation: s.reason,
        // Nothing here is ever assigned without a person choosing it.
        needsApproval: true,
      });
    }
  }
  res.json(out);
});

adminCategoriesRouter.get("/integrity", requireAdminPermission("taxonomy.view"), async (_req, res) => {
  res.json(await integrityIssues());
});

adminCategoriesRouter.get("/:id", requireAdminPermission("taxonomy.view"), async (req, res) => {
  const index = await loadTaxonomy();
  const row = index.byId.get(req.params.id);
  if (!row) return res.status(404).json({ error: "Category not found" });
  const usage = await usageCounts();
  const col = row.parent_id ? "subcategory_id" : "category_id";
  const assigned = (await db
    .prepare(`SELECT listing_type, listing_id, subcategory_id, assigned_by, assigned_at FROM listing_taxonomy WHERE ${col} = ? ORDER BY listing_type, assigned_at DESC LIMIT 300`)
    .all(row.id)) as { listing_type: TaxonomyListingType; listing_id: string; subcategory_id: string | null; assigned_by: string; assigned_at: string }[];
  const listings = [];
  for (const t of TAXONOMY_LISTING_TYPES) {
    const ofType = assigned.filter((a) => a.listing_type === t);
    const titles = await titlesFor(t, ofType.map((a) => a.listing_id));
    for (const a of ofType) {
      listings.push({
        listingType: t,
        listingId: a.listing_id,
        title: titles.get(a.listing_id)?.title ?? "(removed listing)",
        status: titles.get(a.listing_id)?.status ?? "",
        subcategoryId: a.subcategory_id,
        subcategoryName: a.subcategory_id ? index.byId.get(a.subcategory_id)?.name ?? a.subcategory_id : null,
        assignedBy: a.assigned_by,
        assignedAt: a.assigned_at,
      });
    }
  }
  const history = await db
    .prepare(
      `SELECT al.id, al.action, al.previous_value as previousValue, al.new_value as newValue, al.reason, al.created_at as createdAt, u.name as actorName
       FROM audit_log al LEFT JOIN users u ON u.id = al.actor_user_id WHERE al.object_type = ? AND al.object_id = ? ORDER BY al.created_at DESC LIMIT 100`
    )
    .all(OBJECT, row.id);
  res.json({
    category: { ...toJson(row), listingCount: usage.get(row.id) ?? 0 },
    parent: row.parent_id && index.byId.get(row.parent_id) ? toJson(index.byId.get(row.parent_id)!) : null,
    subcategories: [...index.byId.values()].filter((s) => s.parent_id === row.id).map((s) => ({ ...toJson(s), listingCount: usage.get(s.id) ?? 0 })),
    aliases: index.aliases.filter((a) => a.category_id === row.id).map((a) => ({ alias: a.alias_norm, source: a.source, needsReview: Number(a.needs_review) === 1 })),
    listings,
    history,
  });
});

// --- Changes (Super) -----------------------------------------------------------------

interface CategoryBody {
  name?: string;
  id?: string;
  parentId?: string | null;
  description?: string | null;
  families?: string[];
  icon?: string | null;
  imageUrl?: string | null;
  sortOrder?: number;
  active?: boolean;
  discoverable?: boolean;
  featured?: boolean;
  seoTitle?: string | null;
  seoDescription?: string | null;
  rowVersion?: number;
}

const trimOrNull = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

function validateFamilies(v: unknown): string[] | string {
  if (!Array.isArray(v) || v.length === 0) return "Choose at least one listing type";
  if (!v.every(isFamily)) return "Unknown listing type";
  return [...new Set(v as string[])];
}

adminCategoriesRouter.post("/", requireAdminPermission("taxonomy.manage"), async (req, res) => {
  const b = req.body as CategoryBody;
  const name = trimOrNull(b.name, 120);
  if (!name) return res.status(400).json({ error: "A name is required", field: "name" });
  const id = (typeof b.id === "string" && b.id.trim() ? b.id.trim() : normalizeAlias(name).replace(/ /g, "-")).slice(0, 64);
  if (!SLUG_RE.test(id)) return res.status(400).json({ error: "Use lowercase letters, numbers and hyphens for the identifier", field: "id" });
  const index = await loadTaxonomy();
  if (index.byId.has(id) || [...index.byId.values()].some((r) => r.slug === id)) return res.status(409).json({ error: "That identifier is already used", field: "id" });
  if (index.aliases.some((a) => a.alias_norm === normalizeAlias(id) && a.source === "merge")) {
    return res.status(409).json({ error: "That identifier is kept as a redirect for a merged category", field: "id" });
  }
  let parent: CategoryRow | undefined;
  if (b.parentId) {
    parent = index.byId.get(b.parentId);
    if (!parent || parent.parent_id) return res.status(400).json({ error: "A subcategory's parent must be a top-level category", field: "parentId" });
  }
  // A subcategory always applies to exactly its category's listing types.
  const families = parent ? familiesOf(parent) : validateFamilies(b.families);
  if (typeof families === "string") return res.status(400).json({ error: families, field: "families" });
  const siblings = [...index.byId.values()].filter((r) => (r.parent_id ?? null) === (parent?.id ?? null));
  const sortOrder = Number.isInteger(b.sortOrder) ? b.sortOrder! : Math.max(0, ...siblings.map((s) => s.sort_order)) + 10;
  await db
    .prepare(
      `INSERT INTO taxonomy_categories (id, parent_id, name, slug, description, families, icon, image_url, sort_order, active, discoverable, featured, seo_title, seo_description)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      parent?.id ?? null,
      name,
      id,
      trimOrNull(b.description, 500),
      families.join(","),
      trimOrNull(b.icon, 40),
      trimOrNull(b.imageUrl, 500),
      sortOrder,
      b.active === false ? 0 : 1,
      b.discoverable === false ? 0 : 1,
      b.featured ? 1 : 0,
      trimOrNull(b.seoTitle, 120),
      trimOrNull(b.seoDescription, 300)
    );
  for (const alias of [normalizeAlias(name), normalizeAlias(id)]) {
    await db.prepare(`INSERT INTO taxonomy_aliases (alias_norm, category_id, source) VALUES (?, ?, 'slug') ON DUPLICATE KEY UPDATE alias_norm = alias_norm`).run(alias, id);
  }
  const created = (await loadTaxonomy()).byId.get(id)!;
  await writeAudit({ actorUserId: req.user!.id, action: "taxonomy.created", objectType: OBJECT, objectId: id, newValue: toJson(created) });
  res.status(201).json(toJson(created));
});

adminCategoriesRouter.put("/:id", requireAdminPermission("taxonomy.manage"), async (req, res) => {
  const b = req.body as CategoryBody;
  const index = await loadTaxonomy();
  const row = index.byId.get(req.params.id);
  if (!row) return res.status(404).json({ error: "Category not found" });
  if (!Number.isInteger(b.rowVersion)) return res.status(400).json({ error: "rowVersion is required" });
  if (b.rowVersion !== row.row_version) return res.status(409).json({ error: "Someone else changed this category. Reload to see their changes.", stale: true });
  if (b.name !== undefined && !trimOrNull(b.name, 120)) return res.status(400).json({ error: "A name is required", field: "name" });
  let families: string[] | null = null;
  if (b.families !== undefined && !row.parent_id) {
    const f = validateFamilies(b.families);
    if (typeof f === "string") return res.status(400).json({ error: f, field: "families" });
    // Removing a listing type that listings already use would leave them in the wrong family.
    const dropped = familiesOf(row).filter((x) => !f.includes(x));
    if (dropped.length) {
      const inUse = (await db.prepare(`SELECT listing_type, listing_id FROM listing_taxonomy WHERE category_id = ?`).all(row.id)) as { listing_type: TaxonomyListingType; listing_id: string }[];
      const kinds = new Map(((await db.prepare(`SELECT id, kind FROM experiences`).all()) as { id: string; kind: string }[]).map((r) => [r.id, r.kind]));
      const blocked = dropped.filter((fam) => inUse.some((u) => familyOf(u.listing_type, kinds.get(u.listing_id)) === fam));
      if (blocked.length) return res.status(409).json({ error: `Listings still use this category as ${blocked.join(", ")}. Move them first.`, field: "families" });
    }
    families = f;
  }
  const bool = (v: unknown, cur: number) => (typeof v === "boolean" ? (v ? 1 : 0) : Number(cur));
  const str = (v: unknown, cur: string | null, max: number) => (v === undefined ? cur : trimOrNull(v, max));
  const next = {
    name: b.name !== undefined ? trimOrNull(b.name, 120)! : row.name,
    description: str(b.description, row.description, 500),
    icon: str(b.icon, row.icon, 40),
    image_url: str(b.imageUrl, row.image_url, 500),
    sort_order: Number.isInteger(b.sortOrder) ? b.sortOrder! : row.sort_order,
    active: bool(b.active, row.active),
    discoverable: bool(b.discoverable, row.discoverable),
    featured: bool(b.featured, row.featured),
    seo_title: str(b.seoTitle, row.seo_title, 120),
    seo_description: str(b.seoDescription, row.seo_description, 300),
  };
  const info = await db
    .prepare(
      `UPDATE taxonomy_categories SET name = ?, description = ?, icon = ?, image_url = ?, sort_order = ?, active = ?, discoverable = ?, featured = ?, seo_title = ?, seo_description = ?,
              families = COALESCE(?, families), row_version = row_version + 1
       WHERE id = ? AND row_version = ?`
    )
    .run(next.name, next.description, next.icon, next.image_url, next.sort_order, next.active, next.discoverable, next.featured, next.seo_title, next.seo_description, families ? families.join(",") : null, row.id, row.row_version);
  if (info.changes === 0) return res.status(409).json({ error: "Someone else changed this category. Reload to see their changes.", stale: true });
  // Subcategories follow their category's listing types.
  if (families) await db.prepare(`UPDATE taxonomy_categories SET families = ? WHERE parent_id = ?`).run(families.join(","), row.id);
  if (next.name !== row.name) {
    await db.prepare(`INSERT INTO taxonomy_aliases (alias_norm, category_id, source) VALUES (?, ?, 'slug') ON DUPLICATE KEY UPDATE alias_norm = alias_norm`).run(normalizeAlias(next.name), row.id);
  }
  const updated = (await loadTaxonomy()).byId.get(row.id)!;
  await writeAudit({ actorUserId: req.user!.id, action: "taxonomy.updated", objectType: OBJECT, objectId: row.id, previousValue: toJson(row), newValue: toJson(updated) });
  res.json(toJson(updated));
});

adminCategoriesRouter.post("/reorder", requireAdminPermission("taxonomy.manage"), async (req, res) => {
  const { parentId, ids } = req.body as { parentId?: string | null; ids?: unknown };
  if (!Array.isArray(ids) || !ids.every((i) => typeof i === "string")) return res.status(400).json({ error: "ids must be a list of category ids" });
  const index = await loadTaxonomy();
  const siblings = [...index.byId.values()].filter((r) => (r.parent_id ?? null) === (parentId ?? null)).map((r) => r.id);
  if (ids.length !== siblings.length || !siblings.every((s) => ids.includes(s))) return res.status(400).json({ error: "Send every category at this level exactly once" });
  await db.transaction(async (tx) => {
    for (const [i, id] of (ids as string[]).entries()) await tx.prepare(`UPDATE taxonomy_categories SET sort_order = ?, row_version = row_version + 1 WHERE id = ?`).run((i + 1) * 10, id);
  });
  await writeAudit({ actorUserId: req.user!.id, action: "taxonomy.reordered", objectType: OBJECT, objectId: parentId ?? "(top level)", previousValue: siblings, newValue: ids });
  res.json({ ok: true });
});

adminCategoriesRouter.post("/:id/archive", requireAdminPermission("taxonomy.manage"), async (req, res) => {
  const index = await loadTaxonomy();
  const row = index.byId.get(req.params.id);
  if (!row) return res.status(404).json({ error: "Category not found" });
  if (row.archived_at) return res.status(409).json({ error: "Already archived" });
  // Listings keep an archived category until re-categorised (it can't be newly chosen).
  await db.prepare(`UPDATE taxonomy_categories SET archived_at = UTC_TIMESTAMP(), active = 0, discoverable = 0, row_version = row_version + 1 WHERE id = ? OR parent_id = ?`).run(row.id, row.id);
  await writeAudit({ actorUserId: req.user!.id, action: "taxonomy.archived", objectType: OBJECT, objectId: row.id, previousValue: toJson(row) });
  res.json(toJson((await loadTaxonomy()).byId.get(row.id)!));
});

adminCategoriesRouter.post("/:id/restore", requireAdminPermission("taxonomy.manage"), async (req, res) => {
  const index = await loadTaxonomy();
  const row = index.byId.get(req.params.id);
  if (!row) return res.status(404).json({ error: "Category not found" });
  if (!row.archived_at) return res.status(409).json({ error: "Not archived" });
  if (row.parent_id && index.byId.get(row.parent_id)?.archived_at) return res.status(409).json({ error: "Restore its category first" });
  // A merged category stays archived: its slug now redirects elsewhere.
  if (index.aliases.some((a) => a.source === "merge" && a.alias_norm === normalizeAlias(row.slug))) return res.status(409).json({ error: "This category was merged into another and can't be restored" });
  // Restored inactive and hidden: an admin switches it on deliberately.
  await db.prepare(`UPDATE taxonomy_categories SET archived_at = NULL, row_version = row_version + 1 WHERE id = ?`).run(row.id);
  await writeAudit({ actorUserId: req.user!.id, action: "taxonomy.restored", objectType: OBJECT, objectId: row.id });
  res.json(toJson((await loadTaxonomy()).byId.get(row.id)!));
});

adminCategoriesRouter.post("/:id/merge", requireAdminPermission("taxonomy.manage"), async (req, res) => {
  const { targetId } = req.body as { targetId?: string };
  const index = await loadTaxonomy();
  const source = index.byId.get(req.params.id);
  const target = targetId ? index.byId.get(targetId) : undefined;
  if (!source) return res.status(404).json({ error: "Category not found" });
  if (!target) return res.status(400).json({ error: "Choose the category to merge into", field: "targetId" });
  if (source.id === target.id) return res.status(400).json({ error: "Choose a different category", field: "targetId" });
  if (!!source.parent_id !== !!target.parent_id) return res.status(400).json({ error: "Merge a category into a category, or a subcategory into a subcategory", field: "targetId" });
  if (target.archived_at) return res.status(400).json({ error: "The target is archived", field: "targetId" });
  // Every listing type the source covers must be covered by the target, or listings would land in the wrong family.
  const missing = familiesOf(source).filter((f) => !familiesOf(target).includes(f));
  if (missing.length) return res.status(400).json({ error: `${target.name} doesn't cover ${missing.join(", ")}. Add those listing types to it first.`, field: "targetId" });

  const moved = await db.transaction(async (tx) => {
    let n: number;
    if (source.parent_id) {
      n = (await tx.prepare(`UPDATE listing_taxonomy SET subcategory_id = ?, category_id = ? WHERE subcategory_id = ?`).run(target.id, target.parent_id, source.id)).changes;
    } else {
      // The source's subcategories move with their listings to the target category.
      await tx.prepare(`UPDATE taxonomy_categories SET parent_id = ?, families = ?, row_version = row_version + 1 WHERE parent_id = ?`).run(target.id, target.families, source.id);
      n = (await tx.prepare(`UPDATE listing_taxonomy SET category_id = ? WHERE category_id = ?`).run(target.id, source.id)).changes;
    }
    await tx.prepare(`UPDATE taxonomy_aliases SET category_id = ? WHERE category_id = ?`).run(target.id, source.id);
    for (const alias of [normalizeAlias(source.slug), normalizeAlias(source.name)]) {
      await tx
        .prepare(`INSERT INTO taxonomy_aliases (alias_norm, category_id, source) VALUES (?, ?, 'merge') ON DUPLICATE KEY UPDATE category_id = VALUES(category_id), source = 'merge'`)
        .run(alias, target.id);
    }
    await tx.prepare(`UPDATE taxonomy_categories SET archived_at = UTC_TIMESTAMP(), active = 0, discoverable = 0, row_version = row_version + 1 WHERE id = ?`).run(source.id);
    return n;
  });
  await writeAudit({ actorUserId: req.user!.id, action: "taxonomy.merged", objectType: OBJECT, objectId: source.id, previousValue: toJson(source), newValue: { mergedInto: target.id, listingsMoved: moved } });
  await writeAudit({ actorUserId: req.user!.id, action: "taxonomy.merged_in", objectType: OBJECT, objectId: target.id, newValue: { from: source.id, listingsMoved: moved } });
  res.json({ ok: true, listingsMoved: moved, targetId: target.id });
});

adminCategoriesRouter.delete("/:id", requireAdminPermission("taxonomy.manage"), async (req, res) => {
  const index = await loadTaxonomy();
  const row = index.byId.get(req.params.id);
  if (!row) return res.status(404).json({ error: "Category not found" });
  const { n } = (await db.prepare(`SELECT COUNT(*) as n FROM listing_taxonomy WHERE category_id = ? OR subcategory_id = ?`).get(row.id, row.id)) as { n: number | string };
  if (Number(n) > 0) return res.status(409).json({ error: `${n} listing(s) use this category. Archive it or merge it instead.` });
  if ([...index.byId.values()].some((r) => r.parent_id === row.id)) return res.status(409).json({ error: "Delete or move its subcategories first" });
  if (index.aliases.some((a) => a.category_id === row.id && a.source === "merge")) return res.status(409).json({ error: "Merged categories redirect here. Archive it instead." });
  await db.transaction(async (tx) => {
    await tx.prepare(`DELETE FROM taxonomy_aliases WHERE category_id = ?`).run(row.id);
    await tx.prepare(`DELETE FROM taxonomy_categories WHERE id = ?`).run(row.id);
  });
  await writeAudit({ actorUserId: req.user!.id, action: "taxonomy.deleted", objectType: OBJECT, objectId: row.id, previousValue: toJson(row) });
  res.json({ ok: true });
});

adminCategoriesRouter.post("/:id/aliases", requireAdminPermission("taxonomy.manage"), async (req, res) => {
  const index = await loadTaxonomy();
  const row = index.byId.get(req.params.id);
  if (!row) return res.status(404).json({ error: "Category not found" });
  const { alias, needsReview } = req.body as { alias?: string; needsReview?: boolean };
  const norm = typeof alias === "string" ? normalizeAlias(alias).slice(0, 191) : "";
  if (!norm) return res.status(400).json({ error: "Enter an alias", field: "alias" });
  const existing = index.aliases.find((a) => a.alias_norm === norm);
  if (existing) return res.status(409).json({ error: `"${norm}" already points at ${index.byId.get(existing.category_id)?.name ?? existing.category_id}`, field: "alias" });
  await db.prepare(`INSERT INTO taxonomy_aliases (alias_norm, category_id, source, needs_review) VALUES (?, ?, 'synonym', ?)`).run(norm, row.id, needsReview ? 1 : 0);
  await writeAudit({ actorUserId: req.user!.id, action: "taxonomy.alias_added", objectType: OBJECT, objectId: row.id, newValue: { alias: norm, needsReview: !!needsReview } });
  res.status(201).json({ alias: norm, source: "synonym", needsReview: !!needsReview });
});

adminCategoriesRouter.delete("/:id/aliases/:alias", requireAdminPermission("taxonomy.manage"), async (req, res) => {
  const norm = normalizeAlias(req.params.alias);
  const alias = (await db.prepare(`SELECT source FROM taxonomy_aliases WHERE alias_norm = ? AND category_id = ?`).get(norm, req.params.id)) as { source: string } | undefined;
  if (!alias) return res.status(404).json({ error: "Alias not found" });
  if (alias.source === "merge") return res.status(409).json({ error: "This alias keeps a merged category's links working" });
  await db.prepare(`DELETE FROM taxonomy_aliases WHERE alias_norm = ? AND category_id = ?`).run(norm, req.params.id);
  await writeAudit({ actorUserId: req.user!.id, action: "taxonomy.alias_removed", objectType: OBJECT, objectId: req.params.id, previousValue: { alias: norm } });
  res.json({ ok: true });
});

/** Assign (or clear) one listing's category — Super, from the Uncategorised view or a category's listings. */
adminCategoriesRouter.put("/listings/:type/:id", requireAdminPermission("taxonomy.manage"), async (req, res) => {
  const type = req.params.type;
  if (!isTaxonomyListingType(type)) return res.status(400).json({ error: "Unknown listing type" });
  const exists = (await db.prepare(`SELECT id${type === "experience" ? ", kind" : ""} FROM ${listingTable(type)} WHERE id = ?`).get(req.params.id)) as { id: string; kind?: string } | undefined;
  if (!exists) return res.status(404).json({ error: "Listing not found" });
  const current = await getListingTaxonomy(type, req.params.id);
  const b = req.body as { categoryId?: unknown; subcategoryId?: unknown };
  let value;
  try {
    value = await validateAssignment(familyOf(type, exists.kind), b.categoryId ?? null, b.subcategoryId, current);
  } catch (e) {
    if (e instanceof TaxonomyValidationError) return res.status(400).json({ error: e.message, field: "categoryId" });
    throw e;
  }
  if (value === undefined) return res.status(400).json({ error: "categoryId is required (empty clears it)" });
  await setListingTaxonomy(type, req.params.id, value, "admin");
  await writeAudit({ actorUserId: req.user!.id, action: "taxonomy.listing_assigned", objectType: `${type}`, objectId: req.params.id, previousValue: current, newValue: value });
  res.json({ taxonomy: await getListingTaxonomy(type, req.params.id) });
});

/** Any admin (Support included) can flag a wrong classification; it lands in the normal reports queue. */
adminCategoriesRouter.post("/report", requireAdminPermission("taxonomy.view"), async (req, res) => {
  const { listingType, listingId, note } = req.body as { listingType?: string; listingId?: string; note?: string };
  if (!isTaxonomyListingType(listingType) || typeof listingId !== "string" || !listingId) return res.status(400).json({ error: "listingType and listingId are required" });
  const exists = await db.prepare(`SELECT id FROM ${listingTable(listingType)} WHERE id = ?`).get(listingId);
  if (!exists) return res.status(404).json({ error: "Listing not found" });
  const text = typeof note === "string" ? note.trim().slice(0, 1800) : "";
  await db.prepare(`INSERT INTO reports (target_type, target_id, reporter_client_id, reason) VALUES (?, ?, ?, ?)`).run(listingType, listingId, `admin:${req.user!.id}`, `Wrong category${text ? `: ${text}` : ""}`);
  await writeAudit({ actorUserId: req.user!.id, action: "taxonomy.classification_reported", objectType: listingType, objectId: listingId, newValue: { note: text } });
  res.status(201).json({ ok: true });
});

// Site-wide category switch (Admin → Settings → System status). Same shape
// as the Maps switch: anyone may read it, only platform.settings (Super, with
// a fresh two-step code) may change it, every change is audited. Off hides
// category navigation, pickers and category SEO pages; nothing is deleted.
export const categoriesConfigRouter = Router();

categoriesConfigRouter.get("/config/categories-enabled", requireAdminPermission("workspace.view"), async (_req, res) => {
  const enabled = (await getSetting("categories_enabled", "1")) === "1";
  const live = (await db.prepare(`SELECT COUNT(DISTINCT category_id) as n FROM listing_taxonomy`).get()) as { n: number | string };
  const total = (await db.prepare(`SELECT COUNT(*) as n FROM listing_taxonomy`).get()) as { n: number | string };
  res.json({ enabled, liveCategories: Number(live.n), categorisedListings: Number(total.n) });
});

categoriesConfigRouter.put("/config/categories-enabled", requireAdminPermission("platform.settings"), async (req, res) => {
  const { enabled } = req.body as { enabled?: unknown };
  if (typeof enabled !== "boolean") return res.status(400).json({ error: "enabled must be true or false" });
  const before = (await getSetting("categories_enabled", "1")) === "1";
  await setSetting("categories_enabled", enabled ? "1" : "0");
  await writeAudit({
    actorUserId: req.user!.id,
    action: "config.categories_enabled_changed",
    objectType: "app_settings",
    objectId: "categories_enabled",
    previousValue: { enabled: before },
    newValue: { enabled },
  });
  res.json({ enabled });
});
