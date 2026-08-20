import type {
  AdminOrganisation,
  AdminStats,
  AuditEntry,
  Centre,
  Club,
  DemandRow,
  ModerationReport,
  Review,
  SupportBooking,
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

export function fetchModerationReports(): Promise<ModerationReport[]> {
  return request(`/admin/reports`);
}

export function resolveReport(id: number, status: "dismissed" | "actioned"): Promise<{ ok: boolean }> {
  return request(`/admin/reports/${id}`, { method: "PUT", body: JSON.stringify({ status }) });
}

export function fetchAuditLog(actorUserId?: string): Promise<AuditEntry[]> {
  return request(`/admin/audit${actorUserId ? `?actorUserId=${actorUserId}` : ""}`);
}

export function supportSearch(q: string): Promise<{ bookings: SupportBooking[]; registrations: SupportRegistration[]; users: SupportUser[] }> {
  return request(`/admin/support/search?q=${encodeURIComponent(q)}`);
}

export function fetchSystemStatus(): Promise<{ database: string; stripeConfigured: boolean; smtpConfigured: boolean }> {
  return request(`/admin/status`);
}
