import { Sparkles as SparklesLucide } from "lucide-react";
import { CategoryDropdown, CategoryEmptyHint, CategoryTypeDropdown, useCategoryFilter } from "../components/categories/CategoryChips";
import { CardArrow, CardGrid, ListingCard } from "../components/ListingCard";
import { CardDate } from "../components/CardDate";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { createSearchAlert, fetchCentres, fetchCircles, fetchClubs, fetchDiscover, fetchExperiences, fetchFollowFeed, fetchFreeTimeOptions, fetchResidentFull, search } from "../api";
import type { FollowFeedItem } from "../api";
import { CentreCard } from "../components/CentreCard";
import { CircleDiscoveryCard } from "../components/CircleDiscoveryCard";
import { ClubCard } from "../components/ClubCard";
import { DiscoverCard, DiscoverRow } from "../components/DiscoverRow";
import { ExperienceSearchCard } from "../components/ExperienceSearchCard";
import { cardWord } from "../cardWord";
import { DropdownCheckbox, DropdownOption, FilterDropdown } from "../components/FilterDropdown";
import { QuickIntentChip } from "../components/Chip";
import { IntentCaptureForm } from "../components/IntentCaptureForm";
import { ArrowRightIcon, BallIcon, BellIcon, BuildingIcon, CalendarIcon, CheckIcon, CloseIcon, GridIcon, HeartIcon, PinIcon, RepeatIcon, SearchIcon, TreeIconSmall, UsersIcon } from "../components/icons";
import { VENUE_PAGES_PUBLIC } from "../venueLaunch";
import { PageTitle } from "../components/PageTitle";
import { EntityTypeLabel } from "../components/symbols";
import type { EntityKind } from "../components/symbols";
import { Button, CardSkeleton, EmptyState, LoadErrorState } from "../components/ui";
import { dateLabel, euro } from "../euro";
import { useGuest } from "../GuestContext";
import { colors, fonts, maxWidth, placeholderStripes, radius } from "../theme";
import type { Centre, Circle, Club, DiscoverFeed, DiscoverItem, Experience, SearchResult } from "../types";
import { irelandToday } from "../irelandDate";
import { matchesWhen, priceState } from "../exploreFilters";
import { POPULAR_SEARCHES, loadRecent, pushRecent } from "../recentSearches";
import { CtaBand } from "../components/CtaBand";
import { FeaturedPicks } from "../components/FeaturedPicks";
import { ExploreCollections } from "../components/experience/ExploreCollections";

const FOLLOW_FEED_KIND_TO_ENTITY: Record<string, EntityKind> = {
  experience: "experience",
  program_session: "place",
  club_session: "open-plan",
  game: "open-plan",
};

function FollowFeedRow({ items }: { items: FollowFeedItem[] }) {
  const navigate = useNavigate();
  // The shared photo card (owner 2026-10-27), same as every other Explore row.
  return (
    <div>
      <h2 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: "var(--section-title-size, 20px)", margin: "0 0 14px" }}>From people you follow</h2>
      <CardGrid rail style={{ display: "flex", gap: 16, overflowX: "auto", paddingBottom: 4 }}>
        {items.map((item) => (
          <div key={`${item.kind}-${item.id}`} style={{ flex: "none", width: 280, display: "flex" }}>
            <ListingCard
              href={item.href}
              title={item.title}
              image={item.imageUrl}
              ph={placeholderStripes.green}
              tag={<EntityTypeLabel type={FOLLOW_FEED_KIND_TO_ENTITY[item.kind] ?? "place"} size={11} color="currentColor" />}
              dateOn={<CardDate date={item.date} time={item.time} />}
              action={<CardArrow label={`Open: ${item.title}`} onClick={() => navigate(item.href)} />}
            />
          </div>
        ))}
      </CardGrid>
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

type CategoryKey = "centres" | "clubs" | "games" | "adventures" | "experiences" | "circles" | "programs" | "volunteer";

const ALL_CATEGORIES: { key: CategoryKey; label: string; desc: string; icon: ReactNode; to: string; direct?: boolean; venue?: boolean }[] = [
  { key: "centres", label: "Community centres", desc: "Halls, pitches and rooms you can hire.", icon: <BuildingIcon size={20} />, to: "/browse/centres", venue: true },
  { key: "clubs", label: "Sports clubs", desc: "Join a club, register for a season.", icon: <BallIcon size={20} />, to: "/browse/clubs", venue: true },
  { key: "games", label: "Activities", desc: "Join people who are already playing.", icon: <RepeatIcon size={20} />, to: "/games" },
  { key: "adventures", label: "Adventures", desc: "Guided hikes, kayaking and outdoor trips.", icon: <TreeIconSmall size={20} />, to: "/adventures" },
  { key: "experiences", label: "Experiences", desc: "Workshops, classes and one-off outings.", icon: <TreeIconSmall size={20} />, to: "/experiences" },
  // Programs has its own browse page (/programs). `direct: true` skips the
  // other tiles' cat= preview-card mechanism and just navigates there.
  { key: "programs", label: "Programmes", desc: "Multi-week courses and series.", icon: <GridIcon size={20} />, to: "/programs", direct: true },
  { key: "volunteer", label: "Volunteer", desc: "Clean-ups, community gardens and local causes.", icon: <HeartIcon size={20} />, to: "/volunteer", direct: true },
  { key: "circles", label: "Circles", desc: "Recurring groups built around shared activity.", icon: <CalendarIcon size={20} />, to: "/circles" },
];
// Sitemap audit — centre/club tiles only while venue pages are public
// (otherwise they'd land on /coming-soon); Volunteer added (P2-15).
const CATEGORIES = ALL_CATEGORIES.filter((c) => VENUE_PAGES_PUBLIC || !c.venue);

