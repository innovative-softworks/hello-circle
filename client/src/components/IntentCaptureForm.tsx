import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { fetchIntentCount, submitIntent } from "../api/public";
import { colors } from "../theme";
import type { IntentCount } from "../types";
import { Button, inputStyle } from "./ui";

// Explicit unmet-demand capture (participation-intent plan Phase 1) — the
// `action` slot of an EmptyState (see ui.tsx), shown wherever search/browse
// comes up empty. Deliberately minimal: one optional notes field, no
// skill/price/venue fields (see server/src/routes/participationIntents.ts's
// v1 scope note).

export function IntentCaptureForm({
  activityLabel,
  county,
  startHref,
  startLabel = "Or start a plan yourself →",
}: {
  activityLabel: string;
  county: string;
  /** Override the "start it yourself" link — defaults to Games' own create
   * flow (§ Games.tsx's "Host a game instead"). The Circles discovery page
   * points this at /circles instead, since "start a plan" isn't the right
   * next step when someone's actually looking for a recurring Circle. */
  startHref?: string;
  startLabel?: string;
}) {
  const navigate = useNavigate();
  const [count, setCount] = useState<IntentCount | null>(null);
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!activityLabel) return;
    fetchIntentCount(activityLabel, county)
      .then(setCount)
      .catch(() => setCount(null));
  }, [activityLabel, county]);

  if (!activityLabel.trim()) return null;

  const startUrl = startHref ?? `/games/host?activity=${encodeURIComponent(activityLabel)}`;

  if (submitted) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
        <div style={{ fontSize: 13.5, fontWeight: 600, color: colors.text }}>
          You're counted in — we'll let you know if a {activityLabel.toLowerCase()} plan comes together{county ? ` in ${county}` : ""}.
        </div>
        <button
          onClick={() => navigate(startUrl)}
          style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontSize: 12.5, fontWeight: 700, color: colors.dark }}
        >
          {startLabel}
        </button>
      </div>
    );
  }

  const handleSubmit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await submitIntent({ activityLabel, county, notes: notes.trim() || undefined });
      setSubmitted(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save your interest");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, maxWidth: 340, margin: "0 auto" }}>
      {!!count && count.count > 0 && (
        <div style={{ fontSize: 12, fontWeight: 700, color: colors.orangeDark, background: colors.orangeBg, borderRadius: 100, padding: "3px 10px" }}>
          {count.count} {count.count === 1 ? "person is" : "people are"} already interested
        </div>
      )}
      <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Anything to add? (optional)" style={inputStyle} />
      {error && <div style={{ fontSize: 12.5, color: colors.danger }}>{error}</div>}
      <Button onClick={handleSubmit} disabled={submitting} full>
        {submitting ? "Saving…" : `I'm interested in ${activityLabel}`}
      </Button>
      <button
        onClick={() => navigate(startUrl)}
        style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontSize: 12.5, fontWeight: 700, color: colors.muted }}
      >
        {startLabel}
      </button>
    </div>
  );
}
