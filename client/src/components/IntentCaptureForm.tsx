import { useEffect, useState } from "react";
import { withdrawInterestConfirm } from "../confirmCopy";
import { useConfirm } from "./ConfirmProvider";
import { useNavigate } from "react-router-dom";
import { cancelIntent, fetchIntentCount, submitIntent } from "../api/public";
import { splitDemandQuery } from "../demandQuery";
import { colors } from "../theme";
import type { IntentCount } from "../types";
import { Button, inputStyle } from "./ui";

// Explicit unmet-demand capture (participation-intent plan Phase 1) — the
// `action` slot of an EmptyState (see ui.tsx), shown wherever search/browse
// comes up empty. Deliberately minimal: one optional notes field, no
// skill/price/venue fields (see server/src/routes/participationIntents.ts's
// v1 scope note).
//
// Release 1: the label is split into activity + timing first (see
// demandQuery.ts), so a failed "badminton sunday morning" search files into
// the same "Badminton" cluster as everyone else, with "Sunday morning" as
// its time window. When the visitor is already in the cluster, they see
// "You're interested" with an undo rather than a second submit button.

const REQUEST_DAYS = [
  { code: "mon", label: "Mon" }, { code: "tue", label: "Tue" }, { code: "wed", label: "Wed" }, { code: "thu", label: "Thu" },
  { code: "fri", label: "Fri" }, { code: "sat", label: "Sat" }, { code: "sun", label: "Sun" }, { code: "weekend", label: "Weekend" },
];

const chip = (active: boolean) => ({
  border: `1px solid ${active ? colors.green : colors.border}`,
  background: active ? colors.greenBg : colors.surface,
  color: active ? colors.greenText : colors.text,
  borderRadius: 100,
  padding: "4px 10px",
  fontSize: 12,
  fontWeight: 600,
  cursor: "pointer",
});

