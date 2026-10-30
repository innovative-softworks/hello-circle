import { VendorReportsTab } from "../components/VendorReports";
import { useEffect, useState, type ReactNode } from "react";
import { AttendeeConfirmPanel } from "../components/trust/AttendeeConfirmPanel";
import { AttendanceRequestsPanel } from "../components/trust/AttendanceRequestsPanel";
import { VendorCustomersTab } from "../components/VendorCustomers";
import { PlanRewardsPanel } from "../components/PlanRewardsPanel";
import { useNavigate } from "react-router-dom";
import { fetchAccountDecision, fetchOrgProfile, fetchVendorListings, fetchVendorNotifications, fetchVendorScheduleItems, fetchVendorStats, type PublicDecision } from "../api";
import { DecisionExplanation } from "../components/DecisionExplanation";
import { OrgSuspendedView, RemovedFromOrgView } from "../components/OrgSuspendedView";
import { useAuth } from "../AuthContext";
import { vendorLoginHref } from "../authRedirect";
import { WorkspaceShell } from "../components/workspace/WorkspaceShell";
import { useUrlTab } from "../useUrlTab";
import { VENDOR_TABS, VENDOR_TAB_KEYS, partnerAccountLine, type VendorTab } from "../components/workspace/PartnerWorkspace";
import { BanIcon, ClockIcon, PlusIcon } from "../components/icons";
import { CalendarX2, PenSquare } from "lucide-react";
import { useCreateParam } from "../components/workspace/OfferParts";
import { VendorBlockTimeDialog } from "../components/VendorBlockTimeDialog";
import { VendorSetupChecklist } from "../components/VendorSetupChecklist";
import { Button, ManageCard as Card, LoadErrorState, PageSpinner } from "../components/ui";
import { BookingsTab, DemandTab } from "../components/VendorBookings";
import { VendorExperiencesTab } from "../components/VendorExperiences";
import { ListingsTab } from "../components/VendorListings";
import { MessagesTab } from "../components/VendorMessages";
import { VendorOffersTab } from "../components/VendorOffers";
import { VendorOrgTab, PaymentsPanel } from "../components/VendorOrg";
import { vendorTabAvailable } from "../vendorTabAccess";
import { useOrgCapabilities } from "../orgCapabilities";
import { useParticipationFeatures } from "../circleFeatures";
import { useToast } from "../components/Toast";
import { VendorOverviewTab } from "../components/VendorOverview";
import { VendorProgramsTab, VendorScheduleTab } from "../components/VendorPrograms";
import { VendorReviewsTab } from "../components/VendorReviews";
import { formatMemberSince } from "../vendorFormat";
import { greeting } from "../greeting";
import { summarizeUpcomingWeek } from "../vendorSchedule";
import { colors, fonts } from "../theme";
import type { VendorListingSummary, VendorScheduleItem, VendorStats } from "../types";

// The orchestrating page component only — every tab's actual content now
// lives in its own file under components/Vendor*.tsx (split out of what
// used to be a single 1826-line file; see CLAUDE.md).

