import { Compass } from "lucide-react";
import type { CategoryFamily } from "../api";
import { CategoryChips, CategoryEmptyHint, CategoryTypeOptions, hasCategoryTypes, useCategoryFilter } from "./categories/CategoryChips";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRightIcon, ClockIcon, CloseIcon, GridIcon, LightbulbIcon, PinIcon, SearchIcon, UsersIcon } from "./icons";
import { Chip } from "./Chip";
import { DiscoveryMap, type DiscoveryMapPin } from "./DiscoveryMap";
import { DropdownCheckbox } from "./FilterDropdown";
import { PageTitle } from "./PageTitle";
import { Button, CardSkeleton, Drawer, EmptyState, LoadErrorState } from "./ui";
import { SaveButton, useSavedState } from "./SaveButton";
import { CardArrow, CardAvailability, CardGrid, CardPrice, ListingCard } from "./ListingCard";
import { FeaturedPicks, type FeaturedKind } from "./FeaturedPicks";
import { useGuest } from "../GuestContext";
import { CardDate, itemCardLabel } from "./CardDate";
import { FeatureCard, featureFits, type FeatureVariant } from "./FeatureCard";
import { dateLabel } from "../euro";
import { formatAvailability, formatDateTime, formatPrice } from "../formatters";
import { colors, fonts, maxWidth, radius } from "../theme";
import type { MapMarkerType } from "../types";
import { daysBetween, irelandToday, weekdayOf } from "../irelandDate";
import { CtaBand } from "./CtaBand";

// Shared browse layout for the "book a spot on something" listing pages —
// Adventures, Experiences, Volunteer (ExperienceKindBrowse.tsx) and
// Programs (pages/Programs.tsx). Generalised out of what used to be
// ExperienceKindBrowse's own body so every one of these pages gets the same
// search-first hero, sticky filter sidebar (+ mobile drawer), sort, grid/map
// toggle, result card and closing band, instead of Programs drifting into
// its own simpler page. Each page supplies a BrowseConfig and an adapter
// that maps its own data into BrowseItem; nothing here knows about the
// underlying tables. Booking still happens on each detail page.

const PAGE_SIZE = 12;

type WhenFilter = "any" | "today" | "tomorrow" | "weekend" | "next7" | "date";
type PriceTier = "any" | "under30" | "30to50" | "over50";
export type SortKey = "featured" | "soonest" | "price-asc" | "price-desc";

const WHEN_LABELS: Record<WhenFilter, string> = {
  any: "Any time",
  today: "Today",
  tomorrow: "Tomorrow",
  weekend: "This weekend",
  next7: "Next 7 days",
  date: "Pick a date",
};
const PRICE_LABELS: Record<PriceTier, string> = {
  any: "Any price",
  under30: "Under €30",
  "30to50": "€30-€50",
  over50: "€50+",
};
const SORT_LABELS: Record<SortKey, string> = {
  featured: "Featured",
  soonest: "Soonest",
  "price-asc": "Price: Low to High",
  "price-desc": "Price: High to Low",
};

/** The next upcoming date for an item — spotsLeft null when not tracked. */
export interface BrowseSession {
  date: string;
  time: string;
  spotsLeft: number | null;
}

/** One card, in a shape every listing type can be mapped into. */
export interface BrowseItem {
  id: string;
  title: string;
  /** Lower-cased text the search box matches against. */
  searchText: string;
  /** The "where" line on the card, e.g. "Howth, Dublin" or "St. Brigid's, Clondalkin". */
  locationLabel: string;
  /** For the county filter. */
  county: string;
  lat: number | null;
  lng: number | null;
  /** Coordinate provenance — the map only trusts "confirmed" for distance claims. */
  locationSource?: DiscoveryMapPin["locationSource"];
  priceCents: number;
  /** Adds the small "pp" after a non-free price. */
  perPerson: boolean;
  /** What one price covers when it isn't per person ("for 6 sessions"). */
  priceUnit?: string;
  imageUrl: string;
  featured: boolean;
  href: string;
  tone: "green" | "orange";
  next: BrowseSession | null;
  /** Small pills under the location line (difficulty, category, level…). */
  tags: string[];
  /** Value the optional tag filter narrows by (difficulty, category…). */
  filterTag: string | null;
  ctaLabel: string;
  /** Only listing types favourites support get a save button. */
  save: { kind: "experience"; id: string } | null;
  /** Real duration / skill level, shown by the Adventure card style when set. */
  durationMinutes?: number | null;
  skill?: string | null;
  /** The Bold word over the photo (see cardWord). */
  word?: string | null;
}

