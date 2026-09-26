import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRightIcon, ClockIcon, CloseIcon, GridIcon, LightbulbIcon, PinIcon, SearchIcon, UsersIcon } from "./icons";
import { Chip } from "./Chip";
import { DiscoveryMap, type DiscoveryMapPin } from "./DiscoveryMap";
import { DropdownOption } from "./FilterDropdown";
import { Photo } from "./Photo";
import { PageTitle } from "./PageTitle";
import { Button, Card, CardLink, CardSkeleton, Drawer, EmptyState } from "./ui";
import { SaveButton, useSavedState } from "./SaveButton";
import { dateLabel } from "../euro";
import { formatAvailability, formatDateTime, formatPrice } from "../formatters";
import { cardImageRatio, colors, fonts, maxWidth, radius } from "../theme";
import type { MapMarkerType } from "../types";

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
}

export interface BrowseConfig {
  title: string;
  subtitle: string;
  /** "adventures", "programs"… — used in counts and empty states. */
  nounPlural: string;
  searchPlaceholder: string;
  icon: ReactNode;
  load: () => Promise<BrowseItem[]>;
  /** Changing this resets filters (e.g. moving between /adventures and /experiences). */
  resetKey: string;
  /** Optional chip/sidebar filter over BrowseItem.filterTag (e.g. "Difficulty", "Category"). */
  tagFilterLabel?: string;
  /** Map "Search this area" entity types; omit to show the list's own pins only. */
  mapSearchTypes?: MapMarkerType[];
  /** Whether any item can be featured — hides the "top picks first" hint and the sort option otherwise. */
  supportsFeatured: boolean;
  closing: { text: string; primary: { label: string; to: string }; secondary: { label: string; to: string } };
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

function dateWhenMatches(e: BrowseItem, when: WhenFilter, whenDate: string): boolean {
  if (when === "any") return true;
  const session = e.next;
  if (!session) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d = new Date(`${session.date}T00:00:00`);
  const diffDays = Math.round((d.getTime() - today.getTime()) / 86400000);
  if (when === "today") return diffDays === 0;
  if (when === "tomorrow") return diffDays === 1;
  if (when === "weekend") {
    const day = d.getDay();
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

export function BrowseCard({ e, icon }: { e: BrowseItem; icon: ReactNode }) {
  const navigate = useNavigate();
  const session = e.next;
  const open = () => navigate(e.href);

  return (
    <Card hover style={{ position: "relative", padding: 0, overflow: "hidden" }}>
      <CardLink to={e.href} label={e.title} sharedImage />
      <Photo
        src={e.imageUrl || undefined}
        alt={e.title}
        ph={e.tone === "green" ? colors.greenBg : colors.orangeBg}
        icon={icon}
        iconColor={e.tone === "green" ? colors.greenText : colors.orangeDark}
        style={{ aspectRatio: cardImageRatio.discovery }}
        contentStyle={{ padding: 10, display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}
      >
        {session ? (
          <span
            className="card-photo-badge"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              background: "rgba(255,255,255,.92)",
              color: colors.text,
              borderRadius: radius.pill,
              padding: "5px 11px 5px 9px",
              fontSize: 12.5,
              fontWeight: 700,
              transition: "background-color .2s ease, color .2s ease",
            }}
          >
            <ClockIcon size={12} /> {formatDateTime(session.date, session.time)}
          </span>
        ) : (
          <span
            className="card-photo-badge"
            style={{
              display: "inline-flex",
              alignItems: "center",
              background: "rgba(255,255,255,.85)",
              color: colors.muted,
              borderRadius: radius.pill,
              padding: "5px 11px",
              fontSize: 12,
              fontWeight: 700,
              transition: "background-color .2s ease, color .2s ease",
            }}
          >
            No dates yet
          </span>
        )}
        {e.save && <SaveSlot save={e.save} />}
      </Photo>
      <div style={{ padding: 16 }}>
        <div style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 16, color: colors.text, marginBottom: 3 }}>{e.title}</div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 5,
            fontSize: 13.5,
            color: colors.mutedLight,
            marginBottom: 6,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          <PinIcon size={12} style={{ flex: "none" }} /> {e.locationLabel}
        </div>
        <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
          {e.tags.map((t) => (
            <span key={t} style={{ fontSize: 11, fontWeight: 700, color: colors.muted, background: colors.panel, borderRadius: radius.pill, padding: "2px 8px", textTransform: "capitalize" }}>
              {t}
            </span>
          ))}
          {session && session.spotsLeft !== null && (
            <span style={{ fontSize: 12.5, color: session.spotsLeft <= 2 ? colors.orangeDark : colors.mutedLight, fontWeight: session.spotsLeft <= 2 ? 700 : 400 }}>
              {formatAvailability(session.spotsLeft)}
            </span>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontWeight: 700, fontSize: 15, color: e.priceCents ? colors.text : colors.greenText }}>
            {formatPrice(e.priceCents)}
            {e.priceCents && e.perPerson ? <span style={{ fontSize: 12, fontWeight: 600, color: colors.mutedLight }}> pp</span> : null}
          </span>
          <div className="stretched-link-above">
            <Button variant="dark" onClick={open} style={{ padding: "8px 16px", fontSize: 13 }}>
              {e.ctaLabel}
            </Button>
          </div>
        </div>
      </div>
    </Card>
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
  const [tag, setTag] = useState("All");
  const [when, setWhen] = useState<WhenFilter>("any");
  const [whenDate, setWhenDate] = useState("");
  const [price, setPrice] = useState<PriceTier>("any");
  const [sort, setSort] = useState<SortKey>(defaultSort);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const resultsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setLoading(true);
    config
      .load()
      .then(setItems)
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
    // `load` is recreated by callers on every render; resetKey is the real identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.resetKey]);

  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [query, county, tag, when, whenDate, price, sort]);

