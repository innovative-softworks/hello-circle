import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ArrowRight, Award, CalendarDays, ChevronDown, Heart, LayoutGrid, List, LocateFixed, MapPin, Search, SlidersHorizontal, Users, X } from "lucide-react";
import { declineInviteConfirm } from "../confirmCopy";
import { useConfirm } from "../components/ConfirmProvider";
import { signInHref } from "../authRedirect";
import {
  createCircle,
  fetchCircleMembership,
  fetchCircleSuggestions,
  fetchCircles,
  fetchCirclesPage,
  fetchGamesPage,
  fetchMyCircleInvitations,
  fetchMyCircles,
  joinCircle,
  respondToCircleInvitation,
} from "../api";
import { IntentCaptureForm } from "../components/IntentCaptureForm";
import { useSavedState } from "../components/SaveButton";
import { useToast } from "../components/Toast";
import { ConfirmDialog } from "../components/ui";
import { useGuest } from "../GuestContext";
import { dateLabel } from "../euro";
import { getCircleCoverUrl, getMediaUrl } from "../media";
import { nearestCounty } from "../irishCounties";
import { irelandDaysFromToday } from "../irelandDate";
import type { Circle, CircleInvitation, CircleSuggestion, Game } from "../types";
import "./homeEditorial.css";
import "./circlesPage.css";
import { CtaBand } from "../components/CtaBand";

// Circles page — UX pass (2026-10-12) on the editorial rebuild. One search
// bar (search / location / interest / meeting time), one row of quick
// filters, filter state in the URL, an accurate results count, a compact
// filter sheet on phones, and four merged lower sections (upcoming meetups,
// explore by interest, Circles near you, new & growing).
//
// Data honesty rules (see the audit):
// - A Circle's "next plan" counts as its meetup only when the server says it
//   belongs to the Circle (nextPlan.source === "circle"). "nearby" plans are
//   other activities that share the label, so they are never shown as the
//   Circle's meetup — "See activities nearby" links to them instead.
// - Interests are keyword groups over the activity name (there is no
//   category field), the same approach Explore's mood filter uses.
// - "Request sent" comes from the server per approval Circle (membership
//   lookup) or from the join response; it is never assumed.
// - Location is county-level: Circles have no coordinates, so "Near me"
//   maps the device location to the nearest county, after permission.

const DAY_MS = 86400000;
const PAGE_SIZE = 12;
const HERO_PHOTO = "https://images.unsplash.com/photo-1517649763962-0c623066013b?w=1800&q=72&auto=format&fit=crop";
const FALLBACK_PLACE = "https://images.unsplash.com/photo-1637548076898-f896229b2f3b?w=700&q=72&auto=format&fit=crop";

type InterestKey = "sports" | "outdoors" | "wellness" | "social" | "arts" | "volunteering";
const INTERESTS: { key: InterestKey; label: string; words: string[] }[] = [
  { key: "sports", label: "Sports & games", words: ["football", "soccer", "gaa", "hurling", "rugby", "basketball", "tennis", "badminton", "padel", "hockey", "run", "parkrun", "cycling", "cycle", "swim", "athletics", "chess", "board game", "squash"] },
  { key: "outdoors", label: "Outdoors & adventure", words: ["hike", "hiking", "walk", "trail", "kayak", "surf", "climb", "outdoor", "parkrun", "cycling", "sea swim", "camping"] },
  { key: "wellness", label: "Wellness", words: ["yoga", "pilates", "meditation", "wellness", "fitness", "mindful"] },
  { key: "social", label: "Social & community", words: ["coffee", "chat", "meetup", "social", "book", "board game", "quiz", "community"] },
  { key: "arts", label: "Arts & culture", words: ["book", "art", "paint", "pottery", "music", "choir", "film", "theatre", "photo", "craft", "writing"] },
  { key: "volunteering", label: "Volunteering", words: ["volunteer", "clean", "garden", "charity", "litter"] },
];
const INTEREST_BY_KEY = Object.fromEntries(INTERESTS.map((i) => [i.key, i])) as Record<InterestKey, (typeof INTERESTS)[number]>;

type WhenFilter = "any" | "weekday" | "weekend" | "morning" | "evening";
type SortKey = "recommended" | "most-active" | "meeting-soon" | "newest";
const WHEN_LABELS: Record<WhenFilter, string> = { any: "Any time", weekday: "Weeknights", weekend: "Weekends", morning: "Mornings", evening: "Evenings" };
const SORT_LABELS: Record<SortKey, string> = { recommended: "Recommended", "most-active": "Most active", "meeting-soon": "Meeting soon", newest: "Newest" };

function daysUntil(iso: string): number {
  return (new Date(`${iso}T00:00:00`).getTime() - Date.now()) / DAY_MS;
}

/** The Circle's own next meetup — never a nearby activity sharing its label. */
function ownPlan(c: Circle) {
  return c.nextPlan && c.nextPlan.source === "circle" ? c.nextPlan : null;
}

function isNew(c: Circle): boolean {
  return (Date.now() - new Date(c.createdAt).getTime()) / DAY_MS <= 30;
}

function matchesInterest(c: Circle, key: InterestKey): boolean {
  const hay = `${c.activityLabel} ${c.name}`.toLowerCase();
  return INTEREST_BY_KEY[key].words.some((w) => hay.includes(w));
}

function planMatchesWhen(c: Circle, when: WhenFilter): boolean {
  if (when === "any") return true;
  const p = ownPlan(c);
  if (!p) return false;
  const dow = new Date(`${p.date}T00:00:00`).getDay();
  const weekend = dow === 0 || dow === 6;
  const hour = parseInt(p.time.split(":")[0] ?? "0", 10);
  if (when === "weekend") return weekend;
  if (when === "weekday") return !weekend && hour >= 17;
  if (when === "morning") return hour < 12;
  return hour >= 17;
}

