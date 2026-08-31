import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { fetchVendorCentre, fetchVendorRooms } from "../api";
import { useAuth } from "../AuthContext";
import { BackLink } from "../components/BackLink";
import { AvailabilityBlocksManager, CentreEditor, FacilityHoursEditor, RoomsManager } from "../components/VendorCentreEditor";
import { CentreCreationWizard } from "../components/CentreCreationWizard";
import { useUnsavedChangesGuard } from "../components/form";
import { PageSpinner, Tabs } from "../components/ui";
import { fonts } from "../theme";
import type { Centre, Room } from "../types";

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

type CentreTab = "details" | "rooms" | "availability" | "hours";

export function VendorCentreEditPage() {
  const { id } = useParams<{ id: string }>();
  const centreId = id === "new" ? "new" : (id as string);
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const [tab, setTab] = useState<CentreTab>("details");
  const [centre, setCentre] = useState<Centre | null>(null);
  const [rooms, setRooms] = useState<Room[]>([]);
  // Only blocks the very first load of a real (non-"new") id — deliberately
  // NOT re-armed on later id changes (see the effect below), so the wizard
  // completing its "Basics" step and calling navigate(..., {replace:true})
  // doesn't flash a full-page spinner over an in-progress wizard session.
  const [loading, setLoading] = useState(centreId !== "new");
  // Deliberately its OWN state, not a `centreId === "new" || centre?.status
  // === "draft"` expression recomputed every render: right after the
  // wizard's own navigate(..., {replace:true}) call, `centreId` updates to
  // the new real id before this page's re-fetch resolves, so `centre` is
  // transiently null — a derived expression would read that gap as "not a
  // draft," swap to the tabs branch, and unmount (and reset) the wizard
  // mid-flow. Sticky state only changes when we actually know the answer.
  const [wizardMode, setWizardMode] = useState(centreId === "new");
  const [dirty, setDirty] = useState(false);
  const { requestNavigation, dialog: unsavedDialog } = useUnsavedChangesGuard(dirty);

  const reloadRooms = () => {
    if (centreId !== "new") fetchVendorRooms(centreId).then(setRooms);
  };

  useEffect(() => {
    if (centreId !== "new") {
      fetchVendorCentre(centreId).then((c) => {
        setCentre(c);
        setWizardMode(c.status === "draft");
        setLoading(false);
      });
      reloadRooms();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [centreId]);

  const onSaved = (saved: Centre) => setCentre(saved);

  if (authLoading || loading) return <PageSpinner />;
  if (!user || user.role !== "vendor" || user.status !== "approved") {
    navigate("/login");
    return null;
  }

  const title = centreId === "new" ? "New community centre" : (centre?.name ?? "Edit community centre");

  return (
    <div className="fade-panel">
      <section className="section-pad" style={{ maxWidth: 920, margin: "0 auto", padding: "40px 24px 90px" }}>
        <BackLink onClick={() => requestNavigation(() => navigate("/vendor?tab=listings"))}>Back to listings</BackLink>

        {wizardMode ? (
          <CentreCreationWizard
            initialCentreId={centreId}
            onDirtyChange={setDirty}
            onPublished={(published) => {
              setCentre(published);
              setWizardMode(false);
              reloadRooms();
            }}
          />
        ) : (
          <>
            <h2 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 24, margin: "0 0 18px", letterSpacing: "-.01em" }}>{title}</h2>
            <div style={{ marginBottom: 22 }}>
              <Tabs
                value={tab}
                onChange={setTab}
                options={[
                  { key: "details", label: "Details" },
                  { key: "rooms", label: "Rooms" },
                  { key: "availability", label: "Availability" },
                  { key: "hours", label: "Hours" },
                ]}
              />
            </div>

            {tab === "details" && <CentreEditor centreId={centreId} onSaved={onSaved} onDirtyChange={setDirty} />}
            {tab === "rooms" && <RoomsManager centreId={centreId} rooms={rooms} onChanged={reloadRooms} />}
            {tab === "availability" && <AvailabilityBlocksManager centreId={centreId} rooms={rooms} />}
            {tab === "hours" && <FacilityHoursEditor centreId={centreId} />}
          </>
        )}
      </section>
      {unsavedDialog}
    </div>
  );
}