export interface BrowseConfig {
  title: string;
  subtitle: string;
  /** "adventures", "programs"… — used in counts and empty states. */
  nounPlural: string;
  /** Batch 2 — the listing type shown on a card with no photo ("Programme", "Adventure"…). */
  kindLabel?: string;
  searchPlaceholder: string;
  icon: ReactNode;
  load: (taxonomy: { categorySlug?: string; subcategorySlug?: string }) => Promise<BrowseItem[]>;
  /** Category system — chips + server filter for this family (?category=&sub=). */
  categoryFamily?: CategoryFamily;
  /** Adventures vs Experiences: counts only that kind. */
  categoryExperienceKind?: "adventure" | "experience" | "event";
  /** Where category links in the empty state point (this page's path). */
  categoryBasePath?: string;
  /** The tag filter is only a fallback for when no category has live listings. */
  tagFilterFallbackOnly?: boolean;
  /** Changing this resets filters (e.g. moving between /adventures and /experiences). */
  resetKey: string;
  /** Optional chip/sidebar filter over BrowseItem.filterTag (e.g. "Difficulty", "Category"). */
  tagFilterLabel?: string;
  /** Map "Search this area" entity types; omit to show the list's own pins only. */
  mapSearchTypes?: MapMarkerType[];
  /** A featured section of another type above the closing band (owner 2026-10-27). */
  featured?: FeaturedKind;
  /** Whether any item can be featured — hides the "top picks first" hint and the sort option otherwise. */
  supportsFeatured: boolean;
  /** Card style for the row of featured listings above the grid (owner plan,
   * 2026-10-23). A chosen category always uses the Bold typography style. */
  featureStyle?: FeatureVariant;
  /** Closing CtaBand copy — `label` is the vertical word, `lines` the three-line heading. */
  closing: { label?: string; lines?: [string, string, string]; text: string; primary: { label: string; to: string }; secondary: { label: string; to: string } };
}

function uniqueSorted(values: (string | null | undefined)[]): string[] {
  return Array.from(new Set(values.filter((v): v is string => !!v))).sort((a, b) => a.localeCompare(b));
}

function priceMatches(e: BrowseItem, tier: PriceTier): boolean {
  if (tier === "under30") return e.priceCents < 3000;
  if (tier === "30to50") return e.priceCents >= 3000 && e.priceCents <= 5000;
  if (tier === "over50") return e.priceCents > 5000;
  return true;
}

/** Same boundaries as priceMatches() above, expressed as the min/max-cents
 * pair /api/discover/map accepts — so "Search this area" respects the same
 * price tier the list panel already filters by. */
function priceTierToRange(tier: PriceTier): { minPriceCents?: number; maxPriceCents?: number } {
  if (tier === "under30") return { maxPriceCents: 2999 };
  if (tier === "30to50") return { minPriceCents: 3000, maxPriceCents: 5000 };
  if (tier === "over50") return { minPriceCents: 5001 };
  return {};
}

/** Several ticked tiers as one min/max pair for the map search: the span
 * from the cheapest to the dearest tier ticked (the list itself matches
 * each tier exactly). */
function pricesToRange(tiers: PriceTier[]): { minPriceCents?: number; maxPriceCents?: number } {
  if (tiers.length === 0) return {};
  const ranges = tiers.map(priceTierToRange);
  const mins = ranges.map((r) => r.minPriceCents);
  const maxs = ranges.map((r) => r.maxPriceCents);
  return {
    ...(mins.some((m) => m === undefined) ? {} : { minPriceCents: Math.min(...(mins as number[])) }),
    ...(maxs.some((m) => m === undefined) ? {} : { maxPriceCents: Math.max(...(maxs as number[])) }),
  };
}

