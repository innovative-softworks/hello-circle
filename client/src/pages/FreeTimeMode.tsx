import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { fetchFreeTimeOptions } from "../api";
import { DiscoverCard } from "../components/DiscoverRow";
import { ChevronRightIcon, LightbulbIcon } from "../components/icons";
import { Button, EmptyState, PageSpinner } from "../components/ui";
import { BackLink } from "../components/BackLink";
import { colors, fonts } from "../theme";
import { fallbackCopy } from "../copy";
import type { DiscoverItem } from "../types";

// Free Time Mode (implementation plan Phase 9) — a new discovery entry
// point for "I have some free time, surprise me" rather than "I already
// know what I'm looking for." Deliberately a thin wizard over the existing
// discover ranking (GET /discover/free-time reuses the exact same
// rankScore() as the homepage feed) — no new ranking logic, just a
// duration → distance → mood front door onto it.
//
// Redesign pass — same editorial visual language as /for-venues and the
// Home.tsx redesign (poster-scale typography, a "/" accent eyebrow, one
// numbered step tracker) rather than the small centered-card wizard this
// page used to be. Deliberately overrides PageTitle's shared type.hero
// scale for the per-step question (not "Free Time Mode" itself, which
// stays a small persistent eyebrow) — the question is this page's real
// headline moment, the same call ForVenues/Home already made for their
// own poster headlines.

const ACCENT = "#FF4A1F";

const DURATIONS = [
  { label: "30 minutes", maxMinutes: 30 },
  { label: "1 hour", maxMinutes: 60 },
  { label: "2 hours", maxMinutes: 120 },
  { label: "Half a day", maxMinutes: 300 },
];

const DISTANCES = [
  { label: "Walking distance", radiusKm: 2 },
  { label: "A short trip", radiusKm: 10 },
  { label: "Anywhere nearby", radiusKm: undefined },
];

const MOODS = [
  { label: "Active", value: "active" },
  { label: "Chill", value: "chill" },
  { label: "Social", value: "social" },
  { label: "Creative", value: "creative" },
  { label: "Surprise me", value: "any" },
];

type Step = "duration" | "distance" | "mood" | "results";

const STEPS: { key: Exclude<Step, "results">; n: string; label: string; question: string }[] = [
  { key: "duration", n: "01", label: "Time", question: "How much time have you got?" },
  { key: "distance", n: "02", label: "Distance", question: "How far are you willing to go?" },
  { key: "mood", n: "03", label: "Mood", question: "What are you in the mood for?" },
];

