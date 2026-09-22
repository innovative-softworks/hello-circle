import { useEffect, useState } from "react";
import { fetchVendorToday } from "../api";
import { BallIcon, BuildingIcon, CalendarIcon, ChatIcon, CheckIcon, EyeIcon, LightbulbIcon } from "./icons";
import { ManageCard as Card, EmptyState, KpiHero, KpiStrip, StatTile } from "./ui";
import { CommunityIllustration } from "./illustrations";
import { VendorAttentionPanel, type AttentionTargetTab } from "./VendorAttention";
import { VendorScheduleTab } from "./VendorPrograms";
import { colors, fonts, radius } from "../theme";
import type { VendorListingSummary, VendorStats, VendorToday } from "../types";

// The Overview tab (KPI row, same-day summary, engagement tips) — split
// out of the original single VendorDashboard.tsx (see CLAUDE.md).

// Static engagement-tips panel at the bottom of Overview — not tied to any
// fetched data, just evergreen advice for getting more bookings.
const TIPS = [
  { title: "Complete your profile", desc: "Listings with photos, opening hours, and a full description get more clicks." },
  { title: "Keep your calendar updated", desc: "Block off unavailable dates so guests don't try to book them." },
  { title: "Respond to messages quickly", desc: "Fast replies build trust and turn enquiries into bookings." },
];

function TipsPanel() {
  return (
    <Card style={{ display: "flex", gap: 24, alignItems: "center", flexWrap: "wrap" }}>
      <div style={{ flex: "1 1 320px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
          <div style={{ width: 34, height: 34, borderRadius: radius.control, background: "#FFF3D6", color: "#9A6B00", display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}>
            <LightbulbIcon size={17} />
          </div>
          <h4 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 16, margin: 0 }}>Tips to get more bookings</h4>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {TIPS.map((t) => (
            <div key={t.title} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
              <div style={{ width: 20, height: 20, borderRadius: "50%", background: colors.greenBg, color: colors.green, display: "flex", alignItems: "center", justifyContent: "center", flex: "none", marginTop: 1 }}>
                <CheckIcon size={12} />
              </div>
              <div>
                <div style={{ fontWeight: 700, fontSize: 13.5 }}>{t.title}</div>
                <div style={{ color: colors.muted, fontSize: 12.5 }}>{t.desc}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="hide-mobile" style={{ width: 170, height: 130, flex: "none" }}>
        <CommunityIllustration />
      </div>
    </Card>
  );
}

// At-a-glance landing tab — the KPI row (moved here from the top-of-page
// header, which used to render it unconditionally on every tab), a
// same-day summary of hall bookings + club sessions (GET /vendor/today),
// the standalone Schedule tab's own Today/Upcoming (program sessions), and
// a static engagement-tips panel.
export function VendorOverviewTab({
  stats,
  unreadCount,
  listings,
  onNavigateTab,
}: {
  stats: VendorStats;
  unreadCount: number;
  listings: { centres: VendorListingSummary[]; clubs: VendorListingSummary[] };
  onNavigateTab: (tab: AttentionTargetTab) => void;
}) {
  const [today, setToday] = useState<VendorToday | null>(null);
  const [todayError, setTodayError] = useState(false);
  useEffect(() => {
    fetchVendorToday()
      .then(setToday)
      .catch(() => setTodayError(true));
  }, []);

  const nothingToday = today !== null && today.bookings.length === 0 && today.clubSessions.length === 0;

  return (
    <div className="fade-panel" style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <VendorAttentionPanel listings={listings} unreadCount={unreadCount} onNavigateTab={onNavigateTab} />
      <KpiStrip
        marginBottom={0}
        hero={
          <KpiHero icon={<CalendarIcon size={19} />} value={stats.totalBookings} label="Total bookings" sublabel="All time" sublabelColor={colors.mutedLight} />
        }
      >
        <StatTile icon={<BuildingIcon size={19} />} value={stats.centresLive} label="Community centres" sublabel="Live listings" sublabelColor={colors.greenText} />
        <StatTile icon={<BallIcon size={19} />} value={stats.clubsLive} label="Sports clubs" sublabel="Live listings" sublabelColor={colors.orangeDark} />
        <StatTile icon={<EyeIcon size={19} />} value={stats.totalViews} label="Total views" sublabel="All time" sublabelColor={colors.mutedLight} />
        <StatTile icon={<ChatIcon size={19} />} value={unreadCount} label="Unread messages" sublabel="From users" sublabelColor={colors.mutedLight} />
      </KpiStrip>
      <Card>
        <h4 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 16, margin: "0 0 14px" }}>Today — hall bookings &amp; club sessions</h4>
        {todayError ? (
          <p style={{ fontSize: 13, color: colors.orangeDark }}>Couldn't load today's activity — try refreshing.</p>
        ) : today === null ? (
          <p style={{ fontSize: 13, color: colors.faint }}>Loading…</p>
        ) : nothingToday ? (
          <EmptyState icon={<CalendarIcon size={22} />} title="Nothing on today" />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {today.bookings.map((b) => (
              <div key={b.ref} style={{ display: "flex", justifyContent: "space-between", background: colors.greenBg, borderRadius: radius.control, padding: "10px 14px", fontSize: 13.5 }}>
                <span><strong>{b.time}</strong> · {b.centreName} — {b.name}</span>
                <span>{b.guests} guests</span>
              </div>
            ))}
            {today.clubSessions.map((s) => (
              <div key={s.id} style={{ display: "flex", justifyContent: "space-between", background: colors.orangeBg, borderRadius: radius.control, padding: "10px 14px", fontSize: 13.5 }}>
                <span><strong>{s.time}</strong> · {s.clubName}{s.label ? ` — ${s.label}` : ""}</span>
                <span>{s.instructorName || (s.capacity ? `cap ${s.capacity}` : "")}</span>
              </div>
            ))}
          </div>
        )}
      </Card>
      <VendorScheduleTab />
      <TipsPanel />
    </div>
  );
}