function dateWhenMatches(e: BrowseItem, when: WhenFilter, whenDate: string): boolean {
  if (when === "any") return true;
  const session = e.next;
  if (!session) return false;
  const diffDays = daysBetween(irelandToday(), session.date);
  if (when === "today") return diffDays === 0;
  if (when === "tomorrow") return diffDays === 1;
  if (when === "weekend") {
    const day = weekdayOf(session.date);
    return diffDays >= 0 && diffDays <= 7 && (day === 0 || day === 6);
  }
  if (when === "next7") return diffDays >= 0 && diffDays <= 7;
  if (when === "date") return !whenDate || session.date === whenDate;
  return true;
}

function compareItems(a: BrowseItem, b: BrowseItem, sort: SortKey): number {
  if (sort === "price-asc") return a.priceCents - b.priceCents;
  if (sort === "price-desc") return b.priceCents - a.priceCents;
  const bySoonest = () => {
    const sa = a.next;
    const sb = b.next;
    if (!sa && !sb) return 0;
    if (!sa) return 1;
    if (!sb) return -1;
    return `${sa.date}${sa.time}`.localeCompare(`${sb.date}${sb.time}`);
  };
  if (sort === "soonest") return bySoonest();
  // featured: featured rows first, then soonest upcoming date.
  const featuredDiff = Number(b.featured) - Number(a.featured);
  return featuredDiff !== 0 ? featuredDiff : bySoonest();
}

function toPins(items: BrowseItem[]): DiscoveryMapPin[] {
  return items
    .filter((e) => e.lat !== null && e.lng !== null)
    .map((e) => ({
      id: e.id,
      lat: e.lat as number,
      lng: e.lng as number,
      title: e.title,
      subtitle: e.locationLabel,
      priceLabel: formatPrice(e.priceCents, { each: e.perPerson }),
      href: e.href,
      locationSource: e.locationSource,
    }));
}

// --- Browse card ------------------------------------------------------------

function SaveSlot({ save }: { save: NonNullable<BrowseItem["save"]> }) {
  const [saved, toggleSaved] = useSavedState(save.kind, save.id);
  return <SaveButton saved={saved} onToggle={toggleSaved} />;
}

/** `showWord`: the Bold word over the photo, only on search results (a
 * search, category or filter applied — owner, 2026-10-28). */
export function BrowseCard({ e, icon, kindLabel, showWord = false }: { e: BrowseItem; icon: ReactNode; kindLabel?: string; showWord?: boolean }) {
  const navigate = useNavigate();
  const session = e.next;
  const open = () => navigate(e.href);
  const low = !!session && session.spotsLeft !== null && session.spotsLeft <= 2;

  // Design-system consistency pass: the shared ListingCard shape.
  return (
    <ListingCard
      href={e.href}
      title={e.title}
      image={e.imageUrl || null}
      ph={e.tone === "green" ? colors.greenBg : colors.orangeBg}
      icon={icon}
      iconColor={colors.orange}
      tag={e.tags[0]}
      fallbackKind={kindLabel ?? null}
      fallbackLine={session ? formatDateTime(session.date, session.time) : "No dates yet"}
      dateOn={session ? <CardDate date={session.date} time={session.time} label={itemCardLabel({ date: session.date, time: session.time, spotsLeft: session.spotsLeft })} /> : undefined}
      rowOnPhone
      word={showWord ? e.word : null}
      status={low && session ? { label: formatAvailability(session.spotsLeft as number) } : null}
      save={e.save ? <SaveSlot save={e.save} /> : null}
      details={[
        e.locationLabel ? { icon: <PinIcon size={13} />, text: e.locationLabel } : null,
        { icon: <ClockIcon size={13} />, text: session ? formatDateTime(session.date, session.time) : "No dates yet", kind: session ? "date" : undefined },
        e.tags.length > 1 ? { text: <span style={{ textTransform: "capitalize" }}>{e.tags.slice(1).join(" · ")}</span> } : null,
      ]}
      facts={
        <>
          <CardPrice cents={e.priceCents} unit={e.priceUnit ?? (e.perPerson ? "per person" : undefined)} />
          {session && session.spotsLeft !== null && <CardAvailability spotsLeft={session.spotsLeft} />}
        </>
      }
      action={
        <CardArrow label={`${e.ctaLabel}: ${e.title}`} onClick={open} />
      }
    />
  );
}

