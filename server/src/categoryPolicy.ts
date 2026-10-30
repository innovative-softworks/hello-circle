import { db } from "./db/index.js";
import { loadTaxonomy, TaxonomyValidationError, type CategoryRow, type PickerCategory, type TaxonomyIndex } from "./taxonomy.js";

// Configuration framework Phase E (docs/participation-expansion/15) — category
// governance on top of the EXISTING taxonomy (taxonomy_categories /
// listing_taxonomy; no new category table, no new ids).
//
// - Listing-type applicability stays `taxonomy_categories.families` (existing).
// - moderation_policy per category:
//     standard        — as today (new partner listings are reviewed on publish);
//     review_required — a partner moving an already-live listing into it flags
//                       the assignment for admin review in Categories (nothing is
//                       unpublished; D-A3);
//     eligible_only   — only organisations explicitly granted it may use it.
// - suggested_form per category: a form type key (Phase G builds the forms).
// - Organisation eligibility: organisations.category_mode 'all' (default, today's
//   behaviour) | 'restricted' (only granted categories), plus
//   org_category_access rows: subcategory_id '*' = the whole category; specific
//   rows without '*' restrict that category to those subcategories in either mode.
// - Existing assignments are never re-checked unless the category changes, so
//   a listing keeps a category its organisation can no longer choose (legacy).
// Relationships are validated here in code (no FKs, decision D-A1).

type Tx = Pick<typeof db, "prepare">;

export const MODERATION_POLICIES = ["standard", "review_required", "eligible_only"] as const;
export type ModerationPolicy = (typeof MODERATION_POLICIES)[number];
export const isModerationPolicy = (v: unknown): v is ModerationPolicy => typeof v === "string" && (MODERATION_POLICIES as readonly string[]).includes(v);

/** Form types a category can suggest (brief §10; Phase G gives each a template). */
export const FORM_TYPES = [
  { key: "event_registration", label: "Event registration" },
  { key: "activity_registration", label: "Activity registration" },
  { key: "programme_enrolment", label: "Programme enrolment" },
  { key: "club_registration", label: "Club registration" },
  { key: "experience_booking", label: "Experience booking" },
  { key: "venue_booking", label: "Venue or room booking" },
  { key: "volunteer_registration", label: "Volunteer registration" },
] as const;
export type FormTypeKey = (typeof FORM_TYPES)[number]["key"];
export const isFormType = (v: unknown): v is FormTypeKey => typeof v === "string" && FORM_TYPES.some((f) => f.key === v);

export const policyOf = (r: Pick<CategoryRow, "moderation_policy">): ModerationPolicy =>
  isModerationPolicy(r.moderation_policy) ? r.moderation_policy : "standard";

export interface OrgCategoryAccess {
  mode: "all" | "restricted";
  /** categoryId → '*' and/or subcategory ids. */
  grants: Map<string, Set<string>>;
}

export async function orgCategoryAccess(orgId: string | null, tx: Tx = db): Promise<OrgCategoryAccess> {
  if (!orgId) return { mode: "all", grants: new Map() };
  const org = (await tx.prepare(`SELECT category_mode FROM organisations WHERE id = ?`).get(orgId)) as { category_mode: string } | undefined;
  const grants = new Map<string, Set<string>>();
  for (const r of (await tx.prepare(`SELECT category_id, subcategory_id FROM org_category_access WHERE org_id = ?`).all(orgId)) as { category_id: string; subcategory_id: string }[]) {
    if (!grants.has(r.category_id)) grants.set(r.category_id, new Set());
    grants.get(r.category_id)!.add(r.subcategory_id);
  }
  return { mode: org?.category_mode === "restricted" ? "restricted" : "all", grants };
}

export async function accessForUser(userId: string): Promise<OrgCategoryAccess> {
  const row = (await db.prepare(`SELECT org_id FROM users WHERE id = ?`).get(userId)) as { org_id: string | null } | undefined;
  return orgCategoryAccess(row?.org_id ?? null);
}

