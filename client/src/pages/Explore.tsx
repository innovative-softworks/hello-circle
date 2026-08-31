import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { createSearchAlert, fetchCentres, fetchCircles, fetchClubs, fetchDiscover, fetchExperiences, fetchFollowFeed, fetchFreeTimeOptions, fetchResidentFull, search } from "../api";
import type { FollowFeedItem } from "../api";
import { CentreCard } from "../components/CentreCard";
import { CircleDiscoveryCard } from "../components/CircleDiscoveryCard";
import { ClubCard } from "../components/ClubCard";
import { DiscoverCard, DiscoverRow } from "../components/DiscoverRow";
import { ExperienceSearchCard } from "../components/ExperienceSearchCard";
import { DropdownOption, FilterDropdown } from "../components/FilterDropdown";
import { QuickIntentChip } from "../components/Chip";
import { IntentCaptureForm } from "../components/IntentCaptureForm";
import { ArrowRightIcon, BallIcon, BellIcon, BuildingIcon, CalendarIcon, CheckIcon, CloseIcon, PinIcon, RepeatIcon, SearchIcon, TreeIconSmall } from "../components/icons";
import { PageTitle } from "../components/PageTitle";
import { Photo } from "../components/Photo";
import { EntityTypeLabel } from "../components/symbols";
import type { EntityKind } from "../components/symbols";
import { CardSkeleton, Drawer, EmptyState } from "../components/ui";
import { useGuest } from "../GuestContext";
import { colors, fonts, maxWidth, placeholderStripes, radius } from "../theme";
import type { Centre, Circle, Club, DiscoverFeed, DiscoverItem, Experience, SearchResult } from "../types";

const FOLLOW_FEED_KIND_TO_ENTITY: Record<string, EntityKind> = {
  experience: "experience",
  program_session: "place",
  club_session: "open-plan",
  game: "open-plan",
};