/** A listing in one of the premium styles (featured row / category row). */
function BrowseFeatureCard({ e, variant, category }: { e: BrowseItem; variant: FeatureVariant; category: string | null }) {
  const navigate = useNavigate();
  const session = e.next;
  const low = !!session && session.spotsLeft !== null && session.spotsLeft <= 2;
  return (
    <FeatureCard
      variant={variant}
      data={{
        href: e.href,
        title: e.title,
        image: e.imageUrl || null,
        ph: e.tone === "green" ? colors.greenBg : colors.orangeBg,
        category: variant === "bold" ? category : (e.tags[0] ?? null),
        status: low && session ? { label: formatAvailability(session.spotsLeft as number), tone: "hot" } : e.featured ? { label: "Featured", tone: "featured" } : null,
        place: e.locationLabel || null,
        date: session?.date ?? null,
        time: session?.time ?? null,
        durationMinutes: e.durationMinutes ?? null,
        skill: e.skill ?? null,
        price: `${formatPrice(e.priceCents)}${e.priceCents && e.perPerson ? " pp" : ""}`,
        spotsLeft: session && !low ? session.spotsLeft : null,
      }}
      save={e.save ? <SaveSlot save={e.save} /> : null}
      onOpen={() => navigate(e.href)}
      actionLabel={e.ctaLabel}
    />
  );
}

// --- Layout -----------------------------------------------------------------

