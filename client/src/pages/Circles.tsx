import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { signInHref } from "../authRedirect";
import {
  createCircle,
  fetchCircleSuggestions,
  fetchCircles,
  fetchGames,
  fetchMyCircleInvitations,
  fetchMyCircles,
  joinCircle,
  leaveCircle,
  respondToCircleInvitation,
} from "../api";
import { AwardIcon, PlusIcon, RepeatIcon, SearchIcon, UsersIcon } from "../components/icons";
import { Chip } from "../components/Chip";
import { CircleCountList } from "../components/CircleCountList";
import { CircleDiscoveryCard } from "../components/CircleDiscoveryCard";
import { CircleHappeningThisWeek } from "../components/CircleHappeningThisWeek";
import { DropdownOption, FilterDropdown } from "../components/FilterDropdown";
import { SectionHeader } from "../components/SectionHeader";
import { IntentCaptureForm } from "../components/IntentCaptureForm";
import { Photo } from "../components/Photo";
import { Button, Card, CardSkeleton, EmptyState, inputStyle, labelStyle } from "../components/ui";
import { useGuest } from "../GuestContext";
import { colors, fonts, maxWidth, placeholderStripes, radius } from "../theme";
import type { Circle, CircleInvitation, CircleSuggestion, Game } from "../types";

// Circles discovery redesign — was a plain database-style list (name, "X
// members", Join button). This rebuilds it as a discovery landing page per
// the product brief: participation/next-plan signals before member counts,
// Swiss-editorial section breaks instead of one long repeating grid.
//
// Scope note: map view, per-circle "beginner friendly"/"outdoor" tags, and
// friend-relationship familiarity signals are all omitted rather than
// faked — none of that data exists on the Circle model today (see
// routes/circles.ts). "Sports"/"Social" quick chips reuse the same
// keyword buckets discover.ts's MOOD_KEYWORDS already establishes
// server-side (duplicated here in the small subset needed, since client
// and server don't share code in this repo) rather than inventing a new
// taxonomy.

const DAY_MS = 86400000;
const PAGE_SIZE = 12;

// Mirrors discover.ts's MOOD_KEYWORDS `active` (sport) and `social` buckets
// — reused, not reinvented, for the "Sports"/"Social" quick filter chips.
const SPORTS_KEYWORDS = ["football", "soccer", "gaa", "rugby", "basketball", "tennis", "badminton", "hockey", "sport", "run", "cycling", "cycle", "swim", "athletics"];
const SOCIAL_KEYWORDS = ["meetup", "club", "circle", "social", "coffee", "chat", "board game", "book", "chess"];

type WhenFilter = "any" | "weekday" | "weekend" | "morning" | "evening";
type SortKey = "recommended" | "most-active" | "meeting-soon" | "newest";

const WHEN_LABELS: Record<WhenFilter, string> = { any: "Any time", weekday: "Weeknights", weekend: "Weekends", morning: "Morning", evening: "Evening" };
const SORT_LABELS: Record<SortKey, string> = { recommended: "Recommended", "most-active": "Most active", "meeting-soon": "Meeting soon", newest: "Newest" };

function daysUntil(iso: string): number {
  return (new Date(`${iso}T00:00:00`).getTime() - Date.now()) / DAY_MS;
}

function nextPlanMatchesWhen(circle: Circle, when: WhenFilter): boolean {
  if (when === "any") return true;
  if (!circle.nextPlan) return false;
  const dow = new Date(`${circle.nextPlan.date}T00:00:00`).getDay();
  const isWeekend = dow === 0 || dow === 6;
  const hour = parseInt(circle.nextPlan.time.split(":")[0] ?? "0", 10);
  if (when === "weekend") return isWeekend;
  if (when === "weekday") return !isWeekend && hour >= 17;
  if (when === "morning") return hour < 12;
  if (when === "evening") return hour >= 17;
  return true;
}

function matchesKeywords(circle: Circle, keywords: string[]): boolean {
  const hay = circle.activityLabel.toLowerCase();
  return keywords.some((k) => hay.includes(k));
}

