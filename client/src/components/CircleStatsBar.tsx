import type { ReactNode } from "react";
import { CalendarIcon, RepeatIcon, TrendUpIcon, UsersIcon } from "./icons";
import { colors, fonts } from "../theme";
import type { Circle, CirclePlanPreview } from "../types";

// Circle stats bar (reference §8-9) — one bordered container with subtle
// vertical rules between metrics, not four separate KPI cards. Prioritises
// participation over vanity metrics, per the reference's own stated order,
// and never fabricates a metric the backend doesn't actually return —
// "Community rating" doesn't exist in this app's data model and stays out.

interface Stat {
  icon: ReactNode;
  value: string | number;
  label: string;
}

export function CircleStatsBar({ circle, upcoming }: { circle: Circle; upcoming: CirclePlanPreview[] }) {
  const stats: (Stat | null)[] = [
    { icon: <UsersIcon size={15} />, value: circle.members.toLocaleString(), label: `Member${circle.members === 1 ? "" : "s"}` },
    upcoming.length > 0 ? { icon: <CalendarIcon size={15} />, value: upcoming.length, label: `Plan${upcoming.length === 1 ? "" : "s"} coming up` } : null,
    circle.participantsThisMonth ? { icon: <TrendUpIcon size={15} />, value: circle.participantsThisMonth, label: "Participated this month" } : null,
    circle.repeatParticipants
      ? { icon: <RepeatIcon size={15} />, value: circle.repeatParticipants, label: "Repeat participants" }
      : circle.showUpRate != null
      ? { icon: <RepeatIcon size={15} />, value: `${circle.showUpRate}%`, label: "Show-up rate" }
      : null,
  ];
  const rows = stats.filter((s): s is Stat => s !== null).slice(0, 4);
  if (rows.length < 2) return null;

  return (
    <div
      style={{
        display: "flex",
        border: `1px solid ${colors.border}`,
        borderRadius: 2,
        background: colors.surface,
        overflow: "hidden",
      }}
    >
      {rows.map((s, i) => (
        <div
          key={s.label}
          style={{
            flex: 1,
            minWidth: 0,
            padding: "11px 16px",
            borderLeft: i > 0 ? `1px solid ${colors.border}` : "none",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 6, color: colors.mutedLight, marginBottom: 3 }}>
            {s.icon}
          </div>
          <div style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: "clamp(17px,2.2vw,22px)", letterSpacing: "-.01em" }}>{s.value}</div>
          <div style={{ fontSize: 11.5, fontWeight: 600, color: colors.mutedLight, marginTop: 1 }}>{s.label}</div>
        </div>
      ))}
    </div>
  );
}
