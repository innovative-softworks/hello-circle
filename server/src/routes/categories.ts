import { Router } from "express";
import { getSetting } from "../db/index.js";
import { DISCOVERY_TAGS, isFamily, listPublicCategories, loadTaxonomy, normalizeAlias, pickerOptions } from "../taxonomy.js";

// Public category reads (docs/hellocircle-category-architecture.md §2).
// Only active + discoverable categories with live inventory (or featured)
// are listed; counts reuse each family's own public visibility rules.
export const categoriesRouter = Router();

categoriesRouter.get("/", async (req, res) => {
  const family = req.query.family;
  if (family !== undefined && !isFamily(family)) return res.status(400).json({ error: "Unknown family" });
  const kind = req.query.kind === "adventure" || req.query.kind === "experience" ? req.query.kind : undefined;
  res.setHeader("Cache-Control", "public, max-age=60");
  res.json(await listPublicCategories(family ?? null, kind));
});

/** Selectable options for host/vendor forms — active categories valid for the family. */
categoriesRouter.get("/options", async (req, res) => {
  const family = req.query.family;
  if (!isFamily(family)) return res.status(400).json({ error: "family is required" });
  const enabled = (await getSetting("categories_enabled", "1")) === "1";
  res.json({ enabled, categories: enabled ? await pickerOptions(family) : [], tags: DISCOVERY_TAGS });
});

/** One live category by slug (or a merged slug, which answers with `redirectTo`). */
categoriesRouter.get("/:slug", async (req, res) => {
  const family = req.query.family;
  if (family !== undefined && !isFamily(family)) return res.status(400).json({ error: "Unknown family" });
  const slug = req.params.slug;
  const live = await listPublicCategories(family ?? null);
  const hit = live.find((c) => c.slug === slug) ?? null;
  if (hit) return res.json(hit);
  const sub = live.find((c) => c.subcategories.some((s) => s.slug === slug));
  if (sub) return res.json({ ...sub, subcategory: sub.subcategories.find((s) => s.slug === slug) });
  // Merged/renamed slug → tell the client where it lives now (it rewrites the URL).
  const index = await loadTaxonomy();
  const alias = index.aliases.find((a) => a.alias_norm === normalizeAlias(slug) && a.source === "merge");
  const target = alias ? index.byId.get(alias.category_id) : undefined;
  if (target && target.slug !== slug) return res.json({ redirectTo: target.slug, parentSlug: target.parent_id ? index.byId.get(target.parent_id)?.slug ?? null : null });
  res.status(404).json({ error: "Category not found" });
});
