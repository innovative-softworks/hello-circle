import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { fetchCentres, fetchDiscover, saveOnboarding, skipOnboarding } from "../api";
import { Chip } from "../components/Chip";
import { DiscoverCard } from "../components/DiscoverRow";
import { Button, EmptyState } from "../components/ui";
import { useGuest } from "../GuestContext";
import { colors, fonts } from "../theme";
import { CalendarIcon } from "../components/icons";
import { AVAILABILITY_OPTIONS, BUDGET_OPTIONS, GOAL_OPTIONS, GROUP_SIZE_OPTIONS, INTEREST_OPTIONS } from "../types";
import type { DiscoverItem } from "../types";

// Onboarding (Phase A, extended IA spec §2) — signal-only: stored and
// returned via fetchResidentFull(), wired into actual recommendations
// later. Skippable at every single step — never blocks using the rest of
// the app. `goals`/`comfort` fill the spec's screens 05/07; `done` fills
// screen 08 ("show immediate value" instead of ending on an empty
// dashboard) — its 3 recommendations are real fetchDiscover() rows, never
// fabricated, matching this app's own "never invent availability" rule.

const STEPS = ["location", "goals", "interests", "who", "availability", "comfort", "done"] as const;
type Step = (typeof STEPS)[number];

export function Onboarding() {
  const navigate = useNavigate();
  const { refresh } = useGuest();
  const [step, setStep] = useState<Step>("location");
  const [counties, setCounties] = useState<string[]>(["Dublin"]);
  const [homeCounty, setHomeCounty] = useState("Dublin");
  const [radiusKm, setRadiusKm] = useState(5);

  useEffect(() => {
    fetchCentres().then((centres) => {
      const list = Array.from(new Set(centres.map((c) => c.county).filter(Boolean))).sort((a, b) => a.localeCompare(b));
      if (list.length) {
        setCounties(list);
        setHomeCounty(list[0]);
      }
    });
  }, []);
  const [goals, setGoals] = useState<string[]>([]);
  const [interests, setInterests] = useState<string[]>([]);
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

  return (
    <div style={{ animation: "fadeUp .3s ease both" }}>
      <section style={{ maxWidth: 560, margin: "0 auto", padding: "48px 24px 80px" }}>
        <div style={{ display: "flex", gap: 6, marginBottom: 28 }}>
          {STEPS.map((s, i) => (
            <div key={s} style={{ flex: 1, height: 4, borderRadius: 2, background: i <= stepIndex ? colors.green : colors.border }} />
          ))}
        </div>

        {step === "location" && (
          <>
            <h1 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 28, margin: "0 0 8px" }}>Where should we look?</h1>
            <p style={{ color: colors.mutedLight, margin: "0 0 24px" }}>We'll use this to show what's actually near you.</p>
            <select value={homeCounty} onChange={(e) => setHomeCounty(e.target.value)} style={{ width: "100%", padding: "12px 14px", borderRadius: 12, border: `1px solid ${colors.inputBorder}`, fontSize: 15, marginBottom: 20 }}>
              {counties.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
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
            <h1 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 28, margin: "0 0 8px" }}>What are you interested in?</h1>
            <p style={{ color: colors.mutedLight, margin: "0 0 24px" }}>Pick as many as you like.</p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {INTEREST_OPTIONS.map((i) => (
                <Chip key={i} label={i} active={interests.includes(i)} onClick={() => toggle(interests, setInterests, i)} accent="green" radius={11} padding="9px 16px" />
              ))}
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
            <h1 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 28, margin: "0 0 8px" }}>You're set — here's what's on this week.</h1>
            <p style={{ color: colors.mutedLight, margin: "0 0 24px" }}>Real, currently-open things near {homeCounty} — not a demo.</p>
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
      </section>
    </div>
  );
}
