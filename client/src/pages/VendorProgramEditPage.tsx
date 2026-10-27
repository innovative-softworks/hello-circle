import { useEffect, useState } from "react";
import { CircleCreationBanner } from "../components/circle/CircleCreationBanner";
import { HostChatButton } from "../components/HostChatButton";
import { useNavigate, useParams } from "react-router-dom";
import { fetchVendorListings, fetchVendorProgram } from "../api";
import { useAuth } from "../AuthContext";
import { BackLink } from "../components/BackLink";
import { ProgramCreateForm, ProgramManager } from "../components/VendorPrograms";
import { useUnsavedChangesGuard } from "../components/form";
import { LoadErrorState, PageSpinner } from "../components/ui";
import { PartnerWorkspace } from "../components/workspace/PartnerWorkspace";
import { colors, radius } from "../theme";
import type { VendorListingSummary } from "../types";

// Dedicated page for a Program — was two separate wide Drawers (create form,
// then a manage view with sessions/attendance/enrollments). Kept as a single
// scrolling page (no Tabs): the manage view's sections are sequential, not
// independent parallel concerns the way Rooms/Availability/Hours are for a
// centre.

export function VendorProgramEditPage() {
  const { id } = useParams<{ id: string }>();
  const programId = id === "new" ? "new" : (id as string);
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const [listings, setListings] = useState<{ centres: VendorListingSummary[]; clubs: VendorListingSummary[] }>({ centres: [], clubs: [] });
  const [title, setTitle] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [dirty, setDirty] = useState(false);
  const { requestNavigation, dialog: unsavedDialog } = useUnsavedChangesGuard(dirty);

  const load = () => {
    setLoadError(false);
    if (programId === "new")
      fetchVendorListings()
        .then(setListings)
        .catch(() => setLoadError(true));
    else
      fetchVendorProgram(programId)
        .then((p) => setTitle(p.title))
        .catch(() => setLoadError(true));
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [programId]);

  // See VendorDashboard.tsx's identical comment — navigate() belongs in an
  // effect, not called directly during render.
  useEffect(() => {
    if (!authLoading && (!user || user.role !== "vendor" || user.status !== "approved")) navigate("/login");
  }, [authLoading, user, navigate]);

  if (authLoading) return <PageSpinner />;
  if (!user || user.role !== "vendor" || user.status !== "approved") return null;

  const pageTitle = programId === "new" ? "New programme" : (title ?? "Programme");
  return (
    <PartnerWorkspace
      user={user}
      active="programs"
      title={pageTitle}
      guard={requestNavigation}
      actions={
        programId !== "new" ? (
          <HostChatButton scopeType="program" scopeId={programId} title={title ?? "Programme chat"} label="Group chat" className="adm-btn" />
        ) : undefined
      }
    >
      <div>
        <CircleCreationBanner type="program" listingId={programId === "new" ? null : programId} />
        {loadError ? (
          <LoadErrorState title={programId === "new" ? "Couldn't load your listings." : "Couldn't load this programme."} onRetry={load} />
        ) : programId === "new" ? (
          <ProgramCreateForm listings={listings} onCreated={(newId) => navigate(`/vendor/programs/${newId}${window.location.search}`, { replace: true })} onDirtyChange={setDirty} />
        ) : (
          <ProgramManager programId={programId} onChanged={() => fetchVendorProgram(programId).then((p) => setTitle(p.title)).catch(() => {})} />
        )}
      </div>
      {unsavedDialog}
    </PartnerWorkspace>
  );
}