/** Why an organisation can't choose this category (or subcategory); null = it can. */
export function categoryRefusal(access: OrgCategoryAccess, cat: CategoryRow, subId: string | null): string | null {
  const g = access.grants.get(cat.id);
  if (policyOf(cat) === "eligible_only" && !g) return `${cat.name} is only available to organisations HelloCircle has approved for it`;
  if (access.mode === "restricted" && !g) return `${cat.name} isn't one of your organisation's categories`;
  if (g && !g.has("*")) {
    if (!subId) return `Choose one of the ${cat.name} subcategories your organisation can use`;
    if (!g.has(subId)) return `That ${cat.name} subcategory isn't available to your organisation`;
  }
  return null;
}

/** The partner picker, narrowed to what the organisation may choose. */
export function filterPicker(options: PickerCategory[], access: OrgCategoryAccess, index: TaxonomyIndex): PickerCategory[] {
  return options
    .map((o) => {
      const cat = index.byId.get(o.id);
      if (!cat) return null;
      const g = access.grants.get(o.id);
      if (policyOf(cat) === "eligible_only" && !g) return null;
      if (access.mode === "restricted" && !g) return null;
      const subs = g && !g.has("*") ? o.subcategories.filter((s) => g.has(s.id)) : o.subcategories;
      if (g && !g.has("*") && subs.length === 0) return null;
      return { ...o, subcategories: subs, subcategoryRequired: !!g && !g.has("*") };
    })
    .filter((o): o is PickerCategory & { subcategoryRequired: boolean } => o !== null);
}

/**
 * Server-side eligibility for a partner's category choice. Only a CHANGE is
 * checked: a listing keeps a category it already has even if its organisation
 * can no longer choose it (legacy listings, D-A3 spirit).
 */
export async function assertOrgMayAssign(
  userId: string,
  value: { categoryId: string; subcategoryId: string | null } | null | undefined,
  current: { categoryId: string; subcategoryId: string | null } | null
): Promise<void> {
  if (!value) return;
  if (current && current.categoryId === value.categoryId && current.subcategoryId === value.subcategoryId) return;
  const index = await loadTaxonomy();
  const cat = index.byId.get(value.categoryId);
  if (!cat) throw new TaxonomyValidationError("Unknown category");
  const refusal = categoryRefusal(await accessForUser(userId), cat, value.subcategoryId);
  if (refusal) throw new TaxonomyValidationError(refusal);
}

/** review_required: flag a live listing that a partner moved into the category. */
export async function flagIfReviewRequired(type: string, id: string, listingStatus: string | null, value: { categoryId: string } | null | undefined, previous: { categoryId: string } | null): Promise<boolean> {
  if (!value || previous?.categoryId === value.categoryId || listingStatus !== "approved") return false;
  const cat = (await loadTaxonomy()).byId.get(value.categoryId);
  if (!cat || policyOf(cat) !== "review_required") return false;
  await db.prepare(`UPDATE listing_taxonomy SET needs_review = 1 WHERE listing_type = ? AND listing_id = ?`).run(type, id);
  return true;
}

// --- admin changes ----------------------------------------------------------------

export class CategoryAccessError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

