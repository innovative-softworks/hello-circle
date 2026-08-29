import { Card } from "./ui";
import { colors, fonts } from "../theme";
import type { CircleActivityStats } from "../types";

// Right-rail "Circle activity" (reference §27) — real, period-scoped
// participation signals only. Deliberately no "photos shared" row: nothing
// in this app tracks that (see CircleActivityStats's own comment), so the
// reference's alternate 3-row set (plans/participants/new members) is used
// instead of inventing a fourth metric.

export function CircleActivityCard({ stats, period, onPeriodChange }: { stats: CircleActivityStats | null; period: "week" | "month"; onPeriodChange: (p: "week" | "month") => void }) {
  const rows: { label: string }[] = stats
    ? [
        stats.plansCreated > 0 ? { label: `${stats.plansCreated} plan${stats.plansCreated === 1 ? "" : "s"} created` } : null,
        stats.participants > 0 ? { label: `${stats.participants} people participated` } : null,
        stats.newMembers > 0 ? { label: `${stats.newMembers} new member${stats.newMembers === 1 ? "" : "s"} joined` } : null,
      ].filter((r): r is { label: string } => r !== null)
    : [];

  if (rows.length === 0) return null;

  return (
    <Card>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <h3 style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: 16, margin: 0, letterSpacing: "-.01em" }}>Circle activity</h3>
        <select
          value={period}
          onChange={(e) => onPeriodChange(e.target.value as "week" | "month")}
          style={{ border: `1px solid ${colors.inputBorder}`, borderRadius: 8, padding: "3px 6px", fontSize: 12, fontWeight: 600, color: colors.text, background: colors.bg }}
        >
          <option value="week">This week</option>
          <option value="month">This month</option>
        </select>
      </div>
      {rows.map((r, i) => (
        <div key={r.label} style={{ fontSize: 13.5, color: colors.text, padding: "9px 0", borderTop: i === 0 ? "none" : `1px solid ${colors.border}` }}>
          {r.label}
        </div>
      ))}
    </Card>
  );
}
