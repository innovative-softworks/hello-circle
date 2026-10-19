import { VENUE_PAGES_PUBLIC } from "../venueLaunch";
import { useState } from "react";
import { AlertTriangle, Building2, CalendarDays, Eye, Lightbulb, MessageSquare, Volleyball, X, type LucideIcon } from "lucide-react";
import { AdminButton } from "./admin/adminUi";
import { OpportunitiesCard } from "./OpportunitiesCard";
import { VendorChatsCard } from "./HostChatButton";
import { VendorAttentionPanel } from "./VendorAttention";
import { VendorNextUpHero, VendorUpcomingList } from "./VendorOverviewCards";
import { manageTargetFor, type VendorScheduleNavTarget } from "../vendorSchedule";
import { fonts } from "../theme";
import type { VendorListingSummary, VendorScheduleItem, VendorStats } from "../types";

// The Overview tab (KPI row, same-day summary, engagement tips) — split
// out of the original single VendorDashboard.tsx (see CLAUDE.md).

// Evergreen advice for getting more bookings — a compact strip under the
// totals that the partner can dismiss (remembered in this browser only).
const TIPS = [
  { title: "Complete your profile", desc: "Photos, opening hours and a full description get more clicks." },
  { title: "Keep your calendar updated", desc: "Block unavailable dates so guests don't try to book them." },
  { title: "Reply quickly", desc: "Fast replies build trust and turn enquiries into bookings." },
];
const TIPS_KEY = "hc.vendor.tipsDismissed";

function TipsStrip() {
  const [hidden, setHidden] = useState(() => {
    try {
      return localStorage.getItem(TIPS_KEY) === "1";
    } catch {
      return false;
    }
  });
  if (hidden) return null;
  const dismiss = () => {
    setHidden(true);
    try {
      localStorage.setItem(TIPS_KEY, "1");
    } catch {
      /* private mode: hide for this visit only */
    }
  };
  return (
    <section className="ws-tips" aria-label="Tips to get more bookings">
      <span className="ws-tips-label">
        <Lightbulb size={16} strokeWidth={1.9} aria-hidden="true" />
        Tips
      </span>
      {TIPS.map((t) => (
        <div key={t.title} className="ws-tips-item">
          <strong>{t.title}</strong>
          {t.desc}
        </div>
      ))}
      <AdminButton variant="quiet" size="sm" className="ws-tips-close" onClick={dismiss} aria-label="Hide tips">
        <X size={15} aria-hidden="true" />
      </AdminButton>
    </section>
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
  // Each total opens the section behind it; only unread messages ask for action.
  const cards: { label: string; value: number; hint: string; icon: LucideIcon; tab: VendorScheduleNavTarget; hot?: boolean }[] = [
    { label: "Total bookings", value: stats.totalBookings, hint: "All time", icon: CalendarDays, tab: "bookings" },
    { label: "Approved centres", value: stats.centresLive, hint: approvedCaption(stats.centresLive), icon: Building2, tab: "listings" },
    { label: "Approved clubs", value: stats.clubsLive, hint: approvedCaption(stats.clubsLive), icon: Volleyball, tab: "listings" },
    { label: "Listing views", value: stats.totalViews, hint: "All time", icon: Eye, tab: "listings" },
    { label: "Unread notifications", value: unreadCount, hint: "Bookings and updates", icon: MessageSquare, tab: "messages", hot: true },
  ];

  return (
    <div className="fade-panel" style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <VendorAttentionPanel listings={listings} unreadCount={unreadCount} onNavigateTab={onNavigateTab} />
      <VendorChatsCard />
      <OpportunitiesCard audience="vendor" />

      {itemsError ? (
        <div className="ws-line" role="alert">
          <AlertTriangle size={17} strokeWidth={1.9} aria-hidden="true" />
          Couldn't load your upcoming schedule — try refreshing.
        </div>
      ) : items === null ? (
        <div className="ws-line">Loading your schedule…</div>
      ) : nextItem ? (
        <>
          <VendorNextUpHero item={nextItem} onManage={() => onNavigateTab(manageTargetFor(nextItem))} />
          {restItems.length > 0 && (
            <div>
              <h2 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 15, margin: "0 0 10px" }}>Coming up</h2>
              <VendorUpcomingList items={restItems.slice(0, 8)} onManage={(item) => onNavigateTab(manageTargetFor(item))} />
            </div>
          )}
        </>
      ) : (
        <div className="ws-line">
          <CalendarDays size={17} strokeWidth={1.9} aria-hidden="true" />
          <span>
            <strong>Nothing scheduled yet.</strong> Upcoming bookings, sessions and activities will show here.
          </span>
          {stats.centresLive + stats.clubsLive === 0 ? (
            <AdminButton size="sm" className="ws-line-link" onClick={() => onNavigateTab("listings")}>
              Set up your first listing
            </AdminButton>
          ) : (
            <AdminButton size="sm" className="ws-line-link" onClick={() => onNavigateTab("schedule")}>
              Open calendar
            </AdminButton>
          )}
        </div>
      )}

      <section aria-label="Totals" className="adm-ov-cards">
        {cards.map((c) => {
          const Icon = c.icon;
          return (
            <button
              key={c.label}
              type="button"
              className="adm-ov-card"
              data-state={c.hot && c.value > 0 ? "hot" : c.value === 0 ? "cold" : undefined}
              onClick={() => onNavigateTab(c.tab)}
              aria-label={`${c.label}: ${c.value}. Open ${c.tab}`}
            >
              <span className="adm-ov-cardicon">
                <Icon size={17} strokeWidth={1.9} aria-hidden="true" />
              </span>
              <span className="adm-ov-cardvalue">{c.value}</span>
              <span className="adm-ov-cardlabel">{c.label}</span>
              <span className="adm-ov-cardhint">{c.hint}</span>
            </button>
          );
        })}
      </section>
      <TipsStrip />
    </div>
  );
}

/** Caption under an approved-listing count: never "approved" under a zero. */
function approvedCaption(n: number) {
  if (n === 0) return "None approved yet";
  return VENUE_PAGES_PUBLIC ? "Live to the public" : "Approved · venue pages not public yet";
}
