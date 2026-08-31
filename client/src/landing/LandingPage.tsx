import { useNavigate } from "react-router-dom";
import {
  BuildingIcon,
  CalendarIcon,
  CheckIcon,
  GraduationCapIcon,
  HandshakeIcon,
  HeartIcon,
  PinIcon,
  RepeatIcon,
  UsersIcon,
} from "../components/icons";
import { ActivityCard } from "./components/ActivityCard";
import { CategoryTile } from "./components/CategoryTile";
import { CircleCard } from "./components/CircleCard";
import { Carousel } from "./components/Carousel";
import { CTASection } from "./components/CTASection";
import { LandingFooter } from "./components/LandingFooter";
import { LandingHeader } from "./components/LandingHeader";
import { HeroSearch } from "./components/HeroSearch";
import { OpenPlanCard } from "./components/OpenPlanCard";
import { SectionHeader } from "./components/SectionHeader";
import { VenueCard } from "./components/VenueCard";
import {
  CATEGORIES,
  CIRCLES,
  INTENT_PATHS,
  NETWORK_LABELS,
  OPEN_PLANS,
  PERSONALIZED_SUGGESTIONS,
  TODAY_ACTIVITIES,
  VENUES,
  WEEKEND_ACTIVITIES,
} from "./data";
import { ArrowUpRightIcon, SparkleIcon } from "./icons";
import { lc, lcFonts, lcMaxWidth, lcRadius } from "./theme";
import { placeholderImage } from "../placeholderImage";
import "./landing.css";

const img = (seed: string, w = 900, h = 700) => placeholderImage(seed, w, h);

