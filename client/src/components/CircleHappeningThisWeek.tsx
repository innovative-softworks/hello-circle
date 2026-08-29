import { useNavigate } from "react-router-dom";
import { ArrowRightIcon } from "./icons";
import { colors, fonts } from "../theme";
import type { Circle } from "../types";

const DAY_MS = 86400000;

function dayLabel(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  return ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"][d.getDay()];
}

// "Happening this week" (§32) — a numbered editorial list, deliberately not
// another card grid, so the page doesn't read as one repeating pattern.
// Only Circles with a real nextPlan inside the next 7 days ever appear here.

export function CircleHappeningThisWeek({ circles }: { circles: Circle[] }) {
  const navigate = useNavigate();
  const thisWeek = circles
    .filter((c) => c.nextPlan && (new Date(`${c.nextPlan.date}T00:00:00`).getTime() - Date.now()) / DAY_MS <= 7)
    .sort((a, b) => `${a.nextPlan!.date}${a.nextPlan!.time}`.localeCompare(`${b.nextPlan!.date}${b.nextPlan!.time}`))
    .slice(0, 6);

  if (thisWeek.length === 0) return null;

  return (
    <div>
      <div style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: ".09em", textTransform: "uppercase", color: colors.mutedLight, marginBottom: 6 }}>Happening</div>
      <h2 style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: "clamp(20px, 2.4vw, 26px)", letterSpacing: "-.01em", margin: "0 0 20px" }}>
        Circles meeting this week
      </h2>
      <div>
        {thisWeek.map((c, i) => (
          <button
            key={c.id}
            onClick={() => navigate(`/circles/${c.slug ?? c.id}`)}
            style={{
              display: "flex", alignItems: "center", gap: 20, width: "100%", textAlign: "left", background: "none", border: "none",
              borderTop: `1px solid ${colors.border}`, padding: "18px 4px", cursor: "pointer",
            }}
          >
            <span style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: 15, color: colors.faint, flex: "none", width: 28 }}>
              {String(i + 1).padStart(2, "0")}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 15.5, color: colors.text }}>{c.name}</div>
              <div style={{ fontSize: 13, color: colors.mutedLight, marginTop: 2 }}>{c.activityLabel}{c.area ? ` · ${c.area}` : ""}</div>
            </div>
            <div style={{ flex: "none", textAlign: "right", fontSize: 12.5, fontWeight: 700, color: colors.muted, letterSpacing: ".02em" }}>
              <div>{dayLabel(c.nextPlan!.date)} · {c.nextPlan!.time}</div>
              <div style={{ color: c.nextPlan!.spotsLeft <= 3 ? colors.orangeDark : colors.mutedLight, marginTop: 2 }}>
                {c.nextPlan!.spotsLeft <= 3 && c.nextPlan!.spotsLeft > 0 ? `${c.nextPlan!.spotsLeft} spot${c.nextPlan!.spotsLeft === 1 ? "" : "s"} left` : `${c.nextPlan!.joined} going`}
              </div>
            </div>
            <ArrowRightIcon size={16} style={{ flex: "none", color: colors.faint }} />
          </button>
        ))}
      </div>
    </div>
  );
}
