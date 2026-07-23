import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { fetchCentres, fetchClubs } from "../api";
import { BrowseIllustration } from "../components/BrowseIllustration";
import { Chip } from "../components/Chip";
import { CentreCard } from "../components/CentreCard";
import { ClubCard } from "../components/ClubCard";
import { COUNTIES, SPORTS } from "../constants";
import { ChevronLeftIcon, ChevronRightIcon, GridIcon, HomeIcon, PinIcon, SearchIcon } from "../components/icons";
import { colors, fonts, maxWidth } from "../theme";
import type { Centre, Club } from "../types";

type SortKey = "popular" | "price-asc" | "price-desc" | "name";

const SORT_LABELS: Record<SortKey, string> = {
  popular: "Popular",
  "price-asc": "Price: Low to High",
  "price-desc": "Price: High to Low",
  name: "Name: A–Z",
};

const PAGE_SIZE = 6;

function centrePrice(c: Centre) {
  return c.from;
}
function clubPrice(c: Club) {
  return c.price;
}

export function Browse() {
  const { category } = useParams<{ category: "centres" | "clubs" }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const county = searchParams.get("county") || "All";
  const sport = searchParams.get("sport") || "All";
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("popular");
  const [page, setPage] = useState(1);

  const isClubs = category === "clubs";
  const [centres, setCentres] = useState<Centre[]>([]);
  const [clubs, setClubs] = useState<Club[]>([]);

  useEffect(() => {
    if (isClubs) {
      fetchClubs(county, sport).then(setClubs);
    } else {
      fetchCentres(county).then(setCentres);
    }
  }, [isClubs, county, sport]);

  useEffect(() => {
    setPage(1);
    setQuery("");
  }, [isClubs, county, sport]);

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

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows: (Centre | Club)[] = isClubs ? clubs : centres;
    const searched = q
      ? rows.filter((r) => r.name.toLowerCase().includes(q) || r.area.toLowerCase().includes(q))
      : rows;
    const sorted = [...searched].sort((a, b) => {
      if (sort === "name") return a.name.localeCompare(b.name);
      if (sort === "price-asc") return (isClubs ? clubPrice(a as Club) : centrePrice(a as Centre)) - (isClubs ? clubPrice(b as Club) : centrePrice(b as Centre));
      if (sort === "price-desc") return (isClubs ? clubPrice(b as Club) : centrePrice(b as Centre)) - (isClubs ? clubPrice(a as Club) : centrePrice(a as Centre));
      return b.rating - a.rating || b.reviews - a.reviews;
    });
    return sorted;
  }, [isClubs, clubs, centres, query, sort]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageSafe = Math.min(page, totalPages);
  const pageRows = filtered.slice((pageSafe - 1) * PAGE_SIZE, pageSafe * PAGE_SIZE);
  const accent = isClubs ? "orange" : "green";

  const allBtnActive = county === "All";

  return (
    <div className="fade-panel">
      <section className="section-pad" style={{ maxWidth, margin: "0 auto", padding: "26px 24px 12px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: colors.mutedLight, marginBottom: 16 }}>
          <span onClick={() => navigate("/")} className="link-accent" style={{ cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4, color: colors.mutedLight }}>
            <HomeIcon size={14} /> Home
          </span>
          <ChevronRightIcon size={12} style={{ color: colors.faint }} />
          <span style={{ fontWeight: 600, color: colors.text }}>{isClubs ? "Sports clubs" : "Community centres"}</span>
        </div>

        <div style={{ background: isClubs ? "#FBF0E9" : colors.greenBg, borderRadius: 22, padding: "0 28px", marginBottom: 22 }}>
          <div className="grid-responsive" style={{ display: "grid", gridTemplateColumns: "1fr 1.3fr", gap: 24, alignItems: "center" }}>
            <div>
              <h1 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: "clamp(28px, 5vw, 34px)", margin: "0 0 6px", letterSpacing: "-.02em" }}>
                {isClubs ? "Sports clubs" : "Community centres"}
              </h1>
              <p style={{ color: colors.mutedLight, fontSize: 16, margin: "0 0 10px" }}>
                {filtered.length} result{filtered.length === 1 ? "" : "s"}{county === "All" ? " across Ireland" : ` in ${county}`}
                {query && ` matching "${query}"`}
              </p>
              <p style={{ color: colors.muted, fontSize: 14, lineHeight: 1.55, margin: 0, maxWidth: 340 }}>
                {isClubs
                  ? "Find GAA, soccer, swimming, rugby and more for every age. Many clubs offer a free trial session before you commit."
                  : "Book a hall for birthdays, meetings, classes or family celebrations. Compare rooms, capacity and prices from verified centres near you."}
              </p>
            </div>
            <BrowseIllustration accent={accent} />
          </div>
        </div>

        <div style={{ background: "#fff", border: `1px solid ${colors.border}`, borderRadius: 16, padding: 16, marginBottom: 22, boxShadow: "0 6px 20px rgba(30,40,32,.04)" }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
            <button
              onClick={() => setCounty("All")}
              className="btn"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                border: `1.5px solid ${allBtnActive ? colors[accent] : colors.borderStrong}`,
                background: allBtnActive ? colors[accent] : "#fff",
                color: allBtnActive ? "#fff" : "#3B423C",
                borderRadius: 20,
                padding: "8px 14px",
                fontSize: 14,
                fontWeight: 600,
              }}
            >
              <GridIcon size={13} />
              All
            </button>
            {COUNTIES.filter((c) => c !== "All").map((c) => (
              <Chip
                key={c}
                label={<span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><PinIcon size={13} />{c}</span>}
                active={county === c}
                onClick={() => setCounty(c)}
                accent={accent}
              />
            ))}

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
          {isClubs && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12, paddingTop: 12, borderTop: `1px solid ${colors.border}` }}>
              {SPORTS.map((s) => (
                <Chip
                  key={s}
                  label={s}
                  active={sport === s}
                  onClick={() => setSport(s)}
                  accent="orange"
                  padding="7px 13px"
                  fontSize={13}
                />
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="section-pad" style={{ maxWidth, margin: "0 auto", padding: "0 24px 40px" }}>
        {pageRows.length === 0 ? (
          <div style={{ border: `1.5px dashed ${colors.border}`, borderRadius: 18, padding: "56px 20px", textAlign: "center", color: colors.mutedLight }}>
            <div style={{ display: "flex", justifyContent: "center", marginBottom: 10, color: colors.faint }}><SearchIcon size={28} /></div>
            <div style={{ fontWeight: 700, color: colors.muted, marginBottom: 4 }}>No results</div>
            <div style={{ fontSize: 14 }}>Try a different area, search term, or clear the filters.</div>
          </div>
        ) : (
          <div className="grid-responsive-3" style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 20 }}>
            {isClubs
              ? (pageRows as Club[]).map((c) => <ClubCard key={c.id} club={c} />)
              : (pageRows as Centre[]).map((c) => <CentreCard key={c.id} centre={c} height={140} />)}
          </div>
        )}
      </section>

      {filtered.length > 0 && (
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
    </div>
  );
}
