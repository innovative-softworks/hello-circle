import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { fetchVendorCentre, fetchVendorListings, fetchVendorRooms, publishVendorCentre } from "../api";
import { useAuth } from "../AuthContext";
import { BackLink } from "../components/BackLink";
import { PartnerWorkspace } from "../components/workspace/PartnerWorkspace";
import { ListingKeyNumbers, ListingMeta } from "../components/workspace/ListingMeta";
import { BookingsTab } from "../components/VendorBookings";
import { AvailabilityBlocksManager, CentreEditor, FacilityHoursEditor, RoomsManager } from "../components/VendorCentreEditor";
import { CentreCreationWizard } from "../components/CentreCreationWizard";
import { useUnsavedChangesGuard } from "../components/form";
import { ListingReviewNotice } from "../components/ListingReviewNotice";
import { MessageComposer } from "../components/VendorMessages";
import { PublishedScreen } from "../components/PublishedScreen";
import { VendorListingPerformance } from "../components/VendorListingPerformance";
import { LoadErrorState, PageSpinner, Tabs } from "../components/ui";
import { fonts } from "../theme";
import type { Centre, Room, VendorListingSummary } from "../types";

// Dedicated page for the community centre create/edit form — was a wide
// Drawer (see VendorDashboard.tsx history); this form's own fields plus
// three independent sub-resource managers (Rooms, Availability, Hours)
// earn a real page + tabs rather than a slide-in panel (see CLAUDE.md-
// adjacent design-pattern note: small forms stay in a drawer, big
// multi-section ones get a page).
//
// "new" and any real centre still in 'draft' both render the Guided Flow
// creation wizard (Form System Audit, Phase 5) instead of the settings-
// style tabs below — a draft hasn't been published yet, so there's nothing
// meaningful to summarize into SettingsSections. Once publish flips it to
// 'pending'/'approved', this same route switches to the normal tabbed view.

type CentreTab = "details" | "rooms" | "availability" | "hours" | "bookings" | "messages" | "performance";

export function VendorCentreEditPage() {
  const { id } = useParams<{ id: string }>();
  const centreId = id === "new" ? "new" : (id as string);
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const [tab, setTab] = useState<CentreTab>("details");
  const [centre, setCentre] = useState<Centre | null>(null);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [listingSummary, setListingSummary] = useState<VendorListingSummary | undefined>(undefined);
  // Only blocks the very first load of a real (non-"new") id — deliberately
  // NOT re-armed on later id changes (see the effect below), so the wizard
  // completing its "Basics" step and calling navigate(..., {replace:true})
  // doesn't flash a full-page spinner over an in-progress wizard session.
  const [loading, setLoading] = useState(centreId !== "new");
  const [loadError, setLoadError] = useState(false);
  // Deliberately its OWN state, not a `centreId === "new" || centre?.status
  // === "draft"` expression recomputed every render: right after the
  // wizard's own navigate(..., {replace:true}) call, `centreId` updates to
  // the new real id before this page's re-fetch resolves, so `centre` is
  // transiently null — a derived expression would read that gap as "not a
  // draft," swap to the tabs branch, and unmount (and reset) the wizard
  // mid-flow. Sticky state only changes when we actually know the answer.
  const [wizardMode, setWizardMode] = useState(centreId === "new");
  const [justPublished, setJustPublished] = useState(false);
  const [dirty, setDirty] = useState(false);
  const { requestNavigation, dialog: unsavedDialog } = useUnsavedChangesGuard(dirty);

  const reloadRooms = () => {
    if (centreId !== "new") fetchVendorRooms(centreId).then(setRooms);
  };

  const loadCentre = () => {
    setLoadError(false);
    fetchVendorCentre(centreId)
      .then((c) => {
        setCentre(c);
        setWizardMode(c.status === "draft");
      })
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (centreId !== "new") {
      loadCentre();
      reloadRooms();
      fetchVendorListings().then((l) => setListingSummary(l.centres.find((c) => c.id === centreId)));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [centreId]);

  const onSaved = (saved: Centre) => setCentre(saved);

  // See VendorDashboard.tsx's identical comment — navigate() belongs in an
  // effect, not called directly during render.
  useEffect(() => {
    if (!authLoading && (!user || user.role !== "vendor" || user.status !== "approved")) navigate("/login");
  }, [authLoading, user, navigate]);

  if (authLoading || loading) return <PageSpinner />;
  if (!user || user.role !== "vendor" || user.status !== "approved") return null;

  const title = centreId === "new" ? "New community centre" : (centre?.name ?? "Edit community centre");
  if (loadError) {
    return (
      <PartnerWorkspace user={user} active="listings" title={title}>
        <BackLink onClick={() => navigate("/vendor?tab=listings")}>Back to listings</BackLink>
        <LoadErrorState title="Couldn't load this venue" onRetry={loadCentre} />
      </PartnerWorkspace>
    );
  }

  return (
    <PartnerWorkspace
      user={user}
      active="listings"
      title={title}
      guard={requestNavigation}
      subtitle={!wizardMode && centre ? <ListingMeta status={centre.status} kind="Centre" place={[centre.area, centre.county].filter(Boolean).join(", ")} /> : undefined}
      actions={undefined}
    >
      <div>

        {wizardMode ? (
          <CentreCreationWizard
            initialCentreId={centreId}
            onDirtyChange={setDirty}
            onPublished={(published) => {
              setCentre(published);
              setWizardMode(false);
              setJustPublished(true);
              reloadRooms();
            }}
          />
        ) : justPublished ? (
          <PublishedScreen name={centre?.name ?? "Your venue"} publicHref={`/centres/${centre?.slug ?? centreId}`} onDismiss={() => setJustPublished(false)} />
        ) : (
          <>
            <ListingReviewNotice listing={{ type: "centre", id: centreId }} status={centre?.status} dirty={dirty} onResubmit={async () => setCentre(await publishVendorCentre(centreId))} />
            <ListingKeyNumbers summary={listingSummary} kind="centre" />
            <div style={{ marginBottom: 22 }}>
              <Tabs
                value={tab}
                onChange={setTab}
                options={[
                  { key: "details", label: "Details" },
                  { key: "rooms", label: "Rooms" },
                  { key: "availability", label: "Availability" },
                  { key: "hours", label: "Hours" },
                  { key: "bookings", label: "Bookings" },
                  { key: "messages", label: "Messages" },
                  { key: "performance", label: "Performance" },
                ]}
              />
            </div>

            {tab === "details" && <CentreEditor centreId={centreId} onSaved={onSaved} onDirtyChange={setDirty} />}
            {tab === "rooms" && <RoomsManager centreId={centreId} rooms={rooms} onChanged={reloadRooms} />}
            {tab === "availability" && <AvailabilityBlocksManager centreId={centreId} centreName={title} rooms={rooms} />}
            {tab === "hours" && <FacilityHoursEditor centreId={centreId} />}
            {tab === "bookings" && <BookingsTab centreId={centreId} />}
            {tab === "messages" && centre && (
              <MessageComposer listings={{ centres: [], clubs: [] }} lockTo={{ listingType: "centre", listingId: centreId, name: centre.name }} />
            )}
            {tab === "performance" && <VendorListingPerformance summary={listingSummary} />}
          </>
        )}
      </div>
      {unsavedDialog}
    </PartnerWorkspace>
  );
}
