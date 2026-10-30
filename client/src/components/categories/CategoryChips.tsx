import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { DISCOVERY_TAG_LABELS, fetchCategories, type CategoryFamily, type DiscoveryTag, type ListingTaxonomy, type PublicCategory } from "../../api";
import { colors } from "../../theme";
import { Chip } from "../Chip";
import { DropdownCheckbox, DropdownOption, FilterDropdown } from "../FilterDropdown";

// Category system — public discovery. One hook + chips shared by every list
// page. URL state: ?category=<slug>&sub=<slug> (query parameters only, per
// the approved URL decision). An old ?category=<activity label> link that
// isn't a category slug keeps working as the legacy label filter.

export interface CategoryFilterState {
  /** Live categories for this family (only ones with public inventory). */
  categories: PublicCategory[];
  loaded: boolean;
  /** The selected category, when the URL names a real category slug. */
  selected: PublicCategory | null;
  /** Every chosen subcategory (Refine sidebars allow several: ?sub=a,b). */
  selectedSubs: PublicCategory["subcategories"];
  /** Slugs of `selectedSubs`; serverParams carries one only when exactly one is chosen. */
  subSlugs: string[];
  /** Adds or removes one subcategory, keeping the others. */
  toggleSub: (slug: string) => void;
  /** The selected subcategory, when exactly one is chosen and it belongs to `selected`. */
  selectedSub: PublicCategory["subcategories"][number] | null;
  /** A ?category= value that isn't a category slug (pre-taxonomy activity label). */
  legacyLabel: string | null;
  /** Changing the category always resets the subcategory. */
  setCategory: (slug: string | null) => void;
  setSub: (slug: string | null) => void;
  /** Params for the list endpoint (empty when nothing is selected). */
  serverParams: { categorySlug?: string; subcategorySlug?: string };
  /** "Racket sports › Badminton" for headings, chips and empty states. */
  label: string | null;
}

/** The short word the Bold typography card sets over the photo (owner,
 * 2026-10-23): the chosen subcategory ("Hiking"), else the category's first
 * part ("Outdoors & adventure" → "Outdoors"), else a legacy label. */
export function categoryWord(state: Pick<CategoryFilterState, "selected" | "selectedSub" | "legacyLabel">): string | null {
  if (state.selectedSub) return state.selectedSub.name;
  if (state.selected) return state.selected.name.split(/\s+&\s+|,\s*/)[0];
  return state.legacyLabel;
}

export function useCategoryFilter(family: CategoryFamily | "all" | null, opts: { param?: string; subParam?: string; experienceKind?: "adventure" | "experience" | "event" } = {}): CategoryFilterState {
  const param = opts.param ?? "category";
  const subParam = opts.subParam ?? "sub";
  const [params, setParams] = useSearchParams();
  const [categories, setCategories] = useState<PublicCategory[]>([]);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let live = true;
    if (!family) {
      setLoaded(true);
      return;
    }
    fetchCategories(family === "all" ? undefined : family, opts.experienceKind)
      .then((c) => live && setCategories(c))
      .catch(() => live && setCategories([]))
      .finally(() => live && setLoaded(true));
    return () => {
      live = false;
    };
  }, [family, opts.experienceKind]);

  const raw = params.get(param);
  const rawSub = params.get(subParam);
  const selected = useMemo(() => (raw ? categories.find((c) => c.slug === raw) ?? null : null), [raw, categories]);
  const selectedSubs = useMemo(() => {
    if (!selected || !rawSub) return [];
    const want = new Set(rawSub.split(",").filter(Boolean));
    return selected.subcategories.filter((s) => want.has(s.slug));
  }, [selected, rawSub]);
  const selectedSub = selectedSubs.length === 1 ? selectedSubs[0] : null;
  const subSlugs = selectedSubs.map((s) => s.slug);
  // Until the list loads we can't tell a slug from a legacy label; a value
  // that looks like a slug is treated as one so the page doesn't flash.
  const looksLikeSlug = !!raw && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(raw);
  const legacyLabel = raw && raw !== "All" && !selected && (loaded ? true : !looksLikeSlug) ? raw : null;

  const update = (mut: (p: URLSearchParams) => void) =>
    setParams((prev) => {
      const p = new URLSearchParams(prev);
      mut(p);
      return p;
    });
  const setCategory = (slug: string | null) =>
    update((p) => {
      if (slug) p.set(param, slug);
      else p.delete(param);
      p.delete(subParam);
    });
  const setSub = (slug: string | null) =>
    update((p) => {
      if (slug) p.set(subParam, slug);
      else p.delete(subParam);
    });

  const toggleSub = (slug: string) =>
    update((p) => {
      const cur = (p.get(subParam) ?? "").split(",").filter(Boolean);
      const next = cur.includes(slug) ? cur.filter((x) => x !== slug) : [...cur, slug];
      if (next.length) p.set(subParam, next.join(","));
      else p.delete(subParam);
    });

  const serverParams = selected
    ? { categorySlug: selected.slug, ...(selectedSub ? { subcategorySlug: selectedSub.slug } : {}) }
    : !loaded && looksLikeSlug && raw
      ? { categorySlug: raw, ...(rawSub && !rawSub.includes(",") ? { subcategorySlug: rawSub } : {}) }
      : {};
  const label = selected ? (selectedSubs.length ? `${selected.name} › ${selectedSubs.map((s) => s.name).join(", ")}` : selected.name) : null;
  return { categories, loaded, selected, selectedSub, selectedSubs, subSlugs, toggleSub, legacyLabel, setCategory, setSub, serverParams, label };
}

