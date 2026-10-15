import type { PublicDecision } from "../api";
import { colors } from "../theme";

// D-03 — shows a partner or applicant why HelloCircle made a decision: the
// reason category and the explanation the admin wrote for them. The internal
// note never reaches the client. Decisions made before reasons were recorded
// have no entry: say so, never invent a reason.

export function DecisionExplanation({ decision, loaded = true }: { decision: PublicDecision | null | undefined; loaded?: boolean }) {
  if (!loaded) return null;
  if (!decision || (!decision.explanation && !decision.categoryLabel)) {
    return (
      <p style={{ fontSize: 13, color: colors.mutedLight, margin: "8px 0 0" }}>
        No reason was recorded for this decision. <a href="/contact">Contact HelloCircle</a> if you'd like to know more.
      </p>
    );
  }
  return (
    <div style={{ fontSize: 13.5, margin: "10px 0 0", textAlign: "left" }} data-testid="decision-explanation">
      {decision.categoryLabel && (
        <div>
          <strong>Reason:</strong> {decision.categoryLabel}
        </div>
      )}
      {decision.explanation && <div style={{ whiteSpace: "pre-wrap", marginTop: 4 }}>{decision.explanation}</div>}
      <div style={{ fontSize: 12.5, color: colors.mutedLight, marginTop: 6 }}>
        Decided {new Date(decision.decidedAt).toLocaleDateString("en-IE", { day: "numeric", month: "short", year: "numeric" })}. If you think this is wrong, you can{" "}
        <a href="/complaints">raise a complaint</a> or <a href="/contact">contact HelloCircle</a>.
      </div>
    </div>
  );
}
