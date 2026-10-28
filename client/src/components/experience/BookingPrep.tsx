import { useEffect, useState } from "react";
import { fetchExperience, fetchProgrammeJourney, type JourneyState, type ProgrammeJourney } from "../../api";
import { useExperienceFeatures } from "../../circleFeatures";
import { dateLabel } from "../../euro";
import type { Experience, Game } from "../../types";
import { LoadErrorState, Skeleton } from "../ui";
import "../circle/circleExperience.css";

// Experience 3.0 on the booking detail page (/bookings/:kind/:ref).
//
// GetReady (experience.adventure_readiness): what the organiser wrote about
// meeting, kit, fitness, safety and weather — shown to the person who booked,
// word for word. Nothing is generated: an empty field is left out, and if the
// organiser wrote nothing we say so and point to them.
// ProgrammeJourney (experience.programme_journey): each session as attended /
// missed / not recorded / upcoming, from the organiser's registers only.

function Facts({ facts }: { facts: { label: string; value: string | null | undefined }[] }) {
  const shown = facts.filter((f) => f.value && f.value.trim());
  if (shown.length === 0) return <p style={{ margin: "8px 0 0", fontSize: 14 }}>The organiser hasn't added preparation notes. Message them from the listing if you have a question.</p>;
  return (
    <dl>
      {shown.map((f) => (
        <div key={f.label}>
          <dt>{f.label}</dt>
          <dd>{f.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function duration(min: number | null | undefined): string | null {
  if (!min) return null;
  return min < 60 ? `About ${min} minutes` : `About ${Math.round((min / 60) * 2) / 2} hours`;
}

export function ExperienceGetReady({ experienceId }: { experienceId: string }) {
  const on = useExperienceFeatures()["experience.adventure_readiness"];
  const [e, setE] = useState<Experience | null | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  const load = () => {
    setFailed(false);
    fetchExperience(experienceId)
      .then(setE)
      .catch(() => setFailed(true));
  };
  useEffect(() => {
    if (on) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, experienceId]);
  if (!on) return null;
  if (failed) return <LoadErrorState title="We couldn't load the preparation notes." onRetry={load} />;
  if (!e) return <Skeleton height={140} />;
  const directions = e.lat !== null && e.lng !== null && e.locationSource === "confirmed" ? `https://www.google.com/maps/dir/?api=1&destination=${e.lat},${e.lng}` : null;
  return (
    <section className="ce-guide" aria-labelledby="prep-title" style={{ maxWidth: 608, margin: "8px auto 48px", boxSizing: "border-box", width: "calc(100% - 32px)" }}>
      <h2 id="prep-title" style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>
        Get ready
      </h2>
      <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--color-muted-light)" }}>From the organiser, as they wrote it.</p>
      <Facts
        facts={[
          { label: "Where to meet", value: e.meetingPoint },
          { label: "Who welcomes newcomers", value: e.newcomerWelcome ?? null },
          { label: "How long", value: duration(e.durationMinutes) },
          { label: "Difficulty", value: e.difficulty },
          { label: "Fitness", value: e.fitnessRequirements },
          { label: "What's provided", value: e.equipmentProvided },
          { label: "What to bring", value: e.equipmentRequired },
          { label: "Getting there", value: e.transportInfo },
          { label: "Safety", value: e.safetyInfo },
          { label: "If the weather turns", value: e.weatherPolicy },
          { label: "Accessibility", value: e.accessibilityInfo ?? null },
        ]}
      />
      {directions && (
        <p style={{ margin: "12px 0 0" }}>
          <a className="ce-link" href={directions} target="_blank" rel="noreferrer">
            Directions to the meeting point
          </a>
        </p>
      )}
    </section>
  );
}

export function GameGetReady({ game }: { game: Game }) {
  const on = useExperienceFeatures()["experience.adventure_readiness"];
  if (!on) return null;
  return (
    <section className="ce-guide" aria-labelledby="prep-title" style={{ maxWidth: 608, margin: "8px auto 48px", boxSizing: "border-box", width: "calc(100% - 32px)" }}>
      <h2 id="prep-title" style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>
        Get ready
      </h2>
      <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--color-muted-light)" }}>From the host, as they wrote it.</p>
      <Facts
        facts={[
          { label: "Where to meet", value: game.meetingInstructions || game.centreName || game.locationText },
          { label: "Who welcomes newcomers", value: game.newcomerWelcome ?? null },
          { label: "How long", value: duration(game.durationMinutes ?? null) },
          { label: "What to bring", value: game.equipmentNeeded },
          { label: "Experience", value: game.experienceRequired ?? null },
          { label: "Accessibility", value: game.accessibilityInfo ?? null },
        ]}
      />
    </section>
  );
}

const STATE_LABEL: Record<JourneyState, { label: string; tone: string }> = {
  attended: { label: "Attended", tone: "ce-pill--green" },
  missed: { label: "Missed", tone: "ce-pill--orange" },
  not_recorded: { label: "Not recorded", tone: "ce-pill--muted" },
  upcoming: { label: "Upcoming", tone: "" },
  cancelled: { label: "Session cancelled", tone: "ce-pill--muted" },
};

export function ProgrammeJourneyView({ bookingRef }: { bookingRef: string }) {
  const on = useExperienceFeatures()["experience.programme_journey"];
  const [j, setJ] = useState<ProgrammeJourney | null>(null);
  const [failed, setFailed] = useState(false);
  const load = () => {
    setFailed(false);
    fetchProgrammeJourney(bookingRef)
      .then(setJ)
      .catch(() => setFailed(true));
  };
  useEffect(() => {
    if (on) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, bookingRef]);
  if (!on) return null;
  if (failed) return <LoadErrorState title="We couldn't load your sessions." onRetry={load} />;
  if (!j) return <Skeleton height={140} />;
  return (
    <section className="ce-guide" aria-labelledby="journey-title" style={{ maxWidth: 608, margin: "8px auto 48px", boxSizing: "border-box", width: "calc(100% - 32px)" }}>
      <h2 id="journey-title" style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>
        Your sessions
      </h2>
      <p style={{ margin: "4px 0 12px", fontSize: 13, color: "var(--color-muted-light)" }}>
        {j.totals.attended} attended · {j.totals.missed} missed · {j.totals.upcoming} to come. Attendance comes from the organiser's register; "not recorded" means no register was taken.
      </p>
      {j.sessions.length === 0 ? (
        <p style={{ margin: 0, fontSize: 14 }}>No sessions are scheduled yet.</p>
      ) : (
        <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
          {j.sessions.map((s, i) => (
            <li key={s.id} style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", borderTop: i ? "1px solid var(--color-border)" : 0, paddingTop: i ? 8 : 0 }}>
              <span style={{ fontSize: 14 }}>
                <strong>Session {i + 1}</strong> · {dateLabel(s.date)} · {s.time}
              </span>
              <span className={`ce-pill ${STATE_LABEL[s.state].tone}`}>{STATE_LABEL[s.state].label}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
