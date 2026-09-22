import { useEffect, useState } from "react";
import { fetchVendorDemand } from "../api";
import { BanIcon, BellIcon, ChatIcon, ClockIcon, SearchIcon } from "./icons";
import { Button, ManageCard as Card } from "./ui";
import { colors, fonts, radius } from "../theme";
import type { DemandRow, VendorListingSummary } from "../types";

// "Needs your attention" (Host Manage spec §4) — an action-first summary
// above the KPI strip, each row leading straight into the tab that resolves
// it rather than sitting as a generic notification. Deliberately doesn't
// include "bookings awaiting confirmation" — bookings/registrations
// auto-confirm on payment in this app (see server/src/db/index.ts's default
// 'confirmed' status), there's no approval queue to surface here.

export type AttentionTargetTab = "listings" | "messages" | "demand";

interface AttentionItem {
  key: string;
  icon: React.ReactNode;
  text: string;
  cta: string;
  target: AttentionTargetTab;
}

function AttentionRow({ item, onNavigateTab }: { item: AttentionItem; onNavigateTab: (tab: AttentionTargetTab) => void }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, background: colors.bg, borderRadius: radius.control, padding: "10px 14px" }}>
      <span style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13.5 }}>
        <span style={{ color: colors.orangeDark, flex: "none", display: "flex" }}>{item.icon}</span>
        {item.text}
      </span>
      <Button variant="ghost" style={{ padding: "6px 12px", fontSize: 12, flex: "none" }} onClick={() => onNavigateTab(item.target)}>
        {item.cta}
      </Button>
    </div>
  );
}

export function VendorAttentionPanel({
  listings,
  unreadCount,
  onNavigateTab,
}: {
  listings: { centres: VendorListingSummary[]; clubs: VendorListingSummary[] };
  unreadCount: number;
  onNavigateTab: (tab: AttentionTargetTab) => void;
}) {
  const [demandRows, setDemandRows] = useState<DemandRow[] | null>(null);

  useEffect(() => {
    fetchVendorDemand("own")
      .then(setDemandRows)
      .catch(() => setDemandRows([]));
  }, []);

  const allListings = [...listings.centres, ...listings.clubs];
  const draftCount = allListings.filter((l) => l.status === "draft").length;
  const rejectedCount = allListings.filter((l) => l.status === "rejected").length;
  const topDemand = demandRows?.filter((r) => r.recentCount > 0).sort((a, b) => b.recentCount - a.recentCount)[0];

  const items: AttentionItem[] = [];
  if (rejectedCount > 0) {
    items.push({
      key: "rejected",
      icon: <BanIcon size={15} />,
      text: `${rejectedCount} listing${rejectedCount === 1 ? "" : "s"} need${rejectedCount === 1 ? "s" : ""} changes before it can go live`,
      cta: "See what needs fixing",
      target: "listings",
    });
  }
  if (draftCount > 0) {
    items.push({
      key: "draft",
      icon: <ClockIcon size={15} />,
      text: `${draftCount} draft listing${draftCount === 1 ? "" : "s"} not published yet`,
      cta: "Finish and publish",
      target: "listings",
    });
  }
  if (unreadCount > 0) {
    items.push({
      key: "unread",
      icon: <ChatIcon size={15} />,
      text: `${unreadCount} unread message${unreadCount === 1 ? "" : "s"}`,
      cta: "Read messages",
      target: "messages",
    });
  }
  if (topDemand) {
    items.push({
      key: "demand",
      icon: <SearchIcon size={15} />,
      text: `${topDemand.recentCount} recent search${topDemand.recentCount === 1 ? "" : "es"} this week for "${topDemand.queryText}" — nothing matched`,
      cta: "See demand",
      target: "demand",
    });
  }

  if (items.length === 0) return null;

  return (
    <Card>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
        <BellIcon size={16} style={{ color: colors.orangeDark }} />
        <h4 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 16, margin: 0 }}>Needs your attention</h4>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {items.map((item) => (
          <AttentionRow key={item.key} item={item} onNavigateTab={onNavigateTab} />
        ))}
      </div>
    </Card>
  );
}
