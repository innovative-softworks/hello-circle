import { useEffect, useState } from "react";
import { fetchVendorToday } from "../api";
import { BallIcon, BuildingIcon, CalendarIcon, ChatIcon, CheckIcon, EyeIcon, LightbulbIcon } from "./icons";
import { Card, EmptyState, StatRow, StatTile } from "./ui";
import { CommunityIllustration } from "./illustrations";
import { VendorScheduleTab } from "./VendorPrograms";
import { useAuth } from "../AuthContext";
import { colors, fonts } from "../theme";
import type { VendorStats, VendorToday } from "../types";

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
          <div style={{ width: 34, height: 34, borderRadius: 10, background: "#FFF3D6", color: "#9A6B00", display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}>
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
export function VendorOverviewTab({ stats, unreadCount }: { stats: VendorStats; unreadCount: number }) {
  const { user } = useAuth();
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
      {/* Public profile preview (IA spec §14) — links to the same page
          built for the resident-facing side in §5 (routes/providers.ts,
          ProviderProfile.tsx); only resolves once the vendor account is
          approved, same gate as the route itself. */}
      {user && (
        <a
          href={`/provider/${user.id}`}
          target="_blank"
          rel="noreferrer"
          style={{ display: "inline-flex", alignItems: "center", gap: 6, alignSelf: "flex-start", fontSize: 13, fontWeight: 700, color: colors.greenText, textDecoration: "none" }}
        >
          <EyeIcon size={14} /> View your public profile
        </a>
      )}
      <StatRow marginBottom={0}>
        <StatTile icon={<BuildingIcon size={19} />} iconBg={colors.greenBg} iconColor={colors.green} value={stats.centresLive} label="Community centres" sublabel="Live listings" sublabelColor={colors.greenText} />
        <StatTile icon={<BallIcon size={19} />} iconBg={colors.orangeBg} iconColor={colors.orange} value={stats.clubsLive} label="Sports clubs" sublabel="Live listings" sublabelColor={colors.orangeDark} />
        <StatTile icon={<CalendarIcon size={19} />} iconBg="#E9F0FC" iconColor="#3B5FCC" value={stats.totalBookings} label="Total bookings" sublabel="All time" sublabelColor="#3B5FCC" />
        <StatTile icon={<EyeIcon size={19} />} iconBg="#F1E9FC" iconColor="#7B4FCC" value={stats.totalViews} label="Total views" sublabel="All time" sublabelColor="#7B4FCC" />
        <StatTile icon={<ChatIcon size={19} />} iconBg={colors.panel} iconColor={colors.muted} value={unreadCount} label="Unread messages" sublabel="From users" sublabelColor={colors.mutedLight} />
      </StatRow>
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
              <div key={b.ref} style={{ display: "flex", justifyContent: "space-between", background: colors.greenBg, borderRadius: 10, padding: "10px 14px", fontSize: 13.5 }}>
                <span><strong>{b.time}</strong> · {b.centreName} — {b.name}</span>
                <span>{b.guests} guests</span>
              </div>
            ))}
            {today.clubSessions.map((s) => (
              <div key={s.id} style={{ display: "flex", justifyContent: "space-between", background: colors.orangeBg, borderRadius: 10, padding: "10px 14px", fontSize: 13.5 }}>
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
