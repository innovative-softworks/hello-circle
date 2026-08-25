import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { fetchDiscover, fetchResidentFull } from "../api";
import { DiscoverRow } from "../components/DiscoverRow";
import { BallIcon, BuildingIcon, CalendarIcon, PinIcon, RepeatIcon, TreeIconSmall } from "../components/icons";
import { PageTitle } from "../components/PageTitle";
import { CardSkeleton } from "../components/ui";
import { useGuest } from "../GuestContext";
import { colors, fonts, maxWidth } from "../theme";
import type { DiscoverFeed } from "../types";

// Discovery-radius filtering (master-prompt punch list #2) — the field
// itself (residents.search_radius_km) has existed since onboarding but was
// never read back into any query; this is that wiring, surfaced as a real
// selector rather than a silent default. "Any distance" (0) means no
// filtering at all — the same nationwide/by-county feed as before this
// existed.
const RADIUS_OPTIONS = [0, 5, 10, 25, 50];

// Explore landing page (IA spec §4) — aggregates this app's real inventory
// into one destination instead of only living behind the header's dropdown.
// Deliberately does NOT invent an "Events" category the way the spec's own
// taxonomy does — this app's real inventory is Centres/Clubs/Games/
// Adventures/Experiences/Circles (see [[experiences-adventures-feature]]),
// and adding a category with no backing data would be a fake destination,
// not a real one.

const CATEGORIES = [
  { key: "centres", label: "Community centres", desc: "Halls, pitches and rooms you can hire.", icon: <BuildingIcon size={20} />, to: "/browse/centres" },
  { key: "clubs", label: "Sports clubs", desc: "Join a club, register for a season.", icon: <BallIcon size={20} />, to: "/browse/clubs" },
  { key: "games", label: "Open games", desc: "Join people who are already playing.", icon: <RepeatIcon size={20} />, to: "/games" },
  { key: "adventures", label: "Adventures", desc: "Guided hikes, kayaking and outdoor trips.", icon: <TreeIconSmall size={20} />, to: "/adventures" },
  { key: "experiences", label: "Experiences", desc: "Workshops, classes and one-off outings.", icon: <TreeIconSmall size={20} />, to: "/experiences" },
  { key: "circles", label: "Circles", desc: "Recurring groups built around shared activity.", icon: <CalendarIcon size={20} />, to: "/circles" },
];

export function Explore() {
  const navigate = useNavigate();
  const { resident } = useGuest();
  const [feed, setFeed] = useState<DiscoverFeed | null>(null);
  const [radiusKm, setRadiusKm] = useState(0);

  // Pre-fill from the resident's own onboarding preference, once, rather
  // than defaulting to "Any distance" for someone who already told us they
  // want a bounded search.
  useEffect(() => {
    if (resident) fetchResidentFull().then(({ resident: r }) => r && setRadiusKm(r.searchRadiusKm || 0));
  }, [resident]);

  useEffect(() => {
    setFeed(null);
    fetchDiscover(undefined, radiusKm || undefined)
      .then(setFeed)
      .catch(() => setFeed({ today: [], weekend: [] }));
  }, [radiusKm]);

  return (
    <div className="fade-panel">
      <section className="section-pad" style={{ maxWidth, margin: "0 auto", padding: "36px 24px 90px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, marginBottom: 8 }}>
          <PageTitle style={{ margin: 0 }}>Explore</PageTitle>
          <button onClick={() => navigate("/compare")} style={{ background: "none", border: `1px solid ${colors.border}`, borderRadius: 999, padding: "8px 16px", fontSize: 13, fontWeight: 700, color: colors.muted, cursor: "pointer", flex: "none" }}>
            Compare places
          </button>
        </div>
        <p style={{ color: colors.mutedLight, fontSize: 15, margin: "0 0 20px" }}>Browse what's out there — Home is for personalized picks, this is for looking around.</p>

        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 28 }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12.5, color: colors.mutedLight, fontWeight: 700 }}>
            <PinIcon size={13} /> Within
          </span>
          {RADIUS_OPTIONS.map((km) => (
            <button
              key={km}
              onClick={() => setRadiusKm(km)}
              style={{
                border: "none", borderRadius: 999, padding: "6px 14px", fontSize: 12.5, fontWeight: 700, cursor: "pointer",
                background: radiusKm === km ? colors.green : colors.panel, color: radiusKm === km ? "#fff" : colors.muted,
              }}
            >
              {km === 0 ? "Any distance" : `${km}km`}
            </button>
          ))}
        </div>

        <div className="grid-responsive" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 14, marginBottom: 36 }}>
          {CATEGORIES.map((c) => (
            <button
              key={c.key}
              onClick={() => navigate(c.to)}
              style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 10, textAlign: "left", background: "#fff", border: `1px solid ${colors.border}`, borderRadius: 16, padding: 18, cursor: "pointer" }}
            >
              <div style={{ width: 40, height: 40, borderRadius: "50%", background: colors.greenBg, color: colors.greenText, display: "flex", alignItems: "center", justifyContent: "center" }}>{c.icon}</div>
              <div style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 16 }}>{c.label}</div>
              <div style={{ fontSize: 12.5, color: colors.mutedLight }}>{c.desc}</div>
            </button>
          ))}
        </div>

        {feed === null ? (
          <div style={{ display: "flex", gap: 14, overflowX: "auto" }}>
            {Array.from({ length: 3 }).map((_, i) => (
              <CardSkeleton key={i} />
            ))}
          </div>
        ) : feed.today.length === 0 && feed.weekend.length === 0 && radiusKm > 0 ? (
          <div style={{ background: colors.panel, borderRadius: 16, padding: "24px", textAlign: "center" }}>
            <p style={{ fontSize: 14.5, color: colors.muted, margin: "0 0 12px" }}>
              Nothing within {radiusKm}km right now.
            </p>
            <button
              onClick={() => setRadiusKm(RADIUS_OPTIONS[Math.min(RADIUS_OPTIONS.indexOf(radiusKm) + 1, RADIUS_OPTIONS.length - 1)])}
              style={{ background: colors.green, color: "#fff", border: "none", borderRadius: 999, padding: "9px 18px", fontSize: 13.5, fontWeight: 700, cursor: "pointer" }}
            >
              Widen to {RADIUS_OPTIONS[Math.min(RADIUS_OPTIONS.indexOf(radiusKm) + 1, RADIUS_OPTIONS.length - 1)] || "any distance"}
              {RADIUS_OPTIONS[Math.min(RADIUS_OPTIONS.indexOf(radiusKm) + 1, RADIUS_OPTIONS.length - 1)] ? "km" : ""}
            </button>
          </div>
        ) : (
          <>
            {feed.today.length > 0 && <DiscoverRow title="Happening today" items={feed.today} isToday />}
            {feed.weekend.length > 0 && <DiscoverRow title="This weekend" items={feed.weekend} />}
          </>
        )}
      </section>
    </div>
  );
}