function compareCircles(a: Circle, b: Circle, sort: SortKey): number {
  const pa = ownPlan(a);
  const pb = ownPlan(b);
  if (sort === "newest") return b.createdAt.localeCompare(a.createdAt);
  if (sort === "most-active") return b.plansThisMonth - a.plansThisMonth || a.name.localeCompare(b.name);
  if (sort === "meeting-soon") {
    if (pa && pb) return `${pa.date}${pa.time}`.localeCompare(`${pb.date}${pb.time}`);
    return pa ? -1 : pb ? 1 : a.name.localeCompare(b.name);
  }
  // Recommended — a real meetup within 7 days, then any real meetup, then
  // new Circles, then the rest. Never sorted by member count.
  const tier = (c: Circle, p: ReturnType<typeof ownPlan>) => (p && daysUntil(p.date) <= 7 ? 0 : p ? 1 : isNew(c) ? 2 : 3);
  const diff = tier(a, pa) - tier(b, pb);
  if (diff) return diff;
  if (pa && pb) return `${pa.date}${pa.time}`.localeCompare(`${pb.date}${pb.time}`);
  return b.createdAt.localeCompare(a.createdAt);
}

function topCounts(values: string[], limit: number): { label: string; count: number }[] {
  const counts = new Map<string, number>();
  values.forEach((v) => counts.set(v, (counts.get(v) ?? 0) + 1));
  return Array.from(counts.entries())
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .slice(0, limit);
}

function firstCover(rows: Circle[]): string | null {
  for (const c of rows) {
    const cover = getCircleCoverUrl(c);
    if (cover) return cover;
  }
  return null;
}

const QUICK_KEYS = ["active", "new"] as const;
type QuickKey = (typeof QUICK_KEYS)[number];

