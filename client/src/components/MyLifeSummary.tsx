import type { ReactNode } from "react";
import { CalendarIcon, CheckCircleIcon, RepeatIcon, UsersIcon } from "./icons";
import { colors, fonts } from "../theme";

// Participation summary strip (My Life redesign v2 §8) — deliberately
// reduced visual weight vs. the previous pass: no "Plans joined" (redundant
// once "Coming up" exists), no vanity ranking. Attended / Circles /
// Repeated / Coming up — behavioural metrics only, real data only. Same
// flat bordered-bar convention as CircleStatsBar for visual consistency.

interface Stat {
  icon: ReactNode;
  value: number;
  label: string;
}

export function MyLifeSummary({
  plansAttended, circlesCount, activeRoutines, comingUpCount,
}: { plansAttended: number; circlesCount: number; activeRoutines: number; comingUpCount: number }) {
  const stats: (Stat | null)[] = [
    plansAttended > 0 ? { icon: <CheckCircleIcon size={15} />, value: plansAttended, label: `Attended` } : null,
    circlesCount > 0 ? { icon: <UsersIcon size={15} />, value: circlesCount, label: `Circle${circlesCount === 1 ? "" : "s"}` } : null,
    activeRoutines > 0 ? { icon: <RepeatIcon size={15} />, value: activeRoutines, label: `Repeated` } : null,
    comingUpCount > 0 ? { icon: <CalendarIcon size={15} />, value: comingUpCount, label: `Coming up` } : null,
  ];
  const rows = stats.filter((s): s is Stat => s !== null);
  if (rows.length < 2) return null;

  return (
    <div className="grid-responsive-3" style={{ display: "flex", border: `1px solid ${colors.border}`, borderRadius: 2, background: colors.surface, overflow: "hidden" }}>
      {rows.map((s, i) => (
        <div key={s.label} style={{ flex: 1, minWidth: 0, padding: "11px 16px", borderLeft: i > 0 ? `1px solid ${colors.border}` : "none" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, color: colors.mutedLight, marginBottom: 3 }}>{s.icon}</div>
          <div style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: "clamp(16px,2vw,20px)", letterSpacing: "-.01em" }}>{s.value}</div>
          <div style={{ fontSize: 11, fontWeight: 600, color: colors.mutedLight, marginTop: 1 }}>{s.label}</div>
        </div>
      ))}
    </div>
  );
}
