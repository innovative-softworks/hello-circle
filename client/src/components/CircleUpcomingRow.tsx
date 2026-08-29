import { useNavigate } from "react-router-dom";
import { ArrowRightIcon } from "./icons";
import { colors, fonts } from "../theme";
import type { CirclePlanPreview } from "../types";

function dayAbbrev(iso: string): string {
  return ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"][new Date(`${iso}T00:00:00`).getDay()];
}
function dayMonth(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  const mon = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getMonth()];
  return `${String(d.getDate()).padStart(2, "0")} ${mon}`;
}

// Swiss editorial list row (Circle Detail full rewrite §04/§09) — no photo,
// no card border, just numbered rows separated by hairlines. Used for both
// the short "Up next" list beneath the featured plan and the full
// "Upcoming calendar" section further down the page.

export function CircleUpcomingRow({ plan, index }: { plan: CirclePlanPreview; index: number }) {
  const navigate = useNavigate();
  const full = plan.spotsLeft === 0;

  return (
    <button
      onClick={() => navigate(`/games/${plan.id}`)}
      style={{
        display: "flex", alignItems: "center", gap: 24, width: "100%", textAlign: "left", background: "none", border: "none",
        borderTop: `1px solid ${colors.border}`, padding: "22px 0", cursor: "pointer",
      }}
    >
      <div style={{ flex: "none", width: 92 }}>
        <div style={{ fontSize: 11.5, fontWeight: 700, color: colors.faint, marginBottom: 4 }}>{String(index).padStart(2, "0")}</div>
        <div style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: 14, letterSpacing: ".03em" }}>{dayAbbrev(plan.date)}</div>
        <div style={{ fontSize: 12.5, color: colors.mutedLight }}>{dayMonth(plan.date)}</div>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: 20, letterSpacing: "-.01em", marginBottom: 4 }}>{plan.activityLabel}</div>
        <div style={{ fontSize: 13.5, color: colors.mutedLight }}>
          {plan.time} · {plan.centreName ?? (plan.locationText || "Location TBC")}
        </div>
      </div>
      <div style={{ flex: "none", textAlign: "right", display: "flex", alignItems: "center", gap: 20 }}>
        <div>
          <div style={{ fontSize: 13.5, fontWeight: 700, color: colors.text }}>{plan.joined} going</div>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: full ? colors.muted : plan.spotsLeft <= 3 ? colors.orangeDark : colors.mutedLight }}>
            {full ? "Full" : plan.spotsLeft === 1 ? "1 spot left" : `${plan.spotsLeft} spots left`}
          </div>
        </div>
        <ArrowRightIcon size={18} style={{ color: colors.faint }} />
      </div>
    </button>
  );
}
