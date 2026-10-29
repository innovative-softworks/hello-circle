import type { PLATFORM_ROLES } from "./types";

// Sitemap audit P2-03 — which vendor-dashboard tabs an invited staff member
// sees, by their platform_role. Display only: the server stays the authority
// (requirePlatformRole / assertPlatformRole in server/src/auth.ts). This
// mirrors hasPlatformRole there: the org owner (any vendor who isn't invited
// staff) sees every tab; invited staff see a tab when their role can act in
// it, so nobody opens a tab only to be refused.
//
// Read endpoints are mostly ungated, so "all" tabs are the read-only views
// every staff member can use (Overview, Calendar, Organisation — the last
// already renders read-only for staff). Each other tab lists the roles the
// server lets act there:
//   listings / programs / experiences — centre_manager, facility_manager
//   bookings — the two managers (cancel, resend) and finance (refunds)
//   messages / reviews — communications (send, reply)
//   offers — finance (coupons)
//   earnings — finance (payments, payout account, plan are finance-only)
//   demand — finance, read_only_analyst

export type PlatformRole = (typeof PLATFORM_ROLES)[number];

export type VendorTabKey =
  | "overview"
  | "listings"
  | "messages"
  | "bookings"
  | "customers"
  | "earnings"
  | "programs"
  | "experiences"
  | "schedule"
  | "reviews"
  | "offers"
  | "demand"
  | "org"
  | "checkin";

const MANAGERS: readonly PlatformRole[] = ["centre_manager", "facility_manager"];

export const VENDOR_TAB_ROLES: Record<VendorTabKey, "all" | readonly PlatformRole[]> = {
  overview: "all",
  schedule: "all",
  org: "all",
  listings: MANAGERS,
  programs: MANAGERS,
  experiences: MANAGERS,
  bookings: [...MANAGERS, "finance"],
  // OG-20 — customer contact details: the roles that serve them.
  customers: [...MANAGERS, "finance", "communications"],
  messages: ["communications"],
  reviews: ["communications"],
  offers: ["finance"],
  earnings: ["finance"],
  demand: ["finance", "read_only_analyst"],
  // Participation Phase 2 — door check-in: the two managers, and check-in-only
  // staff (for the events or dates they're assigned to).
  checkin: [...MANAGERS, "checkin_staff"],
};

export function vendorTabVisible(tab: VendorTabKey, user: { invitedStaff: boolean; platformRole: string | null }): boolean {
  if (!user.invitedStaff) return true;
  // The check-in-only role has no other workspace pages (the server allows it the door API only).
  if (user.platformRole === "checkin_staff") return tab === "checkin";
  const roles = VENDOR_TAB_ROLES[tab];
  if (roles === "all") return true;
  return !!user.platformRole && (roles as readonly string[]).includes(user.platformRole);
}
