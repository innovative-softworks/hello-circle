import type {
  AdminOrganisation,
  FeatureFlagKey,
  FeatureFlags,
  NotificationTemplateInfo,
  AdminStats,
  AuditEntry,
  Centre,
  CircleActivity,
  Club,
  DemandRow,
  ModerationReport,
  OpenBookingActivity,
  PlaceSuggestion,
  ReportCase,
  Review,
  SupportBooking,
  SupportCircle,
  SupportGame,
  SupportRegistration,
  SupportUser,
} from "../types";
import { request } from "./core";
import type { CentreInput, ClubInput } from "./vendor";

// Admin dashboard — vendor moderation, listing approval, organisations/
// RBAC/provider tier, coupons, demand, and moderation/audit/support tools
// folded in from the former Platform Admin page. Split out of the original
// single api.ts (see CLAUDE.md).

export function fetchAdminOrganisations(): Promise<AdminOrganisation[]> {
  return request(`/admin/organisations`);
}

export function createAdminOrganisation(input: { name: string; kind?: string }): Promise<{ id: string }> {
  return request(`/admin/organisations`, { method: "POST", body: JSON.stringify(input) });
}

export function fetchOrgFeatureFlags(orgId: string): Promise<FeatureFlags> {
  return request(`/admin/organisations/${orgId}/flags`);
}

export function setOrgFeatureFlag(orgId: string, key: FeatureFlagKey, enabled: boolean): Promise<{ ok: boolean }> {
  return request(`/admin/organisations/${orgId}/flags/${key}`, { method: "PUT", body: JSON.stringify({ enabled }) });
}

export function setCentreOrganisation(id: string, organisationId: string | null): Promise<{ ok: boolean }> {
  return request(`/admin/centres/${id}/organisation`, { method: "PUT", body: JSON.stringify({ organisationId }) });
}

export function setClubOrganisation(id: string, organisationId: string | null): Promise<{ ok: boolean }> {
  return request(`/admin/clubs/${id}/organisation`, { method: "PUT", body: JSON.stringify({ organisationId }) });
}

export function setVendorPlatformRole(id: string, platformRole: string | null): Promise<{ ok: boolean }> {
  return request(`/admin/vendors/${id}/platform-role`, { method: "PUT", body: JSON.stringify({ platformRole }) });
}

export function setVendorProviderTier(id: string, providerTier: "standard" | "verified" | "featured"): Promise<{ ok: boolean }> {
  return request(`/admin/vendors/${id}/provider-tier`, { method: "PUT", body: JSON.stringify({ providerTier }) });
}

export function fetchAdminDemand(): Promise<DemandRow[]> {
  return request(`/admin/demand`);
}

export interface AdminVendor {
  id: string;
  email: string;
  name: string;
  status: "pending" | "approved" | "suspended";
  createdAt: string;
  centreCount: number;
  clubCount: number;
  vendorType: "community" | "sports" | null;
  businessName: string;
  address: string;
  county: string;
  mobile: string;
  landline: string;
  description: string;
  orgId: string | null;
  platformRole: string | null;
  providerTier: "standard" | "verified" | "featured";
  invitedStaff: number;
}

export interface AdminListingSummary {
  id: string;
  name: string;
  status: string;
  area: string;
  county: string;
  ph: string;
  image: string;
  blurb: string;
  vendorId: string | null;
  vendorEmail: string | null;
  vendorName?: string | null;
  vendorStatus?: "pending" | "approved" | "suspended" | null;
  // centre-only
  capacity?: number;
  from?: number;
  managedBy?: string;
  // club-only
  sport?: string;
  ages?: string;
  price?: number;
  unit?: string;
  /** Bounded "featured" flag (IA spec §16), MySQL tinyint 0/1. */
  featured: number;
}

export function fetchAdminVendors(): Promise<AdminVendor[]> {
  return request(`/admin/vendors`);
}

export function fetchAdminStats(): Promise<AdminStats> {
  return request(`/admin/stats`);
}

export function setVendorStatus(id: string, status: "pending" | "approved" | "suspended"): Promise<{ ok: boolean }> {
  return request(`/admin/vendors/${id}/status`, { method: "PUT", body: JSON.stringify({ status }) });
}

export function fetchAdminPendingListings(): Promise<{ centres: AdminListingSummary[]; clubs: AdminListingSummary[] }> {
  return request(`/admin/listings/pending`);
}

// --- "Host" trust tier (IA spec five-layer audit) --------------------------

export interface HostApplication {
  id: string;
  name: string;
  email: string;
  bio: string;
  phone: string;
  appliedAt: string;
}

export function fetchHostApplications(): Promise<HostApplication[]> {
  return request(`/admin/host-applications`);
}

export function setHostApplicationStatus(residentId: string, status: "verified" | "rejected"): Promise<{ ok: boolean }> {
  return request(`/admin/host-applications/${residentId}/status`, { method: "PUT", body: JSON.stringify({ status }) });
}

export function fetchAdminListings(): Promise<{ centres: AdminListingSummary[]; clubs: AdminListingSummary[] }> {
  return request(`/admin/listings`);
}

export interface ClaimSummary {
  id: number;
  listingType: "centre" | "club";
  listingId: string;
  listingName: string;
  message: string;
  status: "pending" | "approved" | "rejected";
  createdAt: string;
  vendorId: string;
  vendorName: string;
  vendorEmail: string;
  vendorStatus: "pending" | "approved" | "suspended";
}

export function fetchClaims(): Promise<ClaimSummary[]> {
  return request(`/admin/claims`);
}

export function setClaimStatus(id: number, status: "approved" | "rejected"): Promise<{ ok: boolean }> {
  return request(`/admin/claims/${id}/status`, { method: "PUT", body: JSON.stringify({ status }) });
}

