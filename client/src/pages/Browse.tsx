import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { fetchCentres, fetchClubs } from "../api";
import { BrowseTicker } from "../components/BrowseTicker";
import { CentreCard } from "../components/CentreCard";
import { ClubCard } from "../components/ClubCard";
import { DiscoveryMap, type DiscoveryMapPin } from "../components/DiscoveryMap";
import { euro } from "../euro";
import { DropdownCheckbox, DropdownOption, FilterDropdown } from "../components/FilterDropdown";
import { CheckIcon, ChevronLeftIcon, ChevronRightIcon, CloseIcon, GridIcon, HomeIcon, PinIcon, SearchIcon } from "../components/icons";
import { IntentCaptureForm } from "../components/IntentCaptureForm";
import { Button, CardSkeleton, EmptyState } from "../components/ui";
import { colors, fonts, maxWidth, radius } from "../theme";
import type { Centre, Club } from "../types";

// Compare mode (post-audit hardening pass) — folded in from the old
// standalone /compare page (Compare.tsx, now removed/redirected here), since
// it only ever compared centres via the same fetchCentres() data this page
// already loads. Kept centres-only, matching that page's own original
// scoping ("most valuable for venues/facilities, not every activity").
const MAX_COMPARE = 3;
const COMPARE_ROWS: { label: string; render: (c: Centre) => string }[] = [
  { label: "Area", render: (c) => `${c.area}, ${c.county}` },
  { label: "From", render: (c) => `€${c.from}/hr` },
  { label: "Capacity", render: (c) => String(c.capacity) },
  { label: "Rating", render: (c) => (c.reviews ? `${c.rating.toFixed(1)} (${c.reviews})` : "No reviews yet") },
  { label: "Would repeat", render: (c) => (c.wouldRepeatPercent !== null ? `${c.wouldRepeatPercent}%` : "—") },
  { label: "Opening hours", render: (c) => `${c.opensAt}–${c.closesAt}` },
  { label: "Payment", render: (c) => (c.paymentMethod === "cash" ? "Cash on arrival" : "Online") },
  { label: "Amenities", render: (c) => (c.amenities.length ? c.amenities.join(", ") : "—") },
  { label: "Accessibility", render: (c) => (c.accessibility.length ? c.accessibility.join(", ") : "—") },
];

type SortKey = "popular" | "price-asc" | "price-desc" | "name";

const SORT_LABELS: Record<SortKey, string> = {
  popular: "Popular",
  "price-asc": "Price: Low to High",
  "price-desc": "Price: High to Low",
  name: "Name: A–Z",
};

// A multiple of the 4-column grid below, so every page but the last renders
// full rows instead of a trailing partial row (was 6 — a leftover from
// before the grid went from 3 to 4 columns).
const PAGE_SIZE = 12;

function centrePrice(c: Centre) {
  return c.from;
}
function clubPrice(c: Club) {
  return c.price;
}

function uniqueSorted(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean))).sort((a, b) => a.localeCompare(b));
}

