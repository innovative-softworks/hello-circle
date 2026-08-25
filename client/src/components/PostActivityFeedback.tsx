import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { fetchFeedbackStatus, submitFeedback } from "../api";
import { colors } from "../theme";
import type { FeedbackStatus } from "../api";

// Fuller post-activity feedback (IA spec §11) — the spec's 5-question set,
// not just "would you do this again" (Phase A's original, narrower prompt —
// kept as the first, always-shown question; the other 4 are optional and
// answered together in one submit, not staged one-by-one). Followed by a
// light repeat suggestion once the resident says they'd do it again again —
// matches the spec's own explicit next-step instruction for this screen.

const QUESTIONS: { key: "beginnerFriendly" | "soloFriendly" | "descriptionAccurate" | "welcoming"; label: string }[] = [
  { key: "beginnerFriendly", label: "Beginner-friendly?" },
  { key: "soloFriendly", label: "Solo-friendly?" },
  { key: "descriptionAccurate", label: "Was the description accurate?" },
  { key: "welcoming", label: "Welcoming atmosphere?" },
];

const chipRow = (
  value: string | null,
  onPick: (v: "yes" | "maybe" | "no") => void
) => (
  <div style={{ display: "flex", gap: 6 }}>
    {(["yes", "maybe", "no"] as const).map((r) => (
      <button
        key={r}
        onClick={() => onPick(r)}
        style={{
          background: value === r ? colors.green : colors.panel,
          color: value === r ? "#fff" : colors.muted,
          border: "none", borderRadius: 999, padding: "3px 10px", fontSize: 12, cursor: "pointer", fontWeight: 600,
        }}
      >
        {r}
      </button>
    ))}
  </div>
);

export function PostActivityFeedback({ kind, reference }: { kind: string; reference: string }) {
  const navigate = useNavigate();
  const [status, setStatus] = useState<FeedbackStatus | "loading">("loading");
  const [expanded, setExpanded] = useState(false);
  const [draft, setDraft] = useState<Partial<Record<(typeof QUESTIONS)[number]["key"], "yes" | "maybe" | "no">>>({});

  useEffect(() => {
    fetchFeedbackStatus(kind, reference).then(setStatus);
  }, [kind, reference]);

  if (status === "loading") return null;

  const answer = async (response: "yes" | "maybe" | "no") => {
    await submitFeedback(kind, reference, response, draft);
    setStatus({ response, beginnerFriendly: draft.beginnerFriendly ?? null, soloFriendly: draft.soloFriendly ?? null, descriptionAccurate: draft.descriptionAccurate ?? null, welcoming: draft.welcoming ?? null });
    setExpanded(false);
  };

  if (status.response) {
    return (
      <div>
        <span style={{ fontSize: 12, color: colors.greenText, fontWeight: 700 }}>Thanks for the feedback!</span>
        {status.response === "yes" && (
          <div style={{ marginTop: 6 }}>
            <button onClick={() => navigate("/explore")} style={{ background: "none", border: "none", padding: 0, color: colors.greenText, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
              Looking for more? Explore similar activities →
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={{ fontSize: 12.5, color: colors.muted }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: expanded ? 10 : 0 }}>
        Would you do this again?
        {chipRow(null, answer)}
        {!expanded && (
          <button onClick={() => setExpanded(true)} style={{ background: "none", border: "none", padding: 0, color: colors.muted, fontSize: 11.5, textDecoration: "underline", cursor: "pointer" }}>
            A few more questions
          </button>
        )}
      </div>
      {expanded && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, background: colors.panel, borderRadius: 10, padding: 10 }}>
          {QUESTIONS.map((q) => (
            <div key={q.key} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
              <span>{q.label}</span>
              {chipRow(draft[q.key] ?? null, (v) => setDraft((d) => ({ ...d, [q.key]: v })))}
            </div>
          ))}
          <p style={{ fontSize: 11, color: colors.faint, margin: "4px 0 0" }}>Answer "Would you do this again?" above to submit.</p>
        </div>
      )}
    </div>
  );
}
