import { AdminPrivacyPage } from "../components/admin/AdminPrivacy";
import { useCallback, useEffect, useState } from "react";
import { AdminMfaGate, AdminMfaReauthHost } from "../components/admin/AdminMfa";
import { AdminActivitiesPage, AdminCirclesPage, AdminExceptionsPage, AdminHostsPage, AdminOrdersPage, AdminPeoplePage } from "../components/admin/AdminOperations";
import { Lock } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  ApiError,
  fetchAdminComplaints,
  fetchAdminPermissions,
  fetchAdminPlaceSuggestions,
  fetchAdminStats,
  fetchClaims,
  fetchDisputes,
  fetchHostApplications,
  fetchPaymentReviews,
} from "../api";
import { useAuth } from "../AuthContext";
import { vendorLoginHref } from "../authRedirect";
import { AdminCommerceTab } from "../components/AdminCommerce";
import { AdminFinanceTab, PLANS_SECTIONS } from "../components/AdminFinance";
import { AdminMediaTab } from "../components/AdminMedia";
import { AdminPolicyTab } from "../components/AdminPolicy";
import { AdminAuditPage } from "../components/admin/AdminAudit";
import { AdminCouponsPage } from "../components/admin/AdminCoupons";
import { AdminListingsPage } from "../components/admin/AdminListings";
import { AdminInsightsPage, AdminNotificationTemplatesPage, AdminOrganisationsPage } from "../components/admin/AdminMisc";
import { AdminOverviewPage } from "../components/admin/AdminOverview";
import { AdminClaimsPage, AdminHostApplicationsPage, AdminPlaceSuggestionsPage } from "../components/admin/AdminQueues";
import { AdminReviewsPage } from "../components/admin/AdminReviews";
import { AdminSettingsPage } from "../components/admin/AdminSettings";
import { AdminShell } from "../components/admin/AdminShell";
import { AdminSupportPage } from "../components/admin/AdminSupport";
import { AdminVendorsPage } from "../components/admin/AdminVendors";
import { ADMIN_ROLE_LABEL, canUse, isAdminTab, navItem, type AdminRoleName, type AdminTab } from "../components/admin/adminNav";
import { Box, ErrorMessage } from "../components/admin/adminUi";
import { AdminPermissionProvider, type AdminPermissionState } from "../components/admin/adminPermissions";
import { PageSpinner } from "../components/ui";
import type { AdminStats } from "../types";

// Admin workspace (redesign 2026-10-14 — see docs/admin-ux-audit-2026-10-14.md).
// This file is now just routing + shared state: the active tool lives in the
// URL (`?tab=`), so Back/Forward and shared links work; each tool is its own
// module under components/admin/ (legacy Finance/Commerce/Policy/Media tabs
// are rendered unchanged inside the new shell).

// Finance sub-sections that moved to Settings — old deep links still land.
const MOVED_FINANCE_SECTIONS = new Set(["roles", "help"]);