export function LandingPage() {
  const navigate = useNavigate();

  return (
    <div className="lc-page" style={{ background: lc.paper, color: lc.ink }}>
      <LandingHeader />

      {/* 3. Hero -------------------------------------------------------- */}
      <section className="lc-section" style={{ maxWidth: lcMaxWidth, margin: "0 auto", padding: "28px 24px 80px" }}>
        <div className="lc-stack-mobile" style={{ display: "grid", gridTemplateColumns: "1.05fr 0.95fr", gap: 56, alignItems: "center" }}>
          <div className="lc-fade-up">
            <h1 style={{ fontFamily: lcFonts.display, fontSize: "clamp(38px, 5.4vw, 68px)", lineHeight: 1.06, fontWeight: 800, color: lc.ink }}>
              Your city is full of things to do.
            </h1>
            <p style={{ fontSize: 18, lineHeight: 1.6, color: lc.inkSoft, marginTop: 20, maxWidth: 480 }}>
              Discover activities, meet people, join local circles, and find places to make plans happen.
            </p>
            <div style={{ display: "flex", gap: 12, marginTop: 28, flexWrap: "wrap" }}>
              <button className="lc-btn" style={{ background: lc.forest, color: lc.white, padding: "15px 26px", fontSize: 15.5 }} onClick={() => navigate("/explore")}>
                Explore near you
              </button>
              <button
                className="lc-btn"
                style={{ background: "transparent", color: lc.ink, border: `1.5px solid ${lc.lineStrong}`, padding: "15px 26px", fontSize: 15.5 }}
                onClick={() => navigate("/make-it-happen")}
              >
                Create a plan
              </button>
            </div>
            <div style={{ marginTop: 34 }}>
              <HeroSearch />
            </div>
          </div>

          <div className="lc-hero-collage" aria-hidden>
            <div className="lc-hero-photo lc-float" style={{ gridColumn: "1 / 4", gridRow: "1 / 4" }}>
              <img src={img("hc-hero-badminton", 700, 700)} alt="Two people playing badminton at an evening social" loading="eager" />
            </div>
            <div className="lc-hero-photo" style={{ gridColumn: "4 / 7", gridRow: "1 / 3" }}>
              <img src={img("hc-hero-cycling", 700, 500)} alt="Group cycling ride at sunset" loading="lazy" />
            </div>
            <div className="lc-hero-photo lc-float" style={{ gridColumn: "4 / 6", gridRow: "3 / 5", animationDelay: "1.4s" }}>
              <img src={img("hc-hero-hike", 500, 500)} alt="Friends hiking a local trail" loading="lazy" />
            </div>
            <div className="lc-hero-photo" style={{ gridColumn: "6 / 7", gridRow: "3 / 5" }}>
              <img src={img("hc-hero-workshop", 400, 500)} alt="Pottery workshop in progress" loading="lazy" />
            </div>
            <div className="lc-hero-photo" style={{ gridColumn: "1 / 4", gridRow: "4 / 7" }}>
              <img src={img("hc-hero-family", 700, 500)} alt="Family at a community activity" loading="lazy" />
            </div>
            <div className="lc-hero-photo lc-float" style={{ gridColumn: "4 / 7", gridRow: "5 / 7", animationDelay: "0.7s" }}>
              <img src={img("hc-hero-social", 700, 400)} alt="People meeting at a local sports court" loading="lazy" />
            </div>
          </div>
        </div>
      </section>

      {/* 4. Discovery Preview -------------------------------------------- */}
      <section className="lc-section" style={{ maxWidth: lcMaxWidth, margin: "0 auto", padding: "40px 24px" }}>
        <SectionHeader eyebrow="Happening today" title="Something is always happening nearby." subtitle="Real activities, starting today, within a few kilometres of you." />
        <Carousel style={{ marginLeft: -4, paddingLeft: 4 }}>
          {TODAY_ACTIVITIES.map((a) => (
            <ActivityCard key={a.id} activity={a} />
          ))}
        </Carousel>
      </section>

      {/* 5. This Weekend --------------------------------------------------- */}
      <section className="lc-section" style={{ background: lc.paperRaised, padding: "64px 24px" }}>
        <div style={{ maxWidth: lcMaxWidth, margin: "0 auto" }}>
          <SectionHeader eyebrow="This weekend" title="Make something of your weekend." subtitle="A wider, more editorial mix — from sunrise hikes to Sunday football." />
          <Carousel>
            {WEEKEND_ACTIVITIES.map((a) => (
              <ActivityCard key={a.id} activity={a} width={240} />
            ))}
          </Carousel>
        </div>
      </section>

      {/* 6. Intent-Based Discovery ------------------------------------------ */}
      <section className="lc-section" style={{ maxWidth: lcMaxWidth, margin: "0 auto", padding: "72px 24px" }}>
        <SectionHeader eyebrow="Pick a mood" title="What are you in the mood for?" align="center" />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16 }} className="lc-category-grid">
          {CATEGORIES.map((c) => (
            <CategoryTile key={c.id} category={c} />
          ))}
        </div>
        <style>{`@media (max-width: 860px) { .lc-category-grid { grid-template-columns: repeat(2, 1fr) !important; } }`}</style>
      </section>

      {/* 7. The HelloCircle Difference --------------------------------------- */}
      <section className="lc-section" style={{ maxWidth: lcMaxWidth, margin: "0 auto", padding: "40px 24px 88px" }}>
        <SectionHeader eyebrow="More than events" title="More than events." subtitle="HelloCircle connects everything needed to turn an idea into a real-world experience." align="center" />

        <div style={{ textAlign: "center", marginBottom: 40 }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8, background: lc.forestBg, color: lc.forestDark, padding: "10px 20px", borderRadius: lcRadius.pill, fontWeight: 700, fontSize: 15 }}>
            <SparkleIcon size={15} /> "I want to play badminton tonight"
          </span>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 18 }} className="lc-intent-grid">
          {INTENT_PATHS.map((path, i) => {
            const icons = [BuildingIcon, UsersIcon, RepeatIcon, CalendarIcon];
            const Icon = icons[i];
            return (
              <div key={path.id} className="lc-card" style={{ background: lc.white, border: `1px solid ${lc.line}`, borderRadius: 18, padding: "24px 20px" }}>
                <div style={{ width: 40, height: 40, borderRadius: 12, background: lc.forestBg, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 16 }}>
                  <Icon size={19} style={{ color: lc.forest }} />
                </div>
                <h4 style={{ fontFamily: lcFonts.display, fontSize: 16.5, fontWeight: 700 }}>{path.label}</h4>
                <p style={{ fontSize: 13.5, color: lc.inkSoft, marginTop: 8, minHeight: 34 }}>{path.detail}</p>
                <button className="lc-btn" style={{ marginTop: 14, width: "100%", background: lc.paperRaised, color: lc.ink, fontSize: 13.5, padding: "10px 14px" }}>
                  {path.cta}
                </button>
              </div>
            );
          })}
        </div>
        <style>{`@media (max-width: 860px) { .lc-intent-grid { grid-template-columns: repeat(2, 1fr) !important; } }`}</style>
      </section>

      {/* 8. Circles --------------------------------------------------------- */}
      <section className="lc-section" style={{ background: lc.forestDark, padding: "80px 24px" }}>
        <div style={{ maxWidth: lcMaxWidth, margin: "0 auto" }}>
          <SectionHeader
            eyebrow="Community"
            title="Find your circle."
            subtitle="Join people who keep showing up for the things you love."
            action={
              <button className="lc-btn" style={{ background: "transparent", color: lc.white, border: "1.5px solid rgba(255,255,255,0.3)" }} onClick={() => navigate("/circles")}>
                Explore Circles <ArrowUpRightIcon size={15} />
              </button>
            }
          />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 18 }} className="lc-circles-grid">
            {CIRCLES.map((c) => (
              <CircleCard key={c.id} circle={c} />
            ))}
          </div>
          <style>{`@media (max-width: 860px) { .lc-circles-grid { grid-template-columns: repeat(2, 1fr) !important; } }`}</style>
        </div>
      </section>

      {/* 9. Open Plans -------------------------------------------------------- */}
      <section className="lc-section" style={{ maxWidth: lcMaxWidth, margin: "0 auto", padding: "80px 24px" }}>
        <SectionHeader
          eyebrow="Open plans"
          title="Sometimes you just need a few people."
          subtitle="Start a simple plan and let nearby people join. No formal event needed."
          action={
            <button className="lc-btn" style={{ background: lc.ink, color: lc.white }} onClick={() => navigate("/games")}>
              Start a plan
            </button>
          }
        />
        <Carousel>
          {OPEN_PLANS.map((p) => (
            <OpenPlanCard key={p.id} plan={p} />
          ))}
        </Carousel>
      </section>

      {/* 10. Places & Booking --------------------------------------------------- */}
      <section className="lc-section" style={{ background: lc.paperRaised, padding: "80px 24px" }}>
        <div style={{ maxWidth: lcMaxWidth, margin: "0 auto" }}>
          <SectionHeader eyebrow="Places" title="Need a place? Find one nearby." subtitle="Courts, studios, community halls, clubs and activity spaces — all in one place." />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 18 }} className="lc-venues-grid">
            {VENUES.map((v) => (
              <VenueCard key={v.id} venue={v} />
            ))}
          </div>
          <style>{`@media (max-width: 860px) { .lc-venues-grid { grid-template-columns: repeat(2, 1fr) !important; } }`}</style>
        </div>
      </section>

      {/* 11. How It Works --------------------------------------------------------- */}
      <section id="how-it-works" className="lc-section" style={{ maxWidth: lcMaxWidth, margin: "0 auto", padding: "88px 24px" }}>
        <SectionHeader eyebrow="How it works" title={'From "maybe" to "I\'m in."'} align="center" />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 22 }} className="lc-steps-grid">
          {[
            { n: "01", title: "Discover", text: "Tell HelloCircle what you feel like doing.", seed: "hc-step-discover" },
            { n: "02", title: "Join or Book", text: "Join people, reserve a place, or start your own plan.", seed: "hc-step-join" },
            { n: "03", title: "Show up", text: "Meet, play, learn, explore — and do it again.", seed: "hc-step-showup" },
          ].map((step) => (
            <div key={step.n} style={{ borderRadius: 20, overflow: "hidden", border: `1px solid ${lc.line}`, background: lc.white }}>
              <div className="lc-card-image" style={{ height: 170 }}>
                <img src={img(step.seed, 700, 400)} alt="" loading="lazy" />
              </div>
              <div style={{ padding: "20px 22px 24px" }}>
                <span style={{ fontFamily: lcFonts.display, fontSize: 13, fontWeight: 800, color: lc.forest }}>{step.n}</span>
                <h4 style={{ fontFamily: lcFonts.display, fontSize: 19, fontWeight: 700, marginTop: 6 }}>{step.title}</h4>
                <p style={{ fontSize: 14, color: lc.inkSoft, marginTop: 8, lineHeight: 1.5 }}>{step.text}</p>
              </div>
            </div>
          ))}
        </div>
        <style>{`@media (max-width: 860px) { .lc-steps-grid { grid-template-columns: 1fr !important; } }`}</style>
      </section>

      {/* 12. Personalized Discovery ------------------------------------------------- */}
      <section className="lc-section" style={{ background: lc.ink, padding: "88px 24px" }}>
        <div className="lc-stack-mobile" style={{ maxWidth: lcMaxWidth, margin: "0 auto", display: "grid", gridTemplateColumns: "1fr 0.85fr", gap: 56, alignItems: "center" }}>
          <div>
            <div style={{ fontFamily: lcFonts.body, fontSize: 12.5, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: lc.gold, marginBottom: 12 }}>
              Personalized discovery
            </div>
            <h2 style={{ fontFamily: lcFonts.display, fontSize: "clamp(28px, 4vw, 42px)", color: lc.paper, lineHeight: 1.15 }}>
              HelloCircle gets more useful the more you use it.
            </h2>
            <p style={{ fontSize: 16.5, color: "rgba(250,248,242,0.68)", marginTop: 16, maxWidth: 440, lineHeight: 1.6 }}>
              Every activity you join, every Circle you follow — it all sharpens what shows up for you next. No
              settings to configure, nothing to train.
            </p>
          </div>

          <div style={{ background: lc.paper, borderRadius: 22, padding: 24, boxShadow: "0 30px 70px rgba(0,0,0,0.35)" }}>
            <div style={{ fontFamily: lcFonts.display, fontSize: 18, fontWeight: 700, color: lc.ink }}>Good evening, Gopal</div>
            <div style={{ fontSize: 13, color: lc.inkSoft, marginTop: 6 }}>
              Because you like: <strong style={{ color: lc.ink }}>Badminton · Cycling · Photography</strong>
            </div>
            <div style={{ marginTop: 18, display: "flex", flexDirection: "column", gap: 10 }}>
              {PERSONALIZED_SUGGESTIONS.map((s) => (
                <div key={s.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: lc.paperRaised, borderRadius: 12, padding: "12px 14px" }}>
                  <span style={{ fontSize: 14, fontWeight: 600, color: lc.ink }}>{s.title}</span>
                  <span style={{ fontSize: 12.5, color: lc.inkSoft, display: "flex", alignItems: "center", gap: 4 }}>
                    <PinIcon size={11} /> {s.distanceKm} km
                  </span>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 16, fontSize: 12.5, color: lc.forest, fontWeight: 700, display: "flex", alignItems: "center", gap: 6 }}>
              <UsersIcon size={13} /> 3 Circle members are going tonight
            </div>
          </div>
        </div>
      </section>

      {/* 13. For Organizers ------------------------------------------------------ */}
      <section className="lc-section" style={{ maxWidth: lcMaxWidth, margin: "0 auto", padding: "88px 24px" }}>
        <div className="lc-stack-mobile" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 56, alignItems: "center" }}>
          <div className="lc-card-image" style={{ borderRadius: 22, height: 380 }}>
            <img src={img("hc-organizers", 900, 700)} alt="Organizer briefing a group before an activity" loading="lazy" />
          </div>
          <div>
            <div style={{ fontFamily: lcFonts.body, fontSize: 12.5, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: lc.forest, marginBottom: 12 }}>
              For organizers
            </div>
            <h2 style={{ fontFamily: lcFonts.display, fontSize: "clamp(26px, 3.6vw, 38px)", lineHeight: 1.18 }}>Bring people together.</h2>
            <p style={{ fontSize: 16, color: lc.inkSoft, marginTop: 14, lineHeight: 1.6 }}>
              Create activities, build a community and manage participants without complicated event software.
            </p>
            <ul style={{ listStyle: "none", padding: 0, margin: "22px 0 0", display: "flex", flexDirection: "column", gap: 11 }}>
              {["Create activities", "Recurring sessions", "Manage participants", "Build Circles", "Communicate with members", "Track attendance"].map((f) => (
                <li key={f} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 14.5, color: lc.ink }}>
                  <CheckIcon size={15} style={{ color: lc.forest, flex: "none" }} /> {f}
                </li>
              ))}
            </ul>
            <button className="lc-btn" style={{ marginTop: 26, background: lc.ink, color: lc.white }} onClick={() => navigate("/vendor/signup")}>
              Start hosting
            </button>
          </div>
        </div>
      </section>

      {/* 14. For Places --------------------------------------------------------- */}
      <section className="lc-section" style={{ background: lc.paperRaised, padding: "88px 24px" }}>
        <div className="lc-stack-mobile" style={{ maxWidth: lcMaxWidth, margin: "0 auto", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 56, alignItems: "center" }}>
          <div style={{ order: 1 }}>
            <div style={{ fontFamily: lcFonts.body, fontSize: 12.5, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: lc.forest, marginBottom: 12 }}>
              For places
            </div>
            <h2 style={{ fontFamily: lcFonts.display, fontSize: "clamp(26px, 3.6vw, 38px)", lineHeight: 1.18 }}>Turn empty time into active communities.</h2>
            <p style={{ fontSize: 16, color: lc.inkSoft, marginTop: 14, lineHeight: 1.6 }}>
              List your venue, manage availability and connect with people looking for places to play, learn and meet.
            </p>
            <ul style={{ listStyle: "none", padding: 0, margin: "22px 0 0", display: "flex", flexDirection: "column", gap: 11 }}>
              {["Manage facilities", "Set availability", "Accept bookings", "Control pricing", "Promote activities", "Claim existing listings"].map((f) => (
                <li key={f} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 14.5, color: lc.ink }}>
                  <CheckIcon size={15} style={{ color: lc.forest, flex: "none" }} /> {f}
                </li>
              ))}
            </ul>
            <button className="lc-btn" style={{ marginTop: 26, background: lc.ink, color: lc.white }} onClick={() => navigate("/vendor/signup")}>
              List your place
            </button>
          </div>
          <div className="lc-card-image" style={{ order: 2, borderRadius: 22, height: 380 }}>
            <img src={img("hc-places", 900, 700)} alt="An empty community hall ready for bookings" loading="lazy" />
          </div>
        </div>
      </section>

      {/* 15. Local Network Effect ------------------------------------------------- */}
      <section className="lc-section" style={{ maxWidth: lcMaxWidth, margin: "0 auto", padding: "88px 24px" }}>
        <SectionHeader eyebrow="The local network" title="A better-connected neighbourhood." subtitle="People, activities, Circles and places — all showing up for each other, block by block." align="center" />
        <div
          style={{
            position: "relative",
            borderRadius: 24,
            background: `linear-gradient(160deg, ${lc.forestBg} 0%, ${lc.paperRaised} 100%)`,
            border: `1px solid ${lc.line}`,
            padding: "56px 32px",
            display: "grid",
            gridTemplateColumns: "repeat(4, 1fr)",
            gap: 16,
          }}
          className="lc-network-grid"
        >
          {NETWORK_LABELS.map((label, i) => (
            <div
              key={label}
              className="lc-network-pin"
              style={{
                animationDelay: `${(i % 4) * 0.4}s`,
                background: lc.white,
                borderRadius: 14,
                padding: "14px 16px",
                fontSize: 13,
                fontWeight: 700,
                color: lc.ink,
                border: `1px solid ${lc.line}`,
                boxShadow: "0 10px 24px rgba(20,23,15,0.06)",
                marginTop: i % 3 === 1 ? 24 : i % 3 === 2 ? -12 : 0,
              }}
            >
              {label}
            </div>
          ))}
        </div>
        <style>{`@media (max-width: 860px) { .lc-network-grid { grid-template-columns: repeat(2, 1fr) !important; } }`}</style>
      </section>

      {/* 16. Social Proof placeholder ----------------------------------------------- */}
      <section className="lc-section" style={{ background: lc.paperRaised, padding: "80px 24px" }}>
        <div style={{ maxWidth: lcMaxWidth, margin: "0 auto" }}>
          <SectionHeader eyebrow="Built to last" title="Built for real-world participation." align="center" />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 20 }} className="lc-proof-grid">
            {[
              { icon: HandshakeIcon, title: "For participants", text: "A place to find people who show up for the same things you do — reviewed, real, and local." },
              { icon: GraduationCapIcon, title: "For organizers", text: "Tools built around actually running a session, not selling tickets to a one-off event." },
              { icon: HeartIcon, title: "For places", text: "A steady way to fill quiet hours with people who genuinely want to be there." },
            ].map((item) => (
              <div key={item.title} style={{ background: lc.white, border: `1px solid ${lc.line}`, borderRadius: 18, padding: "26px 22px" }}>
                <item.icon size={22} style={{ color: lc.forest }} />
                <h4 style={{ fontFamily: lcFonts.display, fontSize: 16.5, fontWeight: 700, marginTop: 14 }}>{item.title}</h4>
                <p style={{ fontSize: 13.5, color: lc.inkSoft, marginTop: 8, lineHeight: 1.55 }}>{item.text}</p>
              </div>
            ))}
          </div>
          <style>{`@media (max-width: 860px) { .lc-proof-grid { grid-template-columns: 1fr !important; } }`}</style>
        </div>
      </section>

      {/* 17. Final CTA ------------------------------------------------------------ */}
      <CTASection />

      {/* 18. Footer ----------------------------------------------------------------- */}
      <LandingFooter />
    </div>
  );
}