export function BrowseLayout({ config }: { config: BrowseConfig }) {
  const navigate = useNavigate();
  const [items, setItems] = useState<BrowseItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [view, setView] = useState<"grid" | "map">("grid");

  const defaultSort: SortKey = config.supportsFeatured ? "featured" : "soonest";
  const [query, setQuery] = useState("");
  const [county, setCounty] = useState("All");
  // Owner, 2026-10-23: Refine's Type, Difficulty and Price take several
  // choices; none ticked = no filter.
  const [tags, setTags] = useState<string[]>([]);
  const [whens, setWhens] = useState<WhenFilter[]>([]);
  const [whenDate, setWhenDate] = useState("");
  const [prices, setPrices] = useState<PriceTier[]>([]);
  const [sort, setSort] = useState<SortKey>(defaultSort);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const resultsRef = useRef<HTMLDivElement>(null);

  // HC-QA-063 — a failed load is an error state, never an empty result.
  const [loadFailed, setLoadFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const { resident } = useGuest();
  const taxonomy = useCategoryFilter(config.categoryFamily ?? null, { experienceKind: config.categoryExperienceKind });
  const taxonomyKey = JSON.stringify([taxonomy.serverParams, taxonomy.subSlugs]);
  useEffect(() => {
    setLoading(true);
    setLoadFailed(false);
    // Several types ticked: the list endpoint takes one type, so ask once per
    // type and merge (no server change).
    const subs = taxonomy.subSlugs;
    const req =
      subs.length > 1 && taxonomy.serverParams.categorySlug
        ? Promise.all(subs.map((sub) => config.load({ categorySlug: taxonomy.serverParams.categorySlug, subcategorySlug: sub }))).then((lists) => {
            const seen = new Set<string>();
            return lists.flat().filter((e) => (seen.has(e.id) ? false : (seen.add(e.id), true)));
          })
        : config.load(taxonomy.serverParams);
    req
      .then(setItems)
      .catch(() => { setItems([]); setLoadFailed(true); })
      .finally(() => setLoading(false));
    // `load` is recreated by callers on every render; resetKey is the real identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.resetKey, attempt, taxonomyKey]);

  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [query, county, tags, whens, whenDate, prices, sort]);

  useEffect(() => {
    // Reset page-specific filters when navigating between pages that share this layout.
    setQuery("");
    setCounty("All");
    setTags([]);
    setWhens([]);
    setWhenDate("");
    setPrices([]);
    setSort(defaultSort);
    setView("grid");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.resetKey]);

  const countyOptions = useMemo(() => uniqueSorted(items.map((e) => e.county)), [items]);
  const tagOptions = useMemo(() => uniqueSorted(items.map((e) => e.filterTag)), [items]);
  const showTagFilter = !!config.tagFilterLabel && tagOptions.length > 0 && !(config.tagFilterFallbackOnly && taxonomy.categories.length > 0);

  // One predicate, so "how many more if I drop this filter" uses the same rules.
  const countWith = (f: { query?: string; county?: string; tags?: string[]; whens?: WhenFilter[]; prices?: PriceTier[] }) => {
    const q = (f.query ?? query).trim().toLowerCase();
    const c = f.county ?? county;
    const t = f.tags ?? tags;
    const w = f.whens ?? whens;
    const pr = f.prices ?? prices;
    return items.filter((e) => {
      if (q && !e.searchText.includes(q)) return false;
      if (c !== "All" && e.county !== c) return false;
      if (showTagFilter && t.length > 0 && !t.includes(e.filterTag ?? "")) return false;
      if (w.length > 0 && !w.some((x) => dateWhenMatches(e, x, whenDate))) return false;
      if (pr.length > 0 && !pr.some((x) => priceMatches(e, x))) return false;
      return true;
    });
  };
  const filtered = useMemo(() => countWith({}), [items, query, county, showTagFilter, tags, whens, whenDate, prices]); // eslint-disable-line react-hooks/exhaustive-deps

  const sorted = useMemo(() => [...filtered].sort((a, b) => compareItems(a, b, sort)), [filtered, sort]);
  // Premium row (owner plan, 2026-10-23): featured listings use the page's
  // style. Every other result is the normal card with its Bold word on the
  // photo (owner, 2026-10-28) — a chosen category no longer switches style.
  const rowStyle: FeatureVariant | null = config.featureStyle ?? null;
  const featureRow = !rowStyle
    ? []
    : sorted.filter((e) => e.featured && featureFits(rowStyle, { image: e.imageUrl, date: e.next?.date })).slice(0, 4);
  const featureIds = new Set(featureRow.map((e) => e.id));
  const gridItems = sorted.filter((e) => !featureIds.has(e.id));
  const visibleItems = gridItems.slice(0, visibleCount);

  const activeCount = [county !== "All", showTagFilter && tags.length > 0, whens.length > 0, prices.length > 0, !!taxonomy.selected].filter(Boolean).length;
  // Search results: something typed, a category or a filter applied.
  const isSearching = query.trim() !== "" || activeCount > 0;
  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  const activeChips = useMemo(() => {
    const chips: { key: string; label: string; onRemove: () => void }[] = [];
    if (county !== "All") chips.push({ key: "county", label: county, onRemove: () => setCounty("All") });
    if (showTagFilter) tags.forEach((t) => chips.push({ key: `tag-${t}`, label: t.charAt(0).toUpperCase() + t.slice(1), onRemove: () => setTags((l) => l.filter((x) => x !== t)) }));
    whens.forEach((w) => chips.push({ key: `when-${w}`, label: w === "date" && whenDate ? dateLabel(whenDate) : WHEN_LABELS[w], onRemove: () => setWhens((l) => l.filter((x) => x !== w)) }));
    prices.forEach((p) => chips.push({ key: `price-${p}`, label: PRICE_LABELS[p], onRemove: () => setPrices((l) => l.filter((x) => x !== p)) }));
    if (taxonomy.label) chips.push({ key: "taxonomy", label: taxonomy.label, onRemove: () => taxonomy.setCategory(null) });
    return chips;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [county, showTagFilter, tags, whens, whenDate, prices, taxonomy.label]);

  const clearAllFilters = () => {
    setQuery("");
    setCounty("All");
    setTags([]);
    setWhens([]);
    setWhenDate("");
    setPrices([]);
    if (taxonomy.selected) taxonomy.setCategory(null);
  };

  const whenSummaryLabel = whens.length === 0 ? WHEN_LABELS.any : whens.map((w) => (w === "date" && whenDate ? dateLabel(whenDate) : WHEN_LABELS[w])).join(", ");
  const sortKeys = (Object.keys(SORT_LABELS) as SortKey[]).filter((k) => k !== "featured" || config.supportsFeatured);

  const filterGroupStyle: CSSProperties = { padding: "16px 0", borderTop: `1px solid ${colors.border}` };
  const filterLabelStyle: CSSProperties = { fontSize: 11.5, fontWeight: 700, color: colors.mutedLight, textTransform: "uppercase", letterSpacing: 0, marginBottom: 8 };

  const filterPanel = (
    <>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", paddingBottom: 16 }}>
        <span style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 15 }}>Refine</span>
        {activeCount > 0 && (
          <button onClick={clearAllFilters} style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontSize: 12.5, fontWeight: 700, color: colors.muted }}>
            Clear all
          </button>
        )}
      </div>

      {/* Owner, 2026-10-23: the category's types live here, not as a second chip row. */}
      {hasCategoryTypes(taxonomy) && (
        <div style={{ ...filterGroupStyle, paddingTop: 0, borderTop: "none" }}>
          <div style={filterLabelStyle}>Type</div>
          <CategoryTypeOptions state={taxonomy} />
        </div>
      )}

      <div style={{ ...filterGroupStyle, ...(hasCategoryTypes(taxonomy) ? {} : { paddingTop: 0 }) }}>
        <div style={filterLabelStyle}>When</div>
        {(["today", "tomorrow", "weekend", "next7"] as WhenFilter[]).map((w) => (
          <DropdownCheckbox key={w} label={WHEN_LABELS[w]} checked={whens.includes(w)} onChange={() => setWhens((l) => toggle(l, w))} />
        ))}
        <DropdownCheckbox label="Pick a date" checked={whens.includes("date")} onChange={() => setWhens((l) => toggle(l, "date" as WhenFilter))} />
        {whens.includes("date") && (
          <input aria-label="Pick a date"
            type="date"
            value={whenDate}
            onChange={(e) => setWhenDate(e.target.value)}
            style={{ marginTop: 4, fontSize: 13, padding: "7px 9px", width: "100%", border: `1px solid ${colors.inputBorder}`, borderRadius: radius.control, boxSizing: "border-box" }}
          />
        )}
      </div>

      {showTagFilter && (
        <div style={filterGroupStyle}>
          <div style={filterLabelStyle}>{config.tagFilterLabel}</div>
          {tagOptions.map((d) => (
            <DropdownCheckbox key={d} label={<span style={{ textTransform: "capitalize" }}>{d}</span>} checked={tags.includes(d)} onChange={() => setTags((l) => toggle(l, d))} />
          ))}
        </div>
      )}

      <div style={{ ...filterGroupStyle, paddingBottom: 0 }}>
        <div style={filterLabelStyle}>Price</div>
        {(["under30", "30to50", "over50"] as PriceTier[]).map((p) => (
          <DropdownCheckbox key={p} label={PRICE_LABELS[p]} checked={prices.includes(p)} onChange={() => setPrices((l) => toggle(l, p))} />
        ))}
      </div>
    </>
  );

  return (
    <div className="fade-panel">
      <section className="section-pad" style={{ maxWidth, margin: "0 auto", padding: "36px 24px 16px" }}>
        <PageTitle>{config.title}</PageTitle>
        <p style={{ color: colors.mutedLight, fontSize: 15, margin: 0 }}>{config.subtitle}</p>

        {/* Search card (Batch 2, same pattern as Explore): the free-text field
            and the area/when pickers in one row that wraps on phones, so the
            pickers sit side by side under the field instead of stacking.
            Results filter as you type, so there's no separate Search button. */}
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, border: `1px solid ${colors.border}`, borderRadius: radius.card, background: colors.surface, boxShadow: "0 8px 24px rgba(30,40,32,.05)", padding: 8, marginTop: 20, marginBottom: 14 }}>
          <div style={{ position: "relative", flex: "1 1 260px", minWidth: 0 }}>
            <SearchIcon size={17} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: colors.faint }} />
            <input aria-label="Search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={config.searchPlaceholder}
              style={{ width: "100%", padding: "11px 8px 11px 36px", border: "none", background: "transparent", fontSize: 16, color: colors.text, outline: "none", boxSizing: "border-box" }}
            />
          </div>
          <select aria-label="Area"
            value={county}
            onChange={(e) => setCounty(e.target.value)}
            style={{ padding: "9px 12px", border: "none", borderRadius: radius.pill, fontSize: 13.5, background: colors.panel, color: colors.text, fontWeight: 600 }}
          >
            <option value="All">Near: anywhere</option>
            {countyOptions.map((c) => (
              <option key={c} value={c}>Near: {c}</option>
            ))}
          </select>
        </div>

        <CategoryChips state={taxonomy} subChips={false} />
      </section>

      <section className="section-pad" style={{ maxWidth, margin: "0 auto", padding: "0 24px 32px" }}>
        <div className="grid-responsive" style={{ display: "grid", gridTemplateColumns: "260px 1fr", gap: 28, alignItems: "start" }}>
          <aside className="games-sidebar sticky-aside" style={{ position: "sticky", top: 90, maxHeight: "calc(100vh - 110px)", overflowY: "auto" }}>
            {filterPanel}
          </aside>

          <div>
            <div ref={resultsRef} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
              <div>
                {loading ? (
                  <div style={{ fontWeight: 700, fontSize: 16 }}>Loading…</div>
                ) : loadFailed ? null : (
                  <>
                    {sorted.length > visibleCount && (
                      <div style={{ fontSize: 12, color: colors.faint, marginBottom: 2 }}>
                        Showing 1-{Math.min(visibleCount, sorted.length)} of {sorted.length}
                      </div>
                    )}
                    <div style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: 20, letterSpacing: 0 }}>
                      {sorted.length}{" "}
                      <span style={{ fontFamily: fonts.body, fontWeight: 600, fontSize: 15, color: colors.mutedLight }}>
                        {config.nounPlural} {sorted.length === 1 ? "listing" : "nearby"}
                      </span>
                    </div>
                  </>
                )}
                {(county !== "All" || whens.length > 0 || query.trim()) && (
                  <div style={{ fontSize: 13, color: colors.mutedLight, marginTop: 2 }}>
                    {county === "All" ? "Anywhere" : county} · {whenSummaryLabel}
                    {query.trim() && ` for "${query.trim()}"`}
                  </div>
                )}
              </div>
              {/* Wraps at phone widths (sitemap audit P1-09: Filters + Sort + the
                  Grid/Map toggle overflowed the viewport by 59px at 320px). */}
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <button
                  className="games-filter-trigger"
                  onClick={() => setFiltersOpen(true)}
                  style={{ display: "inline-flex", alignItems: "center", gap: 6, border: `1.5px solid ${colors.borderStrong}`, background: "#fff", color: colors.textSoft, borderRadius: radius.card, padding: "8px 14px", fontSize: 14, fontWeight: 600 }}
                >
                  Filters{activeCount > 0 ? ` (${activeCount})` : ""}
                </button>
                <select aria-label="Sort results"
                  value={sort}
                  onChange={(e) => setSort(e.target.value as SortKey)}
                  style={{ padding: "9px 12px", border: `1px solid ${colors.inputBorder}`, borderRadius: radius.control, fontSize: 14, background: colors.bg, color: colors.text, outline: "none", fontWeight: 600 }}
                >
                  {sortKeys.map((k) => (
                    <option key={k} value={k}>Sort: {SORT_LABELS[k]}</option>
                  ))}
                </select>
                <div style={{ display: "flex", border: `1px solid ${colors.borderStrong}`, borderRadius: radius.control, overflow: "hidden" }}>
                  {(["grid", "map"] as const).map((v) => (
                    <button
                      key={v}
                      onClick={() => setView(v)}
                      aria-label={v === "grid" ? "Grid view" : "Map view"}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        padding: "9px 12px",
                        border: "none",
                        cursor: "pointer",
                        background: view === v ? colors.dark : "#fff",
                        color: view === v ? "#fff" : colors.text,
                        fontSize: 13,
                        fontWeight: 600,
                      }}
                    >
                      {v === "grid" ? <GridIcon size={13} /> : <PinIcon size={13} />}
                    </button>
                  ))}
                </div>
              </div>
            </div>


            {activeChips.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 20 }}>
                {activeChips.map((c) => (
                  <button
                    key={c.key}
                    onClick={c.onRemove}
                    style={{ display: "inline-flex", alignItems: "center", gap: 5, background: colors.greenBg, color: colors.greenText, border: "none", borderRadius: radius.card, padding: "5px 10px 5px 12px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}
                  >
                    {c.label} <CloseIcon size={12} />
                  </button>
                ))}
                <button onClick={clearAllFilters} style={{ background: "none", border: "none", padding: "5px 4px", cursor: "pointer", fontSize: 13, fontWeight: 700, color: colors.muted }}>
                  Clear all
                </button>
              </div>
            )}

            {loading ? (
              <div className="listing-grid">
                {Array.from({ length: PAGE_SIZE }, (_, i) => <CardSkeleton key={i} />)}
              </div>
            ) : loadFailed ? (
              <LoadErrorState title="We couldn't load these listings right now." onRetry={() => setAttempt((n) => n + 1)} />
            ) : sorted.length === 0 ? (
              <EmptyState
                icon={<UsersIcon size={22} />}
                title={items.length === 0 && !taxonomy.selected ? `No ${config.nounPlural} yet` : "Nothing matching that yet."}
                subtitle={items.length === 0 && !taxonomy.selected ? "Check back soon — new listings go up all the time." : "Try widening your search or clearing a filter."}
                action={
                  items.length > 0 || taxonomy.selected ? (
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center" }}>
                        {county !== "All" && <Chip label="Expand to anywhere" active={false} onClick={() => setCounty("All")} />}
                        {whens.length > 0 && <Chip label="Any time" active={false} onClick={() => setWhens([])} />}
                        {activeCount > 0 && <Chip label="Clear filters" active={false} onClick={clearAllFilters} />}
                      </div>
                      {config.categoryBasePath && <CategoryEmptyHint state={taxonomy} basePath={config.categoryBasePath} />}
                    </div>
                  ) : undefined
                }
              />
            ) : view === "map" ? (
              <DiscoveryMap
                pins={toPins(sorted)}
                searchTypes={config.mapSearchTypes}
                searchFilters={config.mapSearchTypes ? { q: query.trim() || undefined, ...pricesToRange(prices) } : undefined}
              />
            ) : (
              <>
                {featureRow.length > 0 && rowStyle && (
                  <div className="listing-grid" style={{ marginBottom: 20 }}>
                    {featureRow.map((e) => (
                      <BrowseFeatureCard key={e.id} e={e} variant={rowStyle} category={null} />
                    ))}
                  </div>
                )}

                  <CardGrid>
                    {visibleItems.map((e) => (
                      <BrowseCard key={e.id} e={e} icon={config.icon} kindLabel={config.kindLabel} showWord={isSearching} />
                    ))}
                  </CardGrid>
                {visibleCount < gridItems.length && (
                  <div style={{ display: "flex", justifyContent: "center", marginTop: 28 }}>
                    <Button variant="ghost" onClick={() => setVisibleCount((v) => v + PAGE_SIZE)}>
                      Show more ({gridItems.length - visibleCount} more)
                    </Button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </section>

      <Drawer open={filtersOpen} onClose={() => setFiltersOpen(false)} title="Filters">
        {filterPanel}
        <div style={{ marginTop: 20 }}>
          <Button full onClick={() => setFiltersOpen(false)}>Show {sorted.length} result{sorted.length === 1 ? "" : "s"}</Button>
        </div>
      </Drawer>

      {config.featured && (
        <div className="section-pad" style={{ maxWidth, margin: "0 auto", padding: "0 24px" }}>
          <FeaturedPicks kind={config.featured} />
        </div>
      )}

      {/* Closing CTA band — the shared CtaBand (same as Home's closing band). */}
      <CtaBand
        id="browse-cta-title"
        panel={{ title: "Not quite right?", text: "Try something else nearby — or join an activity instead.", icon: <Compass size={20} strokeWidth={2} /> }}
        label={config.closing.label}
        lines={config.closing.lines ?? ["Didn't find", "the right", "one?"]}
        text={config.closing.text}
        action={config.closing.primary}
        secondary={config.closing.secondary}
      />
    </div>
  );
}