export function VendorDashboard() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const participation = useParticipationFeatures();
  // Configuration framework Phase D — modules the organisation doesn't have stay out of the navigation.
  const capabilities = useOrgCapabilities();
  // The tab lives in the URL (?tab=), so Back/Forward, refresh and shared links keep it.
  const [tab, setTab] = useUrlTab<VendorTab>(VENDOR_TAB_KEYS, "overview");
  const [loadError, setLoadError] = useState(false);
  const [blockOpen, setBlockOpen] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);
  const [, setCreateParam] = useCreateParam();
  const [listings, setListings] = useState<{ centres: VendorListingSummary[]; clubs: VendorListingSummary[] }>({ centres: [], clubs: [] });
  const [stats, setStats] = useState<VendorStats | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  // Vendor Experience Polish — feeds both the Overview "Next Up"/"Coming up"
  // section and the banner's weekly summary line below.
  const [scheduleItems, setScheduleItems] = useState<VendorScheduleItem[] | null>(null);
  const [scheduleItemsError, setScheduleItemsError] = useState(false);
  // Feature flags (implementation backlog #5) — read-only here, admin
  // controls them (AdminDashboard.tsx's Organisations tab). Defaults to
  // enabled while loading so the button doesn't flash disabled-then-enabled
  // on every page load for the common case.
  const [programsEnabled, setProgramsEnabled] = useState(true);
  const [experiencesEnabled, setExperiencesEnabled] = useState(true);

  const loadUnreadCount = () => fetchVendorNotifications().then((rows) => setUnreadCount(rows.filter((r) => !r.read).length));

  const reload = () => {
    setLoadError(false);
    fetchVendorListings()
      .then(setListings)
      .catch(() => setLoadError(true));
    fetchVendorStats()
      .then(setStats)
      .catch(() => setLoadError(true));
    loadUnreadCount().catch(() => {});
    fetchVendorScheduleItems()
      .then(setScheduleItems)
      .catch(() => setScheduleItemsError(true));
  };

  useEffect(() => {
    // D-01 / D-08: a suspended organisation or a removed member gets its own read-only page instead.
    // Participation Phase 2: check-in-only staff have the door page only.
    if (user?.role === "vendor" && user.invitedStaff && user.platformRole === "checkin_staff" && user.orgId && user.orgStatus !== "suspended") {
      navigate("/vendor/door", { replace: true });
      return;
    }
    if (user?.role === "vendor" && user.status === "approved" && user.orgStatus !== "suspended" && !(user.invitedStaff && !user.orgId)) {
      reload();
      fetchOrgProfile()
        .then((p) => {
          setProgramsEnabled(p.flags.programs);
          setExperiencesEnabled(p.flags.experiences);
        })
        .catch(() => {});
    }
  }, [user]);

  // Calling navigate() during render (rather than in an effect) updates the
  // Router while this component is still rendering — a React anti-pattern
  // that's undefined-behavior-adjacent under concurrent rendering/Strict
  // Mode's double-render, even though the redirect visually still worked.
  useEffect(() => {
    if (!loading && (!user || user.role !== "vendor")) navigate(vendorLoginHref());
  }, [loading, user, navigate]);

  if (loading) return <PageSpinner />;
  if (!user || user.role !== "vendor") return null;
  // Participation Phase 2 — check-in-only staff have no dashboard tabs; the effect above sends them to /vendor/door.
  if (user.invitedStaff && user.platformRole === "checkin_staff") return <PageSpinner />;

  if (user.status !== "approved") {
    return (
      <div className="fade-panel">
        <section className="section-pad" style={{ maxWidth: 560, margin: "0 auto", padding: "64px 24px" }}>
          <Card style={{ textAlign: "center", padding: 32 }}>
            <div style={{ display: "flex", justifyContent: "center", marginBottom: 10, color: colors.muted }}>{user.status === "pending" ? <ClockIcon size={32} /> : <BanIcon size={32} />}</div>
            <h2 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 22, margin: "0 0 8px" }}>
              {user.status === "pending" ? "Awaiting approval" : "Account suspended"}
            </h2>
            <p style={{ color: colors.muted, fontSize: 15, lineHeight: 1.5 }}>
              {user.status === "pending"
                ? "An admin reviews your details before your listing can go live. Nothing more is needed from you right now — you'll be able to edit your listing once you're approved."
                : "Your partner account is suspended, so the workspace and your listings' tools are unavailable."}
            </p>
            {user.status === "suspended" && <SuspensionReason />}
            {user.status !== "pending" && (
              <Button variant="ghost" onClick={() => navigate("/contact")}>
                Contact HelloCircle
              </Button>
            )}
            {user.status === "pending" && <VendorSetupChecklist variant="pending" />}
          </Card>
        </section>
      </div>
    );
  }

  if (user.orgStatus === "suspended") return <OrgSuspendedView />;
  if (user.invitedStaff && !user.orgId) return <RemovedFromOrgView />;

  // "Listings" reads like inventory management, which is misleading for the
  // overwhelmingly common case of a vendor with a single location — swap in
  // a singular, ownership-flavoured label ("My centre"/"My club") whenever
  // there's exactly one (or zero, pre-first-listing) active listing shown.
  // Both listing types are always manageable regardless of the vendor's
  // signup-time vendorType (that only picks the type of their initial
  // listing) — see ListingsTab, which shows both sections unconditionally.
  // Centres a date can be blocked on from the Calendar header.
  const blockableCentres = listings.centres.filter((c) => c.status !== "deleted");
  const activeCentresCount = listings.centres.filter((c) => c.status !== "deleted").length;
  const activeClubsCount = listings.clubs.filter((c) => c.status !== "deleted").length;
  const shownListingsCount = activeCentresCount + activeClubsCount;
  const listingsTabLabel =
    shownListingsCount > 1
      ? "Listings"
      : activeCentresCount === 1
        ? "My centre"
        : activeClubsCount === 1
          ? "My club"
          : "My listing";
  // Sitemap audit P2-03 — invited staff only see the tabs their platform_role
  // can act in (vendorTabAccess.ts); the server still enforces every action.
  // A ?tab= link or in-page shortcut to a hidden tab falls back to Overview.
  const canSee = (t: VendorTab) => vendorTabAvailable(t, user, capabilities) && (t !== "checkin" || participation["participation.checkin"]);
  const activeTab: VendorTab = canSee(tab) && tab !== "checkin" ? tab : "overview";
  const goTab = (t: VendorTab) => {
    // Participation Phase 2 — Check-in is its own page (/vendor/door).
    if (t === "checkin" && canSee(t)) navigate("/vendor/door");
    else if (canSee(t)) setTab(t);
    else toast.info("Your staff role doesn't include this. Ask your organisation owner if you need access.");
  };
  const displayTabs = VENDOR_TABS.filter((t) => canSee(t.key)).map((t) => ({
    ...t,
    label: t.key === "listings" ? listingsTabLabel : t.label,
    count: t.key === "messages" && unreadCount > 0 ? unreadCount : undefined,
  }));
  const active = displayTabs.find((t) => t.key === activeTab)!;
  const overviewSubtitle =
    scheduleItems === null
      ? active.summary
      : `${greeting()}, ${user.businessName || user.name}. ${summarizeUpcomingWeek(scheduleItems)}`;

  return (
    <WorkspaceShell
      workspaceLabel="Partner workspace"
      account={partnerAccountLine(user)}
      externalLink={{ label: "View public profile", to: `/provider/${user.id}`, newTab: true }}
      navItems={displayTabs}
      active={activeTab}
      onNavigate={goTab}
      title={active.label}
      subtitle={activeTab === "overview" ? overviewSubtitle : active.summary}
      actions={
        activeTab === "programs" ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
            <Button onClick={() => navigate("/vendor/programs/new")} disabled={!programsEnabled}>
              <PlusIcon size={14} /> Add programme
            </Button>
            {!programsEnabled && <span style={{ fontSize: 12, color: colors.mutedLight }}>Programmes aren't enabled for your organisation</span>}
          </div>
        ) : activeTab === "experiences" ? (
          <Button onClick={() => navigate("/vendor/experiences/new")} disabled={!experiencesEnabled}>
            <PlusIcon size={14} /> Add experience
          </Button>
        ) : activeTab === "offers" ? (
          <Button onClick={() => setCreateParam(true)}>
            <PlusIcon size={14} /> New offer
          </Button>
        ) : activeTab === "listings" ? (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {capabilities?.venues !== false && (
              <Button onClick={() => navigate("/vendor/centres/new")}>
                <PlusIcon size={14} /> Add centre
              </Button>
            )}
            {capabilities?.clubs !== false && (
              <Button variant={capabilities?.venues === false ? "primary" : "ghost"} onClick={() => navigate("/vendor/clubs/new")}>
                <PlusIcon size={14} /> Add club
              </Button>
            )}
          </div>
        ) : activeTab === "messages" ? (
          <Button onClick={() => setComposeOpen(true)}>
            <PenSquare size={15} aria-hidden="true" /> New message
          </Button>
        ) : activeTab === "schedule" && blockableCentres.length > 0 ? (
          <Button onClick={() => setBlockOpen(true)}>
            <CalendarX2 size={15} aria-hidden="true" /> Block time
          </Button>
        ) : undefined
      }
    >
      {loadError && (activeTab === "overview" || activeTab === "listings") && (
        <div style={{ marginBottom: 16 }}>
          <LoadErrorState title="Couldn't load your listings and figures." detail="What's shown may be incomplete. Nothing has changed on your listings." onRetry={reload} />
        </div>
      )}
      {activeTab === "overview" && (
        <div style={{ marginBottom: 16 }}>
          <PlanRewardsPanel scope="vendor" variant="compact" />
        </div>
      )}
      {activeTab === "overview" && stats && (
        <VendorOverviewTab
          stats={stats}
          unreadCount={unreadCount}
          listings={listings}
          items={scheduleItems}
          itemsError={scheduleItemsError}
          onNavigateTab={goTab}
        />
      )}
      {activeTab === "overview" && (
        <p style={{ fontSize: 12.5, color: colors.mutedLight, margin: "18px 0 0" }}>Partner since {formatMemberSince(user.createdAt)}</p>
      )}

      {activeTab === "listings" && (
        <ListingsTab
          vendorType={user.vendorType}
          listings={listings}
          onEditCentre={(id) => navigate(`/vendor/centres/${id}`)}
          onEditClub={(id) => navigate(`/vendor/clubs/${id}`)}
          onNewCentre={() => navigate("/vendor/centres/new")}
          onNewClub={() => navigate("/vendor/clubs/new")}
          reload={reload}
        />
      )}

      {activeTab === "messages" && <MessagesTab onRead={loadUnreadCount} listings={listings} composeOpen={composeOpen} onCloseCompose={() => setComposeOpen(false)} />}
      {activeTab === "bookings" && (
        <>
          <AttendanceRequestsPanel />
          <AttendeeConfirmPanel />
          <BookingsTab />
        </>
      )}
      {activeTab === "customers" && <VendorCustomersTab onOpenBooking={canSee("bookings") ? (ref) => navigate(`/vendor?tab=bookings&record=booking:${ref}`) : undefined} />}
      {activeTab === "earnings" && <PaymentsPanel />}
      {activeTab === "reviews" && <VendorReviewsTab />}
      {activeTab === "offers" && <VendorOffersTab />}
      {activeTab === "demand" && <DemandTab />}
      {activeTab === "reports" && <VendorReportsTab />}
      {activeTab === "programs" && <VendorProgramsTab onOpenProgram={(id) => navigate(`/vendor/programs/${id}`)} />}
      {activeTab === "experiences" && <VendorExperiencesTab onOpenExperience={(id) => navigate(`/vendor/experiences/${id}`)} />}
      {activeTab === "schedule" && <VendorScheduleTab onNavigateItem={goTab} />}
      <VendorBlockTimeDialog open={blockOpen} onClose={() => setBlockOpen(false)} centres={blockableCentres} />
      {activeTab === "org" && <VendorOrgTab />}
    </WorkspaceShell>
  );
}

// D-03 — why the account is suspended (category + explanation, never the internal note).
function SuspensionReason() {
  const [state, setState] = useState<{ latest: PublicDecision | null } | null>(null);
  useEffect(() => {
    fetchAccountDecision()
      .then((d) => setState({ latest: d.latest?.action === "partner.suspended" ? d.latest : null }))
      .catch(() => setState({ latest: null }));
  }, []);
  return <div style={{ marginBottom: 16 }}>{state && <DecisionExplanation decision={state.latest} />}</div>;
}
