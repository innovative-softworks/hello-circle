import { useState } from "react";
import { Link } from "react-router-dom";
import { joinLaunchWaitlist } from "../api/public";
import { ApiError } from "../api/core";
import { AppleIcon, BallIcon, BuildingIcon, CheckCircleIcon, ChevronDownIcon, GoogleIcon, MailIcon, MoonIcon, PinIcon, RepeatIcon, SunIcon, TreeIconSmall } from "../components/icons";
import { IRISH_COUNTY_COORDS } from "../irishCounties";
import { cardImageRatio, colors } from "../theme";
import { useTheme } from "../ThemeContext";
import { lc, lcFonts, lcMaxWidth } from "../landing/theme";
import { placeholderImage } from "../placeholderImage";
import { FV_ACCENT, FV_ACCENT_DARK, FV_MONO } from "../components/forVenues/constants";
import "../landing/landing.css";

// Brand accent + mono utility-strip treatment deliberately match
// /for-venues (FV_ACCENT etc., imported directly from its own constants
// rather than re-declared here) — per the explicit ask for this page to
// share that page's Swiss-editorial language: a single vivid accent, a
// small monospace utility strip, and "/ label" slash eyebrows instead of
// centered marketing-page headers.
const ACCENT_TINT = "rgba(255, 74, 31, 0.12)";

// Same visual system as the standalone marketing page (landing/LandingPage.tsx)
// — lc.* tokens, the lc-btn/lc-card/lc-chip/lc-hero-collage classes from
// landing.css, SectionHeader — so this reads as cut from the same design
// system rather than a one-off page, per the explicit ask to match its style.
// Deliberately does NOT reuse LandingHeader/LandingFooter as-is: both link
// out to Explore/Games/Circles/vendor pages that aren't meant to be
// discoverable yet on a pre-launch splash.
//
// 2026-09-14 redesign: swapped the placeholder "H" square for the real
// /illustrations/Logo.svg mark (same file Header.tsx uses everywhere else in
// the app, so this reads as HelloCircle rather than a generic splash), added
// a listing-type chip row (the three real listing types the product
// actually has — centres/clubs/adventures, not invented categories) and an
// honest "also coming to iOS and Android" strip (the mobile app genuinely
// exists in apps/mobile — these are not functioning store links, since
// neither app is published yet).

const img = (seed: string, w = 900, h = 700) => placeholderImage(seed, w, h);
const COUNTIES = Object.keys(IRISH_COUNTY_COORDS);

// Rollout order: Dublin is the one seeded launch market (see
// server/src/db/seed.ts) — Kildare, Galway, Limerick, and Waterford are
// genuine "next" claims, not filler, which is why this renders as a
// numbered sequence.
const ROLLOUT = [
  { city: "Dublin", status: "live" as const },
  { city: "Kildare", status: "soon" as const },
  { city: "Galway", status: "soon" as const },
  { city: "Limerick", status: "soon" as const },
  { city: "Waterford", status: "soon" as const },
];

// The product's actual three listing types (see CLAUDE.md's "Who uses
// this" / Adventures & Experiences section) — not a made-up category list.
const LISTING_TYPES = [
  { icon: BuildingIcon, label: "Community centres" },
  { icon: BallIcon, label: "Sports clubs" },
  { icon: TreeIconSmall, label: "Adventures & Experiences" },
];

const FEATURES = [
  { icon: BuildingIcon, title: "Book a hall or room", text: "Real-time availability at your local community centre, no phone calls needed." },
  { icon: BallIcon, title: "Join a club or session", text: "Register for a class, or find a pickup session happening near you tonight." },
  { icon: RepeatIcon, title: "Start a Circle", text: "Turn a one-off activity into a standing group that meets on its own schedule." },
];

