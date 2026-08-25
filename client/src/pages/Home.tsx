import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { fetchCentres, fetchClubs, fetchDiscover, fetchFreeTimeOptions, fetchLocalMomentum, fetchMyCircles, fetchNextBestParticipation, search } from "../api";
import { CentreCard } from "../components/CentreCard";
import { ClubCard } from "../components/ClubCard";
import { DiscoverCard, DiscoverRow } from "../components/DiscoverRow";
import { HeroCarousel, type HeroCarouselSlide } from "../components/HeroCarousel";
import { CardSkeleton, EmptyState } from "../components/ui";
import { CommunityIllustration, SportsIllustration } from "../components/illustrations";
import {
  ArrowRightIcon,
  BallIcon,
  BuildingIcon,
  ChevronRightIcon,
  CloseIcon,
  HandshakeIcon,
  HeartIcon,
  PinIcon,
  RepeatIcon,
  SearchIcon,
  TreeIconSmall,
  TrendUpIcon,
} from "../components/icons";
import { clearContinuePlanning, readContinuePlanning, type ContinuePlanningDraft } from "../continuePlanning";
import { useGuest } from "../GuestContext";
import { haversineDistanceKm, nearestCounty } from "../irishCounties";
import { colors, fonts, maxWidth } from "../theme";
import type { Centre, Circle, Club, DiscoverFeed, DiscoverItem, LocalMomentumSignal, SearchResult } from "../types";

// Home's intent selector (IA spec §3) — reuses discover.ts's existing mood
// keyword filter (built for Free Time Mode) rather than a new taxonomy.
// "Explore" navigates straight to the Explore landing page since that IS
// the destination for "not sure, just browsing"; "Surprise me" calls the
// same endpoint with no mood filter and highlights whatever comes back.
const INTENT_CHIPS: { key: string; label: string; mood?: string }[] = [
  { key: "active", label: "Get active", mood: "active" },
  { key: "social", label: "Meet people", mood: "social" },
  { key: "chill", label: "Relax", mood: "chill" },
  { key: "explore", label: "Explore" },
  { key: "learn", label: "Learn", mood: "learn" },
  { key: "surprise", label: "Surprise me" },
];

// Shown only until real listing images load (or if a fresh dev DB genuinely
// has none for the current county) — same picsum seed the static hero image
// used before, so there's no visible flash of unrelated stock photography.
const FALLBACK_HERO_SLIDES: HeroCarouselSlide[] = [
  { src: "https://picsum.photos/seed/halla-hero/900/720", alt: "A community centre in Ireland" },
];

