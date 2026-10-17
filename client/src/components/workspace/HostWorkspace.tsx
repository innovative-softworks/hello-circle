import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { BarChart3, Building2, CalendarDays, LayoutDashboard, Star, Tag, Ticket, UsersRound, Wallet } from "lucide-react";
import { WorkspaceShell } from "./WorkspaceShell";

// The host workspace: one navigation catalogue for /manage and the host pages
// that live outside it (Pro, rewards), so they share the same shell.

export type HostTab = "overview" | "activities" | "reservations" | "circles" | "calendar" | "insights" | "earnings" | "reviews" | "offers";

const I = { size: 18, strokeWidth: 1.9, "aria-hidden": true } as const;
// Keys are unchanged so existing ?tab= links still work.
export const HOST_TABS: { key: HostTab; label: string; icon: ReactNode; group: string; summary: string }[] = [
  { key: "overview", label: "Overview", icon: <LayoutDashboard {...I} />, group: "Hosting", summary: "What's coming up and what needs you." },
  { key: "activities", label: "Activities", icon: <Ticket {...I} />, group: "Hosting", summary: "Activities you host: participants, waitlists, updates and check-in." },
  { key: "reservations", label: "Reservations", icon: <Building2 {...I} />, group: "Hosting", summary: "Venues you've booked, and the activity held on each." },
  { key: "calendar", label: "Calendar", icon: <CalendarDays {...I} />, group: "Hosting", summary: "Everything you host, by day." },
  { key: "circles", label: "Circles", icon: <UsersRound {...I} />, group: "Community", summary: "Circles you organise: plans, members and settings." },
  { key: "insights", label: "Insights", icon: <BarChart3 {...I} />, group: "Results", summary: "Turnout and repeat attendance across your activities." },
  { key: "earnings", label: "Earnings", icon: <Wallet {...I} />, group: "Results", summary: "Payments for paid activities, refunds and payout status." },
  { key: "reviews", label: "Reviews", icon: <Star {...I} />, group: "Results", summary: "What participants say about your hosting." },
  { key: "offers", label: "Offers", icon: <Tag {...I} />, group: "Results", summary: "Discount codes for your own activities." },
];
export const HOST_TAB_KEYS = HOST_TABS.map((t) => t.key);

export function hostAccountLine(resident: { name: string; email: string }, verified: boolean) {
  return `Host · ${resident.name} · ${resident.email}${verified ? " · Verified Host" : ""}`;
}

/** A host page outside /manage itself (e.g. Pro, reward history). */
export function HostWorkspace({
  resident,
  verified = false,
  active,
  title,
  subtitle,
  crumbs,
  actions,
  children,
}: {
  resident: { id: string; name: string; email: string };
  verified?: boolean;
  active: HostTab;
  title: string;
  subtitle?: ReactNode;
  crumbs?: { label: string; onClick?: () => void }[];
  actions?: ReactNode;
  children: ReactNode;
}) {
  const navigate = useNavigate();
  const activeItem = HOST_TABS.find((t) => t.key === active)!;
  return (
    <WorkspaceShell
      workspaceLabel="Host workspace"
      account={hostAccountLine(resident, verified)}
      externalLink={{ label: "View host profile", to: `/host/${resident.id}`, newTab: true }}
      navItems={HOST_TABS}
      active={active}
      onNavigate={(k) => navigate(k === "overview" ? "/manage" : `/manage?tab=${k}`)}
      title={title}
      subtitle={subtitle}
      crumbs={crumbs ?? [{ label: "Host workspace", onClick: () => navigate("/manage") }, { label: activeItem.label, onClick: () => navigate(`/manage?tab=${active}`) }, { label: title }]}
      actions={actions}
    >
      {children}
    </WorkspaceShell>
  );
}
