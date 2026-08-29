import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { createSearchAlert, search } from "../api";
import { CentreCard } from "../components/CentreCard";
import { ClubCard } from "../components/ClubCard";
import { DiscoverCard } from "../components/DiscoverRow";
import { BellIcon, SearchIcon, TreeIconSmall } from "../components/icons";
import { IntentCaptureForm } from "../components/IntentCaptureForm";
import { Card, CardSkeleton, EmptyState } from "../components/ui";
import { useGuest } from "../GuestContext";
import { colors, fonts, maxWidth, radius } from "../theme";
import type { ExperienceSearchResult, SearchResult } from "../types";
import { formatPrice } from "../formatters";

export function ExperienceSearchCard({ e }: { e: ExperienceSearchResult }) {
  const navigate = useNavigate();
  return (
    <Card hover onClick={() => navigate(`/${e.kind === "adventure" ? "adventures" : "experiences"}/${e.id}`)} style={{ padding: 0, overflow: "hidden" }}>
      <div
        style={{
          height: 110,
          background: e.imageUrl ? `url(${e.imageUrl}) center/cover` : e.kind === "adventure" ? colors.greenBg : colors.orangeBg,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {!e.imageUrl && <TreeIconSmall size={22} style={{ color: e.kind === "adventure" ? colors.greenText : colors.orangeDark, opacity: 0.6 }} />}
      </div>
      <div style={{ padding: 13 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
          <h4 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 14.5, margin: 0 }}>{e.title}</h4>
          <span style={{ fontWeight: 700, fontSize: 13.5, whiteSpace: "nowrap" }}>{formatPrice(e.priceCents)}</span>
        </div>
        <div style={{ color: colors.mutedLight, fontSize: 12.5, marginTop: 3 }}>{e.area}{e.area && e.county ? ", " : ""}{e.county}</div>
      </div>
    </Card>
  );
}

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
  const { resident } = useGuest();
  const [searchParams] = useSearchParams();
  const [query, setQuery] = useState(searchParams.get("q") ?? "");
  const [result, setResult] = useState<SearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [recent, setRecent] = useState<string[]>([]);
  const [alertState, setAlertState] = useState<"idle" | "saving" | "saved">("idle");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const saveAlert = async () => {
    if (!result?.parsed) return;
    setAlertState("saving");
    try {
      await createSearchAlert({
        county: result.parsed.county || undefined,
        keywords: result.parsed.keywords.join(" ") || undefined,
      });
      setAlertState("saved");
    } catch {
      setAlertState("idle");
    }
  };

  useEffect(() => {
    setRecent(loadRecent());
  }, []);

  const runSearch = (q: string) => {
    setAlertState("idle");
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
      <section className="section-pad" style={{ maxWidth, margin: "0 auto", padding: "26px 24px 80px" }}>
        <div style={{ position: "relative", marginBottom: 28 }}>
          <SearchIcon size={18} style={{ position: "absolute", left: 16, top: "50%", transform: "translateY(-50%)", color: colors.faint }} />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="What are you looking for?"
            style={{ width: "100%", padding: "16px 16px 16px 46px", borderRadius: radius.card, border: `1px solid ${colors.border}`, fontSize: 17, outline: "none", boxShadow: "0 8px 30px rgba(30,40,32,.06)" }}
          />
        </div>

        {!query.trim() && (
          <>
            {recent.length > 0 && (
              <div style={{ marginBottom: 28 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: colors.muted, marginBottom: 10 }}>RECENT</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {recent.map((r) => (
                    <button key={r} onClick={() => setQuery(r)} style={{ background: colors.panel, border: "none", borderRadius: radius.pill, padding: "8px 14px", fontSize: 13.5, cursor: "pointer" }}>
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
                  <button key={p} onClick={() => setQuery(p)} style={{ background: "#fff", border: `1px solid ${colors.border}`, borderRadius: radius.pill, padding: "8px 14px", fontSize: 13.5, cursor: "pointer" }}>
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
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10, marginBottom: 16 }}>
                <div style={{ fontSize: 13, color: colors.faint }}>
                  Understood as: {[result.parsed.county, result.parsed.free ? "free" : null, result.parsed.timeOfDay, ...result.parsed.keywords].filter(Boolean).join(" · ") || "no specific filters"}
                </div>
                {resident && (result.parsed.county || result.parsed.keywords.length > 0) && (
                  <button
                    onClick={saveAlert}
                    disabled={alertState !== "idle"}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      background: alertState === "saved" ? colors.greenBg : "none",
                      color: alertState === "saved" ? colors.greenText : colors.muted,
                      border: `1px solid ${alertState === "saved" ? colors.green : colors.border}`,
                      borderRadius: radius.pill,
                      padding: "6px 12px",
                      fontSize: 12.5,
                      fontWeight: 600,
                      cursor: alertState === "idle" ? "pointer" : "default",
                    }}
                  >
                    <BellIcon size={13} />
                    {alertState === "saved" ? "We'll notify you" : alertState === "saving" ? "Saving…" : "Notify me about new games like this"}
                  </button>
                )}
              </div>
            )}
            {loading ? (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 18 }}>
                {Array.from({ length: 6 }, (_, i) => <CardSkeleton key={i} />)}
              </div>
            ) : result && result.centres.length === 0 && result.clubs.length === 0 && result.activities.length === 0 && result.experiences.length === 0 ? (
              <EmptyState
                icon={<SearchIcon size={22} />}
                title="Nothing matched"
                subtitle="Try a different phrasing, or broaden it — e.g. drop the county."
                action={<IntentCaptureForm activityLabel={result.parsed?.keywords.join(" ") || query} county={result.parsed?.county ?? ""} />}
              />
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
                {result && result.experiences.length > 0 && (
                  <div style={{ marginBottom: 28 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: colors.muted, marginBottom: 12 }}>ADVENTURES &amp; EXPERIENCES</div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 14 }}>
                      {result.experiences.map((e) => <ExperienceSearchCard key={e.id} e={e} />)}
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
