import { useEffect, useState } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { fetchMyGames, fetchResidentFull } from "../api";
import { useAuth } from "../AuthContext";
import { useGuest } from "../GuestContext";
import { signInHref } from "../authRedirect";
import { AwardIcon, CalendarIcon, CheckCircleIcon, UsersIcon } from "../components/icons";
import { ActivitiesTab } from "../components/HostActivitiesTab";
import { HostAttentionPanel } from "../components/HostAttention";
import { HostCalendarTab } from "../components/HostCalendarTab";
import { CirclesTab } from "../components/HostCirclesTab";
import { HostEarningsTab } from "../components/HostEarningsTab";
import { HostInsightsTab } from "../components/HostInsightsTab";
import { HostNextUpHero, HostUpcomingList } from "../components/HostOverviewCards";
import { HostOffersTab } from "../components/HostOffersTab";
import { HostReviewsTab } from "../components/HostReviewsTab";
import { ManageShell } from "../components/ManageShell";
import { Button, ManageCard as Card, DashboardTopPanel, PageSpinner } from "../components/ui";
import { colors, fonts } from "../theme";
import type { Game, HostStatus } from "../types";

// HelloCircle Manage — resident (Host) dashboard. One page with local tab
// state (Overview/Activities/Circles), the same shape as VendorDashboard.tsx
// (Overview/Listings/Messages/...) rather than three separate routes that
// navigate between each other. Drilling into one specific Circle's own
// Plans/Members/Settings still lands on its own route
// (/manage/circles/:id, ManageCircle.tsx) — same relationship Vendor has
// between its Listings tab and a per-listing editor route
// (/vendor/centres/:id) — that part genuinely can't be "just a tab" since a
// host can organise more than one Circle.
//
// `/manage` used to always redirect to /vendor (a Phase-1 leftover
// predating this page); a vendor/admin session still gets that redirect
// below, a resident session gets this dashboard instead.

type ManageHomeTab = "overview" | "activities" | "circles" | "calendar" | "insights" | "earnings" | "reviews" | "offers";

// Host Experience Polish — Insights is new and promoted to a top-level tab
// (same "decisions, not decorative charts" surface Vendor gives its own
// Insights); Reviews/Offers move into a "More" group via NavSidebar's
// existing `group` field (already built, already used the same way in
// Vendor's own nav — see ui.tsx's NavSidebar) rather than a bespoke
// overflow menu, per the brief's own "don't expose too many items at once"
// instruction without losing anything that was reachable before.
const NAV_OPTIONS: { key: ManageHomeTab; label: string; icon?: undefined; group?: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "activities", label: "Activities" },
  { key: "circles", label: "Circles" },
  { key: "calendar", label: "Calendar" },
  { key: "insights", label: "Insights" },
  { key: "earnings", label: "Earnings" },
  { key: "reviews", label: "Reviews", group: "More" },
  { key: "offers", label: "Offers", group: "More" },
];

function hostStatusCopy(status: HostStatus): { text: string; tone: "green" | "muted" | "orange" } {
  if (status === "verified") return { text: "You're a Verified Host — this badge shows on every Session or Circle you create.", tone: "green" };
  if (status === "pending") return { text: "Your Host application is under review — we'll let you know once an admin has taken a look.", tone: "muted" };
  return { text: "Apply to become a Verified Host from your profile — a trust signal for other participants, never a requirement to host.", tone: "orange" };
}

// Host Experience Polish — a real local-time-of-day greeting (not a fixed
// "Welcome back") per the brief's own Overview spec, computed client-side
// off the visitor's own clock since the server has no reliable notion of
// "their afternoon".
function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