export function Circles() {
  const navigate = useNavigate();
  const { resident } = useGuest();
  const toast = useToast();
  const confirm = useConfirm();
  const [params, setParams] = useSearchParams();

  // ---- Filter state lives in the URL (shareable, survives Back). ----
  const query = params.get("q") ?? "";
  const county = params.get("county") ?? "All";
  const activity = params.get("activity") ?? "All"; // deep links from other pages
  const interest = (params.get("interest") as InterestKey | null) ?? null;
  const when = (params.get("when") as WhenFilter | null) ?? "any";
  const sort = (params.get("sort") as SortKey | null) ?? "recommended";
  const view = params.get("view") === "list" ? "list" : "grid";
  const quick = useMemo(() => new Set((params.get("show") ?? "").split(",").filter((k): k is QuickKey => (QUICK_KEYS as readonly string[]).includes(k))), [params]);
  const nearMe = params.get("near") === "1";
  const setParam = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    Object.entries(patch).forEach(([k, v]) => (v === null || v === "" || v === "All" || v === "any" ? next.delete(k) : next.set(k, v)));
    if (patch.sort === "recommended") next.delete("sort");
    if (patch.view === "grid") next.delete("view");
    setParams(next, { replace: true });
  };
  const toggleQuick = (k: QuickKey) => {
    const s = new Set(quick);
    if (s.has(k)) s.delete(k);
    else s.add(k);
    setParam({ show: Array.from(s).join(",") || null });
  };
  const setInterest = (k: InterestKey | null) => setParam({ interest: k === interest ? null : k });
  const clearAll = () => setParams(new URLSearchParams(view === "list" ? { view: "list" } : {}), { replace: true });

  const [queryInput, setQueryInput] = useState(query);
  useEffect(() => setQueryInput(query), [query]);
  useEffect(() => {
    const t = setTimeout(() => {
      if (queryInput.trim() !== query) setParam({ q: queryInput.trim() || null });
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryInput]);

  // ---- Data ----
  const [circles, setCircles] = useState<Circle[]>([]);
  const [allCircles, setAllCircles] = useState<Circle[]>([]); // aggregates for the lower sections
  // Counts derived from allCircles are only shown once it has really loaded —
  // a failed or pending request must never read as "0 Circles" (HC-QA-063).
  const [aggregatesLoaded, setAggregatesLoaded] = useState(false);
  const [games, setGames] = useState<Game[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreFailed, setLoadMoreFailed] = useState(false);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [joinedIds, setJoinedIds] = useState<Set<string>>(new Set());
  const [requestedIds, setRequestedIds] = useState<Set<string>>(new Set());
  const [busyId, setBusyId] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<CircleSuggestion[]>([]);
  const [suggestionBusy, setSuggestionBusy] = useState<string | null>(null);
  const [invitations, setInvitations] = useState<CircleInvitation[]>([]);
  const [respondingId, setRespondingId] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const [locationNote, setLocationNote] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  const resultsRef = useRef<HTMLElement>(null);
  const whereRef = useRef<HTMLSelectElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const filterBtnRef = useRef<HTMLButtonElement>(null);
  const requestSeq = useRef(0);

  const serverFilters = useMemo(() => ({ q: query || undefined, county: county !== "All" ? county : undefined, activity: activity !== "All" ? activity : undefined }), [query, county, activity]);
  const filterKey = JSON.stringify(serverFilters);

  const load = () => {
    const seq = ++requestSeq.current;
    setLoading(true);
    setLoadFailed(false);
    setLoadMoreFailed(false);
    setVisibleCount(PAGE_SIZE);
    fetchCirclesPage(serverFilters)
      .then((page) => {
        if (seq !== requestSeq.current) return;
        setCircles(page.items);
        setNextCursor(page.nextCursor);
      })
      .catch(() => {
        if (seq === requestSeq.current) setLoadFailed(true);
      })
      .finally(() => {
        if (seq === requestSeq.current) setLoading(false);
      });
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [filterKey]);

  const loadMore = () => {
    if (!nextCursor || loadingMore) return;
    const seq = requestSeq.current;
    setLoadingMore(true);
    setLoadMoreFailed(false);
    fetchCirclesPage(serverFilters, nextCursor)
      .then((page) => {
        if (seq !== requestSeq.current) return;
        setCircles((prev) => {
          const ids = new Set(prev.map((c) => c.id));
          return [...prev, ...page.items.filter((c) => !ids.has(c.id))];
        });
        setNextCursor(page.nextCursor);
      })
      .catch(() => {
        if (seq === requestSeq.current) setLoadMoreFailed(true);
      })
      .finally(() => setLoadingMore(false));
  };

  // Client-side filters (interest / time / quick) can only be accurate over
  // every page, so while one is on, the remaining pages load in the
  // background and the count says "checking more" until they have.
  const clientFiltering = !!interest || when !== "any" || quick.size > 0;
  useEffect(() => {
    if (clientFiltering && nextCursor && !loadingMore && !loadMoreFailed && !loading) loadMore();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientFiltering, nextCursor, loadingMore, loading]);

  useEffect(() => {
    fetchCircles()
      .then((rows) => {
        setAllCircles(rows.filter((c) => c.status === "active"));
        setAggregatesLoaded(true);
      })
      .catch(() => setAllCircles([]));
    const day = irelandDaysFromToday;
    fetchGamesPage({ dateFrom: day(0), dateTo: day(7), limit: 100 })
      .then((pg) => setGames(pg.items))
      .catch(() => setGames([]));
  }, []);

  useEffect(() => {
    if (!resident) {
      setJoinedIds(new Set());
      setRequestedIds(new Set());
      setSuggestions([]);
      setInvitations([]);
      return;
    }
    fetchMyCircles()
      .then((rows) => setJoinedIds(new Set(rows.map((c) => c.id))))
      .catch(() => {});
    fetchCircleSuggestions().then(setSuggestions).catch(() => setSuggestions([]));
    fetchMyCircleInvitations().then(setInvitations).catch(() => setInvitations([]));
  }, [resident]);

  // "Request sent" — asked of the server for approval Circles on screen.
  const checkedRequests = useRef(new Set<string>());
  useEffect(() => {
    if (!resident) return;
    const todo = circles.filter((c) => c.joinMode === "approval" && !joinedIds.has(c.id) && !checkedRequests.current.has(c.id)).slice(0, 24);
    todo.forEach((c) => {
      checkedRequests.current.add(c.id);
      fetchCircleMembership(c.id)
        .then((m) => {
          if (m.requested) setRequestedIds((s) => new Set(s).add(c.id));
          if (m.member) setJoinedIds((s) => new Set(s).add(c.id));
        })
        .catch(() => {});
    });
  }, [circles, resident, joinedIds]);

  // ---- Phone filter sheet: focus in, Esc closes, focus back, no scroll. ----
  useEffect(() => {
    if (!sheetOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const first = sheetRef.current?.querySelector<HTMLElement>("button, select");
    window.setTimeout(() => first?.focus(), 30);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSheetOpen(false);
      if (e.key !== "Tab" || !sheetRef.current) return;
      const f = Array.from(sheetRef.current.querySelectorAll<HTMLElement>("button, select, a[href]")).filter((el) => !el.hasAttribute("disabled"));
      if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) {
        e.preventDefault();
        f[f.length - 1].focus();
      } else if (!e.shiftKey && document.activeElement === f[f.length - 1]) {
        e.preventDefault();
        f[0].focus();
      }
    };
    document.addEventListener("keydown", onKey);
    const btn = filterBtnRef.current;
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener("keydown", onKey);
      btn?.focus();
    };
  }, [sheetOpen]);

  const scrollToResults = () => resultsRef.current?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
  const go = (to: string) => (e: React.MouseEvent) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    navigate(to);
  };

  // ---- Actions (unchanged business rules) ----
  const handleRespond = async (invite: CircleInvitation, accept: boolean) => {
    if (!accept && !(await confirm(declineInviteConfirm(invite.circleName)))) return;
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
      const res = await joinCircle(circle.id);
      // An approval Circle answers with requested: true — that is a request,
      // not a membership (the previous page showed "You're in" here).
      if (res.requested || circle.joinMode === "approval") {
        setRequestedIds((s) => new Set(s).add(circle.id));
        toast.success(`Request sent to ${circle.name}. You'll hear when the organiser replies.`);
      } else {
        setJoinedIds((s) => new Set(s).add(circle.id));
        toast.success(`You're in ${circle.name}.`);
      }
    } catch (e) {
      toast.error(e instanceof Error && e.message ? e.message : "Couldn't join this Circle right now — try again.");
    } finally {
      setBusyId(null);
    }
  };

  // ---- Derived ----
  const countyOptions = useMemo(() => Array.from(new Set(allCircles.map((c) => c.county).filter(Boolean))).sort((a, b) => a.localeCompare(b)), [allCircles]);

  const handleNearMe = () => {
    if (nearMe) return setParam({ near: null, county: null });
    setLocationNote(null);
    if (!navigator.geolocation) {
      setLocationNote("Location isn't available here — choose a county instead.");
      whereRef.current?.focus();
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        const match = nearestCounty(pos.coords.latitude, pos.coords.longitude, countyOptions);
        if (match) setParam({ county: match, near: "1" });
        else setLocationNote("Couldn't match your location to a county with Circles — choose one instead.");
      },
      (err) => {
        setLocating(false);
        setLocationNote(err.code === err.PERMISSION_DENIED ? "Location permission is off — choose a county instead." : "Couldn't get your location — choose a county instead.");
        whereRef.current?.focus();
      },
      { timeout: 8000 }
    );
  };

  const filtered = useMemo(
    () =>
      circles.filter((c) => {
        if (interest && !matchesInterest(c, interest)) return false;
        if (!planMatchesWhen(c, when)) return false;
        if (quick.has("active")) {
          const p = ownPlan(c);
          if (!(p && daysUntil(p.date) <= 7)) return false;
        }
        if (quick.has("new") && !isNew(c)) return false;
        return true;
      }),
    [circles, interest, when, quick]
  );
  const sorted = useMemo(() => [...filtered].sort((a, b) => compareCircles(a, b, sort)), [filtered, sort]);
  const visible = sorted.slice(0, visibleCount);
  const stillLoading = clientFiltering && !!nextCursor;
  const activeFilters = [
    query && { key: "q", label: `“${query}”`, clear: () => setParam({ q: null }) },
    county !== "All" && { key: "county", label: nearMe ? `Near me · ${county}` : county, clear: () => setParam({ county: null, near: null }) },
    activity !== "All" && { key: "activity", label: activity, clear: () => setParam({ activity: null }) },
    interest && { key: "interest", label: INTEREST_BY_KEY[interest]?.label, clear: () => setParam({ interest: null }) },
    when !== "any" && { key: "when", label: WHEN_LABELS[when], clear: () => setParam({ when: null }) },
    quick.has("active") && { key: "active", label: "Active this week", clear: () => toggleQuick("active") },
    quick.has("new") && { key: "new", label: "New Circles", clear: () => toggleQuick("new") },
  ].filter(Boolean) as { key: string; label: string; clear: () => void }[];

  const resultCount = loading ? "Searching…" : loadFailed ? "Circles couldn't load" : `${sorted.length}${nextCursor && !stillLoading ? "+" : ""} Circle${sorted.length === 1 ? "" : "s"} ${county === "All" ? "across Ireland" : `in ${county}`}${stillLoading ? " · checking more…" : ""}`;

  // Hero stats — verified counts, one quiet line.
  const thisWeekGames = useMemo(() => games.filter((g) => daysUntil(g.date) <= 7 && daysUntil(g.date) >= 0), [games]);
  const stats = { circles: allCircles.length, plans: thisWeekGames.length, joining: thisWeekGames.reduce((sum, g) => sum + g.joined, 0) };

  // A · Upcoming meetups — the Circles' own meetups only, next 14 days.
  const upcoming = useMemo(
    () =>
      allCircles
        .filter((c) => {
          const p = ownPlan(c);
          return p && daysUntil(p.date) > -1 && daysUntil(p.date) <= 14;
        })
        .sort((a, b) => `${ownPlan(a)!.date}${ownPlan(a)!.time}`.localeCompare(`${ownPlan(b)!.date}${ownPlan(b)!.time}`))
        .slice(0, 5),
    [allCircles]
  );
  // B · Explore by interest — real counts per keyword group.
  const interestTiles = useMemo(
    () =>
      INTERESTS.map((i) => {
        const rows = allCircles.filter((c) => matchesInterest(c, i.key));
        return { ...i, count: rows.length, image: firstCover(rows) };
      }),
    [allCircles]
  );
  // C · Circles near you — counties with counts.
  const countyTiles = useMemo(() => topCounts(allCircles.map((c) => c.county).filter(Boolean), 5).map((r) => ({ ...r, image: firstCover(allCircles.filter((c) => c.county === r.label)) })), [allCircles]);
  // D · New & growing — new, or a real meetup with places.
  const growing = useMemo(() => {
    const rows = allCircles
      .map((c) => {
        const p = ownPlan(c);
        const places = p && p.spotsLeft > 0 && daysUntil(p.date) > -1 ? p : null;
        return { c, isNew: isNew(c), places };
      })
      .filter((r) => r.isNew || r.places)
      .sort((a, b) => (a.places ? 0 : 1) - (b.places ? 0 : 1) || b.c.createdAt.localeCompare(a.c.createdAt));
    return rows.slice(0, 6);
  }, [allCircles]);

  const statusFor = (c: Circle): Status => (joinedIds.has(c.id) ? "member" : requestedIds.has(c.id) ? "requested" : c.joinMode);

  return (
    <div className="hx cx">
      {/* HERO — compact; same photo, headline and actions. */}
      <section className="cx-hero" aria-labelledby="cx-title">
        <div className="cx-hero-photo" aria-hidden="true">
          <img src={HERO_PHOTO} alt="" {...{ fetchpriority: "high" }} />
        </div>
        <div className="hx-wrap cx-hero-inner">
          <nav className="cx-crumb hx-label" aria-label="Breadcrumb">
            <a href="/" onClick={go("/")}>
              Home
            </a>{" "}
            <span aria-hidden="true">/</span> <span aria-current="page">Circles</span>
          </nav>
          <h1 id="cx-title" className="cx-title">
            Find people who keep <span className="hx-o">showing up.</span>
          </h1>
          <p className="cx-lede">Join recurring groups near you and turn the things you enjoy into something you do regularly with other people.</p>
          <div className="cx-hero-actions">
            <button type="button" className="hx-btn hx-btn--orange" onClick={scrollToResults}>
              Explore Circles <ArrowRight size={16} aria-hidden="true" />
            </button>
            <a className="hx-btn hx-btn--ghost" href="/circles/start" onClick={go("/circles/start")}>
              Start a Circle
            </a>
          </div>
          {allCircles.length > 0 && (
            <p className="cx-statline">
              {stats.circles} active Circle{stats.circles === 1 ? "" : "s"} · {stats.plans} plan{stats.plans === 1 ? "" : "s"} this week · {stats.joining} people joining in
            </p>
          )}
        </div>
      </section>

      {/* SEARCH + FILTERS — one bar, one row of quick filters. */}
      <section className="hx-wrap cx-searchwrap" aria-label="Search and filter Circles">
        <form
          className="hx-search cx-search"
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            setParam({ q: queryInput.trim() || null });
            scrollToResults();
          }}
        >
          <div className="hx-field hx-field--what">
            <label htmlFor="cx-q">Search</label>
            <Search size={18} className="hx-field-icon" aria-hidden="true" />
            <input id="cx-q" value={queryInput} onChange={(e) => setQueryInput(e.target.value)} placeholder="Circles, interests or activities" autoComplete="off" enterKeyHint="search" />
            {queryInput && (
              <button type="button" className="hx-clear" aria-label="Clear search" onClick={() => (setQueryInput(""), setParam({ q: null }))}>
                <X size={16} aria-hidden="true" />
              </button>
            )}
          </div>
          <div className="hx-field cx-field-desk">
            <label htmlFor="cx-where">Location</label>
            <MapPin size={18} className="hx-field-icon" aria-hidden="true" />
            <select ref={whereRef} id="cx-where" value={county} onChange={(e) => setParam({ county: e.target.value, near: null })}>
              <option value="All">Anywhere in Ireland</option>
              {countyOptions.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div className="hx-field cx-field-desk">
            <label htmlFor="cx-interest">Interest</label>
            <Users size={18} className="hx-field-icon" aria-hidden="true" />
            <select id="cx-interest" value={interest ?? ""} onChange={(e) => setParam({ interest: e.target.value || null })}>
              <option value="">All interests</option>
              {INTERESTS.map((i) => (
                <option key={i.key} value={i.key}>
                  {i.label}
                </option>
              ))}
            </select>
          </div>
          <div className="hx-field cx-field-desk">
            <label htmlFor="cx-when">Meeting time</label>
            <CalendarDays size={18} className="hx-field-icon" aria-hidden="true" />
            <select id="cx-when" value={when} onChange={(e) => setParam({ when: e.target.value })}>
              {(Object.keys(WHEN_LABELS) as WhenFilter[]).map((w) => (
                <option key={w} value={w}>
                  {WHEN_LABELS[w]}
                </option>
              ))}
            </select>
          </div>
          <button type="submit" className="hx-btn hx-btn--orange hx-search-go">
            Search <ArrowRight size={16} aria-hidden="true" />
          </button>
        </form>

        <div className="cx-filters">
          {/* Phones: the filters live in a sheet. */}
          <button ref={filterBtnRef} type="button" className="cx-pill cx-filter-btn" aria-haspopup="dialog" aria-expanded={sheetOpen} onClick={() => setSheetOpen(true)}>
            <SlidersHorizontal size={15} aria-hidden="true" /> Filters{activeFilters.length ? ` · ${activeFilters.length}` : ""} · Sort
          </button>
          <div className="cx-pills cx-quick" role="group" aria-label="Quick filters">
            <button type="button" className={`cx-pill${activeFilters.length === 0 ? " is-on" : ""}`} aria-pressed={activeFilters.length === 0} onClick={clearAll}>
              All Circles
            </button>
            <button type="button" className={`cx-pill${quick.has("active") ? " is-on" : ""}`} aria-pressed={quick.has("active")} onClick={() => toggleQuick("active")}>
              Active this week
            </button>
            <button type="button" className={`cx-pill${quick.has("new") ? " is-on" : ""}`} aria-pressed={quick.has("new")} onClick={() => toggleQuick("new")}>
              New Circles
            </button>
            <button type="button" className={`cx-pill${nearMe ? " is-on" : ""}`} aria-pressed={nearMe} onClick={handleNearMe} disabled={locating}>
              <LocateFixed size={15} aria-hidden="true" /> {locating ? "Locating…" : "Near me"}
            </button>
            {(["sports", "social", "outdoors"] as InterestKey[]).map((k) => (
              <button key={k} type="button" className={`cx-pill${interest === k ? " is-on" : ""}`} aria-pressed={interest === k} onClick={() => setInterest(k)}>
                {k === "sports" ? "Sports" : k === "social" ? "Social" : "Outdoors"}
              </button>
            ))}
          </div>
          <label className="cx-sort">
            <span>Sort by</span>
            <select value={sort} onChange={(e) => setParam({ sort: e.target.value })} aria-label="Sort Circles">
              {(Object.keys(SORT_LABELS) as SortKey[]).map((k) => (
                <option key={k} value={k}>
                  {SORT_LABELS[k]}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div aria-live="polite">{locationNote && <p className="cx-note">{locationNote}</p>}</div>
        {activeFilters.length > 0 && (
          <div className="cx-active" aria-label="Active filters">
            {activeFilters.map((f) => (
              <button key={f.key} type="button" className="cx-chip" onClick={f.clear} aria-label={`Remove filter ${f.label}`}>
                {f.label} <X size={14} aria-hidden="true" />
              </button>
            ))}
            <button type="button" className="hx-link cx-clear" onClick={clearAll}>
              Clear filters
            </button>
          </div>
        )}
      </section>

      {/* Personal: invitations + "make it a Circle" suggestions. */}
      {(invitations.length > 0 || suggestions.length > 0) && (
        <section className="hx-wrap cx-notices" aria-label="For you">
          {invitations.map((inv) => (
            <div key={inv.id} className="cx-notice">
              <Award size={20} aria-hidden="true" />
              <p>
                <strong>{inv.invitedByName}</strong> invited you to <strong>{inv.circleName}</strong>
                {inv.activityLabel ? ` (${inv.activityLabel})` : ""}
              </p>
              <div className="hx-inline-links">
                <button type="button" className="hx-btn hx-btn--orange cx-btn-sm" onClick={() => handleRespond(inv, true)} disabled={respondingId === inv.id}>
                  Accept
                </button>
                <button type="button" className="hx-btn hx-btn--ghost cx-btn-sm" onClick={() => handleRespond(inv, false)} disabled={respondingId === inv.id}>
                  Decline
                </button>
              </div>
            </div>
          ))}
          {suggestions.map((sg) => (
            <div key={sg.activityLabel} className="cx-notice">
              <Users size={20} aria-hidden="true" />
              <p>
                You've played <strong>{sg.activityLabel}</strong> with the same {sg.familiarCount} people more than once. Make it a Circle?
              </p>
              <button type="button" className="hx-btn hx-btn--orange cx-btn-sm" onClick={() => handleCreateFromSuggestion(sg)} disabled={suggestionBusy === sg.activityLabel}>
                {suggestionBusy === sg.activityLabel ? "Creating…" : `Create ${sg.activityLabel} Circle`}
              </button>
            </div>
          ))}
        </section>
      )}

      {/* FIND YOUR NEXT CIRCLE — the main focus. */}
      <section className="hx-wrap cx-results" aria-labelledby="cx-results-title" ref={resultsRef}>
        <div className="cx-results-head">
          <div>
            <h2 id="cx-results-title" className="cx-h2">
              Find your next Circle
            </h2>
            <p className="cx-sub" role="status">
              {resultCount}
            </p>
          </div>
          <div className="cx-view" role="group" aria-label="View">
            <button type="button" className={view === "grid" ? "is-on" : undefined} aria-pressed={view === "grid"} onClick={() => setParam({ view: "grid" })}>
              <LayoutGrid size={16} aria-hidden="true" /> Grid
            </button>
            <button type="button" className={view === "list" ? "is-on" : undefined} aria-pressed={view === "list"} onClick={() => setParam({ view: "list" })}>
              <List size={16} aria-hidden="true" /> List
            </button>
          </div>
        </div>

        {loading && circles.length === 0 ? (
          <ul className="cx-grid" aria-busy="true" aria-label="Loading Circles">
            {Array.from({ length: 8 }, (_, i) => (
              <li key={i} className="cx-card cx-card--skeleton">
                <span className="hx-skel hx-skel--block" />
                <span className="cx-card-body">
                  <span className="hx-skel hx-skel--title" />
                  <span className="hx-skel" />
                  <span className="hx-skel hx-skel--short" />
                </span>
              </li>
            ))}
          </ul>
        ) : loadFailed ? (
          <div className="cx-empty" role="alert">
            <strong>We couldn't load Circles right now.</strong>
            <p>Check your connection and try again — your filters are kept.</p>
            <button type="button" className="hx-btn hx-btn--orange" onClick={load}>
              Try again
            </button>
          </div>
        ) : sorted.length === 0 && !stillLoading ? (
          <div className="cx-empty">
            <strong>{county !== "All" && activeFilters.length === 1 ? `No Circles in ${county} yet.` : "No Circles match your search."}</strong>
            <p>{county !== "All" && activeFilters.length === 1 ? "Try somewhere nearby, or start the first Circle there." : "Try another activity or location, or start a Circle of your own."}</p>
            <div className="hx-inline-links cx-empty-actions">
              {activeFilters.length > 0 && (
                <button type="button" className="hx-btn hx-btn--ghost" onClick={clearAll}>
                  Clear filters
                </button>
              )}
              <a className="hx-btn hx-btn--orange" href="/circles/start" onClick={go("/circles/start")}>
                Start a Circle
              </a>
            </div>
          </div>
        ) : (
          <>
            <ul className={view === "grid" ? "cx-grid" : "cx-list"} aria-busy={loading || stillLoading}>
              {visible.map((c) => (
                <li key={c.id}>
                  <CircleItem circle={c} layout={view} status={statusFor(c)} busy={busyId === c.id} signedIn={!!resident} onJoin={() => handleJoin(c)} onGo={navigate} />
                </li>
              ))}
            </ul>
            <div className="cx-more">
              {visibleCount < sorted.length ? (
                <button type="button" className="hx-btn hx-btn--ghost" onClick={() => setVisibleCount((v) => v + PAGE_SIZE)}>
                  Load more Circles ({sorted.length - visibleCount} more) <ChevronDown size={16} aria-hidden="true" />
                </button>
              ) : nextCursor && !clientFiltering ? (
                <button type="button" className="hx-btn hx-btn--ghost" onClick={loadMore} disabled={loadingMore}>
                  {loadingMore ? "Loading…" : loadMoreFailed ? "Couldn't load — try again" : "Load more Circles"} <ChevronDown size={16} aria-hidden="true" />
                </button>
              ) : sorted.length > PAGE_SIZE ? (
                <p role="status" className="cx-sub">
                  That's every Circle that matches.
                </p>
              ) : null}
            </div>
          </>
        )}
      </section>

      {/* A · UPCOMING MEETUPS — Circles' own meetups only. */}
      <section className="hx-wrap cx-section" aria-labelledby="cx-up-title">
        <div className="cx-section-head">
          <div>
            <h2 id="cx-up-title" className="cx-h2">
              Upcoming meetups
            </h2>
            <p className="cx-sub">Meetups Circles have scheduled for the next two weeks.</p>
          </div>
        </div>
        {upcoming.length > 0 ? (
          <div className="cx-panel">
            <ul className="cx-plans">
              {upcoming.map((c) => {
                const p = ownPlan(c)!;
                return (
                  <li key={c.id}>
                    <CxRow
                      image={getCircleCoverUrl(c)}
                      title={c.name}
                      meta={`${dateLabel(p.date)} · ${p.time} · ${[c.area, c.county].filter(Boolean).join(", ")}`}
                      badge={p.spotsLeft > 0 ? `${p.spotsLeft} place${p.spotsLeft === 1 ? "" : "s"} left` : "Full"}
                      hot={p.spotsLeft > 0 && p.spotsLeft <= 3}
                      cta="View meetup"
                      href={`/games/${p.id}`}
                      go={go}
                    />
                  </li>
                );
              })}
            </ul>
          </div>
        ) : (
          <div className="cx-empty cx-empty--soft">
            <strong>No Circle meetups scheduled yet.</strong>
            <p>When a Circle schedules a meetup it shows here with its date, place and spaces. Meanwhile, see what's on near you.</p>
            <a className="hx-btn hx-btn--ghost" href={`/games${county !== "All" ? `?county=${encodeURIComponent(county)}` : ""}`} onClick={go(`/games${county !== "All" ? `?county=${encodeURIComponent(county)}` : ""}`)}>
              See activities nearby <ArrowRight size={16} aria-hidden="true" />
            </a>
          </div>
        )}
      </section>

      {/* B · EXPLORE BY INTEREST — applies the Interest filter. */}
      <section className="hx-wrap cx-section" aria-labelledby="cx-int-title">
        <div className="cx-section-head">
          <div>
            <h2 id="cx-int-title" className="cx-h2">
              Explore by interest
            </h2>
            <p className="cx-sub">Pick one to filter the Circles above.</p>
          </div>
        </div>
        <ul className="cx-tiles cx-tiles--6">
          {interestTiles.map((t) => (
            <li key={t.key}>
              <button
                type="button"
                className="cx-tile cx-tile--wide"
                aria-pressed={interest === t.key}
                onClick={() => {
                  setParam({ interest: t.key });
                  scrollToResults();
                }}
              >
                <span className="hx-img">{t.image ? <img src={getMediaUrl(t.image, "card")} alt="" loading="lazy" /> : <span className="cx-tile-ph" aria-hidden="true">{t.label.charAt(0)}</span>}</span>
                <span className="cx-tile-cap">
                  <span>
                    <strong>{t.label}</strong>
                    <small>{t.count ? `${t.count} Circle${t.count === 1 ? "" : "s"}` : "None yet — start one"}</small>
                  </span>
                  <span className="hx-round hx-round--light" aria-hidden="true">
                    <ArrowRight size={16} />
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      {/* C · CIRCLES NEAR YOU — county level; location only on request. */}
      {countyTiles.length > 0 && (
        <section className="hx-wrap cx-section" aria-labelledby="cx-near-title">
          <div className="cx-section-head">
            <div>
              <h2 id="cx-near-title" className="cx-h2">
                Circles near you
              </h2>
              <p className="cx-sub">Browse by county, or let us find the closest one — we'll ask before using your location.</p>
            </div>
            <button type="button" className="hx-link hx-link--arrow" onClick={handleNearMe} disabled={locating}>
              <LocateFixed size={16} aria-hidden="true" /> {locating ? "Locating…" : nearMe ? "Stop using my location" : "Use my location"}
            </button>
          </div>
          <ul className="cx-places">
            {countyTiles.map((t) => (
              <li key={t.label}>
                <button
                  type="button"
                  className="cx-place"
                  aria-pressed={county === t.label}
                  onClick={() => {
                    setParam({ county: t.label, near: null });
                    scrollToResults();
                  }}
                >
                  <span className="hx-img">
                    <img src={t.image ? getMediaUrl(t.image, "card") : FALLBACK_PLACE} alt="" loading="lazy" />
                  </span>
                  <span className="cx-tile-cap">
                    <span>
                      <strong>{t.label}</strong>
                      <small>
                        {t.count} Circle{t.count === 1 ? "" : "s"} · Browse
                      </small>
                    </span>
                    <span className="hx-round hx-round--light" aria-hidden="true">
                      <ArrowRight size={16} />
                    </span>
                  </span>
                </button>
              </li>
            ))}
            <li>
              <button
                type="button"
                className="cx-place cx-place--all"
                aria-pressed={county === "All"}
                onClick={() => {
                  setParam({ county: null, near: null });
                  scrollToResults();
                }}
              >
                <span className="cx-tile-cap">
                  <span>
                    <strong>All of Ireland</strong>
                    <small>
                      {aggregatesLoaded ? `${allCircles.length} Circle${allCircles.length === 1 ? "" : "s"} · Browse` : "Browse all"}
                    </small>
                  </span>
                  <span className="hx-round" aria-hidden="true">
                    <ArrowRight size={14} />
                  </span>
                </span>
              </button>
            </li>
          </ul>
        </section>
      )}

      {/* D · NEW & GROWING — only states the data supports. */}
      {growing.length > 0 && (
        <section className="hx-wrap cx-section" aria-labelledby="cx-grow-title">
          <div className="cx-section-head">
            <div>
              <h2 id="cx-grow-title" className="cx-h2">
                New &amp; growing Circles
              </h2>
              <p className="cx-sub">Newly started, or with a meetup that still has places.</p>
            </div>
          </div>
          <div className="cx-panel">
            <ul className="cx-plans">
              {growing.map(({ c, isNew: fresh, places }) => (
                <li key={c.id}>
                  <CxRow
                    image={getCircleCoverUrl(c)}
                    title={c.name}
                    meta={places ? `Meetup ${dateLabel(places.date)} · ${places.time} · ${c.members} member${c.members === 1 ? "" : "s"}` : `${c.members} member${c.members === 1 ? "" : "s"} · ${c.activityLabel || "General"} · ${c.county}`}
                    badge={places ? `${places.spotsLeft} place${places.spotsLeft === 1 ? "" : "s"} left` : fresh ? "New" : ""}
                    hot={!!places}
                    href={`/circles/${c.slug ?? c.id}`}
                    go={go}
                  />
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      {/* START YOUR OWN — the shared CtaBand, with the existing interest capture. */}
      <CtaBand
        id="cx-band-title"
        label="Start your own."
        lines={["Can't find", "your", "Circle?"]}
        text="Pick an activity and a place — people nearby who want the same thing can find you. Or tell us what you're into and we'll let you know when a Circle starts."
        action={{ label: "Start a Circle", to: "/circles/start" }}
      >
        <IntentCaptureForm activityLabel={interest ? INTEREST_BY_KEY[interest].label : query || "this"} county={county === "All" ? "" : county} />
      </CtaBand>

      {/* Phone filter sheet. */}
      {sheetOpen && (
        <div className="cx-sheet-backdrop" onClick={() => setSheetOpen(false)}>
          <div ref={sheetRef} className="cx-sheet" role="dialog" aria-modal="true" aria-labelledby="cx-sheet-title" onClick={(e) => e.stopPropagation()}>
            <div className="cx-sheet-head">
              <h2 id="cx-sheet-title" className="cx-h2">
                Filters
              </h2>
              <button type="button" className="hx-icon-btn" aria-label="Close filters" onClick={() => setSheetOpen(false)}>
                <X size={22} aria-hidden="true" />
              </button>
            </div>
            <label className="cx-sheet-l" htmlFor="cx-sheet-where">
              Location
            </label>
            <div className="cx-sheet-row">
              <select id="cx-sheet-where" className="cx-sheet-select" value={county} onChange={(e) => setParam({ county: e.target.value, near: null })}>
                <option value="All">Anywhere in Ireland</option>
                {countyOptions.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              <button type="button" className={`cx-pill${nearMe ? " is-on" : ""}`} aria-pressed={nearMe} onClick={handleNearMe} disabled={locating}>
                <LocateFixed size={15} aria-hidden="true" /> Near me
              </button>
            </div>
            <p className="cx-sheet-l">Interest</p>
            <div className="cx-pills">
              {INTERESTS.map((i) => (
                <button key={i.key} type="button" className={`cx-pill${interest === i.key ? " is-on" : ""}`} aria-pressed={interest === i.key} onClick={() => setInterest(i.key)}>
                  {i.label}
                </button>
              ))}
            </div>
            <p className="cx-sheet-l">Meeting time</p>
            <div className="cx-pills">
              {(Object.keys(WHEN_LABELS) as WhenFilter[]).map((w) => (
                <button key={w} type="button" className={`cx-pill${when === w ? " is-on" : ""}`} aria-pressed={when === w} onClick={() => setParam({ when: w })}>
                  {WHEN_LABELS[w]}
                </button>
              ))}
            </div>
            <p className="cx-sheet-l">Show</p>
            <div className="cx-pills">
              <button type="button" className={`cx-pill${quick.has("active") ? " is-on" : ""}`} aria-pressed={quick.has("active")} onClick={() => toggleQuick("active")}>
                Active this week
              </button>
              <button type="button" className={`cx-pill${quick.has("new") ? " is-on" : ""}`} aria-pressed={quick.has("new")} onClick={() => toggleQuick("new")}>
                New Circles
              </button>
            </div>
            <p className="cx-sheet-l">Sort by</p>
            <div className="cx-pills">
              {(Object.keys(SORT_LABELS) as SortKey[]).map((k) => (
                <button key={k} type="button" className={`cx-pill${sort === k ? " is-on" : ""}`} aria-pressed={sort === k} onClick={() => setParam({ sort: k })}>
                  {SORT_LABELS[k]}
                </button>
              ))}
            </div>
            <div className="cx-sheet-foot">
              <button type="button" className="hx-link" onClick={clearAll}>
                Clear all
              </button>
              <button
                type="button"
                className="hx-btn hx-btn--orange"
                onClick={() => {
                  setSheetOpen(false);
                  scrollToResults();
                }}
              >
                Show {loading || loadFailed ? "" : `${sorted.length}${stillLoading ? "+" : ""} `}Circle{sorted.length === 1 && !loadFailed ? "" : "s"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// A list row: photo thumb, title + meta, a rounded badge and an arrow (or a
// short call to action). A link to the page it describes.
function CxRow({ image, title, meta, badge, hot, cta, href, go }: { image: string | null; title: string; meta: string; badge: string; hot?: boolean; cta?: string; href: string; go: (to: string) => (e: React.MouseEvent) => void }) {
  return (
    <a className="cx-plan" href={href} onClick={go(href)}>
      <span className="hx-img cx-plan-thumb" aria-hidden="true">
        {image ? <img src={getMediaUrl(image, "thumbnail")} alt="" loading="lazy" /> : <span className="cx-tile-ph">{title.charAt(0)}</span>}
      </span>
      <span className="cx-plan-text">
        <strong>{title}</strong>
        <small>{meta}</small>
      </span>
      {badge ? <span className={`cx-badge${hot ? " is-hot" : ""}`}>{badge}</span> : <span />}
      {cta ? (
        <span className="cx-plan-cta">
          {cta} <ArrowRight size={14} aria-hidden="true" />
        </span>
      ) : (
        <ArrowRight size={16} className="cx-plan-arrow" aria-hidden="true" />
      )}
    </a>
  );
}

type Status = "member" | "requested" | "open" | "approval" | "invite";

// One Circle card (grid) or row (list). The title link covers the card; the
// primary action and save sit above it. Actions follow the real join rule.
function CircleItem({ circle, layout, status, busy, signedIn, onJoin, onGo }: { circle: Circle; layout: "grid" | "list"; status: Status; busy: boolean; signedIn: boolean; onJoin: () => void; onGo: (to: string) => void }) {
  const [joinOpen, setJoinOpen] = useState(false);
  const [saved, toggleSave] = useSavedState("circle", circle.id);
  const toast = useToast();
  const cover = getCircleCoverUrl(circle);
  const href = `/circles/${circle.slug ?? circle.id}`;
  const where = Array.from(new Set([circle.area, circle.county].filter(Boolean))).join(", ");
  const plan = ownPlan(circle);
  const statusLabel: Record<Status, string> = { member: "You're a member", requested: "Request sent", open: "Open to join", approval: "Approval needed", invite: "Invite only" };
  const open = () => onGo(href);
  return (
    <article className={`cx-card cx-card--${layout}`}>
      <span className="hx-img cx-card-img">
        {cover ? <img src={getMediaUrl(cover, "card")} alt="" loading="lazy" /> : <span className="cx-tile-ph" aria-hidden="true">{circle.name.charAt(0)}</span>}
        <span className="cx-card-badge">{circle.activityLabel || "Circle"}</span>
      </span>
      <div className="cx-card-body">
        <h3>
          <a
            className="hx-stretch"
            href={href}
            onClick={(e) => {
              e.preventDefault();
              open();
            }}
          >
            {circle.name}
          </a>
        </h3>
        {/* Same shape as the app's shared ListingCard: details → footer (facts left, action right). */}
        {where && (
          <span className="hx-card-meta">
            <MapPin size={14} aria-hidden="true" /> {where}
          </span>
        )}
        {plan && (
          <span className="hx-card-meta cx-card-meet">
            <CalendarDays size={14} aria-hidden="true" /> Next meetup {dateLabel(plan.date)} · {plan.time}
            {plan.spotsLeft > 0 ? ` · ${plan.spotsLeft} place${plan.spotsLeft === 1 ? "" : "s"}` : " · Full"}
          </span>
        )}
        <div className="cx-card-foot2">
        <span className="cx-card-facts">
          <span className="cx-members">
            <Users size={14} aria-hidden="true" /> {circle.members} member{circle.members === 1 ? "" : "s"}
          </span>
          <span className={`cx-mode cx-mode--${status}`}>{statusLabel[status]}</span>
        </span>
        <div className="cx-card-actions">
          {status === "member" || status === "invite" ? (
            <button type="button" className="hx-btn hx-btn--ghost cx-btn-sm" onClick={open}>
              View Circle
            </button>
          ) : status === "requested" ? (
            <button type="button" className="hx-btn hx-btn--ghost cx-btn-sm" disabled aria-disabled="true">
              Request sent
            </button>
          ) : (
            <button type="button" className="hx-btn hx-btn--dark cx-btn-sm" onClick={() => (signedIn ? setJoinOpen(true) : onJoin())} disabled={busy}>
              {busy ? (status === "approval" ? "Sending…" : "Joining…") : status === "approval" ? "Request to join" : "Join Circle"}
            </button>
          )}
        </div>
        </div>
      </div>
      <button
        type="button"
        className={`hx-save hx-save--light${saved ? " is-saved" : ""}`}
        aria-pressed={saved}
        aria-label={saved ? `Remove ${circle.name} from saved` : `Save ${circle.name}`}
        onClick={() => {
          toggleSave();
          if (saved) toast.info("Removed from saved");
          else toast.success(signedIn ? "Saved — find it under Saved in your account menu" : "Saved on this device — sign in to keep it everywhere");
        }}
      >
        <Heart size={18} aria-hidden="true" fill={saved ? "currentColor" : "none"} />
      </button>
      <ConfirmDialog
        open={joinOpen}
        title={circle.joinMode === "approval" ? `Request to join ${circle.name}?` : `Join ${circle.name}?`}
        message={circle.joinMode === "approval" ? "The organiser will need to approve your request before you're a member." : `You'll be part of ${circle.name} and hear about every plan.`}
        confirmLabel={circle.joinMode === "approval" ? "Send request" : "Join Circle"}
        cancelLabel="Not now"
        tone="neutral"
        busy={busy}
        onConfirm={() => {
          onJoin();
          setJoinOpen(false);
        }}
        onCancel={() => setJoinOpen(false)}
      />
    </article>
  );
}
