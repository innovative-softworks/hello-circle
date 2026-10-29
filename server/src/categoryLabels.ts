import { familyOf, getListingTaxonomyMany, loadTaxonomy, matchLabel, type TaxonomyIndex, type TaxonomyListingType } from "./taxonomy.js";

/** The big word over a listing card's photo (owner, 2026-10-28). `source`
 * says how it was found: "assigned" = the listing's own category;
 * "title" = the listing names exactly one live category in its own title,
 * by the same alias rules the category backfill trusts (never an ambiguous
 * or review-only word). Display only — filters and counts use assigned
 * categories, and nothing is written. null when neither applies. */
export interface CategoryLabel {
  name: string;
  sub: string | null;
  source: "assigned" | "title";
}

type Labelled<T> = T & { category: CategoryLabel | null };

/** Adds `category` to each row (search and feed results). */
export async function withCategoryLabels<T>(rows: T[], ref: (row: T) => { type: TaxonomyListingType; id: string } | null): Promise<Labelled<T>[]> {
  const labels = await categoryLabelsFor(rows, ref);
  return rows.map((row, i) => ({ ...row, category: labels[i] }));
}

/** Adds `categoryLabel` to each row — for list endpoints whose rows already
 * have a free-text `category` field of their own (programmes). */
export async function withCardLabels<T>(rows: T[], ref: (row: T) => { type: TaxonomyListingType; id: string } | null): Promise<(T & { categoryLabel: CategoryLabel | null })[]> {
  const labels = await categoryLabelsFor(rows, ref);
  return rows.map((row, i) => ({ ...row, categoryLabel: labels[i] }));
}

/** One label per row, looked up once per listing type. `ref` says which
 * listing a row belongs to; rows it can't place get null. */
async function categoryLabelsFor<T>(rows: T[], ref: (row: T) => { type: TaxonomyListingType; id: string } | null): Promise<(CategoryLabel | null)[]> {
  const byType = new Map<TaxonomyListingType, Set<string>>();
  for (const row of rows) {
    const r = ref(row);
    if (!r) continue;
    if (!byType.has(r.type)) byType.set(r.type, new Set());
    byType.get(r.type)!.add(r.id);
  }
  const found = new Map<string, CategoryLabel>();
  for (const [type, ids] of byType) {
    const tax = await getListingTaxonomyMany(type, [...ids]);
    for (const [id, t] of tax) if (t.active) found.set(`${type}:${id}`, { name: t.categoryName, sub: t.subcategoryName, source: "assigned" });
  }
  let index: TaxonomyIndex | null = null;
  const out: (CategoryLabel | null)[] = [];
  for (const row of rows) {
    const r = ref(row);
    let label = r ? found.get(`${r.type}:${r.id}`) ?? null : null;
    if (!label && r) {
      index ??= await loadTaxonomy();
      label = titleLabel(index, r.type, row as RowText);
    }
    out.push(label);
  }
  return out;
}

type RowText = { title?: unknown; activityLabel?: unknown; name?: unknown; kind?: unknown; experienceKind?: unknown };

function titleLabel(index: TaxonomyIndex, type: TaxonomyListingType, row: RowText): CategoryLabel | null {
  const text = [row.title, row.activityLabel, row.name].find((v): v is string => typeof v === "string" && v.trim() !== "");
  if (!text) return null;
  const kind = typeof row.experienceKind === "string" ? row.experienceKind : typeof row.kind === "string" ? row.kind : null;
  const m = matchLabel(index, text, familyOf(type, kind));
  if (m.status !== "matched" || !m.categoryId) return null;
  const live = (id: string | null) => {
    const c = id ? index.byId.get(id) : undefined;
    return c && Number(c.active) === 1 && !c.archived_at ? c : undefined;
  };
  const cat = live(m.categoryId);
  if (!cat) return null;
  return { name: cat.name, sub: live(m.subcategoryId)?.name ?? null, source: "title" };
}

/** Where a feed/search activity points: its parent game, programme, club or experience. */
export function activityRef(item: { listingType?: string; listingId?: string }): { type: TaxonomyListingType; id: string } | null {
  const t = item.listingType;
  if (!item.listingId || (t !== "game" && t !== "program" && t !== "club" && t !== "experience")) return null;
  return { type: t, id: item.listingId };
}
