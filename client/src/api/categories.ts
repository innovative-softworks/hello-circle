import type { ListingTaxonomy } from "../types";
import { request } from "./core";

// Category system (approved 2026-10-22) — public reads, form options, the
// vendor classification editor and admin Categories. Mirrors
// server/src/taxonomy.ts + routes/categories.ts + routes/adminCategories.ts
// by hand (no shared types package with the server — see CLAUDE.md).

export type CategoryFamily = "activity" | "experience" | "volunteer" | "programme" | "circle" | "club" | "venue";
export type TaxonomyListingType = "game" | "experience" | "program" | "circle" | "club" | "centre";

export const DISCOVERY_TAGS = ["indoor", "outdoor", "evening", "weekend", "tournament", "festival", "fundraiser", "seasonal", "women_only", "over_50s"] as const;
export type DiscoveryTag = (typeof DISCOVERY_TAGS)[number];
export const DISCOVERY_TAG_LABELS: Record<DiscoveryTag, string> = {
  indoor: "Indoor",
  outdoor: "Outdoor",
  evening: "Evening",
  weekend: "Weekend",
  tournament: "Tournament",
  festival: "Festival",
  fundraiser: "Fundraiser",
  seasonal: "Seasonal",
  women_only: "Women only",
  over_50s: "Over 50s",
};

export const FAMILY_LABELS: Record<CategoryFamily, string> = {
  activity: "Activities",
  experience: "Experiences & adventures",
  volunteer: "Volunteering",
  programme: "Programmes",
  circle: "Circles",
  club: "Clubs",
  venue: "Venues",
};

/** The classification a public detail response carries (`taxonomy`). */
export type { ListingTaxonomy };

export interface PublicCategory {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  icon: string | null;
  imageUrl: string | null;
  families: CategoryFamily[];
  count: number;
  featured: boolean;
  seoTitle: string | null;
  seoDescription: string | null;
  subcategories: { id: string; slug: string; name: string; count: number }[];
}

export interface PickerCategory {
  id: string;
  name: string;
  description: string | null;
  icon: string | null;
  subcategories: { id: string; name: string }[];
}

export interface CategoryOptions {
  enabled: boolean;
  categories: PickerCategory[];
  tags: DiscoveryTag[];
}

/** Live categories (with inventory) for a family, or across every family. */
export function fetchCategories(family?: CategoryFamily, experienceKind?: "adventure" | "experience" | "event"): Promise<PublicCategory[]> {
  const qs = new URLSearchParams();
  if (family) qs.set("family", family);
  if (experienceKind) qs.set("kind", experienceKind);
  const s = qs.toString();
  return request(`/categories${s ? `?${s}` : ""}`);
}

export function fetchCategoryOptions(family: CategoryFamily): Promise<CategoryOptions> {
  return request(`/categories/options?family=${family}`);
}

// --- Vendor ---------------------------------------------------------------------

export type VendorClassifiableType = "program" | "experience" | "club" | "centre";

export interface VendorClassification {
  family: CategoryFamily;
  taxonomy: ListingTaxonomy | null;
  tags: DiscoveryTag[];
  options: PickerCategory[];
}

export function fetchVendorClassification(type: VendorClassifiableType, id: string): Promise<VendorClassification> {
  return request(`/vendor/classification/${type}/${encodeURIComponent(id)}`);
}

