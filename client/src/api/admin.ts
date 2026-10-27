import type { EstimateInput, FieldHelpEntry, PlanComparison, PriceEstimate } from "./public";
import type {
  AdminOrganisation,
  AnalyticsFunnelRow,
  FeatureFlagKey,
  FeatureFlags,
  NotificationTemplateInfo,
  AdminStats,
  AuditEntry,
  Centre,
  CircleActivity,
  Club,
  DemandRow,
  IntentCluster,
  MarketCategoryFlags,
  MarketplaceHealth,
  ModerationReport,
  ReferralAttributionRow,
  OpenBookingActivity,
  PlaceSuggestion,
  ReportCase,
  Review,
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

export function fetchAdminIntentClusters(): Promise<IntentCluster[]> {
  return request(`/admin/demand/intents`);
}

export function notifyIntentCluster(activityLabel: string, county: string): Promise<{ ok: boolean; notified: number }> {
  return request(`/admin/demand/intents/notify`, { method: "POST", body: JSON.stringify({ activityLabel, county }) });
}

export function fetchMarketplaceHealth(county?: string): Promise<MarketplaceHealth> {
  return request(`/admin/marketplace-health${county ? `?county=${encodeURIComponent(county)}` : ""}`);
}

export function fetchAdminReferrals(): Promise<ReferralAttributionRow[]> {
  return request(`/admin/referrals`);
}

export function fetchAnalyticsFunnel(windowDays?: number): Promise<AnalyticsFunnelRow[]> {
  return request(`/admin/analytics/funnel${windowDays ? `?windowDays=${windowDays}` : ""}`);
}

export function fetchAdminMarketCategories(county: string): Promise<MarketCategoryFlags> {
  return request(`/admin/market-categories?county=${encodeURIComponent(county)}`);
}

export function setMarketCategory(county: string, category: string, enabled: boolean): Promise<{ ok: boolean }> {
  return request(`/admin/market-categories`, { method: "PUT", body: JSON.stringify({ county, category, enabled }) });
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
  // experience-only (price is in cents, as `from`)
  kind?: string;
  /** Bounded "featured" flag (IA spec §16), MySQL tinyint 0/1. */
  featured: number;
  /** When the listing row was created (UTC); null for old seed rows. */
  createdAt?: string | null;
}

export function fetchAdminVendors(): Promise<AdminVendor[]> {
  return request(`/admin/vendors`);
}

export function fetchAdminStats(): Promise<AdminStats> {
  return request(`/admin/stats`);
}

// --- D-03 decision reasons -------------------------------------------------------
/** Sent with a rejection/suspension: category + partner-visible explanation; the note stays internal. */
export interface DecisionReasonInput {
  reasonCategory?: string;
  explanation?: string;
  internalNote?: string;
}
export type ReasonKind = "listing_rejection" | "suspension" | "application_rejection";
/** Mirrors server/src/moderationDecisions.ts REASON_CATEGORIES (keep in sync). */
export const REASON_CATEGORIES: Record<ReasonKind, { value: string; label: string }[]> = {
  listing_rejection: [
    { value: "incomplete", label: "Incomplete details" },
    { value: "misleading", label: "Misleading or inaccurate" },
    { value: "ineligible", label: "Not an eligible activity" },
    { value: "safety", label: "Safety concern" },
    { value: "duplicate", label: "Duplicate listing" },
    { value: "other", label: "Other" },
  ],
  suspension: [
    { value: "terms_breach", label: "Breach of terms" },
    { value: "safety", label: "Safety concern" },
    { value: "payment_risk", label: "Payment or fraud risk" },
    { value: "legal_request", label: "Legal request" },
    { value: "verification_failed", label: "Verification failed" },
    { value: "other", label: "Other" },
  ],
  application_rejection: [
    { value: "incomplete", label: "Incomplete details" },
    { value: "ineligible", label: "Doesn't meet the criteria" },
    { value: "duplicate", label: "Duplicate" },
    { value: "safety", label: "Safety concern" },
    { value: "other", label: "Other" },
  ],
};
export const EXPLANATION_MIN = 20;
export const EXPLANATION_MAX = 2000;
export const NOTE_MAX = 4000;
/** A decision as the partner/applicant sees it (no internal note). */
export interface PublicDecision {
  id: number;
  action: string;
  newState: string;
  category: string | null;
  categoryLabel: string | null;
  explanation: string | null;
  decidedAt: string;
}
export interface AdminDecision extends PublicDecision {
  previousState: string | null;
  actorEmail: string | null;
  internalNote?: string | null;
}
export function fetchDecisionHistory(objectType: string, objectId: string): Promise<{ includesInternalNotes: boolean; decisions: AdminDecision[] }> {
  return request(`/admin/decisions?objectType=${encodeURIComponent(objectType)}&objectId=${encodeURIComponent(objectId)}`);
}
/** D-02 — the signed-in admin's permissions (the server decides every request itself). */
export function fetchAdminPermissions(): Promise<{ role: string | null; permissions: string[] }> {
  return request(`/admin/permissions`);
}

export function setVendorStatus(id: string, status: "pending" | "approved" | "suspended", reason: DecisionReasonInput = {}): Promise<{ ok: boolean }> {
  return request(`/admin/vendors/${id}/status`, { method: "PUT", body: JSON.stringify({ status, ...reason }) });
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

export function setHostApplicationStatus(residentId: string, status: "verified" | "rejected", reason: DecisionReasonInput = {}): Promise<{ ok: boolean }> {
  return request(`/admin/host-applications/${residentId}/status`, { method: "PUT", body: JSON.stringify({ status, ...reason }) });
}

/** Full listing content for the admin review page (any status). */
export interface AdminListingDetail {
  type: "centre" | "club" | "experience";
  images: string[];
  description: string;
  /** Map position, when the listing has one. */
  location?: { lat: number; lng: number; source: string } | null;
  /** Header key numbers: visible reviews, upcoming bookings (club: active registrations), page views. */
  stats?: { reviews: number; rating: number | null; upcoming: number; views: number | null };
  centre?: {
    rooms: { name: string; capacity: number; rate: number; description: string; paymentMethod: string; active: number }[];
    hours: { day: number; opensAt: string; closesAt: string; closed: number }[];
    opensAt: string;
    closesAt: string;
    amenities: string[];
  };
  club?: { sport: string; ages: string; price: number; unit: string; trial: boolean; includes: string[]; sessions: { day: number; time: string; label: string; capacity: number | null; active: number }[] };
  experience?: {
    kind: string;
    priceCents: number;
    capacity: number;
    durationMinutes: number;
    meetingPoint: string;
    difficulty: string;
    upcomingSessions: { date: string; time: string; capacity: number | null; status: string }[];
    totalSessions: number;
  };
}
export function fetchAdminListingDetail(type: string, id: string): Promise<AdminListingDetail> {
  return request(`/admin/listings/${encodeURIComponent(type)}/${encodeURIComponent(id)}/detail`);
}

export function fetchAdminListings(): Promise<{ centres: AdminListingSummary[]; clubs: AdminListingSummary[]; experiences?: AdminListingSummary[] }> {
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

export function setClaimStatus(id: number, status: "approved" | "rejected", reason: DecisionReasonInput = {}): Promise<{ ok: boolean }> {
  return request(`/admin/claims/${id}/status`, { method: "PUT", body: JSON.stringify({ status, ...reason }) });
}

export function setCentreStatus(id: string, status: string, reason: DecisionReasonInput = {}): Promise<Centre> {
  return request(`/admin/centres/${id}/status`, { method: "PUT", body: JSON.stringify({ status, ...reason }) });
}

export function setClubStatus(id: string, status: string, reason: DecisionReasonInput = {}): Promise<Club> {
  return request(`/admin/clubs/${id}/status`, { method: "PUT", body: JSON.stringify({ status, ...reason }) });
}

/** Admin redesign (2026-10-14) — the server route has existed since the
 * Experiences feature; the dashboard never called it, so pending
 * experiences couldn't be decided from the UI (audit finding 1). */
export function setExperienceStatus(id: string, status: "approved" | "rejected" | "pending" | "deleted", reason: DecisionReasonInput = {}): Promise<{ ok: boolean }> {
  return request(`/admin/experiences/${encodeURIComponent(id)}/status`, { method: "PUT", body: JSON.stringify({ status, ...reason }) });
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
  /** Commerce Engine Phase 3 — who pays for the discount. */
  funding: "platform" | "split" | "partner";
  platformShareBps: number;
  minSpendCents: number | null;
  maxDiscountCents: number | null;
  perCustomerLimit: number | null;
  startsAt: string | null;
  archivedAt: string | null;
  createdByVendorId: string | null;
  createdByResidentId: string | null;
  confirmedRedemptions: number;
  platformFundedMinor: number;
}

export interface CouponInput {
  code: string;
  kind: "percent" | "fixed";
  amount: number;
  maxUses?: number | null;
  expiresAt?: string | null;
  funding?: "platform" | "split";
  platformShareBps?: number;
  minSpendCents?: number | null;
  maxDiscountCents?: number | null;
  perCustomerLimit?: number | null;
  startsAt?: string | null;
  /** Required: every admin coupon change is audited with a reason. */
  reason: string;
}

export function fetchAdminCoupons(): Promise<AdminCoupon[]> {
  return request(`/admin/coupons`);
}

export function createAdminCoupon(input: CouponInput): Promise<{ ok: boolean }> {
  return request(`/admin/coupons`, { method: "POST", body: JSON.stringify(input) });
}

export function setAdminCouponActive(id: number, active: boolean, reason: string): Promise<{ ok: boolean }> {
  return request(`/admin/coupons/${id}/active`, { method: "PUT", body: JSON.stringify({ active, reason }) });
}

/** Archives (never hard-deletes) a coupon. */
export function archiveAdminCoupon(id: number, reason: string): Promise<{ ok: boolean }> {
  return request(`/admin/coupons/${id}`, { method: "DELETE", body: JSON.stringify({ reason }) });
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
export function resolveReport(
  id: number,
  input: { status?: "dismissed" | "actioned" | "suspended"; notes?: string; statementOfReasons?: string } & Partial<DecisionReasonInput>
): Promise<{ ok: boolean; suspendedAction: string | null }> {
  return request(`/admin/reports/${id}`, { method: "PUT", body: JSON.stringify(input) });
}

/** OG-03 — undo a moderation suspension: the listing returns to its previous status. */
export function reinstateModeratedListing(type: "centre" | "club" | "experience", id: string, input: Partial<DecisionReasonInput> = {}): Promise<{ status: string }> {
  return request(`/admin/moderation/${type}/${encodeURIComponent(id)}/reinstate`, { method: "POST", body: JSON.stringify(input) });
}

/** OG-03 — show a chat message that moderation hid. */
export function unhideChatMessage(id: string, reason: string): Promise<{ ok: boolean }> {
  return request(`/admin/moderation/chat-messages/${encodeURIComponent(id)}/unhide`, { method: "POST", body: JSON.stringify({ reason }) });
}

export function fetchAuditLog(actorUserId?: string): Promise<AuditEntry[]> {
  return request(`/admin/audit${actorUserId ? `?actorUserId=${actorUserId}` : ""}`);
}

// Support console (2026-10-16): one search across every kind of order,
// people (residents + partner/admin logins, one per email), games, circles.
export type SupportOrderKind = "booking" | "registration" | "program" | "game" | "experience" | "pass";
export interface SupportOrder {
  kind: SupportOrderKind;
  ref: string;
  name: string | null;
  email: string | null;
  listingName: string | null;
  whenText: string | null;
  amountCents: number | null;
  paymentStatus: string | null;
  status: string | null;
  createdAt: string;
  residentId: string | null;
}
export interface SupportPerson {
  email: string;
  name: string;
  /** Has a resident (email sign-in) account. */
  resident: boolean;
  /** Partner/admin login with the same email. */
  account: { role: string; status: string } | null;
  createdAt: string;
}
export interface SupportSearchResult {
  query: string;
  people: SupportPerson[];
  orders: SupportOrder[];
  games: { id: string; activityLabel: string; date: string; time: string; status: string; bookingRef: string | null; place: string | null }[];
  circles: { id: string; name: string; activityLabel: string; status: string; county: string; memberCount: number }[];
}
export function supportSearch(q: string): Promise<SupportSearchResult> {
  return request(`/admin/support/search${q ? `?q=${encodeURIComponent(q)}` : ""}`);
}
export interface SupportPersonDetail {
  email: string;
  name: string;
  resident: { id: string; name: string; county: string; createdAt: string; householdMembers: number } | null;
  account: { id: string; name: string; role: string; status: string; createdAt: string } | null;
  orders: SupportOrder[];
}
export function fetchSupportPerson(email: string): Promise<SupportPersonDetail> {
  return request(`/admin/support/people/${encodeURIComponent(email)}`);
}
export interface SupportOrderDetail {
  order: SupportOrder;
  extra: Record<string, string | number | null>;
  refunds: { amountMinor: number; currency: string; kind: string; status: string; reason: string; createdAt: string }[];
  underReview: boolean;
}
export function fetchSupportOrder(kind: string, ref: string): Promise<SupportOrderDetail> {
  return request(`/admin/support/orders/${encodeURIComponent(kind)}/${encodeURIComponent(ref)}`);
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

export function setPlaceSuggestionStatus(id: string, status: "approved" | "rejected", reason: DecisionReasonInput = {}): Promise<{ ok: boolean }> {
  return request(`/admin/place-suggestions/${id}/status`, { method: "PUT", body: JSON.stringify({ status, ...reason }) });
}

// --- Media (Cloudinary/R2 architecture pass) — usage visibility, the
// small admin-managed editorial collection, and the same "no redeploy
// needed" pause-switch shape as the pre-existing maps-enabled config. -----

export interface MediaUsageResponse {
  application: { byProviderAndStatus: { provider: string; status: string; count: number; bytes: number }[]; trackedSince: string | null; note: string };
  providerReported: { r2: { available: boolean; note: string }; cloudinary: { available: boolean; note: string } };
  hasPendingR2Cleanup: boolean;
  hasPendingDeletionRetries: boolean;
  config: {
    uploadsEnabled: boolean;
    cloudinaryConfigured: boolean;
    cloudinaryEnabledByEnv: boolean;
    cloudinaryRuntimeEnabled: boolean;
    cloudinaryUploadAllowed: boolean;
    galleryLimits: Record<string, number>;
  };
}

export function fetchMediaUsage(): Promise<MediaUsageResponse> {
  return request(`/admin/media/usage`);
}

export interface EditorialImage {
  id: string;
  url: string;
  caption: string | null;
  bytes: number | null;
  width: number | null;
  height: number | null;
  createdAt: string;
}

export function fetchEditorialImages(): Promise<{ images: EditorialImage[] }> {
  return request(`/admin/media/editorial`);
}

/** Raw fetch, not request() — this is a multipart upload, same reasoning
 * as api/public.ts's uploadImage(). */
export async function uploadEditorialImage(file: File, caption: string): Promise<{ id: string; url: string }> {
  const form = new FormData();
  form.append("file", file);
  if (caption) form.append("caption", caption);
  const res = await fetch(`/api/admin/media/editorial`, { method: "POST", credentials: "include", body: form });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || `Upload failed: ${res.status}`);
  }
  return res.json();
}

export function deleteEditorialImage(id: string): Promise<{ ok: boolean }> {
  return request(`/admin/media/editorial/${id}`, { method: "DELETE" });
}

export function fetchMediaUploadsEnabled(): Promise<{ enabled: boolean }> {
  return request(`/admin/media/config/uploads-enabled`);
}

export function setMediaUploadsEnabled(enabled: boolean): Promise<{ enabled: boolean }> {
  return request(`/admin/media/config/uploads-enabled`, { method: "PUT", body: JSON.stringify({ enabled }) });
}

export function fetchCloudinaryUploadsEnabled(): Promise<{ enabled: boolean; configuredByEnv: boolean; credentialsPresent: boolean }> {
  return request(`/admin/media/config/cloudinary-enabled`);
}

export function setCloudinaryUploadsEnabled(enabled: boolean): Promise<{ enabled: boolean }> {
  return request(`/admin/media/config/cloudinary-enabled`, { method: "PUT", body: JSON.stringify({ enabled }) });
}

// --- Recommendation weights (community participation upgrade, Release 4) ---

export type RecommendationWeights = Record<"interest" | "availability" | "distance" | "goal" | "social" | "budget" | "circle", number>;

export function fetchRecommendationWeights(): Promise<{ weights: RecommendationWeights; defaults: RecommendationWeights }> {
  return request(`/admin/recommendation-weights`);
}

export function saveRecommendationWeights(weights: RecommendationWeights): Promise<{ weights: RecommendationWeights }> {
  return request(`/admin/recommendation-weights`, { method: "PUT", body: JSON.stringify({ weights }) });
}

// --- Commerce Engine (Phase 1): versioned commercial rules -----------------
// Mirrors server/src/commerce/catalog.ts + rules.ts + routes/adminCommerce.ts.

export type CommerceScopeType = "global" | "scenario" | "category" | "partner";

export type CommerceFieldSpec =
  | { kind: "bps"; label: string; help?: string; min: number; max: number }
  | { kind: "minor"; label: string; help?: string; min: number; max: number }
  | { kind: "int"; label: string; help?: string; unit: string; min: number; max: number }
  | { kind: "enum"; label: string; help?: string; values: string[] };

export interface CommerceRuleKeySpec {
  key: string;
  label: string;
  description: string;
  /** Where the rule actually takes effect today (server catalogue). */
  appliesTo?: string;
  scopes: CommerceScopeType[];
  fields: Record<string, CommerceFieldSpec>;
  v1: Record<string, number | string>;
}

export interface CommerceSwitchState {
  key: string;
  label: string;
  description: string;
  defaultValue: boolean;
  activeFromPhase: number | null;
  /** Admin-facing: who sees what change when this is on (text only). */
  whenOn?: string;
  enabled: boolean;
}

export interface CommerceCatalog {
  ruleKeys: CommerceRuleKeySpec[];
  scenarios: string[];
  categories: string[];
  switches: CommerceSwitchState[];
  /** Stage 5f — switch → switches it needs on. */
  switchDependencies?: Record<string, string[]>;
  secondApproverRequired: boolean;
}

export interface CommerceRuleVersion {
  id: number;
  ruleKey: string;
  scopeType: CommerceScopeType;
  scopeId: string;
  version: number;
  status: "draft" | "review" | "approved" | "published" | "retired" | "discarded";
  lifecycle: string;
  inForce: boolean;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  payload: Record<string, number | string>;
  payloadHash: string;
  previousVersionId: number | null;
  createdBy: string;
  approvedBy: string | null;
  publishedBy: string | null;
  publishedAt: string | null;
  changeReason: string;
  createdAt: string;
}

export interface CommerceFieldDiff {
  field: string;
  label: string;
  from: number | string | null;
  to: number | string | null;
}

export interface CommercePriceBreakdown {
  listMinor: number;
  discountMinor: number;
  goodsGrossMinor: number;
  vatMinor: number;
  customerFeeMinor: number;
  depositMinor: number;
  customerPaidMinor: number;
  partnerGrossMinor: number;
  successFeeMinor: number;
  paymentCostMinor: number;
  partnerPayoutMinor: number;
  platformRevenueMinor: number;
  platformContributionMinor: number;
}

export interface CommercePreview {
  ruleKey: string;
  changes: CommerceFieldDiff[];
  samples: { listMinor: number; current: CommercePriceBreakdown; proposed: CommercePriceBreakdown }[];
  recentOrders: { kind: string; ref: string; chargedMinor: number; proposedCustomerPaidMinor: number; proposedPartnerPayoutMinor: number; proposedPlatformRevenueMinor: number }[];
}

export interface CommerceAuditEntry {
  id: number;
  actorUserId: string | null;
  actorEmail: string | null;
  action: string;
  objectType: string;
  objectId: string;
  previousValue: string | null;
  newValue: string | null;
  reason: string | null;
  correlationId: string | null;
  environment: string | null;
  createdAt: string;
}

export function fetchCommerceCatalog(): Promise<CommerceCatalog> {
  return request(`/admin/commerce/catalog`);
}

export function fetchCommerceRules(key?: string): Promise<CommerceRuleVersion[]> {
  return request(`/admin/commerce/rules${key ? `?key=${encodeURIComponent(key)}` : ""}`);
}

export function fetchCommerceRule(id: number): Promise<{ version: CommerceRuleVersion; previous: CommerceRuleVersion | null; changesFromPrevious: CommerceFieldDiff[] }> {
  return request(`/admin/commerce/rules/${id}`);
}

export function previewCommerceRule(id: number): Promise<CommercePreview> {
  return request(`/admin/commerce/rules/${id}/preview`);
}

export function createCommerceDraft(input: { key: string; scopeType: CommerceScopeType; scopeId: string; payload: Record<string, number | string>; reason: string }): Promise<CommerceRuleVersion> {
  return request(`/admin/commerce/rules/drafts`, { method: "POST", body: JSON.stringify(input) });
}

export function updateCommerceDraft(id: number, input: { payload: Record<string, number | string>; reason: string }): Promise<CommerceRuleVersion> {
  return request(`/admin/commerce/rules/${id}`, { method: "PUT", body: JSON.stringify(input) });
}

export type CommerceRuleAction = "publish" | "approve" | "discard" | "end" | "rollback" | "review" | "retire";

export function commerceRuleAction(id: number, action: CommerceRuleAction, input: { reason: string; effectiveFrom?: string; effectiveTo?: string }): Promise<CommerceRuleVersion> {
  return request(`/admin/commerce/rules/${id}/${action}`, { method: "POST", body: JSON.stringify(input) });
}

export function setCommerceSwitch(key: string, enabled: boolean, reason: string): Promise<{ key: string; enabled: boolean }> {
  return request(`/admin/commerce/switches/${encodeURIComponent(key)}`, { method: "PUT", body: JSON.stringify({ enabled, reason }) });
}

export function fetchCommerceAudit(): Promise<CommerceAuditEntry[]> {
  return request(`/admin/commerce/audit`);
}

// --- Commerce Engine (Phase 2): orders + shadow pricing ---------------------

export interface CommerceOrderRow {
  id: string;
  sourceType: string;
  sourceRef: string;
  scenario: string;
  partnerKind: string;
  partnerId: string;
  orderStatus: string;
  paymentStatus: string;
  fulfilmentStatus: string;
  payoutStatus: string;
  currency: string;
  createdAt: string;
  ruleHash: string;
  listMinor: number;
  discountMinor: number;
  vatMinor: number;
  customerFeeMinor: number;
  customerPaidMinor: number;
  successFeeMinor: number;
  partnerPayoutMinor: number;
  platformRevenueMinor: number;
  engineVersion: string;
  ruleSources: { id: number; scopeType: string; scopeId: string; version: number }[];
}

export interface CommerceShadowReport {
  summary: { sourceType: string; matched: number; mismatched: number; lastSeen: string }[];
  mismatches: { id: number; sourceType: string; sourceRef: string; diffFields: string; createdAt: string; legacyTotalMinor: number; engineTotalMinor: number }[];
}

export function fetchCommerceOrders(q?: string): Promise<CommerceOrderRow[]> {
  return request(`/admin/commerce/orders${q ? `?q=${encodeURIComponent(q)}` : ""}`);
}

export function fetchCommerceShadow(): Promise<CommerceShadowReport> {
  return request(`/admin/commerce/shadow`);
}

// --- Revenue & Connect Stage 3: finance, simulator, plans, roles, help ------


export interface SimulationResult {
  result: PriceEstimate;
  planKey: string;
  feePlanKey: string;
  rules: { key: string; hash: string; sources: { id: number; scopeType: string; scopeId: string; version: number }[] }[];
  resolvedAt: string;
}

export function simulatePrice(input: EstimateInput & { partnerKind?: string; partnerId?: string; credits?: { funder: "helloCircle" | "vendor"; amountMinor: number }[] }): Promise<SimulationResult> {
  return request(`/admin/commerce/simulate`, { method: "POST", body: JSON.stringify(input) });
}

export function simulatePlans(monthlyGmvMinor: number, orders: number): Promise<PlanComparison> {
  return request(`/admin/commerce/simulate/plans`, { method: "POST", body: JSON.stringify({ monthlyGmvMinor, orders }) });
}

export interface LedgerBalance { account: string; name: string; accountType: string; currency: string; balanceMinor: number }
export function fetchLedgerBalances(): Promise<{ balanced: boolean; accounts: LedgerBalance[] }> {
  return request(`/admin/finance/ledger/balances`);
}

export interface SettlementRunResult {
  runId: number;
  dryRun: boolean;
  released: { type: string; ref: string; amountMinor: number; partyType: string; partyId: string }[];
  settled: { partyType: string; partyId: string; netMinor: number; settlementId: number | null }[];
  carried: { partyType: string; partyId: string; netMinor: number }[];
}
export function runSettlementApi(input: { runKey: string; dryRun: boolean; reason: string }): Promise<SettlementRunResult> {
  return request(`/admin/finance/settlements/run`, { method: "POST", body: JSON.stringify(input) });
}
export function fetchSettlements(): Promise<{ id: number; runKey: string; partyType: string; partyId: string; netMinor: number; status: string; transferId: string | null; createdAt: string }[]> {
  return request(`/admin/finance/settlements`);
}

/** One settlement with its line items (GET /admin/finance/settlements/:id — raw columns). */
export interface SettlementDetail {
  settlement: { id: number; run_id: number; party_type: string; party_id: string; currency: string; net_minor: number; status: string; ledger_group_id: string | null; transfer_id: string | null; paid_reference: string | null; created_at: string; updated_at: string };
  items: { groupId: string; description: string; amountMinor: number }[];
}
export function fetchSettlement(id: number | string): Promise<SettlementDetail> {
  return request(`/admin/finance/settlements/${encodeURIComponent(String(id))}`);
}
/** Payment records matching an order ref, payment intent or checkout session (GET /admin/finance/payments?ref=). */
export interface PaymentRecordRow { id: number; source_type: string; source_ref: string; provider: string; checkout_session_id: string | null; payment_intent_id: string | null; amount_minor: number; currency: string; status: string; fee_estimate_minor: number | null; created_at: string; updated_at: string }
export function fetchPaymentRecords(ref: string): Promise<PaymentRecordRow[]> {
  return request(`/admin/finance/payments?ref=${encodeURIComponent(ref)}`);
}
/** An order's frozen allocation (who is owed what), 404 when none was frozen. */
export interface OrderAllocation { snapshot: Record<string, unknown>; lines: { role: string; partyType: string | null; partyId: string | null; amountMinor: number }[]; releases: { partyType: string; partyId: string; releasedMinor: number; releasedAt: string }[] }
export function fetchOrderAllocation(type: string, ref: string): Promise<OrderAllocation> {
  return request(`/admin/finance/allocations/${encodeURIComponent(type)}/${encodeURIComponent(ref)}`);
}

export interface WebhookEventRow { id: number; provider: string; eventId: string; eventType: string; status: string; attempts: number; lastError: string | null; summary: Record<string, unknown>; receivedAt: string; processedAt: string | null }
export function fetchWebhookEvents(status?: string): Promise<WebhookEventRow[]> {
  return request(`/admin/finance/webhooks${status ? `?status=${encodeURIComponent(status)}` : ""}`);
}
export function replayWebhookEvent(id: number, reason: string): Promise<{ ok: boolean; outcome: string }> {
  return request(`/admin/finance/webhooks/${id}/replay`, { method: "POST", body: JSON.stringify({ reason }) });
}

// D-10 / D-11 — payment reviews (Finance → Payment reviews).
export interface PaymentReviewOrder { status?: string | null; paymentStatus?: string; totalMinor?: number; reviewHoldUntil?: string | null; sessionId?: string | null; missing?: boolean }
export interface PaymentReviewRow {
  id: number;
  checkoutSessionId: string;
  sourceType: string | null;
  sourceRef: string | null;
  receivedMinor: number | null;
  receivedCurrency: string | null;
  reason: string;
  holdStatus: string;
  reviewHoldUntil: string | null;
  urgency: string;
  autoRefund: string;
  status: string;
  resolution: string | null;
  flaggedAt: string;
  order: PaymentReviewOrder | null;
}
export interface PaymentReviewDetail {
  review: PaymentReviewRow & { paymentIntentId: string | null; chargeId: string | null; agreedMinor: number | null; agreedCurrency: string | null; providerPayment: string; detail: string | null; startAt: string | null; autoRefundNote: string | null; resolvedAt: string | null; resolvedBy: string | null; firstEventId: string | null; lastRecheckAt: string | null; lastRecheckOutcome: string | null };
  order: PaymentReviewOrder | null;
  payment: { id: number; amountMinor: number; currency: string; status: string; paymentIntentId: string | null; createdAt: string } | null;
  refunds: { id: number; amountMinor: number; currency: string; kind: string; origin: string; status: string; providerRefundId: string | null; idempotencyKey: string; lastError: string | null; reason: string; createdAt: string; updatedAt: string }[];
  events: { id: number; eventId: string; eventType: string; status: string; attempts: number; lastError: string | null; resolution: string | null; receivedAt: string; resolvedAt: string | null }[];
  alerts: { kind: string; createdAt: string }[];
}
export interface RecheckResult { outcome: "closed" | "open"; reason: string; association: boolean; chargedMinor: number | null; succeededMinor: number; pendingMinor: number; failedMinor: number; disputed: boolean; recordedRefunds: number; updatedRefunds: number }
export function fetchPaymentReviews(status: "open" | "resolved" | "all" = "open"): Promise<PaymentReviewRow[]> {
  return request(`/admin/finance/payment-reviews?status=${status}`);
}
export function fetchPaymentReview(id: number | string): Promise<PaymentReviewDetail> {
  return request(`/admin/finance/payment-reviews/${id}`);
}
export function recheckPaymentReview(id: number | string, reason: string): Promise<RecheckResult> {
  return request(`/admin/finance/payment-reviews/${id}/recheck`, { method: "POST", body: JSON.stringify({ reason }) });
}

export interface RefundRow { id: number; source_type: string; source_ref: string; amount_minor: number; currency?: string; kind: string; origin: string; responsible: string; reason: string; status: string; provider_refund_id?: string | null; payment_record_id?: number | null; initiated_by?: string | null; created_at: string; updated_at?: string }
export function fetchRefunds(): Promise<RefundRow[]> {
  return request(`/admin/finance/refunds`);
}
export function issueAdminRefund(input: { sourceType: string; ref: string; amountMinor?: number; reason: string; responsible: "customer" | "partner" | "platform" }): Promise<{ refundId: number; amountMinor: number; full: boolean }> {
  return request(`/admin/finance/refunds`, { method: "POST", body: JSON.stringify(input) });
}

export interface DisputeRow { id: number; provider_dispute_id: string; source_type: string | null; source_ref: string | null; payment_intent_id?: string | null; amount_minor: number; currency?: string; reason: string; status: string; recovery_status: string; responsible: string | null; evidence_due_by: string | null; created_at?: string; updated_at?: string }
export function fetchDisputes(): Promise<DisputeRow[]> {
  return request(`/admin/finance/disputes`);
}
export function decideDisputeRecovery(id: number, responsible: "partner" | "platform", reason: string): Promise<{ recovered: number }> {
  return request(`/admin/finance/disputes/${id}/recovery`, { method: "POST", body: JSON.stringify({ responsible, reason }) });
}
export function reconcileFees(): Promise<{ reconciled: number; skipped: number }> {
  return request(`/admin/finance/fees/reconcile`, { method: "POST", body: "{}" });
}

export interface PlansOverview { plans: { planKey: string; name: string; status: string }[]; free: Record<string, number | string>; pro: Record<string, number | string>; proBreakEvenMonthlyGmvMinor: number | null }
export function fetchPlansOverview(): Promise<PlansOverview> {
  return request(`/admin/commerce/plans`);
}
export function fetchPartnerPlan(kind: string, id: string): Promise<{ current: { planKey: string; feePlanKey: string; source: string; effectiveFrom: string | null; effectiveTo: string | null }; history: Record<string, unknown>[] }> {
  return request(`/admin/commerce/partners/${encodeURIComponent(kind)}/${encodeURIComponent(id)}/plan`);
}
export function assignPartnerPlan(kind: string, id: string, input: { planKey: string; feePlanKey?: string | null; effectiveFrom?: string; reason: string }) {
  return request(`/admin/commerce/partners/${encodeURIComponent(kind)}/${encodeURIComponent(id)}/plan`, { method: "POST", body: JSON.stringify(input) });
}

export interface CampaignRow { id: number; campaignKey: string; planKey: string; commissionPlanKey: string; benefitDays: number; maxEnrollments: number; startsAt: string; endsAt: string; status: string; terms: string; enrolled: number }
export function fetchCampaigns(): Promise<CampaignRow[]> {
  return request(`/admin/commerce/campaigns`);
}
export function createCampaign(input: { campaignKey: string; planKey: string; commissionPlanKey: string; benefitDays: number; maxEnrollments: number; startsAt: string; endsAt: string; terms: string; reason: string }): Promise<{ id: number }> {
  return request(`/admin/commerce/campaigns`, { method: "POST", body: JSON.stringify(input) });
}
export function enrollInCampaign(id: number, input: { partnerKind: string; partnerId: string; reason: string }) {
  return request(`/admin/commerce/campaigns/${id}/enroll`, { method: "POST", body: JSON.stringify(input) });
}

export interface AdminAccount { id: string; email: string; name: string; adminRole: "super" | "finance" | "support" | "legal" | null; createdAt: string; mfaEnrolled?: boolean }
export function fetchAdmins(): Promise<AdminAccount[]> {
  return request(`/admin/admins`);
}
export function setAdminRole(id: string, adminRole: string, reason: string) {
  return request(`/admin/admins/${encodeURIComponent(id)}/role`, { method: "PUT", body: JSON.stringify({ adminRole, reason }) });
}

export function updateFieldHelp(key: string, input: Omit<FieldHelpEntry, "helpKey" | "version"> & { reason: string }) {
  return request(`/admin/help/${encodeURIComponent(key)}`, { method: "PUT", body: JSON.stringify(input) });
}

// --- Revenue & Connect Stage 4: policy CMS, complaints, traders -------------

export interface AdminPolicyDoc { docKey: string; title: string; audience: string; acceptanceAudience: string | null; latestVersion: number; latestStatus: string; publishedVersion: number | null; publishedAt: string | null }
export interface AdminPolicyOverview { documents: AdminPolicyDoc[]; placeholders: { placeholder: string; value: string | null }[]; extraValues: { placeholder: string; value: string }[] }
export interface AdminPolicyVersion { id: number; docKey: string; version: number; status: string; body: string; publishedBody: string | null; contentHash: string | null; changeSummary: string | null; material: number; effectiveFrom: string | null; createdBy: string; approvedBy: string | null; legalReviewerName: string | null; legalReviewedAt: string | null; publishedAt: string | null; retiredAt: string | null; rowVersion: number; createdAt: string }
export interface AdminPolicyPreview extends AdminPolicyVersion { rendered: string; blockers: { placeholders: string[]; notes: string[]; legalReview: boolean } }

/** Company profile completeness (sitemap audit P1-02): each field is missing,
 * set but not yet in a published policy, or published (shown publicly). */
export interface CompanyProfileField {
  key: string;
  label: string;
  value: string | null;
  state: "missing" | "set_not_published" | "published";
  /** What's expected for this field (the owner's recorded decision). */
  guidance: string;
  /** The confirmed value, where one is decided. */
  expected: string | null;
  /** Set, but not the confirmed value. */
  mismatch: boolean;
}
export function fetchCompanyProfile(): Promise<CompanyProfileField[]> {
  return request(`/admin/policies/company-profile`);
}
export function fetchAdminPolicies(): Promise<AdminPolicyOverview> {
  return request(`/admin/policies`);
}
export function fetchPolicyVersions(docKey: string): Promise<AdminPolicyVersion[]> {
  return request(`/admin/policies/${encodeURIComponent(docKey)}/versions`);
}
export function previewPolicyVersion(id: number): Promise<AdminPolicyPreview> {
  return request(`/admin/policies/versions/${id}/preview`);
}
export function createPolicyDraft(docKey: string, input: { changeSummary?: string; reason: string }): Promise<{ id: number }> {
  return request(`/admin/policies/${encodeURIComponent(docKey)}/drafts`, { method: "POST", body: JSON.stringify(input) });
}
export function savePolicyDraft(id: number, input: { body: string; changeSummary?: string; material?: boolean; rowVersion: number }) {
  return request(`/admin/policies/versions/${id}`, { method: "PUT", body: JSON.stringify(input) });
}
export type PolicyAction = "submit" | "approve" | "reject" | "legal_signoff" | "publish" | "discard";
export function policyTransition(id: number, action: PolicyAction, input: { reason: string; reviewerName?: string; effectiveFrom?: string; material?: boolean }): Promise<{ status: string }> {
  return request(`/admin/policies/versions/${id}/${action}`, { method: "POST", body: JSON.stringify(input) });
}
export function setPolicyPlaceholder(name: string, value: string, reason: string) {
  return request(`/admin/policies/placeholders/${encodeURIComponent(name)}`, { method: "PUT", body: JSON.stringify({ value, reason }) });
}

export interface AdminComplaint { id: number; kind: string; subjectType: string; subjectRef: string | null; body: string; status: string; decision: string | null; statementOfReasons: string | null; decidedAt: string | null; createdAt: string; reportId: number | null; submitterType: string; submitterId: string | null; email: string; decidedBy: string | null }
export function fetchAdminComplaints(status?: string): Promise<AdminComplaint[]> {
  return request(`/admin/complaints${status ? `?status=${status}` : ""}`);
}
export function decideComplaint(id: number, input: { status: "in_review" } | { status: "closed"; decision: "upheld" | "rejected" | "resolved"; statementOfReasons: string }) {
  return request(`/admin/complaints/${id}`, { method: "PUT", body: JSON.stringify(input) });
}

export interface AdminTrader { partyType: string; partyId: string; legalName: string; tradingName: string | null; address: string; country: string; email: string; phone: string; companyNumber: string | null; vatNumber: string | null; selfCertifiedAt: string | null; verificationStatus: string; entityType: string; tin: string | null; hasTin: boolean; dateOfBirth: string | null; insuranceExpiresAt: string | null; verificationNote: string | null; updatedAt: string }
export function fetchAdminTraders(status?: string): Promise<AdminTrader[]> {
  return request(`/admin/traders${status ? `?status=${status}` : ""}`);
}
export function verifyTrader(type: string, id: string, status: "verified" | "rejected" | "unverified", note: string) {
  return request(`/admin/traders/${encodeURIComponent(type)}/${encodeURIComponent(id)}/verification`, { method: "PUT", body: JSON.stringify({ status, note }) });
}

// --- Revenue & Connect Stage 5a: Connect accounts, transfers, recovery -------

export interface AdminConnectedAccount { partyType: string; partyId: string; accountId: string; country: string; detailsSubmitted: number; payoutsEnabled: number; transfersCapability: string; requirementsDue: string | null; disabledReason: string | null; updatedAt: string; readiness: string[] }
export function fetchConnectedAccounts(): Promise<AdminConnectedAccount[]> {
  return request(`/admin/finance/connect/accounts`);
}
export interface AdminTransfer { id: number; settlementId: number; attempt: number; partyType: string; partyId: string; amountMinor: number; reversedMinor: number; status: string; providerTransferId: string | null; error: string | null; createdAt: string }
export function fetchTransfers(): Promise<AdminTransfer[]> {
  return request(`/admin/finance/transfers`);
}
export interface TransferRunResult { dryRun: boolean; transferred: { settlementId: number; amountMinor: number; transferId?: string }[]; held: { settlementId: number; reasons: string[] }[]; failed: { settlementId: number; status: string; error: string }[] }
export function runTransfersApi(input: { dryRun: boolean; reason: string }): Promise<TransferRunResult> {
  return request(`/admin/finance/transfers/run`, { method: "POST", body: JSON.stringify(input) });
}
// Stage 5c — partner debts and per-booking transfer allocations.
export interface DebtRecoveryResult { debtId: number; recoveredMinor: number; unrecoveredMinor: number; status: string; reversals: { reversalId: number; amountMinor: number; status: string; error?: string; allocations: { allocationId: number; amount: number }[] }[] }
export interface PartnerDebt { id: number; partyType: string; partyId: string; status: "open" | "recovered" | "offset"; openedMinor: number; recoveredMinor: number; offsetMinor: number; outstandingMinor: number; reason: string; openedBy: string; openedAt: string; closedAt: string | null }
export function fetchPartnerDebts(status?: string): Promise<PartnerDebt[]> {
  return request(`/admin/finance/debts${status ? `?status=${status}` : ""}`);
}
export function openPartnerDebt(kind: string, id: string, reason: string): Promise<DebtRecoveryResult> {
  return request(`/admin/finance/partners/${encodeURIComponent(kind)}/${encodeURIComponent(id)}/debts`, { method: "POST", body: JSON.stringify({ reason }) });
}
export function retryPartnerDebt(debtId: number, reason: string): Promise<DebtRecoveryResult> {
  return request(`/admin/finance/debts/${debtId}/retry`, { method: "POST", body: JSON.stringify({ reason }) });
}
export interface TransferAllocation { id: number; kind: string; sourceType: string | null; sourceRef: string | null; amountMinor: number; reversedMinor: number }
export function fetchTransferAllocations(transferId: number): Promise<TransferAllocation[]> {
  return request(`/admin/finance/transfers/${transferId}/allocations`);
}
export function reverseTransferAllocation(allocationId: number, amountMinor: number, reason: string): Promise<DebtRecoveryResult> {
  return request(`/admin/finance/allocations/${allocationId}/reverse`, { method: "POST", body: JSON.stringify({ amountMinor, reason }) });
}

// --- Revenue & Connect Stage 5b: customer credits, Pro subscriptions ----------

export function grantResidentCredit(input: {
  email: string;
  amountMinor: number;
  kind: "goodwill" | "promotional" | "refund";
  reason: string;
  fundingOwner?: "helloCircle" | "partner";
  expiresAt?: string | null;
  idempotencyKey?: string;
}): Promise<{ id: number; expiresAt: string; duplicate?: boolean }> {
  return request(`/admin/finance/credits`, { method: "POST", body: JSON.stringify(input) });
}
// --- Stage 5f: finance views for rewards, credit, coupons, bank payouts --------
export interface AdminRewardRow { partyType: string; partyId: string; available: number; debt: number; earned: number; redeemed: number }
export function fetchAdminRewards(): Promise<AdminRewardRow[]> {
  return request(`/admin/finance/rewards`);
}
export function fetchAdminRewardHistory(kind: string, id: string): Promise<import("./vendor").RewardHistoryEntry[]> {
  return request(`/admin/finance/rewards/${encodeURIComponent(kind)}/${encodeURIComponent(id)}/history`);
}
export function adjustPartnerPoints(kind: string, id: string, input: { points: number; reason: string; idempotencyKey: string }): Promise<{ id: number; duplicate: boolean }> {
  return request(`/admin/finance/rewards/${encodeURIComponent(kind)}/${encodeURIComponent(id)}/adjust`, { method: "POST", body: JSON.stringify(input) });
}
export interface AdminCreditSummary {
  outstandingMinor: number;
  residents: number;
  grants: { id: number; email: string | null; kind: string; amountMinor: number; remainingMinor: number; currency: string; fundingOwner: string; expiresAt: string; createdAt: string; createdBy: string }[];
}
export function fetchCreditSummary(): Promise<AdminCreditSummary> {
  return request(`/admin/finance/credits/summary`);
}
export interface AdminCouponUsage { code: string; uses: number; confirmed: number; returned: number; discountMinor: number; platformFundedMinor: number; lastUsedAt: string }
export function fetchCouponUsage(): Promise<AdminCouponUsage[]> {
  return request(`/admin/finance/coupons/usage`);
}
export interface AdminBankPayout { id: string; accountId: string; partyType: string | null; partyId: string | null; amountMinor: number; currency: string; status: string; arrivalDate: string | null; failureCode: string | null; createdAt: string }
export function fetchBankPayouts(): Promise<AdminBankPayout[]> {
  return request(`/admin/finance/payouts`);
}
export function fetchResidentCredits(email: string): Promise<{ residentId: string; enabled: boolean; balanceMinor: number; lots: { id: number; kind: string; amountMinor: number; remainingMinor: number; expiresAt: string; createdAt: string }[] }> {
  return request(`/admin/finance/credits?email=${encodeURIComponent(email)}`);
}
export interface AdminSubscription { id: number; partyType: string; partyId: string; subscriptionId: string | null; status: string; grossMinor: number; currentPeriodEnd: string | null; cancelAtPeriodEnd: number; graceUntil: string | null; createdAt: string }
export function fetchSubscriptions(): Promise<AdminSubscription[]> {
  return request(`/admin/finance/subscriptions`);
}
export function sweepSubscriptionsApi(): Promise<{ ended: number }> {
  return request(`/admin/finance/subscriptions/sweep`, { method: "POST", body: "{}" });
}

/** D-01 — one organisation: members, listings by status, upcoming obligations. */
export function fetchAdminOrganisation(id: string): Promise<import("../types").AdminOrganisationRecord> {
  return request(`/admin/organisations/${encodeURIComponent(id)}`);
}

/** D-01 — suspend (reason required) or reinstate (optional message) a whole organisation. Super only. */
export function setOrganisationStatus(id: string, status: "suspended" | "active", reason: DecisionReasonInput = {}): Promise<{ ok: boolean; status: string; changed: boolean }> {
  return request(`/admin/organisations/${encodeURIComponent(id)}/status`, { method: "PUT", body: JSON.stringify({ status, ...reason }) });
}

// --- Operations (OG-05 / OG-10 / OG-14 / OG-15 / OG-24) ------------------------------

export interface ServerPage<T> {
  items: T[];
  nextCursor: string | null;
}

const qs = (params: Record<string, string | undefined | null>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : "";
};

export interface OperationalException {
  id: string;
  kind: "payment_review" | "dispute" | "refund_pending" | "refund_stuck" | "webhook_failed" | "payout_failed" | "subscription_past_due" | "partner_debt";
  severity: "high" | "medium";
  team: "Finance";
  title: string;
  detail: string;
  status: string;
  amountMinor: number | null;
  createdAt: string;
  party: { type: string; id: string; name: string | null } | null;
  link: string;
}

export function fetchOperationalExceptions(): Promise<OperationalException[]> {
  return request(`/admin/finance/exceptions`);
}

export interface PersonRow {
  id: string;
  name: string;
  email: string;
  county: string;
  hostStatus: string;
  deactivated: boolean;
  createdAt: string;
}
export function fetchPeoplePage(f: { q?: string; filter?: string; cursor?: string | null }): Promise<ServerPage<PersonRow>> {
  return request(`/admin/operations/people${qs({ q: f.q, filter: f.filter, cursor: f.cursor, limit: "25" })}`);
}

export function fetchOrdersPage(f: { q?: string; kind?: string; status?: string; paymentStatus?: string; from?: string; to?: string; cursor?: string | null }): Promise<ServerPage<SupportOrder>> {
  return request(`/admin/operations/orders${qs({ ...f, cursor: f.cursor ?? undefined, limit: "25" })}`);
}

export interface ActivityRow {
  id: string;
  activityLabel: string;
  date: string;
  time: string;
  status: string;
  lifecycle: string;
  hostResidentId: string;
  hostName: string | null;
  place: string;
  capacity: number;
  joined: number;
  priceCents: number | null;
  reports: number;
  createdAt: string;
}
export function fetchActivitiesPage(f: { q?: string; status?: string; when?: string; cursor?: string | null }): Promise<ServerPage<ActivityRow>> {
  return request(`/admin/operations/activities${qs({ ...f, cursor: f.cursor ?? undefined, limit: "25" })}`);
}
export interface AdminActivityDetail {
  activity: Record<string, unknown> & { id: string; activityLabel: string; status: string; hostName: string | null; hostEmail: string | null; date: string; time: string };
  participants: { residentId: string; name: string | null; email: string | null; status: string; paymentStatus: string; totalCents: number | null; joinedAt: string; checkedInAt: string | null }[];
  reports: { id: number; reason: string; status: string; createdAt: string }[];
}
export function fetchAdminActivity(id: string): Promise<AdminActivityDetail> {
  return request(`/admin/operations/activities/${encodeURIComponent(id)}`);
}
export function cancelActivityAsAdmin(id: string, reason: DecisionReasonInput): Promise<{ ok: boolean }> {
  return request(`/admin/operations/activities/${encodeURIComponent(id)}/cancel`, { method: "POST", body: JSON.stringify(reason) });
}

export interface CircleRow {
  id: string;
  slug: string | null;
  name: string;
  activityLabel: string;
  county: string;
  status: string;
  joinMode: string;
  members: number;
  organiserName: string | null;
  reports: number;
  createdAt: string;
}
export function fetchAdminCirclesPage(f: { q?: string; status?: string; cursor?: string | null }): Promise<ServerPage<CircleRow>> {
  return request(`/admin/operations/circles${qs({ ...f, cursor: f.cursor ?? undefined, limit: "25" })}`);
}

// Circle planning moderation (2026-10-24) — wishes are totals only.
export interface AdminCirclePlanning {
  /** closedBy (Circles 3.0): who closed a closed Circle — HelloCircle can only reopen its own closures. */
  circle: { id: string; name: string; slug: string | null; status: string; activityLabel: string; closedBy?: "organiser" | "helloCircle" | null };
  wishes: { interestKey: string; interest: string; weekStart: string; count: number }[];
  plans: { id: string; title: string; status: string; proposedDate: string | null; createdAt: string; createdByName: string | null; listingType?: string | null }[];
  polls: { id: string; question: string; status: string; createdAt: string; voters: number }[];
  /** Circles 3.1 — listings linked to the Circle, every status. */
  links?: { id: string; listingType: string; listingId: string; status: string; relationship: string; createdAt: string; linkedByName: string | null; title: string }[];
}
export function fetchAdminCirclePlanning(id: string): Promise<AdminCirclePlanning> {
  return request(`/admin/operations/circles/${encodeURIComponent(id)}/planning`);
}
export function adminRemoveCircleWish(id: string, wish: { weekStart: string; interestKey: string }, reason: string): Promise<{ ok: boolean }> {
  return request(`/admin/operations/circles/${encodeURIComponent(id)}/wishes/remove`, { method: "POST", body: JSON.stringify({ ...wish, reason }) });
}
export function adminRemoveCirclePlan(id: string, planId: string, reason: string): Promise<{ ok: boolean }> {
  return request(`/admin/operations/circles/${encodeURIComponent(id)}/plans/${encodeURIComponent(planId)}/remove`, { method: "POST", body: JSON.stringify({ reason }) });
}
/** Circles 3.1 — take down a linked listing (the listing itself is untouched). */
export function adminRemoveCircleLink(id: string, linkId: string, reason: string): Promise<{ ok: boolean }> {
  return request(`/admin/operations/circles/${encodeURIComponent(id)}/links/${encodeURIComponent(linkId)}/remove`, { method: "POST", body: JSON.stringify({ reason }) });
}
/** Circles 3.0 — HelloCircle closes a Circle (or reopens one it closed). Reason required; organisers are told. */
export function adminSetCircleOpen(id: string, action: "close" | "reopen", reason: string): Promise<{ ok: boolean }> {
  return request(`/admin/operations/circles/${encodeURIComponent(id)}/${action}`, { method: "POST", body: JSON.stringify({ reason }) });
}
export function adminDeleteCirclePoll(id: string, pollId: string, reason: string): Promise<{ ok: boolean }> {
  return request(`/admin/operations/circles/${encodeURIComponent(id)}/polls/${encodeURIComponent(pollId)}/delete`, { method: "POST", body: JSON.stringify({ reason }) });
}

export interface HostRow {
  id: string;
  name: string;
  email: string;
  hostStatus: string;
  hosted: number;
  upcoming: number;
  paidActivities: number;
  createdAt: string;
}
export function fetchHostsPage(f: { q?: string; status?: string; cursor?: string | null }): Promise<ServerPage<HostRow>> {
  return request(`/admin/operations/hosts${qs({ ...f, cursor: f.cursor ?? undefined, limit: "25" })}`);
}

export function cancelOrderAsAdmin(kind: string, ref: string, reason: string): Promise<{ ok: boolean; refund: "none" | "refunded" | "failed"; refundError?: string }> {
  return request(`/admin/operations/orders/${encodeURIComponent(kind)}/${encodeURIComponent(ref)}/cancel`, { method: "POST", body: JSON.stringify({ reason }) });
}

export function fetchAuditPage(f: { q?: string; action?: string; objectType?: string; objectId?: string; cursor?: string | null }): Promise<ServerPage<AuditEntry>> {
  return request(`/admin/audit${qs({ ...f, cursor: f.cursor ?? undefined, limit: "50" })}`);
}

export function proposeBookingChangeAsAdmin(ref: string, input: { date: string; time: string; message: string }): Promise<{ id: number }> {
  return request(`/admin/operations/orders/booking/${encodeURIComponent(ref)}/propose-change`, { method: "POST", body: JSON.stringify(input) });
}

// --- OG-31 — maps switch (runtime; server/src/routes/admin.ts) ---------------
export function fetchMapsEnabled(): Promise<{ enabled: boolean }> {
  return request(`/admin/config/maps-enabled`);
}

export function setMapsEnabled(enabled: boolean): Promise<{ enabled: boolean }> {
  return request(`/admin/config/maps-enabled`, { method: "PUT", body: JSON.stringify({ enabled }) });
}

// --- OG-29 / OG-31 — privacy requests and consent records (recording only) ---
export type PrivacyKind = "access" | "correction" | "erasure" | "objection";
export type PrivacyStatus = "received" | "in_progress" | "completed" | "refused";
export interface ConsentState {
  granted: boolean;
  source: string | null;
  policyDocKey: string | null;
  policyVersion: number | null;
  at: string | null;
}
export interface PrivacyRequestRow {
  id: number;
  kind: PrivacyKind;
  status: PrivacyStatus;
  email: string;
  residentId: string | null;
  name: string;
  createdAt: string;
  updatedAt: string;
}
export interface PrivacyRequestDetail extends PrivacyRequestRow {
  details: string;
  response: string | null;
  handledBy: string | null;
  consents: Record<string, ConsentState> | null;
}
export interface ConsentSubjectView {
  kind: "resident" | "partner" | "admin";
  name: string;
  current: Record<string, ConsentState>;
  history: { purpose: string; granted: number; source: string; policyDocKey: string | null; policyVersion: number | null; at: string }[];
}

export function fetchPrivacyRequests(status: "open" | PrivacyStatus | "all" = "open"): Promise<PrivacyRequestRow[]> {
  return request(`/admin/privacy/requests${status === "all" ? "" : `?status=${status}`}`);
}

export function fetchPrivacyRequest(id: number): Promise<PrivacyRequestDetail> {
  return request(`/admin/privacy/requests/${id}`);
}

export function updatePrivacyRequest(id: number, input: { status: Exclude<PrivacyStatus, "received">; response?: string }): Promise<PrivacyRequestDetail> {
  return request(`/admin/privacy/requests/${id}`, { method: "POST", body: JSON.stringify(input) });
}

export function fetchConsentsForEmail(email: string): Promise<ConsentSubjectView[]> {
  return request(`/admin/privacy/consents?email=${encodeURIComponent(email)}`);
}

// --- OG-24 — Vendors and All listings as numbered server pages ------------------------

export interface NumberedPage<T, C> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
  counts: C;
}
export type AdminListingType = "centre" | "club" | "experience";
export interface AdminListingRowData {
  type: AdminListingType;
  item: AdminListingSummary;
}
export interface AdminVendorRow extends AdminVendor {
  /** Centres + clubs + experiences, not deleted. */
  listingCount: number;
}

export function fetchAdminVendorPage(f: { q?: string; view?: string; type?: string; page: number; pageSize?: number }): Promise<NumberedPage<AdminVendorRow, { all: number; pending: number; approved: number; suspended: number }>> {
  return request(`/admin/vendors${qs({ q: f.q, view: f.view === "all" ? undefined : f.view, type: f.type === "all" ? undefined : f.type, page: String(f.page), pageSize: String(f.pageSize ?? 20) })}`);
}
export function fetchAdminVendor(id: string): Promise<AdminVendorRow & { orgMemberCount: number }> {
  return request(`/admin/vendors/${encodeURIComponent(id)}/summary`);
}
export function fetchAdminVendorListings(id: string): Promise<AdminListingRowData[]> {
  return request(`/admin/vendors/${encodeURIComponent(id)}/listings`);
}
export function fetchAdminListingPage(f: { q?: string; type?: string; view?: string; county?: string; show?: string; sort?: string; page: number; pageSize?: number }): Promise<
  NumberedPage<AdminListingRowData, { all: number; pending: number; approved: number; rejected: number; other: number }> & { typeCounts: Record<AdminListingType, number>; counties: string[] }
> {
  const all = (v?: string) => (v === "all" ? undefined : v);
  return request(`/admin/listings${qs({ q: f.q, type: all(f.type), view: all(f.view), county: all(f.county), show: all(f.show), sort: f.sort, page: String(f.page), pageSize: String(f.pageSize ?? 20) })}`);
}
export function fetchAdminListingSummary(type: string, id: string): Promise<AdminListingRowData> {
  return request(`/admin/listings/${encodeURIComponent(type)}/${encodeURIComponent(id)}/summary`);
}
