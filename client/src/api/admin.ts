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
export function resolveReport(id: number, input: { status?: "dismissed" | "actioned" | "suspended"; notes?: string; statementOfReasons?: string }): Promise<{ ok: boolean; suspendedAction: string | null }> {
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
  enabled: boolean;
}

export interface CommerceCatalog {
  ruleKeys: CommerceRuleKeySpec[];
  scenarios: string[];
  categories: string[];
  switches: CommerceSwitchState[];
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

export interface WebhookEventRow { id: number; provider: string; eventId: string; eventType: string; status: string; attempts: number; lastError: string | null; summary: Record<string, unknown>; receivedAt: string; processedAt: string | null }
export function fetchWebhookEvents(status?: string): Promise<WebhookEventRow[]> {
  return request(`/admin/finance/webhooks${status ? `?status=${encodeURIComponent(status)}` : ""}`);
}
export function replayWebhookEvent(id: number, reason: string): Promise<{ ok: boolean; outcome: string }> {
  return request(`/admin/finance/webhooks/${id}/replay`, { method: "POST", body: JSON.stringify({ reason }) });
}

export interface RefundRow { id: number; source_type: string; source_ref: string; amount_minor: number; kind: string; origin: string; responsible: string; reason: string; status: string; created_at: string }
export function fetchRefunds(): Promise<RefundRow[]> {
  return request(`/admin/finance/refunds`);
}
export function issueAdminRefund(input: { sourceType: string; ref: string; amountMinor?: number; reason: string; responsible: "customer" | "partner" | "platform" }): Promise<{ refundId: number; amountMinor: number; full: boolean }> {
  return request(`/admin/finance/refunds`, { method: "POST", body: JSON.stringify(input) });
}

export interface DisputeRow { id: number; provider_dispute_id: string; source_type: string | null; source_ref: string | null; amount_minor: number; reason: string; status: string; recovery_status: string; responsible: string | null; evidence_due_by: string | null }
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

export interface AdminAccount { id: string; email: string; name: string; adminRole: "super" | "finance" | "support" | "legal"; createdAt: string }
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
export function recoverPartnerBalance(kind: string, id: string, reason: string): Promise<{ recoveredMinor: number; unrecoveredMinor: number; reversals: { reversalId: number; amountMinor: number; status: string; error?: string }[] }> {
  return request(`/admin/finance/partners/${encodeURIComponent(kind)}/${encodeURIComponent(id)}/recover`, { method: "POST", body: JSON.stringify({ reason }) });
}

// --- Revenue & Connect Stage 5b: customer credits, Pro subscriptions ----------

export function grantResidentCredit(input: { email: string; amountMinor: number; kind: "goodwill" | "promotional" | "refund"; reason: string }): Promise<{ id: number; expiresAt: string }> {
  return request(`/admin/finance/credits`, { method: "POST", body: JSON.stringify(input) });
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
