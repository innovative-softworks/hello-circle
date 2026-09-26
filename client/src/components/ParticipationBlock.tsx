import { useState } from "react";
import { attributeLabel, splitAttributes } from "../participationVocab";
import { colors, radius } from "../theme";
import { UsersIcon } from "./icons";

// Participation block for detail pages (Release 2) — the "will I feel
// comfortable going?" line: at most three host-selected attributes (the
// rest behind "+N more", no badge wall), and, for games, how many are going
// and how many of them are first-timers (aggregate, server-thresholded).
// Renders nothing when there's nothing real to say.

export function ParticipationBlock({ attributes, going, firstTimers }: { attributes?: string[]; going?: number; firstTimers?: number | null }) {
  const [showAll, setShowAll] = useState(false);
  const { primary, rest } = splitAttributes(attributes);
  const shown = showAll ? [...primary, ...rest] : primary;
  const hasCounts = !!going && going > 0;
  if (!shown.length && !hasCounts) return null;

  return (
    <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 10 }}>
      {hasCounts && (
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13.5, color: colors.muted }}>
          <UsersIcon size={14} />
          <span>
            <strong style={{ color: colors.text }}>{going} going</strong>
            {firstTimers ? ` · ${firstTimers} first-timers` : ""}
          </span>
        </div>
      )}
      {shown.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
          {shown.map((k) => (
            <span
              key={k}
              style={{ fontSize: 12.5, fontWeight: 700, color: colors.text, border: `1px solid ${colors.borderStrong}`, borderRadius: radius.pill, padding: "4px 11px" }}
            >
              {attributeLabel(k)}
            </span>
          ))}
          {rest.length > 0 && (
            <button
              type="button"
              onClick={() => setShowAll((v) => !v)}
              style={{ background: "none", border: "none", padding: "4px 2px", fontSize: 12.5, fontWeight: 700, color: colors.muted, cursor: "pointer", textDecoration: "underline" }}
            >
              {showAll ? "Show less" : `+${rest.length} more`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
