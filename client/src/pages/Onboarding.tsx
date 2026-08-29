import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { fetchCentres, fetchDiscover, saveOnboarding, skipOnboarding } from "../api";
import { fetchMarketCategories, submitIntent } from "../api/public";
import { Chip } from "../components/Chip";
import { DiscoverCard } from "../components/DiscoverRow";
import { Button, EmptyState } from "../components/ui";
import { useGuest } from "../GuestContext";
import { colors, fonts } from "../theme";
import { CalendarIcon, CheckIcon, PinIcon, SearchIcon } from "../components/icons";
import { AVAILABILITY_OPTIONS, BUDGET_OPTIONS, GOAL_OPTIONS, GROUP_SIZE_OPTIONS, INTEREST_OPTIONS } from "../types";
import type { DiscoverItem } from "../types";
import { nearestCounty } from "../irishCounties";

// Onboarding (Phase A, extended IA spec §2) — signal-only: stored and
// returned via fetchResidentFull(), wired into actual recommendations
// later. Skippable at every single step — never blocks using the rest of
// the app. `goals`/`comfort` fill the spec's screens 05/07; `done` fills
// screen 08 ("show immediate value" instead of ending on an empty
// dashboard) — its 3 recommendations are real fetchDiscover() rows, never
// fabricated, matching this app's own "never invent availability" rule.
//
// `welcome` (auth/onboarding redesign brief's screen 11) is a short intro
// before the real steps begin, so onboarding doesn't feel like it starts
// mid-form. The brief's own preference was a tighter 2-3 step flow, but
// goals/who/availability/comfort were kept deliberately — they're real,
// working preference capture an earlier phase built for recommendations,
// not scope creep to trim; only the intro screen and the interests/
// location steps' visual treatment changed here.

const STEPS = ["welcome", "location", "goals", "interests", "who", "availability", "comfort", "done"] as const;
type Step = (typeof STEPS)[number];

// Hand-grouped presentation categories for INTEREST_OPTIONS (types.ts has
// no first-class category field) — same 12 real options, just organised
// into the tile groups the redesign brief asked for.
const INTEREST_GROUPS: { label: string; items: string[] }[] = [
  { label: "Sport & fitness", items: ["Badminton", "Football", "Swimming", "Fitness", "Yoga"] },
  { label: "Outdoors", items: ["Walking", "Outdoor"] },
  { label: "Social", items: ["Kids activities", "Community events"] },
  { label: "Learn & wellbeing", items: ["Arts", "Learning", "Wellbeing"] },
];

const POPULAR_COUNTIES = ["Dublin", "Cork", "Galway", "Limerick", "Waterford"];