type SortKey = "recommended" | "soonest" | "price-asc";
// Every option is a real filter on dated activities (the feed's 7-day
// window, or the search results' own dates). "Pick a date" waits on Phase 2.
/** The card word when an activity has no category. */
const KIND_WORD: Record<string, string> = { game: "Activity", program_session: "Programme", club_session: "Club" };

const RESULT_TYPE_LABELS: Record<string, string> = {
  activities: "Activities & games",
  adventures: "Adventures",
  experiences: "Experiences",
  events: "Community events",
  volunteering: "Volunteering",
  programmes: "Programmes",
  circles: "Circles",
  places: "Places & clubs",
};

/** Phone width — the same 560px breakpoint as the app's chip-scroll rows. */
function useNarrow(): boolean {
  const query = "(max-width: 560px)";
  const [narrow, setNarrow] = useState(() => typeof window !== "undefined" && !!window.matchMedia?.(query).matches);
  useEffect(() => {
    const mq = window.matchMedia?.(query);
    if (!mq) return;
    const update = () => setNarrow(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return narrow;
}

/** A labelled group inside the Filters panel (phones stack Type/Show in it). */
function FilterGroup({ title, children }: { title: string | null; children: ReactNode }) {
  return (
    <div role="group" aria-label={title ?? undefined} style={{ padding: "4px 0" }}>
      {title && <div style={{ padding: "6px 10px 4px", fontSize: 11.5, fontWeight: 700, color: colors.faint, textTransform: "uppercase" }}>{title}</div>}
      {children}
    </div>
  );
}

/** "Hiking   5" — a menu option with its count on the right. */
function CountLabel({ name, count }: { name: string; count: number }) {
  return (
    <span style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
      {name}
      <span style={{ color: colors.mutedLight, fontWeight: 500 }}>{count}</span>
    </span>
  );
}

const WHEN_LABELS: Record<string, string> = { "": "Anytime", today: "Today", tonight: "Tonight", tomorrow: "Tomorrow", weekend: "This weekend", week: "This week" };

const SORT_LABELS: Record<SortKey, string> = {
  recommended: "Recommended",
  soonest: "Soonest",
  "price-asc": "Price: Low to high",
};

// Recent/popular searches live in ../recentSearches (shared with Home's hero search).
const POPULAR = POPULAR_SEARCHES;

/** A game close to happening: waiting for enough people to go ahead (the
 * feed's `card` facts, owner 2026-10-27), or nearly full ("2 spots left",
 * the same <=3 threshold Home.tsx's needPeopleGames uses). */
function needsPeopleGame(item: DiscoverItem): boolean {
  if (item.kind !== "game") return false;
  const c = item.card;
  if (c?.pending && c.minParticipants && (item.joined ?? 0) < c.minParticipants) return true;
  return item.spotsLeft !== null && item.spotsLeft > 0 && item.spotsLeft <= 3;
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
  } else if (sort === "price-asc") {
    // Unknown prices go last rather than counting as free.
    sorted.sort((a, b) => (a.priceCents ?? Infinity) - (b.priceCents ?? Infinity));
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
  const needsPeopleOnly = ["1", "true"].includes(searchParams.get("needsPeople") ?? "");
  // "1" is the house style; "true" is accepted so hand-written links work.
  const isOn = (k: string) => ["1", "true"].includes(searchParams.get(k) ?? "");
  const freeOnly = isOn("free");
  const soloOnly = isOn("solo");
  const county = searchParams.get("county") ?? "";
  const radiusKm = Number(searchParams.get("radiusKm") ?? 0) || 0;
  const mood = searchParams.get("mood");
  const moodCounty = searchParams.get("moodCounty") ?? undefined;
  const sortRaw = searchParams.get("sort") ?? "";
  // An old or unknown ?sort= (e.g. the retired "needs-people") falls back.
  const sort: SortKey = sortRaw === "soonest" || sortRaw === "price-asc" ? sortRaw : "recommended";
  const shouldFocus = searchParams.get("focus") === "1";
  const categoryType = (searchParams.get("cat") as CategoryKey | null) ?? null;
  // Category system — ?category=<slug>&sub=<slug> across every listing type
  // (unified search). Separate from ?cat=, which is the listing-type preview.
  const taxonomy = useCategoryFilter("all");
  const narrow = useNarrow();
  const taxonomyKey = JSON.stringify(taxonomy.serverParams);
  const byCategory = !!taxonomy.serverParams.categorySlug;
  const searching = !!qParam.trim() || byCategory;

  const isResultsMode = searching || when !== "" || needsPeopleOnly || freeOnly || soloOnly || !!mood;

  const [inputValue, setInputValue] = useState(qParam);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const searchBarRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [feed, setFeed] = useState<DiscoverFeed | null>(null);
  const [result, setResult] = useState<SearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  // A failed search or feed shows an error with a retry, never an empty list.
  const [loadFailed, setLoadFailed] = useState<"search" | "feed" | null>(null);
  const [feedAttempt, setFeedAttempt] = useState(0);
  const [recent, setRecent] = useState<string[]>([]);
  const [alertState, setAlertState] = useState<"idle" | "saving" | "saved">("idle");
  const [moodResults, setMoodResults] = useState<DiscoverItem[] | null>(null);
  const [moodLoading, setMoodLoading] = useState(false);
  const [countyOptions, setCountyOptions] = useState<string[]>([]);
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
    setLoadFailed((f) => (f === "feed" ? null : f));
    fetchDiscover(county || undefined, radiusKm || undefined)
      .then(setFeed)
      .catch(() => {
        setFeed({ today: [], weekend: [] });
        setLoadFailed("feed");
      });
  }, [county, radiusKm, feedAttempt]);

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
    if (!q.trim() && !byCategory) {
      setResult(null);
      return;
    }
    setLoading(true);
    const withCounty = county && !q.toLowerCase().includes(county.toLowerCase()) ? `${q} ${county}`.trim() : q;
    setLoadFailed((f) => (f === "search" ? null : f));
    search(withCounty, taxonomy.serverParams)
      .then((r) => {
        setResult(r);
        if (q.trim()) pushRecent(q.trim());
        setRecent(loadRecent());
      })
      .catch(() => {
        setResult(null);
        setLoadFailed("search");
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
  }, [qParam, county, mood, taxonomyKey]);

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

  // Chips only for filters tucked inside a menu (Filters, a mood) — the
  // category, When and Where already show their value in their own control.
  const rtypeParam = searchParams.get("rtype") ?? "";
  const activeFilterChips = useMemo(() => {
    const chips: { key: string; label: string; onRemove: () => void }[] = [];
    // Phones: Type and Show sit inside Filters, so their values show here.
    if (narrow && taxonomy.selectedSub) chips.push({ key: "type", label: taxonomy.selectedSub.name, onRemove: () => taxonomy.setSub(null) });
    if (narrow && rtypeParam && RESULT_TYPE_LABELS[rtypeParam]) chips.push({ key: "show", label: RESULT_TYPE_LABELS[rtypeParam], onRemove: () => patchParams((p) => p.delete("rtype")) });
    if (needsPeopleOnly) chips.push({ key: "needsPeople", label: "Needs people", onRemove: () => patchParams((p) => p.delete("needsPeople")) });
    if (freeOnly) chips.push({ key: "free", label: "Free", onRemove: () => patchParams((p) => p.delete("free")) });
    if (soloOnly) chips.push({ key: "solo", label: "Coming alone welcome", onRemove: () => patchParams((p) => p.delete("solo")) });
    if (mood) chips.push({ key: "mood", label: mood === "surprise" ? "Surprise me" : MOOD_LABELS[mood] ?? mood, onRemove: () => patchParams((p) => { p.delete("mood"); p.delete("moodCounty"); }) });
    return chips;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsPeopleOnly, freeOnly, soloOnly, mood, narrow, taxonomy.selectedSub, rtypeParam]);
  const filtersCount = Number(needsPeopleOnly) + Number(freeOnly) + Number(soloOnly);
  const anyFilterCount = activeFilterChips.length + Number(!!taxonomy.label) + Number(!!when) + Number(!!county) + Number(radiusKm > 0);

  // The activities pool actually in play for Results Mode — from the search
  // API when there's a text query, otherwise from the same feed Discovery
  // Mode already fetched (so "Tonight"/"This weekend" work with zero text).
  const baseActivities: DiscoverItem[] = useMemo(() => {
    if (mood) return moodResults ?? [];
    if (searching) return result?.activities ?? [];
    if (!feed) return [];
    // The whole 7-day window when the server sends it (Tomorrow / This week).
    return feed.week ?? dedupeItems([...feed.today, ...feed.weekend]);
  }, [mood, moodResults, searching, result, feed]);

  const filteredActivities = useMemo(() => {
    let items = baseActivities;
    if (when) {
      const today = irelandToday();
      items = items.filter((i) => matchesWhen(i, when, today));
    }
    if (needsPeopleOnly) items = items.filter(needsPeopleGame);
    // Only listings known to be free — an unknown price doesn't count.
    if (freeOnly) items = items.filter((i) => priceState(i) === "free");
    if (soloOnly) items = items.filter((i) => !!i.card?.soloFriendly);
    // Batch 2 — a programme is one result (its next session), not one card per
    // session: you enrol in the whole programme. Sessions share the
    // programme's href, so keep the first after sorting.
    const seenProgrammes = new Set<string>();
    return sortActivities(items, sort).filter((i) => {
      if (i.kind !== "program_session") return true;
      if (seenProgrammes.has(i.href)) return false;
      seenProgrammes.add(i.href);
      return true;
    });
  }, [baseActivities, when, needsPeopleOnly, freeOnly, soloOnly, sort]);

  // Needs people / Coming alone only exist on activities, so they narrow the
  // results to activities; so does a date, since the rest carry no date here.
  const showOtherGroups = !needsPeopleOnly && !soloOnly && !mood;
  const allExperiences = searching && showOtherGroups && !when ? (result?.experiences ?? []).filter((e) => !freeOnly || e.priceCents === 0) : [];
  // Unified search — programmes not already shown as one of their sessions
  // above (no duplicate cards), and Circles (open/approval only, server-side).
  const shownProgrammeHrefs = new Set(filteredActivities.filter((a) => a.kind === "program_session").map((a) => a.href));
  const allProgrammes = searching && showOtherGroups && !when ? (result?.programmes ?? []).filter((p) => !shownProgrammeHrefs.has(`/programs/${p.id}`) && (!freeOnly || p.priceCents === 0)) : [];
  // Circles are always free to join (membership is never paid), so Free keeps them.
  const allCircles = searching && showOtherGroups && !when ? result?.circles ?? [] : [];
  // Header audit P0-1 — while venue pages aren't public every centre/club
  // link lands on /coming-soon, so venue results stay out (same rule as
  // CATEGORIES above).
  const allCentres = VENUE_PAGES_PUBLIC && searching && showOtherGroups && !freeOnly ? result?.centres ?? [] : [];
  const allClubs = VENUE_PAGES_PUBLIC && searching && showOtherGroups && !freeOnly ? result?.clubs ?? [] : [];

  // Narrows which result group(s) are visible — a filter on top of the
  // results Search already returned, not a re-query.
  const resultType = searchParams.get("rtype") ?? "";
  const expOf = (kind: string) => allExperiences.filter((e) => (e.kind === "adventure" || e.kind === "volunteer" || e.kind === "event" ? e.kind : "experience") === kind);
  const groups = {
    activities: filteredActivities,
    adventures: expOf("adventure"),
    experiences: expOf("experience"),
    // Participation Phase 1 — only present when the server returns events (switch on).
    events: expOf("event"),
    volunteering: expOf("volunteer"),
  };
  const groupCounts = { activities: groups.activities.length, experiences: allExperiences.length, programmes: allProgrammes.length, circles: allCircles.length, places: allCentres.length + allClubs.length };
  const RESULT_TYPE_OPTIONS: { v: string; l: string; count: number }[] = [
    { v: "", l: "All", count: groupCounts.activities + groupCounts.experiences + groupCounts.programmes + groupCounts.circles + groupCounts.places },
    { v: "activities", l: RESULT_TYPE_LABELS.activities, count: groups.activities.length },
    { v: "adventures", l: RESULT_TYPE_LABELS.adventures, count: groups.adventures.length },
    { v: "experiences", l: RESULT_TYPE_LABELS.experiences, count: groups.experiences.length },
    ...(groups.events.length > 0 || resultType === "events" ? [{ v: "events", l: RESULT_TYPE_LABELS.events, count: groups.events.length }] : []),
    { v: "volunteering", l: RESULT_TYPE_LABELS.volunteering, count: groups.volunteering.length },
    { v: "programmes", l: RESULT_TYPE_LABELS.programmes, count: groupCounts.programmes },
    { v: "circles", l: RESULT_TYPE_LABELS.circles, count: groupCounts.circles },
    { v: "places", l: RESULT_TYPE_LABELS.places, count: groupCounts.places },
  ];
  const showActivities = resultType === "" || resultType === "activities";
  const showPlaces = resultType === "" || resultType === "places";
  const experiences = resultType === "" ? allExperiences : resultType === "adventures" ? groups.adventures : resultType === "experiences" ? groups.experiences : resultType === "events" ? groups.events : resultType === "volunteering" ? groups.volunteering : [];
  const programmes = resultType === "" || resultType === "programmes" ? allProgrammes : [];
  const circleResults = resultType === "" || resultType === "circles" ? allCircles : [];
  const centres = showPlaces ? allCentres : [];
  const clubs = showPlaces ? allClubs : [];
  const visibleActivities = showActivities ? filteredActivities : [];

  // Without a search the results come from the feed, so wait for it too.
  // The chosen type's name wins on every card ("Hiking"); otherwise each card
  // shows its own category word.
  const chosenWord = taxonomy.selectedSub?.name ?? null;
  const isSearchLoading = mood ? moodLoading : searching ? loading : feed === null;
  const resultTypeLabel = RESULT_TYPE_OPTIONS.find((o) => o.v === resultType)?.l ?? "All";
  const showMenuOn = isResultsMode && !isSearchLoading && (!!resultType || RESULT_TYPE_OPTIONS.filter((o) => o.v !== "" && o.count > 0).length > 1);
  const typeMenuOn = !!taxonomy.selected && taxonomy.selected.subcategories.length > 1;
  const showOptions = RESULT_TYPE_OPTIONS.filter((o) => o.v === "" || o.v === resultType || o.count > 0).map((o) => (
    <DropdownOption key={o.v} label={<CountLabel name={o.l} count={o.count} />} active={resultType === o.v} onClick={() => patchParams((p) => (o.v ? p.set("rtype", o.v) : p.delete("rtype")))} />
  ));
  // On phones Type and Show live inside Filters, so they count in its badge.
  const filtersBadge = filtersCount + (narrow ? Number(!!taxonomy.selectedSub) + Number(!!resultType) : 0);
  const totalMatches = groupCounts.activities + groupCounts.experiences + groupCounts.programmes + groupCounts.circles + groupCounts.places;
  const visibleMatches = visibleActivities.length + experiences.length + programmes.length + circleResults.length + centres.length + clubs.length;
  const hasNoData = !isSearchLoading && totalMatches === 0;
  // Zero because of a filter on top of the search/category (not the search itself).
  const resultsFailed = !isSearchLoading && !mood && loadFailed === (searching ? "search" : "feed");
  const narrowed = !!resultType || filtersCount > 0 || !!when || !!county || radiusKm > 0 || !!taxonomy.selectedSub;
  // Narrowed the "Things to do / Adventures / Places" filter down to a
  // group with nothing in it — different from a genuine zero-result search,
  // so it gets a lighter "show all" nudge rather than the full demand-
  // capture empty state.
  const hasNoVisibleData = !isSearchLoading && totalMatches > 0 && visibleMatches === 0;

  // The line under the count: what's being shown, then each narrowing
  // ("Outdoors & adventure › Hiking near Cork · Tomorrow · Free").
  const contextBase = mood
    ? mood === "surprise" ? "A surprise for you" : `Feeling like: ${MOOD_LABELS[mood] ?? mood}`
    : qParam.trim()
      ? `"${qParam.trim()}"${taxonomy.label ? ` in ${taxonomy.label}` : ""}`
      : taxonomy.label ?? "All listings";
  const contextTitle = [
    `${contextBase}${county ? ` near ${county}` : ""}`,
    when ? WHEN_LABELS[when] : null,
    // Type is already in the category label; Show is said by the count line.
    ...activeFilterChips.filter((c) => !["mood", "type", "show"].includes(c.key)).map((c) => c.label),
  ]
    .filter(Boolean)
    .join(" · ");

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
    // Explore's section titles run larger than the shared 20px default (owner, 2026-10-28).
    <div className="fade-panel" style={{ "--section-title-size": "clamp(28px, 3.2vw, 42px)" } as CSSProperties}>
      <section className="section-pad" style={{ maxWidth, margin: "0 auto", padding: "36px 24px 90px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, marginBottom: 8 }}>
          <PageTitle style={{ margin: 0 }}>Find something worth doing.</PageTitle>
          {/* PUB-09 — Compare is a centres tool; while venue pages are gated it
              would only lead to the coming-soon page, so it isn't offered. */}
          {VENUE_PAGES_PUBLIC && (
            <button onClick={() => navigate("/browse/centres")} style={{ background: "none", border: `1px solid ${colors.border}`, borderRadius: "var(--radius-button)", padding: "8px 16px", fontSize: 13, fontWeight: 700, color: colors.muted, cursor: "pointer", flex: "none" }}>
              Compare places
            </button>
          )}
        </div>
        <p style={{ color: colors.mutedLight, fontSize: 15, margin: "0 0 20px" }}>Discover activities, experiences and people around you.</p>

        {/* Shared search bar — the input plus its two most-used filters
            (Location, When) live in one row/card, matching the merge
            brief's "[ Search... ] [ Dublin ▼ ] [ Anytime ▼ ]" layout,
            rather than a text box with filter rows scattered below it. */}
        <div ref={searchBarRef} style={{ position: "relative", marginBottom: 16 }}>
          {/* Batch 2 — on phones the two pickers sit side by side under the
              input (wrap) instead of stacking into three rows. */}
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "stretch", gap: 8, background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: radius.card, padding: 8, boxShadow: "0 8px 30px rgba(30,40,32,.06)" }}>
            <div style={{ position: "relative", flex: "1 1 260px", minWidth: 0 }}>
              <SearchIcon size={18} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: colors.faint }} />
              <input
                ref={inputRef}
                aria-label="Search activities, Circles, adventures and places"
                value={inputValue}
                onFocus={() => setSuggestOpen(true)}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && commitQuery(inputValue)}
                placeholder="Activities, Circles, adventures…"
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
            <FilterDropdown label={<span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><PinIcon size={13} />{county || (radiusKm > 0 && resident?.homeCounty ? resident.homeCounty : "Anywhere")}{radiusKm > 0 ? ` · ${radiusKm}km` : ""}</span>} active={!!county || radiusKm > 0}>
              <DropdownOption label="Anywhere" active={!county} onClick={() => patchParams((p) => p.delete("county"))} />
              {countyOptions.map((c) => (
                <DropdownOption key={c} label={c} active={county === c} onClick={() => patchParams((p) => p.set("county", c))} />
              ))}
              <div style={{ borderTop: `1px solid ${colors.border}`, marginTop: 6, paddingTop: 8 }}>
                <div style={{ padding: "0 10px 6px", fontSize: 11.5, fontWeight: 700, color: colors.faint, textTransform: "uppercase", letterSpacing: 0 }}>Distance</div>
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

          </div>

          {/* Recent/Popular — an on-focus suggestions panel, not permanent
              page real estate. Closes on outside click/blur or once a query
              is typed. */}
          {suggestOpen && !inputValue.trim() && (recent.length > 0 || POPULAR.length > 0) && (
            <div
              style={{ position: "absolute", top: "calc(100% + 6px)", left: 0, right: 0, zIndex: 20, background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: radius.card, padding: 16, boxShadow: "0 12px 32px rgba(30,40,32,.14)" }}
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

        {/* Toolbar (owner, 2026-10-28). Desktop: Category | Type | When | Show
            | Filters | Sort. Phones keep one line — Category | When | Filters |
            Sort — with Type and Show inside Filters, shown as removable chips
            once chosen. Show and Sort only once there are results. */}
        <div role="toolbar" aria-label="Filter and sort" className="explore-toolbar" style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 8, marginBottom: 20 }}>
          <CategoryDropdown state={taxonomy} floating={narrow} />
          {!narrow && <CategoryTypeDropdown state={taxonomy} />}
          <FilterDropdown label={<span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><CalendarIcon size={13} />{WHEN_LABELS[when] ?? "Anytime"}</span>} active={when !== ""} closeOnSelect floating={narrow}>
            {Object.entries(WHEN_LABELS).map(([v, l]) => (
              <DropdownOption key={v} label={l} active={when === v} onClick={() => patchParams((p) => (v ? p.set("when", v) : p.delete("when")))} />
            ))}
          </FilterDropdown>
          {/* Stays visible while a type is chosen, so it can always be undone. */}
          {!narrow && showMenuOn && (
            <FilterDropdown label={resultType ? `Show: ${resultTypeLabel}` : "Show"} active={!!resultType} closeOnSelect>
              {showOptions}
            </FilterDropdown>
          )}
          <FilterDropdown label={`Filters${filtersBadge ? ` · ${filtersBadge}` : ""}`} active={filtersBadge > 0} floating={narrow}>
            {narrow && typeMenuOn && taxonomy.selected && (
              <FilterGroup title="Type">
                <DropdownOption label={`All ${taxonomy.selected.name.toLowerCase()}`} active={!taxonomy.selectedSub} onClick={() => taxonomy.setSub(null)} />
                {taxonomy.selected.subcategories.map((sc) => (
                  <DropdownOption key={sc.id} label={<CountLabel name={sc.name} count={sc.count} />} active={taxonomy.selectedSub?.id === sc.id} onClick={() => taxonomy.setSub(sc.slug)} />
                ))}
              </FilterGroup>
            )}
            {narrow && showMenuOn && <FilterGroup title="Show">{showOptions}</FilterGroup>}
            <FilterGroup title={narrow && (typeMenuOn || showMenuOn) ? "Only" : null}>
              <DropdownCheckbox label="Needs people" checked={needsPeopleOnly} onChange={() => patchParams((p) => (needsPeopleOnly ? p.delete("needsPeople") : p.set("needsPeople", "1")))} />
              <DropdownCheckbox label="Free" checked={freeOnly} onChange={() => patchParams((p) => (freeOnly ? p.delete("free") : p.set("free", "1")))} />
              <DropdownCheckbox label="Coming alone welcome" checked={soloOnly} onChange={() => patchParams((p) => (soloOnly ? p.delete("solo") : p.set("solo", "1")))} />
            </FilterGroup>
          </FilterDropdown>
          {isResultsMode && (
            <FilterDropdown label={sort === "recommended" ? "Sort" : `Sort: ${SORT_LABELS[sort]}`} align="right" closeOnSelect floating={narrow}>
              {(Object.keys(SORT_LABELS) as SortKey[]).map((k) => (
                <DropdownOption key={k} label={SORT_LABELS[k]} active={sort === k} onClick={() => patchParams((p) => (k === "recommended" ? p.delete("sort") : p.set("sort", k)))} />
              ))}
            </FilterDropdown>
          )}
        </div>

        {isResultsMode ? (
          <>
            {/* Results bar — title and count on the left; every way to narrow
                the results is a dropdown on the right (owner, 2026-10-28:
                no extra chip rows). */}
            <div style={{ marginBottom: 18 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
                <div style={{ minWidth: 0 }}>
                  <h2 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: "var(--section-title-size, 22px)", lineHeight: 1.1, margin: 0 }}>
                    {isSearchLoading ? "Looking…" : resultsFailed ? "Results unavailable" : `${visibleMatches} ${visibleMatches === 1 ? "thing" : "things"} to explore`}
                  </h2>
                  <p style={{ fontSize: 14, color: colors.mutedLight, margin: "4px 0 0" }}>
                    {contextTitle}
                    {!isSearchLoading && resultType && visibleMatches !== totalMatches ? ` · ${visibleMatches} of ${totalMatches} shown` : ""}
                  </p>
                  {/* Announces the new count after every filter change. */}
                  <span className="visually-hidden" role="status" aria-live="polite">
                    {isSearchLoading || resultsFailed ? "" : `${visibleMatches} ${visibleMatches === 1 ? "thing" : "things"} to explore`}
                  </span>
                </div>
              </div>
              {(activeFilterChips.length > 0 || (resident && result?.parsed && (result.parsed.county || result.parsed.keywords.length > 0))) && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginTop: 10 }}>
                  {activeFilterChips.map((c) => (
                    <span key={c.key} style={{ display: "inline-flex", alignItems: "center", gap: 5, background: colors.panel, borderRadius: radius.pill, padding: "5px 6px 5px 12px", fontSize: 12.5, fontWeight: 700, color: colors.text }}>
                      {c.label}
                      <button onClick={c.onRemove} aria-label={`Remove ${c.label} filter`} style={{ background: "none", border: "none", cursor: "pointer", color: colors.muted, display: "flex", padding: 4 }}>
                        <CloseIcon size={12} />
                      </button>
                    </span>
                  ))}
                  {activeFilterChips.length > 0 && anyFilterCount > 1 && (
                    <button onClick={clearAll} style={{ background: "none", border: "none", color: colors.muted, fontWeight: 700, fontSize: 12.5, cursor: "pointer" }}>
                      Reset all
                    </button>
                  )}
                {resident && result?.parsed && (result.parsed.county || result.parsed.keywords.length > 0) && (
                  <button
                    onClick={saveAlert}
                    disabled={alertState !== "idle"}
                    style={{
                      display: "inline-flex", alignItems: "center", gap: 6,
                      background: alertState === "saved" ? colors.greenBg : "none",
                      color: alertState === "saved" ? colors.greenText : colors.muted,
                      border: `1px solid ${alertState === "saved" ? colors.green : colors.border}`,
                      borderRadius: "var(--radius-button)", padding: "6px 12px", fontSize: 12.5, fontWeight: 600,
                      cursor: alertState === "idle" ? "pointer" : "default",
                    }}
                  >
                    <BellIcon size={13} />
                    {alertState === "saved" ? "We'll notify you" : alertState === "saving" ? "Saving…" : "Notify me about new sessions like this"}
                  </button>
                )}
                </div>
              )}
            </div>

            {isSearchLoading ? (
              <div className="listing-grid">
                {Array.from({ length: 6 }, (_, i) => <CardSkeleton key={i} />)}
              </div>
            ) : resultsFailed ? (
              <LoadErrorState
                title="We couldn't load these results"
                onRetry={() => (searching ? runSearch(qParam) : setFeedAttempt((n) => n + 1))}
              />
            ) : hasNoData && narrowed ? (
              // Filters took it to zero — offer to undo each one instead of a
              // dead end (the demand form below is for a genuine zero search).
              <div style={{ background: colors.panel, borderRadius: radius.card, padding: "28px 24px", textAlign: "center" }}>
                <h3 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 19, margin: "0 0 6px" }}>Nothing matches those filters just yet.</h3>
                <p style={{ fontSize: 14.5, color: colors.muted, margin: "0 0 16px" }}>Try removing one of them.</p>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center" }}>
                  {/* Type and Show have their own buttons below. */}
                  {activeFilterChips.filter((c) => c.key !== "type" && c.key !== "show").map((c) => (
                    <Button key={c.key} variant="ghost" onClick={c.onRemove}>Remove {c.label}</Button>
                  ))}
                  {when && <Button variant="ghost" onClick={() => patchParams((p) => p.delete("when"))}>Any date</Button>}
                  {(county || radiusKm > 0) && <Button variant="ghost" onClick={() => patchParams((p) => { p.delete("county"); p.delete("radiusKm"); })}>Anywhere</Button>}
                  {resultType && <Button variant="ghost" onClick={() => patchParams((p) => p.delete("rtype"))}>Show all types</Button>}
                  {taxonomy.selectedSub && <Button variant="ghost" onClick={() => taxonomy.setSub(null)}>All {taxonomy.selected?.name.toLowerCase()}</Button>}
                  <Button variant="ghost" onClick={clearAll}>Clear all filters</Button>
                </div>
                <CategoryEmptyHint state={taxonomy} basePath="/explore" />
              </div>
            ) : hasNoData ? (
              <EmptyState
                icon={<SearchIcon size={22} />}
                title={qParam.trim() || mood ? "Nothing matched yet" : "Nothing here right now"}
                subtitle="Try a different phrasing, widen the distance, or drop a filter."
                action={<IntentCaptureForm activityLabel={emptyStateActivityLabel} county={emptyStateCounty} timeOfDay={result?.parsed?.timeOfDay} maxPriceEuro={result?.parsed?.maxPriceEuro} />}
              />
            ) : hasNoVisibleData ? (
              <div style={{ background: colors.panel, borderRadius: radius.card, padding: "24px", textAlign: "center" }}>
                <p style={{ fontSize: 14.5, color: colors.muted, margin: "0 0 12px" }}>
                  No {RESULT_TYPE_OPTIONS.find((o) => o.v === resultType)?.l.toLowerCase()} here — but there {totalMatches === 1 ? "is" : "are"} {totalMatches} other match{totalMatches === 1 ? "" : "es"}.
                </p>
                <button
                  onClick={() => patchParams((p) => p.delete("rtype"))}
                  className="btn-cta" style={{ background: "var(--color-cta)", color: "var(--color-on-cta)", border: "none", borderRadius: "var(--radius-button)", minWidth: "var(--button-min-width)", padding: "9px 18px", fontSize: 13.5, fontWeight: 700, cursor: "pointer" }}
                >
                  Show all results
                </button>
              </div>
            ) : (
              <>
                {/* Batch 2 — one grid for every result type (the type chips
                    above already narrow it), instead of a headed section per
                    type that left half-empty rows. */}
                {/* The normal cards, each with its Bold word over the photo
                    (owner, 2026-10-28). Circles keep their own card. */}
                <CardGrid>
                  {visibleActivities.map((a) => (
                    <DiscoverCard key={`${a.kind}-${a.id}`} item={a} isToday={a.date === irelandToday()} fill word={cardWord(a.category, KIND_WORD[a.kind] ?? "Activity", chosenWord)} />
                  ))}
                  {experiences.map((e) => <ExperienceSearchCard key={e.id} e={e} chosenWord={chosenWord} />)}
                  {programmes.map((p) => <ProgrammeResultCard key={`programme-${p.id}`} p={p} word={cardWord(p.category, "Programme", chosenWord)} />)}
                  {circleResults.map((c) => <CircleResultCard key={`circle-${c.id}`} c={c} />)}
                  {centres.map((c) => <CentreCard key={c.id} centre={c} />)}
                  {clubs.map((c) => <ClubCard key={c.id} club={c} />)}
                </CardGrid>
              </>
            )}
          </>
        ) : (
          <>
            <div className="explore-categories" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 14, marginBottom: 36 }}>
              {CATEGORIES.map((c) => {
                const active = categoryType === c.key;
                return (
                  <button
                    key={c.key}
                    onClick={() => (c.direct ? navigate(c.to) : patchParams((p) => (active ? p.delete("cat") : p.set("cat", c.key))))}
                    style={{
                      display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 10, textAlign: "left",
                      background: active ? colors.greenBg : colors.surface,
                      border: `1px solid ${active ? colors.green : colors.border}`,
                      borderRadius: radius.card, padding: 18, cursor: "pointer",
                    }}
                  >
                    <div style={{ width: 40, height: 40, borderRadius: "50%", background: active ? colors.surface : colors.greenBg, color: colors.greenText, display: "flex", alignItems: "center", justifyContent: "center" }}>{c.icon}</div>
                    <div style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 16 }}>{c.label}</div>
                    <div style={{ fontSize: 12.5, color: colors.mutedLight }}>{c.desc}</div>
                  </button>
                );
              })}
            </div>

            {categoryType ? (
              <div style={{ marginBottom: 36 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
                  <h2 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: "var(--section-title-size, 20px)", margin: 0 }}>
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
                      <div className="listing-grid">
                        {Array.from({ length: 10 }).map((_, i) => (
                          <CardSkeleton key={i} />
                        ))}
                      </div>
                    ) : shown.length === 0 ? (
                      <div style={{ background: colors.panel, borderRadius: radius.card, padding: "24px", textAlign: "center", color: colors.muted, fontSize: 14 }}>
                        {(gamesPreview?.length ?? 0) > 0 ? "Nothing matches that filter yet." : "Nothing here yet."}
                      </div>
                    ) : (
                      <CardGrid>
                        {shown.map((a) => (
                          <DiscoverCard key={`${a.kind}-${a.id}`} item={a} isToday={a.date === irelandToday()} fill />
                        ))}
                      </CardGrid>
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
                      <div className="listing-grid">
                        {Array.from({ length: 10 }).map((_, i) => (
                          <CardSkeleton key={i} />
                        ))}
                      </div>
                    ) : shown.length === 0 ? (
                      <div style={{ background: colors.panel, borderRadius: radius.card, padding: "24px", textAlign: "center", color: colors.muted, fontSize: 14 }}>
                        Nothing here yet.
                      </div>
                    ) : (
                      <CardGrid>
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
                      </CardGrid>
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
                  className="btn-cta" style={{ background: "var(--color-cta)", color: "var(--color-on-cta)", border: "none", borderRadius: "var(--radius-button)", minWidth: "var(--button-min-width)", padding: "9px 18px", fontSize: 13.5, fontWeight: 700, cursor: "pointer" }}
                >
                  Widen to {RADIUS_OPTIONS[Math.min(RADIUS_OPTIONS.indexOf(radiusKm) + 1, RADIUS_OPTIONS.length - 1)] || "any distance"}
                  {RADIUS_OPTIONS[Math.min(RADIUS_OPTIONS.indexOf(radiusKm) + 1, RADIUS_OPTIONS.length - 1)] ? "km" : ""}
                </button>
              </div>
            ) : (
              <>
                {/* The radius found nothing with a confirmed location, so the
                    server sent the county it was measured from (owner 2026-10-27). */}
                {feed.radiusFallback && (
                  <p role="status" style={{ margin: "0 0 20px", padding: "12px 16px", borderRadius: radius.card, background: colors.panel, fontSize: 14.5, color: colors.muted }}>
                    No exact distances for places near you yet, so here's everything in <strong style={{ color: colors.text }}>{feed.radiusFallback.county}</strong>.{" "}
                    <button type="button" className="link-button" onClick={() => patchParams((p) => p.delete("radiusKm"))} style={{ background: "none", border: "none", padding: 0, font: "inherit", fontWeight: 700, color: colors.text, textDecoration: "underline", cursor: "pointer" }}>
                      Show all of Ireland
                    </button>
                  </p>
                )}
                {/* Every row the same photo card, a line between rows
                    (Explore cleanup, owner 2026-10-27). */}
                {followFeed.length > 0 && (
                  <section className="ex-row" aria-label="From people you follow">
                    <FollowFeedRow items={followFeed} />
                  </section>
                )}
                {needPeopleFeed.length > 0 && (
                  <section className="ex-row" aria-label="Needs a few more people">
                    <DiscoverRow title="Needs a few more people" subtitle="Join now and it goes ahead." items={needPeopleFeed} isToday limit={12} moreHref="/explore?needsPeople=1" />
                  </section>
                )}
                {feed.today.length > 0 && (
                  <section className="ex-row" aria-label="Happening today">
                    <DiscoverRow title="Happening today" items={feed.today} isToday limit={8} moreHref="/explore?when=today" layout="grid" />
                  </section>
                )}
                {feed.weekend.length > 0 && (
                  <section className="ex-row" aria-label="This weekend">
                    <DiscoverRow title="This weekend" items={feed.weekend} limit={8} moreHref="/explore?when=weekend" layout="grid" />
                  </section>
                )}
                <ExploreCollections county={county} />
              </>
            )}
          </>
        )}
      </section>

      {/* A featured section (owner 2026-10-27). */}
      <div className="section-pad" style={{ maxWidth, margin: "0 auto", padding: "0 24px" }}>
        <FeaturedPicks kind="circles" />
      </div>

      <CtaBand
        id="explore-cta-title"
        panel={{ title: "Tell us what you'd like", text: "We'll help you get people together for it.", icon: <SparklesLucide size={20} strokeWidth={2} /> }}
        lines={["Can't find", "your", "thing?"]}
        text="Tell us what you'd like to do and where — we'll help you get people together."
        action={{ label: "Make it happen", to: "/make-it-happen" }}
      />
    </div>
  );
}

