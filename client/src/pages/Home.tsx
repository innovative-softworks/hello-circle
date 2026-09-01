import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import {
  fetchCentres,
  fetchCircles,
  fetchClubs,
  fetchDiscover,
  fetchExperiences,
  fetchGames,
  fetchLocalMomentum,
  fetchMyBookings,
  fetchMyCircles,
  fetchMyGames,
  fetchNextBestParticipation,
  fetchRoutineSuggestions,
  joinGame,
  leaveGame,
} from "../api";
import { CentreCard } from "../components/CentreCard";
import { ClubCard } from "../components/ClubCard";
import { DiscoverCard, DiscoverRow } from "../components/DiscoverRow";
import { GameCard } from "./Games";
import { HeroScrollSplit, type HeroScrollImage } from "../components/HeroScrollSplit";
import { SectionHeader } from "../components/SectionHeader";
import { CardSkeleton } from "../components/ui";
import {
  ArrowRightIcon,
  BuildingIcon,
  ChevronRightIcon,
  ClockIcon,
  HandshakeIcon,
  PinIcon,
  SearchIcon,
  TrendUpIcon,
} from "../components/icons";
// Home's mood tiles are the one place in the app that reaches for an
// external icon library instead of components/icons.tsx's hand-rolled set
// — see icons.tsx's own note on why.
import { Bike, BookOpen, Compass, Dumbbell, PartyPopper, Users } from "lucide-react";
import { clearContinuePlanning, readContinuePlanning, type ContinuePlanningDraft } from "../continuePlanning";
import { useGuest } from "../GuestContext";
import { haversineDistanceKm, nearestCounty } from "../irishCounties";
import { colors, fonts, maxWidth, radius } from "../theme";
import type { Centre, Circle, Club, DiscoverFeed, DiscoverItem, Experience, Game, LocalMomentumSignal, MyBooking, RoutineSuggestion } from "../types";

// Home's intent selector (IA spec §3) — reuses discover.ts's existing mood
// keyword filter (built for Free Time Mode) rather than a new taxonomy.
// Six tiles: Play / Move / Meet / Explore / Learn / Surprise me — "Play"
// and "Move" split what used to be one combined "Get active" bucket
// (server/src/routes/discover.ts's MOOD_KEYWORDS "active" vs new "move"),
// and "Meet people" was renamed to plain "Meet" so it doesn't read as a
// dating/friend-finding app. "Explore" navigates straight to the Explore
// page since that IS the destination for "not sure, just browsing"
// (no mood value — browsing everything isn't a keyword filter); "Surprise
// me" calls the same endpoint with no mood filter and highlights whatever
// comes back. Clicking any tile still runs a real, filtered discovery
// query (via /explore?mood=…, see Explore.tsx) — not a static category
// page — it just does that on the Explore page now rather than inline,
// per an earlier decision this session to stop duplicating a second
// smaller results UI on Home itself.
const INTENT_CHIPS: { key: string; label: string; mood?: string; description: string; icon: ReactNode }[] = [
  { key: "play", label: "Play", mood: "active", description: "Sports, games and matches", icon: <Dumbbell size={26} strokeWidth={1.75} /> },
  { key: "move", label: "Move", mood: "move", description: "Running, cycling, fitness", icon: <Bike size={26} strokeWidth={1.75} /> },
  { key: "meet", label: "Meet", mood: "social", description: "Coffee, chats and new faces", icon: <Users size={26} strokeWidth={1.75} /> },
  { key: "explore", label: "Explore", description: "Hiking, adventure, outdoors", icon: <Compass size={26} strokeWidth={1.75} /> },
  { key: "learn", label: "Learn", mood: "learn", description: "Workshops and new skills", icon: <BookOpen size={26} strokeWidth={1.75} /> },
  { key: "surprise", label: "Surprise me", description: "We'll pick for you", icon: <PartyPopper size={26} strokeWidth={1.75} /> },
];

// Dedicated hero imagery — deliberately NOT sourced from listing photos
// (centres/clubs have their own cards further down the page for that).
// Each image fills the full-width hero band on its own (see
// HeroScrollSplit.tsx), so the band's own aspect ratio (very wide, short —
// clamp(220px,32vw,420px) tall at full viewport width) is what actually
// matters for picking one, not the photo's original crop: every candidate
// here was re-checked by fetching it at that same wide aspect
// (w=1200&h=320&fit=crop&crop=entropy) and looking at the result, not just
// the original square/portrait thumbnail — several earlier picks (a
// football match, a hiking-trail shot) looked fine as thumbnails but
// cropped straight through everyone's faces/heads at this ratio and were
// swapped out. Real photos from Unsplash (free to use, no API key needed
// for direct CDN URLs; Unsplash's old keyword-search "Source" endpoint is
// dead, so these are specific photo IDs) — avoided anything with a visible
// brand/logo (shoe/ball close-ups, gym equipment brands).
const HERO_IMAGES: HeroScrollImage[] = [
  // Genuinely wide/vista shots (added per request for "panoramic" imagery in
  // the hero) rather than this band's earlier all-social/activity-close-up
  // mix — checked the same way as every entry below (downloaded and viewed
  // at the actual w=1200&h=320&crop=entropy hero ratio before adding, not
  // just the source thumbnail). A third candidate (an aerial soccer
  // stadium) was rejected: visible team/sponsor branding, and a US stadium
  // isn't Ireland-relevant for this app.
  { src: "https://images.unsplash.com/photo-1637548076898-f896229b2f3b?w=1600&q=75&auto=format&fit=crop", alt: "Cliffs along the Irish coast" },
  { src: "https://images.unsplash.com/photo-1633894812833-3961145496a3?w=1600&q=75&auto=format&fit=crop", alt: "An aerial view of people gathered in a park" },
  { src: "https://images.unsplash.com/photo-1517649763962-0c623066013b?w=1600&q=75&auto=format&fit=crop", alt: "A group cycling together" },
  { src: "https://images.unsplash.com/photo-1571019613914-85f342c6a11e?w=1600&q=75&auto=format&fit=crop", alt: "Weight training at the gym" },
  { src: "https://images.unsplash.com/photo-1543269865-cbf427effbad?w=1600&q=75&auto=format&fit=crop", alt: "Friends meeting up over coffee" },
  { src: "https://images.unsplash.com/photo-1500534623283-312aade485b7?w=1600&q=75&auto=format&fit=crop", alt: "A mountain sunrise" },
  // Restored per request — the plain center-crop cut the hikers down to
  // just legs and lost the mountains; `focus` biases the browser's own
  // object-fit:cover crop toward the point that keeps both the hikers'
  // full figures and the peak in frame (checked directly against Unsplash's
  // own focalpoint crop preview before picking this value).
  { src: "https://images.unsplash.com/photo-1551632811-561732d1e306?w=1600&q=75&auto=format&fit=crop", alt: "A group hiking a mountain trail", focus: "50% 40%" },
  { src: "https://images.unsplash.com/photo-1526232761682-d26e03ac148e?w=1600&q=75&auto=format&fit=crop", alt: "A kids' local football club" },
  { src: "https://images.unsplash.com/photo-1554068865-24cecd4e34b8?w=1600&q=75&auto=format&fit=crop", alt: "A tennis match on a clay court" },
  { src: "https://images.unsplash.com/photo-1544367567-0f2fcb009e0b?w=1600&q=75&auto=format&fit=crop", alt: "Evening yoga by the sea" },
  { src: "https://images.unsplash.com/photo-1600965962102-9d260a71890d?w=1600&q=75&auto=format&fit=crop", alt: "Swimming laps" },
];

// --- Swiss/minimal redesign shell -------------------------------------------
// A small, page-scoped design system so the ~15 sections below don't each
// hand-pick their own radius/border/shadow. No new colors — same colors.*
// tokens (CSS-var-backed, so dark mode keeps resolving correctly) — just a
// stricter, near-monochrome application of them: hairline borders instead
// of soft shadows, sharp-to-near-sharp corners instead of pills/large
// rounding, and a full-bleed-background + inner-maxWidth-wrapper technique
// (the one reusable idea from client/src/landing/'s otherwise much more
// decorative styling) so sections can carry a true edge-to-edge hairline
// rule and background instead of everything being boxed into one central
// column. Shared components (GameCard/CentreCard/ClubCard/DiscoverCard)
// keep their own existing look — they're used elsewhere in the app — only
// the page composition around them changes.
// Values now centrally tracked as radius.swiss.* in theme.ts (post-audit
// hardening pass) — kept as page-local names since ~15 call sites below
// already reference them; only the source of truth moved.
const SWISS_RADIUS = radius.swiss.control;
const SWISS_CARD_RADIUS = radius.swiss.card;
// A rounder radius specifically for the mood tiles below — a dedicated
// constant rather than bumping SWISS_CARD_RADIUS itself, which is also
// used by several sharp-cornered banners/rows elsewhere on this page.
const MOOD_TILE_RADIUS = radius.swiss.moodTile;