/** Horizontal category chips, then the selected category's subcategory chips. Scrolls on phones. */
export function CategoryChips({
  state,
  showCounts = true,
  limit,
  subChips = true,
}: {
  state: CategoryFilterState;
  showCounts?: boolean;
  limit?: number;
  /** false when the page lists the types in its Refine sidebar instead
   * (owner, 2026-10-23: browse pages keep one chip row). */
  subChips?: boolean;
}) {
  const { selected, selectedSub, setCategory, setSub } = state;
  // `limit`: the most-listed categories only (the selected one always stays),
  // so a hub page never opens with a long category directory.
  const categories = limit
    ? [...state.categories].sort((a, b) => b.count - a.count).filter((c, i) => i < limit || c.id === selected?.id)
    : state.categories;
  if (categories.length === 0) return null;
  const count = (n: number) => (showCounts ? <span style={{ opacity: 0.7, fontWeight: 500, marginLeft: 6 }}>{n}</span> : null);
  return (
    <div role="group" aria-label="Filter by category" style={{ display: "grid", gap: 8, marginBottom: 8 }}>
      <div className="chips-scroll-mobile" style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
        <Chip label="All" active={!selected} onClick={() => setCategory(null)} />
        {categories.map((c) => (
          <Chip
            key={c.id}
            label={
              <>
                {c.name}
                {count(c.count)}
              </>
            }
            active={selected?.id === c.id}
            onClick={() => setCategory(selected?.id === c.id ? null : c.slug)}
          />
        ))}
      </div>
      {subChips && selected && selected.subcategories.length > 1 && (
        <div className="chips-scroll-mobile" role="group" aria-label={`${selected.name} types`} style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
          <Chip label={`All ${selected.name.toLowerCase()}`} active={!selectedSub} onClick={() => setSub(null)} padding="6px 12px" fontSize={13} />
          {selected.subcategories.map((s) => (
            <Chip
              key={s.id}
              label={
                <>
                  {s.name}
                  {count(s.count)}
                </>
              }
              active={selectedSub?.id === s.id}
              onClick={() => setSub(selectedSub?.id === s.id ? null : s.slug)}
              padding="6px 12px"
              fontSize={13}
            />
          ))}
        </div>
      )}
      <span className="visually-hidden" role="status" aria-live="polite">
        {state.label ? `Showing ${state.label}` : ""}
      </span>
    </div>
  );
}

/** Every category as one dropdown, biggest first, with counts — Explore's
 * toolbar instead of a chip row (owner, 2026-10-28). The label is the chosen
 * category's name, or "Category". */
export function CategoryDropdown({ state, floating }: { state: CategoryFilterState; floating?: boolean }) {
  const { selected, setCategory } = state;
  if (state.categories.length === 0) return null;
  const byCount = [...state.categories].sort((a, b) => b.count - a.count);
  return (
    <FilterDropdown label={<span>{selected ? selected.name : "Category"}</span>} active={!!selected} closeOnSelect floating={floating}>
      <DropdownOption label="All categories" active={!selected} onClick={() => setCategory(null)} />
      {byCount.map((c) => (
        <DropdownOption
          key={c.id}
          label={<span style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>{c.name}<span style={{ color: colors.mutedLight, fontWeight: 500 }}>{c.count}</span></span>}
          active={selected?.id === c.id}
          onClick={() => setCategory(c.slug)}
        />
      ))}
    </FilterDropdown>
  );
}

/** The chosen category's types as one dropdown ("Type: Hiking") — Explore's
 * results bar, instead of a second chip row. Nothing when there's no choice. */
export function CategoryTypeDropdown({ state }: { state: CategoryFilterState }) {
  const { selected, selectedSub, setSub } = state;
  if (!selected || selected.subcategories.length <= 1) return null;
  return (
    <FilterDropdown label={selectedSub ? `Type: ${selectedSub.name}` : "Type"} active={!!selectedSub} closeOnSelect>
      <DropdownOption label={`All ${selected.name.toLowerCase()}`} active={!selectedSub} onClick={() => setSub(null)} />
      {selected.subcategories.map((s) => (
        <DropdownOption
          key={s.id}
          label={<span style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>{s.name}<span style={{ color: colors.mutedLight, fontWeight: 500 }}>{s.count}</span></span>}
          active={selectedSub?.id === s.id}
          onClick={() => setSub(s.slug)}
        />
      ))}
    </FilterDropdown>
  );
}

