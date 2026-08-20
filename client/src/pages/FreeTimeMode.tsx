import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { fetchFreeTimeOptions } from "../api";
import { DiscoverCard } from "../components/DiscoverRow";
import { BallIcon, ClockIcon, LightbulbIcon, PinIcon } from "../components/icons";
import { Button, PageSpinner } from "../components/ui";
import { BackLink } from "../components/BackLink";
import { PageTitle } from "../components/PageTitle";
import { colors, fonts } from "../theme";
import { fallbackCopy } from "../copy";
import type { DiscoverItem } from "../types";

// Free Time Mode (implementation plan Phase 9) — a new discovery entry
// point for "I have some free time, surprise me" rather than "I already
// know what I'm looking for." Deliberately a thin wizard over the existing
// discover ranking (GET /discover/free-time reuses the exact same
// rankScore() as the homepage feed) — no new ranking logic, just a
// duration → distance → mood front door onto it.

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

function ChoiceGrid({ options, onPick }: { options: { label: string }[]; onPick: (i: number) => void }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12 }}>
      {options.map((o, i) => (
        <button
          key={o.label}
          onClick={() => onPick(i)}
          className="btn-hover"
          style={{
            background: colors.surface,
            border: `1px solid ${colors.border}`,
            borderRadius: 16,
            padding: "22px 18px",
            fontSize: 16,
            fontWeight: 700,
            color: colors.text,
            cursor: "pointer",
            textAlign: "center",
          }}
        >
          {o.label}
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

  return (
    <div style={{ animation: "fadeUp .35s ease both" }}>
      <section style={{ maxWidth: 720, margin: "0 auto", padding: "36px 24px 80px" }}>
        {step !== "duration" && (
          <BackLink onClick={() => setStep(step === "distance" ? "duration" : step === "mood" ? "distance" : "duration")} marginBottom={16}>
            Back
          </BackLink>
        )}

        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
          <LightbulbIcon size={22} style={{ color: colors.orange }} />
          <PageTitle style={{ margin: 0 }}>Free Time Mode</PageTitle>
        </div>

        {step === "duration" && (
          <>
            <p style={{ color: colors.mutedLight, fontSize: 15, margin: "0 0 24px", display: "flex", alignItems: "center", gap: 6 }}>
              <ClockIcon size={15} /> How much time have you got?
            </p>
            <ChoiceGrid
              options={DURATIONS}
              onPick={(i) => {
                setMaxMinutes(DURATIONS[i].maxMinutes);
                setStep("distance");
              }}
            />
          </>
        )}

        {step === "distance" && (
          <>
            <p style={{ color: colors.mutedLight, fontSize: 15, margin: "0 0 12px", display: "flex", alignItems: "center", gap: 6 }}>
              <PinIcon size={15} /> How far are you willing to go?
            </p>
            {locationError && <p style={{ color: colors.orangeDark, fontSize: 13, margin: "0 0 12px" }}>{locationError}</p>}
            {locating ? <PageSpinner /> : <ChoiceGrid options={DISTANCES} onPick={handlePickDistance} />}
          </>
        )}

        {step === "mood" && (
          <>
            <p style={{ color: colors.mutedLight, fontSize: 15, margin: "0 0 24px", display: "flex", alignItems: "center", gap: 6 }}>
              <BallIcon size={15} /> What are you in the mood for?
            </p>
            <ChoiceGrid options={MOODS} onPick={(i) => runSearch(MOODS[i].value)} />
          </>
        )}

        {step === "results" && (
          <>
            {loading ? (
              <PageSpinner />
            ) : error ? (
              <p style={{ color: colors.danger, fontSize: 14 }}>{error}</p>
            ) : options.length === 0 ? (
              <div style={{ background: colors.surface, border: `1px dashed ${colors.borderStrong}`, borderRadius: 18, padding: 40, textAlign: "center" }}>
                <p style={{ color: colors.mutedLight, fontSize: 15, margin: "0 0 18px" }}>
                  Nothing matches that combination right now — try a wider distance or a different mood.
                </p>
                <Button onClick={restart}>Start over</Button>
              </div>
            ) : (
              <>
                <p style={{ color: colors.mutedLight, fontSize: 15, margin: "0 0 20px" }}>Here's what fits:</p>
                <div style={{ display: "flex", flexDirection: "column", gap: 16, alignItems: "center" }}>
                  {options.map((item) => (
                    <div key={`${item.kind}-${item.id}`} style={{ width: "100%", maxWidth: 320 }}>
                      <DiscoverCard item={item} isToday={item.date === new Date().toISOString().slice(0, 10)} />
                    </div>
                  ))}
                </div>
                <div style={{ marginTop: 24, textAlign: "center" }}>
                  <Button variant="ghost" onClick={restart}>Try different filters</Button>
                </div>
              </>
            )}
          </>
        )}
      </section>
    </div>
  );
}