export function Home() {
  const navigate = useNavigate();
  const { resident } = useGuest();
  const [homeCounty, setHomeCounty] = useState("All");
  const [intent, setIntent] = useState<string | null>(null);
  const [intentResults, setIntentResults] = useState<DiscoverItem[] | null>(null);
  const [intentLoading, setIntentLoading] = useState(false);
  const [continuePlan, setContinuePlan] = useState<ContinuePlanningDraft | null>(null);
  const [myCircles, setMyCircles] = useState<Circle[]>([]);
  const [homeCategory, setHomeCategory] = useState<"centres" | "clubs">("centres");
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [featuredCentres, setFeaturedCentres] = useState<Centre[]>([]);
  const [loadingCentres, setLoadingCentres] = useState(true);
  const [featuredClubs, setFeaturedClubs] = useState<Club[]>([]);
  const [loadingClubs, setLoadingClubs] = useState(true);
  const [counties, setCounties] = useState<string[]>(["All"]);

  // Full (unsliced) county-scoped lists, captured alongside the 3-card
  // "featured" slices below — reused for the Near You distance sort so it
  // has a wider pool to choose from without a dedicated fetch.
  const [allCentres, setAllCentres] = useState<Centre[]>([]);
  const [allClubs, setAllClubs] = useState<Club[]>([]);

  // "Happening today" / "This weekend" (Phase 5) — games + program sessions
  // + recurring club sessions in one feed, see routes/discover.ts.
  const [discoverFeed, setDiscoverFeed] = useState<DiscoverFeed | null>(null);

  // Local Momentum (Phase 7) — "picking up near you," the positive-growth
  // counterpart to Trending. Empty in a fresh/quiet county, not an error —
  // it just means nothing's grown enough to say yet, so the strip hides.
  const [momentum, setMomentum] = useState<LocalMomentumSignal[]>([]);

  // "Next Best Participation" (implementation backlog #4) — proactive,
  // signed-in-resident-only (a guest gets nothing extra over the plain
  // Discover feed, since the two signals that make this distinct — Routines
  // and Circle membership — both require an identity).
  const [nextBest, setNextBest] = useState<DiscoverItem[]>([]);

  // Set only once real coordinates are resolved via handleUseMyLocation —
  // drives the Near You section, which otherwise stays hidden (no
  // server-side geocoding to fall back on, see CLAUDE.md).
  const [userCoords, setUserCoords] = useState<{ lat: number; lng: number } | null>(null);

  // Free-text "smart" search (Tier 1 — wires the rule-based /api/search
  // parser, previously built but never surfaced anywhere in the client).
  // Deliberately a separate, secondary affordance rather than reworking the
  // hero pill above — that pill's exact single-row layout was hand-tuned
  // across several commits and isn't worth risking for this.
  const [smartOpen, setSmartOpen] = useState(false);
  const [smartQuery, setSmartQuery] = useState("");
  const [smartResults, setSmartResults] = useState<SearchResult | null>(null);
  const [smartSearching, setSmartSearching] = useState(false);

  // County dropdown always reflects the full unfiltered set (same pattern as
  // Browse.tsx) so picking a county doesn't shrink the dropdown down to it.
  useEffect(() => {
    fetchCentres().then((centres) => {
      setCounties(["All", ...Array.from(new Set(centres.map((c) => c.county).filter(Boolean))).sort((a, b) => a.localeCompare(b))]);
    });
  }, []);

  // Featured centres/clubs follow whichever county is picked in the search bar —
  // not real popularity data, so the heading says "Explore"/"in {county}", never "Popular".
  useEffect(() => {
    setLoadingCentres(true);
    fetchCentres(homeCounty).then((centres) => {
      setAllCentres(centres);
      setFeaturedCentres(centres.slice(0, 3));
      setLoadingCentres(false);
    });
    setLoadingClubs(true);
    fetchClubs(homeCounty).then((clubs) => {
      setAllClubs(clubs);
      setFeaturedClubs(clubs.slice(0, 3));
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

  // "Next Best Participation" (implementation backlog #4).
  useEffect(() => {
    if (resident) fetchNextBestParticipation().then(setNextBest).catch(() => setNextBest([]));
    else setNextBest([]);
  }, [resident]);

  const pickIntent = async (chip: (typeof INTENT_CHIPS)[number]) => {
    if (chip.key === "explore") {
      navigate("/explore");
      return;
    }
    setIntent(chip.key);
    setIntentLoading(true);
    setIntentResults(null);
    try {
      const rows = await fetchFreeTimeOptions({ county: homeCounty === "All" ? undefined : homeCounty, mood: chip.key === "surprise" ? undefined : chip.mood });
      setIntentResults(chip.key === "surprise" && rows.length > 1 ? [rows[Math.floor(Math.random() * rows.length)]] : rows);
    } finally {
      setIntentLoading(false);
    }
  };

  // Closest centres/clubs to the resolved coordinates, from the pool already
  // fetched above — no dedicated fetch, just a client-side sort/slice.
  const nearYouItems = useMemo(() => {
    if (!userCoords) return [];
    const tagged: ({ kind: "centre"; listing: Centre } | { kind: "club"; listing: Club })[] = [
      ...allCentres.map((listing) => ({ kind: "centre" as const, listing })),
      ...allClubs.map((listing) => ({ kind: "club" as const, listing })),
    ];
    return tagged
      .filter((t) => t.listing.lat !== null && t.listing.lng !== null)
      .map((t) => ({ ...t, km: haversineDistanceKm(userCoords.lat, userCoords.lng, t.listing.lat!, t.listing.lng!) }))
      .sort((a, b) => a.km - b.km)
      .slice(0, 6);
  }, [userCoords, allCentres, allClubs]);

  // Hero carousel shows real photos from whatever's currently featured
  // (already fetched for the cards below) so it stays "related" to actual
  // listings instead of generic stock imagery — centres first, then clubs,
  // deduped by URL since seed data can reuse the same picsum photo.
  const heroSlides = useMemo(() => {
    const fromListing = (l: Centre | Club) => {
      const src = l.images[0] || l.image;
      return src ? { src, alt: `${l.name}, ${l.area}` } : null;
    };
    const slides = [...featuredCentres, ...featuredClubs]
      .map(fromListing)
      .filter((s): s is HeroCarouselSlide => s !== null);
    const deduped = Array.from(new Map(slides.map((s) => [s.src, s])).values());
    return deduped.length > 0 ? deduped : FALLBACK_HERO_SLIDES;
  }, [featuredCentres, featuredClubs]);

  const handleSearch = () => navigate(`/browse/${homeCategory}?county=${encodeURIComponent(homeCounty)}`);

  const handleSmartSearch = async () => {
    const q = smartQuery.trim();
    if (!q) return;
    setSmartSearching(true);
    try {
      setSmartResults(await search(q));
    } finally {
      setSmartSearching(false);
    }
  };

  const closeSmartSearch = () => {
    setSmartOpen(false);
    setSmartQuery("");
    setSmartResults(null);
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
      <section
        className="grid-responsive section-pad"
        style={{ maxWidth, margin: "0 auto", padding: "56px 24px 34px", display: "grid", gridTemplateColumns: "1.05fr 0.95fr", gap: 48, alignItems: "center" }}
      >
        <div>
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 7,
              background: "#EAF4EE",
              color: "#175f3b",
              borderRadius: 20,
              padding: "6px 13px 6px 10px",
              fontSize: 13,
              fontWeight: 600,
              marginBottom: 22,
            }}
          >
            <HandshakeIcon size={15} /> Community life across Ireland, in one place
          </div>
          <h1
            style={{
              fontFamily: fonts.display,
              fontWeight: 700,
              fontSize: "clamp(34px, 7vw, 56px)",
              lineHeight: 1.02,
              letterSpacing: "-.025em",
              margin: "0 0 18px",
            }}
          >
            Find a hall.
            <br />
            Join a club.
            <br />
            <span style={{ position: "relative", display: "inline-block" }}>
              <span style={{ color: colors.green }}>Feel at home.</span>
              <svg
                viewBox="0 0 220 14"
                style={{ position: "absolute", left: 0, bottom: -8, width: "100%", height: 12, color: colors.orange }}
                preserveAspectRatio="none"
              >
                <path d="M2 9 C 50 2, 170 2, 218 9" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
              </svg>
            </span>
          </h1>
          <p style={{ fontSize: 19, lineHeight: 1.5, color: colors.muted, margin: "0 0 30px", maxWidth: 560 }}>
            Book community centres for birthdays, meetings and functions — and enrol your kids in local sports clubs.
            Whether you've lived here for years or just arrived, everything local, in one tap.
          </p>

          <div
            className="stack-mobile hero-search-pill"
            style={{
              background: "#fff",
              border: `1px solid ${colors.border}`,
              borderRadius: 999,
              boxShadow: "0 8px 30px rgba(30,40,32,.06)",
              padding: 6,
              display: "flex",
              alignItems: "center",
              gap: 0,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 8px 8px 14px", flex: 1, minWidth: 0 }}>
              <PinIcon size={16} style={{ color: "#8A928B", flex: "none" }} />
              <select
                value={homeCounty}
                onChange={(e) => setHomeCounty(e.target.value)}
                aria-label="County"
                style={{
                  flex: 1,
                  minWidth: 92,
                  border: "none",
                  background: "transparent",
                  fontSize: 15,
                  color: colors.text,
                  outline: "none",
                  fontWeight: 600,
                }}
              >
                {counties.map((c) => (
                  <option key={c} value={c}>
                    {c === "All" ? "All counties" : c}
                  </option>
                ))}
              </select>
            </div>

            <div className="hide-mobile" style={{ width: 1, alignSelf: "stretch", background: colors.border, flex: "none" }} />

            <div style={{ display: "flex", gap: 2, padding: "6px 6px", flex: "none" }}>
              <button
                onClick={() => setHomeCategory("centres")}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "9px 12px",
                  borderRadius: 999,
                  border: "none",
                  cursor: "pointer",
                  fontSize: 14,
                  fontWeight: 700,
                  whiteSpace: "nowrap",
                  background: homeCategory === "centres" ? colors.greenBg : "transparent",
                  color: homeCategory === "centres" ? colors.greenText : colors.muted,
                }}
              >
                <BuildingIcon size={15} /> Centres
              </button>
              <button
                onClick={() => setHomeCategory("clubs")}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "9px 12px",
                  borderRadius: 999,
                  border: "none",
                  cursor: "pointer",
                  fontSize: 14,
                  fontWeight: 700,
                  whiteSpace: "nowrap",
                  background: homeCategory === "clubs" ? colors.orangeBg : "transparent",
                  color: homeCategory === "clubs" ? colors.orangeDark : colors.muted,
                }}
              >
                <BallIcon size={15} /> Clubs
              </button>
            </div>

            <button
              className="btn search-btn-overlap"
              onClick={handleSearch}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                flex: "none",
                background: homeCategory === "centres" ? colors.green : colors.orange,
                color: "#fff",
                border: "none",
                borderRadius: 999,
                padding: "16px 22px",
                fontSize: 15,
                fontWeight: 700,
                cursor: "pointer",
                boxShadow: homeCategory === "centres" ? "0 8px 20px rgba(30,122,76,.28)" : "0 8px 20px rgba(232,98,42,.28)",
              }}
            >
              Search <ArrowRightIcon size={15} />
            </button>
          </div>

          <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
            <button
              onClick={handleUseMyLocation}
              disabled={locating}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                background: "none",
                border: "none",
                color: colors.greenText,
                fontWeight: 700,
                fontSize: 14,
                cursor: locating ? "default" : "pointer",
                padding: 0,
              }}
            >
              <PinIcon size={14} /> {locating ? "Locating…" : "Use my current location"}
            </button>
            {locationError && <span style={{ color: colors.danger, fontSize: 13 }}>{locationError}</span>}
            <button
              onClick={() => (smartOpen ? closeSmartSearch() : setSmartOpen(true))}
              style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "none", border: "none", color: colors.muted, fontWeight: 700, fontSize: 14, cursor: "pointer", padding: 0 }}
            >
              <SearchIcon size={14} /> {smartOpen ? "Hide smart search" : "Or try a smart search"}
            </button>
          </div>

          {smartOpen && (
            <div className="pop-in" style={{ marginTop: 14, background: "#fff", border: `1px solid ${colors.border}`, borderRadius: 16, padding: 16 }}>
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  value={smartQuery}
                  onChange={(e) => setSmartQuery(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSmartSearch()}
                  placeholder="e.g. free badminton in Dublin this evening"
                  autoFocus
                  style={{ flex: 1, padding: "11px 13px", border: `1px solid ${colors.inputBorder}`, borderRadius: 11, fontSize: 14.5, outline: "none" }}
                />
                <button
                  onClick={handleSmartSearch}
                  disabled={smartSearching || !smartQuery.trim()}
                  style={{ flex: "none", background: colors.dark, color: "#fff", border: "none", borderRadius: 11, padding: "0 18px", fontWeight: 700, fontSize: 14, cursor: "pointer", opacity: smartSearching ? 0.6 : 1 }}
                >
                  {smartSearching ? "Searching…" : "Search"}
                </button>
                <button
                  onClick={closeSmartSearch}
                  aria-label="Close search"
                  style={{ flex: "none", background: "none", border: "none", color: colors.faint, cursor: "pointer", display: "flex", alignItems: "center" }}
                >
                  <CloseIcon size={16} />
                </button>
              </div>

              {smartResults && (
                <div style={{ marginTop: 16 }}>
                  {smartResults.parsed && (
                    <div style={{ fontSize: 12.5, color: colors.faint, marginBottom: 12 }}>
                      Understood as: {[smartResults.parsed.county, smartResults.parsed.free ? "free" : null, smartResults.parsed.timeOfDay, ...smartResults.parsed.keywords].filter(Boolean).join(" · ") || "no specific filters"}
                    </div>
                  )}
                  {smartResults.centres.length === 0 && smartResults.clubs.length === 0 && smartResults.activities.length === 0 ? (
                    <EmptyState icon={<SearchIcon size={18} />} title="Nothing matched" subtitle="Try a different phrasing, or broaden it — e.g. drop the county." />
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {smartResults.activities.map((a) => (
                        <button
                          key={`${a.kind}-${a.id}`}
                          onClick={() => navigate(a.href)}
                          style={{ textAlign: "left", background: colors.bg, border: `1px solid ${colors.border}`, borderRadius: 12, padding: "10px 14px", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center" }}
                        >
                          <span><strong>{a.title}</strong> <span style={{ color: colors.mutedLight, fontSize: 13 }}>· {a.date} {a.time}{a.centreName || a.clubName ? ` · ${a.centreName ?? a.clubName}` : ""}</span></span>
                          <span style={{ fontSize: 12, fontWeight: 700, color: "#3B5FCC", background: "#E9F0FC", borderRadius: 999, padding: "2px 9px", flex: "none", marginLeft: 8 }}>
                            {a.kind === "game" ? "Game" : a.kind === "program_session" ? "Program" : "Club session"}
                          </span>
                        </button>
                      ))}
                      {smartResults.centres.map((c) => (
                        <button
                          key={c.id}
                          onClick={() => navigate(`/centres/${c.slug ?? c.id}`)}
                          style={{ textAlign: "left", background: colors.bg, border: `1px solid ${colors.border}`, borderRadius: 12, padding: "10px 14px", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center" }}
                        >
                          <span><strong>{c.name}</strong> <span style={{ color: colors.mutedLight, fontSize: 13 }}>· {c.area}</span></span>
                          <span style={{ fontSize: 12, fontWeight: 700, color: colors.greenText, background: colors.greenBg, borderRadius: 999, padding: "2px 9px" }}>Centre</span>
                        </button>
                      ))}
                      {smartResults.clubs.map((c) => (
                        <button
                          key={c.id}
                          onClick={() => navigate(`/clubs/${c.slug ?? c.id}`)}
                          style={{ textAlign: "left", background: colors.bg, border: `1px solid ${colors.border}`, borderRadius: 12, padding: "10px 14px", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center" }}
                        >
                          <span><strong>{c.name}</strong> <span style={{ color: colors.mutedLight, fontSize: 13 }}>· {c.sport}</span></span>
                          <span style={{ fontSize: 12, fontWeight: 700, color: colors.orangeDark, background: colors.orangeBg, borderRadius: 999, padding: "2px 9px" }}>Club</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="hero-visual" style={{ position: "relative" }}>
          <div
            style={{
              position: "absolute",
              top: -30,
              right: -30,
              width: 210,
              height: 210,
              borderRadius: "50%",
              background: "radial-gradient(circle, rgba(30,122,76,.10), transparent 70%)",
              zIndex: 0,
            }}
          />
          <div
            style={{
              position: "absolute",
              bottom: -20,
              left: -24,
              width: 170,
              height: 170,
              borderRadius: "50%",
              background: "radial-gradient(circle, rgba(232,98,42,.09), transparent 70%)",
              zIndex: 0,
            }}
          />
          <div
            style={{
              position: "absolute",
              top: 10,
              right: 6,
              width: 120,
              height: 90,
              backgroundImage: `radial-gradient(${colors.borderStrong} 1.5px, transparent 1.5px)`,
              backgroundSize: "14px 14px",
              opacity: 0.6,
              zIndex: 0,
            }}
          />
          <div
            className="hero-photo"
            style={{
              position: "relative",
              zIndex: 1,
              height: 380,
              borderRadius: 24,
              overflow: "hidden",
              boxShadow: "0 24px 50px rgba(30,40,32,.16)",
              border: `1px solid ${colors.border}`,
            }}
          >
            <HeroCarousel slides={heroSlides} />
          </div>

          <div
            className="pop-in"
            style={{
              position: "absolute",
              left: 14,
              bottom: 66,
              zIndex: 2,
              width: 50,
              height: 50,
              borderRadius: "50%",
              background: colors.green,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 22,
              boxShadow: "0 10px 22px rgba(30,122,76,.35)",
              border: "3px solid #fff",
            }}
          >
            <HandshakeIcon size={22} style={{ color: "#fff" }} />
          </div>
          <div
            className="pop-in"
            style={{
              position: "absolute",
              left: 34,
              bottom: 18,
              zIndex: 2,
              background: "#fff",
              borderRadius: 14,
              padding: "12px 16px",
              boxShadow: "0 14px 30px rgba(30,40,32,.16)",
              display: "flex",
              alignItems: "center",
              gap: 9,
              maxWidth: 230,
            }}
          >
            <HeartIcon size={16} filled style={{ color: colors.green, flex: "none" }} />
            <span style={{ fontSize: 13, fontWeight: 700, lineHeight: 1.3 }}>Stronger communities start here.</span>
          </div>
        </div>
      </section>

      {/* Intent selector (IA spec §3) — "What would you like from today?" */}
      <section className="section-pad" style={{ maxWidth, margin: "0 auto", padding: "18px 24px 8px" }}>
        <h2 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 19, margin: "0 0 12px" }}>What would you like from today?</h2>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: intent ? 16 : 0 }}>
          {INTENT_CHIPS.map((chip) => (
            <button
              key={chip.key}
              onClick={() => pickIntent(chip)}
              style={{
                border: "none",
                borderRadius: 999,
                padding: "8px 16px",
                fontSize: 13.5,
                fontWeight: 700,
                cursor: "pointer",
                background: intent === chip.key ? colors.green : colors.panel,
                color: intent === chip.key ? "#fff" : colors.muted,
              }}
            >
              {chip.label}
            </button>
          ))}
        </div>
        {intent && (
          <div>
            {intentLoading ? (
              <div style={{ display: "flex", gap: 14, overflowX: "auto", paddingBottom: 6 }}>
                {Array.from({ length: 3 }).map((_, i) => (
                  <CardSkeleton key={i} />
                ))}
              </div>
            ) : intentResults && intentResults.length > 0 ? (
              <div style={{ display: "flex", gap: 14, overflowX: "auto", paddingBottom: 6 }}>
                {intentResults.map((item) => (
                  <DiscoverCard key={`${item.kind}-${item.id}`} item={item} isToday={item.date === new Date().toISOString().slice(0, 10)} />
                ))}
              </div>
            ) : (
              <EmptyState icon={<SearchIcon size={22} />} title="Nothing matching that just yet" subtitle="Try a different mood, widen your area, or explore what's around." />
            )}
          </div>
        )}
      </section>

      {/* "Next Best Participation" (implementation backlog #4) — proactive,
          blending Discover's own ranking with active Routines + Circle
          membership; no mood/duration input required. */}
      {resident && nextBest.length > 0 && (
        <section className="section-pad" style={{ maxWidth, margin: "0 auto", padding: "18px 24px 8px" }}>
          <h2 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 19, margin: "0 0 4px" }}>Next best for you</h2>
          <p style={{ fontSize: 13, color: colors.mutedLight, margin: "0 0 12px" }}>
            Ranked from what's on, your routines, and your Circles — no filters needed.
          </p>
          <div style={{ display: "flex", gap: 14, overflowX: "auto", paddingBottom: 6 }}>
            {nextBest.map((item) => (
              <DiscoverCard key={`${item.kind}-${item.id}`} item={item} isToday={item.date === new Date().toISOString().slice(0, 10)} />
            ))}
          </div>
        </section>
      )}

      {/* Continue Planning (IA spec §3) */}
      {continuePlan && (
        <section className="section-pad" style={{ maxWidth, margin: "0 auto", padding: "18px 24px 8px" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 16,
              background: colors.orangeBg,
              border: `1px solid ${colors.border}`,
              borderRadius: 16,
              padding: "16px 20px",
            }}
          >
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
              <button
                className="btn"
                onClick={() => navigate("/make-it-happen")}
                style={{ background: colors.orangeDark, color: "#fff", border: "none", borderRadius: 10, padding: "9px 16px", fontSize: 13.5, fontWeight: 700, cursor: "pointer" }}
              >
                Continue
              </button>
            </div>
          </div>
        </section>
      )}

      {/* Your Circles (IA spec §3) */}
      {resident && myCircles.length > 0 && (
        <section className="section-pad" style={{ maxWidth, margin: "0 auto", padding: "18px 24px 8px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <h2 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 19, margin: 0 }}>Your Circles</h2>
            <button onClick={() => navigate("/circles")} style={{ background: "none", border: "none", color: colors.greenText, fontWeight: 700, fontSize: 13.5, cursor: "pointer" }}>
              See all
            </button>
          </div>
          <div style={{ display: "flex", gap: 12, overflowX: "auto", paddingBottom: 6 }}>
            {myCircles.slice(0, 4).map((c) => (
              <button
                key={c.id}
                onClick={() => navigate(`/circles/${c.slug ?? c.id}`)}
                style={{
                  flex: "none",
                  width: 200,
                  textAlign: "left",
                  background: "#fff",
                  border: `1px solid ${colors.border}`,
                  borderRadius: 14,
                  padding: 14,
                  cursor: "pointer",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 6, color: colors.greenText, marginBottom: 6 }}>
                  <RepeatIcon size={14} />
                  <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".03em" }}>Circle</span>
                </div>
                <div style={{ fontWeight: 700, fontSize: 14.5 }}>{c.name}</div>
                <div style={{ fontSize: 12.5, color: colors.mutedLight, marginTop: 2 }}>{c.members} member{c.members === 1 ? "" : "s"}</div>
              </button>
            ))}
          </div>
        </section>
      )}

      {discoverFeed && discoverFeed.today.length > 0 && (
        <section className="section-pad" style={{ maxWidth, margin: "0 auto", padding: "18px 24px 8px" }}>
          <DiscoverRow title="Happening today" items={discoverFeed.today} isToday />
        </section>
      )}

      {discoverFeed && discoverFeed.weekend.length > 0 && (
        <section className="section-pad" style={{ maxWidth, margin: "0 auto", padding: "18px 24px 8px" }}>
          <DiscoverRow title="This weekend" items={discoverFeed.weekend} />
        </section>
      )}

      {/* No-local-inventory empty state (IA spec §3) — a real recovery
          decision, not a dead end, shown only once the feed has actually
          loaded and come back with nothing at all. */}
      {discoverFeed && discoverFeed.today.length === 0 && discoverFeed.weekend.length === 0 && (
        <section className="section-pad" style={{ maxWidth, margin: "0 auto", padding: "18px 24px 8px" }}>
          <div style={{ background: colors.panel, borderRadius: 16, padding: "22px 24px" }}>
            <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>Nothing scheduled near you just yet</div>
            <p style={{ fontSize: 13.5, color: colors.mutedLight, margin: "0 0 14px" }}>Here's what usually helps:</p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              <button onClick={() => setHomeCounty("All")} style={{ background: "#fff", border: `1px solid ${colors.border}`, borderRadius: 999, padding: "8px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                Widen to all counties
              </button>
              <button onClick={() => navigate("/browse/centres")} style={{ background: "#fff", border: `1px solid ${colors.border}`, borderRadius: 999, padding: "8px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                View places
              </button>
              <button onClick={() => navigate("/games")} style={{ background: "#fff", border: `1px solid ${colors.border}`, borderRadius: 999, padding: "8px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                Start an activity
              </button>
              <button onClick={() => navigate("/make-it-happen")} style={{ background: "#fff", border: `1px solid ${colors.border}`, borderRadius: 999, padding: "8px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                Make it happen
              </button>
            </div>
          </div>
        </section>
      )}

      {/* Make It Happen CTA (UI/UX plan phase 4) — previously only reachable
          via a menu row inside the Explore dropdown, the same visual weight
          as "Sports clubs," despite being arguably the single most
          distinctive thing this product does (find a venue, price it, and
          recruit a group — nothing else in this space does that). Reuses
          the same icon-circle + heading + button band this page already
          established for the "List your venue" vendor CTA further down. */}
      <section className="section-pad" style={{ maxWidth, margin: "0 auto", padding: "18px 24px 8px" }}>
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 20,
            background: colors.orangeBg,
            border: `1px solid ${colors.border}`,
            borderRadius: 20,
            padding: "24px 28px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <div
              style={{
                width: 48,
                height: 48,
                borderRadius: "50%",
                background: colors.surface,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flex: "none",
                color: colors.orangeDark,
              }}
            >
              <HandshakeIcon size={22} />
            </div>
            <div>
              <h3 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 19, margin: "0 0 4px" }}>
                Nothing planned? Make it happen.
              </h3>
              <p style={{ margin: 0, color: colors.muted, fontSize: 14.5 }}>
                Tell us the activity, time and budget — we'll find a venue and start recruiting your group.
              </p>
            </div>
          </div>
          <button
            className="btn"
            onClick={() => navigate("/make-it-happen")}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              background: colors.orangeDark,
              color: "#fff",
              border: "none",
              borderRadius: 12,
              padding: "13px 20px",
              fontSize: 15,
              fontWeight: 600,
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            <HandshakeIcon size={16} /> Make It Happen <ArrowRightIcon size={15} />
          </button>
        </div>
      </section>

      {/* Adventures / Experiences teasers — two separate destinations
          (own nav entries, own URLs, own browse pages) rather than one
          combined CTA, since they're now distinct places to go, not one
          feature with a filter. Same icon-circle visual language as the
          Make It Happen CTA above, tinted green, split into a 2-up grid
          instead of one wide band. */}
      <section className="section-pad" style={{ maxWidth, margin: "0 auto", padding: "18px 24px 8px" }}>
        <div className="grid-responsive" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          {[
            { to: "/adventures", title: "Adventures", subtitle: "Guided hikes, kayaking and outdoor trips.", },
            { to: "/experiences", title: "Experiences", subtitle: "Workshops, classes and one-off outings.", },
          ].map((t) => (
            <button
              key={t.to}
              className="btn"
              onClick={() => navigate(t.to)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 16,
                background: colors.greenBg,
                border: `1px solid ${colors.border}`,
                borderRadius: 20,
                padding: "20px 22px",
                cursor: "pointer",
                textAlign: "left",
              }}
            >
              <div
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: "50%",
                  background: colors.surface,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flex: "none",
                  color: colors.greenText,
                }}
              >
                <TreeIconSmall size={20} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <h3 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 17, margin: "0 0 2px" }}>{t.title}</h3>
                <p style={{ margin: 0, color: colors.muted, fontSize: 13.5 }}>{t.subtitle}</p>
              </div>
              <ArrowRightIcon size={16} style={{ color: colors.greenText, flex: "none" }} />
            </button>
          ))}
        </div>
      </section>

      {momentum.length > 0 && (
        <section className="section-pad" style={{ maxWidth, margin: "0 auto", padding: "18px 24px 8px" }}>
          <h2 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 20, margin: "0 0 14px", letterSpacing: "-.01em" }}>
            Picking up near you
          </h2>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
            {momentum.map((m) => (
              <div
                key={`${m.label}-${m.county}`}
                style={{
                  display: "flex", alignItems: "center", gap: 8,
                  background: colors.greenBg, border: `1px solid ${colors.green}`, borderRadius: 999,
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
        </section>
      )}

      {nearYouItems.length > 0 && (
        <section className="section-pad" style={{ maxWidth, margin: "0 auto", padding: "18px 24px 8px" }}>
          <h2 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 20, margin: "0 0 14px", letterSpacing: "-.01em" }}>Near you</h2>
          <div className="grid-responsive-3" style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 20 }}>
            {nearYouItems.map((t) => (
              <div key={`${t.kind}-${t.listing.id}`}>
                <div style={{ position: "relative" }}>
                  {t.kind === "centre" ? <CentreCard centre={t.listing} height={132} /> : <ClubCard club={t.listing} />}
                  <span
                    style={{
                      position: "absolute",
                      top: 10,
                      left: 10,
                      zIndex: 1,
                      background: "rgba(255,255,255,.92)",
                      borderRadius: 999,
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
        </section>
      )}

      <section className="section-pad" style={{ maxWidth, margin: "0 auto", padding: "26px 24px 10px" }}>
        <div className="grid-responsive" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
          <div
            onClick={() => navigate("/browse/centres")}
            className="card-hover card-surface"
            style={{
              cursor: "pointer",
              position: "relative",
              overflow: "hidden",
              borderRadius: 20,
              border: `1px solid ${colors.border}`,
              background: "#F1F5F0",
              padding: 30,
              minHeight: 220,
              display: "flex",
              flexDirection: "column",
              justifyContent: "space-between",
            }}
          >
            <div style={{ position: "absolute", top: -34, right: -28, width: 190, height: 190, borderRadius: "50%", background: colors.greenBg }} />
            <div style={{ position: "absolute", top: 14, right: -6, width: 210, height: 138 }}>
              <CommunityIllustration />
            </div>
            <div style={{ position: "relative", maxWidth: "min(230px, 68%)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 7, fontFamily: "monospace", fontSize: 11, letterSpacing: ".08em", color: "#5E8C6E", marginBottom: 10 }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: colors.green, display: "inline-block" }} />
                01 · SPACES
              </div>
              <h3 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 27, margin: "0 0 6px", letterSpacing: "-.02em" }}>
                Community centres
              </h3>
              <p style={{ margin: "0 0 16px", color: colors.muted, fontSize: 15 }}>
                Halls and meeting spaces to hire by the hour.
              </p>
            </div>
            <span className="link-accent" style={{ position: "relative", display: "inline-flex", alignItems: "center", gap: 6, color: colors.greenText, fontWeight: 700, fontSize: 14 }}>
              Explore spaces <ArrowRightIcon size={15} />
            </span>
          </div>

          <div
            onClick={() => navigate("/browse/clubs")}
            className="card-hover card-surface"
            style={{
              cursor: "pointer",
              position: "relative",
              overflow: "hidden",
              borderRadius: 20,
              border: `1px solid ${colors.border}`,
              background: "#FBF0E9",
              padding: 30,
              minHeight: 220,
              display: "flex",
              flexDirection: "column",
              justifyContent: "space-between",
            }}
          >
            <div style={{ position: "absolute", top: -34, right: -28, width: 190, height: 190, borderRadius: "50%", background: colors.orangeBg }} />
            {/* Unlike CommunityIllustration, this one's soccer ball/basketball
                cluster sits low and close to the left edge of its box, which
                collides with the "Sports clubs" heading once the text column
                widens relative to the fixed-size illustration on narrow
                phones (confirmed broken <=375px, clean >=480px) — simplest
                fix is to not show it below the .hide-mobile breakpoint. */}
            <div className="hide-mobile" style={{ position: "absolute", top: 14, right: -6, width: 210, height: 138 }}>
              <SportsIllustration />
            </div>
            <div style={{ position: "relative", maxWidth: "min(230px, 68%)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 7, fontFamily: "monospace", fontSize: 11, letterSpacing: ".08em", color: "#C08A66", marginBottom: 10 }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: colors.orange, display: "inline-block" }} />
                02 · CLUBS
              </div>
              <h3 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 27, margin: "0 0 6px", letterSpacing: "-.02em" }}>
                Sports clubs
              </h3>
              <p style={{ margin: "0 0 16px", color: colors.muted, fontSize: 15 }}>
                GAA, soccer, swimming, rugby & more — from age 4 up.
              </p>
            </div>
            <span className="link-accent" style={{ position: "relative", display: "inline-flex", alignItems: "center", gap: 6, color: colors.orangeDark, fontWeight: 700, fontSize: 14 }}>
              Explore clubs <ArrowRightIcon size={15} />
            </span>
          </div>
        </div>
      </section>

      <section className="section-pad" style={{ maxWidth, margin: "0 auto", padding: "34px 24px 8px" }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 18, flexWrap: "wrap", gap: 10 }}>
          <h2 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 24, margin: 0, letterSpacing: "-.02em" }}>
            {homeCounty === "All" ? "Explore community centres" : `Community centres in ${homeCounty}`}
          </h2>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <button
              onClick={() => navigate(`/browse/centres?county=${encodeURIComponent(homeCounty)}`)}
              style={{ background: "none", border: "none", display: "inline-flex", alignItems: "center", gap: 6, color: colors.green, fontWeight: 600, fontSize: 15, cursor: "pointer" }}
            >
              View all <ArrowRightIcon size={15} />
            </button>
            <button
              className="btn btn-ghost"
              onClick={() => navigate(`/browse/centres?county=${encodeURIComponent(homeCounty)}`)}
              aria-label="See more community centres"
              style={{
                width: 34,
                height: 34,
                borderRadius: "50%",
                background: "#fff",
                border: `1px solid ${colors.borderStrong}`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: colors.text,
              }}
            >
              <ChevronRightIcon size={16} />
            </button>
          </div>
        </div>
        {!loadingCentres && featuredCentres.length === 0 ? (
          <p style={{ color: colors.muted, fontSize: 15 }}>No halls listed in {homeCounty} yet — try another county.</p>
        ) : (
          <div className="grid-responsive-3" style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 20 }}>
            {loadingCentres
              ? Array.from({ length: 3 }, (_, i) => <CardSkeleton key={i} photoHeight={132} />)
              : featuredCentres.map((c) => <CentreCard key={c.id} centre={c} height={132} />)}
          </div>
        )}
      </section>

      <section className="section-pad" style={{ maxWidth, margin: "0 auto", padding: "34px 24px 8px" }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 18, flexWrap: "wrap", gap: 10 }}>
          <h2 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 24, margin: 0, letterSpacing: "-.02em" }}>
            {homeCounty === "All" ? "Explore sports clubs" : `Sports clubs in ${homeCounty}`}
          </h2>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <button
              onClick={() => navigate(`/browse/clubs?county=${encodeURIComponent(homeCounty)}`)}
              style={{ background: "none", border: "none", display: "inline-flex", alignItems: "center", gap: 6, color: colors.orangeDark, fontWeight: 600, fontSize: 15, cursor: "pointer" }}
            >
              View all <ArrowRightIcon size={15} />
            </button>
            <button
              className="btn btn-ghost"
              onClick={() => navigate(`/browse/clubs?county=${encodeURIComponent(homeCounty)}`)}
              aria-label="See more sports clubs"
              style={{
                width: 34,
                height: 34,
                borderRadius: "50%",
                background: "#fff",
                border: `1px solid ${colors.borderStrong}`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: colors.text,
              }}
            >
              <ChevronRightIcon size={16} />
            </button>
          </div>
        </div>
        {!loadingClubs && featuredClubs.length === 0 ? (
          <p style={{ color: colors.muted, fontSize: 15 }}>No clubs listed in {homeCounty} yet — try another county.</p>
        ) : (
          <div className="grid-responsive-3" style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 20 }}>
            {loadingClubs
              ? Array.from({ length: 3 }, (_, i) => <CardSkeleton key={i} photoHeight={120} />)
              : featuredClubs.map((c) => <ClubCard key={c.id} club={c} />)}
          </div>
        )}
      </section>

      <section className="section-pad" style={{ maxWidth, margin: "0 auto", padding: "40px 24px 56px" }}>
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 20,
            background: colors.orangeBg,
            border: `1px solid ${colors.border}`,
            borderRadius: 20,
            padding: "28px 32px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <div
              style={{
                width: 48,
                height: 48,
                borderRadius: "50%",
                background: colors.surface,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flex: "none",
                color: colors.orangeDark,
              }}
            >
              <HandshakeIcon size={22} />
            </div>
            <div>
              <h3 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 19, margin: "0 0 4px" }}>
                Run a community centre or sports club?
              </h3>
              <p style={{ margin: 0, color: colors.muted, fontSize: 14.5 }}>
                List it on Hello Circle for free and reach families across Ireland.
              </p>
            </div>
          </div>
          <button
            className="btn"
            onClick={() => navigate("/vendor/signup")}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              background: colors.orangeDark,
              color: "#fff",
              border: "none",
              borderRadius: 12,
              padding: "13px 20px",
              fontSize: 15,
              fontWeight: 600,
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            <BuildingIcon size={16} /> List your venue <ArrowRightIcon size={15} />
          </button>
        </div>
      </section>
    </div>
  );
}