/** Whether the Refine sidebar should show a Type group. */
export function hasCategoryTypes(state: CategoryFilterState): boolean {
  return !!state.selected && state.selected.subcategories.length > 1;
}

/** The chosen category's types (subcategories) as Refine-sidebar tick boxes —
 * several can be chosen (owner, 2026-10-23). */
export function CategoryTypeOptions({ state }: { state: CategoryFilterState }) {
  const { selected, subSlugs, toggleSub } = state;
  if (!selected || selected.subcategories.length <= 1) return null;
  return (
    <>
      {selected.subcategories.map((s) => (
        <DropdownCheckbox
          key={s.id}
          label={
            <span style={{ display: "flex", justifyContent: "space-between", gap: 8, flex: 1 }}>
              {s.name}
              <span style={{ color: colors.mutedLight, fontWeight: 500 }}>{s.count}</span>
            </span>
          }
          checked={subSlugs.includes(s.slug)}
          onChange={() => toggleSub(s.slug)}
        />
      ))}
    </>
  );
}

/** Empty results under a category: say so, offer neighbours and a way out. */
export function CategoryEmptyHint({ state, basePath }: { state: CategoryFilterState; basePath: string }) {
  if (!state.selected) return null;
  const others = state.categories.filter((c) => c.id !== state.selected!.id).slice(0, 4);
  const subs = state.selectedSub ? state.selected.subcategories.filter((s) => s.id !== state.selectedSub!.id).slice(0, 3) : [];
  return (
    <div style={{ marginTop: 12, fontSize: 14, color: colors.muted, lineHeight: 1.6 }}>
      <div>
        Nothing in <strong style={{ color: colors.text }}>{state.label}</strong> matches these filters right now.
      </div>
      {(subs.length > 0 || others.length > 0) && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10, justifyContent: "center" }}>
          {subs.map((s) => (
            <Link key={s.id} to={`${basePath}?category=${state.selected!.slug}&sub=${s.slug}`} className="hc-related-chip">
              {s.name}
            </Link>
          ))}
          {others.map((c) => (
            <Link key={c.id} to={`${basePath}?category=${c.slug}`} className="hc-related-chip">
              {c.name}
            </Link>
          ))}
        </div>
      )}
      <button type="button" className="btn-reset" style={{ marginTop: 10, textDecoration: "underline", fontWeight: 700, color: colors.text }} onClick={() => state.setCategory(null)}>
        Show every category
      </button>
    </div>
  );
}

/** "Activities › Racket sports › Badminton" on detail pages, each step linking to the filtered list. */
export function CategoryBreadcrumb({ taxonomy, basePath, typeLabel, tags }: { taxonomy?: ListingTaxonomy | null; basePath: string; typeLabel: string; tags?: string[] }) {
  if (!taxonomy) return null;
  const sep = (
    <span aria-hidden="true" style={{ margin: "0 6px", color: colors.faint }}>
      ›
    </span>
  );
  return (
    <nav aria-label="Category" className="hc-category-breadcrumb" style={{ fontSize: 13, fontWeight: 600, color: colors.muted, display: "flex", flexWrap: "wrap", alignItems: "center", rowGap: 4 }}>
      <Link to={basePath} style={{ color: "inherit" }}>
        {typeLabel}
      </Link>
      {sep}
      <Link to={`${basePath}?category=${taxonomy.categorySlug}`} style={{ color: "inherit" }}>
        {taxonomy.categoryName}
      </Link>
      {taxonomy.subcategoryName && taxonomy.subcategorySlug && (
        <>
          {sep}
          <Link to={`${basePath}?category=${taxonomy.categorySlug}&sub=${taxonomy.subcategorySlug}`} style={{ color: colors.text }} aria-current="page">
            {taxonomy.subcategoryName}
          </Link>
        </>
      )}
      {tags && tags.length > 0 && <TagList tags={tags} />}
    </nav>
  );
}


function TagList({ tags }: { tags: string[] }) {
  return (
    <span style={{ display: "inline-flex", flexWrap: "wrap", gap: 6, marginLeft: 12 }}>
      {tags.map((t) => (
        <span key={t} style={{ fontSize: 12, fontWeight: 600, padding: "2px 9px", borderRadius: 999, border: `1px solid ${colors.border}`, color: colors.textSoft }}>
          {DISCOVERY_TAG_LABELS[t as DiscoveryTag] ?? t}
        </span>
      ))}
    </span>
  );
}