export function AdminDashboard() {
  const { user, loading, refresh } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const rawTab = params.get("tab");
  const section = params.get("section") ?? undefined;
  const redirectedToSettings = rawTab === "finance" && !!section && MOVED_FINANCE_SECTIONS.has(section);
  // Finance split (2026-10-16): old `?tab=finance&section=<plans section>` links open
  // Plans & credit, and `section=coupons` (coupon usage) opens the Coupons page.
  const redirectedToPlans = rawTab === "finance" && !!section && PLANS_SECTIONS.has(section);
  const redirectedToCoupons = rawTab === "finance" && section === "coupons";
  const tab: AdminTab = redirectedToSettings ? "settings" : redirectedToPlans ? "plansCredit" : redirectedToCoupons ? "coupons" : isAdminTab(rawTab) ? rawTab : "overview";
  const unknownTab = rawTab && !isAdminTab(rawTab) ? rawTab : null;

  const [stats, setStats] = useState<AdminStats | null>(null);
  const [statsError, setStatsError] = useState<unknown>(null);
  // Legacy `?open=<key>` deep links land on the same record page.
  const legacyOpen = params.get("open");

  // OG-07 — an admin session opens nothing until two-step sign-in is done:
  // show that screen first, and only then load permissions and data.
  const mfaPending = user?.role === "admin" && !!user.mfa?.required && user.mfa.verifiedMinutesAgo === null;
  const isAdmin = user?.role === "admin" && !mfaPending;
  useEffect(() => {
    const onRequired = () => {
      refresh();
    };
    window.addEventListener("hc:admin-mfa-required", onRequired);
    return () => window.removeEventListener("hc:admin-mfa-required", onRequired);
  }, [refresh]);
  // D-02 — the server's permission list for this admin; mirrored by nav, page
  // access and buttons. The server still decides every request.
  const [perms, setPerms] = useState<AdminPermissionState | null>(null);
  const [permsError, setPermsError] = useState<unknown>(null);
  const loadPerms = useCallback(() => {
    setPermsError(null);
    fetchAdminPermissions()
      .then((r) => setPerms({ role: r.role, permissions: new Set(r.permissions) }))
      .catch((e) => {
        // An admin with no valid role gets 403: show the "no role" state, not an error.
        if (e instanceof ApiError && e.status === 403) setPerms({ role: null, permissions: new Set() });
        else setPermsError(e);
      });
  }, []);
  useEffect(() => {
    if (isAdmin) loadPerms();
  }, [isAdmin, loadPerms]);
  const loadStats = useCallback(() => {
    fetchAdminStats()
      .then((s) => {
        setStats(s);
        setStatsError(null);
      })
      .catch(setStatsError);
  }, []);
  useEffect(() => {
    if (isAdmin) loadStats();
  }, [isAdmin, tab, loadStats]);

  // Sidebar "waiting" badges for every queue (2026-10-16): each is loaded only
  // when the admin's role can open it, and refreshed after a decision.
  const [queueCounts, setQueueCounts] = useState<Partial<Record<AdminTab, number>>>({});
  const loadQueueCounts = useCallback(() => {
    if (!perms) return;
    const has = (p: string) => perms.permissions.has(p);
    const count = <T,>(ok: boolean, load: () => Promise<T[]>, keep: (x: T) => boolean = () => true) => (ok ? load().then((r) => r.filter(keep).length).catch(() => 0) : Promise.resolve(0));
    Promise.all([
      count(has("queues.view"), fetchClaims),
      count(has("queues.view"), fetchHostApplications),
      count(has("queues.view"), () => fetchAdminPlaceSuggestions(false)),
      count(has("finance.operate"), () => fetchPaymentReviews("open")),
      count(has("finance.operate"), fetchDisputes, (d) => d.status === "needs_response" || d.status === "warning_needs_response" || (d.status === "lost" && d.recovery_status === "pending")),
      count(has("complaints.handle"), () => fetchAdminComplaints(), (c) => c.status === "open" || c.status === "in_review"),
    ]).then(([claims, hosts, places, reviews, disputes, complaints]) =>
      setQueueCounts({ claims, hostApplications: hosts, placeSuggestions: places, finance: reviews + disputes, policies: complaints })
    );
  }, [perms]);
  useEffect(() => {
    if (isAdmin) loadQueueCounts();
  }, [isAdmin, loadQueueCounts]);
  const refreshCounts = useCallback(() => {
    loadStats();
    loadQueueCounts();
  }, [loadStats, loadQueueCounts]);

  // navigate() belongs in an effect, not render (same as VendorDashboard).
  useEffect(() => {
    if (!loading && !isAdmin && !mfaPending) navigate(vendorLoginHref());
  }, [loading, isAdmin, mfaPending, navigate]);

  const go = useCallback(
    (next: AdminTab, extra?: Record<string, string>) => {
      setParams({ tab: next, ...extra });
      window.scrollTo({ top: 0 });
    },
    [setParams]
  );
  // Records are pages addressed by the URL (`?tab=…&record=…`): shareable,
  // refreshable and reachable with Back/Forward.
  const openListingInReview = (key: string) => go("listings", { record: key });
  const openPendingListing = (key: string) => go("pending", { record: key });
  const openVendorAccount = (id: string) => go("vendors", { record: id });
  const clearOpenListing = useCallback(() => undefined, []);

  if (loading) return <PageSpinner />;
  if (user && mfaPending) return <AdminMfaGate enrolled={!!user.mfa?.enrolled} email={user.email} onDone={() => refresh()} />;
  if (!user || !isAdmin) return null;
  if (permsError) return <Box><ErrorMessage error={permsError} onRetry={loadPerms} title="Couldn't load your admin permissions" /></Box>;
  if (!perms) return <PageSpinner />;

  const role = (perms.role ?? null) as AdminRoleName | null;
  const can = (...p: string[]) => p.some((x) => perms.permissions.has(x));
  const item = navItem(tab);
  const pendingTotal = stats ? stats.centresPending + stats.clubsPending + (stats.experiencesPending ?? 0) : 0;

  const page = (() => {
    if (!canUse(can, item)) {
      return (
        <Box>
          <div className="adm-state">
            <Lock size={22} strokeWidth={1.9} aria-hidden="true" />
            <div className="adm-state-title">{role ? "Not included in your admin role" : "Your admin account has no role"}</div>
            <div>
              {role
                ? `${item.label} isn't part of the ${ADMIN_ROLE_LABEL[role].toLowerCase()} role. Ask a super admin to change your role in Settings if you need it.`
                : "An admin account needs a role (super, finance, support or legal) before it can use any admin tool. Ask a super admin to assign one."}
            </div>
          </div>
        </Box>
      );
    }
    switch (tab) {
      case "overview":
        return <AdminOverviewPage stats={stats} statsError={statsError} onNavigate={(t, extra) => go(t, extra)} onOpenListing={openPendingListing} />;
      case "pending":
        return <AdminListingsPage mode="pending" openKey={legacyOpen} onOpenHandled={clearOpenListing} onOpenVendor={openVendorAccount} onCountsChanged={refreshCounts} />;
      case "listings":
        return <AdminListingsPage mode="all" openKey={legacyOpen} onOpenHandled={clearOpenListing} onOpenVendor={openVendorAccount} onCountsChanged={refreshCounts} />;
      case "vendors":
        return <AdminVendorsPage onOpenListing={openListingInReview} onCountsChanged={refreshCounts} onNavigate={(t, extra) => go(t, extra)} />;
      case "claims":
        return <AdminClaimsPage onOpenVendor={openVendorAccount} onOpenListing={openListingInReview} onCountsChanged={refreshCounts} />;
      case "hostApplications":
        return <AdminHostApplicationsPage onCountsChanged={refreshCounts} />;
      case "placeSuggestions":
        return <AdminPlaceSuggestionsPage onOpenListing={openListingInReview} onCountsChanged={refreshCounts} />;
      case "reviews":
        return <AdminReviewsPage onCountsChanged={refreshCounts} />;
      case "support":
        return <AdminSupportPage onNavigate={(t, extra) => go(t, extra)} />;
      case "exceptions":
        return <AdminExceptionsPage />;
      case "people":
        return <AdminPeoplePage onNavigate={(t, extra) => go(t, extra)} />;
      case "orders":
        return <AdminOrdersPage onNavigate={(t, extra) => go(t, extra)} />;
      case "activities":
        return <AdminActivitiesPage />;
      case "circles":
        return <AdminCirclesPage onNavigate={(t, extra) => go(t, extra)} />;
      case "hosts":
        return <AdminHostsPage onNavigate={(t, extra) => go(t, extra)} />;
      case "audit":
        return <AdminAuditPage onNavigate={(t, extra) => go(t, extra)} />;
      case "coupons":
        return <AdminCouponsPage />;
      case "commerce":
        return <AdminCommerceTab />;
      case "finance":
        return <AdminFinanceTab key="finance" page="finance" initialSection={section} />;
      case "plansCredit":
        return <AdminFinanceTab key="plans" page="plans" initialSection={section} />;
      case "policies":
        return <AdminPolicyTab />;
      case "organisations":
        return <AdminOrganisationsPage onOpenVendor={openVendorAccount} />;
      case "demand":
      case "marketplaceHealth":
        return <AdminInsightsPage initial={tab === "demand" ? "demand" : "health"} onOpenSettings={() => go("settings")} />;
      case "notificationTemplates":
        return <AdminNotificationTemplatesPage />;
      case "media":
        return <AdminMediaTab />;
      case "privacy":
        return <AdminPrivacyPage />;
      case "settings":
        return <AdminSettingsPage />;
    }
  })();

  return (
    <AdminPermissionProvider value={perms}>
    <AdminShell
      active={tab}
      onNavigate={(t) => go(t)}
      role={role}
      account={{ name: user.name, email: user.email }}
      counts={{ ...queueCounts, pending: pendingTotal, reviews: stats?.openReports ?? 0 }}
    >
      <AdminMfaReauthHost />
      {unknownTab && (
        <div className="adm-callout" role="status" style={{ marginBottom: 18 }}>
          There's no admin page called “{unknownTab}”, so you're seeing the Overview.
        </div>
      )}
      {redirectedToSettings && (
        <div className="adm-callout" role="status" style={{ marginBottom: 18 }}>
          {section === "roles" ? "Admin roles" : "Field help"} moved from Finance to Settings.
        </div>
      )}
      <div className="fade-panel" key={tab}>
        {page}
      </div>
    </AdminShell>
    </AdminPermissionProvider>
  );
}