export function setCentreStatus(id: string, status: string): Promise<Centre> {
  return request(`/admin/centres/${id}/status`, { method: "PUT", body: JSON.stringify({ status }) });
}

export function setClubStatus(id: string, status: string): Promise<Club> {
  return request(`/admin/clubs/${id}/status`, { method: "PUT", body: JSON.stringify({ status }) });
}

export function adminUpdateCentre(id: string, input: Partial<CentreInput>): Promise<Centre> {
  return request(`/admin/centres/${id}`, { method: "PUT", body: JSON.stringify(input) });
}

export function adminDeleteCentre(id: string): Promise<{ ok: boolean }> {
  return request(`/admin/centres/${id}`, { method: "DELETE" });
}

export function adminUpdateClub(id: string, input: Partial<ClubInput>): Promise<Club> {
  return request(`/admin/clubs/${id}`, { method: "PUT", body: JSON.stringify(input) });
}

export function adminDeleteClub(id: string): Promise<{ ok: boolean }> {
  return request(`/admin/clubs/${id}`, { method: "DELETE" });
}

export function fetchAdminReviews(): Promise<(Review & { hidden: number })[]> {
  return request(`/admin/reviews`);
}

export function unhideReview(id: number): Promise<{ ok: boolean }> {
  return request(`/admin/reviews/${id}/unhide`, { method: "PUT" });
}

// --- admin coupons -----------------------------------------------------

export interface AdminCoupon {
  id: number;
  code: string;
  kind: "percent" | "fixed";
  amount: number;
  maxUses: number | null;
  usedCount: number;
  expiresAt: string | null;
  active: number;
  createdAt: string;
}

export interface CouponInput {
  code: string;
  kind: "percent" | "fixed";
  amount: number;
  maxUses?: number | null;
  expiresAt?: string | null;
}

export function fetchAdminCoupons(): Promise<AdminCoupon[]> {
  return request(`/admin/coupons`);
}

export function createAdminCoupon(input: CouponInput): Promise<{ ok: boolean }> {
  return request(`/admin/coupons`, { method: "POST", body: JSON.stringify(input) });
}

export function setAdminCouponActive(id: number, active: boolean): Promise<{ ok: boolean }> {
  return request(`/admin/coupons/${id}/active`, { method: "PUT", body: JSON.stringify({ active }) });
}

export function deleteAdminCoupon(id: number): Promise<{ ok: boolean }> {
  return request(`/admin/coupons/${id}`, { method: "DELETE" });
}

// --- moderation, audit, support (folded in from the former Platform Admin
// page — see AdminDashboard.tsx's Reviews/Audit/Support tabs) --------------

export function fetchModerationReports(all = false): Promise<ModerationReport[]> {
  return request(`/admin/reports${all ? "?status=all" : ""}`);
}

export function fetchReportCase(id: number): Promise<ReportCase> {
  return request(`/admin/reports/${id}/case`);
}

// Trust & Safety (IA spec §16) — 'suspended' also acts on the underlying
// target (closes the circle / hides the review — see routes/admin.ts).
// `notes` can be saved on its own (status omitted) as an investigation log.
export function resolveReport(id: number, input: { status?: "dismissed" | "actioned" | "suspended"; notes?: string }): Promise<{ ok: boolean; suspendedAction: string | null }> {
  return request(`/admin/reports/${id}`, { method: "PUT", body: JSON.stringify(input) });
}

export function fetchAuditLog(actorUserId?: string): Promise<AuditEntry[]> {
  return request(`/admin/audit${actorUserId ? `?actorUserId=${actorUserId}` : ""}`);
}

export function supportSearch(
  q: string
): Promise<{ bookings: SupportBooking[]; registrations: SupportRegistration[]; users: SupportUser[]; games: SupportGame[]; circles: SupportCircle[] }> {
  return request(`/admin/support/search${q ? `?q=${encodeURIComponent(q)}` : ""}`);
}

export function fetchActivityOverview(): Promise<{ openBookings: OpenBookingActivity[]; circleActivity: CircleActivity[] }> {
  return request(`/admin/activity-overview`);
}

export function fetchSystemStatus(): Promise<{ database: string; stripeConfigured: boolean; smtpConfigured: boolean }> {
  return request(`/admin/status`);
}

export function setListingFeatured(table: "centres" | "clubs" | "experiences", id: string, featured: boolean): Promise<{ ok: boolean }> {
  return request(`/admin/${table}/${id}/featured`, { method: "PUT", body: JSON.stringify({ featured }) });
}

// --- notification templates (implementation backlog #2) -------------------

export function fetchNotificationTemplates(): Promise<NotificationTemplateInfo[]> {
  return request(`/admin/notification-templates`);
}

export function setNotificationTemplate(
  key: string,
  input: { subjectTemplate?: string | null; titleTemplate?: string | null; bodyTemplate?: string | null }
): Promise<{ ok: boolean }> {
  return request(`/admin/notification-templates/${key}`, { method: "PUT", body: JSON.stringify(input) });
}

export function resetNotificationTemplate(key: string): Promise<{ ok: boolean }> {
  return request(`/admin/notification-templates/${key}`, { method: "DELETE" });
}

// --- Community-contributed places (master-prompt punch list #4) -----------

export function fetchAdminPlaceSuggestions(all = false): Promise<PlaceSuggestion[]> {
  return request(`/admin/place-suggestions${all ? "?status=all" : ""}`);
}

export function setPlaceSuggestionStatus(id: string, status: "approved" | "rejected"): Promise<{ ok: boolean }> {
  return request(`/admin/place-suggestions/${id}/status`, { method: "PUT", body: JSON.stringify({ status }) });
}
