import { useEffect, useState } from "react";
import { fetchHostInsights } from "../api";
import { Card, PageSpinner } from "./ui";
import { colors, fonts } from "../theme";
import type { HostInsights } from "../types";

// Host Experience Polish — mirrors VendorOrg.tsx's InsightsPanel exactly in
// spirit: a real narrative sentence + a plain stat grid, no charting
// library ("decisions, not decorative charts" — same convention that
// component's own comment cites, applied here to Host data). See
// HostInsights's own comment in types.ts for what's Host-specific about it.

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function HostInsightsTab() {
  const [insights, setInsights] = useState<HostInsights | null>(null);

  useEffect(() => {
    fetchHostInsights().then(setInsights);
  }, []);

  if (!insights) return <PageSpinner />;

  const { totals } = insights;
  const cancellationRate = totals.totalSessions > 0 ? Math.round((totals.cancelledSessions / totals.totalSessions) * 100) : 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {(insights.narrative || insights.trend.lastMonth > 0) && (
        <Card style={{ background: colors.greenBg, border: "none" }}>
          {insights.narrative && (
            <p style={{ margin: insights.trend.lastMonth > 0 ? "0 0 8px" : 0, fontSize: 14, fontWeight: 700, color: colors.greenText }}>{insights.narrative}</p>
          )}
          {insights.trend.lastMonth > 0 && (
            <p style={{ margin: 0, fontSize: 13, color: colors.greenText }}>
              {insights.trend.thisMonth} sessions hosted this month
              {insights.trend.deltaPercent !== null && (
                <>
                  {" "}
                  — <strong>{insights.trend.deltaPercent >= 0 ? "+" : ""}{insights.trend.deltaPercent}%</strong> vs last month
                </>
              )}
            </p>
          )}
        </Card>
      )}
      <Card>
        <h4 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 15, margin: "0 0 14px" }}>Participation</h4>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 14 }}>
          {[
            { label: "Sessions hosted", value: totals.totalSessions },
            { label: "Unique participants", value: totals.uniqueParticipants },
            { label: "Cancellation rate", value: `${cancellationRate}%` },
            { label: "Repeat participants", value: insights.repeatParticipantPercent !== null ? `${insights.repeatParticipantPercent}%` : "—" },
            { label: "Attendance rate", value: insights.attendanceRatePercent !== null ? `${insights.attendanceRatePercent}%` : "—" },
          ].map((s) => (
            <div key={s.label}>
              <div style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 24 }}>{s.value}</div>
              <div style={{ fontSize: 12.5, color: colors.mutedLight }}>{s.label}</div>
            </div>
          ))}
        </div>
      </Card>
      <Card>
        <h4 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 15, margin: "0 0 4px" }}>When you host</h4>
        <p style={{ fontSize: 12.5, color: colors.mutedLight, margin: "0 0 14px" }}>Your sessions by day of week and starting hour.</p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {insights.utilisation.length === 0 ? (
            <span style={{ fontSize: 13, color: colors.faint }}>Nothing hosted yet.</span>
          ) : (
            insights.utilisation.map((u, i) => (
              <span key={i} style={{ fontSize: 12, background: colors.greenBg, color: colors.greenText, borderRadius: 8, padding: "5px 9px", fontWeight: 700 }}>
                {DAY_NAMES[(u.dayOfWeek - 1) % 7]} {u.hour}:00 — {u.n}
              </span>
            ))
          )}
        </div>
      </Card>
    </div>
  );
}
