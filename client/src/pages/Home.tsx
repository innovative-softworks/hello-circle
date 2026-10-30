import { CtaBand } from "../components/CtaBand";
import { experienceHref, experienceKindWord } from "../experienceKind";
import { FeaturedPicks } from "../components/FeaturedPicks";
import { fetchCategories, type PublicCategory } from "../api";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, CalendarCheck, CalendarDays, ChevronLeft, ChevronRight, Compass, Heart, HeartHandshake, Landmark, LocateFixed, MapPin, Search, Sprout, Users, X } from "lucide-react";
import { useOpenBookingOpen } from "../paidCheckout";
import { VENUE_PAGES_PUBLIC } from "../venueLaunch";
import { fetchCircles, fetchDiscover, fetchExperiences, fetchMyBookings, fetchMyCircles, fetchMyGames, fetchNextBestParticipation } from "../api";
import { clearContinuePlanning, readContinuePlanning, type ContinuePlanningDraft } from "../continuePlanning";
import { useGuest } from "../GuestContext";
import { IRISH_COUNTY_COORDS, haversineDistanceKm, nearestCounty } from "../irishCounties";
import { irelandToday } from "../irelandDate";
import { formatDateTime, formatPrice } from "../formatters";
import { getCircleCoverUrl, getMediaUrl } from "../media";
import { useScrollReveal } from "../useScrollReveal";
import { POPULAR_SEARCHES, loadRecent } from "../recentSearches";
import { SaveButton, useSavedState } from "../components/SaveButton";
import { CardArrow, CardAvailability, CardPrice, ListingCard, priceUnitFor } from "../components/ListingCard";
import { bigDay, CardDate, discoverCardLabel } from "../components/CardDate";
import { Button } from "../components/ui";
import { placeholderStripes } from "../theme";
import { useToast } from "../components/Toast";
import type { Circle, DiscoverFeed, DiscoverItem, Experience, Favourite, Game, MyBooking } from "../types";
import "./homeEditorial.css";

// Home — editorial redesign (2026-10-12), plus the homepage UX pass the same
// day (audit P0–P2). The look is unchanged; what changed is behaviour:
// search lives inside the hero (a full-screen sheet on phones), sends real
// county/when filters to Explore (or dated searches to Activities, which
// supports tomorrow/specific dates), remembers itself for the session,
// suggests recent/popular searches, and the activity/Circle blocks put
// joinable things first and say what will happen when you tap.
// Data/routes otherwise as before: ONE real-data discovery block (§03) plus
// up to three Circles; the full listing experience lives on /explore.

// Art-directed photography — Unsplash photo IDs (free licence), each
// downloaded and checked at its actual crop. None of these are presented as
// a specific listing, venue or event.
const unsplash = (id: string, w: number) => `https://images.unsplash.com/photo-${id}?w=${w}&q=72&auto=format&fit=crop`;

const PHOTO = {
  // Rebuild (reference layout): warm, people-first hero.
  heroCamp: { id: "1478131143081-80f7f84ca84d", alt: "Friends gathered around a campfire by a lake at dusk" },
  hero: { id: "1552674605-db6ffd4facb5", alt: "Three runners silhouetted against a low sun on an open road" },
  sports: { id: "1431324155629-1a6deb1dec8d", alt: "A floodlit pitch at night with a game of football under way" },
  experiences: { id: "1528543606781-2f6e6857f318", alt: "A walker crossing a rope bridge through a forest gorge" },
  circles: { id: "1528605248644-14dd04022da1", alt: "Friends talking and laughing around a long shared table" },
  events: { id: "1517457373958-b7bdd4587205", alt: "A crowd gathered under string lights at an evening event" },
  venues: { id: "1523580494863-6f3031224c94", alt: "People seated in a bright hall for a community event" },
  programmes: { id: "1530549387789-4c1017266635", alt: "A swimmer mid-stroke in a pool lane" },
  volunteering: { id: "1559027615-cd4628902d4a", alt: "A volunteer in a bright volunteer T-shirt, seen from behind" },
  together: { id: "1511632765486-a01980e01a18", alt: "Four friends with their arms around each other, looking out at a sunset" },
  hike: { id: "1551632811-561732d1e306", alt: "A group hiking a mountain trail" },
  outside: { id: "1637548076898-f896229b2f3b", alt: "Sea cliffs along the Atlantic coast of Ireland" },
  surf: { id: "1502680390469-be75c86b636f", alt: "A surfer riding inside a breaking wave" },
  host: { id: "1556910103-1c02745aae4d", alt: "A host cooking with guests gathered around a kitchen counter" },
  // Category row (refinement pass) — its own photographs, so it doesn't
  // repeat the collage further down.
  rowSports: { id: "1546519638-68e109498ffc", alt: "A basketball dropping through the hoop under arena lights" },
  rowVenues: { id: "1531058020387-3be344556be6", alt: "A large hall set up for a community gathering" },
  rowExperiences: { id: "1470071459604-3b5ec3a7fe05", alt: "Green hills and valleys under a low sun" },
  rowProgrammes: { id: "1517649763962-0c623066013b", alt: "A pack of club cyclists riding together on a road" },
  rowEvents: { id: "1514525253161-7a46d19cd819", alt: "A crowd with hands raised at a live music event" },
  rowCircles: { id: "1529156069898-49953e39b3ac", alt: "A group of friends sitting arm in arm, seen from behind" },
  rowVolunteering: { id: "1593113598332-cd288d649433", alt: "Volunteers packing boxes of supplies" },
} as const;

type PhotoKey = keyof typeof PHOTO;

function Img({ k, w, eager, sizes }: { k: PhotoKey; w: number; eager?: boolean; sizes?: string }) {
  const p = PHOTO[k];
  const half = Math.round(w / 2);
  return (
    <img
      src={unsplash(p.id, w)}
      srcSet={`${unsplash(p.id, half)} ${half}w, ${unsplash(p.id, w)} ${w}w`}
      sizes={sizes ?? "(max-width: 640px) 100vw, 50vw"}
      alt={p.alt}
      loading={eager ? "eager" : "lazy"}
      decoding="async"
      // React 18 warns on the camelCase prop; the lowercase attribute is valid HTML.
      {...(eager ? { fetchpriority: "high" } : {})}
    />
  );
}

function Arrow({ size = 16 }: { size?: number }) {
  return <ArrowRight size={size} strokeWidth={2} aria-hidden="true" />;
}

function Slash() {
  return (
    <span className="hx-slash" aria-hidden="true">
      /{" "}
    </span>
  );
}

/** "MON 12 OCT" in Ireland's own time zone — the hero's live dateline. */
function irelandDateline(): string {
  try {
    return new Intl.DateTimeFormat("en-IE", { weekday: "short", day: "numeric", month: "short", timeZone: "Europe/Dublin" })
      .format(new Date())
      .replace(/,/g, "")
      .toUpperCase();
  } catch {
    return "";
  }
}

// Activity words for the decorative ticker — kinds of things people do, not
// claims about specific listings.
const TICKER_WORDS = ["Five-a-side", "Sea swimming", "Badminton", "Hill walking", "Pottery", "Park runs", "Kayaking", "Book clubs", "Volunteering", "Yoga", "Cycling", "Board games"];

// Type-ahead vocabulary for the "What" field (activity names, not listings).
// Explore does the actual matching; these only help people phrase a query.
const SUGGEST_WORDS = [...TICKER_WORDS, "Padel", "Tennis", "Running", "Swimming", "Hiking", "Football", "Basketball", "GAA", "Pilates", "Squash", "Art class", "Kids activities", "Walking group", "Choir"];

// Every county on the island (irishCounties.ts) — not only the ones that
// happen to have a venue — so "Where" never hides an area that has games,
// Circles or experiences but no centre yet.
const ALL_COUNTIES = Object.keys(IRISH_COUNTY_COORDS).sort((a, b) => a.localeCompare(b));

