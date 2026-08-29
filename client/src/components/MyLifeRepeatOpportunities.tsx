import { useNavigate } from "react-router-dom";
import { Button } from "./ui";
import { colors, fonts } from "../theme";
import type { RoutineSuggestion } from "../types";

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// "Do it again?" (My Life redesign §14/§53) — real repetition-detection,
// not invented familiarity: RoutineSuggestion only exists when this
// resident has actually attended the same activity on the same weekday
// multiple times recently (see server's routine-suggestion query, the same
// one Profile → Routines already surfaces). This is the lighter, read-
// mostly presentation of that same real data on the hub — full accept/
// pause/cancel management stays in Profile → Routines.

export function MyLifeRepeatOpportunities({ suggestions }: { suggestions: RoutineSuggestion[] }) {
  const navigate = useNavigate();
  if (suggestions.length === 0) return null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {suggestions.slice(0, 2).map((s) => {
        const key = `${s.activityLabel}::${s.dayOfWeek}`;
        return (
          <div key={key} style={{ background: colors.greenBg, borderRadius: 12, padding: "18px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
            <div>
              <div style={{ fontSize: 10.5, fontWeight: 700, color: colors.greenText, textTransform: "uppercase", letterSpacing: ".05em", marginBottom: 4 }}>
                {s.activityLabel}
              </div>
              <div style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 15 }}>You've been going most {DAY_NAMES[s.dayOfWeek - 1]}s.</div>
              <div style={{ fontSize: 13, color: colors.mutedLight, marginTop: 2 }}>{s.sessionCount} times recently{s.time ? ` · usually around ${s.time}` : ""}</div>
            </div>
            <Button onClick={() => navigate(`/games?activity=${encodeURIComponent(s.activityLabel)}`)}>Join again</Button>
          </div>
        );
      })}
    </div>
  );
}