export function Browse() {
  const { category } = useParams<{ category: "centres" | "clubs" }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const county = searchParams.get("county") || "All";
  const sport = searchParams.get("sport") || "All";
  const selectedAmenities = useMemo(() => (searchParams.get("amenities") || "").split(",").filter(Boolean), [searchParams]);
  const selectedAccessibility = useMemo(() => (searchParams.get("accessibility") || "").split(",").filter(Boolean), [searchParams]);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("popular");
  const [page, setPage] = useState(1);
  const [view, setView] = useState<"list" | "map">("list");
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [compareOpen, setCompareOpen] = useState(false);

  const isClubs = category === "clubs";
  const [centres, setCentres] = useState<Centre[]>([]);
  const [clubs, setClubs] = useState<Club[]>([]);
  const [loading, setLoading] = useState(true);
  const [countyOptions, setCountyOptions] = useState<string[]>([]);
  const [sportOptions, setSportOptions] = useState<string[]>(["All"]);
  const [amenityOptions, setAmenityOptions] = useState<string[]>([]);
  const [accessibilityOptions, setAccessibilityOptions] = useState<string[]>([]);

  useEffect(() => {
    setLoading(true);
    if (isClubs) {
      fetchClubs(county, sport).then((rows) => {
        setClubs(rows);
        setLoading(false);
      });
    } else {
      fetchCentres(county).then((rows) => {
        setCentres(rows);
        setLoading(false);
      });
    }
  }, [isClubs, county, sport]);

  // Filter chips reflect whatever counties/sports actually exist in the data,
  // not a fixed list — fetched unfiltered so switching county/sport doesn't
  // shrink the chip set to match the current filter.
  useEffect(() => {
    if (isClubs) {
      fetchClubs().then((rows) => {
        setCountyOptions(uniqueSorted(rows.map((r) => r.county)));
        setSportOptions(["All", ...uniqueSorted(rows.map((r) => r.sport))]);
        setAccessibilityOptions(uniqueSorted(rows.flatMap((r) => r.accessibility)));
        setAmenityOptions([]);
      });
    } else {
      fetchCentres().then((rows) => {
        setCountyOptions(uniqueSorted(rows.map((r) => r.county)));
        setAmenityOptions(uniqueSorted(rows.flatMap((r) => r.amenities)));
        setAccessibilityOptions(uniqueSorted(rows.flatMap((r) => r.accessibility)));
      });
    }
  }, [isClubs]);

  useEffect(() => {
    setPage(1);
    setQuery("");
    setCompareIds([]);
    setCompareOpen(false);
  }, [isClubs, county, sport]);

  const toggleCompare = (id: string) => {
    setCompareIds((ids) => {
      if (ids.includes(id)) return ids.filter((i) => i !== id);
      if (ids.length >= MAX_COMPARE) return ids;
      return [...ids, id];
    });
  };
  const comparedCentres = compareIds.map((id) => centres.find((c) => c.id === id)).filter((c): c is Centre => !!c);

  useEffect(() => {
    setPage(1);
  }, [selectedAmenities, selectedAccessibility]);

  const setCounty = (c: string) => {
    const next = new URLSearchParams(searchParams);
    next.set("county", c);
    setSearchParams(next);
  };
  const setSport = (s: string) => {
    const next = new URLSearchParams(searchParams);
    next.set("sport", s);
    setSearchParams(next);
  };
  const toggleAmenity = (a: string) => {
    const next = new URLSearchParams(searchParams);
    const nextList = selectedAmenities.includes(a) ? selectedAmenities.filter((x) => x !== a) : [...selectedAmenities, a];
    if (nextList.length) next.set("amenities", nextList.join(","));
    else next.delete("amenities");
    setSearchParams(next);
  };
  const toggleAccessibility = (a: string) => {
    const next = new URLSearchParams(searchParams);
    const nextList = selectedAccessibility.includes(a) ? selectedAccessibility.filter((x) => x !== a) : [...selectedAccessibility, a];
    if (nextList.length) next.set("accessibility", nextList.join(","));
    else next.delete("accessibility");
    setSearchParams(next);
  };
  const clearAmenities = () => {
    const next = new URLSearchParams(searchParams);
    next.delete("amenities");
    setSearchParams(next);
  };
  const clearAccessibility = () => {
    const next = new URLSearchParams(searchParams);
    next.delete("accessibility");
    setSearchParams(next);
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows: (Centre | Club)[] = isClubs ? clubs : centres;
    const searched = q
      ? rows.filter((r) => r.name.toLowerCase().includes(q) || r.area.toLowerCase().includes(q))
      : rows;
    // Every selected chip must be present on the listing — a guest picking
    // both "Wheelchair accessible" and "Hearing loop" needs both, not either.
    const withAmenities = selectedAmenities.length
      ? searched.filter((r) => !isClubs && selectedAmenities.every((a) => (r as Centre).amenities.includes(a)))
      : searched;
    const withAccessibility = selectedAccessibility.length
      ? withAmenities.filter((r) => selectedAccessibility.every((a) => r.accessibility.includes(a)))
      : withAmenities;
    const sorted = [...withAccessibility].sort((a, b) => {
      if (sort === "name") return a.name.localeCompare(b.name);
      if (sort === "price-asc") return (isClubs ? clubPrice(a as Club) : centrePrice(a as Centre)) - (isClubs ? clubPrice(b as Club) : centrePrice(b as Centre));
      if (sort === "price-desc") return (isClubs ? clubPrice(b as Club) : centrePrice(b as Centre)) - (isClubs ? clubPrice(a as Club) : centrePrice(a as Centre));
      return b.rating - a.rating || b.reviews - a.reviews;
    });
    return sorted;
  }, [isClubs, clubs, centres, query, sort, selectedAmenities, selectedAccessibility]);

  const mapPins = useMemo<DiscoveryMapPin[]>(
    () =>
      filtered
        .filter((r) => r.lat !== null && r.lng !== null)
        .map((r) =>
          isClubs
            ? {
                id: r.id,
                lat: (r as Club).lat as number,
                lng: (r as Club).lng as number,
                title: r.name,
                subtitle: `${r.area} · ${r.county}`,
                priceLabel: `${euro((r as Club).price)} / ${(r as Club).unit}`,
                href: `/clubs/${(r as Club).slug ?? r.id}`,
                locationSource: (r as Club).locationSource,
              }
            : {
                id: r.id,
                lat: (r as Centre).lat as number,
                lng: (r as Centre).lng as number,
                title: r.name,
                subtitle: `${r.area} · ${r.county}`,
                priceLabel: `From ${euro((r as Centre).from)}`,
                href: `/centres/${(r as Centre).slug ?? r.id}`,
                locationSource: (r as Centre).locationSource,
              }
        ),
    [filtered, isClubs]
  );

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageSafe = Math.min(page, totalPages);
  const pageRows = filtered.slice((pageSafe - 1) * PAGE_SIZE, pageSafe * PAGE_SIZE);
  const accent = isClubs ? "orange" : "green";

  const allBtnActive = county === "All";

  return (
    <div className="fade-panel">
      <section className="section-pad" style={{ maxWidth, margin: "0 auto", padding: "26px 24px 12px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: colors.mutedLight, marginBottom: 16 }}>
          <Link to="/home" className="link-accent" style={{ textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 4, color: colors.mutedLight }}>
            <HomeIcon size={14} /> Home
          </Link>
          <ChevronRightIcon size={12} style={{ color: colors.faint }} />
          <span style={{ fontWeight: 600, color: colors.text }}>{isClubs ? "Sports clubs" : "Community centres"}</span>
        </div>

        {/* Warm Swiss editorial header — same typographic system as My
            Life's MyLifeHeader: a small uppercase eyebrow, a large display
            h1, a muted display-font subtitle, then a plain fact line. No
            colored panel, no decorative illustration — profile/browse
            identity here is carried by typography, not a graphic. The
            List/Map toggle sits top-right, same position as My Life's
            action-button cluster — moved up from the filter bar below
            since it's a real, always-present control (unlike Compare,
            which only appears once centres are selected), not filler. */}
        <div style={{ marginBottom: 32 }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 24, flexWrap: "wrap" }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: ".08em", color: colors.mutedLight, marginBottom: 14 }}>
                / {isClubs ? "SPORTS CLUBS" : "COMMUNITY CENTRES"}
              </div>
              <h1
                style={{
                  fontFamily: fonts.display, fontWeight: 800, letterSpacing: "-.02em", lineHeight: 1.04,
                  fontSize: "clamp(32px,5vw,52px)", margin: "0 0 10px", color: colors.text,
                }}
              >
                {isClubs ? "Sports clubs" : "Community centres"}
              </h1>
              <p style={{ fontFamily: fonts.display, fontWeight: 600, fontSize: "clamp(17px,2vw,21px)", color: colors.mutedLight, margin: "0 0 16px", maxWidth: 560, lineHeight: 1.3 }}>
                {isClubs
                  ? "Find GAA, soccer, swimming, rugby and more for every age. Many clubs offer a free trial session before you commit."
                  : "Book a hall for birthdays, meetings, classes or family celebrations. Compare capacity and prices from verified centres near you."}
              </p>
              <div style={{ fontSize: 13.5, fontWeight: 600, color: colors.textSoft }}>
                {loading ? "Loading…" : (
                  <>
                    {filtered.length} result{filtered.length === 1 ? "" : "s"}{county === "All" ? " across Ireland" : ` in ${county}`}
                    {query && ` matching "${query}"`}
                  </>
                )}
              </div>
            </div>
            <div style={{ display: "flex", border: `1px solid ${colors.inputBorder}`, borderRadius: 11, overflow: "hidden", flex: "none" }}>
              {(["list", "map"] as const).map((v) => (
                <button
                  key={v}
                  onClick={() => setView(v)}
                  className="btn"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "9px 13px",
                    border: "none",
                    background: view === v ? colors[accent] : colors.bg,
                    color: view === v ? "#fff" : colors.text,
                    fontSize: 13.5,
                    fontWeight: 600,
                  }}
                >
                  {v === "list" ? <GridIcon size={13} /> : <PinIcon size={13} />}
                  {v === "list" ? "List" : "Map"}
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="section-pad" style={{ maxWidth, margin: "0 auto", padding: "20px 24px 12px" }}>
        {/* Filter bar (UX pass) — every filter is now a dropdown rather than
            every individual option rendered as its own inline chip. With 16
            counties + 25+ amenities, the old chip rows grew to 4 wrapped
            lines before a single result was visible (see the community-
            centres screenshot this was raised against) — a single-row
            toolbar of "Location ▾ / Amenities ▾ / Accessibility ▾" plus
            search/sort/view reads immediately, and each panel scrolls
            internally instead of pushing the page down. */}
        <div style={{ background: "#fff", border: `1px solid ${colors.border}`, borderRadius: radius.card, padding: 16, marginBottom: 22, boxShadow: "0 6px 20px rgba(30,40,32,.04)" }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
            <FilterDropdown
              label={<span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><PinIcon size={13} />{county === "All" ? "All counties" : county}</span>}
              active={!allBtnActive}
              accent={accent}
            >
              <DropdownOption label="All counties" active={allBtnActive} onClick={() => setCounty("All")} />
              {countyOptions.map((c) => (
                <DropdownOption key={c} label={c} active={county === c} onClick={() => setCounty(c)} />
              ))}
            </FilterDropdown>

            {isClubs && sportOptions.length > 1 && (
              <FilterDropdown label={sport === "All" ? "Any sport" : sport} active={sport !== "All"} accent="orange">
                {sportOptions.map((s) => (
                  <DropdownOption key={s} label={s === "All" ? "Any sport" : s} active={sport === s} onClick={() => setSport(s)} />
                ))}
              </FilterDropdown>
            )}

            {!isClubs && amenityOptions.length > 0 && (
              <FilterDropdown label={`Amenities${selectedAmenities.length ? ` (${selectedAmenities.length})` : ""}`} active={selectedAmenities.length > 0} accent={accent}>
                {amenityOptions.map((a) => (
                  <DropdownCheckbox key={a} label={a} checked={selectedAmenities.includes(a)} onChange={() => toggleAmenity(a)} />
                ))}
                {selectedAmenities.length > 0 && (
                  <button onClick={clearAmenities} style={{ display: "block", width: "100%", textAlign: "left", background: "none", border: "none", borderTop: `1px solid ${colors.border}`, marginTop: 6, paddingTop: 8, padding: "8px 10px 2px", fontSize: 13, fontWeight: 700, color: colors.muted, cursor: "pointer" }}>
                    Clear amenities
                  </button>
                )}
              </FilterDropdown>
            )}

            {accessibilityOptions.length > 0 && (
              <FilterDropdown label={`Accessibility${selectedAccessibility.length ? ` (${selectedAccessibility.length})` : ""}`} active={selectedAccessibility.length > 0} accent={accent}>
                {accessibilityOptions.map((a) => (
                  <DropdownCheckbox key={a} label={a} checked={selectedAccessibility.includes(a)} onChange={() => toggleAccessibility(a)} />
                ))}
                {selectedAccessibility.length > 0 && (
                  <button onClick={clearAccessibility} style={{ display: "block", width: "100%", textAlign: "left", background: "none", border: "none", borderTop: `1px solid ${colors.border}`, marginTop: 6, paddingTop: 8, padding: "8px 10px 2px", fontSize: 13, fontWeight: 700, color: colors.muted, cursor: "pointer" }}>
                    Clear accessibility
                  </button>
                )}
              </FilterDropdown>
            )}

            <div style={{ marginLeft: "auto", display: "flex", gap: 10, flexWrap: "wrap" }}>
              <div style={{ position: "relative" }}>
                <SearchIcon size={14} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: colors.faint }} />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={`Search ${isClubs ? "clubs" : "centres"}…`}
                  style={{
                    padding: "9px 12px 9px 32px",
                    border: `1px solid ${colors.inputBorder}`,
                    borderRadius: 11,
                    fontSize: 14,
                    background: colors.bg,
                    color: colors.text,
                    outline: "none",
                    width: 190,
                  }}
                />
              </div>
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value as SortKey)}
                style={{
                  padding: "9px 12px",
                  border: `1px solid ${colors.inputBorder}`,
                  borderRadius: 11,
                  fontSize: 14,
                  background: colors.bg,
                  color: colors.text,
                  outline: "none",
                  fontWeight: 600,
                }}
              >
                {(Object.keys(SORT_LABELS) as SortKey[]).map((k) => (
                  <option key={k} value={k}>
                    Sort by: {SORT_LABELS[k]}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </section>

      <section className="section-pad" style={{ maxWidth, margin: "0 auto", padding: "0 24px 40px" }}>
        {loading ? (
          <div className="grid-responsive-3" style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 20 }}>
            {Array.from({ length: PAGE_SIZE }, (_, i) => <CardSkeleton key={i} photoHeight={140} />)}
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<SearchIcon size={28} />}
            title="No results"
            subtitle="Try a different area, search term, or clear the filters."
            action={<IntentCaptureForm activityLabel={(isClubs && sport !== "All" ? sport : query) || (isClubs ? "clubs" : "centres")} county={county === "All" ? "" : county} />}
          />
        ) : view === "map" ? (
          <DiscoveryMap pins={mapPins} searchTypes={[isClubs ? "club" : "centre"]} searchFilters={{ q: query.trim() || undefined }} />
        ) : (
          <div className="grid-responsive-3" style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 20 }}>
            {isClubs
              ? (pageRows as Club[]).map((c) => <ClubCard key={c.id} club={c} />)
              : (pageRows as Centre[]).map((c) => {
                  const picked = compareIds.includes(c.id);
                  return (
                    <div key={c.id} style={{ position: "relative" }}>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleCompare(c.id);
                        }}
                        aria-label={picked ? `Remove ${c.name} from comparison` : `Add ${c.name} to comparison`}
                        disabled={!picked && compareIds.length >= MAX_COMPARE}
                        style={{
                          position: "absolute",
                          top: 10,
                          left: 10,
                          zIndex: 1,
                          width: 28,
                          height: 28,
                          borderRadius: "50%",
                          border: "none",
                          background: picked ? colors.green : "rgba(255,255,255,.9)",
                          color: picked ? "#fff" : colors.text,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          cursor: !picked && compareIds.length >= MAX_COMPARE ? "not-allowed" : "pointer",
                          opacity: !picked && compareIds.length >= MAX_COMPARE ? 0.5 : 1,
                          fontSize: 13,
                          fontWeight: 700,
                        }}
                      >
                        {picked ? <CheckIcon size={14} /> : "+"}
                      </button>
                      <CentreCard centre={c} />
                    </div>
                  );
                })}
          </div>
        )}
      </section>

      {view === "list" && !loading && filtered.length > 0 && (
        <section className="section-pad" style={{ maxWidth, margin: "0 auto", padding: "0 24px 70px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
          <span style={{ color: colors.mutedLight, fontSize: 14 }}>
            Showing {(pageSafe - 1) * PAGE_SIZE + 1} to {Math.min(pageSafe * PAGE_SIZE, filtered.length)} of {filtered.length} results
          </span>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <button
              className="btn btn-ghost"
              disabled={pageSafe === 1}
              onClick={() => setPage(pageSafe - 1)}
              style={{ width: 34, height: 34, borderRadius: "50%", border: `1px solid ${colors.borderStrong}`, background: "#fff", display: "flex", alignItems: "center", justifyContent: "center", opacity: pageSafe === 1 ? 0.4 : 1 }}
            >
              <ChevronLeftIcon size={16} />
            </button>
            {Array.from({ length: totalPages }, (_, i) => i + 1).map((n) => (
              <button
                key={n}
                onClick={() => setPage(n)}
                className="btn"
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: "50%",
                  border: "none",
                  background: n === pageSafe ? colors[accent] : "transparent",
                  color: n === pageSafe ? "#fff" : colors.text,
                  fontWeight: 700,
                  fontSize: 14,
                }}
              >
                {n}
              </button>
            ))}
            <button
              className="btn btn-ghost"
              disabled={pageSafe === totalPages}
              onClick={() => setPage(pageSafe + 1)}
              style={{ width: 34, height: 34, borderRadius: "50%", border: `1px solid ${colors.borderStrong}`, background: "#fff", display: "flex", alignItems: "center", justifyContent: "center", opacity: pageSafe === totalPages ? 0.4 : 1 }}
            >
              <ChevronRightIcon size={16} />
            </button>
          </div>
        </section>
      )}

      {!isClubs && compareIds.length > 0 && (
        <div style={{ position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 20, background: "#fff", borderTop: `1px solid ${colors.border}`, boxShadow: "0 -6px 20px rgba(30,40,32,.08)" }}>
          {compareOpen && (
            <div style={{ maxWidth, margin: "0 auto", padding: "20px 24px 0", maxHeight: "60vh", overflowY: "auto" }}>
              <div style={{ overflowX: "auto" }}>
                <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 480 }}>
                  <thead>
                    <tr>
                      <th style={{ textAlign: "left", padding: "10px 12px", fontSize: 12, color: colors.faint, borderBottom: `1px solid ${colors.border}` }} />
                      {comparedCentres.map((c) => (
                        <th key={c.id} style={{ textAlign: "left", padding: "10px 12px", borderBottom: `1px solid ${colors.border}`, minWidth: 180 }}>
                          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 6 }}>
                            <button onClick={() => navigate(`/centres/${c.slug ?? c.id}`)} style={{ background: "none", border: "none", padding: 0, textAlign: "left", cursor: "pointer", fontFamily: fonts.display, fontWeight: 700, fontSize: 14.5, color: colors.text }}>
                              {c.name}
                            </button>
                            <button onClick={() => toggleCompare(c.id)} aria-label={`Remove ${c.name}`} style={{ background: "none", border: "none", cursor: "pointer", color: colors.faint, flex: "none" }}>
                              <CloseIcon size={14} />
                            </button>
                          </div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {COMPARE_ROWS.map((row) => (
                      <tr key={row.label}>
                        <td style={{ padding: "10px 12px", fontSize: 12.5, fontWeight: 700, color: colors.muted, borderBottom: `1px solid ${colors.border}`, whiteSpace: "nowrap" }}>{row.label}</td>
                        {comparedCentres.map((c) => (
                          <td key={c.id} style={{ padding: "10px 12px", fontSize: 13.5, borderBottom: `1px solid ${colors.border}` }}>{row.render(c)}</td>
                        ))}
                      </tr>
                    ))}
                    <tr>
                      <td style={{ padding: "14px 12px" }} />
                      {comparedCentres.map((c) => (
                        <td key={c.id} style={{ padding: "14px 12px" }}>
                          <Button onClick={() => navigate(`/book/${c.id}`)}>Book</Button>
                        </td>
                      ))}
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}
          <div style={{ maxWidth, margin: "0 auto", padding: "14px 24px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: colors.text }}>
              {compareIds.length} centre{compareIds.length === 1 ? "" : "s"} selected to compare
            </span>
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => setCompareIds([])} style={{ background: "none", border: "none", color: colors.mutedLight, fontSize: 13.5, fontWeight: 600, cursor: "pointer" }}>
                Clear
              </button>
              <Button onClick={() => setCompareOpen((o) => !o)} disabled={compareIds.length < 2}>
                {compareOpen ? "Hide comparison" : "Compare"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Moved to the bottom of the page, at the user's request — reads as
          a closing note rather than competing with the header/results for
          attention. Same .fv-marquee mechanism as VendorBenefitStrip.tsx. */}
      <BrowseTicker isClubs={isClubs} />
    </div>
  );
}
