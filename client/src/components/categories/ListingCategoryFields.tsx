import { useEffect, useState } from "react";
import { fetchVendorClassification, saveVendorClassification, type CategoryFamily, type ListingTaxonomy, type VendorClassifiableType } from "../../api";
import { CategoryPicker, TagPicker, type CategoryValue } from "./CategoryPicker";

// Category system — the category + tags fields inside partner CREATION flows
// (venue, club and experience wizards, the programme create form). The
// values live in the wizard's own form state (so its draft handling covers
// them) and are stored through the same /vendor/classification endpoint the
// editors use, right after the draft listing is created or updated. One
// listing_taxonomy row per listing (primary key), so saving again replaces
// rather than duplicates.

export interface ListingCategoryDraft {
  category: CategoryValue | null;
  /** Name of the picked category — written to the legacy free-text field where one exists. */
  categoryName: string | null;
  tags: string[];
}

export const emptyCategoryDraft = (): ListingCategoryDraft => ({ category: null, categoryName: null, tags: [] });

/** Loads an existing draft listing's saved classification when a wizard resumes. */
export function useSavedClassification(type: VendorClassifiableType, id: string | null, onLoaded: (draft: ListingCategoryDraft, current: ListingTaxonomy | null) => void) {
  const [current, setCurrent] = useState<ListingTaxonomy | null>(null);
  useEffect(() => {
    if (!id || id === "new") return;
    let live = true;
    fetchVendorClassification(type, id)
      .then((d) => {
        if (!live) return;
        setCurrent(d.taxonomy);
        // Only a real saved classification replaces the form's values. Right
        // after a wizard creates its draft the id changes and this runs; if
        // the category save just failed the server has nothing yet, and an
        // empty result must not wipe what the person chose (they retry it).
        if (!d.taxonomy && d.tags.length === 0) return;
        onLoaded({ category: d.taxonomy ? { categoryId: d.taxonomy.categoryId, subcategoryId: d.taxonomy.subcategoryId } : null, categoryName: d.taxonomy?.categoryName ?? null, tags: d.tags }, d.taxonomy);
      })
      .catch(() => undefined); // the editor still works; the fields just start empty
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, id]);
  return current;
}

/** Stores the draft's category + tags on the listing. Throws the server's message (e.g. "isn't available for this kind of listing"). */
export async function saveListingCategory(type: VendorClassifiableType, id: string, draft: ListingCategoryDraft): Promise<void> {
  await saveVendorClassification(type, id, { categoryId: draft.category?.categoryId ?? null, subcategoryId: draft.category?.subcategoryId ?? null, tags: draft.tags });
}

export function ListingCategoryFields({
  family,
  value,
  onChange,
  current,
  hint = "Where people find this when they browse by activity. You can change it later.",
  label = "Category",
  error,
}: {
  family: CategoryFamily;
  value: ListingCategoryDraft;
  onChange: (next: ListingCategoryDraft) => void;
  current?: ListingTaxonomy | null;
  hint?: string;
  label?: string;
  error?: string;
}) {
  return (
    <div style={{ display: "grid", gap: 14 }}>
      <CategoryPicker
        family={family}
        scope="partner"
        label={label}
        hint={hint}
        value={value.category}
        current={current}
        error={error}
        onChange={(category, picked) => onChange({ ...value, category, categoryName: category ? picked?.categoryName ?? value.categoryName : null })}
      />
      <TagPicker value={value.tags} onChange={(tags) => onChange({ ...value, tags })} />
    </div>
  );
}