export function ComingSoon() {
  const { resolvedTheme, setTheme } = useTheme();
  const [email, setEmail] = useState("");
  const [county, setCounty] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setStatus("error");
      setError("Enter a valid email address");
      return;
    }
    setStatus("loading");
    setError("");
    try {
      await joinLaunchWaitlist({ email: trimmed, county: county || undefined });
      setStatus("success");
    } catch (e) {
      setStatus("error");
      setError(e instanceof ApiError ? e.message : "Something went wrong, try again");
    }
  }

  function scrollToForm() {
    document.getElementById("waitlist-form")?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  return (
    <div className="lc-page" style={{ background: lc.paper, color: lc.ink }}>
      {/* Header — real brand mark, linked home; otherwise no live nav
          (nothing else to send people to yet). */}
      <header className="lc-header" style={{ background: colors.headerBg, backdropFilter: "blur(12px)", borderBottom: `1px solid ${lc.line}` }}>
        <div style={{ maxWidth: lcMaxWidth, margin: "0 auto", padding: "16px 24px 0" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
            <Link to="/" aria-label="HelloCircle home" style={{ display: "flex", flex: "none" }}>
              <img src="/illustrations/Logo.svg" alt="Hello Circle" style={{ height: 44 }} />
            </Link>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span className="lc-chip" style={{ background: ACCENT_TINT, color: FV_ACCENT_DARK, fontWeight: 800, fontSize: 15, padding: "9px 18px" }}>
                Coming soon
              </span>
              <button
                onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
                aria-label={resolvedTheme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
                title={resolvedTheme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 38,
                  height: 38,
                  borderRadius: "50%",
                  border: `1px solid ${lc.line}`,
                  background: lc.paperRaised,
                  color: lc.ink,
                  flex: "none",
                }}
              >
                {resolvedTheme === "dark" ? <SunIcon size={17} /> : <MoonIcon size={17} />}
              </button>
            </div>
          </div>

          {/* Mono utility strip — the same "technical label" device
              /for-venues' VendorHero opens with, before the page settles
              into its normal editorial rhythm. */}
          <div
            className="lc-stack-mobile"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              fontFamily: FV_MONO,
              fontSize: 11.5,
              letterSpacing: "0.04em",
              color: lc.inkSoft,
              padding: "16px 0",
              marginTop: 16,
            }}
          >
            <span>LAUNCHING · IRELAND</span>
            <button onClick={scrollToForm} style={{ background: "none", border: "none", padding: 0, color: lc.ink, fontWeight: 700, fontFamily: "inherit", fontSize: "inherit" }}>
              JOIN WAITLIST ↓
            </button>
          </div>
        </div>
      </header>

      {/* Hero — same two-column proportion as VendorHero.tsx (1.1fr/0.8fr,
          bottom-aligned): headline+subtext left, the waitlist form right,
          so the full width does real work instead of leaving the right
          side empty above the full-bleed photo below. */}
      <section className="lc-section" style={{ maxWidth: lcMaxWidth, margin: "0 auto", padding: "28px 24px 40px" }}>
        <div className="lc-stack-mobile" style={{ display: "grid", gridTemplateColumns: "1.1fr 0.8fr", gap: 48, alignItems: "end" }}>
          <div className="lc-fade-up">
            <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.09em", textTransform: "uppercase", color: FV_ACCENT, marginBottom: 14 }}>
              <span aria-hidden="true">/</span> Launching soon
            </div>
            <h1 style={{ fontSize: "clamp(42px, 5vw, 64px)", lineHeight: 1.05, fontWeight: 800, color: lc.ink }}>
              Your town is about to get a lot more <span style={{ color: FV_ACCENT }}>interesting.</span>
            </h1>
            <p style={{ fontSize: 17.5, lineHeight: 1.6, color: lc.inkSoft, marginTop: 22, maxWidth: 460 }}>
              One place to book a hall, join a club, catch a pickup game, or start a recurring Circle across Ireland.
            </p>
          </div>

          <div id="waitlist-form">
            {status === "success" ? (
              <div className="lc-card" style={{ background: lc.paperRaised, border: `1px solid ${lc.line}`, borderRadius: 20, padding: "22px 24px", display: "flex", gap: 14, alignItems: "flex-start" }}>
                <CheckCircleIcon size={22} style={{ color: FV_ACCENT, flex: "none", marginTop: 1 }} />
                <div>
                  <h3 style={{ fontFamily: lcFonts.display, fontSize: 17, fontWeight: 700 }}>You&rsquo;re on the list</h3>
                  <p style={{ fontSize: 14, color: lc.inkSoft, marginTop: 4, lineHeight: 1.55 }}>We&rsquo;ll email you the moment Hello Circle opens in your area.</p>
                </div>
              </div>
            ) : (
              <form onSubmit={handleSubmit} noValidate>
                <div
                  style={{ background: lc.paperRaised, border: `1px solid ${lc.line}`, borderRadius: 20, padding: 20, boxShadow: "0 20px 50px rgba(20, 23, 15, 0.14)", display: "flex", flexDirection: "column", gap: 12 }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 10, background: lc.paper, border: `1px solid ${lc.line}`, borderRadius: 12, padding: "12px 14px" }}>
                    <MailIcon size={17} style={{ color: lc.inkSoft, flex: "none" }} />
                    <input
                      id="cs-email"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@example.ie"
                      autoComplete="email"
                      aria-label="Email address"
                      style={{ border: "none", outline: "none", fontSize: 15.5, width: "100%", background: "transparent", color: lc.ink, fontFamily: "inherit" }}
                    />
                  </div>
                  <div style={{ position: "relative", display: "flex", alignItems: "center", background: lc.paper, border: `1px solid ${lc.line}`, borderRadius: 12, padding: "12px 14px" }}>
                    <PinIcon size={17} style={{ color: lc.inkSoft, flex: "none", marginRight: 10 }} />
                    <select
                      id="cs-county"
                      value={county}
                      onChange={(e) => setCounty(e.target.value)}
                      aria-label="Your county (optional)"
                      style={{
                        appearance: "none",
                        WebkitAppearance: "none",
                        background: "none",
                        border: "none",
                        outline: "none",
                        width: "100%",
                        fontSize: 15.5,
                        color: county ? lc.ink : lc.inkSoft,
                        fontFamily: "inherit",
                        cursor: "pointer",
                      }}
                    >
                      <option value="">Your county (optional)</option>
                      {COUNTIES.map((c) => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                    <ChevronDownIcon size={15} style={{ color: lc.inkSoft, flex: "none", pointerEvents: "none" }} />
                  </div>
                  <button
                    className="lc-btn"
                    type="submit"
                    disabled={status === "loading"}
                    style={{ background: FV_ACCENT, color: lc.white, opacity: status === "loading" ? 0.7 : 1, width: "100%", padding: "14px 24px", fontSize: 15.5 }}
                  >
                    {status === "loading" ? "Joining…" : "Notify me"}
                  </button>
                </div>
                {status === "error" && <p style={{ color: colors.danger, fontSize: 13.5, marginTop: 10 }}>{error}</p>}
                <p style={{ fontSize: 13, color: lc.inkSoft, marginTop: 12 }}>We&rsquo;ll only email you when we launch. No spam, unsubscribe anytime.</p>
              </form>
            )}
          </div>
        </div>

        {/* Listing-type strip — the three real categories the product has. */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 40 }}>
          {LISTING_TYPES.map((t) => (
            <span
              key={t.label}
              className="lc-chip"
              style={{ display: "inline-flex", alignItems: "center", gap: 8, background: lc.paperRaised, border: `1px solid ${lc.line}`, color: lc.ink }}
            >
              <t.icon size={15} style={{ color: FV_ACCENT, flex: "none" }} />
              {t.label}
            </span>
          ))}
        </div>
      </section>

      {/* Full-bleed hero photo — breaks out of the page's lcMaxWidth
          container (this <div> sits at full page width) to match
          VendorHero.tsx's own reference: an edge-to-edge banner photo,
          not a boxed image beside the headline. cardImageRatio.hero
          (16/6) is the app's existing "wide banner" ratio token; the
          vertical tag reuses index.css's .for-venues-vertical-tag, doing
          double duty here as the big, unmissable "coming soon" statement
          the small header chip alone doesn't deliver. */}
      <div style={{ position: "relative" }}>
        <img
          src={img("hc-cs-social", 1920, 720)}
          alt="People meeting up for a local sports session"
          style={{ width: "100%", aspectRatio: cardImageRatio.hero, objectFit: "cover", display: "block" }}
        />
        <span className="for-venues-vertical-tag">Coming soon</span>
      </div>

      {/* What's coming */}
      <section className="lc-section" style={{ maxWidth: lcMaxWidth, margin: "0 auto", padding: "16px 24px 88px" }}>
        <div style={{ marginBottom: 36 }}>
          <div style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: "0.09em", textTransform: "uppercase", color: FV_ACCENT, marginBottom: 8 }}>
            <span aria-hidden="true">/</span> What&rsquo;s coming
          </div>
          <h2 style={{ fontFamily: lcFonts.display, fontWeight: 800, fontSize: "clamp(26px, 3.2vw, 38px)", letterSpacing: "-0.02em", color: lc.ink }}>
            Everything you need to get out more.
          </h2>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 18 }} className="lc-cs-features-grid">
          {FEATURES.map((f) => (
            <div key={f.title} className="lc-card" style={{ background: lc.paperRaised, border: `1px solid ${lc.line}`, borderRadius: 18, padding: "26px 22px" }}>
              <div style={{ width: 40, height: 40, borderRadius: 12, background: ACCENT_TINT, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 16 }}>
                <f.icon size={19} style={{ color: FV_ACCENT }} />
              </div>
              <h4 style={{ fontFamily: lcFonts.display, fontSize: 16.5, fontWeight: 700 }}>{f.title}</h4>
              <p style={{ fontSize: 13.5, color: lc.inkSoft, marginTop: 8, lineHeight: 1.55 }}>{f.text}</p>
            </div>
          ))}
        </div>
        <style>{`@media (max-width: 860px) { .lc-cs-features-grid { grid-template-columns: 1fr !important; } }`}</style>
      </section>

      {/* Rollout order */}
      <section className="lc-section" style={{ background: lc.paperRaised, padding: "64px 24px" }}>
        <div style={{ maxWidth: lcMaxWidth, margin: "0 auto" }}>
          <div style={{ textAlign: "center", marginBottom: 36 }}>
            <div style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: "0.09em", textTransform: "uppercase", color: FV_ACCENT, marginBottom: 8 }}>
              <span aria-hidden="true">/</span> Rollout
            </div>
            <h2 style={{ fontFamily: lcFonts.display, fontWeight: 800, fontSize: "clamp(26px, 3.2vw, 38px)", letterSpacing: "-0.02em", color: lc.ink }}>
              We&rsquo;re opening county by county.
            </h2>
            <p style={{ marginTop: 14, fontSize: 16, lineHeight: 1.55, color: lc.inkSoft, maxWidth: 480, marginLeft: "auto", marginRight: "auto" }}>
              Dublin goes live first. Everywhere else follows soon after.
            </p>
          </div>
          <div
            style={{
              position: "relative",
              borderRadius: 24,
              background: `linear-gradient(160deg, ${ACCENT_TINT} 0%, ${lc.paperRaised} 100%)`,
              border: `1px solid ${lc.line}`,
              padding: "48px 32px",
              display: "flex",
              flexWrap: "wrap",
              gap: 14,
              justifyContent: "center",
            }}
          >
            {ROLLOUT.map((r, i) => (
              <span
                key={r.city}
                className="lc-network-pin"
                style={{
                  animationDelay: `${(i % 4) * 0.4}s`,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  background: lc.paper,
                  borderRadius: 999,
                  padding: "12px 20px",
                  fontSize: 14.5,
                  fontWeight: 700,
                  color: lc.ink,
                  border: `1px solid ${lc.line}`,
                  boxShadow: "0 10px 24px rgba(20,23,15,0.06)",
                }}
              >
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: r.status === "live" ? FV_ACCENT : lc.lineStrong, flex: "none" }} />
                {r.city}
                <span style={{ fontWeight: 600, color: lc.inkSoft, fontSize: 12.5 }}>{r.status === "live" ? "· launching first" : "· coming next"}</span>
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* Final CTA — dark band inverts lc.ink/lc.paper so it stays
          high-contrast in both light and dark mode (same technique the rest
          of this page relies on, since both tokens are theme-following CSS
          vars rather than fixed colors). */}
      <section style={{ background: lc.ink, padding: "90px 24px 64px", textAlign: "center" }}>
        <div style={{ maxWidth: lcMaxWidth, margin: "0 auto" }}>
          <h2 style={{ fontFamily: lcFonts.display, fontSize: "clamp(30px, 4.5vw, 50px)", color: lc.paper, lineHeight: 1.15 }}>
            Be first to know when we open.
          </h2>
          <p style={{ fontSize: 17, color: "rgba(250,248,242,0.72)", marginTop: 16 }}>It takes ten seconds, and we&rsquo;ll do the rest.</p>
          <button className="lc-btn" style={{ background: FV_ACCENT, color: lc.white, padding: "15px 30px", fontSize: 15.5, marginTop: 32 }} onClick={scrollToForm}>
            Join the waitlist
          </button>

          {/* Honest platform note — apps/mobile is a real, in-progress app,
              but neither store listing is published yet, so these are
              plain badges, not functioning "Download" links. */}
          <p style={{ fontSize: 12.5, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "rgba(250,248,242,0.5)", marginTop: 48, marginBottom: 14 }}>
            Also coming to
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: 12 }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 9, borderRadius: 999, padding: "10px 18px", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.16)", color: lc.paper, fontSize: 14, fontWeight: 600 }}>
              <AppleIcon size={16} />
              App Store · coming soon
            </span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 9, borderRadius: 999, padding: "10px 18px", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.16)", color: lc.paper, fontSize: 14, fontWeight: 600 }}>
              <GoogleIcon size={16} />
              Google Play · coming soon
            </span>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer style={{ background: lc.paperRaised, borderTop: `1px solid ${lc.line}`, padding: "28px 24px" }}>
        <div style={{ maxWidth: lcMaxWidth, margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 9, fontSize: 12.5, color: lc.inkSoft }}>
            <img src="/illustrations/Fav.svg" alt="" aria-hidden="true" style={{ height: 14, flex: "none" }} />
            © {new Date().getFullYear()} HelloCircle. Made for real-world participation.
          </span>
          <span style={{ fontSize: 12.5, color: lc.inkSoft }}>Ireland, and everywhere</span>
        </div>
      </footer>
    </div>
  );
}