export function saveVendorClassification(
  type: VendorClassifiableType,
  id: string,
  input: { categoryId: string | null; subcategoryId: string | null; tags: string[] }
): Promise<{ taxonomy: ListingTaxonomy | null; tags: DiscoveryTag[] }> {
  return request(`/vendor/classification/${type}/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(input) });
}

// --- Admin ----------------------------------------------------------------------

export interface AdminCategory {
  id: string;
  parentId: string | null;
  name: string;
  slug: string;
  description: string | null;
  families: CategoryFamily[];
  icon: string | null;
  imageUrl: string | null;
  sortOrder: number;
  active: boolean;
  discoverable: boolean;
  featured: boolean;
  archived: boolean;
  archivedAt: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  rowVersion: number;
  createdAt: string;
  updatedAt: string;
  listingCount: number;
}

export interface AdminCategoryDirectory {
  families: CategoryFamily[];
  categories: (AdminCategory & { subcategories: AdminCategory[] })[];
  uncategorised: Record<TaxonomyListingType, number>;
}

export interface AdminCategoryDetail {
  category: AdminCategory;
  parent: AdminCategory | null;
  subcategories: AdminCategory[];
  aliases: { alias: string; source: string; needsReview: boolean }[];
  listings: { listingType: TaxonomyListingType; listingId: string; title: string; status: string; subcategoryId: string | null; subcategoryName: string | null; assignedBy: string; assignedAt: string }[];
  history: { id: number; action: string; previousValue: string | null; newValue: string | null; reason: string | null; createdAt: string; actorName: string | null }[];
}

export interface UncategorisedListing {
  listingType: TaxonomyListingType;
  listingId: string;
  family: CategoryFamily;
  title: string;
  status: string;
  reason: "ambiguous" | "no_match";
  candidates: { id: string; name: string }[];
  suggestion: string | null;
  existingLabel?: string;
  suggestionName?: string | null;
  suggestedSubcategory?: string | null;
  suggestedSubcategoryName?: string | null;
  confidence?: "medium" | "low" | "none";
  explanation?: string;
  needsApproval?: boolean;
}

export interface AdminCategoryInput {
  name?: string;
  id?: string;
  parentId?: string | null;
  description?: string | null;
  families?: CategoryFamily[];
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

export function fetchAdminCategories(): Promise<AdminCategoryDirectory> {
  return request(`/admin/categories`);
}
export function fetchAdminCategory(id: string): Promise<AdminCategoryDetail> {
  return request(`/admin/categories/${encodeURIComponent(id)}`);
}
export function fetchUncategorisedListings(type?: TaxonomyListingType): Promise<UncategorisedListing[]> {
  return request(`/admin/categories/uncategorised${type ? `?type=${type}` : ""}`);
}
export function fetchTaxonomyIntegrity(): Promise<{ kind: string; listingType?: string; listingId?: string; categoryId?: string; detail: string }[]> {
  return request(`/admin/categories/integrity`);
}
export function createAdminCategory(input: AdminCategoryInput): Promise<AdminCategory> {
  return request(`/admin/categories`, { method: "POST", body: JSON.stringify(input) });
}
export function updateAdminCategory(id: string, input: AdminCategoryInput): Promise<AdminCategory> {
  return request(`/admin/categories/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(input) });
}
export function reorderAdminCategories(parentId: string | null, ids: string[]): Promise<{ ok: true }> {
  return request(`/admin/categories/reorder`, { method: "POST", body: JSON.stringify({ parentId, ids }) });
}
export function archiveAdminCategory(id: string): Promise<AdminCategory> {
  return request(`/admin/categories/${encodeURIComponent(id)}/archive`, { method: "POST" });
}
export function restoreAdminCategory(id: string): Promise<AdminCategory> {
  return request(`/admin/categories/${encodeURIComponent(id)}/restore`, { method: "POST" });
}
export function mergeAdminCategory(id: string, targetId: string): Promise<{ ok: true; listingsMoved: number; targetId: string }> {
  return request(`/admin/categories/${encodeURIComponent(id)}/merge`, { method: "POST", body: JSON.stringify({ targetId }) });
}
export function deleteAdminCategory(id: string): Promise<{ ok: true }> {
  return request(`/admin/categories/${encodeURIComponent(id)}`, { method: "DELETE" });
}
export function addCategoryAlias(id: string, alias: string, needsReview = false): Promise<{ alias: string }> {
  return request(`/admin/categories/${encodeURIComponent(id)}/aliases`, { method: "POST", body: JSON.stringify({ alias, needsReview }) });
}
export function removeCategoryAlias(id: string, alias: string): Promise<{ ok: true }> {
  return request(`/admin/categories/${encodeURIComponent(id)}/aliases/${encodeURIComponent(alias)}`, { method: "DELETE" });
}
export function assignListingCategory(type: TaxonomyListingType, id: string, categoryId: string | null, subcategoryId: string | null): Promise<{ taxonomy: ListingTaxonomy | null }> {
  return request(`/admin/categories/listings/${type}/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify({ categoryId: categoryId ?? "", subcategoryId }) });
}
export function reportListingCategory(listingType: TaxonomyListingType, listingId: string, note: string): Promise<{ ok: true }> {
  return request(`/admin/categories/report`, { method: "POST", body: JSON.stringify({ listingType, listingId, note }) });
}

/** Admin → Settings: the site-wide category switch (app_settings.categories_enabled). */
export function fetchCategoriesEnabled(): Promise<{ enabled: boolean; liveCategories: number; categorisedListings: number }> {
  return request(`/admin/config/categories-enabled`);
}
export function setCategoriesEnabled(enabled: boolean): Promise<{ enabled: boolean }> {
  return request(`/admin/config/categories-enabled`, { method: "PUT", body: JSON.stringify({ enabled }) });
}