type WhenKey = "" | "today" | "tonight" | "tomorrow" | "weekend" | "date";
const WHEN_OPTIONS: { value: WhenKey; label: string }[] = [
  { value: "", label: "Any time" },
  { value: "today", label: "Today" },
  { value: "tonight", label: "Tonight" },
  { value: "tomorrow", label: "Tomorrow" },
  { value: "weekend", label: "This weekend" },
  { value: "date", label: "Pick a date…" },
];

// The hero search remembers itself for the session, so Back from results
// shows what was searched (sessionStorage: this tab only, never a server).
const SEARCH_STATE_KEY = "hello_circle_home_search";
interface SearchState {
  q: string;
  county: string;
  when: WhenKey;
  date: string;
}
function readSearchState(): Partial<SearchState> {
  try {
    const parsed: unknown = JSON.parse(sessionStorage.getItem(SEARCH_STATE_KEY) ?? "{}");
    return parsed && typeof parsed === "object" ? (parsed as Partial<SearchState>) : {};
  } catch {
    return {};
  }
}
function writeSearchState(s: SearchState) {
  try {
    sessionStorage.setItem(SEARCH_STATE_KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable — the search still works, it just won't be remembered */
  }
}

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => (typeof window !== "undefined" && window.matchMedia ? window.matchMedia(query).matches : false));
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setMatches(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [query]);
  return matches;
}

interface Category {
  key: string;
  name: string;
  desc: string;
  photo: PhotoKey;
  to: string;
  soon?: boolean;
}