function FollowFeedRow({ items }: { items: FollowFeedItem[] }) {
  const navigate = useNavigate();
  return (
    <div style={{ marginBottom: 36 }}>
      <h3 style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: 17, margin: "0 0 12px" }}>From people you follow</h3>
      <div style={{ display: "flex", gap: 14, overflowX: "auto", paddingBottom: 4 }}>
        {items.map((item) => (
          <div
            key={`${item.kind}-${item.id}`}
            onClick={() => navigate(item.href)}
            className="card-hover card-surface"
            style={{ cursor: "pointer", flex: "0 0 220px", background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: radius.card, overflow: "hidden" }}
          >
            <Photo src={item.imageUrl ?? undefined} alt={item.title} ph={placeholderStripes.green} style={{ aspectRatio: "16/10" }} />
            <div style={{ padding: "12px 14px 14px" }}>
              <EntityTypeLabel type={FOLLOW_FEED_KIND_TO_ENTITY[item.kind] ?? "place"} size={11} color={colors.mutedLight} />
              <div style={{ fontWeight: 700, fontSize: 14, margin: "4px 0 2px" }}>{item.title}</div>
              <div style={{ fontSize: 12, color: colors.mutedLight }}>{item.date} · {item.time}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// Unified discovery + search (merge of the old Explore.tsx + Search.tsx —
// see the merge brief this was built against). One route, two states:
//   DISCOVERY MODE — no active query/filter: category tiles, "happening
//     soon"/"needs people"/"this weekend" feeds, quick intents.
//   RESULTS MODE — a query, a quick intent, a mood, or "needs people" is
//     active: the exact same mixed-entity search Search.tsx used to run
//     (GET /api/search, already ranked server-side via discover.ts's
//     scoreActivities/rankScore — no new ranking logic invented here),
//     rendered with a filter/sort toolbar instead of Search.tsx's plain list.
// Search state lives in the URL (q/when/needsPeople/county/radiusKm/mood/
// sort) so results are shareable/bookmarkable and Back restores them —
// there's no separate /search page anymore (see SearchRedirect.tsx).

const MOOD_LABELS: Record<string, string> = {
  active: "Play",
  move: "Move",
  social: "Meet",
  chill: "Relax",
  learn: "Learn",
  surprise: "Surprise me",
};

const RADIUS_OPTIONS = [0, 5, 10, 25, 50];

type CategoryKey = "centres" | "clubs" | "games" | "adventures" | "experiences" | "circles";

const CATEGORIES: { key: CategoryKey; label: string; desc: string; icon: ReactNode; to: string }[] = [
  { key: "centres", label: "Community centres", desc: "Halls, pitches and rooms you can hire.", icon: <BuildingIcon size={20} />, to: "/browse/centres" },
  { key: "clubs", label: "Sports clubs", desc: "Join a club, register for a season.", icon: <BallIcon size={20} />, to: "/browse/clubs" },
  { key: "games", label: "Open games", desc: "Join people who are already playing.", icon: <RepeatIcon size={20} />, to: "/games" },
  { key: "adventures", label: "Adventures", desc: "Guided hikes, kayaking and outdoor trips.", icon: <TreeIconSmall size={20} />, to: "/adventures" },
  { key: "experiences", label: "Experiences", desc: "Workshops, classes and one-off outings.", icon: <TreeIconSmall size={20} />, to: "/experiences" },
  { key: "circles", label: "Circles", desc: "Recurring groups built around shared activity.", icon: <CalendarIcon size={20} />, to: "/circles" },
];

const QUICK_INTENTS: { key: string; label: string; apply: (p: URLSearchParams) => void }[] = [
  { key: "needs-people", label: "Needs people", apply: (p) => p.set("needsPeople", "1") },
  { key: "free", label: "Free", apply: (p) => p.set("q", [p.get("q"), "free"].filter(Boolean).join(" ")) },
  { key: "outdoors", label: "Outdoors", apply: (p) => p.set("q", [p.get("q"), "outdoors"].filter(Boolean).join(" ")) },
  { key: "social", label: "Social", apply: (p) => p.set("q", [p.get("q"), "social"].filter(Boolean).join(" ")) },
  { key: "sports", label: "Sports", apply: (p) => p.set("q", [p.get("q"), "sport"].filter(Boolean).join(" ")) },
];

type SortKey = "recommended" | "soonest" | "needs-people" | "price-asc";
const SORT_LABELS: Record<SortKey, string> = {
  recommended: "Recommended",
  soonest: "Soonest",
  "needs-people": "Needs people",
  "price-asc": "Price: Low to high",
};

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

/** A game close to happening ("1 player needed" / "2 spots left") — the
 * same <=3 threshold Home.tsx's needPeopleGames uses. DiscoverItem has no
 * `status`/`minParticipants` (unlike the fuller Game type Home.tsx reads),
 * so this is a best-effort read of the one signal it does carry. */
function needsPeopleGame(item: DiscoverItem): boolean {
  return item.kind === "game" && item.spotsLeft !== null && item.spotsLeft > 0 && item.spotsLeft <= 3;
}

function isWeekendDate(dateIso: string): boolean {
  const dow = new Date(`${dateIso}T12:00:00Z`).getUTCDay();
  return dow === 0 || dow === 6;
}

/** feed.today and feed.weekend aren't mutually exclusive — an activity
 * happening today is ALSO in feed.weekend whenever today itself is a
 * Saturday/Sunday (the server buckets independently, see discover.ts) — so
 * every `[...feed.today, ...feed.weekend]` merge in this file needs this
 * before rendering, or React sees duplicate `kind-id` keys in one list and
 * its reconciliation can hand a card the wrong (or an undefined) item. */
function dedupeItems(items: DiscoverItem[]): DiscoverItem[] {
  const seen = new Set<string>();
  return items.filter((i) => {
    const key = `${i.kind}-${i.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function sortActivities(items: DiscoverItem[], sort: SortKey): DiscoverItem[] {
  const sorted = [...items];
  if (sort === "soonest") {
    sorted.sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
  } else if (sort === "needs-people") {
    sorted.sort((a, b) => {
      const an = needsPeopleGame(a) ? 0 : 1;
      const bn = needsPeopleGame(b) ? 0 : 1;
      if (an !== bn) return an - bn;
      const aLeft = a.spotsLeft ?? Infinity;
      const bLeft = b.spotsLeft ?? Infinity;
      return aLeft - bLeft;
    });
  } else if (sort === "price-asc") {
    sorted.sort((a, b) => (a.priceCents ?? 0) - (b.priceCents ?? 0));
  }
  // "recommended" — leave server order (already ranked by rankScore()).
  return sorted;
}

export function Explore() {
  const navigate = useNavigate();
  const { resident } = useGuest();
  const [searchParams, setSearchParams] = useSearchParams();

  const qParam = searchParams.get("q") ?? "";
  const when = searchParams.get("when") ?? "";
  const needsPeopleOnly = searchParams.get("needsPeople") === "1";
  const county = searchParams.get("county") ?? "";
  const radiusKm = Number(searchParams.get("radiusKm") ?? 0) || 0;
  const mood = searchParams.get("mood");
  const moodCounty = searchParams.get("moodCounty") ?? undefined;
  const sort = (searchParams.get("sort") as SortKey) || "recommended";
  const shouldFocus = searchParams.get("focus") === "1";
  const categoryType = (searchParams.get("cat") as CategoryKey | null) ?? null;

  const isResultsMode = !!qParam.trim() || when !== "" || needsPeopleOnly || !!mood;

  const [inputValue, setInputValue] = useState(qParam);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const searchBarRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [feed, setFeed] = useState<DiscoverFeed | null>(null);
  const [result, setResult] = useState<SearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [recent, setRecent] = useState<string[]>([]);
  const [alertState, setAlertState] = useState<"idle" | "saving" | "saved">("idle");
  const [moodResults, setMoodResults] = useState<DiscoverItem[] | null>(null);
  const [moodLoading, setMoodLoading] = useState(false);
  const [countyOptions, setCountyOptions] = useState<string[]>([]);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [previewItems, setPreviewItems] = useState<(Centre | Club | Circle | Experience)[]>([]);
  // Which category `previewItems` actually belongs to — set atomically with
  // the data itself (never via a separate effect run), so a render can
  // never show one category's cards under another category's heading. See
  // the long comment at the games useMemo below for why this exists.
  const [previewItemsFor, setPreviewItemsFor] = useState<CategoryKey | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const patchParams = (fn: (p: URLSearchParams) => void) => {
    const next = new URLSearchParams(searchParams);
    fn(next);
    setSearchParams(next);
  };

  useEffect(() => {
    setInputValue(qParam);
  }, [qParam]);

  useEffect(() => {
    setRecent(loadRecent());
    fetchCentres().then((rows) => setCountyOptions(Array.from(new Set(rows.map((r) => r.county))).sort((a, b) => a.localeCompare(b))));
  }, []);

  useEffect(() => {
    if (shouldFocus) {
      inputRef.current?.focus();
      patchParams((p) => p.delete("focus"));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shouldFocus]);

  // Pre-fill radius from the resident's own onboarding preference, once.
  useEffect(() => {
    if (resident && !searchParams.get("radiusKm")) {
      fetchResidentFull().then(({ resident: r }) => {
        if (r?.searchRadiusKm) patchParams((p) => p.set("radiusKm", String(r.searchRadiusKm)));
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resident]);

  // Discovery Mode feed — also the source for "Tonight"/"This weekend" quick
  // intents when there's no text query, so a quick intent doesn't need its
  // own endpoint.
  useEffect(() => {
    setFeed(null);
    fetchDiscover(county || undefined, radiusKm || undefined)
      .then(setFeed)
      .catch(() => setFeed({ today: [], weekend: [] }));
  }, [county, radiusKm]);

  // "From people you follow" (Follow feature) — only fetched for a signed-in
  // resident, and only ever rendered when it actually has something in it
  // (never an empty "you follow no one" section).
  const [followFeed, setFollowFeed] = useState<FollowFeedItem[]>([]);
  useEffect(() => {
    if (!resident) {
      setFollowFeed([]);
      return;
    }
    fetchFollowFeed()
      .then(setFollowFeed)
      .catch(() => setFollowFeed([]));
  }, [resident]);

  const previewSport = searchParams.get("psport") ?? "";
  const previewNeedsPeople = searchParams.get("pneeds") === "1";

  // Games preview — computed directly at render time (useMemo, not an
  // effect) from `feed`, which is already fetched above. This is
  // deliberate: `categoryType` comes from the URL and can change on a
  // render that happens BEFORE any effect keyed off it has run, so an
  // effect-driven previewItems for this branch could momentarily hold the
  // *previous* tile's (differently-shaped) data while categoryType already
  // read "games" — DiscoverCard would then render e.g. an Experience object
  // through the games code path and crash. A useMemo is synchronous and
  // recomputed in the same render as categoryType itself, so that gap can't
  // exist. Left uncapped (20) so the "Needs people" preview filter below has
  // real data to narrow before the final slice(0, 10) at render.
  const gamesPreview = useMemo(() => {
    if (categoryType !== "games") return null;
    return dedupeItems([...(feed?.today ?? []), ...(feed?.weekend ?? [])]).filter((i) => i.kind === "game");
  }, [categoryType, feed]);

  // Guards against a stale fetch (e.g. Clubs still in flight) landing after
  // the visitor has already switched tiles and overwriting previewItems
  // with the wrong shape of data. Bumped on every effect run; an in-flight
  // response only gets applied if its token is still the latest.
  const previewRequestId = useRef(0);

  // Category tile preview (tapping a tile shows a taste of it in place,
  // rather than jumping straight to its dedicated page — "View all" below
  // is what actually navigates there). Only handles the async categories —
  // games is the gamesPreview memo above, entirely separate from this
  // effect/state so it can never observe a stale value from here.
  useEffect(() => {
    const requestId = ++previewRequestId.current;
    if (!categoryType || categoryType === "games") {
      setPreviewItems([]);
      setPreviewItemsFor(null);
      setPreviewLoading(false);
      return;
    }
    setPreviewLoading(true);
    const load =
      categoryType === "centres"
        ? fetchCentres(county || undefined)
        : categoryType === "clubs"
          ? fetchClubs(county || undefined, previewSport || undefined)
          : categoryType === "adventures"
            ? fetchExperiences("adventure", county || undefined)
            : categoryType === "experiences"
              ? fetchExperiences("experience", county || undefined)
              : fetchCircles(county || undefined);
    load
      .then((rows) => {
        if (previewRequestId.current !== requestId) return;
        // Set together in the same tick — React batches these, so a render
        // can never see the new rows paired with the old categoryType, or
        // vice versa (the render below also checks previewItemsFor matches
        // categoryType as a second, belt-and-braces guard).
        setPreviewItems(rows);
        setPreviewItemsFor(categoryType);
      })
      .catch(() => {
        if (previewRequestId.current !== requestId) return;
        setPreviewItems([]);
        setPreviewItemsFor(categoryType);
      })
      .finally(() => {
        if (previewRequestId.current === requestId) setPreviewLoading(false);
      });
  }, [categoryType, county, previewSport]);

  // Full, unfiltered sport list for the club preview's Sport dropdown —
  // fetched once per county so picking a sport doesn't shrink the dropdown
  // down to just itself (same pattern Browse.tsx uses for its own filters).
  const [previewSportOptions, setPreviewSportOptions] = useState<string[]>([]);
  useEffect(() => {
    if (categoryType !== "clubs") return;
    fetchClubs(county || undefined).then((rows) => setPreviewSportOptions(Array.from(new Set(rows.map((r) => r.sport))).sort((a, b) => a.localeCompare(b))));
  }, [categoryType, county]);

  // Legacy ?mood=&moodCounty= (Home.tsx's mood tiles) — unchanged endpoint,
  // now just rendered inside the same Results Mode shell instead of its own
  // ad hoc block.
  useEffect(() => {
    if (!mood) {
      setMoodResults(null);
      return;
    }
    setMoodLoading(true);
    setMoodResults(null);
    fetchFreeTimeOptions({ county: moodCounty, mood: mood === "surprise" ? undefined : mood })
      .then((rows) => setMoodResults(mood === "surprise" && rows.length > 1 ? [rows[Math.floor(Math.random() * rows.length)]] : rows))
      .finally(() => setMoodLoading(false));
  }, [mood, moodCounty]);

  const runSearch = (q: string) => {
    setAlertState("idle");
    if (!q.trim()) {
      setResult(null);
      return;
    }
    setLoading(true);
    const withCounty = county && !q.toLowerCase().includes(county.toLowerCase()) ? `${q} ${county}` : q;
    search(withCounty)
      .then((r) => {
        setResult(r);
        pushRecent(q.trim());
        setRecent(loadRecent());
      })
      .finally(() => setLoading(false));
  };

  // The URL's ?q= is the single source of truth for what's actually
  // searched (shareable/bookmarkable, survives Back) — runs as soon as it
  // changes, since the input->URL commit below is where the debounce lives.
  useEffect(() => {
    if (mood) return; // mood has its own fetch above
    runSearch(qParam);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qParam, county, mood]);

  const commitQuery = (v: string) => {
    patchParams((p) => {
      if (v.trim()) p.set("q", v);
      else p.delete("q");
    });
  };

  // Recent/Popular render as an on-focus suggestions panel rather than
  // permanent page real estate — closes on outside click, same convention
  // FilterDropdown uses.
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (searchBarRef.current && !searchBarRef.current.contains(e.target as Node)) setSuggestOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const selectSuggestion = (v: string) => {
    setInputValue(v);
    commitQuery(v);
    setSuggestOpen(false);
    inputRef.current?.blur();
  };

  // Debounces keystrokes into a single URL commit (and therefore a single
  // search request) rather than firing on every keystroke.
  useEffect(() => {
    if (inputValue === qParam) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => commitQuery(inputValue), 400);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputValue]);

  const saveAlert = async () => {
    if (!result?.parsed) return;
    setAlertState("saving");
    try {
      await createSearchAlert({ county: result.parsed.county || undefined, keywords: result.parsed.keywords.join(" ") || undefined });
      setAlertState("saved");
    } catch {
      setAlertState("idle");
    }
  };

  const clearAll = () => {
    setSearchParams(new URLSearchParams());
  };

  const activeFilterChips = useMemo(() => {
    const chips: { key: string; label: string; onRemove: () => void }[] = [];
    if (when === "today") chips.push({ key: "when", label: "Today", onRemove: () => patchParams((p) => p.delete("when")) });
    if (when === "tonight") chips.push({ key: "when", label: "Tonight", onRemove: () => patchParams((p) => p.delete("when")) });
    if (when === "weekend") chips.push({ key: "when", label: "This weekend", onRemove: () => patchParams((p) => p.delete("when")) });
    if (needsPeopleOnly) chips.push({ key: "needsPeople", label: "Needs people", onRemove: () => patchParams((p) => p.delete("needsPeople")) });
    if (county) chips.push({ key: "county", label: county, onRemove: () => patchParams((p) => p.delete("county")) });
    if (radiusKm > 0) chips.push({ key: "radius", label: `Within ${radiusKm}km`, onRemove: () => patchParams((p) => p.delete("radiusKm")) });
    if (mood) chips.push({ key: "mood", label: mood === "surprise" ? "Surprise me" : MOOD_LABELS[mood] ?? mood, onRemove: () => patchParams((p) => { p.delete("mood"); p.delete("moodCounty"); }) });
    return chips;
  }, [when, needsPeopleOnly, county, radiusKm, mood]);

  // The activities pool actually in play for Results Mode — from the search
  // API when there's a text query, otherwise from the same feed Discovery
  // Mode already fetched (so "Tonight"/"This weekend" work with zero text).
  const baseActivities: DiscoverItem[] = useMemo(() => {
    if (mood) return moodResults ?? [];
    if (qParam.trim()) return result?.activities ?? [];
    if (!feed) return [];
    if (when === "today" || when === "tonight") return feed.today;
    if (when === "weekend") return feed.weekend;
    return dedupeItems([...feed.today, ...feed.weekend]);
  }, [mood, moodResults, qParam, result, feed, when]);

  const filteredActivities = useMemo(() => {
    let items = baseActivities;
    if (qParam.trim() && (when === "today" || when === "tonight")) items = items.filter((i) => i.date === new Date().toISOString().slice(0, 10));
    if (qParam.trim() && when === "weekend") items = items.filter((i) => isWeekendDate(i.date));
    if (needsPeopleOnly) items = items.filter(needsPeopleGame);
    return sortActivities(items, sort);
  }, [baseActivities, qParam, when, needsPeopleOnly, sort]);

  const showOtherGroups = !needsPeopleOnly && !mood;
  const allExperiences = qParam.trim() && showOtherGroups ? result?.experiences ?? [] : [];
  const allCentres = qParam.trim() && showOtherGroups ? result?.centres ?? [] : [];
  const allClubs = qParam.trim() && showOtherGroups ? result?.clubs ?? [] : [];

  // Narrows which result group(s) are visible — a filter on top of the
  // results Search already returned, not a re-query.
  const resultType = searchParams.get("rtype") ?? "";
  const groupCounts = { activities: filteredActivities.length, experiences: allExperiences.length, places: allCentres.length + allClubs.length };
  const RESULT_TYPE_OPTIONS: { v: string; l: string; count: number }[] = [
    { v: "", l: "All", count: groupCounts.activities + groupCounts.experiences + groupCounts.places },
    { v: "activities", l: "Things to do", count: groupCounts.activities },
    { v: "experiences", l: "Adventures & Experiences", count: groupCounts.experiences },
    { v: "places", l: "Places & Clubs", count: groupCounts.places },
  ];
  const showActivities = resultType === "" || resultType === "activities";
  const showExperiences = resultType === "" || resultType === "experiences";
  const showPlaces = resultType === "" || resultType === "places";
  const experiences = showExperiences ? allExperiences : [];
  const centres = showPlaces ? allCentres : [];
  const clubs = showPlaces ? allClubs : [];
  const visibleActivities = showActivities ? filteredActivities : [];

  const isSearchLoading = mood ? moodLoading : qParam.trim() ? loading : false;
  const totalMatches = groupCounts.activities + groupCounts.experiences + groupCounts.places;
  const visibleMatches = visibleActivities.length + experiences.length + centres.length + clubs.length;
  const hasNoData = !isSearchLoading && totalMatches === 0;
  // Narrowed the "Things to do / Adventures / Places" filter down to a
  // group with nothing in it — different from a genuine zero-result search,
  // so it gets a lighter "show all" nudge rather than the full demand-
  // capture empty state.
  const hasNoVisibleData = !isSearchLoading && totalMatches > 0 && visibleMatches === 0;

  const contextTitle = mood
    ? mood === "surprise" ? "A surprise for you" : `Feeling like: ${MOOD_LABELS[mood] ?? mood}`
    : qParam.trim()
      ? `"${qParam.trim()}"${county ? ` near ${county}` : ""}`
      : needsPeopleOnly
        ? "Plans that need a few more people"
        : when === "today"
          ? "Happening today"
          : when === "tonight"
            ? "Happening tonight"
            : when === "weekend"
              ? "This weekend"
              : "Explore";

  const emptyStateActivityLabel = result?.parsed?.keywords.join(" ") || qParam || (mood ? MOOD_LABELS[mood] ?? mood : "") || (needsPeopleOnly ? "" : when);
  const emptyStateCounty = result?.parsed?.county || county || moodCounty || "";

  // "Needs a few more people" — Discovery Mode teaser row, computed
  // client-side from the same feed data (no new endpoint) rather than
  // fabricated content. Left uncapped here — DiscoverRow's own `limit` prop
  // below caps what's shown and decides whether "View more" appears, so it
  // needs to know the real total, not a pre-sliced one.
  const needPeopleFeed = useMemo(() => {
    if (!feed) return [];
    return dedupeItems([...feed.today, ...feed.weekend]).filter(needsPeopleGame);
  }, [feed]);

  return (
    <div className="fade-panel">
      <section className="section-pad" style={{ maxWidth, margin: "0 auto", padding: "36px 24px 90px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, marginBottom: 8 }}>
          <PageTitle style={{ margin: 0 }}>Explore</PageTitle>
          <button onClick={() => navigate("/browse/centres")} style={{ background: "none", border: `1px solid ${colors.border}`, borderRadius: radius.pill, padding: "8px 16px", fontSize: 13, fontWeight: 700, color: colors.muted, cursor: "pointer", flex: "none" }}>
            Compare places
          </button>
        </div>
        <p style={{ color: colors.mutedLight, fontSize: 15, margin: "0 0 20px" }}>What do you feel like doing?</p>

        {/* Shared search bar — the input plus its two most-used filters
            (Location, When) live in one row/card, matching the merge
            brief's "[ Search... ] [ Dublin ▼ ] [ Anytime ▼ ]" layout,
            rather than a text box with filter rows scattered below it. */}
        <div ref={searchBarRef} style={{ position: "relative", marginBottom: 16 }}>
          <div className="stack-mobile" style={{ display: "flex", alignItems: "stretch", gap: 8, background: "#fff", border: `1px solid ${colors.border}`, borderRadius: radius.card, padding: 8, boxShadow: "0 8px 30px rgba(30,40,32,.06)" }}>
            <div style={{ position: "relative", flex: 1, minWidth: 0 }}>
              <SearchIcon size={18} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: colors.faint }} />
              <input
                ref={inputRef}
                aria-label="Search activities, Circles, adventures and places"
                value={inputValue}
                onFocus={() => setSuggestOpen(true)}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && commitQuery(inputValue)}
                placeholder="Search activities, Circles, adventures, places…"
                style={{ width: "100%", padding: "11px 38px 11px 36px", border: "none", background: "none", fontSize: 16, outline: "none" }}
              />
              {inputValue && (
                <button
                  onClick={() => {
                    setInputValue("");
                    commitQuery("");
                  }}
                  aria-label="Clear search"
                  style={{ position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: colors.faint, cursor: "pointer", display: "flex", padding: 6 }}
                >
                  <CloseIcon size={16} />
                </button>
              )}
            </div>

            {/* Location — county + distance, one dropdown. */}
            <FilterDropdown label={<span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><PinIcon size={13} />{county || "Anywhere"}{radiusKm > 0 ? ` · ${radiusKm}km` : ""}</span>} active={!!county || radiusKm > 0}>
              <DropdownOption label="Anywhere" active={!county} onClick={() => patchParams((p) => p.delete("county"))} />
              {countyOptions.map((c) => (
                <DropdownOption key={c} label={c} active={county === c} onClick={() => patchParams((p) => p.set("county", c))} />
              ))}
              <div style={{ borderTop: `1px solid ${colors.border}`, marginTop: 6, paddingTop: 8 }}>
                <div style={{ padding: "0 10px 6px", fontSize: 11.5, fontWeight: 700, color: colors.faint, textTransform: "uppercase", letterSpacing: ".03em" }}>Distance</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, padding: "0 10px" }}>
                  {RADIUS_OPTIONS.map((km) => (
                    <button
                      key={km}
                      onClick={() => patchParams((p) => (km ? p.set("radiusKm", String(km)) : p.delete("radiusKm")))}
                      style={{
                        border: "none", borderRadius: radius.pill, padding: "5px 11px", fontSize: 12, fontWeight: 700, cursor: "pointer",
                        background: radiusKm === km ? colors.green : colors.panel, color: radiusKm === km ? "#fff" : colors.muted,
                      }}
                    >
                      {km === 0 ? "Any" : `${km}km`}
                    </button>
                  ))}
                </div>
              </div>
            </FilterDropdown>

            {/* When — the same tonight/weekend split the Filters drawer also
                reads/writes, just reachable inline too. */}
            <FilterDropdown label={<span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><CalendarIcon size={13} />{when === "tonight" ? "Tonight" : when === "weekend" ? "This weekend" : "Anytime"}</span>} active={when !== ""}>
              {[{ v: "", l: "Anytime" }, { v: "tonight", l: "Tonight" }, { v: "weekend", l: "This weekend" }].map((o) => (
                <DropdownOption key={o.v} label={o.l} active={when === o.v} onClick={() => patchParams((p) => (o.v ? p.set("when", o.v) : p.delete("when")))} />
              ))}
            </FilterDropdown>
          </div>

          {/* Recent/Popular — an on-focus suggestions panel, not permanent
              page real estate. Closes on outside click/blur or once a query
              is typed. */}
          {suggestOpen && !inputValue.trim() && (recent.length > 0 || POPULAR.length > 0) && (
            <div
              style={{ position: "absolute", top: "calc(100% + 6px)", left: 0, right: 0, zIndex: 20, background: "#fff", border: `1px solid ${colors.border}`, borderRadius: radius.card, padding: 16, boxShadow: "0 12px 32px rgba(30,40,32,.14)" }}
            >
              {recent.length > 0 && (
                <div style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: colors.muted, marginBottom: 8 }}>RECENT</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                    {recent.map((r) => (
                      <button key={r} onClick={() => selectSuggestion(r)} style={{ background: colors.panel, border: "none", borderRadius: radius.pill, padding: "7px 13px", fontSize: 13, cursor: "pointer" }}>
                        {r}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: colors.muted, marginBottom: 8 }}>POPULAR NEAR YOU</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {POPULAR.map((p) => (
                    <button key={p} onClick={() => selectSuggestion(p)} style={{ background: "none", border: `1px solid ${colors.border}`, borderRadius: radius.pill, padding: "7px 13px", fontSize: 13, cursor: "pointer" }}>
                      {p}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Quick intentions — one-tap shortcuts for what isn't already a
            dropdown above (Tonight/Weekend live in When; distance lives in
            Location, shown in its label once set). */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 24 }}>
          {QUICK_INTENTS.map((qi) => (
            <QuickIntentChip
              key={qi.key}
              label={qi.label}
              onClick={() =>
                patchParams((p) => {
                  qi.apply(p);
                })
              }
            />
          ))}
        </div>

        {isResultsMode ? (
          <>
            {/* Results toolbar */}
            <div style={{ marginBottom: 18 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10, marginBottom: 10 }}>
                <div>
                  <h2 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 21, margin: 0 }}>{contextTitle}</h2>
                  {!isSearchLoading && (
                    <div style={{ fontSize: 13.5, color: colors.mutedLight, marginTop: 2 }}>
                      {visibleMatches} match{visibleMatches === 1 ? "" : "es"}
                      {resultType && visibleMatches !== totalMatches ? ` of ${totalMatches}` : ""}
                    </div>
                  )}
                </div>
                {resident && result?.parsed && (result.parsed.county || result.parsed.keywords.length > 0) && (
                  <button
                    onClick={saveAlert}
                    disabled={alertState !== "idle"}
                    style={{
                      display: "inline-flex", alignItems: "center", gap: 6,
                      background: alertState === "saved" ? colors.greenBg : "none",
                      color: alertState === "saved" ? colors.greenText : colors.muted,
                      border: `1px solid ${alertState === "saved" ? colors.green : colors.border}`,
                      borderRadius: radius.pill, padding: "6px 12px", fontSize: 12.5, fontWeight: 600,
                      cursor: alertState === "idle" ? "pointer" : "default",
                    }}
                  >
                    <BellIcon size={13} />
                    {alertState === "saved" ? "We'll notify you" : alertState === "saving" ? "Saving…" : "Notify me about new games like this"}
                  </button>
                )}
              </div>

              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                  {activeFilterChips.map((c) => (
                    <span key={c.key} style={{ display: "inline-flex", alignItems: "center", gap: 5, background: colors.panel, borderRadius: radius.pill, padding: "5px 6px 5px 12px", fontSize: 12.5, fontWeight: 700, color: colors.text }}>
                      {c.label}
                      <button onClick={c.onRemove} aria-label={`Remove ${c.label} filter`} style={{ background: "none", border: "none", cursor: "pointer", color: colors.muted, display: "flex", padding: 4 }}>
                        <CloseIcon size={12} />
                      </button>
                    </span>
                  ))}
                  {activeFilterChips.length > 1 && (
                    <button onClick={clearAll} style={{ background: "none", border: "none", color: colors.muted, fontWeight: 700, fontSize: 12.5, cursor: "pointer" }}>
                      Clear all
                    </button>
                  )}
                  <button onClick={() => setFiltersOpen(true)} className="btn" style={{ border: `1px solid ${colors.borderStrong}`, background: "#fff", borderRadius: radius.pill, padding: "6px 14px", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>
                    Filters
                  </button>
                </div>
                <select
                  aria-label="Sort results"
                  value={sort}
                  onChange={(e) => patchParams((p) => p.set("sort", e.target.value))}
                  style={{ padding: "8px 12px", border: `1px solid ${colors.inputBorder}`, borderRadius: 11, fontSize: 13.5, background: colors.bg, color: colors.text, outline: "none", fontWeight: 600 }}
                >
                  {(Object.keys(SORT_LABELS) as SortKey[]).map((k) => (
                    <option key={k} value={k}>
                      Sort: {SORT_LABELS[k]}
                    </option>
                  ))}
                </select>
              </div>

              {/* Narrows which of the (already-fetched) result groups are
                  shown — only worth surfacing when more than one kind of
                  result actually came back. */}
              {!isSearchLoading && [groupCounts.activities, groupCounts.experiences, groupCounts.places].filter((n) => n > 0).length > 1 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
                  {RESULT_TYPE_OPTIONS.filter((o) => o.v === "" || o.count > 0).map((o) => (
                    <button
                      key={o.v}
                      onClick={() => patchParams((p) => (o.v ? p.set("rtype", o.v) : p.delete("rtype")))}
                      style={{
                        border: "none", borderRadius: radius.pill, padding: "6px 13px", fontSize: 12.5, fontWeight: 700, cursor: "pointer",
                        background: resultType === o.v ? colors.dark : colors.panel, color: resultType === o.v ? "#fff" : colors.muted,
                      }}
                    >
                      {o.l} ({o.count})
                    </button>
                  ))}
                </div>
              )}
            </div>

            {isSearchLoading ? (
              <div className="grid-responsive-3" style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 20 }}>
                {Array.from({ length: 6 }, (_, i) => <CardSkeleton key={i} />)}
              </div>
            ) : hasNoData ? (
              <EmptyState
                icon={<SearchIcon size={22} />}
                title={qParam.trim() || mood ? "Nothing matched yet" : "Nothing here right now"}
                subtitle="Try a different phrasing, widen the distance, or drop a filter."
                action={<IntentCaptureForm activityLabel={emptyStateActivityLabel || "this"} county={emptyStateCounty} />}
              />
            ) : hasNoVisibleData ? (
              <div style={{ background: colors.panel, borderRadius: radius.card, padding: "24px", textAlign: "center" }}>
                <p style={{ fontSize: 14.5, color: colors.muted, margin: "0 0 12px" }}>
                  No {RESULT_TYPE_OPTIONS.find((o) => o.v === resultType)?.l.toLowerCase()} here — but there {totalMatches === 1 ? "is" : "are"} {totalMatches} other match{totalMatches === 1 ? "" : "es"}.
                </p>
                <button
                  onClick={() => patchParams((p) => p.delete("rtype"))}
                  style={{ background: colors.green, color: "#fff", border: "none", borderRadius: radius.pill, padding: "9px 18px", fontSize: 13.5, fontWeight: 700, cursor: "pointer" }}
                >
                  Show all results
                </button>
              </div>
            ) : (
              <>
                {visibleActivities.length > 0 && (
                  <div style={{ marginBottom: 28 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: colors.muted, marginBottom: 12 }}>THINGS TO DO</div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 18 }}>
                      {visibleActivities.map((a) => (
                        <DiscoverCard key={`${a.kind}-${a.id}`} item={a} isToday={a.date === new Date().toISOString().slice(0, 10)} />
                      ))}
                    </div>
                  </div>
                )}
                {experiences.length > 0 && (
                  <div style={{ marginBottom: 28 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: colors.muted, marginBottom: 12 }}>ADVENTURES &amp; EXPERIENCES</div>
                    <div className="grid-responsive-3" style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 20 }}>
                      {experiences.map((e) => <ExperienceSearchCard key={e.id} e={e} />)}
                    </div>
                  </div>
                )}
                {(centres.length > 0 || clubs.length > 0) && (
                  <div style={{ marginBottom: 8 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: colors.muted, marginBottom: 12 }}>PLACES &amp; CLUBS</div>
                    <div className="grid-responsive-3" style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 20 }}>
                      {centres.map((c) => <CentreCard key={c.id} centre={c} />)}
                      {clubs.map((c) => <ClubCard key={c.id} club={c} />)}
                    </div>
                  </div>
                )}
              </>
            )}
          </>
        ) : (
          <>
            <div className="grid-responsive" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 14, marginBottom: 36 }}>
              {CATEGORIES.map((c) => {
                const active = categoryType === c.key;
                return (
                  <button
                    key={c.key}
                    onClick={() => patchParams((p) => (active ? p.delete("cat") : p.set("cat", c.key)))}
                    style={{
                      display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 10, textAlign: "left",
                      background: active ? colors.greenBg : "#fff",
                      border: `1px solid ${active ? colors.green : colors.border}`,
                      borderRadius: radius.card, padding: 18, cursor: "pointer",
                    }}
                  >
                    <div style={{ width: 40, height: 40, borderRadius: "50%", background: active ? "#fff" : colors.greenBg, color: colors.greenText, display: "flex", alignItems: "center", justifyContent: "center" }}>{c.icon}</div>
                    <div style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 16 }}>{c.label}</div>
                    <div style={{ fontSize: 12.5, color: colors.mutedLight }}>{c.desc}</div>
                  </button>
                );
              })}
            </div>

            {categoryType ? (
              <div style={{ marginBottom: 36 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
                  <h2 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 20, margin: 0 }}>
                    {CATEGORIES.find((c) => c.key === categoryType)?.label}
                  </h2>
                  <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                    <button
                      onClick={() => navigate(CATEGORIES.find((c) => c.key === categoryType)!.to)}
                      style={{ background: "none", border: "none", color: colors.text, fontWeight: 700, fontSize: 13.5, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4 }}
                    >
                      View all <ArrowRightIcon size={14} />
                    </button>
                    <button onClick={() => patchParams((p) => p.delete("cat"))} aria-label="Close preview" style={{ background: "none", border: "none", color: colors.faint, cursor: "pointer", display: "flex" }}>
                      <CloseIcon size={16} />
                    </button>
                  </div>
                </div>
                {/* Category-scoped quick filters — narrow the preview
                    itself before deciding to view all. */}
                {categoryType === "clubs" && previewSportOptions.length > 0 && (
                  <div style={{ marginBottom: 12 }}>
                    <FilterDropdown label={<span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><BallIcon size={13} />{previewSport || "Any sport"}</span>} active={!!previewSport}>
                      <DropdownOption label="Any sport" active={!previewSport} onClick={() => patchParams((p) => p.delete("psport"))} />
                      {previewSportOptions.map((s) => (
                        <DropdownOption key={s} label={s} active={previewSport === s} onClick={() => patchParams((p) => p.set("psport", s))} />
                      ))}
                    </FilterDropdown>
                  </div>
                )}
                {categoryType === "games" && (
                  <div style={{ marginBottom: 12 }}>
                    <QuickIntentChip
                      label={
                        previewNeedsPeople ? (
                          <>
                            Needs people <CheckIcon size={13} />
                          </>
                        ) : (
                          "Needs people"
                        )
                      }
                      onClick={() => patchParams((p) => (previewNeedsPeople ? p.delete("pneeds") : p.set("pneeds", "1")))}
                    />
                  </div>
                )}

                {categoryType === "games" ? (
                  (() => {
                    const shown = (previewNeedsPeople ? (gamesPreview ?? []).filter(needsPeopleGame) : (gamesPreview ?? [])).slice(0, 10);
                    return previewLoading ? (
                      <div className="grid-responsive-3" style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 20 }}>
                        {Array.from({ length: 10 }).map((_, i) => (
                          <CardSkeleton key={i} />
                        ))}
                      </div>
                    ) : shown.length === 0 ? (
                      <div style={{ background: colors.panel, borderRadius: radius.card, padding: "24px", textAlign: "center", color: colors.muted, fontSize: 14 }}>
                        {(gamesPreview?.length ?? 0) > 0 ? "Nothing matches that filter yet." : "Nothing here yet."}
                      </div>
                    ) : (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 18 }}>
                        {shown.map((a) => (
                          <DiscoverCard key={`${a.kind}-${a.id}`} item={a} isToday={a.date === new Date().toISOString().slice(0, 10)} />
                        ))}
                      </div>
                    );
                  })()
                ) : (
                  (() => {
                    // previewItemsFor must match categoryType — belt-and-braces
                    // guard alongside the effect's own requestId check, so a
                    // render can never pair one category's data with another
                    // category's heading/cards even for a single frame.
                    const ready = previewItemsFor === categoryType;
                    const shown = ready ? previewItems.slice(0, 10) : [];
                    return previewLoading || !ready ? (
                      <div className="grid-responsive-3" style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 20 }}>
                        {Array.from({ length: 10 }).map((_, i) => (
                          <CardSkeleton key={i} />
                        ))}
                      </div>
                    ) : shown.length === 0 ? (
                      <div style={{ background: colors.panel, borderRadius: radius.card, padding: "24px", textAlign: "center", color: colors.muted, fontSize: 14 }}>
                        Nothing here yet.
                      </div>
                    ) : (
                      <div className="grid-responsive-3" style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 20 }}>
                        {categoryType === "centres" && (shown as Centre[]).map((c) => <CentreCard key={c.id} centre={c} />)}
                        {categoryType === "clubs" && (shown as Club[]).map((c) => <ClubCard key={c.id} club={c} />)}
                        {(categoryType === "adventures" || categoryType === "experiences") && (shown as Experience[]).map((e) => <ExperienceSearchCard key={e.id} e={e} />)}
                        {categoryType === "circles" &&
                          (shown as Circle[]).map((c) => (
                            <CircleDiscoveryCard
                              key={c.id}
                              circle={c}
                              joined={false}
                              busy={false}
                              onJoin={() => navigate(`/circles/${c.slug ?? c.id}`)}
                              onLeave={() => navigate(`/circles/${c.slug ?? c.id}`)}
                            />
                          ))}
                      </div>
                    );
                  })()
                )}
              </div>
            ) : feed === null ? (
              <div style={{ display: "flex", gap: 14, overflowX: "auto" }}>
                {Array.from({ length: 3 }).map((_, i) => (
                  <CardSkeleton key={i} />
                ))}
              </div>
            ) : feed.today.length === 0 && feed.weekend.length === 0 && radiusKm > 0 ? (
              <div style={{ background: colors.panel, borderRadius: radius.card, padding: "24px", textAlign: "center" }}>
                <p style={{ fontSize: 14.5, color: colors.muted, margin: "0 0 12px" }}>Nothing within {radiusKm}km right now.</p>
                <button
                  onClick={() => patchParams((p) => p.set("radiusKm", String(RADIUS_OPTIONS[Math.min(RADIUS_OPTIONS.indexOf(radiusKm) + 1, RADIUS_OPTIONS.length - 1)])))}
                  style={{ background: colors.green, color: "#fff", border: "none", borderRadius: radius.pill, padding: "9px 18px", fontSize: 13.5, fontWeight: 700, cursor: "pointer" }}
                >
                  Widen to {RADIUS_OPTIONS[Math.min(RADIUS_OPTIONS.indexOf(radiusKm) + 1, RADIUS_OPTIONS.length - 1)] || "any distance"}
                  {RADIUS_OPTIONS[Math.min(RADIUS_OPTIONS.indexOf(radiusKm) + 1, RADIUS_OPTIONS.length - 1)] ? "km" : ""}
                </button>
              </div>
            ) : (
              <>
                {followFeed.length > 0 && <FollowFeedRow items={followFeed} />}
                {needPeopleFeed.length > 0 && (
                  <div style={{ marginBottom: 36 }}>
                    <DiscoverRow title="Needs a few more people" items={needPeopleFeed} isToday limit={12} moreHref="/explore?needsPeople=1" />
                  </div>
                )}
                {feed.today.length > 0 && (
                  <div style={{ marginBottom: 36 }}>
                    <DiscoverRow title="Happening today" items={feed.today} isToday limit={12} moreHref="/explore?when=today" />
                  </div>
                )}
                {feed.weekend.length > 0 && <DiscoverRow title="This weekend" items={feed.weekend} limit={12} moreHref="/explore?when=weekend" />}
              </>
            )}
          </>
        )}
      </section>

      <Drawer open={filtersOpen} onClose={() => setFiltersOpen(false)} title="Filters">
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          {/* When/Distance already live in the search bar above (and Location
              there covers county) — this drawer only holds what isn't already
              reachable inline. */}
          <div>
            <div style={{ fontSize: 12.5, fontWeight: 700, color: colors.muted, marginBottom: 8 }}>AVAILABILITY</div>
            <button
              onClick={() => patchParams((p) => (needsPeopleOnly ? p.delete("needsPeople") : p.set("needsPeople", "1")))}
              style={{ border: "none", borderRadius: radius.pill, padding: "7px 14px", fontSize: 13, fontWeight: 700, cursor: "pointer", background: needsPeopleOnly ? colors.orange : colors.panel, color: needsPeopleOnly ? "#fff" : colors.muted }}
            >
              Needs people
            </button>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
            <button onClick={clearAll} style={{ background: "none", border: "none", color: colors.muted, fontWeight: 700, fontSize: 13.5, cursor: "pointer" }}>
              Clear all
            </button>
            <button
              onClick={() => setFiltersOpen(false)}
              style={{ background: colors.green, color: "#fff", border: "none", borderRadius: radius.pill, padding: "9px 20px", fontSize: 13.5, fontWeight: 700, cursor: "pointer" }}
            >
              Show {totalMatches} match{totalMatches === 1 ? "" : "es"}
            </button>
          </div>
        </div>
      </Drawer>
    </div>
  );
}