/** Validates { mode, grants: [{ categoryId, subcategoryIds?: string[] | '*' }] } against the taxonomy. */
export function cleanAccess(raw: unknown, index: TaxonomyIndex): { mode: "all" | "restricted"; rows: { categoryId: string; subcategoryId: string }[] } {
  const b = (raw ?? {}) as { mode?: unknown; grants?: unknown };
  if (b.mode !== "all" && b.mode !== "restricted") throw new CategoryAccessError("Choose all categories or only chosen ones");
  if (!Array.isArray(b.grants)) throw new CategoryAccessError("Send the list of categories");
  const rows: { categoryId: string; subcategoryId: string }[] = [];
  const seen = new Set<string>();
  for (const g of b.grants as { categoryId?: unknown; subcategoryIds?: unknown }[]) {
    const cat = typeof g?.categoryId === "string" ? index.byId.get(g.categoryId) : undefined;
    if (!cat || cat.parent_id) throw new CategoryAccessError(`Unknown category ${String(g?.categoryId)}`);
    if (seen.has(cat.id)) throw new CategoryAccessError(`${cat.name} is listed twice`);
    seen.add(cat.id);
    if (g.subcategoryIds === undefined || g.subcategoryIds === "*") {
      rows.push({ categoryId: cat.id, subcategoryId: "*" });
      continue;
    }
    if (!Array.isArray(g.subcategoryIds) || g.subcategoryIds.length === 0) throw new CategoryAccessError(`${cat.name}: choose at least one subcategory, or the whole category`);
    for (const s of g.subcategoryIds) {
      const sub = typeof s === "string" ? index.byId.get(s) : undefined;
      if (!sub || sub.parent_id !== cat.id) throw new CategoryAccessError(`${cat.name}: ${String(s)} isn't one of its subcategories`);
      rows.push({ categoryId: cat.id, subcategoryId: sub.id });
    }
  }
  if (b.mode === "restricted" && rows.length === 0) throw new CategoryAccessError("An organisation limited to chosen categories needs at least one");
  return { mode: b.mode, rows };
}

/** Listings per category this organisation already has (shown before narrowing). */
export async function orgCategoryUsage(orgId: string): Promise<Record<string, number>> {
  const rows = (await db
    .prepare(
      `SELECT lt.category_id AS c, COUNT(*) AS n FROM listing_taxonomy lt
       LEFT JOIN centres ce ON lt.listing_type = 'centre' AND ce.id = lt.listing_id
       LEFT JOIN clubs cl ON lt.listing_type = 'club' AND cl.id = lt.listing_id
       LEFT JOIN programs p ON lt.listing_type = 'program' AND p.id = lt.listing_id
       LEFT JOIN experiences e ON lt.listing_type = 'experience' AND e.id = lt.listing_id
       JOIN users u ON u.id = COALESCE(ce.vendor_id, cl.vendor_id, p.vendor_id, e.vendor_id)
       WHERE u.org_id = ? GROUP BY lt.category_id`
    )
    .all(orgId)) as { c: string; n: number }[];
  return Object.fromEntries(rows.map((r) => [r.c, Number(r.n)]));
}

/** Integrity (D-A1): organisation grants that point at nothing, or at the wrong parent. */
export async function categoryAccessIssues(index?: TaxonomyIndex): Promise<{ kind: string; detail: string }[]> {
  const ix = index ?? (await loadTaxonomy());
  const out: { kind: string; detail: string }[] = [];
  const rows = (await db.prepare(`SELECT a.org_id, a.category_id, a.subcategory_id, o.id AS org FROM org_category_access a LEFT JOIN organisations o ON o.id = a.org_id`).all()) as { org_id: string; category_id: string; subcategory_id: string; org: string | null }[];
  for (const r of rows) {
    if (!r.org) out.push({ kind: "access_unknown_org", detail: `Category access for missing organisation ${r.org_id}` });
    const cat = ix.byId.get(r.category_id);
    if (!cat || cat.parent_id) out.push({ kind: "access_unknown_category", detail: `Organisation ${r.org_id} is granted missing category ${r.category_id}` });
    else if (r.subcategory_id !== "*" && ix.byId.get(r.subcategory_id)?.parent_id !== cat.id) out.push({ kind: "access_subcategory_mismatch", detail: `${r.subcategory_id} isn't under ${r.category_id}` });
  }
  for (const c of ix.byId.values()) {
    const f = c.suggested_form;
    if (f && !isFormType(f)) out.push({ kind: "unknown_form", detail: `${c.id} suggests unknown form ${f}` });
  }
  return out;
}

