import { useEffect, useState, type ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { fetchOrgProfile, fetchVendorListings, fetchVendorNotifications, fetchVendorStats } from "../api";
import { useAuth } from "../AuthContext";
import { useDashboardNav } from "../DashboardNavContext";
import {
  BanIcon,
  CalendarIcon,
  ChatIcon,
  CheckCircleIcon,
  ClipboardIcon,
  ClockIcon,
  EyeIcon,
  PlusIcon,
  TreeIconSmall,
  TrendUpIcon,
  UsersIcon,
} from "../components/icons";
import { Button, Card, DashboardTopPanel, Drawer, NavSidebar, PageSpinner } from "../components/ui";
import { BookingsTab, DemandTab } from "../components/VendorBookings";
import { CentreEditor } from "../components/VendorCentreEditor";
import { ClubEditor } from "../components/VendorClubEditor";
import { VendorExperiencesTab } from "../components/VendorExperiences";
import { ListingsTab } from "../components/VendorListings";
import { MessagesTab } from "../components/VendorMessages";
import { VendorOrgTab } from "../components/VendorOrg";
import { VendorOverviewTab } from "../components/VendorOverview";
import { VendorProgramsTab, VendorScheduleTab } from "../components/VendorPrograms";
import { formatMemberSince } from "../vendorFormat";
import { colors, fonts, maxWidth } from "../theme";
import type { VendorListingSummary, VendorStats } from "../types";

// The orchestrating page component only — every tab's actual content now
// lives in its own file under components/Vendor*.tsx (split out of what
// used to be a single 1826-line file; see CLAUDE.md).

type VendorTab = "overview" | "listings" | "messages" | "bookings" | "demand" | "programs" | "experiences" | "schedule" | "org";

const VENDOR_TABS: { key: VendorTab; label: string; icon: ReactNode }[] = [
  { key: "overview", label: "Overview", icon: <EyeIcon size={15} /> },
  { key: "listings", label: "Listings", icon: <ClipboardIcon size={15} /> },
  { key: "programs", label: "Programs", icon: <CalendarIcon size={15} /> },
  { key: "experiences", label: "Adventures & Experiences", icon: <TreeIconSmall size={15} /> },
  { key: "schedule", label: "Schedule", icon: <CalendarIcon size={15} /> },
  { key: "messages", label: "Messages", icon: <ChatIcon size={15} /> },
  { key: "bookings", label: "Bookings & registrations", icon: <CalendarIcon size={15} /> },
  { key: "demand", label: "Demand", icon: <TrendUpIcon size={15} /> },
  { key: "org", label: "Organisation", icon: <UsersIcon size={15} /> },
];

export function VendorDashboard() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const initialTab = searchParams.get("tab");
  const [tab, setTab] = useState<VendorTab>(VENDOR_TABS.some((o) => o.key === initialTab) ? (initialTab as VendorTab) : "overview");
  const [navOpen, setNavOpen] = useState(false);
  const [listings, setListings] = useState<{ centres: VendorListingSummary[]; clubs: VendorListingSummary[] }>({ centres: [], clubs: [] });
  const [stats, setStats] = useState<VendorStats | null>(null);
  const [editingCentre, setEditingCentre] = useState<string | "new" | null>(null);
  const [editingClub, setEditingClub] = useState<string | "new" | null>(null);
  const [creatingProgram, setCreatingProgram] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  // Feature flags (implementation backlog #5) — read-only here, admin
  // controls them (AdminDashboard.tsx's Organisations tab). Defaults to
  // enabled while loading so the button doesn't flash disabled-then-enabled
  // on every page load for the common case.
  const [programsEnabled, setProgramsEnabled] = useState(true);
  const { setOpenNav } = useDashboardNav();

  // Registers the Header.tsx burger's click handler while this page is
  // mounted — see DashboardNavContext.
  useEffect(() => {
    setOpenNav(() => setNavOpen(true));
    return () => setOpenNav(null);
  }, [setOpenNav]);

  const loadUnreadCount = () => fetchVendorNotifications().then((rows) => setUnreadCount(rows.filter((r) => !r.read).length));

  const reload = () => {
    fetchVendorListings().then(setListings);
    fetchVendorStats().then(setStats);
    loadUnreadCount();
    setEditingCentre(null);
    setEditingClub(null);
  };

  useEffect(() => {
    if (user?.role === "vendor" && user.status === "approved") {
      reload();
      fetchOrgProfile().then((p) => setProgramsEnabled(p.flags.programs));
    }
  }, [user]);

  if (loading) return <PageSpinner />;
  if (!user || user.role !== "vendor") {
    navigate("/login");
    return null;
  }

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

  const onAddListing = () => (user.vendorType === "sports" ? setEditingClub("new") : setEditingCentre("new"));

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
    <div className="fade-panel">
      <section className="section-pad" style={{ maxWidth, margin: "0 auto", padding: "40px 24px 90px" }}>
        {tab === "overview" && (
          <div style={{ background: colors.greenBg, borderRadius: 22, padding: "28px 28px 24px", marginBottom: 32 }}>
            <DashboardTopPanel
              title={user.name}
              subtitle={`Vendor dashboard · ${user.email}`}
              avatarName={user.name}
              accent="green"
              tabs={VENDOR_TABS}
              activeTab={tab}
              onTabChange={setTab}
              bottomSpacing={0}
              hideTabs
              badge={
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {user.providerTier !== "standard" && (
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, background: "#fff", color: colors.greenText, borderRadius: 20, padding: "3px 10px 3px 8px", fontSize: 12, fontWeight: 700 }}>
                      <CheckCircleIcon size={13} /> Verified vendor
                    </span>
                  )}
                  <span style={{ display: "inline-flex", alignItems: "center", background: "#fff", color: colors.muted, borderRadius: 20, padding: "3px 10px", fontSize: 12, fontWeight: 600 }}>
                    Member since {formatMemberSince(user.createdAt)}
                  </span>
                </div>
              }
            />
          </div>
        )}

        <NavSidebar open={navOpen} onClose={() => setNavOpen(false)} title="Vendor dashboard" options={displayTabs} value={tab} onChange={setTab} />

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, marginBottom: 18 }}>
          <h2 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 21, margin: 0, letterSpacing: "-.01em" }}>
            {displayTabs.find((t) => t.key === tab)?.label}
          </h2>
          {tab === "programs" && (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
              <Button onClick={() => setCreatingProgram(true)} disabled={!programsEnabled}>
                <PlusIcon size={14} /> Add program
              </Button>
              {!programsEnabled && (
                <span style={{ fontSize: 11, color: colors.orangeDark }}>Not enabled for your organisation</span>
              )}
            </div>
          )}
        </div>

        {tab === "overview" && stats && <VendorOverviewTab stats={stats} unreadCount={unreadCount} />}

        {tab === "listings" && (
          <ListingsTab
            vendorType={user.vendorType}
            listings={listings}
            onEditCentre={setEditingCentre}
            onEditClub={setEditingClub}
            onNewCentre={() => setEditingCentre("new")}
            onNewClub={() => setEditingClub("new")}
            reload={reload}
          />
        )}

        {tab === "messages" && <MessagesTab onRead={loadUnreadCount} listings={listings} />}
        {tab === "bookings" && <BookingsTab />}
        {tab === "demand" && <DemandTab />}
        {tab === "programs" && <VendorProgramsTab listings={listings} creatingOpen={creatingProgram} onCreatingOpenChange={setCreatingProgram} />}
        {tab === "experiences" && <VendorExperiencesTab />}
        {tab === "schedule" && <VendorScheduleTab />}
        {tab === "org" && <VendorOrgTab />}

        <Drawer
          open={!!editingCentre}
          onClose={() => setEditingCentre(null)}
          size="wide"
          title={editingCentre === "new" ? "New community centre" : listings.centres.find((c) => c.id === editingCentre)?.name ?? "Edit community centre"}
        >
          {editingCentre && <CentreEditor centreId={editingCentre} onSaved={reload} />}
        </Drawer>
        <Drawer
          open={!!editingClub}
          onClose={() => setEditingClub(null)}
          size="wide"
          title={editingClub === "new" ? "New sports club" : listings.clubs.find((c) => c.id === editingClub)?.name ?? "Edit sports club"}
        >
          {editingClub && <ClubEditor clubId={editingClub} onSaved={reload} />}
        </Drawer>
      </section>
    </div>
  );
}