export function Onboarding() {
  const navigate = useNavigate();
  const { refresh, resident } = useGuest();
  const [step, setStep] = useState<Step>("welcome");
  const [counties, setCounties] = useState<string[]>(["Dublin"]);
  const [homeCounty, setHomeCounty] = useState("Dublin");
  const [radiusKm, setRadiusKm] = useState(5);
  const [countySearch, setCountySearch] = useState("");
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);

  useEffect(() => {
    fetchCentres().then((centres) => {
      const list = Array.from(new Set(centres.map((c) => c.county).filter(Boolean))).sort((a, b) => a.localeCompare(b));
      if (list.length) {
        setCounties(list);
        setHomeCounty(list[0]);
      }
    });
  }, []);

  useEffect(() => {
    if (!homeCounty) return;
    fetchMarketCategories(homeCounty)
      .then(setMarketFlags)
      .catch(() => setMarketFlags(null));
  }, [homeCounty]);

  const requestCategory = async (category: string) => {
    if (requestedCategories.includes(category)) return;
    setRequestedCategories((prev) => [...prev, category]);
    try {
      await submitIntent({ activityLabel: category, county: homeCounty });
    } catch {
      setRequestedCategories((prev) => prev.filter((c) => c !== category));
    }
  };
  const [goals, setGoals] = useState<string[]>([]);
  const [interests, setInterests] = useState<string[]>([]);
  // Market/category launch config (participation-intent plan Phase 4) —
  // null = still loading (treat every category as available, don't flash a
  // "not yet here" state before the real answer arrives).
  const [marketFlags, setMarketFlags] = useState<Record<string, boolean> | null>(null);
  const [requestedCategories, setRequestedCategories] = useState<string[]>([]);
  const [bookingFor, setBookingFor] = useState<"me" | "family" | "children">("me");
  const [availability, setAvailability] = useState<string[]>([]);
  const [groupSize, setGroupSize] = useState("any");
  const [beginnerFriendly, setBeginnerFriendly] = useState(false);
  const [soloFriendly, setSoloFriendly] = useState(false);
  const [budget, setBudget] = useState("any");
  const [saving, setSaving] = useState(false);
  const [recommended, setRecommended] = useState<DiscoverItem[] | null>(null);

  const stepIndex = STEPS.indexOf(step);

  const toggle = (list: string[], setList: (v: string[]) => void, item: string) => {
    setList(list.includes(item) ? list.filter((i) => i !== item) : [...list, item]);
  };

  const save = async () => {
    setSaving(true);
    try {
      await saveOnboarding({
        homeCounty,
        searchRadiusKm: radiusKm,
        interests,
        availability,
        goals,
        prefGroupSize: groupSize,
        prefBeginnerFriendly: beginnerFriendly,
        prefSoloFriendly: soloFriendly,
        prefBudget: budget,
      });
      await refresh();
    } finally {
      setSaving(false);
    }
  };

  const skipAll = async () => {
    await skipOnboarding();
    await refresh();
    navigate("/");
  };

  // Permission is only ever requested here, on explicit click — never on
  // page load. Same client-side county-centroid matching Home.tsx's own
  // "use my location" already uses (irishCounties.ts) — real coordinates,
  // never sent to the server, never guessed at.
  const handleUseMyLocation = () => {
    setLocationError(null);
    if (!navigator.geolocation) {
      setLocationError("Location isn't available in this browser.");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const match = nearestCounty(pos.coords.latitude, pos.coords.longitude, counties);
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

  const next = async () => {
    const idx = STEPS.indexOf(step);
    if (step === "comfort") {
      await save();
      fetchDiscover(homeCounty)
        .then((feed) => setRecommended([...feed.today, ...feed.weekend].slice(0, 3)))
        .catch(() => setRecommended([]));
    }
    if (idx < STEPS.length - 1) setStep(STEPS[idx + 1]);
  };

  const firstName = resident?.name?.trim().split(/\s+/)[0];

  return (
    <div style={{ animation: "fadeUp .3s ease both" }}>
      <section className="section-pad" style={{ maxWidth: 560, margin: "0 auto", padding: "48px 24px 80px" }}>
        {step !== "welcome" && (
          <div style={{ display: "flex", gap: 6, marginBottom: 28 }}>
            {STEPS.filter((s) => s !== "welcome").map((s, i) => (
              <div key={s} style={{ flex: 1, height: 4, borderRadius: 2, background: i <= stepIndex - 1 ? colors.green : colors.border }} />
            ))}
          </div>
        )}

        {step === "welcome" && (
          <div style={{ padding: "40px 0 8px" }}>
            <h1 style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: "clamp(26px,3.4vw,34px)", margin: "0 0 12px", letterSpacing: "-.01em" }}>
              Welcome to HelloCircle{firstName ? `, ${firstName}` : ""}.
            </h1>
            <p style={{ color: colors.mutedLight, fontSize: 16, lineHeight: 1.55, margin: "0 0 32px", maxWidth: 440 }}>
              Let's make your Explore page useful from day one. Tell us a little about what you'd actually like to do.
            </p>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <button onClick={skipAll} style={{ background: "none", border: "none", color: colors.muted, fontSize: 14, cursor: "pointer", padding: 0 }}>
                Skip for now
              </button>
              <Button onClick={next}>Let's go →</Button>
            </div>
          </div>
        )}

        {step === "location" && (
          <>
            <h1 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 28, margin: "0 0 8px" }}>Where should we look?</h1>
            <p style={{ color: colors.mutedLight, margin: "0 0 24px" }}>Tell us where you'd like to discover activities, Circles and places.</p>

            <div style={{ position: "relative", marginBottom: 14 }}>
              <div style={{ position: "absolute", left: 13, top: "50%", transform: "translateY(-50%)", color: colors.mutedLight, display: "flex", pointerEvents: "none" }}>
                <SearchIcon size={16} />
              </div>
              <input
                value={countySearch}
                onChange={(e) => setCountySearch(e.target.value)}
                placeholder="Search county"
                style={{ width: "100%", padding: "12px 14px 12px 38px", borderRadius: 12, border: `1px solid ${colors.inputBorder}`, fontSize: 15 }}
              />
            </div>

            <button
              onClick={handleUseMyLocation}
              disabled={locating}
              style={{
                display: "inline-flex", alignItems: "center", gap: 8, background: "none", border: `1px solid ${colors.border}`,
                borderRadius: 11, padding: "9px 16px", fontSize: 13.5, fontWeight: 700, color: colors.text, cursor: locating ? "default" : "pointer", marginBottom: 20,
              }}
            >
              <PinIcon size={15} /> {locating ? "Finding you…" : "Use my current location"}
            </button>
            {locationError && <p style={{ margin: "-14px 0 20px", fontSize: 12.5, color: colors.danger }}>{locationError}</p>}

            {!countySearch && (
              <>
                <div style={{ fontSize: 12, fontWeight: 700, color: colors.muted, textTransform: "uppercase", letterSpacing: ".04em", marginBottom: 10 }}>Popular</div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 22 }}>
                  {POPULAR_COUNTIES.filter((c) => counties.includes(c)).map((c) => (
                    <Chip key={c} label={c} active={homeCounty === c} onClick={() => setHomeCounty(c)} accent="green" radius={11} padding="9px 16px" />
                  ))}
                </div>
              </>
            )}

            <div style={{ fontSize: 12, fontWeight: 700, color: colors.muted, textTransform: "uppercase", letterSpacing: ".04em", marginBottom: 10 }}>
              {countySearch ? "Results" : "All counties"}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 220, overflowY: "auto", marginBottom: 22 }}>
              {counties
                .filter((c) => c.toLowerCase().includes(countySearch.trim().toLowerCase()))
                .map((c) => (
                  <button
                    key={c}
                    onClick={() => setHomeCounty(c)}
                    style={{
                      display: "flex", alignItems: "center", justifyContent: "space-between", textAlign: "left",
                      background: homeCounty === c ? colors.greenBg : "transparent", border: "none", borderRadius: 10,
                      padding: "10px 12px", fontSize: 14.5, fontWeight: homeCounty === c ? 700 : 500,
                      color: homeCounty === c ? colors.greenText : colors.text, cursor: "pointer",
                    }}
                  >
                    {c}
                    {homeCounty === c && <CheckIcon size={15} />}
                  </button>
                ))}
            </div>

            <div style={{ fontSize: 13, fontWeight: 700, color: colors.muted, marginBottom: 10 }}>Search within</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {[2, 5, 10, 20].map((r) => (
                <Chip key={r} label={`${r} km`} active={radiusKm === r} onClick={() => setRadiusKm(r)} accent="green" radius={11} padding="9px 16px" />
              ))}
            </div>
          </>
        )}

        {step === "goals" && (
          <>
            <h1 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 28, margin: "0 0 8px" }}>What would make life better right now?</h1>
            <p style={{ color: colors.mutedLight, margin: "0 0 24px" }}>Pick as many as apply.</p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {GOAL_OPTIONS.map((g) => (
                <Chip key={g} label={g} active={goals.includes(g)} onClick={() => toggle(goals, setGoals, g)} accent="green" radius={11} padding="9px 16px" />
              ))}
            </div>
          </>
        )}

        {step === "interests" && (
          <>
            <h1 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 28, margin: "0 0 8px" }}>What are you into?</h1>
            <p style={{ color: colors.mutedLight, margin: "0 0 24px" }}>Choose things you'd genuinely be interested in doing nearby.</p>

            {INTEREST_GROUPS.map((group) => (
              <div key={group.label} style={{ marginBottom: 22 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: colors.muted, textTransform: "uppercase", letterSpacing: ".04em", marginBottom: 10 }}>
                  {group.label}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))", gap: 8 }}>
                  {group.items.map((i) => {
                    // Market/category launch config (participation-intent plan
                    // Phase 4) — a disabled category still shows (never hidden
                    // outright, per the source doc's "don't hide potential"
                    // instruction), just non-selectable with a "Request this"
                    // affordance that feeds the existing ParticipationIntent
                    // demand-capture pipeline instead of Interests.
                    const isLive = marketFlags === null || marketFlags[i] !== false;
                    if (!isLive) {
                      const requested = requestedCategories.includes(i);
                      return (
                        <button
                          key={i}
                          onClick={() => requestCategory(i)}
                          disabled={requested}
                          style={{
                            border: `1.5px dashed ${colors.border}`, background: "#fff", color: colors.mutedLight,
                            borderRadius: 11, padding: "12px 14px", fontSize: 13.5, fontWeight: 600, textAlign: "left",
                            cursor: requested ? "default" : "pointer",
                          }}
                        >
                          {i} — {requested ? "Requested" : "not yet here"}
                        </button>
                      );
                    }
                    const active = interests.includes(i);
                    return (
                      <button
                        key={i}
                        onClick={() => toggle(interests, setInterests, i)}
                        style={{
                          position: "relative", display: "flex", alignItems: "center", justifyContent: "space-between",
                          border: `1.5px solid ${active ? colors.green : colors.border}`, background: active ? colors.greenBg : "#fff",
                          borderRadius: 11, padding: "12px 14px", fontSize: 14, fontWeight: 700,
                          color: active ? colors.greenText : colors.text, cursor: "pointer", textAlign: "left",
                        }}
                      >
                        {i}
                        {active && <CheckIcon size={15} />}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}

            <div style={{ fontSize: 13, fontWeight: 700, color: interests.length ? colors.greenText : colors.mutedLight }}>
              {interests.length} selected
            </div>
          </>
        )}

        {step === "who" && (
          <>
            <h1 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 28, margin: "0 0 8px" }}>Who will you usually book for?</h1>
            <p style={{ color: colors.mutedLight, margin: "0 0 24px" }}>You can add household members any time from My Bookings — never required.</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {[
                { key: "me" as const, label: "Just me" },
                { key: "family" as const, label: "Me and my family" },
                { key: "children" as const, label: "Mostly my children" },
              ].map((o) => (
                <label
                  key={o.key}
                  style={{
                    display: "flex", alignItems: "center", gap: 12, padding: "14px 16px", borderRadius: 12,
                    border: `1px solid ${bookingFor === o.key ? colors.green : colors.border}`,
                    background: bookingFor === o.key ? colors.greenBg : "#fff", cursor: "pointer",
                  }}
                >
                  <input type="radio" checked={bookingFor === o.key} onChange={() => setBookingFor(o.key)} style={{ accentColor: colors.green }} />
                  {o.label}
                </label>
              ))}
            </div>
          </>
        )}

        {step === "availability" && (
          <>
            <h1 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 28, margin: "0 0 8px" }}>When are you usually free?</h1>
            <p style={{ color: colors.mutedLight, margin: "0 0 24px" }}>Used only for recommendations.</p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {AVAILABILITY_OPTIONS.map((a) => (
                <Chip key={a} label={a} active={availability.includes(a)} onClick={() => toggle(availability, setAvailability, a)} accent="green" radius={11} padding="9px 16px" />
              ))}
            </div>
          </>
        )}

        {step === "comfort" && (
          <>
            <h1 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 28, margin: "0 0 8px" }}>A couple more, if you like</h1>
            <p style={{ color: colors.mutedLight, margin: "0 0 24px" }}>All optional — helps us know what fits, not just what's near you.</p>

            <div style={{ fontSize: 13, fontWeight: 700, color: colors.muted, marginBottom: 10 }}>Preferred group size</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 22 }}>
              {GROUP_SIZE_OPTIONS.map((o) => (
                <Chip key={o.key} label={o.label} active={groupSize === o.key} onClick={() => setGroupSize(o.key)} accent="green" radius={11} padding="9px 16px" />
              ))}
            </div>

            <div style={{ fontSize: 13, fontWeight: 700, color: colors.muted, marginBottom: 10 }}>Typical budget</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 22 }}>
              {BUDGET_OPTIONS.map((o) => (
                <Chip key={o.key} label={o.label} active={budget === o.key} onClick={() => setBudget(o.key)} accent="green" radius={11} padding="9px 16px" />
              ))}
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 14.5, color: colors.text, cursor: "pointer" }}>
                <input type="checkbox" checked={beginnerFriendly} onChange={(e) => setBeginnerFriendly(e.target.checked)} style={{ accentColor: colors.green, width: 16, height: 16 }} />
                I'm usually new to things — show me beginner-friendly options
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 14.5, color: colors.text, cursor: "pointer" }}>
                <input type="checkbox" checked={soloFriendly} onChange={(e) => setSoloFriendly(e.target.checked)} style={{ accentColor: colors.green, width: 16, height: 16 }} />
                I often go alone — show me solo-friendly options
              </label>
            </div>
          </>
        )}

        {step === "done" && (
          <>
            <h1 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 28, margin: "0 0 8px" }}>You're all set.</h1>
            <p style={{ color: colors.mutedLight, margin: "0 0 24px" }}>Here's what's happening around {homeCounty}, based on what you're into — real and currently open, not a demo.</p>
            {recommended === null ? (
              <div style={{ display: "flex", gap: 14, overflowX: "auto", paddingBottom: 6 }}>
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} style={{ width: 220, height: 180, borderRadius: 14, background: colors.panel, flex: "none" }} />
                ))}
              </div>
            ) : recommended.length === 0 ? (
              <EmptyState
                icon={<CalendarIcon size={22} />}
                title="Nothing open near you just yet"
                subtitle="Try widening your search distance, or explore what's around — new things get added all the time."
              />
            ) : (
              <div style={{ display: "flex", gap: 14, overflowX: "auto", paddingBottom: 6 }}>
                {recommended.map((item) => (
                  <DiscoverCard key={`${item.kind}-${item.id}`} item={item} isToday={item.date === new Date().toISOString().slice(0, 10)} />
                ))}
              </div>
            )}
          </>
        )}

        {step !== "welcome" && (
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 36 }}>
            {step === "done" ? (
              <span />
            ) : (
              <button onClick={skipAll} style={{ background: "none", border: "none", color: colors.muted, fontSize: 14, cursor: "pointer", padding: 0 }}>
                Skip for now
              </button>
            )}
            <Button onClick={step === "done" ? () => navigate("/") : next} disabled={saving}>
              {step === "done" ? "Start exploring" : step === "comfort" ? (saving ? "Saving…" : "Finish") : "Continue"}
            </Button>
          </div>
        )}
      </section>
    </div>
  );
}