type SearchProgramme = NonNullable<SearchResult["programmes"]>[number];
type SearchCircle = NonNullable<SearchResult["circles"]>[number];

/** Unified-search programme result (the programme, not one of its sessions). */
function ProgrammeResultCard({ p, word }: { p: SearchProgramme; word: string }) {
  const navigate = useNavigate();
  const href = `/programs/${p.id}`;
  return (
    <ListingCard
      href={href}
      title={p.title}
      image={p.imageUrl}
      ph={placeholderStripes.green}
      icon={<GridIcon size={20} />}
      iconColor={colors.green}
      tag="Programme"
      word={word}
      details={[{ icon: <PinIcon size={13} />, text: [p.parentName, p.area || p.county].filter(Boolean).join(" · ") }]}
      facts={<span>{p.nextSessionDate ? `Next: ${dateLabel(p.nextSessionDate)}` : "Ongoing"}{priceState(p) === "unknown" ? "" : p.priceCents ? ` · ${euro(p.priceCents / 100)}` : " · Free"}</span>}
      action={
        <CardArrow label={`View programme: ${p.title}`} onClick={() => navigate(href)} />
      }
    />
  );
}

/** Unified-search Circle result — teaser fields only (approval Circles never show more). */
function CircleResultCard({ c }: { c: SearchCircle }) {
  const navigate = useNavigate();
  const href = `/circles/${c.slug ?? c.id}`;
  return (
    <ListingCard
      href={href}
      title={c.name}
      image={null}
      ph={placeholderStripes.orange}
      icon={<UsersIcon size={20} />}
      iconColor={colors.orange}
      tag="Circle"
      details={[{ icon: <PinIcon size={13} />, text: [c.activityLabel, c.area || c.county].filter(Boolean).join(" · ") }]}
      facts={<span>{c.members} {c.members === 1 ? "member" : "members"}</span>}
      action={
        <CardArrow label={`View Circle: ${c.name}`} onClick={() => navigate(href)} />
      }
    />
  );
}