export function IntentCaptureForm({
  activityLabel: rawLabel,
  county,
  timeOfDay,
  maxPriceEuro,
  startHref,
  startLabel = "Or start a plan yourself →",
}: {
  activityLabel: string;
  county: string;
  /** From the search parser, when it already stripped the time words out of the query. */
  timeOfDay?: string | null;
  /** Release 6 — from the search parser ("under €15"), prefills the budget. */
  maxPriceEuro?: number | null;
  /** Override the "start it yourself" link — defaults to Games' own create
   * flow (§ Games.tsx's "Host a game instead"). The Circles discovery page
   * points this at /circles instead, since "start a plan" isn't the right
   * next step when someone's actually looking for a recurring Circle. */
  startHref?: string;
  startLabel?: string;
}) {
  const navigate = useNavigate();
  const confirm = useConfirm();
  const { activityLabel, timeWindow, days: parsedDays, time: parsedTime } = splitDemandQuery(rawLabel, timeOfDay);
  const [count, setCount] = useState<IntentCount | null>(null);
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [myIntentId, setMyIntentId] = useState<string | null>(null);
  // Release 6 — optional request details, prefilled from the search.
  const [showDetails, setShowDetails] = useState(false);
  const [days, setDays] = useState<string[]>(parsedDays);
  const [slot, setSlot] = useState(parsedTime);
  const [budgetMax, setBudgetMax] = useState(maxPriceEuro ? String(maxPriceEuro) : "");
  const [radiusKm, setRadiusKm] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setSubmitted(false);
    setMyIntentId(null);
    if (!activityLabel) return;
    fetchIntentCount(activityLabel, county)
      .then((c) => {
        setCount(c);
        setMyIntentId(c.myIntentId ?? null);
      })
      .catch(() => setCount(null));
  }, [activityLabel, county]);

  // "this" was a caller-side fallback for "no activity in context" — a
  // cluster literally named "this" helps nobody, so treat it as none.
  if (!activityLabel || activityLabel.toLowerCase() === "this") return null;
  const lowerLabel = activityLabel.toLowerCase();
  // Everyone else already in this cluster — the caller's own row, if any, is
  // included in `count`, so it's subtracted for the "join them" framing.
  const others = Math.max(0, (count?.count ?? 0) - (myIntentId ? 1 : 0));

  const startUrl = startHref ?? `/games/host?activity=${encodeURIComponent(activityLabel)}`;

  const handleUndo = async () => {
    if (!myIntentId) return;
    if (!(await confirm(withdrawInterestConfirm(lowerLabel)))) return;
    try {
      await cancelIntent(myIntentId);
      setMyIntentId(null);
      setSubmitted(false);
      setCount((c) => (c ? { ...c, count: Math.max(0, c.count - 1) } : c));
    } catch {
      // best-effort — the row simply stays active
    }
  };

  if (submitted || myIntentId) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
        <div style={{ fontSize: 13.5, fontWeight: 600, color: colors.text }}>
          {submitted ? "You're counted in" : "You're interested"}
          {others > 0 ? `, along with ${others} ${others === 1 ? "other person" : "others"}` : ""} — we'll let you know if a {lowerLabel} plan comes
          together{county ? ` in ${county}` : ""}{timeWindow ? ` (${timeWindow.toLowerCase()})` : ""}.
        </div>
        {myIntentId && (
          <button
            onClick={handleUndo}
            style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontSize: 12, color: colors.muted, textDecoration: "underline" }}
          >
            I'm no longer interested
          </button>
        )}
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
      const { id } = await submitIntent({
        activityLabel,
        county,
        preferredTimeWindow: slot || timeWindow || undefined,
        preferredDays: days.length ? days : undefined,
        budgetMaxEuro: budgetMax ? Number(budgetMax) : undefined,
        radiusKm: radiusKm ? Number(radiusKm) : undefined,
        sourceQuery: rawLabel,
        notes: notes.trim() || undefined,
      });
      setMyIntentId(id);
      setSubmitted(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save your interest");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, maxWidth: 340, margin: "0 auto" }}>
      {others > 0 && (
        <div style={{ fontSize: 12, fontWeight: 700, color: colors.orangeDark, background: colors.orangeBg, borderRadius: 100, padding: "3px 10px", textAlign: "center" }}>
          {others} {others === 1 ? "person already wants" : "people already want"} something similar{county ? ` in ${county}` : ""}
        </div>
      )}
      {timeWindow && <div style={{ fontSize: 12.5, color: colors.muted }}>{count?.label || activityLabel} · {timeWindow}</div>}
      {showDetails ? (
        <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 10, textAlign: "left" }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: colors.muted, marginBottom: 6 }}>Which days?</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {REQUEST_DAYS.map((d) => {
                const on = days.includes(d.code);
                return (
                  <button key={d.code} type="button" aria-pressed={on} onClick={() => setDays(on ? days.filter((x) => x !== d.code) : [...days, d.code])} style={chip(on)}>
                    {d.label}
                  </button>
                );
              })}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: colors.muted, marginBottom: 6 }}>What time?</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {["morning", "afternoon", "evening"].map((t) => (
                <button key={t} type="button" aria-pressed={slot === t} onClick={() => setSlot(slot === t ? "" : t)} style={chip(slot === t)}>
                  {t[0].toUpperCase() + t.slice(1)}
                </button>
              ))}
            </div>
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <label style={{ flex: 1, fontSize: 12, fontWeight: 700, color: colors.muted }}>
              Up to (€)
              <input type="number" min={0} value={budgetMax} onChange={(e) => setBudgetMax(e.target.value)} placeholder="Any" style={{ ...inputStyle, marginTop: 4 }} />
            </label>
            <label style={{ flex: 1, fontSize: 12, fontWeight: 700, color: colors.muted }}>
              Within (km)
              <input type="number" min={1} value={radiusKm} onChange={(e) => setRadiusKm(e.target.value)} placeholder="Any" style={{ ...inputStyle, marginTop: 4 }} />
            </label>
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => setShowDetails(true)} style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontSize: 12.5, color: colors.muted, textDecoration: "underline" }}>
          Add day, time or budget (optional)
        </button>
      )}
      <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Anything to add? (optional)" style={inputStyle} />
      {error && <div style={{ fontSize: 12.5, color: colors.danger }}>{error}</div>}
      <Button onClick={handleSubmit} disabled={submitting} full>
        {submitting ? "Saving…" : others > 0 ? "I'm interested too" : `I'm interested in ${lowerLabel}`}
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