export function Home() {
  const navigate = useNavigate();
  // Sitemap audit P1-07 — while Make It Happen is switched off, "start
  // something" opens Host an activity instead of a form that can only fail.
  const openBooking = useOpenBookingOpen();
  const startSomethingPath = openBooking === true ? "/make-it-happen" : "/games/host";
  const revealRef = useScrollReveal<HTMLDivElement>(1);
  const { resident } = useGuest();
  const isPhone = useMediaQuery("(max-width: 640px)");

  const stored = useMemo(readSearchState, []);
  const [heroQuery, setHeroQuery] = useState(stored.q ?? "");
  const [homeCounty, setHomeCounty] = useState(stored.county && (stored.county === "All" || ALL_COUNTIES.includes(stored.county)) ? stored.county : "All");
  const [heroWhen, setHeroWhen] = useState<WhenKey>(stored.when && WHEN_OPTIONS.some((o) => o.value === stored.when) ? stored.when : "");
  const [heroDate, setHeroDate] = useState(stored.date ?? "");
  // Set once the visitor picks an area themselves, so a resident's home
  // county never overrides an explicit choice.
  const countyChosen = useRef(!!stored.county);
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [searchHint, setSearchHint] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [activeSuggestion, setActiveSuggestion] = useState(-1);
  const [recent, setRecent] = useState<string[]>([]);

  const [discoverFeed, setDiscoverFeed] = useState<DiscoverFeed | null>(null);
  // Nationwide feed, once — tops the activity row up from nearby counties
  // when the chosen area has too little on (sparse areas otherwise look
  // like "nothing is loading").
  const [nationalFeed, setNationalFeed] = useState<DiscoverFeed | null>(null);
  const [discoverFailed, setDiscoverFailed] = useState(false);
  const [nextBest, setNextBest] = useState<DiscoverItem[]>([]);
  const [circlesNearby, setCirclesNearby] = useState<Circle[] | null>(null);
  const [myCircles, setMyCircles] = useState<Circle[]>([]);
  const [myGames, setMyGames] = useState<Game[]>([]);
  const [myBookings, setMyBookings] = useState<MyBooking[]>([]);
  const [continuePlan, setContinuePlan] = useState<ContinuePlanningDraft | null>(null);
  // §05's centre tile: one real experience (featured first, with a photo).
  const [featuredExp, setFeaturedExp] = useState<Experience | null>(null);

  const heroRef = useRef<HTMLElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const pillRef = useRef<HTMLButtonElement>(null);
  const qRef = useRef<HTMLInputElement>(null);
  const whereRef = useRef<HTMLSelectElement>(null);
  const dateRef = useRef<HTMLInputElement>(null);
  const cardsRef = useRef<HTMLUListElement>(null);
  const listboxId = useId();

  useEffect(() => {
    writeSearchState({ q: heroQuery, county: countyChosen.current ? homeCounty : "", when: heroWhen, date: heroDate });
  }, [heroQuery, homeCounty, heroWhen, heroDate]);

  // A signed-in resident's home county is the sensible default area.
  useEffect(() => {
    if (!countyChosen.current && resident?.homeCounty && ALL_COUNTIES.includes(resident.homeCounty)) setHomeCounty(resident.homeCounty);
  }, [resident]);

  const chooseCounty = (c: string) => {
    countyChosen.current = true;
    setHomeCounty(c);
    setSearchHint(null);
  };

  const loadDiscover = useCallback(() => {
    setDiscoverFeed(null);
    setDiscoverFailed(false);
    fetchDiscover(homeCounty === "All" ? undefined : homeCounty)
      .then(setDiscoverFeed)
      .catch(() => {
        // A failed load is an error state, never "nothing on" (HC-QA-063).
        setDiscoverFailed(true);
        setDiscoverFeed({ today: [], weekend: [] });
      });
  }, [homeCounty]);

  useEffect(() => {
    loadDiscover();
  }, [homeCounty, loadDiscover]);

  useEffect(() => {
    fetchDiscover()
      .then(setNationalFeed)
      .catch(() => setNationalFeed({ today: [], weekend: [] }));
  }, []);

  // All active Circles, once — the strip below picks local ones first and
  // tops up from the nearest other counties, so it is never empty just
  // because the chosen area has none (the dev data has one per county).
  useEffect(() => {
    fetchCircles()
      .then((rows) => setCirclesNearby(rows.filter((c) => c.status === "active")))
      .catch(() => setCirclesNearby([]));
  }, []);

  // Signed-in resident only: personalised matches, Your Circles, next plan.
  useEffect(() => {
    if (!resident) {
      setNextBest([]);
      setMyCircles([]);
      setMyGames([]);
      setMyBookings([]);
      return;
    }
    fetchNextBestParticipation().then(setNextBest).catch(() => setNextBest([]));
    fetchMyCircles().then(setMyCircles).catch(() => setMyCircles([]));
    fetchMyGames().then(setMyGames).catch(() => setMyGames([]));
    fetchMyBookings().then(setMyBookings).catch(() => setMyBookings([]));
  }, [resident]);

  useEffect(() => {
    // Adventures first: this tile sits under "Get outside".
    Promise.all([fetchExperiences("adventure").catch(() => []), fetchExperiences("experience").catch(() => [])]).then(([a, b]) => {
      const withPhoto = [...a, ...b].filter((e) => !!e.imageUrl);
      setFeaturedExp(withPhoto.find((e) => e.featured) ?? withPhoto[0] ?? null);
    });
  }, []);

  // Continue Planning — a saved in-progress Make It Happen draft; re-read on
  // focus since the user usually left this tab to finish that flow.
  useEffect(() => {
    setContinuePlan(readContinuePlanning());
    const onFocus = () => setContinuePlan(readContinuePlanning());
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  // Phone search sheet: focus in on open, back to the pill on close, lock
  // page scroll, Esc closes, Tab stays inside. Keyed on open/close only —
  // the suggestion list's state is read through a ref so toggling it never
  // re-runs this (which would bounce focus back to the pill).
  const suggestOpenRef = useRef(false);
  suggestOpenRef.current = suggestOpen;
  useEffect(() => {
    if (!sheetOpen || !isPhone) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const t = window.setTimeout(() => qRef.current?.focus(), 30);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !suggestOpenRef.current) setSheetOpen(false);
      if (e.key !== "Tab" || !shellRef.current) return;
      const f = Array.from(shellRef.current.querySelectorAll<HTMLElement>("button, input, select, a[href]")).filter((el) => !el.hasAttribute("disabled") && el.offsetParent !== null);
      if (f.length === 0) return;
      if (e.shiftKey && document.activeElement === f[0]) {
        e.preventDefault();
        f[f.length - 1].focus();
      } else if (!e.shiftKey && document.activeElement === f[f.length - 1]) {
        e.preventDefault();
        f[0].focus();
      }
    };
    document.addEventListener("keydown", onKey);
    const pill = pillRef.current;
    return () => {
      window.clearTimeout(t);
      document.body.style.overflow = prevOverflow;
      document.removeEventListener("keydown", onKey);
      pill?.focus();
    };
  }, [sheetOpen, isPhone]);

  useEffect(() => {
    if (!isPhone) setSheetOpen(false);
  }, [isPhone]);

  // Soonest upcoming commitment across the two sources with a clean date/time.
  const nextPlan = useMemo(() => {
    const today = irelandToday();
    const game = myGames.filter((g) => g.status !== "cancelled" && g.date >= today).sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time))[0];
    const booking = myBookings.filter((b) => b.status !== "cancelled" && b.date >= today).sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time))[0];
    if (game && (!booking || `${game.date} ${game.time}` <= `${booking.date} ${booking.time}`)) {
      return { title: game.activityLabel, when: formatDateTime(game.date, game.time), where: game.centreName ?? game.locationText ?? "", to: `/games/${game.id}` };
    }
    if (booking) return { title: booking.centreName, when: formatDateTime(booking.date, booking.time), where: booking.roomName ?? "", to: "/bookings" };
    return null;
  }, [myGames, myBookings]);

  // §03's single discovery block: a resident's ranked matches when there
  // are any, otherwise today + this weekend. Joinable items first (places
  // left, or no cap); full ones only fill in after them. Server order (its
  // ranking) is kept within each group for matches; feed items by soonest.
  const personalised = !!resident && nextBest.length > 0;
  const { happening, localHappening } = useMemo(() => {
    const seen = new Set<string>();
    const usable = (items: DiscoverItem[]) =>
      items
        // While venue pages are gated a club/centre link only reaches
        // /coming-soon, so those items stay off Home until they launch.
        .filter((i) => VENUE_PAGES_PUBLIC || !/^\/(clubs|centres)\//.test(i.href))
        .filter((i) => (seen.has(`${i.kind}-${i.id}`) ? false : (seen.add(`${i.kind}-${i.id}`), true)));
    const soonest = (a: DiscoverItem, b: DiscoverItem) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`);
    const openFirst = (items: DiscoverItem[], sort: boolean) => {
      const open = items.filter((i) => i.spotsLeft !== 0);
      const full = items.filter((i) => i.spotsLeft === 0);
      if (sort) {
        open.sort(soonest);
        full.sort(soonest);
      }
      return [...open, ...full];
    };
    const local = openFirst(usable(personalised ? nextBest : [...(discoverFeed?.today ?? []), ...(discoverFeed?.weekend ?? [])]), !personalised);
    if (personalised || homeCounty === "All" || local.length >= 3 || !nationalFeed) return { happening: local.slice(0, 6), localHappening: local.length };
    // Top up from the nearest other counties (distance between county centres).
    const here = IRISH_COUNTY_COORDS[homeCounty];
    const dist = (i: DiscoverItem) => {
      const there = i.county ? IRISH_COUNTY_COORDS[i.county] : undefined;
      return here && there ? haversineDistanceKm(here.lat, here.lng, there.lat, there.lng) : Number.POSITIVE_INFINITY;
    };
    const nearby = usable([...nationalFeed.today, ...nationalFeed.weekend].filter((i) => i.county !== homeCounty))
      .filter((i) => i.spotsLeft !== 0)
      .sort((a, b) => dist(a) - dist(b) || soonest(a, b));
    return { happening: [...local, ...nearby].slice(0, 6), localHappening: local.length };
  }, [personalised, nextBest, discoverFeed, nationalFeed, homeCounty]);
  const toppedUp = happening.length > localHappening;
  const happeningLoaded = discoverFeed !== null;

  const myCircleIds = useMemo(() => new Set(myCircles.map((c) => c.id)), [myCircles]);
  // Circles strip: yours first, then ones in the chosen area, then the
  // nearest elsewhere (distance between county centres), three at most.
  const allCircles = circlesNearby ?? [];
  const localCircles = homeCounty === "All" ? allCircles : allCircles.filter((c) => c.county === homeCounty);
  const elsewhereCircles = useMemo(() => {
    if (homeCounty === "All") return [];
    const here = IRISH_COUNTY_COORDS[homeCounty];
    const dist = (c: Circle) => {
      const there = IRISH_COUNTY_COORDS[c.county];
      return here && there ? haversineDistanceKm(here.lat, here.lng, there.lat, there.lng) : Number.POSITIVE_INFINITY;
    };
    return allCircles.filter((c) => c.county !== homeCounty).sort((a, b) => dist(a) - dist(b));
  }, [allCircles, homeCounty]);
  const showMyCircles = !!resident && myCircles.length > 0;
  const circles = useMemo(() => {
    const seen = new Set<string>();
    return [...(showMyCircles ? myCircles : []), ...localCircles, ...elsewhereCircles].filter((c) => (seen.has(c.id) ? false : (seen.add(c.id), true))).slice(0, 3);
  }, [showMyCircles, myCircles, localCircles, elsewhereCircles]);
  const circlesLoading = circlesNearby === null && !showMyCircles;
  const circlesHeading = (() => {
    const mineShown = circles.filter((c) => myCircleIds.has(c.id)).length;
    if (mineShown > 0) return mineShown === circles.length ? "Your Circles" : "Your Circles & more to join";
    if (homeCounty === "All") return `Circles to join (${allCircles.length})`;
    if (localCircles.length >= circles.length) return `Circles in ${homeCounty} (${localCircles.length})`;
    if (localCircles.length > 0) return `Circles in ${homeCounty} & nearby`;
    return `No Circles in ${homeCounty} yet — here are the nearest`;
  })();

  const countyQs = homeCounty !== "All" ? `county=${encodeURIComponent(homeCounty)}` : "";
  const cat = {
    // Activities and Explore accept the area in the link, so a category
    // keeps the visitor's chosen county.
    sports: { key: "sports", name: "Sports & games", desc: "Join people already playing, or post a game of your own.", photo: "sports", to: `/games${countyQs ? `?${countyQs}` : ""}` },
    experiences: { key: "experiences", name: "Experiences & adventures", desc: "Hikes, workshops, water and one-off outings.", photo: "experiences", to: "/experiences" },
    circles: { key: "circles", name: "Circles", desc: "Recurring groups around a shared activity.", photo: "circles", to: "/circles" },
    events: { key: "events", name: "Events", desc: "What's on this weekend.", photo: "events", to: `/explore?when=weekend${countyQs ? `&${countyQs}` : ""}` },
  } satisfies Record<string, Category>;
  const indexCats: Category[] = [
    { key: "programmes", name: "Clubs & programmes", desc: "Courses, series and seasons.", photo: "programmes", to: "/programs" },
    // While venue pages are gated the route lands on /coming-soon (the
    // launch waitlist) — the row says so rather than pretending it's open.
    { key: "venues", name: "Venues & spaces", desc: VENUE_PAGES_PUBLIC ? "Halls, pitches and rooms to hire." : "Launching soon — join the waitlist.", photo: "venues", to: VENUE_PAGES_PUBLIC ? "/browse/centres" : "/coming-soon", soon: !VENUE_PAGES_PUBLIC },
    { key: "volunteering", name: "Volunteering", desc: "Clean-ups, gardens and local causes.", photo: "volunteering", to: "/volunteer" },
  ];

  // The seven ways in, as one photo row under the hero (refinement pass).
  const categoryRow: Category[] = [
    { ...cat.sports, desc: "Games near you", photo: "rowSports" },
    { key: "venues", name: "Venues & spaces", desc: VENUE_PAGES_PUBLIC ? "Halls, pitches and rooms" : "Launching soon", photo: "rowVenues", to: VENUE_PAGES_PUBLIC ? "/browse/centres" : "/coming-soon", soon: !VENUE_PAGES_PUBLIC },
    { ...cat.experiences, desc: "Days out and workshops", photo: "rowExperiences" },
    { key: "programmes", name: "Clubs & programmes", desc: "Courses and seasons", photo: "rowProgrammes", to: "/programs" },
    { ...cat.events, desc: "On this weekend", photo: "rowEvents" },
    { ...cat.circles, desc: "Groups that meet regularly", photo: "rowCircles" },
    { key: "volunteering", name: "Volunteering", desc: "Local causes", photo: "rowVolunteering", to: "/volunteer" },
  ];
  const go = (to: string) => (e: React.MouseEvent) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    navigate(to);
  };

  // Suggestions for the "What" field: recent + popular when empty, then
  // anything containing what's typed. Purely client-side phrasing help.
  const suggestions = useMemo(() => {
    const typed = heroQuery.trim().toLowerCase();
    if (!typed) {
      const r = recent.slice(0, 4).map((label) => ({ label, group: "Recent" }));
      const p = POPULAR_SEARCHES.filter((x) => !recent.includes(x)).map((label) => ({ label, group: "Popular" }));
      return [...r, ...p].slice(0, 7);
    }
    const pool = Array.from(new Set([...recent, ...POPULAR_SEARCHES, ...SUGGEST_WORDS]));
    return pool
      .filter((x) => x.toLowerCase().includes(typed) && x.toLowerCase() !== typed)
      .slice(0, 6)
      .map((label) => ({ label, group: recent.includes(label) ? "Recent" : "Suggestions" }));
  }, [heroQuery, recent]);
  const listOpen = suggestOpen && suggestions.length > 0;

  const runSearch = (override?: string) => {
    const q = (override ?? heroQuery).trim();
    if (heroWhen === "date" && !heroDate) {
      setSearchHint("Pick a date, or choose another day.");
      dateRef.current?.focus();
      return;
    }
    if (!q && homeCounty === "All" && !heroWhen) {
      setSearchHint("Type an activity, or choose an area or a day.");
      qRef.current?.focus();
      return;
    }
    setSearchHint(null);
    setSuggestOpen(false);
    setSheetOpen(false);
    // Saved now, not in the effect: navigating unmounts Home before it runs.
    writeSearchState({ q, county: countyChosen.current ? homeCounty : "", when: heroWhen, date: heroDate });
    const params = new URLSearchParams();
    if (heroWhen === "tomorrow" || heroWhen === "date") {
      // Explore's date filter covers today/tonight/weekend only; Activities
      // supports tomorrow and a specific date, so dated searches go there.
      if (q) params.set("activity", q);
      if (homeCounty !== "All") params.set("county", homeCounty);
      params.set("when", heroWhen);
      if (heroWhen === "date") params.set("whenDate", heroDate);
      navigate(`/games?${params.toString()}`);
      return;
    }
    if (q) params.set("q", q);
    if (homeCounty !== "All") params.set("county", homeCounty);
    if (heroWhen) params.set("when", heroWhen);
    navigate(`/explore?${params.toString()}`);
  };

  const pickSuggestion = (label: string) => {
    setHeroQuery(label);
    runSearch(label);
  };

  const onQueryKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSuggestOpen(true);
      setActiveSuggestion((i) => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveSuggestion((i) => Math.max(i - 1, -1));
    } else if (e.key === "Enter" && listOpen && activeSuggestion >= 0) {
      e.preventDefault();
      pickSuggestion(suggestions[activeSuggestion].label);
    } else if (e.key === "Escape" && listOpen) {
      e.preventDefault();
      e.stopPropagation();
      setSuggestOpen(false);
      setActiveSuggestion(-1);
    }
  };

  // Permission is only requested on explicit click. Resolved client-side
  // against county centroids — the coordinate is never sent anywhere.
  const handleUseMyLocation = () => {
    setLocationError(null);
    if (!navigator.geolocation) return setLocationError("Location isn't available in this browser — choose your county instead.");
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const match = nearestCounty(pos.coords.latitude, pos.coords.longitude, ALL_COUNTIES);
        if (match) chooseCounty(match);
        else setLocationError("Couldn't match your location to a county — choose one instead.");
        setLocating(false);
      },
      (err) => {
        setLocationError(err.code === err.PERMISSION_DENIED ? "Location permission is off — choose your county instead." : "Couldn't get your location — choose your county instead.");
        setLocating(false);
        whereRef.current?.focus();
      },
      { timeout: 8000 }
    );
  };

  // "Change area" from the activity block: jump to Where (the sheet on phones).
  const editArea = () => {
    if (isPhone) {
      setSheetOpen(true);
      window.setTimeout(() => whereRef.current?.focus(), 60);
      return;
    }
    heroRef.current?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
    window.setTimeout(() => whereRef.current?.focus({ preventScroll: true }), 400);
  };

  const nowHour = new Date().getHours();
  const greeting = nowHour < 12 ? "Good morning" : nowHour < 18 ? "Good afternoon" : "Good evening";
  const dateline = irelandDateline();
  const areaLabel = homeCounty === "All" ? "Anywhere in Ireland" : homeCounty;
  const whenLabel = heroWhen === "date" && heroDate ? new Date(`${heroDate}T12:00:00`).toLocaleDateString("en-IE", { weekday: "short", day: "numeric", month: "short" }) : WHEN_OPTIONS.find((o) => o.value === heroWhen)?.label ?? "Any time";
  const sheetMode = isPhone && sheetOpen;
  const scrollCards = (dir: 1 | -1) => {
    const el = cardsRef.current;
    if (!el) return;
    const card = el.querySelector("li");
    el.scrollBy({ left: dir * ((card?.getBoundingClientRect().width ?? 300) + 16), behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  };
  const featuredHref = featuredExp ? experienceHref(featuredExp.kind, featuredExp.slug ?? featuredExp.id) : "/experiences";

  return (
    <div ref={revealRef} className="hx">
      {/* 01 — Hero: photo, headline top-left, search + category shortcuts
          inside the lower part of the photo. data-no-reveal: the LCP image,
          h1 and search paint immediately. */}
      <section ref={heroRef} className="hx-hero" aria-labelledby="hx-hero-title" data-no-reveal>
        <div className="hx-hero-photo">
          <Img k="heroCamp" w={2200} eager sizes="100vw" />
        </div>
        <div className="hx-wrap hx-hero-inner">
          <div className="hx-hero-head">
            <div className="hx-hero-copy">
              <span className="hx-label hx-hero-kicker">
                <Slash />
                Ireland
              </span>
              <h1 id="hx-hero-title" className="hx-display hx-hero-title">
                <span className="hx-o">More</span>{" "}
                <span>people.</span>{" "}
                <span className="hx-o">Out there.</span>
              </h1>
              <p className="hx-hero-lede">
                {resident ? <strong>{greeting}, {resident.name.split(" ")[0]}. </strong> : null}
                Local activities, clubs, venues and experiences across Ireland — all in one place.
              </p>
            </div>
            <div className="hx-hero-aside hx-label" aria-hidden="true">
              {dateline && <span className="hx-hero-date">{dateline} \ Ireland</span>}
              <span>Places</span>
              <span>People</span>
              <span>Experiences</span>
            </div>
          </div>

          <div className="hx-hero-search">
            {/* Phones: one big entry point that opens the full-screen search. */}
            <button
              ref={pillRef}
              type="button"
              className="hx-search-pill"
              aria-haspopup="dialog"
              aria-expanded={sheetOpen}
              onClick={() => {
                setRecent(loadRecent());
                setSheetOpen(true);
              }}
            >
              <Search size={20} aria-hidden="true" />
              <span className="hx-search-pill-text">
                <strong>{heroQuery.trim() || "What would you like to do?"}</strong>
                <span>
                  {areaLabel} · {whenLabel}
                </span>
              </span>
            </button>

            <div
              ref={shellRef}
              className={`hx-search-shell${sheetMode ? " is-open" : ""}`}
              role={sheetMode ? "dialog" : undefined}
              aria-modal={sheetMode ? true : undefined}
              aria-label={sheetMode ? "Search" : undefined}
            >
              <div className="hx-sheet-head">
                <span className="hx-label">
                  <Slash />
                  Search
                </span>
                <button type="button" className="hx-icon-btn" onClick={() => setSheetOpen(false)} aria-label="Close search">
                  <X size={22} aria-hidden="true" />
                </button>
              </div>

              <form
                className={`hx-search${heroWhen === "date" ? " has-date" : ""}`}
                role="search"
                aria-label="Find something to do"
                noValidate
                onSubmit={(e) => {
                  e.preventDefault();
                  runSearch();
                }}
              >
                <div className="hx-field hx-field--what">
                  <label htmlFor="hx-q">What</label>
                  <Search size={18} className="hx-field-icon" aria-hidden="true" />
                  <input
                    ref={qRef}
                    id="hx-q"
                    value={heroQuery}
                    onChange={(e) => {
                      setHeroQuery(e.target.value);
                      setSuggestOpen(true);
                      setActiveSuggestion(-1);
                      setSearchHint(null);
                    }}
                    onFocus={() => {
                      setRecent(loadRecent());
                      setSuggestOpen(true);
                    }}
                    onBlur={() => window.setTimeout(() => setSuggestOpen(false), 120)}
                    onKeyDown={onQueryKeyDown}
                    placeholder="What would you like to do?"
                    autoComplete="off"
                    enterKeyHint="search"
                    role="combobox"
                    aria-autocomplete="list"
                    aria-expanded={listOpen}
                    aria-controls={listboxId}
                    aria-activedescendant={listOpen && activeSuggestion >= 0 ? `${listboxId}-${activeSuggestion}` : undefined}
                  />
                  {heroQuery && (
                    <button
                      type="button"
                      className="hx-clear"
                      aria-label="Clear what"
                      onClick={() => {
                        setHeroQuery("");
                        qRef.current?.focus();
                      }}
                    >
                      <X size={16} aria-hidden="true" />
                    </button>
                  )}
                  <ul id={listboxId} role="listbox" aria-label="Search suggestions" className="hx-suggest-list" hidden={!listOpen}>
                    {suggestions.map((s, i) => (
                      <li
                        key={`${s.group}-${s.label}`}
                        id={`${listboxId}-${i}`}
                        role="option"
                        aria-selected={i === activeSuggestion}
                        className={i === activeSuggestion ? "is-active" : undefined}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => pickSuggestion(s.label)}
                      >
                        <span>{s.label}</span>
                        <small>{s.group}</small>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="hx-field hx-field--where">
                  <label htmlFor="hx-where">Where?</label>
                  <MapPin size={18} className="hx-field-icon" aria-hidden="true" />
                  <select ref={whereRef} id="hx-where" value={homeCounty} onChange={(e) => chooseCounty(e.target.value)}>
                    <option value="All">Anywhere in Ireland</option>
                    {ALL_COUNTIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                  {homeCounty !== "All" ? (
                    <button type="button" className="hx-clear" aria-label="Clear where" onClick={() => chooseCounty("All")}>
                      <X size={16} aria-hidden="true" />
                    </button>
                  ) : (
                    <button type="button" className="hx-clear hx-locate" onClick={handleUseMyLocation} disabled={locating} aria-label="Use my current location" title="Near me">
                      <LocateFixed size={18} aria-hidden="true" />
                    </button>
                  )}
                </div>
                <div className="hx-field hx-field--when">
                  <label htmlFor="hx-when">When?</label>
                  <CalendarDays size={18} className="hx-field-icon" aria-hidden="true" />
                  <select
                    id="hx-when"
                    value={heroWhen}
                    onChange={(e) => {
                      const v = e.target.value as WhenKey;
                      setHeroWhen(v);
                      setSearchHint(null);
                      if (v === "date") window.setTimeout(() => dateRef.current?.focus(), 30);
                    }}
                  >
                    {WHEN_OPTIONS.map((o) => (
                      <option key={o.value || "any"} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                  {heroWhen && (
                    <button
                      type="button"
                      className="hx-clear"
                      aria-label="Clear when"
                      onClick={() => {
                        setHeroWhen("");
                        setHeroDate("");
                      }}
                    >
                      <X size={16} aria-hidden="true" />
                    </button>
                  )}
                </div>
                {heroWhen === "date" && (
                  <div className="hx-field hx-field--date">
                    <label htmlFor="hx-date">Date</label>
                    <input ref={dateRef} id="hx-date" type="date" min={irelandToday()} value={heroDate} onChange={(e) => (setHeroDate(e.target.value), setSearchHint(null))} />
                  </div>
                )}
                <button type="submit" className="hx-btn hx-btn--orange hx-search-go">
                  Search <Arrow />
                </button>
              </form>

              <div aria-live="polite" className="hx-search-msgs">
                {locating && <div className="hx-search-note">Finding your county…</div>}
                {locationError && <div className="hx-search-note hx-search-note--error">{locationError}</div>}
                {searchHint && (
                  <div className="hx-search-note hx-search-note--error">
                    {searchHint}{" "}
                    <button type="button" className="hx-link hx-link--inline" onClick={() => navigate("/explore")}>
                      Or browse everything
                    </button>
                  </div>
                )}
              </div>

              {/* In the phone sheet: quick ideas. On the photo the category
                  shortcuts below do this job instead. */}
              <div className="hx-suggest">
                <span className="hx-label">Try</span>
                {["Badminton tonight", "Five-a-side", "Weekend hike", "Sea swim", "Coffee & social"].map((label) => (
                  <button key={label} type="button" className="hx-link" onClick={() => pickSuggestion(label)}>
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <ul className="hx-chips" aria-label="Browse by category">
              {categoryRow.map((c) => (
                <li key={c.key}>
                  <a className="hx-chip" href={c.to} onClick={go(c.to)}>
                    {c.name}
                    {c.soon && <span className="hx-sr"> (coming soon)</span>}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* 02 — What we do: statement + one link, then the seven ways in. */}
      <section className="hx-intro" aria-labelledby="hx-intro-title">
        <div className="hx-wrap">
          <div className="hx-intro-grid">
            <div>
              <span className="hx-label">
                <Slash />
                What we do
              </span>
              <h2 id="hx-intro-title" className="hx-statement">
                <span className="hx-statement-line">find your people,</span>{" "}
                <span className="hx-statement-line">
                  find your <span className="hx-o">place.</span>
                </span>
              </h2>
            </div>
            <div className="hx-intro-side">
              <p className="hx-intro-copy">From local sports and adventures to clubs, venues and community events — there's something happening around you.</p>
              <a className="hx-link hx-link--arrow" href="/help-guide" onClick={go("/help-guide")}>
                Explore how it works <ArrowRight size={16} aria-hidden="true" />
              </a>
            </div>
          </div>

          <ul className="hx-catcards" aria-label="Ways to take part">
            {categoryRow.map((c) => (
              <li key={c.key}>
                <a className="hx-catcard" href={c.to} onClick={go(c.to)}>
                  <span className="hx-img">
                    <Img k={c.photo} w={500} sizes="(max-width: 640px) 46vw, 14vw" />
                  </span>
                  <span className="hx-catcard-body">
                    <span className="hx-catcard-name">
                      {c.name}
                      {c.soon && <span className="hx-sr"> (coming soon)</span>}
                    </span>
                    <span className="hx-round" aria-hidden="true">
                      <ArrowRight size={14} />
                    </span>
                    <span className="hx-catcard-desc">{c.desc}</span>
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <PopularCategories go={go} />

      {/* 03 — Different ways to belong: big sports tile under the headline,
          experiences + circles + events on the right, then three link rows. */}
      <section className="hx-belongways" aria-labelledby="hx-ways-title">
        <div className="hx-wrap">
          <div className="hx-ways-grid">
            <div className="hx-ways-head">
              <span className="hx-label">
                <Slash />
                Discover
              </span>
              <h2 id="hx-ways-title" className="hx-display hx-ways-title">
                <span>Different ways</span> <span>to belong.</span>
              </h2>
            </div>
            <PhotoTile className="hx-tile--sports" photo="sports" title="Sports & games" desc="Play, train and stay active together." to={cat.sports.to} go={go} size="lg" />
            <PhotoTile className="hx-tile--exp" photo="experiences" title="Experiences & adventures" desc="From coastal trips to mountain hikes." to={cat.experiences.to} go={go} size="md" />
            <PhotoTile className="hx-tile--circles" photo="circles" title="Circles" desc="Meet people with shared interests." to={cat.circles.to} go={go} size="sm" />
            <PhotoTile className="hx-tile--events" photo="events" title="Events" desc="Local events, from gigs to community." to={cat.events.to} go={go} size="sm" />
          </div>

          <ul className="hx-waylinks">
            {[
              { key: "programmes", icon: <Users size={26} aria-hidden="true" />, title: "Clubs & programmes", link: "Join local clubs and programmes", to: "/programs", photo: "programmes" as PhotoKey },
              { key: "venues", icon: <Landmark size={26} aria-hidden="true" />, title: VENUE_PAGES_PUBLIC ? "Venues & spaces" : "Venues & spaces · soon", link: VENUE_PAGES_PUBLIC ? "Find and book venues" : "Join the launch waitlist", to: VENUE_PAGES_PUBLIC ? "/browse/centres" : "/coming-soon", photo: "venues" as PhotoKey },
              { key: "volunteering", icon: <HeartHandshake size={26} aria-hidden="true" />, title: "Volunteering", link: "Make a difference", to: "/volunteer", photo: "volunteering" as PhotoKey },
            ].map((r) => (
              <li key={r.key}>
                <a className="hx-wayrow" href={r.to} onClick={go(r.to)}>
                  <span className="hx-wayrow-icon">{r.icon}</span>
                  <span className="hx-wayrow-title">{r.title}</span>
                  <span className="hx-wayrow-link">
                    {r.link} <ArrowRight size={15} aria-hidden="true" />
                  </span>
                  <span className="hx-wayrow-thumb hx-img" aria-hidden="true">
                    <Img k={r.photo} w={200} sizes="64px" />
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* 04 — Happening near you: real activities only (server data). */}
      <section className="hx-near" aria-labelledby="hx-near-title">
        <div className="hx-wrap hx-near-grid">
          <div className="hx-near-head">
            <span className="hx-label">
              <Slash />
              {personalised ? "Matched for you" : "Happening near you"}
            </span>
            <h2 id="hx-near-title" className="hx-display hx-near-title">
              <span>Go out.</span> <span>Do more.</span> <span className="hx-o">Together.</span>
            </h2>
            <p className="hx-near-area">
              {personalised
                ? "Ranked from what's on, your routines and your Circles."
                : toppedUp
                  ? localHappening > 0
                    ? "Today and this weekend, here and nearby."
                    : "Nothing on here yet — this is what's on nearby."
                  : "Today and this weekend."}{" "}
              <span className="hx-area">
                <span className="hx-area-name">{areaLabel}</span>
                <button type="button" className="hx-link hx-link--light" onClick={editArea}>
                  Change area
                </button>
              </span>
            </p>
            <a className="hx-btn hx-btn--outline-light" href={`/explore${countyQs ? `?${countyQs}` : ""}`} onClick={go(`/explore${countyQs ? `?${countyQs}` : ""}`)}>
              View all activities <ArrowRight size={16} aria-hidden="true" />
            </a>
            {(nextPlan && resident) || continuePlan ? (
              <div className="hx-plan">
                {resident && nextPlan && (
                  <div className="hx-plan-row">
                    <span>
                      <span className="hx-label">Your next plan</span>
                      <strong>{nextPlan.title}</strong> · {nextPlan.when}
                    </span>
                    <button type="button" className="hx-link hx-link--light" onClick={() => navigate(nextPlan.to)}>
                      View details
                    </button>
                  </div>
                )}
                {continuePlan && (
                  <div className="hx-plan-row">
                    <span>
                      <span className="hx-label">Continue planning</span>
                      <strong>{continuePlan.activityLabel || "Your activity"}</strong>
                    </span>
                    <span style={{ display: "inline-flex", gap: 16 }}>
                      <button
                        type="button"
                        className="hx-link hx-link--light"
                        style={{ fontWeight: 500 }}
                        onClick={() => {
                          clearContinuePlanning();
                          setContinuePlan(null);
                        }}
                      >
                        Dismiss
                      </button>
                      <button type="button" className="hx-link hx-link--light" onClick={() => navigate("/make-it-happen")}>
                        Continue
                      </button>
                    </span>
                  </div>
                )}
              </div>
            ) : null}
          </div>

          <div className="hx-near-cards">
            {happening.length > 1 && (
              <div className="hx-near-nav">
                <button type="button" className="hx-round hx-round--btn" onClick={() => scrollCards(-1)} aria-label="Previous activities">
                  <ChevronLeft size={18} aria-hidden="true" />
                </button>
                <button type="button" className="hx-round hx-round--btn" onClick={() => scrollCards(1)} aria-label="Next activities">
                  <ChevronRight size={18} aria-hidden="true" />
                </button>
              </div>
            )}
            <div aria-live="polite" aria-busy={!happeningLoaded && !personalised}>
              {!happeningLoaded && !personalised ? (
                <ul className="hx-cards" aria-label="Loading activities">
                  {[0, 1, 2].map((i) => (
                    <li key={i} className="hx-card hx-card--skeleton">
                      <span className="hx-skel hx-skel--block" />
                      <span className="hx-card-body">
                        <span className="hx-skel hx-skel--title" />
                        <span className="hx-skel" />
                        <span className="hx-skel hx-skel--short" />
                      </span>
                    </li>
                  ))}
                </ul>
              ) : discoverFailed && !personalised ? (
                <div className="hx-near-empty">
                  <strong>Couldn't load what's on.</strong>
                  <p>Check your connection and try again — nothing you've done is lost.</p>
                  <button type="button" className="hx-btn hx-btn--orange" onClick={loadDiscover}>
                    Try again
                  </button>
                </div>
              ) : happening.length === 0 ? (
                <div className="hx-near-empty">
                  <strong>Quiet around here. For now.</strong>
                  <p>Nothing's scheduled {homeCounty === "All" ? "today or this weekend" : `in ${homeCounty} today or this weekend`} yet. Someone has to go first.</p>
                  <div className="hx-inline-links">
                    <button type="button" className="hx-btn hx-btn--orange" onClick={() => navigate(startSomethingPath)}>
                      Start something
                    </button>
                    {homeCounty !== "All" && (
                      <button type="button" className="hx-link hx-link--light" onClick={() => chooseCounty("All")}>
                        Show all of Ireland
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                <ul ref={cardsRef} className="hx-cards lc-grid--b" aria-label="Activities" data-no-reveal>
                  {/* data-no-reveal: the rail clips its overflow, so cards sliding up
                      into view would sit cut off until the animation ends. */}
                  {happening.map((item) => (
                    <li key={`${item.kind}-${item.id}`}>
                      <ActivityCard item={item} onGo={navigate} />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* 05 — Community: statement + CTA, framed photo with BELONG. over its
          foot, three links; then real Circles with their join rules. */}
      <section className="hx-community" aria-labelledby="hx-community-title">
        <div className="hx-wrap">
          <div className="hx-community-grid">
            <div className="hx-community-head">
              <span className="hx-label">
                <Slash />
                Community
              </span>
              <h2 id="hx-community-title" className="hx-community-title">
                <span>Good people.</span> <span>Great places.</span> <span>Real connections.</span>
              </h2>
              <a className="hx-btn hx-btn--orange" href="/circles" onClick={go("/circles")}>
                Explore Circles <ArrowRight size={16} aria-hidden="true" />
              </a>
            </div>
            <figure className="hx-community-photo">
              <span className="hx-tab" aria-hidden="true" />
              <div className="hx-img">
                <Img k="together" w={1200} sizes="(max-width: 640px) 90vw, 34vw" />
              </div>
            </figure>
            <p className="hx-display hx-belong-word" aria-hidden="true">
              Belong.
            </p>
            <ul className="hx-community-links">
              {[
                { label: "Discover new activities", to: `/explore${countyQs ? `?${countyQs}` : ""}`, icon: <Compass size={20} aria-hidden="true" /> },
                { label: "Join communities", to: `/explore?cat=circles${countyQs ? `&${countyQs}` : ""}`, icon: <Landmark size={20} aria-hidden="true" /> },
                { label: "Meet people with shared interests", to: `/explore?mood=social${homeCounty !== "All" ? `&moodCounty=${encodeURIComponent(homeCounty)}` : ""}`, icon: <HeartHandshake size={20} aria-hidden="true" /> },
              ].map((l) => (
                <li key={l.label}>
                  <a href={l.to} onClick={go(l.to)}>
                    {l.icon}
                    <span>{l.label}</span>
                  </a>
                </li>
              ))}
            </ul>
          </div>

          <div className="hx-circles-strip">
            <div className="hx-circles-strip-head">
              <span className="hx-label">
                <Slash />
                {circlesHeading}
              </span>
              <p className="hx-explainer">
                <strong>A Circle</strong> meets regularly — you join once and keep showing up. <strong>Activities</strong> are one-off sessions; <strong>venues</strong> are spaces you hire.
              </p>
            </div>
            {circlesLoading ? (
              <ul className="hx-circle-list" aria-busy="true" aria-label="Loading Circles">
                {[0, 1, 2].map((i) => (
                  <li key={i} className="hx-circle hx-circle--skeleton">
                    <span className="hx-skel hx-skel--avatar" />
                    <span>
                      <span className="hx-skel hx-skel--title" />
                      <span className="hx-skel hx-skel--short" />
                    </span>
                  </li>
                ))}
              </ul>
            ) : circles.length > 0 ? (
              <ul className="hx-circle-list">
                {circles.map((c) => {
                  const cover = getCircleCoverUrl(c);
                  const member = myCircleIds.has(c.id);
                  const status = member ? "You're a member" : c.joinMode === "approval" ? "Approval needed" : c.joinMode === "invite" ? "Invite only" : "Open to join";
                  // The Circle page runs the real join flow (sign-in with
                  // return, approval questions, confirmation) — Home only
                  // says which one you'll get.
                  const action = member || c.joinMode === "invite" ? "View Circle" : c.joinMode === "approval" ? "Request to join" : "Join Circle";
                  return (
                    <li key={c.id}>
                      <button type="button" className="hx-circle" onClick={() => navigate(`/circles/${c.slug ?? c.id}`)}>
                        <span className="hx-img" aria-hidden="true">
                          {cover ? <img src={getMediaUrl(cover, "thumbnail")} alt="" loading="lazy" /> : <span className="hx-circle-ph">{c.name.charAt(0)}</span>}
                        </span>
                        <span>
                          <strong>{c.name}</strong>
                          <small>{[Array.from(new Set([c.area, c.county].filter(Boolean))).join(", "), `${c.members} member${c.members === 1 ? "" : "s"}`].filter(Boolean).join(" · ")}</small>
                          <small className={`hx-circle-status${member ? " is-member" : ""}`}>{status}</small>
                        </span>
                        <span className="hx-circle-act">
                          {action} <Arrow size={16} />
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="hx-explainer">
                No Circles {homeCounty === "All" ? "yet" : `in ${homeCounty} yet`} —{" "}
                <a className="hx-link hx-link--inline" href="/circles/start" onClick={go("/circles/start")}>
                  start the first one
                </a>
                .
              </p>
            )}
          </div>
        </div>
      </section>

      {/* 06 — Get outside: three photo cards with caption boxes; the centre
          one is a real experience when there is one. */}
      <section className="hx-outside" aria-labelledby="hx-outside-title">
        <div className="hx-wrap">
          <div className="hx-outside-head">
            <div>
              <span className="hx-label">
                <Slash />
                Ireland experiences
              </span>
              <h2 id="hx-outside-title" className="hx-display hx-outside-title">
                <span>Get outside.</span> <span className="hx-o">Make it happen.</span>
              </h2>
            </div>
            <div className="hx-intro-side">
              <p className="hx-intro-copy">From coastal walks to mountain hikes, find experiences that get you out and about.</p>
              <a className="hx-link hx-link--arrow" href="/experiences" onClick={go("/experiences")}>
                Explore experiences <ArrowRight size={16} aria-hidden="true" />
              </a>
            </div>
          </div>
          <ul className="hx-outside-cards">
            <li>
              <a className="hx-ocard" href="/adventures" onClick={go("/adventures")}>
                <span className="hx-img">
                  <Img k="hike" w={900} sizes="(max-width: 640px) 80vw, 31vw" />
                </span>
                <span className="hx-ocard-cap">
                  <span className="hx-ocard-k">Adventures</span>
                  <strong>Mountain adventures</strong>
                  <small>Hikes, views and fresh air.</small>
                  <span className="hx-round" aria-hidden="true">
                    <ArrowRight size={14} />
                  </span>
                </span>
              </a>
            </li>
            <li>
              <a className="hx-ocard" href={featuredHref} onClick={go(featuredHref)}>
                <span className="hx-img">{featuredExp ? <img src={getMediaUrl(featuredExp.imageUrl, "card")} alt="" loading="lazy" decoding="async" /> : <Img k="outside" w={900} sizes="(max-width: 640px) 80vw, 31vw" />}</span>
                <span className="hx-ocard-cap">
                  <span className="hx-ocard-k">{featuredExp ? `Featured ${experienceKindWord(featuredExp.kind).toLowerCase()}` : "Experiences"}</span>
                  <strong>{featuredExp ? featuredExp.title : "Coastal experiences"}</strong>
                  <small>
                    {featuredExp
                      ? [featuredExp.sessions[0] ? `Next ${bigDay(featuredExp.sessions[0].date)}` : null, Array.from(new Set([featuredExp.area, featuredExp.county].filter(Boolean))).join(", ")].filter(Boolean).join(" · ")
                      : "Cliff walks and sea views."}
                  </small>
                  <span className="hx-round" aria-hidden="true">
                    <ArrowRight size={14} />
                  </span>
                </span>
              </a>
            </li>
            <li>
              <a className="hx-ocard" href="/explore?q=kayaking" onClick={go("/explore?q=kayaking")}>
                <span className="hx-img">
                  <Img k="surf" w={900} sizes="(max-width: 640px) 80vw, 31vw" />
                </span>
                <span className="hx-ocard-cap">
                  <span className="hx-ocard-k">On the water</span>
                  <strong>Water activities</strong>
                  <small>Surfing, kayaking and more.</small>
                  <span className="hx-round" aria-hidden="true">
                    <ArrowRight size={14} />
                  </span>
                </span>
              </a>
            </li>
          </ul>
        </div>
      </section>

      {/* Featured sections, one per type, in the "Get outside" pattern
          (owner 2026-10-27). Each hides itself without three real picks. */}
      <div className="hx-wrap">
        <FeaturedPicks kind="circles" />
        <FeaturedPicks kind="experiences" />
        <FeaturedPicks kind="programmes" />
      </div>

      {/* 07 — Hosts & venues. No fee, payout or subscription wording. */}
      <section className="hx-host" aria-labelledby="hx-host-title">
        <div className="hx-wrap hx-host-grid">
          <div className="hx-host-head">
            <span className="hx-label">
              <Slash />
              For hosts &amp; venues
            </span>
            <h2 id="hx-host-title" className="hx-display hx-host-title">
              <span>Create.</span> <span className="hx-o">Host.</span> <span>Connect.</span>
            </h2>
            <p>Have a space, an activity or an idea? Bring people together with HelloCircle.</p>
            <div className="hx-inline-links">
              <a className="hx-btn hx-btn--orange" href="/vendor/signup" onClick={go("/vendor/signup")}>
                List your venue <ArrowRight size={16} aria-hidden="true" />
              </a>
              <a className="hx-btn hx-btn--ghost" href="/become-a-host" onClick={go("/become-a-host")}>
                Become a host <ArrowRight size={16} aria-hidden="true" />
              </a>
            </div>
            {!VENUE_PAGES_PUBLIC && <p className="hx-host-note">Venue pages open soon — list your space now and it goes live at launch.</p>}
          </div>
          <figure className="hx-host-photo">
            <div className="hx-img">
              <Img k="host" w={1100} sizes="(max-width: 640px) 90vw, 34vw" />
            </div>
          </figure>
          <ul className="hx-benefits">
            {[
              { label: "Reach local people", icon: <Users size={20} aria-hidden="true" /> },
              { label: "Manage your availability", icon: <CalendarCheck size={20} aria-hidden="true" /> },
              { label: "Grow your community", icon: <Sprout size={20} aria-hidden="true" /> },
              { label: "Do what you love", icon: <Heart size={20} aria-hidden="true" /> },
            ].map((b) => (
              <li key={b.label}>
                {b.icon}
                <span>{b.label}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* 08 — Closing band; the global footer follows. The shared editorial
          CtaBand (discovery variant), same as every other page. */}
      <CtaBand
        id="hx-close-title"
        label="Together."
        lines={["Let's make", "things", "happen."]}
        text="A community of people, places and possibilities across Ireland."
        action={
          resident
            ? nextPlan
              ? { label: "See your plans", to: "/bookings" }
              : { label: "Find something to do", to: "/explore" }
            : { label: "Join HelloCircle", to: "/signin/create" }
        }
        secondary={resident && !nextPlan ? undefined : { label: "Explore what's on", to: "/explore" }}
      />
    </div>
  );
}

// A photo tile whose whole area is one link; title, line and arrow sit on a
// dark gradient at the foot of the photo.
function PhotoTile({ className, photo, title, desc, to, go, size }: { className: string; photo: PhotoKey; title: string; desc: string; to: string; go: (to: string) => (e: React.MouseEvent) => void; size: "lg" | "md" | "sm" }) {
  return (
    <a className={`hx-tile hx-tile--${size} ${className}`} href={to} onClick={go(to)}>
      <span className="hx-img">
        <Img k={photo} w={size === "lg" ? 1600 : size === "md" ? 1100 : 700} sizes={size === "lg" ? "(max-width: 640px) 100vw, 56vw" : "(max-width: 640px) 50vw, 20vw"} />
      </span>
      <span className="hx-tile-cap">
        <span>
          <strong>{title}</strong>
          <small>{desc}</small>
        </span>
        <span className="hx-round hx-round--light" aria-hidden="true">
          <ArrowRight size={16} />
        </span>
      </span>
    </a>
  );
}

// Real fields only: no invented ratings, counts or availability. Places
// left / joined are games-only on DiscoverItem, so they show only when set.
function itemFacts(item: DiscoverItem) {
  // Seeded rows often repeat area and county ("Kilkenny, Kilkenny") — show each place once.
  const where = Array.from(
    new Set(
      [item.centreName ?? item.clubName, item.area, item.county]
        .filter(Boolean)
        .flatMap((part) => String(part).split(",").map((t) => t.trim()))
        .filter(Boolean)
    )
  ).join(", ");
  const full = item.spotsLeft === 0;
  // Availability is information, not the action: games have a waitlist when full.
  const places = item.spotsLeft === null ? null : full ? (item.kind === "game" ? "Full · waitlist open" : "Full") : `${item.spotsLeft} place${item.spotsLeft === 1 ? "" : "s"} left`;
  // The detail page owns joining/booking, the waitlist and the paid-checkout
  // gate, so every card offers the same next step.
  const action = "View details";
  return { where, when: item.isLive ? "Happening now" : formatDateTime(item.date, item.time), price: formatPrice(item.priceCents), places, full, action };
}

// What a save stores. The favourites API accepts games and program/club
// sessions by their own id; a session of an experience is saved as its
// parent experience. Anything else has no save button rather than one that
// fails (the server would refuse it).
type FavouriteTarget = { kind: Favourite["listingType"]; id: string };
function favouriteTarget(item: DiscoverItem): FavouriteTarget | null {
  if (item.kind === "game" || item.kind === "program_session" || item.kind === "club_session") return { kind: item.kind, id: item.id };
  if (item.listingType === "experience" && item.listingId) return { kind: "experience", id: item.listingId };
  return null;
}

// Save toggle for the card photo, reusing the shared saved-state hook
// (server-synced when signed in, this browser otherwise). Items with no
// favourite target get no button rather than one the server would refuse;
// the hook still runs unconditionally (hooks can't be conditional).
function useCardSave(item: DiscoverItem) {
  const target = favouriteTarget(item);
  const [saved, toggle] = useSavedState(target?.kind ?? "game", target?.id ?? item.id);
  const toast = useToast();
  const { resident } = useGuest();
  if (!target) return null;
  return (
    <SaveButton
      saved={saved}
      onToggle={() => {
        toggle();
        if (saved) toast.info("Removed from saved");
        else toast.success(resident ? "Saved — find it under Saved in your account menu" : "Saved on this device — sign in to keep it everywhere");
      }}
    />
  );
}

// Kind label for the card's photo tag — from server fields only.
function kindLabel(item: DiscoverItem): string {
  const k = item.kind as string;
  if (k === "game") return "Activity";
  if (k === "program_session") return "Programme";
  if (k === "club_session") return "Club";
  if (item.listingType === "experience") return item.experienceKind === "adventure" || item.experienceKind === "event" ? experienceKindWord(item.experienceKind) : "Experience";
  return "Activity";
}

// Activity card in the shared ListingCard style (design-system consistency
// pass). Real fields only — "going" exists for games alone, so it shows only
// when the server sends it.
function ActivityCard({ item, onGo }: { item: DiscoverItem; onGo: (to: string) => void }) {
  const f = itemFacts(item);
  const save = useCardSave(item);
  // The shared photo card (CardGrid look, owner 2026-10-27): big date and its
  // label on the photo, the category above the title, one muted line.
  return (
    <ListingCard
      href={item.href}
      title={item.title}
      image={item.imageUrl}
      ph={placeholderStripes.green}
      fallbackKind={kindLabel(item)}
      fallbackLine={f.when}
      tag={kindLabel(item)}
      status={f.places ? { label: f.places, tone: f.full ? "calm" : "hot" } : null}
      dateOn={<CardDate date={item.date} time={item.time} label={discoverCardLabel(item)} href={item.href} onGo={onGo} />}
      save={save}
      details={[
        { text: [f.where, item.joined ? `${item.joined} going` : null].filter(Boolean).join(" · ") },
        { icon: <CalendarDays size={13} aria-hidden="true" />, text: f.when, kind: "date" },
      ]}
      facts={
        <>
          <CardPrice cents={item.priceCents} unit={priceUnitFor(item.kind)} />
          {item.spotsLeft !== null && item.spotsLeft !== undefined && <CardAvailability spotsLeft={item.spotsLeft} />}
        </>
      }
      action={<CardArrow label={`${f.action}: ${item.title}`} onClick={() => onGo(item.href)} />}
    />
  );
}

/** Category system — "Popular right now": activity categories with live
 * activities only (never an empty category), most listings first. Hidden
 * when nothing qualifies. */
function PopularCategories({ go }: { go: (to: string) => (e: React.MouseEvent) => void }) {
  const [cats, setCats] = useState<PublicCategory[]>([]);
  useEffect(() => {
    fetchCategories("activity")
      .then((c) => setCats([...c].sort((a, b) => b.count - a.count).slice(0, 8)))
      .catch(() => setCats([]));
  }, []);
  if (cats.length === 0) return null;
  return (
    <section className="hx-popular" aria-labelledby="hx-popular-title" style={{ padding: "8px 0 40px" }}>
      <div className="hx-wrap">
        <h2 id="hx-popular-title" style={{ fontSize: 15, fontWeight: 700, margin: "0 0 12px" }}>
          Popular right now
        </h2>
        <ul className="chips-scroll-mobile" style={{ display: "flex", flexWrap: "wrap", gap: 8, listStyle: "none", margin: 0, padding: 0 }}>
          {cats.map((c) => {
            const to = `/games?category=${c.slug}`;
            return (
              <li key={c.id}>
                <a className="hc-related-chip" href={to} onClick={go(to)}>
                  {c.name}
                  <span style={{ marginLeft: 6, opacity: 0.6, fontWeight: 500 }}>{c.count}</span>
                </a>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