export function ManageHome() {
  const { user, loading: authLoading } = useAuth();
  const { resident, loading: guestLoading } = useGuest();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const initialTab = searchParams.get("tab");
  const [tab, setTab] = useState<ManageHomeTab>(NAV_OPTIONS.some((o) => o.key === initialTab) ? (initialTab as ManageHomeTab) : "overview");
  const [hostStatus, setHostStatus] = useState<HostStatus>("none");
  // Host Experience Polish — feeds the greeting summary, the "Next Up" hero,
  // and the "Upcoming activities" list below; all three are pure derivations
  // of this one fetch, no separate endpoints per section.
  const [upcomingGames, setUpcomingGames] = useState<Game[] | null>(null);

  useEffect(() => {
    if (!resident) return;
    fetchResidentFull().then(({ resident: r }) => {
      if (r) setHostStatus(r.hostStatus);
    });
  }, [resident?.id]);

  useEffect(() => {
    if (!resident) return;
    fetchMyGames({ hostedOnly: true }).then((games) => {
      const todayIso = new Date().toISOString().slice(0, 10);
      setUpcomingGames(
        games.filter((g) => g.status !== "cancelled" && g.date >= todayIso).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time))
      );
    });
  }, [resident?.id]);

  // See VendorDashboard.tsx's identical comment — navigate() belongs in an
  // effect, not called directly during render.
  useEffect(() => {
    if (!authLoading && !guestLoading && !user && !resident) navigate(signInHref());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, guestLoading, user, resident]);

  if (authLoading || guestLoading) return <PageSpinner />;
  if (user) return <Navigate to="/vendor" replace />;
  if (!resident) return null;

  const status = hostStatusCopy(hostStatus);
  const statusColor = status.tone === "green" ? colors.greenText : status.tone === "orange" ? colors.orangeDark : colors.mutedLight;

  const firstName = resident.name.split(" ")[0];
  const weekAheadIso = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const thisWeekCount = (upcomingGames ?? []).filter((g) => g.date <= weekAheadIso).length;
  const overviewSubtitle =
    upcomingGames === null
      ? `HelloCircle Manage · ${resident.email}`
      : thisWeekCount > 0
        ? `${greeting()}, ${firstName}. You have ${thisWeekCount} activit${thisWeekCount === 1 ? "y" : "ies"} coming up this week.`
        : `${greeting()}, ${firstName}. Nothing on the calendar this week — a good time to host something new.`;
  const [nextGame, ...restGames] = upcomingGames ?? [];

  return (
    <ManageShell
      navTitle="HelloCircle Manage"
      navOptions={NAV_OPTIONS}
      activeKey={tab}
      onNavChange={setTab}
      pageTitle={NAV_OPTIONS.find((o) => o.key === tab)?.label}
      banner={
        tab === "overview" ? (
          <div style={{ borderBottom: `1px solid ${colors.border}`, paddingBottom: 24, marginBottom: 32 }}>
            <DashboardTopPanel
              title={resident.name}
              subtitle={overviewSubtitle}
              avatarName={resident.name}
              accent="green"
              eyebrow="/ Manage"
              tabs={NAV_OPTIONS}
              activeTab={tab}
              onTabChange={setTab}
              bottomSpacing={0}
              hideTabs
              badge={
                hostStatus === "verified" ? (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 4, background: colors.greenBg, color: colors.greenText, borderRadius: 20, padding: "3px 10px 3px 8px", fontSize: 12, fontWeight: 700 }}>
                    <CheckCircleIcon size={13} /> Verified Host
                  </span>
                ) : undefined
              }
              actions={<Button onClick={() => navigate("/games/host")}>Host a session</Button>}
            />
          </div>
        ) : undefined
      }
    >
      {tab === "overview" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <HostAttentionPanel residentId={resident.id} onGoToActivities={() => setTab("activities")} />

          <Card>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
              <AwardIcon size={16} style={{ color: colors.greenText }} />
              <span style={{ fontFamily: fonts.display, fontSize: 15, fontWeight: 700 }}>Host status</span>
            </div>
            <p style={{ fontSize: 13, color: statusColor, margin: "8px 0 0" }}>{status.text}</p>
            {(hostStatus === "none" || hostStatus === "rejected") && (
              <div style={{ marginTop: 12 }}>
                <Button variant="ghost" onClick={() => navigate("/profile")}>Go to your profile →</Button>
              </div>
            )}
          </Card>

          {nextGame && <HostNextUpHero game={nextGame} onManage={() => setTab("activities")} />}

          {restGames.length > 0 && (
            <div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10, marginBottom: 10 }}>
                <span style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 15 }}>Upcoming activities</span>
                <Button variant="ghost" onClick={() => setTab("activities")}>Manage all →</Button>
              </div>
              <HostUpcomingList games={restGames} onManage={() => setTab("activities")} />
            </div>
          )}

          {upcomingGames !== null && upcomingGames.length === 0 && (
            <Card>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <CalendarIcon size={16} style={{ color: colors.greenText }} />
                  <span style={{ fontFamily: fonts.display, fontSize: 15, fontWeight: 700 }}>Nothing coming up</span>
                </div>
                <Button variant="ghost" onClick={() => navigate("/games/host")}>Host a session →</Button>
              </div>
            </Card>
          )}

          <Card>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <UsersIcon size={16} style={{ color: colors.greenText }} />
                <span style={{ fontFamily: fonts.display, fontSize: 15, fontWeight: 700 }}>Your circles</span>
              </div>
              <Button variant="ghost" onClick={() => setTab("circles")}>Manage your circles →</Button>
            </div>
          </Card>
        </div>
      )}

      {tab === "activities" && <ActivitiesTab />}
      {tab === "circles" && <CirclesTab />}
      {tab === "calendar" && <HostCalendarTab />}
      {tab === "insights" && <HostInsightsTab />}
      {tab === "reviews" && <HostReviewsTab />}
      {tab === "earnings" && <HostEarningsTab />}
      {tab === "offers" && <HostOffersTab />}
    </ManageShell>
  );
}
