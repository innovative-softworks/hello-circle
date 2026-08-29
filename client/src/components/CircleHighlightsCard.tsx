import { useNavigate } from "react-router-dom";
import { CalendarIcon } from "./icons";
import { Card } from "./ui";
import { dateLabel } from "../euro";
import { colors, fonts } from "../theme";
import type { Circle, CirclePlanPreview } from "../types";

// Right-rail "Upcoming highlights" (reference §26) — compact rows of the
// same real upcoming-plan data shown as cards in the main content, not a
// duplicate fetch. Reference explicitly warns against showing the exact
// same plans twice, so this takes whatever the main Upcoming Plans row
// didn't already show (or falls back to the same set if there's nothing
// left, rather than rendering an empty rail card).

export function CircleHighlightsCard({ circle, plans }: { circle: Circle; plans: CirclePlanPreview[] }) {
  const navigate = useNavigate();
  if (plans.length === 0) return null;

  return (
    <Card>
      <h3 style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: 16, margin: "0 0 12px", letterSpacing: "-.01em" }}>Upcoming highlights</h3>
      <div style={{ display: "flex", flexDirection: "column" }}>
        {plans.slice(0, 3).map((p) => (
          <button
            key={p.id}
            onClick={() => navigate(`/games/${p.id}`)}
            style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", textAlign: "left", background: "none", border: "none", borderTop: `1px solid ${colors.border}`, padding: "10px 0", cursor: "pointer" }}
          >
            <div style={{ flex: "none", width: 34, height: 34, borderRadius: 8, background: colors.greenBg, color: colors.greenText, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <CalendarIcon size={15} />
            </div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontWeight: 700, fontSize: 13.5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.activityLabel}</div>
              <div style={{ fontSize: 12, color: colors.mutedLight }}>{dateLabel(p.date)} · {p.time}</div>
              <div style={{ fontSize: 12, color: colors.mutedLight }}>{p.joined} going</div>
            </div>
          </button>
        ))}
      </div>
      <button
        onClick={() => navigate(`/games?activity=${encodeURIComponent(circle.activityLabel)}`)}
        style={{ marginTop: 10, background: "none", border: "none", padding: 0, fontSize: 12.5, fontWeight: 700, color: colors.text, cursor: "pointer" }}
      >
        View all upcoming plans →
      </button>
    </Card>
  );
}