// The numbered step tracker — echoes ForVenues' VendorHowItWorks numerals
// and Home's "01/02" section badges, now doing real work as wizard
// progress rather than pure decoration.
function StepTracker({ step }: { step: Step }) {
  const currentIndex = step === "results" ? STEPS.length : STEPS.findIndex((s) => s.key === step);
  return (
    <div style={{ display: "flex", gap: 28, marginBottom: 36 }}>
      {STEPS.map((s, i) => {
        const state = i < currentIndex ? "done" : i === currentIndex ? "current" : "upcoming";
        return (
          <div key={s.key} style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <span
              style={{
                fontFamily: fonts.display,
                fontWeight: 800,
                fontSize: 15,
                color: state === "upcoming" ? colors.borderStrong : ACCENT,
              }}
            >
              {s.n}
            </span>
            <span
              style={{
                fontSize: 13.5,
                fontWeight: 700,
                color: state === "current" ? colors.text : colors.mutedLight,
                textDecoration: state === "current" ? "underline" : "none",
                textDecorationColor: ACCENT,
                textDecorationThickness: 2,
                textUnderlineOffset: 4,
              }}
            >
              {s.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// Full-width editorial choice rows (ForVenues' ProviderTypeGrid list
// treatment) rather than the previous grid of small bordered cards — one
// big, confident tap target per option instead of a dense card grid.
function ChoiceList({ options, onPick }: { options: { label: string }[]; onPick: (i: number) => void }) {
  return (
    <div style={{ borderTop: `1px solid ${colors.border}` }}>
      {options.map((o, i) => (
        <button
          key={o.label}
          onClick={() => onPick(i)}
          className="link-accent"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            width: "100%",
            background: "none",
            border: "none",
            borderBottom: `1px solid ${colors.border}`,
            padding: "22px 4px",
            cursor: "pointer",
            textAlign: "left",
          }}
        >
          <span style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: "clamp(19px, 2.6vw, 26px)", letterSpacing: "-.01em", color: colors.text }}>
            {o.label}
          </span>
          <span style={{ color: colors.faint, display: "flex", flex: "none" }}>
            <ChevronRightIcon size={20} />
          </span>
        </button>
      ))}
    </div>
  );
}

export function FreeTimeMode() {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>("duration");
  const [maxMinutes, setMaxMinutes] = useState<number | undefined>(undefined);
  const [radiusKm, setRadiusKm] = useState<number | undefined>(undefined);
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [options, setOptions] = useState<DiscoverItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  const runSearch = async (mood: string) => {
    setLoading(true);
    setError(null);
    setStep("results");
    try {
      const rows = await fetchFreeTimeOptions({
        maxMinutes,
        mood,
        radiusKm,
        lat: radiusKm !== undefined ? coords?.lat : undefined,
        lng: radiusKm !== undefined ? coords?.lng : undefined,
      });
      setOptions(rows);
    } catch (e) {
      setError(e instanceof Error ? e.message : fallbackCopy.notFound);
    } finally {
      setLoading(false);
    }
  };

  const handlePickDistance = (i: number) => {
    const chosen = DISTANCES[i];
    if (chosen.radiusKm === undefined) {
      setRadiusKm(undefined);
      setStep("mood");
      return;
    }
    if (!navigator.geolocation) {
      setLocationError("Location isn't available in this browser — showing everywhere nearby instead.");
      setRadiusKm(undefined);
      setStep("mood");
      return;
    }
    setLocating(true);
    setLocationError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setRadiusKm(chosen.radiusKm);
        setLocating(false);
        setStep("mood");
      },
      () => {
        setLocationError("Couldn't get your location — showing everywhere nearby instead.");
        setRadiusKm(undefined);
        setLocating(false);
        setStep("mood");
      },
      { timeout: 8000 }
    );
  };

  const restart = () => {
    setStep("duration");
    setMaxMinutes(undefined);
    setRadiusKm(undefined);
    setCoords(null);
    setOptions([]);
    setError(null);
  };

  const currentMeta = step !== "results" ? STEPS.find((s) => s.key === step) : null;

  return (
    <div style={{ animation: "fadeUp .35s ease both" }}>
      {/* Utility strip — mirrors /for-venues' hero utility bar: a small
          persistent page label + a live step readout, before the page's
          own giant per-step question takes over. */}
      <div className="section-pad" style={{ maxWidth: 820, margin: "0 auto", padding: "20px 24px 16px" }}>
        <div
          className="stack-mobile"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            borderBottom: `1px solid ${colors.border}`,
            paddingBottom: 16,
          }}
        >
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 11.5, fontWeight: 700, letterSpacing: ".09em", textTransform: "uppercase", color: colors.mutedLight }}>
            <LightbulbIcon size={15} style={{ color: ACCENT }} /> Free Time Mode
          </span>
          {step === "results" ? (
            <button onClick={restart} style={{ background: "none", border: "none", color: colors.text, fontWeight: 700, fontSize: 13.5, cursor: "pointer" }}>
              Start over
            </button>
          ) : (
            <span style={{ fontSize: 12.5, fontWeight: 700, color: colors.mutedLight }}>
              Step {STEPS.findIndex((s) => s.key === step) + 1} of {STEPS.length}
            </span>
          )}
        </div>
      </div>

      <section className="section-pad" style={{ maxWidth: 820, margin: "0 auto", padding: "8px 24px 80px" }}>
        {step !== "duration" && step !== "results" && (
          <BackLink onClick={() => setStep(step === "distance" ? "duration" : "distance")} marginBottom={4}>
            Back
          </BackLink>
        )}

        {currentMeta && (
          <>
            <StepTracker step={step} />
            <h1
              style={{
                fontFamily: fonts.display,
                fontWeight: 800,
                fontSize: "clamp(32px, 5vw, 52px)",
                lineHeight: 1.02,
                letterSpacing: "-.02em",
                margin: "0 0 32px",
                color: colors.text,
              }}
            >
              {currentMeta.question}
            </h1>
          </>
        )}

        {step === "duration" && <ChoiceList options={DURATIONS} onPick={(i) => { setMaxMinutes(DURATIONS[i].maxMinutes); setStep("distance"); }} />}

        {step === "distance" && (
          <>
            {locationError && <p style={{ color: colors.orangeDark, fontSize: 13, margin: "0 0 16px" }}>{locationError}</p>}
            {locating ? <PageSpinner /> : <ChoiceList options={DISTANCES} onPick={handlePickDistance} />}
          </>
        )}

        {step === "mood" && <ChoiceList options={MOODS} onPick={(i) => runSearch(MOODS[i].value)} />}

        {step === "results" && (
          <>
            <div style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: ".09em", textTransform: "uppercase", color: colors.mutedLight, marginBottom: 8 }}>
              <span style={{ color: ACCENT }} aria-hidden="true">
                /
              </span>{" "}
              Your options
            </div>
            <h1 style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: "clamp(28px, 4vw, 42px)", letterSpacing: "-.02em", margin: "0 0 32px", color: colors.text }}>
              Here's what fits.
            </h1>

            {loading ? (
              <PageSpinner />
            ) : error ? (
              <p style={{ color: colors.danger, fontSize: 14 }}>{error}</p>
            ) : options.length === 0 ? (
              <EmptyState
                icon={<LightbulbIcon size={22} />}
                title="Nothing matches yet"
                subtitle="Try a wider distance or a different mood."
                action={<Button onClick={restart}>Start over</Button>}
              />
            ) : (
              <>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 16 }}>
                  {options.map((item) => (
                    <DiscoverCard key={`${item.kind}-${item.id}`} item={item} isToday={item.date === new Date().toISOString().slice(0, 10)} />
                  ))}
                </div>
                <div style={{ marginTop: 32 }}>
                  <Button variant="ghost" onClick={restart}>
                    Try different filters
                  </Button>
                </div>
              </>
            )}
          </>
        )}
      </section>
    </div>
  );
}
