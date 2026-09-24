import { BallIcon, BuildingIcon, CalendarIcon, ChatIcon, CheckIcon, EyeIcon, LightbulbIcon } from "./icons";
import { Button, ManageCard as Card, EmptyState, KpiHero, KpiStrip, StatTile } from "./ui";
import { CommunityIllustration } from "./illustrations";
import { VendorAttentionPanel } from "./VendorAttention";
import { VendorNextUpHero, VendorUpcomingList } from "./VendorOverviewCards";
import { manageTargetFor, type VendorScheduleNavTarget } from "../vendorSchedule";
import { colors, fonts, radius } from "../theme";
import type { VendorListingSummary, VendorScheduleItem, VendorStats } from "../types";

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

// At-a-glance landing tab — a "Needs your attention" panel, a cross-
// listing-type Next Up hero + Coming up list (GET /vendor/schedule-items,
// Vendor Experience Polish — superseded the old Centre/Club-only "Today"
// card and the Program-only Schedule tab that used to be embedded here too;
// the full multi-view schedule now lives only in its own Calendar tab), the
// KPI row (moved here from the top-of-page header, which used to render it
// unconditionally on every tab), and a static engagement-tips panel.
export function VendorOverviewTab({
  stats,
  unreadCount,
  listings,
  items,
  itemsError,
  onNavigateTab,
}: {
  stats: VendorStats;
  unreadCount: number;
  listings: { centres: VendorListingSummary[]; clubs: VendorListingSummary[] };
  // Vendor Experience Polish — GET /vendor/schedule-items, fetched once by
  // VendorDashboard.tsx (which also needs it for the banner's weekly
  // summary) and passed down here rather than fetched again — avoids a
  // duplicate/racy second request for the same data.
  items: VendorScheduleItem[] | null;
  itemsError: boolean;
  onNavigateTab: (tab: VendorScheduleNavTarget) => void;
}) {
  const [nextItem, ...restItems] = items ?? [];

  return (
    <div className="fade-panel" style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <VendorAttentionPanel listings={listings} unreadCount={unreadCount} onNavigateTab={onNavigateTab} />

      {itemsError ? (
        <Card>
          <p style={{ fontSize: 13, color: colors.orangeDark, margin: 0 }}>Couldn't load your upcoming schedule — try refreshing.</p>
        </Card>
      ) : items === null ? (
        <Card>
          <p style={{ fontSize: 13, color: colors.faint, margin: 0 }}>Loading…</p>
        </Card>
      ) : nextItem ? (
        <>
          <VendorNextUpHero item={nextItem} onManage={() => onNavigateTab(manageTargetFor(nextItem))} />
          {restItems.length > 0 && (
            <div>
              <h4 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 15, margin: "0 0 10px" }}>Coming up</h4>
              <VendorUpcomingList items={restItems.slice(0, 8)} onManage={(item) => onNavigateTab(manageTargetFor(item))} />
            </div>
          )}
        </>
      ) : (
        <Card>
          <EmptyState
            icon={<CalendarIcon size={22} />}
            title="Nothing scheduled yet."
            subtitle="Your upcoming bookings, sessions and activities will appear here."
            action={
              stats.centresLive + stats.clubsLive === 0 ? (
                <Button variant="ghost" onClick={() => onNavigateTab("listings")}>
                  Set up your first listing →
                </Button>
              ) : undefined
            }
          />
        </Card>
      )}

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
      <TipsPanel />
    </div>
  );
}
