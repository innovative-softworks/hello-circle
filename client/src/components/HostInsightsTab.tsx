import { fetchHostInsights } from "../api";
import { CalendarDays, CalendarX2, Clock, Repeat, TrendingUp, UserCheck, Users, type LucideIcon } from "lucide-react";
import { StatTile } from "./ui";
import { Box, Loaded, useAdminData } from "./admin/adminUi";
import type { HostInsights } from "../types";

// Host Experience Polish — mirrors VendorOrg.tsx's InsightsPanel exactly in
// spirit: a real narrative sentence + a plain stat grid, no charting
// library ("decisions, not decorative charts" — same convention that
// component's own comment cites, applied here to Host data). See
// HostInsights's own comment in types.ts for what's Host-specific about it.

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function HostInsightsTab() {
  const state = useAdminData<HostInsights>(() => fetchHostInsights());
  return (
    <Loaded state={state} title="Couldn't load your insights">
      {(insights) => <HostInsightsView insights={insights} />}
    </Loaded>
  );
}

function HostInsightsView({ insights }: { insights: HostInsights }) {

  const { totals } = insights;
  const cancellationRate = totals.totalSessions > 0 ? Math.round((totals.cancelledSessions / totals.totalSessions) * 100) : 0;

  const stats: { label: string; value: string | number; sub: string; icon: LucideIcon }[] = [
    { label: "Sessions hosted", value: totals.totalSessions, sub: "All time", icon: CalendarDays },
    { label: "Unique participants", value: totals.uniqueParticipants, sub: "People who joined", icon: Users },
    { label: "Cancellation rate", value: `${cancellationRate}%`, sub: "Of your sessions", icon: CalendarX2 },
    { label: "Repeat participants", value: insights.repeatParticipantPercent !== null ? `${insights.repeatParticipantPercent}%` : "—", sub: "Came back again", icon: Repeat },
    { label: "Attendance rate", value: insights.attendanceRatePercent !== null ? `${insights.attendanceRatePercent}%` : "—", sub: "Checked in", icon: UserCheck },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {(insights.narrative || insights.trend.lastMonth > 0) && (
        <div className="ws-line" data-tone="good">
          <TrendingUp size={17} strokeWidth={1.9} aria-hidden="true" />
          <span>
            {insights.narrative && <strong>{insights.narrative} </strong>}
            {insights.trend.lastMonth > 0 && (
              <>
                {insights.trend.thisMonth} sessions hosted this month
                {insights.trend.deltaPercent !== null && (
                  <>
                    {" "}
                    ({insights.trend.deltaPercent >= 0 ? "+" : ""}
                    {insights.trend.deltaPercent}% vs last month)
                  </>
                )}
              </>
            )}
          </span>
        </div>
      )}
      <div className="ws-stats">
        {stats.map((st) => {
          const Icon = st.icon;
          return <StatTile key={st.label} icon={<Icon size={17} />} value={st.value} label={st.label} sublabel={st.sub} sublabelColor="var(--adm-muted)" />;
        })}
      </div>
      <Box title="When you host" subtitle="Your sessions by day of week and starting hour." icon={Clock}>
        {insights.utilisation.length === 0 ? (
          <p className="adm-note" style={{ margin: 0 }}>
            Nothing hosted yet.
          </p>
        ) : (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {insights.utilisation.map((u, i) => (
              <span key={i} className="adm-chip">
                {DAY_NAMES[(u.dayOfWeek - 1) % 7]} {u.hour}:00 · {u.n} session{u.n === 1 ? "" : "s"}
              </span>
            ))}
          </div>
        )}
      </Box>
    </div>
  );
}