// Same poster-brand accent as /for-venues (ForVenues/constants.ts's
// FV_ACCENT) — reused by literal value rather than importing across page
// boundaries, since this is a page-scoped editorial accent, not a themed
// UI color that belongs in theme.ts's colors.* set (see that file's own
// note on why it's a raw hex, not a CSS-var token).
const ACCENT = "#FF4A1F";

// The "/ Label" eyebrow motif, shared by every SectionHeader on this page
// (SectionHeader's `eyebrow` prop now accepts a ReactNode for exactly this).
function accentEyebrow(label: string): ReactNode {
  return (
    <>
      <span style={{ color: ACCENT }} aria-hidden="true">
        /
      </span>{" "}
      {label}
    </>
  );
}

function fullBleedStyle(background: string, borderTop = true): React.CSSProperties {
  return { background, borderTop: borderTop ? `1px solid ${colors.border}` : "none" };
}

const innerWrapStyle: React.CSSProperties = { maxWidth, margin: "0 auto", padding: "40px 24px" };

const chipStyle = (active: boolean, activeColor: string = colors.dark): React.CSSProperties => ({
  border: `1px solid ${active ? activeColor : colors.border}`,
  background: active ? activeColor : colors.surface,
  color: active ? "#fff" : colors.muted,
  borderRadius: SWISS_RADIUS,
  padding: "7px 14px",
  fontSize: 13,
  fontWeight: 700,
  cursor: "pointer",
});

const bannerStyle = (accent: string): React.CSSProperties => ({
  display: "flex",
  flexWrap: "wrap",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 20,
  background: colors.surface,
  border: `1px solid ${colors.borderStrong}`,
  borderLeft: `3px solid ${accent}`,
  borderRadius: SWISS_CARD_RADIUS,
  padding: "22px 26px",
});

const ctaButtonStyle = (bg: string): React.CSSProperties => ({
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  background: bg,
  color: "#fff",
  border: "none",
  borderRadius: SWISS_RADIUS,
  padding: "12px 18px",
  fontSize: 14,
  fontWeight: 700,
  cursor: "pointer",
  whiteSpace: "nowrap",
});

// Image-forward preview card ("Popular Destinations" reference layout) —
// used only for Home's Adventures/Experiences/Circles previews, which want
// a softer, more editorial-travel look than the rest of this page's sharp
// Swiss corners/hairline borders. A big photo carries the section; a title
// + one caption line underneath is all the chrome it needs.
function DestinationCard({ image, title, caption, onClick }: { image: string | null; title: string; caption: string; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{ textAlign: "left", background: "none", border: "none", cursor: "pointer", padding: 0, display: "flex", flexDirection: "column", gap: 10 }}>
      <div
        style={{
          height: 170,
          borderRadius: 14,
          overflow: "hidden",
          background: image ? `url(${image}) center/cover` : colors.panel,
        }}
      />
      <div>
        <div style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 15.5, color: colors.text }}>{title}</div>
        <div style={{ fontSize: 13, color: colors.mutedLight, marginTop: 2 }}>{caption}</div>
      </div>
    </button>
  );
}

