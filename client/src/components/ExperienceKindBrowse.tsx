import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useNavigate } from "react-router-dom";
import { MapContainer, Marker, Popup, TileLayer } from "react-leaflet";
import { fetchExperiences } from "../api";
import { ArrowRightIcon, CalendarIcon, ClockIcon, CloseIcon, GridIcon, HeartIcon, LightbulbIcon, PinIcon, SearchIcon, TreeIconSmall, UsersIcon } from "./icons";
import { Chip } from "./Chip";
import { DropdownOption, FilterDropdown } from "./FilterDropdown";
import { Photo } from "./Photo";
import { PageTitle } from "./PageTitle";
import { Button, Card, CardSkeleton, Drawer, EmptyState } from "./ui";
import { isFavorite, toggleFavorite } from "../favorites";
import { dateLabel } from "../euro";
import { colors, fonts, maxWidth, radius } from "../theme";
import type { Experience, ExperienceKind, ExperienceSessionSlot } from "../types";

// Same marker-icon fix DiscoveryMap.tsx/SinglePinMap.tsx need — see either
// for why. Safe to re-apply (mergeOptions is idempotent).
import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";

L.Icon.Default.mergeOptions({ iconRetinaUrl: markerIcon2x, iconUrl: markerIcon, shadowUrl: markerShadow });

// Shared browse layout for the Adventures and Experiences pages (see
// pages/Adventures.tsx / pages/Experiences.tsx) — same underlying
// `experiences` table/fetch, split into two dedicated nav destinations/URLs
// rather than one page with a kind toggle, per the separation the user
// asked for. No kind switcher here — each page is now a single-purpose
// destination, so a toggle back to "the other kind" would just duplicate
// what the Explore nav already offers.
//
// Rebuilt (this pass) to match Games.tsx's "Join a Game" browse pattern —
// search-first hero, a sticky sidebar of real filters, a redesigned result
// card with a save button + upcoming-departure badge, sort/pagination, and
// a closing CTA band — rather than the original single filter-bar-plus-grid
// layout. Booking itself still happens on the detail page (ExperienceDetail
// picks the actual session), so unlike Games this page has no inline
// join/auth flow — every card CTA is just "View details".

const PAGE_SIZE = 12;

type WhenFilter = "any" | "today" | "tomorrow" | "weekend" | "next7" | "date";
type PriceTier = "any" | "under30" | "30to50" | "over50";
type SortKey = "featured" | "soonest" | "price-asc" | "price-desc";

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

function nextSession(e: Experience): ExperienceSessionSlot | null {
  return e.sessions[0] ?? null;
}

function uniqueSorted(values: (string | null | undefined)[]): string[] {
  return Array.from(new Set(values.filter((v): v is string => !!v))).sort((a, b) => a.localeCompare(b));
}

function relativeWhenLabel(iso: string): string {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d = new Date(`${iso}T00:00:00`);
  const diffDays = Math.round((d.getTime() - today.getTime()) / 86400000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Tomorrow";
  if (diffDays > 1 && diffDays < 7) return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getDay()];
  return dateLabel(iso);
}

function sessionWhenLabel(s: ExperienceSessionSlot): string {
  return `${relativeWhenLabel(s.date)} · ${s.time}`;
}

function priceMatches(e: Experience, tier: PriceTier): boolean {
  if (tier === "under30") return e.priceCents < 3000;
  if (tier === "30to50") return e.priceCents >= 3000 && e.priceCents <= 5000;
  if (tier === "over50") return e.priceCents > 5000;
  return true;
}

