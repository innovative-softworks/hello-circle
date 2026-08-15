import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { fetchCentres, fetchClubs } from "../api";
import { CentreCard } from "../components/CentreCard";
import { ClubCard } from "../components/ClubCard";
import { CardSkeleton } from "../components/ui";
import { CommunityIllustration, SportsIllustration } from "../components/illustrations";
import {
  ArrowRightIcon,
  BallIcon,
  BuildingIcon,
  ChevronRightIcon,
  HandshakeIcon,
  HeartIcon,
  PinIcon,
} from "../components/icons";
import { nearestCounty } from "../irishCounties";
import { colors, fonts, maxWidth } from "../theme";
import type { Centre, Club } from "../types";

export function Home() {
  const navigate = useNavigate();
  const [homeCounty, setHomeCounty] = useState("All");
  const [homeCategory, setHomeCategory] = useState<"centres" | "clubs">("centres");
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [featuredCentres, setFeaturedCentres] = useState<Centre[]>([]);
  const [loadingCentres, setLoadingCentres] = useState(true);
  const [featuredClubs, setFeaturedClubs] = useState<Club[]>([]);
  const [loadingClubs, setLoadingClubs] = useState(true);
  const [counties, setCounties] = useState<string[]>(["All"]);

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
      setFeaturedCentres(centres.slice(0, 3));
      setLoadingCentres(false);
    });
    setLoadingClubs(true);
    fetchClubs(homeCounty).then((clubs) => {
      setFeaturedClubs(clubs.slice(0, 3));
      setLoadingClubs(false);
    });
  }, [homeCounty]);

  const handleSearch = () => navigate(`/browse/${homeCategory}?county=${encodeURIComponent(homeCounty)}`);

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
            style={{
              background: "#fff",
              border: `1px solid ${colors.border}`,
              borderRadius: 18,
              boxShadow: "0 8px 30px rgba(30,40,32,.06)",
              padding: 14,
              display: "flex",
              flexDirection: "column",
              gap: 10,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "2px 6px", borderBottom: `1px solid ${colors.border}`, paddingBottom: 12 }}>
              <PinIcon size={16} style={{ color: "#8A928B", flex: "none" }} />
              <select
                value={homeCounty}
                onChange={(e) => setHomeCounty(e.target.value)}
                aria-label="County"
                style={{
                  flex: 1,
                  minWidth: 0,
                  padding: "6px 4px",
                  border: "none",
                  background: "transparent",
                  fontSize: 16,
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

            <div className="stack-mobile" style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
              <div style={{ display: "flex", gap: 4, background: colors.bg, borderRadius: 12, padding: 4, flex: "none" }}>
                <button
                  onClick={() => setHomeCategory("centres")}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "9px 14px",
                    borderRadius: 9,
                    border: "none",
                    cursor: "pointer",
                    fontSize: 14,
                    fontWeight: 700,
                    background: homeCategory === "centres" ? colors.greenBg : "transparent",
                    color: homeCategory === "centres" ? colors.greenText : colors.muted,
                  }}
                >
                  <BuildingIcon size={15} /> Community centres
                </button>
                <button
                  onClick={() => setHomeCategory("clubs")}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "9px 14px",
                    borderRadius: 9,
                    border: "none",
                    cursor: "pointer",
                    fontSize: 14,
                    fontWeight: 700,
                    background: homeCategory === "clubs" ? colors.orangeBg : "transparent",
                    color: homeCategory === "clubs" ? colors.orangeDark : colors.muted,
                  }}
                >
                  <BallIcon size={15} /> Sports clubs
                </button>
              </div>
              <button
                className="btn btn-primary"
                onClick={handleSearch}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  marginLeft: "auto",
                  background: homeCategory === "centres" ? colors.green : colors.orange,
                  color: "#fff",
                  border: "none",
                  borderRadius: 12,
                  padding: "13px 20px",
                  fontSize: 15,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Search <ArrowRightIcon size={15} />
              </button>
            </div>
          </div>

          <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
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
            {locationError && <span style={{ color: "#b00020", fontSize: 13 }}>{locationError}</span>}
          </div>
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
            <img
              src="https://picsum.photos/seed/halla-hero/900/720"
              alt="A community centre in Ireland"
              style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
            />
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
                background: "#fff",
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