  useEffect(() => {
    // Reset page-specific filters when navigating between pages that share this layout.
    setQuery("");
    setCounty("All");
    setTag("All");
    setWhen("any");
    setWhenDate("");
    setPrice("any");
    setSort(defaultSort);
    setView("grid");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.resetKey]);

  const countyOptions = useMemo(() => uniqueSorted(items.map((e) => e.county)), [items]);
  const tagOptions = useMemo(() => uniqueSorted(items.map((e) => e.filterTag)), [items]);
  const showTagFilter = !!config.tagFilterLabel && tagOptions.length > 0;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((e) => {
      if (q && !e.searchText.includes(q)) return false;
      if (county !== "All" && e.county !== county) return false;
      if (showTagFilter && tag !== "All" && e.filterTag !== tag) return false;
      if (!dateWhenMatches(e, when, whenDate)) return false;
      if (price !== "any" && !priceMatches(e, price)) return false;
      return true;
    });
  }, [items, query, county, showTagFilter, tag, when, whenDate, price]);

  const sorted = useMemo(() => [...filtered].sort((a, b) => compareItems(a, b, sort)), [filtered, sort]);
  const visibleItems = sorted.slice(0, visibleCount);

  const activeCount = [county !== "All", showTagFilter && tag !== "All", when !== "any", price !== "any"].filter(Boolean).length;

  const activeChips = useMemo(() => {
    const chips: { key: string; label: string; onRemove: () => void }[] = [];
    if (county !== "All") chips.push({ key: "county", label: county, onRemove: () => setCounty("All") });
    if (showTagFilter && tag !== "All") chips.push({ key: "tag", label: tag, onRemove: () => setTag("All") });
    if (when !== "any") chips.push({ key: "when", label: when === "date" && whenDate ? dateLabel(whenDate) : WHEN_LABELS[when], onRemove: () => setWhen("any") });
    if (price !== "any") chips.push({ key: "price", label: PRICE_LABELS[price], onRemove: () => setPrice("any") });
    return chips;
  }, [county, showTagFilter, tag, when, whenDate, price]);

  const clearAllFilters = () => {
    setQuery("");
    setCounty("All");
    setTag("All");
    setWhen("any");
    setWhenDate("");
    setPrice("any");
  };

  const whenSummaryLabel = when === "date" && whenDate ? dateLabel(whenDate) : WHEN_LABELS[when];
  const sortKeys = (Object.keys(SORT_LABELS) as SortKey[]).filter((k) => k !== "featured" || config.supportsFeatured);

  const filterGroupStyle: CSSProperties = { padding: "16px 0", borderTop: `1px solid ${colors.border}` };
  const filterLabelStyle: CSSProperties = { fontSize: 11.5, fontWeight: 700, color: colors.mutedLight, textTransform: "uppercase", letterSpacing: ".04em", marginBottom: 8 };

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

      <div style={{ ...filterGroupStyle, paddingTop: 0 }}>
        <div style={filterLabelStyle}>When</div>
        {(["any", "today", "tomorrow", "weekend", "next7"] as WhenFilter[]).map((w) => (
          <DropdownOption key={w} label={WHEN_LABELS[w]} active={when === w} onClick={() => setWhen(w)} />
        ))}
        <DropdownOption label="Pick a date" active={when === "date"} onClick={() => setWhen("date")} />
        {when === "date" && (
          <input
            type="date"
            value={whenDate}
            onChange={(e) => setWhenDate(e.target.value)}
            style={{ marginTop: 4, fontSize: 13, padding: "7px 9px", width: "100%", border: `1px solid ${colors.inputBorder}`, borderRadius: 8, boxSizing: "border-box" }}
          />
        )}
      </div>

      {showTagFilter && (
        <div style={filterGroupStyle}>
          <div style={filterLabelStyle}>{config.tagFilterLabel}</div>
          <DropdownOption label={`Any ${config.tagFilterLabel!.toLowerCase()}`} active={tag === "All"} onClick={() => setTag("All")} />
          {tagOptions.map((d) => (
            <DropdownOption key={d} label={<span style={{ textTransform: "capitalize" }}>{d}</span>} active={tag === d} onClick={() => setTag(d)} />
          ))}
        </div>
      )}

      <div style={{ ...filterGroupStyle, paddingBottom: 0 }}>
        <div style={filterLabelStyle}>Price</div>
        {(["any", "under30", "30to50", "over50"] as PriceTier[]).map((p) => (
          <DropdownOption key={p} label={PRICE_LABELS[p]} active={price === p} onClick={() => setPrice(p)} />
        ))}
      </div>
    </>
  );

  return (
    <div style={{ animation: "fadeUp .35s ease both" }}>
      <section className="section-pad" style={{ maxWidth, margin: "0 auto", padding: "36px 24px 24px" }}>
        <PageTitle>{config.title}</PageTitle>
        <p style={{ color: colors.mutedLight, fontSize: 15, margin: 0 }}>{config.subtitle}</p>

        {/* Search / discovery card — a prominent free-text field on top,
            compact county/when refinements below it. */}
        <div style={{ border: `1px solid ${colors.border}`, borderRadius: radius.card, background: colors.surface, boxShadow: "0 8px 24px rgba(30,40,32,.05)", padding: 14, marginTop: 24, marginBottom: 16 }}>
          <div style={{ position: "relative" }}>
            <SearchIcon size={17} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: colors.faint }} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={config.searchPlaceholder}
              style={{ width: "100%", padding: "8px 8px 8px 36px", border: "none", background: "transparent", fontFamily: fonts.display, fontSize: 16.5, fontWeight: 600, color: colors.text, outline: "none", boxSizing: "border-box" }}
            />
          </div>
          <div style={{ height: 1, background: colors.border, margin: "10px 0" }} />
          <div className="stack-mobile" style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <select
              value={county}
              onChange={(e) => setCounty(e.target.value)}
              style={{ padding: "8px 12px", border: "none", borderRadius: radius.control, fontSize: 13.5, background: colors.panel, color: colors.text, fontWeight: 600 }}
            >
              <option value="All">Near: anywhere</option>
              {countyOptions.map((c) => (
                <option key={c} value={c}>Near: {c}</option>
              ))}
            </select>
            <select
              value={when}
              onChange={(e) => setWhen(e.target.value as WhenFilter)}
              style={{ padding: "8px 12px", border: "none", borderRadius: radius.control, fontSize: 13.5, background: colors.panel, color: colors.text, fontWeight: 600 }}
            >
              {(Object.keys(WHEN_LABELS) as WhenFilter[]).map((w) => (
                <option key={w} value={w}>{WHEN_LABELS[w]}</option>
              ))}
            </select>
            <div style={{ marginLeft: "auto" }}>
              <Button onClick={() => resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}>Search</Button>
            </div>
          </div>
        </div>

        {showTagFilter && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 20 }}>
            <Chip label="All" active={tag === "All"} onClick={() => setTag("All")} />
            {tagOptions.map((d) => (
              <Chip key={d} label={d.charAt(0).toUpperCase() + d.slice(1)} active={tag === d} onClick={() => setTag(tag === d ? "All" : d)} />
            ))}
          </div>
        )}
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
                ) : (
                  <>
                    {sorted.length > 0 && (
                      <div style={{ fontSize: 12, color: colors.faint, marginBottom: 2 }}>
                        Showing 1-{Math.min(visibleCount, sorted.length)} of {sorted.length}
                      </div>
                    )}
                    <div style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: 20, letterSpacing: "-.01em" }}>
                      {sorted.length}{" "}
                      <span style={{ fontFamily: fonts.body, fontWeight: 600, fontSize: 15, color: colors.mutedLight }}>
                        {config.nounPlural} {sorted.length === 1 ? "listing" : "nearby"}
                      </span>
                    </div>
                  </>
                )}
                <div style={{ fontSize: 13, color: colors.mutedLight, marginTop: 2 }}>
                  {county === "All" ? "Anywhere" : county} · {whenSummaryLabel}
                  {query.trim() && ` for "${query.trim()}"`}
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <button
                  className="games-filter-trigger"
                  onClick={() => setFiltersOpen(true)}
                  style={{ display: "inline-flex", alignItems: "center", gap: 6, border: `1.5px solid ${colors.borderStrong}`, background: "#fff", color: "#3B423C", borderRadius: 20, padding: "8px 14px", fontSize: 14, fontWeight: 600 }}
                >
                  Filters{activeCount > 0 ? ` (${activeCount})` : ""}
                </button>
                <select
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

            {!loading && config.supportsFeatured && sort === "featured" && sorted.length > 0 && (
              <div style={{ display: "flex", alignItems: "flex-start", gap: 10, background: "rgba(232,163,58,.12)", border: "1px solid rgba(232,163,58,.3)", borderRadius: 12, padding: "12px 16px", marginBottom: 20 }}>
                <LightbulbIcon size={16} style={{ color: colors.gold, flex: "none", marginTop: 1 }} />
                <div>
                  <div style={{ fontSize: 13.5, fontWeight: 700, color: colors.text }}>Showing our top picks first</div>
                  <div style={{ fontSize: 12.5, color: colors.mutedLight, marginTop: 1 }}>Featured listings, then whatever's departing soonest.</div>
                </div>
              </div>
            )}

            {activeChips.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 20 }}>
                {activeChips.map((c) => (
                  <button
                    key={c.key}
                    onClick={c.onRemove}
                    style={{ display: "inline-flex", alignItems: "center", gap: 5, background: colors.greenBg, color: colors.greenText, border: "none", borderRadius: 20, padding: "5px 10px 5px 12px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}
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
              <div className="grid-responsive-3" style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 20 }}>
                {Array.from({ length: PAGE_SIZE }, (_, i) => <CardSkeleton key={i} photoHeight={150} />)}
              </div>
            ) : sorted.length === 0 ? (
              <EmptyState
                icon={<UsersIcon size={22} />}
                title={items.length === 0 ? `No ${config.nounPlural} yet` : "Nothing matching that yet."}
                subtitle={items.length === 0 ? "Check back soon — new listings go up all the time." : "Try widening your search or clearing a filter."}
                action={
                  items.length > 0 ? (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center" }}>
                      {county !== "All" && <Chip label="Expand to anywhere" active={false} onClick={() => setCounty("All")} />}
                      {when !== "any" && <Chip label="Any time" active={false} onClick={() => setWhen("any")} />}
                      {activeCount > 0 && <Chip label="Clear filters" active={false} onClick={clearAllFilters} />}
                    </div>
                  ) : undefined
                }
              />
            ) : view === "map" ? (
              <DiscoveryMap
                pins={toPins(sorted)}
                searchTypes={config.mapSearchTypes}
                searchFilters={config.mapSearchTypes ? { q: query.trim() || undefined, ...priceTierToRange(price) } : undefined}
              />
            ) : (
              <>
                <div className="grid-responsive-3" style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 20 }}>
                  {visibleItems.map((e) => (
                    <BrowseCard key={e.id} e={e} icon={config.icon} />
                  ))}
                </div>
                {visibleCount < sorted.length && (
                  <div style={{ display: "flex", justifyContent: "center", marginTop: 28 }}>
                    <Button variant="ghost" onClick={() => setVisibleCount((v) => v + PAGE_SIZE)}>
                      Show more ({sorted.length - visibleCount} more)
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

      {/* Closing CTA band — echoes Games.tsx's own closing band. */}
      <section style={{ background: colors.dark }}>
        <div className="section-pad" style={{ maxWidth, margin: "0 auto", padding: "72px 24px 80px" }}>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 32 }}>
            <div>
              <div style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: ".09em", textTransform: "uppercase", color: "rgba(255,255,255,.5)", marginBottom: 10 }}>
                Keep exploring
              </div>
              <h2 style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: "clamp(26px, 3.6vw, 38px)", color: "#fff", margin: "0 0 10px", letterSpacing: "-.02em", lineHeight: 1.1 }}>
                Didn't find the right one?
              </h2>
              <p style={{ margin: 0, color: "rgba(255,255,255,.72)", fontSize: 16 }}>{config.closing.text}</p>
            </div>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <button
                className="btn"
                onClick={() => navigate(config.closing.primary.to)}
                style={{ display: "inline-flex", alignItems: "center", gap: 8, background: "#fff", color: colors.dark, border: "none", borderRadius: radius.control, padding: "12px 20px", fontSize: 14.5, fontWeight: 700, cursor: "pointer" }}
              >
                {config.closing.primary.label} <ArrowRightIcon size={14} />
              </button>
              <button
                className="btn"
                onClick={() => navigate(config.closing.secondary.to)}
                style={{ display: "inline-flex", alignItems: "center", gap: 8, background: "transparent", color: "#fff", border: "1px solid rgba(255,255,255,.4)", borderRadius: radius.control, padding: "12px 20px", fontSize: 14.5, fontWeight: 700, cursor: "pointer" }}
              >
                {config.closing.secondary.label} <ArrowRightIcon size={14} />
              </button>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