function compareCircles(a: Circle, b: Circle, sort: SortKey): number {
  if (sort === "newest") return b.createdAt.localeCompare(a.createdAt);
  if (sort === "most-active") return b.plansThisMonth - a.plansThisMonth || (a.nextPlan ? 0 : 1) - (b.nextPlan ? 0 : 1);
  if (sort === "meeting-soon") {
    if (a.nextPlan && b.nextPlan) return `${a.nextPlan.date}${a.nextPlan.time}`.localeCompare(`${b.nextPlan.date}${b.nextPlan.time}`);
    return a.nextPlan ? -1 : b.nextPlan ? 1 : 0;
  }
  // recommended — tiered: a plan within 7 days, then any upcoming plan,
  // then recently created, then everything else. Never sorted by member
  // count, per the product brief's central instruction.
  const tier = (c: Circle) => {
    if (c.nextPlan && daysUntil(c.nextPlan.date) <= 7) return 0;
    if (c.nextPlan) return 1;
    if ((Date.now() - new Date(c.createdAt).getTime()) / DAY_MS <= 21) return 2;
    return 3;
  };
  const diff = tier(a) - tier(b);
  if (diff !== 0) return diff;
  if (a.nextPlan && b.nextPlan) return `${a.nextPlan.date}${a.nextPlan.time}`.localeCompare(`${b.nextPlan.date}${b.nextPlan.time}`);
  return b.createdAt.localeCompare(a.createdAt);
}

function uniqueSorted(values: (string | null | undefined)[]): string[] {
  return Array.from(new Set(values.filter((v): v is string => !!v))).sort((a, b) => a.localeCompare(b));
}

