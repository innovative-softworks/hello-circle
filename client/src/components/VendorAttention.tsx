import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Ban, Clock, ListChecks, MessageSquare, Search } from "lucide-react";
import { fetchVendorDemand } from "../api";
import { AttentionQueue, type AttentionItem } from "./workspace/AttentionQueue";
import { useVendorSetupNext } from "./VendorSetupChecklist";
import type { DemandRow, VendorListingSummary } from "../types";

// "Needs your attention" (Host Manage spec §4) — one action-first queue at the
// top of Overview, each row leading straight to whatever resolves it. Setup
// progress is the first row while setup isn't finished (it used to be its own
// card above the page). Deliberately doesn't include "bookings awaiting
// confirmation" — bookings/registrations auto-confirm on payment in this app
// (see server/src/db/index.ts's default 'confirmed' status), there's no
// approval queue to surface here.

export type AttentionTargetTab = "listings" | "messages" | "demand";

export function VendorAttentionPanel({
  listings,
  unreadCount,
  onNavigateTab,
}: {
  listings: { centres: VendorListingSummary[]; clubs: VendorListingSummary[] };
  unreadCount: number;
  onNavigateTab: (tab: AttentionTargetTab) => void;
}) {
  const navigate = useNavigate();
  const setup = useVendorSetupNext();
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
  if (setup) {
    items.push({
      key: "setup",
      icon: ListChecks,
      title: `Next: ${setup.next.label}`,
      detail: `Setup · ${setup.done} of ${setup.total} done${!setup.action && setup.waiting ? ` · ${setup.waiting}` : ""}`,
      action: setup.action ? { label: setup.action.label, onClick: () => navigate(setup.action!.to) } : undefined,
    });
  }
  if (rejectedCount > 0) {
    items.push({
      key: "rejected",
      icon: Ban,
      urgent: true,
      title: `${rejectedCount} listing${rejectedCount === 1 ? "" : "s"} need${rejectedCount === 1 ? "s" : ""} changes before it can go live`,
      detail: "HelloCircle sent it back with a reason.",
      action: { label: "See what to fix", onClick: () => onNavigateTab("listings") },
    });
  }
  if (draftCount > 0) {
    items.push({
      key: "draft",
      icon: Clock,
      title: `${draftCount} draft listing${draftCount === 1 ? "" : "s"} not published yet`,
      action: { label: "Finish", onClick: () => onNavigateTab("listings") },
    });
  }
  if (unreadCount > 0) {
    items.push({
      key: "unread",
      icon: MessageSquare,
      urgent: true,
      title: `${unreadCount} unread message${unreadCount === 1 ? "" : "s"}`,
      detail: "Bookings and updates",
      action: { label: "Read", onClick: () => onNavigateTab("messages") },
    });
  }
  if (topDemand) {
    items.push({
      key: "demand",
      icon: Search,
      title: `${topDemand.recentCount} search${topDemand.recentCount === 1 ? "" : "es"} this week for "${topDemand.queryText}"`,
      detail: "Nothing on HelloCircle matched — a gap you could fill.",
      action: { label: "See demand", onClick: () => onNavigateTab("demand") },
    });
  }

  return <AttentionQueue items={items} />;
}