export function Home() {
  const navigate = useNavigate();
  const { resident } = useGuest();
  const [homeCounty, setHomeCounty] = useState("All");
  const [continuePlan, setContinuePlan] = useState<ContinuePlanningDraft | null>(null);
  const [myCircles, setMyCircles] = useState<Circle[]>([]);
  // Circles nearby (borrowed from client/src/landing/'s "Circles nearby"
  // concept, but with real data — fetchCircles() is the same public browse
  // endpoint Circles.tsx already uses, not new backend work). Shown as
  // part of the "Find your circle" section for anyone without a Circle of
  // their own yet, guest or resident.
  const [circlesNearby, setCirclesNearby] = useState<Circle[]>([]);
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [featuredCentres, setFeaturedCentres] = useState<Centre[]>([]);
  const [loadingCentres, setLoadingCentres] = useState(true);
  const [featuredClubs, setFeaturedClubs] = useState<Club[]>([]);
  const [loadingClubs, setLoadingClubs] = useState(true);
  const [counties, setCounties] = useState<string[]>(["All"]);

  // "Try something different" (§11) — a real preview of a few Adventures/
  // Experiences rather than a content-free pair of nav tiles. Nationwide
  // (not county-scoped) since both listing types are sparse enough that a
  // narrow county filter would often come back empty.
  const [previewAdventures, setPreviewAdventures] = useState<Experience[]>([]);
  const [previewExperiences, setPreviewExperiences] = useState<Experience[]>([]);

  // Full (unsliced) county-scoped lists, captured alongside the 3-card
  // "featured" slices below — reused for the Near You distance sort so it
  // has a wider pool to choose from without a dedicated fetch.
  const [allCentres, setAllCentres] = useState<Centre[]>([]);
  const [allClubs, setAllClubs] = useState<Club[]>([]);

  // "Happening today" / "This weekend" (Phase 5) — games + program sessions
  // + recurring club sessions in one feed, see routes/discover.ts.
  const [discoverFeed, setDiscoverFeed] = useState<DiscoverFeed | null>(null);

  // "They just need a few more people" (landing/homepage repositioning,
  // phase 2) — plain GET /api/games already returns joined/spotsLeft/
  // minParticipants per game, so this is a client-side filter over the
  // existing endpoint, not a new query. Kept as its own fetch (rather than
  // reusing discoverFeed) since discoverFeed is date-bucketed (today/
  // weekend only) and this needs the full open-games pool to find the ones
  // closest to full — also reused below to derive each Circle's real next
  // activity, rather than fetching that separately.
  const [openGames, setOpenGames] = useState<Game[]>([]);
  const [joiningGameId, setJoiningGameId] = useState<string | null>(null);

  // Local Momentum (Phase 7) — "picking up near you," the positive-growth
  // counterpart to Trending. Empty in a fresh/quiet county, not an error —
  // it just means nothing's grown enough to say yet, so the strip hides.
  const [momentum, setMomentum] = useState<LocalMomentumSignal[]>([]);

  // "Next Best Participation" (implementation backlog #4) — proactive,
  // signed-in-resident-only (a guest gets nothing extra over the plain
  // Discover feed, since the two signals that make this distinct — Routines
  // and Circle membership — both require an identity).
  const [nextBest, setNextBest] = useState<DiscoverItem[]>([]);

  // "Your Next Plan" (landing/homepage repositioning, phase 3) — only two
  // of the five participation tables expose a clean date/time on their
  // client-facing type (Game, MyBooking); registrations/program
  // enrollments/circle membership don't carry a specific upcoming-session
  // date on their current shapes (see CLAUDE.md's "five separate tables"
  // note), so this is deliberately scoped to those two rather than
  // fabricating dates for the others.
  const [myGames, setMyGames] = useState<Game[]>([]);
  const [myBookings, setMyBookings] = useState<MyBooking[]>([]);

  // "Do It Again" (landing/homepage repositioning, phase 3) — reuses the
  // existing Routines-as-an-object suggestion query (3+ sessions of the
  // same activity on the same weekday in the last 8 weeks); matched below
  // against openGames (already fetched for the People Needed section) for
  // a real upcoming occurrence, rather than inventing one.
  const [routineSuggestions, setRoutineSuggestions] = useState<RoutineSuggestion[]>([]);

  // Set only once real coordinates are resolved via handleUseMyLocation —
  // drives the Near You section, which otherwise stays hidden (no
  // server-side geocoding to fall back on, see CLAUDE.md).
  const [userCoords, setUserCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [radiusKm, setRadiusKm] = useState(10);

  // Hero search input — just a query box that hands off to /explore's
  // Results Mode on submit (Explore.tsx — Search.tsx was merged into it),
  // rather than reimplementing a second, smaller results experience inline.
  // That page already does live debounced search plus recent/popular
  // suggestions, grouped results (activities/adventures & experiences/
  // centres/clubs), an empty-state with intent capture, and a "notify me"
  // search alert — duplicating a slice of that in the hero was strictly worse.
  const [heroQuery, setHeroQuery] = useState("");
  // Backend-recognized time-of-day word (searchParser.ts's TIME_WORDS) —
  // folded into the query text on submit, not a separate API param, since
  // /api/search only ever takes one free-text `q`.
  const [heroWhen, setHeroWhen] = useState("");

  // County dropdown always reflects the full unfiltered set (same pattern as
  // Browse.tsx) so picking a county doesn't shrink the dropdown down to it.
  useEffect(() => {
    fetchCentres().then((centres) => {
      setCounties(["All", ...Array.from(new Set(centres.map((c) => c.county).filter(Boolean))).sort((a, b) => a.localeCompare(b))]);
    });
  }, []);

  useEffect(() => {
    fetchExperiences("adventure").then((rows) => setPreviewAdventures(rows.slice(0, 3))).catch(() => setPreviewAdventures([]));
    fetchExperiences("experience").then((rows) => setPreviewExperiences(rows.slice(0, 3))).catch(() => setPreviewExperiences([]));
  }, []);

  // Featured centres/clubs follow whichever county is picked in the search bar —
  // not real popularity data, so the heading says "Explore"/"in {county}", never "Popular".
  useEffect(() => {
    setLoadingCentres(true);
    fetchCentres(homeCounty).then((centres) => {
      setAllCentres(centres);
      setFeaturedCentres(centres.slice(0, 4));
      setLoadingCentres(false);
    });
    setLoadingClubs(true);
    fetchClubs(homeCounty).then((clubs) => {
      setAllClubs(clubs);
      setFeaturedClubs(clubs.slice(0, 4));
      setLoadingClubs(false);
    });
  }, [homeCounty]);

  useEffect(() => {
    fetchDiscover(homeCounty === "All" ? undefined : homeCounty)
      .then(setDiscoverFeed)
      .catch(() => setDiscoverFeed({ today: [], weekend: [] }));
  }, [homeCounty]);

  useEffect(() => {
    fetchLocalMomentum(homeCounty === "All" ? undefined : homeCounty)
      .then(setMomentum)
      .catch(() => setMomentum([]));
  }, [homeCounty]);

  const loadOpenGames = () => {
    fetchGames(homeCounty === "All" ? undefined : homeCounty)
      .then(setOpenGames)
      .catch(() => setOpenGames([]));
  };
  useEffect(loadOpenGames, [homeCounty]);

  // Continue Planning (IA spec §3) — a saved in-progress Make It Happen
  // search, read once on mount. Re-checked on focus too, since the user
  // typically left this exact tab to go finish (or abandon) that flow in
  // MakeItHappen.tsx and comes straight back to Home.
  useEffect(() => {
    setContinuePlan(readContinuePlanning());
    const onFocus = () => setContinuePlan(readContinuePlanning());
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  // Your Circles (IA spec §3) — only for a signed-in resident; Circles.tsx
  // remains the full browse/manage surface, this is just a Home teaser.
  useEffect(() => {
    if (resident) fetchMyCircles().then(setMyCircles).catch(() => setMyCircles([]));
    else setMyCircles([]);
  }, [resident]);

  useEffect(() => {
    fetchCircles(homeCounty === "All" ? undefined : homeCounty)
      .then((rows) => setCirclesNearby(rows.filter((c) => c.status === "active").slice(0, 4)))
      .catch(() => setCirclesNearby([]));
  }, [homeCounty]);

  // "Next Best Participation" (implementation backlog #4).
  useEffect(() => {
    if (resident) fetchNextBestParticipation().then(setNextBest).catch(() => setNextBest([]));
    else setNextBest([]);
  }, [resident]);

  useEffect(() => {
    if (!resident) {
      setMyGames([]);
      setMyBookings([]);
      setRoutineSuggestions([]);
      return;
    }
    fetchMyGames().then(setMyGames).catch(() => setMyGames([]));
    fetchMyBookings().then(setMyBookings).catch(() => setMyBookings([]));
    fetchRoutineSuggestions().then(setRoutineSuggestions).catch(() => setRoutineSuggestions([]));
  }, [resident]);

  // Personalization by previous participation (landing/homepage
  // repositioning, phase 4) — activities this resident has actually played
  // before, from their own game history plus Routine suggestions. Empty
  // for a guest (myGames/routineSuggestions are cleared on sign-out), so
  // the extra sort key below is a harmless no-op for anonymous visitors.
  // Deliberately doesn't attempt skill-level personalization — no such
  // field exists on Resident (see CLAUDE.md's "interests/availability are
  // CSV text" gap), and inventing one isn't this session's call to make.
  const familiarActivities = useMemo(
    () => new Set([...myGames.map((g) => g.activityLabel), ...routineSuggestions.map((s) => s.activityLabel)]),
    [myGames, routineSuggestions]
  );

  // Signature "people needed" selection — familiar activities first (see
  // above), then pending-participants games (need a minimum to run at
  // all), then open games close to full, soonest first; excludes anything
  // already full or with plenty of room to spare.
  const needPeopleGames = useMemo(() => {
    return openGames
      .filter((g) => g.spotsLeft > 0 && (g.status === "pending_participants" || g.spotsLeft <= 3))
      .sort((a, b) => {
        const aFam = familiarActivities.has(a.activityLabel) ? 0 : 1;
        const bFam = familiarActivities.has(b.activityLabel) ? 0 : 1;
        if (aFam !== bFam) return aFam - bFam;
        if (a.status !== b.status) return a.status === "pending_participants" ? -1 : 1;
        if (a.spotsLeft !== b.spotsLeft) return a.spotsLeft - b.spotsLeft;
        return a.date.localeCompare(b.date) || a.time.localeCompare(b.time);
      })
      .slice(0, 8);
  }, [openGames, familiarActivities]);

  // Soonest upcoming commitment across the two sources with a clean
  // date/time (see myGames/myBookings comment above). Cancelled/expired
  // bookings and cancelled games are excluded; today's own date still
  // counts (a same-day game/booking is still "next").
  const nextPlan = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const nextGame = myGames
      .filter((g) => g.status !== "cancelled" && g.date >= today)
      .sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time))[0];
    const nextBooking = myBookings
      .filter((b) => b.status !== "cancelled" && b.date >= today)
      .sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time))[0];
    if (nextGame && nextBooking) {
      const gameKey = `${nextGame.date} ${nextGame.time}`;
      const bookingKey = `${nextBooking.date} ${nextBooking.time}`;
      return gameKey <= bookingKey ? { kind: "game" as const, game: nextGame } : { kind: "booking" as const, booking: nextBooking };
    }
    if (nextGame) return { kind: "game" as const, game: nextGame };
    if (nextBooking) return { kind: "booking" as const, booking: nextBooking };
    return null;
  }, [myGames, myBookings]);

  // Matches a routine suggestion's activity against the county's open
  // games for a real upcoming occurrence — shown only when one actually
  // exists, never a fabricated "next Wednesday" guess.
  const doItAgain = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    for (const s of routineSuggestions) {
      const match = openGames.find((g) => g.activityLabel === s.activityLabel && g.status !== "cancelled" && g.date >= today);
      if (match) return { suggestion: s, game: match };
    }
    return routineSuggestions[0] ? { suggestion: routineSuggestions[0], game: null } : null;
  }, [routineSuggestions, openGames]);

  // Circle cards should emphasize the next real activity, not just member
  // count — but Circles have no stored "next session" concept (persistent
  // membership only, see CLAUDE.md's five-participation-tables note).
  // Rather than fabricate a date, derive it: match the Circle's own
  // activityLabel against openGames (already fetched above) for the
  // soonest upcoming one in the same county. Returns null when there's
  // genuinely no match — the card falls back to member count only.
  const circleNextActivity = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const byActivity = new Map<string, Game>();
    for (const g of openGames) {
      if (g.status === "cancelled" || g.date < today) continue;
      const existing = byActivity.get(g.activityLabel);
      if (!existing || `${g.date} ${g.time}` < `${existing.date} ${existing.time}`) byActivity.set(g.activityLabel, g);
    }
    return (circle: Circle) => byActivity.get(circle.activityLabel) ?? null;
  }, [openGames]);

  const handleJoinGame = async (id: string) => {
    setJoiningGameId(id);
    try {
      const res = await joinGame(id);
      if (res.url) {
        window.location.href = res.url;
        return;
      }
      loadOpenGames();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Couldn't join this game");
    } finally {
      setJoiningGameId(null);
    }
  };

  const handleLeaveGame = async (id: string) => {
    await leaveGame(id);
    loadOpenGames();
  };

  // Every mood tile navigates to the full Explore results page rather than
  // showing its own inline preview — Explore.tsx reads `mood` from the
  // query string and reuses the exact same fetchFreeTimeOptions() endpoint
  // this used to call directly, so filtering logic doesn't fork between
  // two code paths, and it's still a real discovery query, not a static
  // category page.
  const pickIntent = (chip: (typeof INTENT_CHIPS)[number]) => {
    if (chip.key === "explore") {
      navigate("/explore");
      return;
    }
    const mood = chip.key === "surprise" ? "surprise" : chip.mood;
    const countyParam = homeCounty !== "All" ? `&county=${encodeURIComponent(homeCounty)}` : "";
    navigate(`/explore?mood=${mood}${countyParam}`);
  };

  // Closest centres/clubs to the resolved coordinates, from the pool already
  // fetched above — no dedicated fetch, just a client-side sort/filter.
  // Scoped to centres/clubs specifically because they're the only listing
  // types with real lat/lng on their client type — games only carry
  // centre/county/free-text location, so a true radius filter for games
  // would need a backend change, not something to fake client-side.
  const nearYouItems = useMemo(() => {
    if (!userCoords) return [];
    const tagged: ({ kind: "centre"; listing: Centre } | { kind: "club"; listing: Club })[] = [
      ...allCentres.map((listing) => ({ kind: "centre" as const, listing })),
      ...allClubs.map((listing) => ({ kind: "club" as const, listing })),
    ];
    return tagged
      .filter((t) => t.listing.lat !== null && t.listing.lng !== null)
      .map((t) => ({ ...t, km: haversineDistanceKm(userCoords.lat, userCoords.lng, t.listing.lat!, t.listing.lng!) }))
      .filter((t) => t.km <= radiusKm)
      .sort((a, b) => a.km - b.km)
      .slice(0, 8);
  }, [userCoords, allCentres, allClubs, radiusKm]);

  const nowHour = new Date().getHours();
  const greeting = nowHour < 12 ? "Good morning" : nowHour < 18 ? "Good afternoon" : "Good evening";

  const handleHeroSearch = () => {
    const base = heroQuery.trim();
    if (!base) return;
    const extra = [
      homeCounty !== "All" && !base.toLowerCase().includes(homeCounty.toLowerCase()) ? homeCounty : null,
      heroWhen && !base.toLowerCase().includes(heroWhen) ? heroWhen : null,
    ].filter(Boolean);
    const q = [base, ...extra].join(" ");
    navigate(`/explore?q=${encodeURIComponent(q)}`);
  };

  // Permission is only ever requested here, on explicit click — never on page load.
  // Resolves entirely client-side: the real coordinate is matched against real
  // county centroids (irishCounties.ts) restricted to counties this app actually
  // has listings in — never sent to the server, never guessed.
  const handleUseMyLocation = () => {
    setLocationError(null);
    if (!navigator.geolocation) {
      setLocationError("Location isn't available in this browser.");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setUserCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        const match = nearestCounty(pos.coords.latitude, pos.coords.longitude, counties.filter((c) => c !== "All"));
        if (match) setHomeCounty(match);
        else setLocationError("Couldn't match your location to a county we cover yet.");
        setLocating(false);
      },
      (err) => {
        setLocationError(
          err.code === err.PERMISSION_DENIED
            ? "Location permission was denied — pick your area manually."
            : "Couldn't get your location — pick your area manually."
        );
        setLocating(false);
      },
      { timeout: 8000 }
    );
  };

  return (
    <div style={{ animation: "fadeUp .4s ease both" }}>
      {/* HERO — the app's first true full-bleed section: no maxWidth cap on
          the outer <section>, so its background/border spans the viewport
          edge to edge. Top content is a two-column split (headline column
          + search column, per /landing's hero composition) rather than one
          stacked column; the real listing-photo carousel (unchanged
          component, just restyled) is a full-width band below, bleeding to
          both viewport edges. Same sharp-corner/hairline-border visual
          system as the rest of the page — only the structure borrows from
          /landing, not its rounded/pill styling. */}
      <section style={fullBleedStyle(colors.bg, false)}>
        <div className="section-pad" style={{ ...innerWrapStyle, padding: "64px 24px 40px" }}>
          <div className="stack-mobile" style={{ display: "flex", gap: 56, alignItems: "flex-start", flexWrap: "wrap" }}>
            {/* Headline column — same marketing copy for every visitor,
                signed in or not (the earlier signed-in-only "Good morning"
                greeting variant was removed per request). */}
            <div style={{ flex: "1 1 0%", minWidth: 320 }}>
              <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: ".09em", textTransform: "uppercase", color: ACCENT, marginBottom: 14 }}>
                <span aria-hidden="true">/</span> Local activity, real people
              </div>
              <h1
                style={{
                  fontFamily: fonts.display,
                  fontWeight: 800,
                  fontSize: "clamp(38px, 5.5vw, 68px)",
                  lineHeight: 0.98,
                  letterSpacing: "-.03em",
                  margin: "0 0 22px",
                  color: colors.text,
                }}
              >
                Make things happen
                <br />
                near you.
              </h1>
              <div style={{ width: 64, height: 3, background: ACCENT, margin: "0 0 22px" }} />
              <p style={{ fontSize: 18, lineHeight: 1.5, color: colors.muted, margin: 0, maxWidth: 440 }}>
                Find people nearby, join something already happening, or start a plan of your own — book a hall, join a
                local club, or find a game tonight.
              </p>
            </div>

            {/* Search column */}
            <div style={{ flex: "1 1 0%", minWidth: 320, paddingTop: 8 }}>
              {resident && (
                <div style={{ fontSize: 13.5, fontWeight: 600, color: colors.mutedLight, marginBottom: 6 }}>
                  {greeting}, {resident.name.split(" ")[0]}
                </div>
              )}
              <h2 style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: 21, letterSpacing: "-.01em", margin: "0 0 14px", color: colors.text }}>
                Find something to do
              </h2>
              {/* One bar: query + location + when, all real inputs that
                  feed the query text on submit (parseSearchQuery.ts
                  recognises county names and morning/afternoon/evening/
                  tonight) — the Search button stays outside/below it. */}
              <div
                className="stack-mobile"
                style={{
                  background: colors.surface,
                  border: `1px solid ${colors.borderStrong}`,
                  borderRadius: SWISS_RADIUS,
                  padding: "6px 6px 6px 16px",
                  display: "flex",
                  alignItems: "center",
                  gap: 0,
                }}
              >
                <SearchIcon size={20} style={{ color: colors.mutedLight, flex: "none" }} />
                <input
                  value={heroQuery}
                  onChange={(e) => setHeroQuery(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleHeroSearch()}
                  placeholder="What do you feel like doing?"
                  style={{ flex: 1, minWidth: 0, border: "none", background: "transparent", fontSize: 17, color: colors.text, outline: "none", padding: "12px 10px" }}
                />

                <div className="hide-mobile" style={{ width: 1, alignSelf: "stretch", background: colors.border, flex: "none" }} />

                <div className="hide-mobile" style={{ display: "flex", alignItems: "center", gap: 6, padding: "0 10px", flex: "none" }}>
                  <button
                    onClick={handleUseMyLocation}
                    disabled={locating}
                    aria-label="Use my current location"
                    title="Use my current location"
                    style={{ display: "flex", alignItems: "center", background: "none", border: "none", padding: 0, cursor: locating ? "default" : "pointer", color: colors.mutedLight, flex: "none" }}
                  >
                    <PinIcon size={15} />
                  </button>
                  <select
                    value={homeCounty}
                    onChange={(e) => setHomeCounty(e.target.value)}
                    aria-label="County"
                    style={{ border: "none", background: "transparent", fontSize: 14, color: colors.text, outline: "none", fontWeight: 600, maxWidth: 100 }}
                  >
                    {counties.map((c) => (
                      <option key={c} value={c}>
                        {c === "All" ? "All counties" : c}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="hide-mobile" style={{ width: 1, alignSelf: "stretch", background: colors.border, flex: "none" }} />

                <div className="hide-mobile" style={{ display: "flex", alignItems: "center", gap: 6, padding: "0 10px", flex: "none" }}>
                  <ClockIcon size={15} style={{ color: colors.mutedLight, flex: "none" }} />
                  <select
                    value={heroWhen}
                    onChange={(e) => setHeroWhen(e.target.value)}
                    aria-label="When"
                    style={{ border: "none", background: "transparent", fontSize: 14, color: colors.text, outline: "none", fontWeight: 600, maxWidth: 100 }}
                  >
                    <option value="">Any time</option>
                    <option value="tonight">Tonight</option>
                    <option value="morning">Morning</option>
                    <option value="afternoon">Afternoon</option>
                    <option value="evening">Evening</option>
                  </select>
                </div>
              </div>
              {locating && <div style={{ color: colors.mutedLight, fontSize: 13, marginTop: 6 }}>Locating…</div>}
              {locationError && <div style={{ color: colors.danger, fontSize: 13, marginTop: 6 }}>{locationError}</div>}

              <button
                className="btn"
                onClick={handleHeroSearch}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 10,
                  minWidth: 240,
                  background: ACCENT,
                  color: "#fff",
                  border: "none",
                  borderRadius: SWISS_RADIUS,
                  padding: "16px 36px",
                  fontSize: 16,
                  fontWeight: 700,
                  cursor: "pointer",
                  marginTop: 14,
                }}
              >
                Find something <ArrowRightIcon size={16} />
              </button>

              {/* Quick intent links — de-emphasized vs. Browse centres/
                  clubs, which were removed from here per the requested
                  hierarchy (this hero is about intent, not supply). */}
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 18 }}>
                {["Badminton tonight", "Five-a-side", "Weekend hike", "Cycling", "Coffee & social"].map((label) => (
                  <button
                    key={label}
                    onClick={() => navigate(`/explore?q=${encodeURIComponent(label)}`)}
                    style={{ background: "none", border: `1px solid ${colors.border}`, borderRadius: SWISS_RADIUS, color: colors.muted, fontWeight: 600, fontSize: 13, padding: "6px 12px", cursor: "pointer" }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div style={{ borderTop: `1px solid ${colors.border}`, position: "relative", overflow: "hidden", height: "clamp(220px, 32vw, 420px)" }}>
          <HeroScrollSplit images={HERO_IMAGES} />
        </div>
      </section>

      {/* §3 — Mood/intent selector. Immediately after the hero. */}
      <section style={fullBleedStyle(colors.bg)}>
        <div className="section-pad" style={innerWrapStyle}>
          <SectionHeader eyebrow={accentEyebrow("Mood")} title="What are you in the mood for?" titleSize="clamp(24px, 2.8vw, 30px)" />
          {/* Not .grid-responsive — that utility collapses to a single
              column under 900px, which would stack all 6 tiles into one
              tall column. auto-fit/minmax reflows naturally instead. */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", gap: 10 }}>
            {INTENT_CHIPS.map((chip) => (
              <button
                key={chip.key}
                className="mood-tile"
                onClick={() => pickIntent(chip)}
                style={{
                  aspectRatio: "1 / 1",
                  borderRadius: MOOD_TILE_RADIUS,
                  border: `1px solid ${colors.border}`,
                  cursor: "pointer",
                  padding: "16px 12px",
                  background: colors.surface,
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "center",
                  alignItems: "center",
                  textAlign: "center",
                  gap: 10,
                }}
              >
                <div
                  className="mood-tile-icon"
                  style={{
                    width: 64,
                    height: 64,
                    borderRadius: "50%",
                    background: colors.panel,
                    color: colors.text,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flex: "none",
                    transition: "background 0.2s ease, color 0.2s ease, transform 0.2s ease",
                  }}
                >
                  {chip.icon}
                </div>
                <div>
                  <div style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: 18, color: colors.text }}>{chip.label}</div>
                  <div style={{ fontSize: 13, color: colors.mutedLight, marginTop: 3 }}>{chip.description}</div>
                </div>
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* Your Next Plan — the single highest-priority module when it
          applies: a resident with something coming up shouldn't have to
          scroll past discovery content to find it. Not one of the spec's
          numbered public-landing sections (it's a signed-in-only module),
          kept here since it's the most time-sensitive thing a returning
          user could see. */}
      {resident && nextPlan && (
        <section style={fullBleedStyle(colors.bg)}>
          <div className="section-pad" style={innerWrapStyle}>
            <div style={bannerStyle(colors.green)}>
              <div>
                <div style={{ fontSize: 11.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".09em", color: colors.mutedLight, marginBottom: 8 }}>
                  Your next plan
                </div>
                {nextPlan.kind === "game" ? (
                  <>
                    <h3 style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: 20, margin: "0 0 4px" }}>{nextPlan.game.activityLabel}</h3>
                    <div style={{ fontSize: 13.5, color: colors.muted }}>
                      {nextPlan.game.date} · {nextPlan.game.time} · {nextPlan.game.joined}/{nextPlan.game.capacity} going
                      {nextPlan.game.centreName ? ` · ${nextPlan.game.centreName}` : nextPlan.game.locationText ? ` · ${nextPlan.game.locationText}` : ""}
                    </div>
                  </>
                ) : (
                  <>
                    <h3 style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: 20, margin: "0 0 4px" }}>{nextPlan.booking.centreName}</h3>
                    <div style={{ fontSize: 13.5, color: colors.muted }}>
                      {nextPlan.booking.date} · {nextPlan.booking.time}
                      {nextPlan.booking.roomName ? ` · ${nextPlan.booking.roomName}` : ""}
                    </div>
                  </>
                )}
              </div>
              <button className="btn" onClick={() => navigate(nextPlan.kind === "game" ? `/games/${nextPlan.game.id}` : "/bookings")} style={ctaButtonStyle(colors.green)}>
                View details <ArrowRightIcon size={14} />
              </button>
            </div>
          </div>
        </section>
      )}

      {/* Continue Planning (IA spec §3) — signed-in-only utility, kept
          right alongside Your Next Plan. */}
      {continuePlan && (
        <section style={fullBleedStyle(colors.bg)}>
          <div className="section-pad" style={innerWrapStyle}>
            <div style={bannerStyle(colors.orange)}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 15 }}>Continue planning {continuePlan.activityLabel || "your activity"}?</div>
                <div style={{ fontSize: 13, color: colors.muted, marginTop: 2 }}>
                  {[continuePlan.county, continuePlan.date, continuePlan.time].filter(Boolean).join(" · ") || "You were part-way through Make It Happen."}
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, flex: "none" }}>
                <button
                  onClick={() => {
                    clearContinuePlanning();
                    setContinuePlan(null);
                  }}
                  style={{ background: "none", border: "none", color: colors.muted, fontSize: 13, cursor: "pointer" }}
                >
                  Dismiss
                </button>
                <button className="btn" onClick={() => navigate("/make-it-happen")} style={ctaButtonStyle(colors.orangeDark)}>
                  Continue
                </button>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* §4 — "They just need a few more people": the signature module.
          Real capacity data from the existing games endpoint, no mock
          counts. Reuses Games.tsx's own GameCard — now with a prominent
          "1 player needed" / "2 spots left" / "3 more welcome" headline —
          rather than a second card implementation. A strict grid on wider
          screens (3-4 visible at once), falling back to horizontal scroll
          on mobile. */}
      {needPeopleGames.length > 0 && (
        <section id="need-people" style={fullBleedStyle(colors.bg)}>
          <div className="section-pad" style={innerWrapStyle}>
            <SectionHeader
              eyebrow={accentEyebrow("Needs people")}
              title="They just need a few more people"
              subtitle="Join local plans that are close to happening."
              action={
                <button onClick={() => navigate("/games")} style={{ background: "none", border: "none", color: colors.text, fontWeight: 700, fontSize: 13.5, cursor: "pointer", textDecoration: "underline" }}>
                  See all
                </button>
              }
            />
            <div className="grid-responsive-3" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(270px, 1fr))", gap: 16 }}>
              {needPeopleGames.map((g) => (
                <div key={g.id} style={{ position: "relative" }}>
                  {familiarActivities.has(g.activityLabel) && (
                    <span
                      style={{
                        position: "absolute",
                        top: 10,
                        left: 10,
                        zIndex: 1,
                        background: colors.dark,
                        color: "#fff",
                        borderRadius: SWISS_RADIUS,
                        padding: "3px 10px",
                        fontSize: 11,
                        fontWeight: 700,
                        pointerEvents: "none",
                      }}
                    >
                      Because you play this
                    </span>
                  )}
                  <GameCard game={g} joining={joiningGameId === g.id} onJoin={() => handleJoinGame(g.id)} onLeave={() => handleLeaveGame(g.id)} />
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* "Next Best Participation" (implementation backlog #4) — proactive,
          blending Discover's own ranking with active Routines + Circle
          membership; no mood/duration input required. Signed-in-only,
          kept right after People Needed since it's the same "who needs
          people / what fits me" beat, just personalized. */}
      {resident && nextBest.length > 0 && (
        <section style={fullBleedStyle(colors.bg)}>
          <div className="section-pad" style={innerWrapStyle}>
            <SectionHeader eyebrow={accentEyebrow("For you")} title="Matches for you" subtitle="Ranked from what's on, your routines, and your Circles — no filters needed." />
            <div style={{ display: "flex", gap: 14, overflowX: "auto", paddingBottom: 6 }}>
              {nextBest.map((item) => (
                <DiscoverCard key={`${item.kind}-${item.id}`} item={item} isToday={item.date === new Date().toISOString().slice(0, 10)} />
              ))}
              <button
                onClick={() => navigate("/explore")}
                style={{
                  flex: "none",
                  width: 180,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 8,
                  background: colors.surface,
                  border: `1px dashed ${colors.borderStrong}`,
                  borderRadius: radius.card,
                  cursor: "pointer",
                  color: colors.text,
                  fontWeight: 700,
                  fontSize: 14,
                }}
              >
                View more <ArrowRightIcon size={15} />
              </button>
            </div>
          </div>
        </section>
      )}

      {/* §5 — Happening today, before This weekend. */}
      {discoverFeed && discoverFeed.today.length > 0 && (
        <section style={fullBleedStyle(colors.bg)}>
          <div className="section-pad" style={innerWrapStyle}>
            <DiscoverRow title="Happening today" items={discoverFeed.today} isToday limit={12} moreHref="/explore?when=today" />
          </div>
        </section>
      )}

      {/* §6 — "One idea, different ways to make it happen" (borrowed from
          client/src/landing/'s intent-grid concept) — the clearest
          differentiation section, moved up right after Happening Today per
          request. Explains the actual product differentiation: the same
          intent can be satisfied by joining a Plan, a Circle, an Activity
          or a Place. Deliberately illustrative/generic copy, not specific
          counts like landing/'s mock "2 players looking for 2 more" — that
          would read as live data when it isn't. Guest-only, same as How It
          Works further down: once signed in, the rest of the page already
          demonstrates this. */}
      {!resident && (
        <section style={fullBleedStyle(colors.bg)}>
          <div className="section-pad" style={innerWrapStyle}>
            <SectionHeader eyebrow={accentEyebrow("How HelloCircle works")} title="One idea. Different ways to make it happen." subtitle={'Say "badminton tonight" and HelloCircle can mean any of these.'} />
            <div className="grid-responsive" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 1, background: colors.border }}>
              {[
                { eyebrow: "Plan", title: "Join a plan", detail: "A few more players needed nearby.", cta: "See open plans", to: "/games" },
                { eyebrow: "Circle", title: "Join a Circle", detail: "People who play this every week.", cta: "Explore Circles", to: "/circles" },
                { eyebrow: "Activity", title: "Join a session", detail: "A hosted session with spaces open.", cta: "See what's on", to: "/explore" },
                { eyebrow: "Place", title: "Find a court", detail: "Book a space and bring your own group.", cta: "Find a place", to: "/browse/centres" },
              ].map((p) => (
                <button
                  key={p.eyebrow}
                  onClick={() => navigate(p.to)}
                  style={{ background: colors.surface, border: "none", padding: "22px 20px", cursor: "pointer", textAlign: "left", display: "flex", flexDirection: "column", gap: 8 }}
                >
                  <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: colors.mutedLight }}>{p.eyebrow}</span>
                  <div style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: 17 }}>{p.title}</div>
                  <p style={{ margin: 0, color: colors.muted, fontSize: 13, flex: 1 }}>{p.detail}</p>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 5, color: colors.text, fontWeight: 700, fontSize: 13 }}>
                    {p.cta} <ArrowRightIcon size={13} />
                  </span>
                </button>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* §7 — Demand capture: the page's one full-bleed dark band, a
          deliberate single strong contrast beat in an otherwise
          near-monochrome page. Two real CTAs — "Add my interest" routes to
          Explore (the general discovery/search entry point, since there's
          no specific activity context chosen at this generic band to hand
          an IntentCaptureForm), "Start something" keeps the existing Make
          It Happen surface (find a venue + recruit a group). No fabricated
          demand count — showing one here would need a specific activity in
          context, which this band doesn't have. */}
      <section style={{ background: colors.dark, borderTop: `1px solid ${colors.dark}` }}>
        <div className="section-pad" style={{ ...innerWrapStyle, display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 20 }}>
          <div>
            <div style={{ fontSize: 11.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".09em", color: ACCENT, marginBottom: 8 }}>
              <span aria-hidden="true">/</span> Can't find it?
            </div>
            <h3 style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: "clamp(22px, 3vw, 30px)", color: "#fff", margin: "0 0 6px" }}>Can't find what you want?</h3>
            <p style={{ margin: 0, color: "rgba(255,255,255,.72)", fontSize: 15, maxWidth: 480 }}>
              Tell us what you'd like to do. We'll help find people nearby who are interested too.
            </p>
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button
              onClick={() => navigate("/explore")}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                background: "transparent",
                color: "#fff",
                border: "1px solid rgba(255,255,255,.4)",
                borderRadius: SWISS_RADIUS,
                padding: "14px 22px",
                fontSize: 15,
                fontWeight: 700,
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              Add my interest
            </button>
            <button
              className="btn"
              onClick={() => navigate("/make-it-happen")}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                background: "#fff",
                color: colors.dark,
                border: "none",
                borderRadius: SWISS_RADIUS,
                padding: "14px 22px",
                fontSize: 15,
                fontWeight: 700,
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              <HandshakeIcon size={16} /> Start something <ArrowRightIcon size={15} />
            </button>
          </div>
        </div>
      </section>

      {/* §8 — This weekend. */}
      {discoverFeed && discoverFeed.weekend.length > 0 && (
        <section style={fullBleedStyle(colors.bg)}>
          <div className="section-pad" style={innerWrapStyle}>
            <DiscoverRow title="This weekend" items={discoverFeed.weekend} limit={12} moreHref="/explore?when=weekend" />
          </div>
        </section>
      )}

      {/* No-local-inventory empty state — a real recovery decision, not a
          dead end, shown only once the feed has actually loaded and come
          back with nothing at all (both Happening Today and This Weekend
          empty). */}
      {discoverFeed && discoverFeed.today.length === 0 && discoverFeed.weekend.length === 0 && (
        <section style={fullBleedStyle(colors.bg)}>
          <div className="section-pad" style={innerWrapStyle}>
            <div style={{ border: `1px solid ${colors.border}`, borderRadius: SWISS_CARD_RADIUS, padding: "22px 24px" }}>
              <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>Nothing scheduled near you just yet</div>
              <p style={{ fontSize: 13.5, color: colors.mutedLight, margin: "0 0 14px" }}>Here's what usually helps:</p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                <button onClick={() => setHomeCounty("All")} style={chipStyle(false)}>
                  Widen to all counties
                </button>
                <button onClick={() => navigate("/browse/centres")} style={chipStyle(false)}>
                  View places
                </button>
                <button onClick={() => navigate("/games")} style={chipStyle(false)}>
                  Start an activity
                </button>
                <button onClick={() => navigate("/make-it-happen")} style={chipStyle(false)}>
                  Make it happen
                </button>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* §9 — Find your circle. Real Circle cards (fetchCircles — the same
          public browse endpoint Circles.tsx uses), each now showing a
          derived real next activity (circleNextActivity above) rather than
          just member count, when one exists. Signed-in members with
          existing Circles instead see "Your Circles" (their own, not the
          general nearby set) — same underlying card treatment. */}
      {resident && myCircles.length > 0 && (
        <section style={fullBleedStyle(colors.bg)}>
          <div className="section-pad" style={innerWrapStyle}>
            <SectionHeader
              eyebrow={accentEyebrow("Circles")}
              title="Your Circles"
              action={
                <button onClick={() => navigate("/circles")} style={{ background: "none", border: "none", color: colors.text, fontWeight: 700, fontSize: 13.5, cursor: "pointer", textDecoration: "underline" }}>
                  See all
                </button>
              }
            />
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16 }}>
              {myCircles.slice(0, 4).map((c) => {
                const next = circleNextActivity(c);
                return (
                  <DestinationCard
                    key={c.id}
                    image={c.imageUrl}
                    title={c.name}
                    caption={next ? `Next: ${next.date} · ${next.time} · ${next.joined} going` : `${c.members} member${c.members === 1 ? "" : "s"}`}
                    onClick={() => navigate(`/circles/${c.slug ?? c.id}`)}
                  />
                );
              })}
            </div>
          </div>
        </section>
      )}

      {(!resident || myCircles.length === 0) && (
        <section style={fullBleedStyle(colors.bg)}>
          <div className="section-pad" style={innerWrapStyle}>
            {circlesNearby.length > 0 ? (
              <>
                <SectionHeader
                  eyebrow={accentEyebrow("Circles")}
                  title="Find your circle"
                  subtitle="Join people who keep showing up for the same things you enjoy."
                  action={
                    <button onClick={() => navigate("/circles")} style={{ background: "none", border: "none", color: colors.text, fontWeight: 700, fontSize: 13.5, cursor: "pointer", textDecoration: "underline" }}>
                      Explore Circles
                    </button>
                  }
                />
                <div className="grid-responsive" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16 }}>
                  {circlesNearby.map((c) => {
                    const next = circleNextActivity(c);
                    return (
                      <DestinationCard
                        key={c.id}
                        image={c.imageUrl}
                        title={c.name}
                        caption={
                          next
                            ? `Next: ${next.date} · ${next.time}${c.area ? ` · ${c.area}` : ""} · ${next.joined} going`
                            : `${c.area ? `${c.area} · ` : ""}${c.members} member${c.members === 1 ? "" : "s"}`
                        }
                        onClick={() => navigate(`/circles/${c.slug ?? c.id}`)}
                      />
                    );
                  })}
                </div>
              </>
            ) : (
              <div style={bannerStyle(colors.green)}>
                <div>
                  <div style={{ fontSize: 11.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".09em", color: colors.mutedLight, marginBottom: 6 }}>{accentEyebrow("Circles")}</div>
                  <h3 style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: 19, margin: "0 0 4px" }}>Find your circle</h3>
                  <p style={{ margin: 0, color: colors.muted, fontSize: 14 }}>Join people who keep showing up for the same things you enjoy.</p>
                </div>
                <button className="btn" onClick={() => navigate("/circles")} style={ctaButtonStyle(colors.green)}>
                  Explore Circles <ArrowRightIcon size={15} />
                </button>
              </div>
            )}
          </div>
        </section>
      )}

      {/* Do It Again — reuses the Routines suggestion query; only claims a
          specific upcoming date when a matching open game genuinely
          exists, otherwise offers to set up a routine instead of guessing
          at "next Wednesday". Signed-in-only retention mechanic, kept next
          to the Circles section since both are about repeat participation. */}
      {resident && doItAgain && (
        <section style={fullBleedStyle(colors.bg)}>
          <div className="section-pad" style={innerWrapStyle}>
            <div style={bannerStyle(colors.dark)}>
              <div>
                <div style={{ fontSize: 11.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".09em", color: colors.mutedLight, marginBottom: 8 }}>Do it again?</div>
                {doItAgain.game ? (
                  <p style={{ margin: 0, color: colors.text, fontSize: 15 }}>
                    You've played {doItAgain.suggestion.activityLabel} like this before — {doItAgain.game.date} at {doItAgain.game.time} is
                    on, {doItAgain.game.joined}/{doItAgain.game.capacity} going.
                  </p>
                ) : (
                  <p style={{ margin: 0, color: colors.text, fontSize: 15 }}>
                    You've done {doItAgain.suggestion.activityLabel} {doItAgain.suggestion.sessionCount} times recently — want us to remind
                    you next time?
                  </p>
                )}
              </div>
              <button
                className="btn"
                onClick={() => navigate(doItAgain.game ? `/games/${doItAgain.game.id}` : "/bookings?tab=routines")}
                style={ctaButtonStyle(colors.dark)}
              >
                {doItAgain.game ? "Join again" : "Set up a routine"} <ArrowRightIcon size={14} />
              </button>
            </div>
          </div>
        </section>
      )}

      {/* §10 — "People are joining these now" (reworked from "Picking up
          near you"). Real momentum data only — hides entirely in a
          fresh/quiet county rather than showing nothing happening. */}
      {momentum.length > 0 && (
        <section style={fullBleedStyle(colors.bg)}>
          <div className="section-pad" style={innerWrapStyle}>
            <SectionHeader eyebrow={accentEyebrow("Trending")} title="People are joining these now" />
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
              {momentum.map((m) => (
                <div
                  key={`${m.label}-${m.county}`}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    background: colors.surface,
                    border: `1px solid ${colors.borderStrong}`,
                    borderRadius: SWISS_RADIUS,
                    padding: "9px 16px",
                  }}
                >
                  <TrendUpIcon size={15} style={{ color: colors.greenText, flex: "none" }} />
                  <span style={{ fontSize: 13.5, color: colors.text }}>
                    <strong>{m.label}</strong>: +{m.growth} space{m.growth === 1 ? "" : "s"} this week
                    {homeCounty === "All" && <> · {m.county}</>}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* §11 — Try something different: Adventures + Experiences, two
          blocks only, per request (the page already has enough discovery
          mechanisms without adding more categories here). Image-forward
          "Popular Destinations"-style preview cards (DestinationCard,
          above) rather than the denser, price/quick-facts-heavy
          ExperienceCard that Adventures.tsx/Experiences.tsx use for their
          own full browse grids — this is a taste/teaser, not a shopping
          list. Falls back to a plain nav tile for either kind that comes
          back empty (a fresh/unseeded dev DB, or a kind genuinely not
          listed yet). */}
      <section style={fullBleedStyle(colors.bg)}>
        <div className="section-pad" style={innerWrapStyle}>
          <SectionHeader eyebrow={accentEyebrow("More ways to go")} title="Try something different" />
          <div className="grid-responsive" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 28 }}>
            {[
              { kind: "adventure" as const, to: "/adventures", title: "Adventures", subtitle: "Guided hikes, kayaking and outdoor trips.", rows: previewAdventures },
              { kind: "experience" as const, to: "/experiences", title: "Experiences", subtitle: "Workshops, classes and one-off outings.", rows: previewExperiences },
            ].map((t) => (
              <div key={t.kind}>
                <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 12 }}>
                  <div>
                    <h3 style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: 19, margin: 0, letterSpacing: "-.01em" }}>{t.title}</h3>
                    <p style={{ margin: "2px 0 0", color: colors.muted, fontSize: 13 }}>{t.subtitle}</p>
                  </div>
                  <button onClick={() => navigate(t.to)} style={{ background: "none", border: "none", display: "inline-flex", alignItems: "center", gap: 5, color: colors.text, fontWeight: 700, fontSize: 13, cursor: "pointer", whiteSpace: "nowrap" }}>
                    See all <ArrowRightIcon size={13} />
                  </button>
                </div>
                {t.rows.length > 0 ? (
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 16 }}>
                    {t.rows.map((e) => (
                      <DestinationCard
                        key={e.id}
                        image={e.imageUrl || null}
                        title={e.title}
                        caption={[e.area, e.county].filter(Boolean).join(", ")}
                        onClick={() => navigate(`/${e.kind === "adventure" ? "adventures" : "experiences"}/${e.slug ?? e.id}`)}
                      />
                    ))}
                  </div>
                ) : (
                  <button
                    onClick={() => navigate(t.to)}
                    style={{ width: "100%", background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: SWISS_CARD_RADIUS, cursor: "pointer", textAlign: "left", padding: "20px 18px", display: "flex", flexDirection: "column", gap: 6 }}
                  >
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: colors.text, fontWeight: 700, fontSize: 13.5 }}>
                      Explore {t.title.toLowerCase()} <ArrowRightIcon size={14} />
                    </span>
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Near you — geolocation-based centres/clubs preview, only once the
          user has opted in via "Use my current location" above. Not one
          of the spec's numbered sections; kept here since it's thematically
          the same "places" beat as what follows. */}
      {userCoords && (
        <section style={fullBleedStyle(colors.bg)}>
          <div className="section-pad" style={innerWrapStyle}>
            <SectionHeader eyebrow={accentEyebrow("Nearby")} title="Near you" />
            <div style={{ display: "flex", gap: 8, marginBottom: 16, marginTop: -8 }}>
              {[2, 5, 10, 25].map((r) => (
                <button key={r} onClick={() => setRadiusKm(r)} style={chipStyle(radiusKm === r)}>
                  {r} km
                </button>
              ))}
            </div>
            {nearYouItems.length === 0 ? (
              <p style={{ color: colors.mutedLight, fontSize: 14 }}>Nothing within {radiusKm} km yet — try a wider radius.</p>
            ) : (
              <div className="grid-responsive-3" style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 20 }}>
                {nearYouItems.map((t) => (
                  <div key={`${t.kind}-${t.listing.id}`}>
                    <div style={{ position: "relative" }}>
                      {t.kind === "centre" ? <CentreCard centre={t.listing} /> : <ClubCard club={t.listing} />}
                      <span
                        style={{
                          position: "absolute",
                          top: 10,
                          left: 10,
                          zIndex: 1,
                          background: "rgba(255,255,255,.92)",
                          borderRadius: SWISS_RADIUS,
                          padding: "4px 10px",
                          fontSize: 11.5,
                          fontWeight: 700,
                          color: colors.text,
                          pointerEvents: "none",
                        }}
                      >
                        {t.km < 1 ? `${Math.round(t.km * 1000)} m away` : `${t.km.toFixed(1)} km away`}
                      </span>
                    </div>
                    {t.listing.mapUrl && (
                      <button
                        onClick={() => window.open(t.listing.mapUrl, "_blank", "noopener,noreferrer")}
                        className="link-accent"
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 5,
                          background: "none",
                          border: "none",
                          cursor: "pointer",
                          color: colors.muted,
                          fontSize: 12.5,
                          fontWeight: 600,
                          padding: "6px 0 0",
                        }}
                      >
                        <PinIcon size={12} /> Get directions
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      )}

      {/* §12 — Need somewhere to do it? Places framed as a resource for
          participation, not the main product — kept in the lower half. */}
      <section style={fullBleedStyle(colors.bg)}>
        <div className="section-pad" style={innerWrapStyle}>
          <SectionHeader eyebrow={accentEyebrow("Places")} title="Need somewhere to do it?" subtitle="Find courts, studios, community halls and local spaces when your plan needs one." />
          <div className="grid-responsive" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 1, background: colors.border }}>
            <button
              onClick={() => navigate("/browse/centres")}
              style={{ background: colors.surface, border: "none", padding: "28px 26px", cursor: "pointer", textAlign: "left", display: "flex", flexDirection: "column", gap: 10 }}
            >
              <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: ".08em", color: ACCENT }}>01</span>
              <h3 style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: 22, margin: 0, letterSpacing: "-.01em" }}>Community centres</h3>
              <p style={{ margin: 0, color: colors.muted, fontSize: 14 }}>Halls and meeting spaces to hire by the hour.</p>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: colors.text, fontWeight: 700, fontSize: 13.5, marginTop: 4 }}>
                Explore spaces <ArrowRightIcon size={14} />
              </span>
            </button>
            <button
              onClick={() => navigate("/browse/clubs")}
              style={{ background: colors.surface, border: "none", padding: "28px 26px", cursor: "pointer", textAlign: "left", display: "flex", flexDirection: "column", gap: 10 }}
            >
              <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: ".08em", color: ACCENT }}>02</span>
              <h3 style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: 22, margin: 0, letterSpacing: "-.01em" }}>Sports clubs</h3>
              <p style={{ margin: 0, color: colors.muted, fontSize: 14 }}>GAA, soccer, swimming, rugby & more — from age 4 up.</p>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: colors.text, fontWeight: 700, fontSize: 13.5, marginTop: 4 }}>
                Explore clubs <ArrowRightIcon size={14} />
              </span>
            </button>
          </div>
        </div>
      </section>

      {/* §13 — Spaces near you (renamed from "Explore community centres"). */}
      <section style={fullBleedStyle(colors.bg)}>
        <div className="section-pad" style={innerWrapStyle}>
          <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 18, flexWrap: "wrap", gap: 10 }}>
            <div>
              <div style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: ".09em", textTransform: "uppercase", color: colors.mutedLight, marginBottom: 6 }}>
                {accentEyebrow("Places")}
              </div>
              <h2 style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: 22, margin: 0, letterSpacing: "-.01em" }}>
                {homeCounty === "All" ? "Spaces near you" : `Spaces in ${homeCounty}`}
              </h2>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <button
                onClick={() => navigate(`/browse/centres?county=${encodeURIComponent(homeCounty)}`)}
                style={{ background: "none", border: "none", display: "inline-flex", alignItems: "center", gap: 6, color: colors.text, fontWeight: 600, fontSize: 15, cursor: "pointer" }}
              >
                View all <ArrowRightIcon size={15} />
              </button>
              <button
                onClick={() => navigate(`/browse/centres?county=${encodeURIComponent(homeCounty)}`)}
                aria-label="See more spaces"
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: SWISS_RADIUS,
                  background: colors.surface,
                  border: `1px solid ${colors.borderStrong}`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: colors.text,
                  cursor: "pointer",
                }}
              >
                <ChevronRightIcon size={16} />
              </button>
            </div>
          </div>
          {!loadingCentres && featuredCentres.length === 0 ? (
            <p style={{ color: colors.muted, fontSize: 15 }}>No spaces listed in {homeCounty} yet — try another county.</p>
          ) : (
            <div className="grid-responsive-3" style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 20 }}>
              {loadingCentres
                ? Array.from({ length: 4 }, (_, i) => <CardSkeleton key={i} photoHeight={132} />)
                : featuredCentres.map((c) => <CentreCard key={c.id} centre={c} />)}
            </div>
          )}
        </div>
      </section>

      {/* §14 — Local clubs (renamed from "Explore sports clubs"). */}
      <section style={fullBleedStyle(colors.bg)}>
        <div className="section-pad" style={innerWrapStyle}>
          <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 18, flexWrap: "wrap", gap: 10 }}>
            <div>
              <div style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: ".09em", textTransform: "uppercase", color: colors.mutedLight, marginBottom: 6 }}>
                {accentEyebrow("Clubs")}
              </div>
              <h2 style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: 22, margin: 0, letterSpacing: "-.01em" }}>
                {homeCounty === "All" ? "Local clubs" : `Clubs in ${homeCounty}`}
              </h2>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <button
                onClick={() => navigate(`/browse/clubs?county=${encodeURIComponent(homeCounty)}`)}
                style={{ background: "none", border: "none", display: "inline-flex", alignItems: "center", gap: 6, color: colors.text, fontWeight: 600, fontSize: 15, cursor: "pointer" }}
              >
                View all <ArrowRightIcon size={15} />
              </button>
              <button
                onClick={() => navigate(`/browse/clubs?county=${encodeURIComponent(homeCounty)}`)}
                aria-label="See more local clubs"
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: SWISS_RADIUS,
                  background: colors.surface,
                  border: `1px solid ${colors.borderStrong}`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: colors.text,
                  cursor: "pointer",
                }}
              >
                <ChevronRightIcon size={16} />
              </button>
            </div>
          </div>
          {!loadingClubs && featuredClubs.length === 0 ? (
            <p style={{ color: colors.muted, fontSize: 15 }}>No clubs listed in {homeCounty} yet — try another county.</p>
          ) : (
            <div className="grid-responsive-3" style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 20 }}>
              {loadingClubs
                ? Array.from({ length: 4 }, (_, i) => <CardSkeleton key={i} photoHeight={120} />)
                : featuredClubs.map((c) => <ClubCard key={c.id} club={c} />)}
            </div>
          )}
        </div>
      </section>

      {/* §15 — How HelloCircle works (borrowed from client/src/landing/'s
          numbered-steps section — the one motif the earlier audit flagged
          as genuinely Swiss). Static copy, no data, guest-only per the
          "stop selling once signed in" rule already applied above. */}
      {!resident && (
        <section style={fullBleedStyle(colors.bg)}>
          <div className="section-pad" style={innerWrapStyle}>
            <SectionHeader eyebrow={accentEyebrow("How it works")} title={'From "maybe" to "I\'m in."'} />
            <div className="grid-responsive" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 1, background: colors.border }}>
              {[
                { n: "01", title: "Say what you want to do", text: "Football tonight? Hiking Saturday? Coffee nearby?" },
                { n: "02", title: "Join or start something", text: "Find an existing plan, or create one in seconds." },
                { n: "03", title: "Show up", text: "Meet, play, explore, learn — then do it again." },
              ].map((step) => (
                <div key={step.n} style={{ background: colors.surface, padding: "26px 24px" }}>
                  <span style={{ fontFamily: fonts.display, fontSize: 13, fontWeight: 800, color: ACCENT }}>{step.n}</span>
                  <h3 style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: 18, margin: "8px 0 6px" }}>{step.title}</h3>
                  <p style={{ margin: 0, color: colors.muted, fontSize: 14, lineHeight: 1.5 }}>{step.text}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* §16 + §17 — Partner CTA + Final CTA, consolidated into one closing
          dark band — the page's second (and last) strong contrast beat,
          echoing the demand-capture band above to bookend the page. */}
      <section style={{ background: colors.dark }}>
        <div className="section-pad" style={{ ...innerWrapStyle, padding: "48px 24px 64px" }}>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 24 }}>
            <div>
              <div style={{ fontSize: 11.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".09em", color: ACCENT, marginBottom: 10 }}>
                <span aria-hidden="true">/</span> Ready when you are
              </div>
              <h2 style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: "clamp(28px, 4vw, 44px)", lineHeight: 1.02, color: "#fff", margin: "0 0 8px", letterSpacing: "-.02em" }}>
                Fancy doing something?
              </h2>
              <p style={{ margin: 0, color: "rgba(255,255,255,.72)", fontSize: 16 }}>See what people near you are up for.</p>
            </div>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <button
                className="btn"
                onClick={() => navigate("/browse/centres")}
                style={{ background: "#fff", color: colors.dark, border: "none", borderRadius: SWISS_RADIUS, padding: "13px 22px", fontSize: 15, fontWeight: 700, cursor: "pointer" }}
              >
                Explore near you
              </button>
              <button
                className="btn"
                onClick={() => navigate("/make-it-happen")}
                style={{ background: "transparent", color: "#fff", border: "1px solid rgba(255,255,255,.4)", borderRadius: SWISS_RADIUS, padding: "13px 22px", fontSize: 15, fontWeight: 700, cursor: "pointer" }}
              >
                Start something
              </button>
            </div>
          </div>
          <div style={{ borderTop: "1px solid rgba(255,255,255,.15)", marginTop: 36, paddingTop: 24, display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 15, color: "#fff", marginBottom: 4 }}>Run a club, venue or local activity?</div>
              <p style={{ margin: 0, color: "rgba(255,255,255,.6)", fontSize: 13.5 }}>Reach people nearby who are already looking for things to do.</p>
            </div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button
                onClick={() => navigate("/vendor/signup")}
                style={{ display: "inline-flex", alignItems: "center", gap: 8, background: "#fff", color: colors.dark, border: "none", borderRadius: SWISS_RADIUS, padding: "11px 18px", fontSize: 14, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }}
              >
                <BuildingIcon size={16} /> List your place
              </button>
              <button
                onClick={() => navigate("/vendor/signup")}
                style={{ display: "inline-flex", alignItems: "center", gap: 8, background: "none", color: "#fff", border: "1px solid rgba(255,255,255,.4)", borderRadius: SWISS_RADIUS, padding: "11px 18px", fontSize: 14, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }}
              >
                Host activities
              </button>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