function topCounts(values: string[], limit: number): { label: string; count: number }[] {
  const counts = new Map<string, number>();
  values.forEach((v) => counts.set(v, (counts.get(v) ?? 0) + 1));
  return Array.from(counts.entries())
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

export function Circles() {
  const navigate = useNavigate();
  const { resident } = useGuest();
  const [circles, setCircles] = useState<Circle[]>([]);
  const [games, setGames] = useState<Game[]>([]);
  const [loading, setLoading] = useState(true);
  const [joinedIds, setJoinedIds] = useState<Set<string>>(new Set());
  const [busyId, setBusyId] = useState<string | null>(null);

  const [suggestions, setSuggestions] = useState<CircleSuggestion[]>([]);
  const [suggestionBusy, setSuggestionBusy] = useState<string | null>(null);
  const [invitations, setInvitations] = useState<CircleInvitation[]>([]);
  const [respondingId, setRespondingId] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [county, setCounty] = useState("All");
  const [activity, setActivity] = useState("All");
  const [when, setWhen] = useState<WhenFilter>("any");
  const [sort, setSort] = useState<SortKey>("recommended");
  const [quickFilters, setQuickFilters] = useState<Set<string>>(new Set());
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const [showStartForm, setShowStartForm] = useState(false);
  const startFormRef = useRef<HTMLDivElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const [form, setForm] = useState({ name: "", activityLabel: "", area: "", county: "", about: "", whatWeDo: "", whoCanJoin: "", values: "" });
  const [showMoreCircleFields, setShowMoreCircleFields] = useState(false);
  const [creating, setCreating] = useState(false);

  const load = () => {
    setLoading(true);
    fetchCircles()
      .then(setCircles)
      .finally(() => setLoading(false));
  };

  useEffect(load, []);
  useEffect(() => {
    fetchGames().then(setGames).catch(() => setGames([]));
  }, []);
  useEffect(() => {
    if (resident) fetchMyCircles().then((rows) => setJoinedIds(new Set(rows.map((c) => c.id)))).catch(() => {});
    else setJoinedIds(new Set());
  }, [resident]);
  useEffect(() => {
    if (resident) fetchCircleSuggestions().then(setSuggestions).catch(() => setSuggestions([]));
    else setSuggestions([]);
  }, [resident]);
  useEffect(() => {
    if (resident) fetchMyCircleInvitations().then(setInvitations).catch(() => setInvitations([]));
    else setInvitations([]);
  }, [resident]);
  useEffect(() => {
    if (window.location.hash === "#start-circle") openStartForm();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openStartForm = () => {
    setShowStartForm(true);
    requestAnimationFrame(() => startFormRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };
  const scrollToResults = () => resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });

  const handleRespond = async (invite: CircleInvitation, accept: boolean) => {
    setRespondingId(invite.id);
    try {
      await respondToCircleInvitation(invite.id, accept);
      setInvitations((rows) => rows.filter((r) => r.id !== invite.id));
      if (accept) load();
    } finally {
      setRespondingId(null);
    }
  };

  const handleCreateFromSuggestion = async (s: CircleSuggestion) => {
    setSuggestionBusy(s.activityLabel);
    try {
      const { id, slug } = await createCircle({ name: `${s.activityLabel} Circle`, activityLabel: s.activityLabel });
      setSuggestions((rows) => rows.filter((r) => r.activityLabel !== s.activityLabel));
      load();
      navigate(`/circles/${slug ?? id}`);
    } finally {
      setSuggestionBusy(null);
    }
  };

  const handleJoin = async (circle: Circle) => {
    if (!resident) {
      return navigate(
        signInHref({ kind: "circle", title: circle.name, meta: `${circle.members.toLocaleString()} member${circle.members === 1 ? "" : "s"} · ${circle.area}, ${circle.county}` })
      );
    }
    setBusyId(circle.id);
    try {
      await joinCircle(circle.id);
      setJoinedIds((s) => new Set(s).add(circle.id));
      load();
    } finally {
      setBusyId(null);
    }
  };

  const handleLeave = async (id: string) => {
    setBusyId(id);
    try {
      await leaveCircle(id);
      setJoinedIds((s) => {
        const next = new Set(s);
        next.delete(id);
        return next;
      });
      load();
    } finally {
      setBusyId(null);
    }
  };

  const handleCreate = async () => {
    if (!form.name.trim()) return;
    setCreating(true);
    try {
      const { id, slug } = await createCircle(form);
      navigate(`/circles/${slug ?? id}`);
    } finally {
      setCreating(false);
    }
  };

  const countyOptions = useMemo(() => uniqueSorted(circles.map((c) => c.county)), [circles]);
  const activityOptions = useMemo(() => uniqueSorted(circles.map((c) => c.activityLabel)), [circles]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return circles.filter((c) => {
      if (q) {
        const hay = `${c.name} ${c.activityLabel} ${c.area} ${c.county}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (county !== "All" && c.county !== county) return false;
      if (activity !== "All" && c.activityLabel !== activity) return false;
      if (!nextPlanMatchesWhen(c, when)) return false;
      if (quickFilters.has("active") && !(c.nextPlan && daysUntil(c.nextPlan.date) <= 7)) return false;
      if (quickFilters.has("new") && !((Date.now() - new Date(c.createdAt).getTime()) / DAY_MS <= 21)) return false;
      if (quickFilters.has("weekend") && !nextPlanMatchesWhen(c, "weekend")) return false;
      if (quickFilters.has("sports") && !matchesKeywords(c, SPORTS_KEYWORDS)) return false;
      if (quickFilters.has("social") && !matchesKeywords(c, SOCIAL_KEYWORDS)) return false;
      return true;
    });
  }, [circles, query, county, activity, when, quickFilters]);

  const sorted = useMemo(() => [...filtered].sort((a, b) => compareCircles(a, b, sort)), [filtered, sort]);
  const visible = sorted.slice(0, visibleCount);
  const activeFilterCount = [county !== "All", activity !== "All", when !== "any"].filter(Boolean).length + quickFilters.size;

  const toggleQuick = (key: string) => {
    setQuickFilters((s) => {
      const next = new Set(s);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // --- Hero + editorial aggregates — all derived client-side from real
  // fetched data (fetchCircles/fetchGames), never hardcoded. ---
  const thisWeekGames = useMemo(() => games.filter((g) => daysUntil(g.date) <= 7 && daysUntil(g.date) >= 0), [games]);
  const heroStats = useMemo(
    () => ({
      activeCircles: circles.length,
      plansThisWeek: thisWeekGames.length,
      peopleJoining: thisWeekGames.reduce((sum, g) => sum + g.joined, 0),
    }),
    [circles, thisWeekGames]
  );
  const heroPhoto = useMemo(() => circles.find((c) => c.nextPlan && c.imageUrl)?.imageUrl ?? circles.find((c) => c.imageUrl)?.imageUrl ?? null, [circles]);

  const weekByCounty = useMemo(() => topCounts(thisWeekGames.map((g) => g.county).filter((c): c is string => !!c), 3).map((row) => ({
    ...row,
    joining: thisWeekGames.filter((g) => g.county === row.label).reduce((sum, g) => sum + g.joined, 0),
  })), [thisWeekGames]);

  const byActivity = useMemo(() => topCounts(circles.map((c) => c.activityLabel).filter(Boolean), 6), [circles]);
  const byCounty = useMemo(() => topCounts(circles.map((c) => c.county).filter(Boolean), 6), [circles]);

  const newCircles = useMemo(
    () => circles.filter((c) => (Date.now() - new Date(c.createdAt).getTime()) / DAY_MS <= 30).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 4),
    [circles]
  );
  const needsPeople = useMemo(
    () => circles.filter((c) => c.nextPlan && c.nextPlan.spotsLeft > 0 && c.nextPlan.spotsLeft <= 2).sort((a, b) => a.nextPlan!.spotsLeft - b.nextPlan!.spotsLeft).slice(0, 4),
    [circles]
  );

  return (
    <div style={{ animation: "fadeUp .35s ease both" }}>
      {/* HERO */}
      <section style={{ background: colors.surface, borderBottom: `1px solid ${colors.border}` }}>
        <div className="grid-responsive" style={{ maxWidth, margin: "0 auto", padding: "48px 24px 40px", display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: 40, alignItems: "center" }}>
          <div>
            <div style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: ".09em", textTransform: "uppercase", color: colors.mutedLight, marginBottom: 10 }}>Circles</div>
            <h1 style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: "clamp(28px, 4vw, 42px)", letterSpacing: "-.02em", lineHeight: 1.08, margin: "0 0 14px" }}>
              Find people who keep showing up.
            </h1>
            <p style={{ fontSize: 16, color: colors.mutedLight, lineHeight: 1.5, margin: "0 0 22px", maxWidth: 440 }}>
              Join recurring groups near you and turn the things you enjoy into something you do regularly with other people.
            </p>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 28 }}>
              <Button onClick={scrollToResults}>Explore Circles</Button>
              <Button variant="ghost" onClick={openStartForm}>Start a Circle</Button>
            </div>
            {!loading && (
              <div style={{ display: "flex", gap: 28, flexWrap: "wrap", borderTop: `1px solid ${colors.border}`, paddingTop: 20 }}>
                <div>
                  <div style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: 24 }}>{heroStats.activeCircles}</div>
                  <div style={{ fontSize: 12.5, color: colors.mutedLight }}>Active Circles</div>
                </div>
                <div>
                  <div style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: 24 }}>{heroStats.plansThisWeek}</div>
                  <div style={{ fontSize: 12.5, color: colors.mutedLight }}>Plans this week</div>
                </div>
                <div>
                  <div style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: 24 }}>{heroStats.peopleJoining}</div>
                  <div style={{ fontSize: 12.5, color: colors.mutedLight }}>People joining in</div>
                </div>
              </div>
            )}
          </div>
          <Photo
            src={heroPhoto ?? undefined}
            alt="People taking part in a Circle activity"
            ph={placeholderStripes.green}
            icon={<RepeatIcon size={40} />}
            iconColor={colors.green}
            style={{ height: 320, borderRadius: radius.card }}
          />
        </div>
      </section>

      <section className="section-pad" style={{ maxWidth, margin: "0 auto", padding: "28px 24px 0" }}>
        {/* SEARCH + FILTERS */}
        <div style={{ border: `1px solid ${colors.border}`, borderRadius: radius.card, background: colors.surface, boxShadow: "0 8px 24px rgba(30,40,32,.05)", padding: 14, marginBottom: 16 }}>
          <div style={{ position: "relative" }}>
            <SearchIcon size={17} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: colors.faint }} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search circles, activities or places… e.g. Running in Dublin"
              style={{ width: "100%", padding: "8px 8px 8px 36px", border: "none", background: "transparent", fontFamily: fonts.display, fontSize: 16.5, fontWeight: 600, color: colors.text, outline: "none" }}
            />
          </div>
          <div style={{ height: 1, background: colors.border, margin: "10px 0" }} />
          <div className="stack-mobile" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <FilterDropdown label={county === "All" ? "Near me" : county} active={county !== "All"}>
              <DropdownOption label="Near me / Anywhere" active={county === "All"} onClick={() => setCounty("All")} />
              {countyOptions.map((c) => (
                <DropdownOption key={c} label={c} active={county === c} onClick={() => setCounty(c)} />
              ))}
            </FilterDropdown>
            <FilterDropdown label={activity === "All" ? "Activity" : activity} active={activity !== "All"}>
              <DropdownOption label="All activities" active={activity === "All"} onClick={() => setActivity("All")} />
              {activityOptions.map((a) => (
                <DropdownOption key={a} label={a} active={activity === a} onClick={() => setActivity(a)} />
              ))}
            </FilterDropdown>
            <FilterDropdown label={WHEN_LABELS[when]} active={when !== "any"}>
              {(Object.keys(WHEN_LABELS) as WhenFilter[]).map((w) => (
                <DropdownOption key={w} label={WHEN_LABELS[w]} active={when === w} onClick={() => setWhen(w)} />
              ))}
            </FilterDropdown>
            <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value as SortKey)}
                style={{ padding: "9px 12px", border: `1px solid ${colors.inputBorder}`, borderRadius: radius.control, fontSize: 13.5, background: colors.bg, color: colors.text, outline: "none", fontWeight: 600 }}
              >
                {(Object.keys(SORT_LABELS) as SortKey[]).map((k) => (
                  <option key={k} value={k}>Sort: {SORT_LABELS[k]}</option>
                ))}
              </select>
              <Button onClick={scrollToResults}>Search</Button>
            </div>
          </div>
        </div>

        {/* QUICK CHIPS */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 28 }}>
          <Chip label="Active this week" active={quickFilters.has("active")} onClick={() => toggleQuick("active")} />
          <Chip label="New Circles" active={quickFilters.has("new")} onClick={() => toggleQuick("new")} />
          <Chip label="Weekend" active={quickFilters.has("weekend")} onClick={() => toggleQuick("weekend")} />
          <Chip label="Sports" active={quickFilters.has("sports")} onClick={() => toggleQuick("sports")} />
          <Chip label="Social" active={quickFilters.has("social")} onClick={() => toggleQuick("social")} />
          {activeFilterCount > 0 && (
            <button
              onClick={() => { setCounty("All"); setActivity("All"); setWhen("any"); setQuickFilters(new Set()); setQuery(""); }}
              style={{ background: "none", border: "none", padding: "8px 4px", cursor: "pointer", fontSize: 13, fontWeight: 700, color: colors.muted }}
            >
              Clear filters
            </button>
          )}
        </div>

        {invitations.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 28 }}>
            {invitations.map((inv) => (
              <div key={inv.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: radius.card, padding: "16px 20px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <AwardIcon size={18} style={{ color: colors.greenText, flex: "none" }} />
                  <span style={{ fontSize: 14.5 }}>
                    <strong>{inv.invitedByName}</strong> invited you to <strong>{inv.circleName}</strong>{inv.activityLabel ? ` (${inv.activityLabel})` : ""}
                  </span>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <Button onClick={() => handleRespond(inv, true)} disabled={respondingId === inv.id}>Accept</Button>
                  <Button variant="ghost" onClick={() => handleRespond(inv, false)} disabled={respondingId === inv.id}>Decline</Button>
                </div>
              </div>
            ))}
          </div>
        )}

        {suggestions.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 28 }}>
            {suggestions.map((s) => (
              <div key={s.activityLabel} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", background: colors.greenBg, border: `1px solid ${colors.green}`, borderRadius: radius.card, padding: "16px 20px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <UsersIcon size={18} style={{ color: colors.greenText, flex: "none" }} />
                  <span style={{ fontSize: 14.5, color: colors.text }}>
                    You've played <strong>{s.activityLabel}</strong> with the same {s.familiarCount} people more than once. Make it a Circle?
                  </span>
                </div>
                <Button onClick={() => handleCreateFromSuggestion(s)} disabled={suggestionBusy === s.activityLabel}>
                  {suggestionBusy === s.activityLabel ? "Creating…" : `Create ${s.activityLabel} Circle`}
                </Button>
              </div>
            ))}
          </div>
        )}

        {/* DISCOVERY GRID */}
        <div ref={resultsRef} style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 20 }}>
          <SectionHeader eyebrow="Discover Circles" title="Find your people" subtitle="Recurring groups around the things you actually want to do." />
        </div>

        {loading ? (
          <div className="grid-responsive-3" style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 20, marginBottom: 40 }}>
            {Array.from({ length: 9 }, (_, i) => <CardSkeleton key={i} photoHeight={160} />)}
          </div>
        ) : sorted.length === 0 ? (
          <EmptyState
            icon={<UsersIcon size={22} />}
            title={circles.length === 0 ? "No Circles yet" : "No Circle matching that yet."}
            subtitle={circles.length === 0 ? "Be the first to start one." : "There may still be people nearby interested in the same thing."}
            action={
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
                <IntentCaptureForm activityLabel={activity !== "All" ? activity : query} county={county === "All" ? "" : county} startHref="/circles#start-circle" startLabel="Or start a Circle yourself →" />
                {circles.length > 0 && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center" }}>
                    {county !== "All" && <Chip label="Expand distance" active={false} onClick={() => setCounty("All")} />}
                    {when !== "any" && <Chip label="Remove time filter" active={false} onClick={() => setWhen("any")} />}
                    {activeFilterCount > 0 && <Chip label="Clear filters" active={false} onClick={() => { setCounty("All"); setActivity("All"); setWhen("any"); setQuickFilters(new Set()); }} />}
                  </div>
                )}
              </div>
            }
          />
        ) : (
          <>
            <div className="grid-responsive-3" style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 20, marginBottom: 32 }}>
              {visible.map((c) => (
                <CircleDiscoveryCard
                  key={c.id}
                  circle={c}
                  joined={joinedIds.has(c.id)}
                  busy={busyId === c.id}
                  onJoin={() => handleJoin(c)}
                  onLeave={() => handleLeave(c.id)}
                />
              ))}
            </div>
            {visibleCount < sorted.length && (
              <div style={{ display: "flex", justifyContent: "center", marginBottom: 48 }}>
                <Button variant="ghost" onClick={() => setVisibleCount((v) => v + PAGE_SIZE)}>
                  Show more Circles ({sorted.length - visibleCount} more)
                </Button>
              </div>
            )}
          </>
        )}

        {/* EDITORIAL BREAK — THIS WEEK */}
        {weekByCounty.length > 0 && (
          <div style={{ borderTop: `1px solid ${colors.border}`, padding: "40px 0" }}>
            <SectionHeader eyebrow="This week" title="People are showing up." subtitle="See Circles with plans happening across Ireland this week." titleSize="clamp(22px, 2.8vw, 30px)" />
            {weekByCounty.map((row) => (
              <div key={row.label} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, borderTop: `1px solid ${colors.border}`, padding: "14px 4px" }}>
                <span style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 16 }}>{row.label}</span>
                <span style={{ fontSize: 13, color: colors.muted, fontWeight: 600 }}>{row.count} plan{row.count === 1 ? "" : "s"} · {row.joining} joining</span>
              </div>
            ))}
          </div>
        )}

        {/* HAPPENING THIS WEEK */}
        {circles.length > 0 && (
          <div style={{ borderTop: `1px solid ${colors.border}`, padding: "40px 0" }}>
            <CircleHappeningThisWeek circles={circles} />
          </div>
        )}

        {/* BY ACTIVITY */}
        {byActivity.length > 0 && (
          <div style={{ borderTop: `1px solid ${colors.border}`, padding: "40px 0" }}>
            <SectionHeader eyebrow="By activity" title="What are you into?" titleSize="clamp(22px, 2.8vw, 30px)" />
            <div className="grid-responsive-3" style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 1, background: colors.border }}>
              {byActivity.map((row) => (
                <button
                  key={row.label}
                  onClick={() => { setActivity(row.label); scrollToResults(); }}
                  style={{ background: colors.surface, border: "none", padding: "24px 22px", textAlign: "left", cursor: "pointer" }}
                >
                  <div style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: 17, textTransform: "uppercase", letterSpacing: "-.01em", marginBottom: 4 }}>{row.label}</div>
                  <div style={{ fontSize: 13, color: colors.mutedLight, fontWeight: 600 }}>{row.count} Circle{row.count === 1 ? "" : "s"}</div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* AROUND IRELAND */}
        {byCounty.length > 0 && (
          <div style={{ borderTop: `1px solid ${colors.border}`, padding: "40px 0" }}>
            <SectionHeader eyebrow="Around Ireland" title="Find a Circle near you" titleSize="clamp(22px, 2.8vw, 30px)" />
            <CircleCountList items={byCounty} unit="Circle" onSelect={(label) => { setCounty(label); scrollToResults(); }} />
          </div>
        )}

        {/* NEW AROUND YOU + NEEDS PEOPLE */}
        {(newCircles.length > 0 || needsPeople.length > 0) && (
          <div className="grid-responsive" style={{ borderTop: `1px solid ${colors.border}`, padding: "40px 0", display: "grid", gridTemplateColumns: newCircles.length > 0 && needsPeople.length > 0 ? "1fr 1fr" : "1fr", gap: 40 }}>
            {newCircles.length > 0 && (
              <div>
                <SectionHeader eyebrow="New around you" title="Just started" titleSize="22px" />
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {newCircles.map((c) => (
                    <button key={c.id} onClick={() => navigate(`/circles/${c.slug ?? c.id}`)} style={{ textAlign: "left", background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 14, padding: "14px 16px", cursor: "pointer" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
                        <span style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: ".04em", textTransform: "uppercase", color: colors.greenText, background: colors.greenBg, borderRadius: radius.pill, padding: "2px 8px" }}>New Circle</span>
                      </div>
                      <div style={{ fontWeight: 700, fontSize: 15 }}>{c.name}</div>
                      <div style={{ fontSize: 12.5, color: colors.mutedLight, marginTop: 2 }}>{c.members} member{c.members === 1 ? "" : "s"} · {c.activityLabel || "General"}</div>
                    </button>
                  ))}
                </div>
              </div>
            )}
            {needsPeople.length > 0 && (
              <div>
                <SectionHeader eyebrow="Needs people" title="A few more would make it happen" titleSize="22px" />
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {needsPeople.map((c) => (
                    <button key={c.id} onClick={() => navigate(`/circles/${c.slug ?? c.id}`)} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, textAlign: "left", background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 14, padding: "14px 16px", cursor: "pointer" }}>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: 15 }}>{c.name}</div>
                        <div style={{ fontSize: 12.5, color: colors.orangeDark, fontWeight: 700, marginTop: 2 }}>
                          {c.nextPlan!.spotsLeft} spot{c.nextPlan!.spotsLeft === 1 ? "" : "s"} left · {c.nextPlan!.date} {c.nextPlan!.time}
                        </div>
                      </div>
                      <span style={{ fontSize: 12.5, fontWeight: 700, color: colors.text, flex: "none" }}>View →</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </section>

      {/* CAN'T FIND YOUR CIRCLE */}
      <section style={{ background: colors.greenBg, marginTop: 20 }}>
        <div className="section-pad" style={{ maxWidth, margin: "0 auto", padding: "48px 24px", display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 32 }}>
          <div style={{ maxWidth: 460 }}>
            <div style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: ".09em", textTransform: "uppercase", color: colors.greenText, marginBottom: 8 }}>Nothing quite right?</div>
            <h2 style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: "clamp(22px, 2.8vw, 28px)", margin: "0 0 8px", letterSpacing: "-.01em", color: colors.greenText }}>
              The Circle you're looking for might not exist yet.
            </h2>
            <p style={{ margin: 0, color: colors.muted, fontSize: 15 }}>
              Tell HelloCircle what you're interested in. We'll help you find people nearby who want the same thing.
            </p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 24, flexWrap: "wrap" }}>
            <IntentCaptureForm activityLabel={activity !== "All" ? activity : query || "this"} county={county === "All" ? "" : county} startHref="/circles#start-circle" startLabel="Or start a Circle →" />
            <Button variant="ghost" onClick={openStartForm}>Start a Circle</Button>
          </div>
        </div>
      </section>

      {/* START A CIRCLE */}
      <section className="section-pad" ref={startFormRef} style={{ maxWidth: 900, margin: "0 auto", padding: showStartForm ? "40px 24px 90px" : 0 }}>
        {showStartForm && (
          resident ? (
            <div style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: radius.card, padding: "22px 24px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 16, fontWeight: 700, marginBottom: 6 }}>
                <PlusIcon size={16} /> Start a Circle
              </div>
              <p style={{ margin: "0 0 18px", fontSize: 13.5, color: colors.mutedLight, lineHeight: 1.5 }}>
                Starting a Circle doesn't mean you need everything planned. Start with an idea and find people who are interested.
              </p>
              <div className="grid-responsive" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                <div>
                  <label style={labelStyle}>Name</label>
                  <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g. Clontarf Badminton Circle" style={inputStyle} />
                </div>
                <div>
                  <label style={labelStyle}>Activity</label>
                  <input value={form.activityLabel} onChange={(e) => setForm((f) => ({ ...f, activityLabel: e.target.value }))} placeholder="e.g. Badminton" style={inputStyle} />
                </div>
                <div>
                  <label style={labelStyle}>Area</label>
                  <input value={form.area} onChange={(e) => setForm((f) => ({ ...f, area: e.target.value }))} style={inputStyle} />
                </div>
                <div>
                  <label style={labelStyle}>County</label>
                  <input value={form.county} onChange={(e) => setForm((f) => ({ ...f, county: e.target.value }))} style={inputStyle} />
                </div>
                <div style={{ gridColumn: "1 / -1" }}>
                  <label style={labelStyle}>About (optional)</label>
                  <textarea value={form.about} onChange={(e) => setForm((f) => ({ ...f, about: e.target.value }))} rows={2} style={{ ...inputStyle, resize: "vertical" }} />
                </div>
              </div>

              {/* Structured "About our community" content (Circle Detail
                  redesign) — collapsed by default, same reasoning as
                  Games.tsx's own "Add more detail": most organisers just
                  want to post a Circle quickly. */}
              {!showMoreCircleFields ? (
                <button
                  onClick={() => setShowMoreCircleFields(true)}
                  style={{ background: "none", border: "none", padding: 0, marginTop: 14, color: colors.text, fontWeight: 700, fontSize: 13, cursor: "pointer", textDecoration: "underline" }}
                >
                  + Add more detail (optional)
                </button>
              ) : (
                <div style={{ marginTop: 16, paddingTop: 14, borderTop: `1px solid ${colors.border}` }}>
                  <div style={{ marginBottom: 12 }}>
                    <label style={labelStyle}>What we do (optional)</label>
                    <textarea
                      value={form.whatWeDo}
                      onChange={(e) => setForm((f) => ({ ...f, whatWeDo: e.target.value }))}
                      placeholder="e.g. Weekly sessions, occasional social meetups and the odd challenge."
                      rows={2}
                      style={{ ...inputStyle, resize: "vertical" }}
                    />
                  </div>
                  <div style={{ marginBottom: 12 }}>
                    <label style={labelStyle}>Who can join (optional)</label>
                    <textarea
                      value={form.whoCanJoin}
                      onChange={(e) => setForm((f) => ({ ...f, whoCanJoin: e.target.value }))}
                      placeholder="e.g. Anyone nearby who wants to give this a go — no experience needed."
                      rows={2}
                      style={{ ...inputStyle, resize: "vertical" }}
                    />
                  </div>
                  <div>
                    <label style={labelStyle}>Our values (optional)</label>
                    <textarea
                      value={form.values}
                      onChange={(e) => setForm((f) => ({ ...f, values: e.target.value }))}
                      placeholder="e.g. Respect, encouragement, and showing up for each other."
                      rows={2}
                      style={{ ...inputStyle, resize: "vertical" }}
                    />
                  </div>
                </div>
              )}

              <div style={{ marginTop: 16, display: "flex", gap: 10 }}>
                <Button onClick={handleCreate} disabled={creating || !form.name.trim()}>{creating ? "Creating…" : "Create Circle"}</Button>
                <Button variant="ghost" onClick={() => setShowStartForm(false)}>Cancel</Button>
              </div>
            </div>
          ) : (
            <Card style={{ background: colors.greenBg, border: `1px solid ${colors.green}` }}>
              <button onClick={() => navigate(signInHref())} style={{ background: "none", border: "none", padding: 0, color: colors.greenText, fontWeight: 700, cursor: "pointer" }}>
                Sign in
              </button>{" "}
              to start a Circle of your own.
            </Card>
          )
        )}
      </section>
    </div>
  );
}
