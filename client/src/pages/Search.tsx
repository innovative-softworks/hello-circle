import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { search } from "../api";
import { CentreCard } from "../components/CentreCard";
import { ClubCard } from "../components/ClubCard";
import { DiscoverCard } from "../components/DiscoverRow";
import { SearchIcon } from "../components/icons";
import { CardSkeleton, EmptyState } from "../components/ui";
import { colors, fonts, maxWidth } from "../theme";
import type { SearchResult } from "../types";

const RECENT_KEY = "hello_circle_recent_searches";
const POPULAR = ["Badminton tonight", "Swimming near me", "Free activities this weekend", "Kids art"];

function loadRecent(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
  } catch {
    return [];
  }
}

function pushRecent(q: string) {
  const list = [q, ...loadRecent().filter((r) => r !== q)].slice(0, 6);
  localStorage.setItem(RECENT_KEY, JSON.stringify(list));
}

// Dedicated search screen (Phase A) — a fuller experience than Home's
// inline panel: recent/popular suggestions before typing, then live results
// as you type (debounced), reusing the same /api/search endpoint.

export function Search() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [query, setQuery] = useState(searchParams.get("q") ?? "");
  const [result, setResult] = useState<SearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [recent, setRecent] = useState<string[]>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setRecent(loadRecent());
  }, []);

  const runSearch = (q: string) => {
    if (!q.trim()) {
      setResult(null);
      return;
    }
    setLoading(true);
    search(q)
      .then((r) => {
        setResult(r);
        pushRecent(q.trim());
        setRecent(loadRecent());
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => runSearch(query), 400);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  useEffect(() => {
    if (searchParams.get("q")) runSearch(searchParams.get("q")!);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div style={{ animation: "fadeUp .3s ease both" }}>
      <section style={{ maxWidth, margin: "0 auto", padding: "26px 24px 80px" }}>
        <div style={{ position: "relative", marginBottom: 28 }}>
          <SearchIcon size={18} style={{ position: "absolute", left: 16, top: "50%", transform: "translateY(-50%)", color: colors.faint }} />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="What are you looking for?"
            style={{ width: "100%", padding: "16px 16px 16px 46px", borderRadius: 16, border: `1px solid ${colors.border}`, fontSize: 17, outline: "none", boxShadow: "0 8px 30px rgba(30,40,32,.06)" }}
          />
        </div>

        {!query.trim() && (
          <>
            {recent.length > 0 && (
              <div style={{ marginBottom: 28 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: colors.muted, marginBottom: 10 }}>RECENT</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {recent.map((r) => (
                    <button key={r} onClick={() => setQuery(r)} style={{ background: colors.panel, border: "none", borderRadius: 999, padding: "8px 14px", fontSize: 13.5, cursor: "pointer" }}>
                      {r}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: colors.muted, marginBottom: 10 }}>POPULAR NEAR YOU</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {POPULAR.map((p) => (
                  <button key={p} onClick={() => setQuery(p)} style={{ background: "#fff", border: `1px solid ${colors.border}`, borderRadius: 999, padding: "8px 14px", fontSize: 13.5, cursor: "pointer" }}>
                    {p}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}

        {query.trim() && (
          <>
            {result?.parsed && (
              <div style={{ fontSize: 13, color: colors.faint, marginBottom: 16 }}>
                Understood as: {[result.parsed.county, result.parsed.free ? "free" : null, result.parsed.timeOfDay, ...result.parsed.keywords].filter(Boolean).join(" · ") || "no specific filters"}
              </div>
            )}
            {loading ? (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 18 }}>
                {Array.from({ length: 6 }, (_, i) => <CardSkeleton key={i} />)}
              </div>
            ) : result && result.centres.length === 0 && result.clubs.length === 0 && result.activities.length === 0 ? (
              <EmptyState icon={<SearchIcon size={22} />} title="Nothing matched" subtitle="Try a different phrasing, or broaden it — e.g. drop the county." />
            ) : (
              <>
                {result && result.activities.length > 0 && (
                  <div style={{ marginBottom: 28 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: colors.muted, marginBottom: 12 }}>THINGS TO DO</div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 18 }}>
                      {result.activities.map((a) => (
                        <DiscoverCard key={`${a.kind}-${a.id}`} item={a} isToday={a.date === new Date().toISOString().slice(0, 10)} />
                      ))}
                    </div>
                  </div>
                )}
                {result && (result.centres.length > 0 || result.clubs.length > 0) && (
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 18 }}>
                    {result.centres.map((c) => <CentreCard key={c.id} centre={c} />)}
                    {result.clubs.map((c) => <ClubCard key={c.id} club={c} />)}
                  </div>
                )}
              </>
            )}
          </>
        )}
      </section>
    </div>
  );
}
