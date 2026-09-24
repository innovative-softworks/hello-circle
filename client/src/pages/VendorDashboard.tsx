import { useEffect, useState, type ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { fetchOrgProfile, fetchVendorListings, fetchVendorNotifications, fetchVendorScheduleItems, fetchVendorStats } from "../api";
import { useAuth } from "../AuthContext";
import { ManageShell } from "../components/ManageShell";
import {
  BanIcon,
  CalendarIcon,
  CardIcon,
  ChatIcon,
  CheckCircleIcon,
  ClipboardIcon,
  ClockIcon,
  EyeIcon,
  PlusIcon,
  StarIcon,
  TagIcon,
  TreeIconSmall,
  TrendUpIcon,
  UsersIcon,
} from "../components/icons";
import { Button, LinkButton, ManageCard as Card, DashboardTopPanel, PageSpinner } from "../components/ui";
import { BookingsTab, DemandTab } from "../components/VendorBookings";
import { VendorExperiencesTab } from "../components/VendorExperiences";
import { ListingsTab } from "../components/VendorListings";
import { MessagesTab } from "../components/VendorMessages";
import { VendorOffersTab } from "../components/VendorOffers";
import { VendorOrgTab, PaymentsPanel } from "../components/VendorOrg";
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

type VendorTab = "overview" | "listings" | "messages" | "bookings" | "earnings" | "programs" | "experiences" | "schedule" | "reviews" | "offers" | "demand" | "org";

// Host Manage spec §2's minimal primary nav ("Overview/Activities/Bookings/
// Calendar/Messages/Earnings/More") — reorganized using ManageShell's own
// `group` field (already supported, just unused by Vendor until now, same
// mechanism Profile.tsx's nav already groups by) rather than building a new
// flyout/submenu: everything through "earnings" below stays a primary tab,
// everything after gets grouped under "More".
const VENDOR_TABS: { key: VendorTab; label: string; icon: ReactNode; group?: string }[] = [
  { key: "overview", label: "Overview", icon: <EyeIcon size={15} /> },
  { key: "listings", label: "Listings", icon: <ClipboardIcon size={15} /> },
  { key: "programs", label: "Programs", icon: <CalendarIcon size={15} /> },
  { key: "experiences", label: "Adventures & Experiences", icon: <TreeIconSmall size={15} /> },
  { key: "schedule", label: "Calendar", icon: <CalendarIcon size={15} /> },
  { key: "messages", label: "Messages", icon: <ChatIcon size={15} /> },
  { key: "bookings", label: "Bookings", icon: <CalendarIcon size={15} /> },
  { key: "earnings", label: "Earnings", icon: <CardIcon size={15} /> },
  { key: "reviews", label: "Reviews", icon: <StarIcon size={15} />, group: "More" },
  { key: "offers", label: "Offers", icon: <TagIcon size={15} />, group: "More" },
  { key: "demand", label: "Demand", icon: <TrendUpIcon size={15} />, group: "More" },
  { key: "org", label: "Organisation", icon: <UsersIcon size={15} />, group: "More" },
];

export function VendorDashboard() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const initialTab = searchParams.get("tab");
  const [tab, setTab] = useState<VendorTab>(VENDOR_TABS.some((o) => o.key === initialTab) ? (initialTab as VendorTab) : "overview");
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

  const loadUnreadCount = () => fetchVendorNotifications().then((rows) => setUnreadCount(rows.filter((r) => !r.read).length));

  const reload = () => {
    fetchVendorListings().then(setListings);
    fetchVendorStats().then(setStats);
    loadUnreadCount();
    fetchVendorScheduleItems()
      .then(setScheduleItems)
      .catch(() => setScheduleItemsError(true));
  };

  useEffect(() => {
    if (user?.role === "vendor" && user.status === "approved") {
      reload();
      fetchOrgProfile().then((p) => setProgramsEnabled(p.flags.programs));
    }
  }, [user]);

  // Calling navigate() during render (rather than in an effect) updates the
  // Router while this component is still rendering — a React anti-pattern
  // that's undefined-behavior-adjacent under concurrent rendering/Strict
  // Mode's double-render, even though the redirect visually still worked.
  useEffect(() => {
    if (!loading && (!user || user.role !== "vendor")) navigate("/login");
  }, [loading, user, navigate]);

  if (loading) return <PageSpinner />;
  if (!user || user.role !== "vendor") return null;

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
                ? "An admin needs to approve your vendor account before you can create listings. Check back soon."
                : "Your vendor account has been suspended. Contact the site admin for details."}
            </p>
          </Card>
        </section>
      </div>
    );
  }

  // "Listings" reads like inventory management, which is misleading for the
  // overwhelmingly common case of a vendor with a single location — swap in
  // a singular, ownership-flavoured label ("My centre"/"My club") whenever
  // there's exactly one (or zero, pre-first-listing) active listing shown.
  // Both listing types are always manageable regardless of the vendor's
  // signup-time vendorType (that only picks the type of their initial
  // listing) — see ListingsTab, which shows both sections unconditionally.
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
  const displayTabs = VENDOR_TABS.map((t) => (t.key === "listings" ? { ...t, label: listingsTabLabel } : t));

  return (
    <ManageShell
      navTitle="HelloCircle Manage"
      navOptions={displayTabs}
      activeKey={tab}
      onNavChange={setTab}
      contextLabel={user?.businessName ? `Managing ${user.businessName}` : "Managing Vendor account"}
      pageTitle={displayTabs.find((t) => t.key === tab)?.label}
      headerActions={
        tab === "programs" ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
            <Button onClick={() => navigate("/vendor/programs/new")} disabled={!programsEnabled}>
              <PlusIcon size={14} /> Add program
            </Button>
            {!programsEnabled && (
              <span style={{ fontSize: 11, color: colors.orangeDark }}>Not enabled for your organisation</span>
            )}
          </div>
        ) : undefined
      }
      banner={
        tab === "overview" ? (
          <div style={{ borderBottom: `1px solid ${colors.border}`, paddingBottom: 24, marginBottom: 32 }}>
            <DashboardTopPanel
              title={user.name}
              subtitle={
                scheduleItems === null
                  ? `HelloCircle Manage · ${user.email}`
                  : `${greeting()}, ${user.businessName || user.name}. ${summarizeUpcomingWeek(scheduleItems)}`
              }
              avatarName={user.name}
              accent="green"
              eyebrow="/ Vendor"
              tabs={VENDOR_TABS}
              activeTab={tab}
              onTabChange={setTab}
              bottomSpacing={0}
              hideTabs
              badge={
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {user.providerTier !== "standard" && (
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, background: colors.greenBg, color: colors.greenText, borderRadius: 20, padding: "3px 10px 3px 8px", fontSize: 12, fontWeight: 700 }}>
                      <CheckCircleIcon size={13} /> Verified vendor
                    </span>
                  )}
                  <span style={{ display: "inline-flex", alignItems: "center", background: colors.panel, color: colors.muted, borderRadius: 20, padding: "3px 10px", fontSize: 12, fontWeight: 600 }}>
                    Member since {formatMemberSince(user.createdAt)}
                  </span>
                </div>
              }
              actions={
                <>
                  <LinkButton variant="orange" href={`/provider/${user.id}`} target="_blank" style={{ padding: "10px 18px", fontSize: 13.5 }}>
                    View public profile ↗
                  </LinkButton>
                  <button
                    onClick={() => setTab("messages")}
                    aria-label={unreadCount > 0 ? `${unreadCount} unread messages` : "Messages"}
                    style={{
                      position: "relative",
                      width: 40,
                      height: 40,
                      borderRadius: "50%",
                      border: `1px solid ${colors.borderStrong}`,
                      background: colors.surface,
                      color: colors.text,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      cursor: "pointer",
                      flex: "none",
                    }}
                  >
                    <ChatIcon size={16} />
                    {unreadCount > 0 && (
                      <span
                        style={{
                          position: "absolute",
                          top: -4,
                          right: -4,
                          minWidth: 16,
                          height: 16,
                          borderRadius: 8,
                          background: colors.orange,
                          color: "#fff",
                          fontSize: 10,
                          fontWeight: 700,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          padding: "0 3px",
                        }}
                      >
                        {unreadCount}
                      </span>
                    )}
                  </button>
                </>
              }
            />
          </div>
        ) : undefined
      }
    >
      {tab === "overview" && stats && (
        <VendorOverviewTab
          stats={stats}
          unreadCount={unreadCount}
          listings={listings}
          items={scheduleItems}
          itemsError={scheduleItemsError}
          onNavigateTab={setTab}
        />
      )}

      {tab === "listings" && (
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

      {tab === "messages" && <MessagesTab onRead={loadUnreadCount} listings={listings} />}
      {tab === "bookings" && <BookingsTab />}
      {tab === "earnings" && <PaymentsPanel />}
      {tab === "reviews" && <VendorReviewsTab />}
      {tab === "offers" && <VendorOffersTab />}
      {tab === "demand" && <DemandTab />}
      {tab === "programs" && <VendorProgramsTab onOpenProgram={(id) => navigate(`/vendor/programs/${id}`)} />}
      {tab === "experiences" && <VendorExperiencesTab onOpenExperience={(id) => navigate(`/vendor/experiences/${id}`)} />}
      {tab === "schedule" && <VendorScheduleTab onNavigateItem={setTab} />}
      {tab === "org" && <VendorOrgTab />}
    </ManageShell>
  );
}
