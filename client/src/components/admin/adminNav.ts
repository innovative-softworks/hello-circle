import {
  Activity,
  Award,
  Building2,
  ClipboardCheck,
  Images,
  KeyRound,
  Landmark,
  LayoutDashboard,
  LifeBuoy,
  List,
  Mail,
  MapPin,
  Scale,
  ScrollText,
  Settings,
  ShieldCheck,
  Star,
  Store,
  Ticket,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";

// Admin workspace navigation (2026-10-14 redesign). Every pre-existing tab
// key is kept so `/admin?tab=<key>` deep links keep working; `settings` is
// the only new key, and it gathers existing tools rather than adding any.
// `permissions` names the server permissions (server/src/adminPermissions.ts)
// that open each tool (D-02): the server stays the enforcement point — this
// only explains the lock instead of rendering a misleading empty page.

export type AdminTab =
  | "overview"
  | "pending"
  | "support"
  | "listings"
  | "vendors"
  | "claims"
  | "hostApplications"
  | "placeSuggestions"
  | "organisations"
  | "demand"
  | "marketplaceHealth"
  | "coupons"
  | "commerce"
  | "finance"
  | "reviews"
  | "policies"
  | "audit"
  | "notificationTemplates"
  | "media"
  | "settings";

export type AdminRoleName = "super" | "finance" | "support" | "legal";

export interface AdminNavItem {
  key: AdminTab;
  label: string;
  icon: LucideIcon;
  /** Shown under the page title. */
  summary: string;
  /** D-02: the item is usable when the admin holds any of these permissions
   * (names from server/src/adminPermissions.ts; the server enforces them). */
  permissions: string[];
}

export interface AdminNavGroup {
  label: string;
  items: AdminNavItem[];
}

export const ADMIN_NAV: AdminNavGroup[] = [
  {
    label: "Admin",
    items: [
      { key: "overview", label: "Overview", icon: LayoutDashboard, summary: "What needs a decision, and how the platform is doing.", permissions: ["workspace.view"] },
      { key: "pending", label: "Pending approvals", icon: ClipboardCheck, summary: "Listings submitted by partners that are waiting for a publish decision.", permissions: ["listings.view"] },
      { key: "support", label: "Support", icon: LifeBuoy, summary: "Look up bookings, registrations, accounts, sessions and circles.", permissions: ["support.search"] },
    ],
  },
  {
    label: "Marketplace",
    items: [
      { key: "listings", label: "All listings", icon: List, summary: "Every community centre, sports club and experience on the platform.", permissions: ["listings.view"] },
      { key: "vendors", label: "Vendors", icon: Store, summary: "Partner accounts, their onboarding details, roles and listings.", permissions: ["partners.view"] },
      { key: "claims", label: "Claims", icon: KeyRound, summary: "Partners asking to take ownership of an unclaimed listing.", permissions: ["queues.view"] },
      { key: "hostApplications", label: "Host applications", icon: Award, summary: "Residents applying for the Verified Host badge.", permissions: ["queues.view"] },
      { key: "placeSuggestions", label: "Place suggestions", icon: MapPin, summary: "Places suggested by residents, waiting to be published or declined.", permissions: ["queues.view"] },
      { key: "organisations", label: "Organisations", icon: Building2, summary: "Partner organisations, their feature flags, and custom organisations.", permissions: ["orgs.view"] },
      { key: "demand", label: "Demand", icon: TrendingUp, summary: "What residents are looking for that nobody offers yet.", permissions: ["insights.view"] },
      { key: "marketplaceHealth", label: "Marketplace health", icon: Activity, summary: "Liquidity, referrals and the participation funnel.", permissions: ["insights.view"] },
    ],
  },
  {
    label: "Business",
    items: [
      { key: "coupons", label: "Coupons", icon: Ticket, summary: "HelloCircle-funded and split discount codes.", permissions: ["coupons.manage"] },
      { key: "commerce", label: "Commercial rules", icon: Scale, summary: "Versioned fees, rates and feature switches.", permissions: ["commerce.operate"] },
      { key: "finance", label: "Finance", icon: Landmark, summary: "Ledger, settlements, payouts, refunds and disputes.", permissions: ["finance.operate", "finance.payment_state.view"] },
    ],
  },
  {
    label: "Trust & Platform",
    items: [
      { key: "reviews", label: "Reviews & reports", icon: Star, summary: "Hide or restore reviews and work through user reports.", permissions: ["reviews.view", "reports.view"] },
      { key: "policies", label: "Policies & trust", icon: ShieldCheck, summary: "Policy documents, company details, complaints and trader checks.", permissions: ["policies.manage", "complaints.handle", "traders.view"] },
      { key: "audit", label: "Audit log", icon: ScrollText, summary: "Who changed what, and when.", permissions: ["audit.view"] },
      { key: "notificationTemplates", label: "Notification templates", icon: Mail, summary: "Wording of booking and registration confirmation and cancellation messages.", permissions: ["templates.view"] },
      { key: "media", label: "Media", icon: Images, summary: "Upload switches and the editorial image library.", permissions: ["media.view"] },
      { key: "settings", label: "Settings", icon: Settings, summary: "System status, admin roles, field help, market categories and recommendation weights.", permissions: ["workspace.view"] },
    ],
  },
];

export const ADMIN_ITEMS: AdminNavItem[] = ADMIN_NAV.flatMap((g) => g.items);

export function navItem(key: AdminTab): AdminNavItem {
  return ADMIN_ITEMS.find((i) => i.key === key)!;
}

export function groupOf(key: AdminTab): string {
  return ADMIN_NAV.find((g) => g.items.some((i) => i.key === key))!.label;
}

export function isAdminTab(v: string | null): v is AdminTab {
  return !!v && ADMIN_ITEMS.some((i) => i.key === v);
}

export function canUse(can: (...permissions: string[]) => boolean, item: Pick<AdminNavItem, "permissions">): boolean {
  return can(...item.permissions);
}

export const ADMIN_ROLE_LABEL: Record<AdminRoleName, string> = {
  super: "Super admin",
  finance: "Finance admin",
  support: "Support admin",
  legal: "Legal admin",
};
