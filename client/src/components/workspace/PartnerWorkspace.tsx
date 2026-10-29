import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { BarChart3, Building2, CalendarDays, ClipboardList, Compass, DoorOpen, GraduationCap, LayoutDashboard, MessageSquare, Star, Tag, UserRound, Users, Wallet } from "lucide-react";
import type { AuthUser as AuthedUser } from "../../types";
import { vendorTabAvailable } from "../../vendorTabAccess";
import { useOrgCapabilities } from "../../orgCapabilities";
import { WorkspaceShell } from "./WorkspaceShell";
import { useParticipationFeatures } from "../../circleFeatures";

// The partner (vendor) workspace: one navigation catalogue shared by the
// dashboard (/vendor) and the full-page editors (/vendor/centres|clubs|
// programs|experiences/:id), so the editors sit inside the same shell.

export type VendorTab = "overview" | "listings" | "messages" | "bookings" | "customers" | "earnings" | "programs" | "experiences" | "schedule" | "reviews" | "offers" | "demand" | "org" | "checkin";

const I = { size: 18, strokeWidth: 1.9, "aria-hidden": true } as const;
// Keys are unchanged so existing ?tab= links keep working.
export const VENDOR_TABS: { key: VendorTab; label: string; icon: ReactNode; group: string; summary: string }[] = [
  { key: "overview", label: "Overview", icon: <LayoutDashboard {...I} />, group: "Run", summary: "What needs doing next across your venues, clubs and activities." },
  { key: "schedule", label: "Calendar", icon: <CalendarDays {...I} />, group: "Run", summary: "Everything booked or scheduled, by day." },
  { key: "bookings", label: "Bookings", icon: <ClipboardList {...I} />, group: "Run", summary: "Hall bookings and club registrations: check-in, cancel, refund." },
  { key: "checkin", label: "Check-in", icon: <DoorOpen {...I} />, group: "Run", summary: "Check people in at the door for today's events, by pass or by name." },
  { key: "customers", label: "Customers", icon: <UserRound {...I} />, group: "Run", summary: "Everyone who has booked, registered or enrolled with you." },
  { key: "messages", label: "Messages", icon: <MessageSquare {...I} />, group: "Run", summary: "Booking notifications, and messages to the people who booked." },
  { key: "listings", label: "Listings", icon: <Building2 {...I} />, group: "Listings", summary: "Your community centres and sports clubs." },
  { key: "programs", label: "Programmes", icon: <GraduationCap {...I} />, group: "Listings", summary: "Multi-week courses: sessions, enrolments and attendance." },
  { key: "experiences", label: "Experiences", icon: <Compass {...I} />, group: "Listings", summary: "Bookable adventures and experiences, and their departures." },
  { key: "earnings", label: "Earnings", icon: <Wallet {...I} />, group: "Business", summary: "Payments received, refunds and payout status." },
  { key: "offers", label: "Offers", icon: <Tag {...I} />, group: "Business", summary: "Discount codes you fund for your own listings." },
  { key: "reviews", label: "Reviews", icon: <Star {...I} />, group: "Business", summary: "What people say about your listings, and your public replies." },
  { key: "demand", label: "Demand", icon: <BarChart3 {...I} />, group: "Business", summary: "What people nearby search for that isn't on offer yet." },
  { key: "org", label: "Organisation", icon: <Users {...I} />, group: "Organisation", summary: "Profile, policies, staff and roles, trader details." },
];
export const VENDOR_TAB_KEYS = VENDOR_TABS.map((t) => t.key);

export const STAFF_ROLE_LABEL: Record<string, string> = {
  centre_manager: "Centre manager",
  facility_manager: "Facility manager",
  finance: "Finance",
  communications: "Communications",
  read_only_analyst: "Read-only analyst",
  checkin_staff: "Check-in only",
};

export function partnerAccountLine(user: Pick<AuthedUser, "invitedStaff" | "platformRole" | "businessName" | "name" | "email" | "providerTier">) {
  const role = user.invitedStaff ? (STAFF_ROLE_LABEL[user.platformRole ?? ""] ?? "Staff") : "Owner";
  // Trust & Retention batch 1 — the commercial tier isn't a verification, so it isn't called one.
  return `${role} · ${user.businessName || user.name} · ${user.email}`;
}

/** A page inside the partner workspace that isn't the dashboard itself (an
 * editor). Navigating away goes through `guard` (unsaved-changes check). */
export function PartnerWorkspace({
  user,
  active,
  title,
  subtitle,
  crumbs,
  actions,
  guard,
  children,
}: {
  user: AuthedUser;
  active: VendorTab;
  title: string;
  subtitle?: ReactNode;
  crumbs?: { label: string; onClick?: () => void }[];
  actions?: ReactNode;
  /** Wraps every navigation (e.g. the editor's unsaved-changes guard). */
  guard?: (go: () => void) => void;
  children: ReactNode;
}) {
  const navigate = useNavigate();
  const go = (to: string) => (guard ? guard(() => navigate(to)) : navigate(to));
  const participation = useParticipationFeatures();
  const capabilities = useOrgCapabilities();
  const items = VENDOR_TABS.filter((t) => vendorTabAvailable(t.key, user, capabilities) && (t.key !== "checkin" || participation["participation.checkin"]));
  const activeItem = VENDOR_TABS.find((t) => t.key === active)!;
  return (
    <WorkspaceShell
      workspaceLabel="Partner workspace"
      account={partnerAccountLine(user)}
      externalLink={{ label: "View public profile", to: `/provider/${user.id}`, newTab: true }}
      navItems={items}
      active={active}
      onNavigate={(k) => go(k === "overview" ? "/vendor" : k === "checkin" ? "/vendor/door" : `/vendor?tab=${k}`)}
      title={title}
      subtitle={subtitle}
      crumbs={
        crumbs ?? [
          { label: "Partner workspace", onClick: () => go("/vendor") },
          { label: activeItem.label, onClick: () => go(active === "checkin" ? "/vendor/door" : `/vendor?tab=${active}`) },
          { label: title },
        ]
      }
      actions={actions}
    >
      {children}
    </WorkspaceShell>
  );
}