function dateWhenMatches(e: Experience, when: WhenFilter, whenDate: string): boolean {
  if (when === "any") return true;
  const session = nextSession(e);
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

function matchesText(e: Experience, q: string): boolean {
  if (!q) return true;
  const hay = `${e.title} ${e.blurb} ${e.area} ${e.county}`.toLowerCase();
  return hay.includes(q);
}

function compareExperiences(a: Experience, b: Experience, sort: SortKey): number {
  if (sort === "price-asc") return a.priceCents - b.priceCents;
  if (sort === "price-desc") return b.priceCents - a.priceCents;
  if (sort === "soonest") {
    const sa = nextSession(a);
    const sb = nextSession(b);
    if (!sa && !sb) return 0;
    if (!sa) return 1;
    if (!sb) return -1;
    return `${sa.date}${sa.time}`.localeCompare(`${sb.date}${sb.time}`);
  }
  // featured: featured rows first, then soonest upcoming departure.
  const featuredDiff = Number(b.featured) - Number(a.featured);
  if (featuredDiff !== 0) return featuredDiff;
  const sa = nextSession(a);
  const sb = nextSession(b);
  if (!sa && !sb) return 0;
  if (!sa) return 1;
  if (!sb) return -1;
  return `${sa.date}${sa.time}`.localeCompare(`${sb.date}${sb.time}`);
}

// --- Map view (unchanged behavior from the previous version of this file) -

const IRELAND_CENTER: [number, number] = [53.4, -8.0];

function ExperienceMap({ items }: { items: Experience[] }) {
  const navigate = useNavigate();
  const pins = items.filter((e) => e.lat !== null && e.lng !== null);
  return (
    <div style={{ borderRadius: radius.card, overflow: "hidden", border: `1px solid ${colors.border}`, height: 520 }}>
      <MapContainer center={IRELAND_CENTER} zoom={7} style={{ height: "100%", width: "100%" }} scrollWheelZoom>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {pins.map((e) => (
          <Marker key={e.id} position={[e.lat as number, e.lng as number]}>
            <Popup>
              <div style={{ minWidth: 160 }}>
                <div style={{ fontWeight: 700, marginBottom: 2 }}>{e.title}</div>
                <div style={{ fontSize: 12.5, color: "#5B635C", marginBottom: 6 }}>{e.area}{e.area && e.county ? ", " : ""}{e.county}</div>
                <div style={{ fontSize: 12.5, marginBottom: 8 }}>{e.priceCents ? `€${(e.priceCents / 100).toFixed(2)}pp` : "Free"}</div>
                <button
                  onClick={() => navigate(`/${e.kind === "adventure" ? "adventures" : "experiences"}/${e.slug ?? e.id}`)}
                  style={{ background: colors.dark, color: "#fff", border: "none", borderRadius: 8, padding: "6px 10px", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}
                >
                  View details
                </button>
              </div>
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
}

// --- Browse card (this page's grid only — ExperienceCard.tsx elsewhere is
// unchanged, since Home.tsx and ExperienceDetail.tsx's "similar" rail still
// use its more compact layout) --------------------------------------------

function ExperienceBrowseCard({ e }: { e: Experience }) {
  const navigate = useNavigate();
  const [saved, setSaved] = useState(() => isFavorite("experience", e.id));
  const session = nextSession(e);
  const kindPath = e.kind === "adventure" ? "adventures" : "experiences";
  const open = () => navigate(`/${kindPath}/${e.slug ?? e.id}`);

  return (
    <Card hover style={{ padding: 0, overflow: "hidden" }}>
      <Photo
        src={e.imageUrl || undefined}
        alt={e.title}
        ph={e.kind === "adventure" ? colors.greenBg : colors.orangeBg}
        icon={<TreeIconSmall size={24} />}
        iconColor={e.kind === "adventure" ? colors.greenText : colors.orangeDark}
        style={{ height: 150 }}
        contentStyle={{ padding: 10, display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}
      >
        {session ? (
          <span
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
            }}
          >
            <ClockIcon size={12} /> {sessionWhenLabel(session)}
          </span>
        ) : (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              background: "rgba(255,255,255,.85)",
              color: colors.muted,
              borderRadius: radius.pill,
              padding: "5px 11px",
              fontSize: 12,
              fontWeight: 700,
            }}
          >
            No dates yet
          </span>
        )}
        <button
          onClick={(ev) => {
            ev.stopPropagation();
            setSaved(toggleFavorite("experience", e.id));
          }}
          aria-label={saved ? "Remove from saved" : "Save this listing"}
          className="btn"
          style={{
            width: 30,
            height: 30,
            borderRadius: "50%",
            border: "none",
            background: "rgba(255,255,255,.9)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: saved ? colors.orange : "#8A928B",
            flex: "none",
          }}
        >
          <HeartIcon size={14} filled={saved} />
        </button>
      </Photo>
      <div style={{ padding: 16 }}>
        <button
          onClick={open}
          style={{
            background: "none",
            border: "none",
            padding: 0,
            cursor: "pointer",
            textAlign: "left",
            display: "block",
            fontFamily: fonts.display,
            fontWeight: 700,
            fontSize: 16,
            color: colors.text,
            marginBottom: 3,
          }}
        >
          {e.title}
        </button>
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
          <PinIcon size={12} style={{ flex: "none" }} /> {e.area}{e.area && e.county ? ", " : ""}{e.county}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
          {e.difficulty && (
            <span style={{ fontSize: 11, fontWeight: 700, color: colors.muted, background: colors.panel, borderRadius: radius.pill, padding: "2px 8px", textTransform: "capitalize" }}>
              {e.difficulty}
            </span>
          )}
          {session && (
            <span style={{ fontSize: 12.5, color: session.spotsLeft <= 2 ? colors.orangeDark : colors.mutedLight, fontWeight: session.spotsLeft <= 2 ? 700 : 400 }}>
              {session.spotsLeft === 0 ? "Full" : session.spotsLeft === 1 ? "1 spot left" : `${session.spotsLeft} spots left`}
            </span>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontWeight: 700, fontSize: 15, color: e.priceCents ? colors.text : colors.greenText }}>
            {e.priceCents ? `€${(e.priceCents / 100).toFixed(2)}` : "Free"}
            {e.priceCents ? <span style={{ fontSize: 12, fontWeight: 600, color: colors.mutedLight }}> pp</span> : null}
          </span>
          <Button variant="dark" onClick={open} style={{ padding: "8px 16px", fontSize: 13 }}>
            View details
          </Button>
        </div>
      </div>
    </Card>
  );
}

export function ExperienceKindBrowse({ kind, title, subtitle }: { kind: ExperienceKind; title: string; subtitle: string }) {
  const navigate = useNavigate();
  const [experiences, setExperiences] = useState<Experience[]>([]);
  const [loading, setLoading] = useState(true);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [view, setView] = useState<"grid" | "map">("grid");

  const [query, setQuery] = useState("");
  const [county, setCounty] = useState("All");
  const [difficulty, setDifficulty] = useState("All");
  const [when, setWhen] = useState<WhenFilter>("any");
  const [whenDate, setWhenDate] = useState("");
  const [price, setPrice] = useState<PriceTier>("any");
  const [sort, setSort] = useState<SortKey>("featured");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const resultsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setLoading(true);
    fetchExperiences(kind)
      .then(setExperiences)
      .finally(() => setLoading(false));
  }, [kind]);

  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [query, county, difficulty, when, whenDate, price, sort]);

  useEffect(() => {
    // Reset kind-specific filters when navigating between /adventures and /experiences.
    setQuery("");
    setCounty("All");
    setDifficulty("All");
    setWhen("any");
    setWhenDate("");
    setPrice("any");
    setSort("featured");
    setView("grid");
  }, [kind]);

  const countyOptions = useMemo(() => uniqueSorted(experiences.map((e) => e.county)), [experiences]);
  const difficultyOptions = useMemo(() => uniqueSorted(experiences.map((e) => e.difficulty)), [experiences]);
  const showDifficulty = kind === "adventure" && difficultyOptions.length > 0;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return experiences.filter((e) => {
      if (!matchesText(e, q)) return false;
      if (county !== "All" && e.county !== county) return false;
      if (showDifficulty && difficulty !== "All" && e.difficulty !== difficulty) return false;
      if (!dateWhenMatches(e, when, whenDate)) return false;
      if (price !== "any" && !priceMatches(e, price)) return false;
      return true;
    });
  }, [experiences, query, county, showDifficulty, difficulty, when, whenDate, price]);

  const sorted = useMemo(() => [...filtered].sort((a, b) => compareExperiences(a, b, sort)), [filtered, sort]);
  const visibleItems = sorted.slice(0, visibleCount);

  const activeCount = [county !== "All", showDifficulty && difficulty !== "All", when !== "any", price !== "any"].filter(Boolean).length;

  const activeChips = useMemo(() => {
    const chips: { key: string; label: string; onRemove: () => void }[] = [];
    if (county !== "All") chips.push({ key: "county", label: county, onRemove: () => setCounty("All") });
    if (showDifficulty && difficulty !== "All") chips.push({ key: "difficulty", label: difficulty, onRemove: () => setDifficulty("All") });
    if (when !== "any") chips.push({ key: "when", label: when === "date" && whenDate ? dateLabel(whenDate) : WHEN_LABELS[when], onRemove: () => setWhen("any") });
    if (price !== "any") chips.push({ key: "price", label: PRICE_LABELS[price], onRemove: () => setPrice("any") });
    return chips;
  }, [county, showDifficulty, difficulty, when, whenDate, price]);

  const clearAllFilters = () => {
    setQuery("");
    setCounty("All");
    setDifficulty("All");
    setWhen("any");
    setWhenDate("");
    setPrice("any");
  };

  const whenSummaryLabel = when === "date" && whenDate ? dateLabel(whenDate) : WHEN_LABELS[when];
  const nounPlural = kind === "adventure" ? "adventures" : "experiences";
  const otherKindPath = kind === "adventure" ? "/experiences" : "/adventures";
  const otherKindLabel = kind === "adventure" ? "Experiences" : "Adventures";

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

      {showDifficulty && (
        <div style={filterGroupStyle}>
          <div style={filterLabelStyle}>Difficulty</div>
          <DropdownOption label="Any difficulty" active={difficulty === "All"} onClick={() => setDifficulty("All")} />
          {difficultyOptions.map((d) => (
            <DropdownOption key={d} label={<span style={{ textTransform: "capitalize" }}>{d}</span>} active={difficulty === d} onClick={() => setDifficulty(d)} />
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
        <PageTitle>{title}</PageTitle>
        <p style={{ color: colors.mutedLight, fontSize: 15, margin: 0 }}>{subtitle}</p>

        {/* Search / discovery card — mirrors Games.tsx: a prominent free-text
            field on top, compact county/when refinements below it. */}
        <div style={{ border: `1px solid ${colors.border}`, borderRadius: radius.card, background: colors.surface, boxShadow: "0 8px 24px rgba(30,40,32,.05)", padding: 14, marginTop: 24, marginBottom: 16 }}>
          <div style={{ position: "relative" }}>
            <SearchIcon size={17} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: colors.faint }} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={kind === "adventure" ? "What kind of adventure? e.g. Kayaking" : "What do you feel like doing? e.g. Pottery"}
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

        {showDifficulty && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 20 }}>
            <Chip label="All" active={difficulty === "All"} onClick={() => setDifficulty("All")} />
            {difficultyOptions.map((d) => (
              <Chip key={d} label={d.charAt(0).toUpperCase() + d.slice(1)} active={difficulty === d} onClick={() => setDifficulty(difficulty === d ? "All" : d)} />
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
                        {nounPlural} {sorted.length === 1 ? "listing" : "nearby"}
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
                  {(Object.keys(SORT_LABELS) as SortKey[]).map((k) => (
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

            {!loading && sort === "featured" && sorted.length > 0 && (
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
                title={experiences.length === 0 ? `No ${nounPlural} yet` : "Nothing matching that yet."}
                subtitle={
                  experiences.length === 0
                    ? "Check back soon — new listings go up all the time."
                    : "Try widening your search or clearing a filter."
                }
                action={
                  experiences.length > 0 ? (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center" }}>
                      {county !== "All" && <Chip label="Expand to anywhere" active={false} onClick={() => setCounty("All")} />}
                      {when !== "any" && <Chip label="Any time" active={false} onClick={() => setWhen("any")} />}
                      {activeCount > 0 && <Chip label="Clear filters" active={false} onClick={clearAllFilters} />}
                    </div>
                  ) : undefined
                }
              />
            ) : view === "map" ? (
              <ExperienceMap items={sorted} />
            ) : (
              <>
                <div className="grid-responsive-3" style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 20 }}>
                  {visibleItems.map((e) => (
                    <ExperienceBrowseCard key={e.id} e={e} />
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

      {/* Closing CTA band — echoes Games.tsx's own closing band (Swiss/
          minimal type treatment), pointed at the other kind + Games instead
          of a "host your own" CTA, since these are vendor-listed, not
          resident-hosted. */}
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
              <p style={{ margin: 0, color: "rgba(255,255,255,.72)", fontSize: 16 }}>
                {kind === "adventure" ? "Browse workshops and classes, or just join a game happening nearby." : "Browse guided outdoor trips, or just join a game happening nearby."}
              </p>
            </div>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <button
                className="btn"
                onClick={() => navigate(otherKindPath)}
                style={{ display: "inline-flex", alignItems: "center", gap: 8, background: "#fff", color: colors.dark, border: "none", borderRadius: radius.control, padding: "12px 20px", fontSize: 14.5, fontWeight: 700, cursor: "pointer" }}
              >
                Browse {otherKindLabel} <ArrowRightIcon size={14} />
              </button>
              <button
                className="btn"
                onClick={() => navigate("/games")}
                style={{ display: "inline-flex", alignItems: "center", gap: 8, background: "transparent", color: "#fff", border: "1px solid rgba(255,255,255,.4)", borderRadius: radius.control, padding: "12px 20px", fontSize: 14.5, fontWeight: 700, cursor: "pointer" }}
              >
                Join a Game instead <ArrowRightIcon size={14} />
              </button>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
