import { useEffect, useState } from "react";
import { HostChatButton } from "../components/HostChatButton";
import { useNavigate, useParams } from "react-router-dom";
import { fetchVendorClub, fetchVendorListings, publishVendorClub } from "../api";
import { useAuth } from "../AuthContext";
import { BackLink } from "../components/BackLink";
import { PartnerWorkspace } from "../components/workspace/PartnerWorkspace";
import { ListingMeta } from "../components/workspace/ListingMeta";
import { BookingsTab } from "../components/VendorBookings";
import { ClubParticipantsTab } from "../components/ClubParticipantsTab";
import { ClubEditor, ClubSessionsManager, ClubWaitlistPanel } from "../components/VendorClubEditor";
import { ClubCreationWizard } from "../components/ClubCreationWizard";
import { useUnsavedChangesGuard } from "../components/form";
import { ListingReviewNotice } from "../components/ListingReviewNotice";
import { MessageComposer } from "../components/VendorMessages";
import { PublishedScreen } from "../components/PublishedScreen";
import { VendorListingPerformance } from "../components/VendorListingPerformance";
import { LoadErrorState, PageSpinner, Tabs } from "../components/ui";
import { colors, fonts, radius } from "../theme";
import type { Club, VendorListingSummary } from "../types";

// Dedicated page for the sports club create/edit form — same reasoning as
// VendorCentreEditPage.tsx: fields + two independent sub-resource managers
// (Sessions, Waitlist) earn a page + tabs instead of a Drawer.
//
// "new" and any real club still in 'draft' both render the Guided Flow
// creation wizard (Form System Audit, Phase 5 fast-follow) instead of the
// settings-style tabs below — see VendorCentreEditPage.tsx's identical
// wizardMode pattern and its comment on why this is sticky state, not a
// derived expression.

type ClubTab = "details" | "sessions" | "waitlist" | "registrations" | "participants" | "messages" | "performance";

export function VendorClubEditPage() {
  const { id } = useParams<{ id: string }>();
  const clubId = id === "new" ? "new" : (id as string);
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const [tab, setTab] = useState<ClubTab>("details");
  const [club, setClub] = useState<Club | null>(null);
  const [loading, setLoading] = useState(clubId !== "new");
  const [loadError, setLoadError] = useState(false);
  const [wizardMode, setWizardMode] = useState(clubId === "new");
  const [justPublished, setJustPublished] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [listingSummary, setListingSummary] = useState<VendorListingSummary | undefined>(undefined);
  const { requestNavigation, dialog: unsavedDialog } = useUnsavedChangesGuard(dirty);

  const loadClub = () => {
    setLoadError(false);
    fetchVendorClub(clubId)
      .then((c) => {
        setClub(c);
        setWizardMode(c.status === "draft");
      })
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (clubId !== "new") {
      loadClub();
      fetchVendorListings().then((l) => setListingSummary(l.clubs.find((c) => c.id === clubId)));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clubId]);

  const onSaved = (saved: Club) => {
    setClub(saved);
    if (clubId === "new") navigate(`/vendor/clubs/${saved.id}`, { replace: true });
  };

  // See VendorDashboard.tsx's identical comment — navigate() belongs in an
  // effect, not called directly during render.
  useEffect(() => {
    if (!authLoading && (!user || user.role !== "vendor" || user.status !== "approved")) navigate("/login");
  }, [authLoading, user, navigate]);

  if (authLoading || loading) return <PageSpinner />;
  if (!user || user.role !== "vendor" || user.status !== "approved") return null;

  const title = clubId === "new" ? "New sports club" : (club?.name ?? "Edit sports club");
  if (loadError) {
    return (
      <PartnerWorkspace user={user} active="listings" title={title}>
        <BackLink onClick={() => navigate("/vendor?tab=listings")}>Back to listings</BackLink>
        <LoadErrorState title="Couldn't load this club" onRetry={loadClub} />
      </PartnerWorkspace>
    );
  }

  return (
    <PartnerWorkspace
      user={user}
      active="listings"
      title={title}
      guard={requestNavigation}
      subtitle={!wizardMode && club ? <ListingMeta status={club.status} kind="Club" place={[club.area, club.county].filter(Boolean).join(", ")} /> : undefined}
      actions={!wizardMode && clubId !== "new" ? <HostChatButton scopeType="club" scopeId={clubId} title={club?.name ?? "Club chat"} label="Members chat" className="adm-btn" /> : undefined}
    >
      <div>

        {wizardMode ? (
          <ClubCreationWizard
            initialClubId={clubId}
            onDirtyChange={setDirty}
            onPublished={(published) => {
              setClub(published);
              setWizardMode(false);
              setJustPublished(true);
            }}
          />
        ) : justPublished ? (
          <PublishedScreen name={club?.name ?? "Your club"} publicHref={`/clubs/${club?.slug ?? clubId}`} onDismiss={() => setJustPublished(false)} />
        ) : (
          <>
            <ListingReviewNotice listing={{ type: "club", id: clubId }} status={club?.status} dirty={dirty} onResubmit={async () => setClub(await publishVendorClub(clubId))} />
            <div style={{ marginBottom: 22 }}>
              <Tabs
                value={tab}
                onChange={setTab}
                options={[
                  { key: "details", label: "Details" },
                  { key: "sessions", label: "Recurring sessions" },
                  { key: "waitlist", label: "Waitlist" },
                  { key: "registrations", label: "Registrations" },
                  { key: "participants", label: "Participants" },
                  { key: "messages", label: "Messages" },
                  { key: "performance", label: "Performance" },
                ]}
              />
            </div>

            {tab === "details" && <ClubEditor clubId={clubId} onSaved={onSaved} onDirtyChange={setDirty} />}
            {tab === "sessions" && <ClubSessionsManager clubId={clubId} />}
            {tab === "waitlist" && <ClubWaitlistPanel clubId={clubId} />}
            {tab === "registrations" && <BookingsTab clubId={clubId} />}
            {tab === "participants" && <ClubParticipantsTab clubId={clubId} />}
            {tab === "messages" && club && (
              <MessageComposer listings={{ centres: [], clubs: [] }} lockTo={{ listingType: "club", listingId: clubId, name: club.name }} />
            )}
            {tab === "performance" && <VendorListingPerformance summary={listingSummary} />}
          </>
        )}
      </div>
      {unsavedDialog}
    </PartnerWorkspace>
  );
}
