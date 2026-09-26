import { useEffect, useState } from "react";
import { fetchRecommendationWeights, saveRecommendationWeights, type RecommendationWeights } from "../api/admin";
import { colors, fonts } from "../theme";
import { Button, Card, inputStyle } from "./ui";

// Admin control for For You scoring weights (Release 4) — each is the most
// that signal can add to a fit score. Stored in app_settings; takes effect
// within seconds, no redeploy. Residents only ever see plain-language
// reasons and "Great fit / Good fit / Worth exploring", never these numbers.

const LABELS: Record<keyof RecommendationWeights, string> = {
  interest: "Interest match",
  availability: "Availability match",
  distance: "Distance",
  goal: "Community goal",
  social: "Social preference",
  budget: "Budget",
  circle: "Circle relationship",
};

export function RecommendationWeightsCard() {
  const [weights, setWeights] = useState<RecommendationWeights | null>(null);
  const [defaults, setDefaults] = useState<RecommendationWeights | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    fetchRecommendationWeights()
      .then((r) => {
        setWeights(r.weights);
        setDefaults(r.defaults);
      })
      .catch(() => setWeights(null));
  }, []);

  if (!weights) return null;
  const total = Object.values(weights).reduce((a, b) => a + b, 0);

  const save = async (next: RecommendationWeights) => {
    setSaving(true);
    setMessage(null);
    try {
      setWeights((await saveRecommendationWeights(next)).weights);
      setMessage("Saved — For You uses these within a few seconds.");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Couldn't save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <h3 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 16, margin: "0 0 4px" }}>For You weights</h3>
      <p style={{ fontSize: 12.5, color: colors.mutedLight, margin: "0 0 14px" }}>
        The most each signal can add to a recommendation. Signals a resident hasn't given us don't count against them. Total: {total}.
      </p>
      <div className="grid-responsive" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 12 }}>
        {(Object.keys(LABELS) as (keyof RecommendationWeights)[]).map((k) => (
          <label key={k} style={{ fontSize: 13, color: colors.text, display: "flex", flexDirection: "column", gap: 4 }}>
            {LABELS[k]}
            <input
              type="number"
              min={0}
              max={100}
              value={weights[k]}
              onChange={(e) => setWeights({ ...weights, [k]: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })}
              style={{ ...inputStyle, maxWidth: 120 }}
            />
          </label>
        ))}
      </div>
      <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 14, flexWrap: "wrap" }}>
        <Button onClick={() => save(weights)} disabled={saving}>{saving ? "Saving…" : "Save weights"}</Button>
        {defaults && (
          <button onClick={() => save(defaults)} disabled={saving} style={{ background: "none", border: "none", padding: 0, fontSize: 13, color: colors.muted, textDecoration: "underline", cursor: "pointer" }}>
            Reset to defaults
          </button>
        )}
        {message && <span style={{ fontSize: 12.5, color: colors.muted }}>{message}</span>}
      </div>
    </Card>
  );
}
